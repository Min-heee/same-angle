import { describe, expect, it } from "vitest";
import { decomposeRaw } from "@/core/matrix";
import { angleBetweenDeg, mirrorView, traceToView, viewFromMatrix, viewToTrace, type Vec3 } from "./direction";
import { I3, Rx, Ry, Rz, matrix16, mul, mulVec } from "./testkit";

/*
 * 기대값은 손으로 정한 회전·이동에서 직접 계산한다. 구현의 식(Rᵀ·(−t/|t|))을 그대로 다시 쓰지 않고,
 * "얼굴을 그 자리에 두고 카메라가 어디 있는지"를 기하로 따진 값과 견준다.
 */

const rad = (d: number) => (d * Math.PI) / 180;
const expectVec = (got: Vec3, want: readonly number[], digits = 12) => {
  for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(want[i], digits);
};

describe("viewFromMatrix — 얼굴에서 본 카메라의 방향", () => {
  it("정면: 얼굴이 광축 위에 있고 돌지 않았으면 얼굴의 +z 쪽에 카메라가 있다", () => {
    const v = viewFromMatrix(matrix16(I3, 1, [0, 0, -50]))!;
    expectVec(v.view, [0, 0, 1]);
  });

  it("얼굴이 y축 둘레로 20° 돌면 카메라는 얼굴 좌표에서 반대로 20° 돈 자리에 있다", () => {
    // 얼굴의 +z(코 방향)가 카메라 좌표에서 (sin20, 0, cos20)을 향한다. 카메라 쪽 (0,0,1)을
    // 얼굴 좌표로 옮기면 (−sin20, 0, cos20).
    const v = viewFromMatrix(matrix16(Ry(20), 1, [0, 0, -50]))!;
    expectVec(v.view, [-Math.sin(rad(20)), 0, Math.cos(rad(20))]);
  });

  it("얼굴이 돌지 않고 화면에서 옆으로 옮겨 가면 그만큼 보는 방향이 달라진다(위치 차는 각도 차에 들어간다)", () => {
    // 50cm 앞에서 옆으로 5cm: atan(5/50) = 5.7106°.
    const center = viewFromMatrix(matrix16(I3, 1, [0, 0, -50]))!;
    const moved = viewFromMatrix(matrix16(I3, 1, [5, 0, -50]))!;
    expect(angleBetweenDeg(center.view, moved.view)).toBeCloseTo(Math.atan(5 / 50) * (180 / Math.PI), 9);
    // 축별 각은 그대로다 — 축별 각의 차로는 이 차이를 볼 수 없다.
    expect(moved.yaw).toBeCloseTo(center.yaw, 12);
    expect(moved.pitch).toBeCloseTo(center.pitch, 12);
  });

  it("카메라만 돌려 얼굴이 화면에서 옮겨 간 쌍: 보는 방향은 같고(0.001° 이내) 축별 각은 달라진다", () => {
    const R = mul(Ry(12), mul(Rx(-7), Rz(3)));
    const t = [1.5, -2, -45];
    const before = viewFromMatrix(matrix16(R, 1, t))!;
    for (const Q of [Ry(9), Rx(-6), mul(Ry(-8), Rx(5))]) {
      const after = viewFromMatrix(matrix16(mul(Q, R), 1, mulVec(Q, t)))!;
      expect(angleBetweenDeg(before.view, after.view)).toBeLessThan(0.001);
      const axisChange = Math.hypot(after.yaw - before.yaw, after.pitch - before.pitch);
      expect(axisChange).toBeGreaterThan(4);
    }
  });

  it("화면 안에서 기울기만 바꾼 쌍: 보는 방향은 같고(0.001° 이내) roll 은 달라진다", () => {
    const R = mul(Ry(-15), Rx(10));
    const t = [3, 2, -40];
    const before = viewFromMatrix(matrix16(R, 1, t))!;
    const Q = Rz(25);
    const after = viewFromMatrix(matrix16(mul(Q, R), 1, mulVec(Q, t)))!;
    expect(angleBetweenDeg(before.view, after.view)).toBeLessThan(0.001);
    expect(Math.abs(after.roll - before.roll)).toBeGreaterThan(20);
  });

  it("얼굴이 실제로 돌면 그 각만큼 달라진다(얼굴이 광축 위에 있을 때)", () => {
    const a = viewFromMatrix(matrix16(Ry(10), 1, [0, 0, -50]))!;
    const b = viewFromMatrix(matrix16(Ry(13), 1, [0, 0, -50]))!;
    expect(angleBetweenDeg(a.view, b.view)).toBeCloseTo(3, 9);
  });

  it("열 우선·행 우선 배치와 스케일은 결과를 바꾸지 않는다", () => {
    const R = mul(Ry(18), mul(Rx(-9), Rz(4)));
    const t = [2, -3, -55];
    const col = viewFromMatrix(matrix16(R, 1, t, "col"))!;
    const row = viewFromMatrix(matrix16(R, 1, t, "row"))!;
    const scaled = viewFromMatrix(matrix16(R, 1.37, t, "col"))!;
    expect(col.layout).toBe("col");
    expect(row.layout).toBe("row");
    expectVec(row.view, col.view);
    expectVec(scaled.view, col.view);
  });

  it("단위 벡터이고, 직교 오차와 참고용 축별 각을 함께 돌려준다", () => {
    const data = matrix16(mul(Ry(20), Rx(5)), 1, [1, 1, -30]);
    const v = viewFromMatrix(data)!;
    expect(Math.hypot(...v.view)).toBeCloseTo(1, 12);
    const d = decomposeRaw(data, "col")!;
    expect(v.orthoError).toBe(d.orthoError);
    expect(v.yaw).toBe(d.yaw);
    expect(v.pitch).toBe(d.pitch);
    expect(v.roll).toBe(d.roll);
  });

  it("읽을 수 없는 행렬은 null — 방향을 지어내지 않는다", () => {
    expect(viewFromMatrix([1, 2, 3])).toBeNull();
    expect(viewFromMatrix(new Array(16).fill(Number.NaN))).toBeNull();
    // 이동이 0 이면 배치도 방향도 정할 수 없다.
    expect(viewFromMatrix(matrix16(I3, 1, [0, 0, 0]))).toBeNull();
    // 반사(한 축만 뒤집음).
    const flip = [
      [-1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    expect(viewFromMatrix(matrix16(flip, 1, [0, 0, -50]))).toBeNull();
    // 스케일 0.
    expect(viewFromMatrix(matrix16(I3, 0, [0, 0, -50]))).toBeNull();
  });
});

describe("angleBetweenDeg", () => {
  it("0°·90°·180°", () => {
    expect(angleBetweenDeg([0, 0, 1], [0, 0, 1])).toBe(0);
    expect(angleBetweenDeg([0, 0, 1], [1, 0, 0])).toBeCloseTo(90, 12);
    expect(angleBetweenDeg([0, 0, 1], [0, 0, -1])).toBeCloseTo(180, 12);
  });

  it("아주 작은 각도 정밀하게 잰다(acos 로는 잃는 자리)", () => {
    for (const d of [0.001, 0.0001, 1e-6]) {
      expect(angleBetweenDeg(traceToView({ h: 10, v: 0 }), traceToView({ h: 10 + d, v: 0 }))).toBeCloseTo(d, 9);
    }
  });

  it("길이가 달라도 각은 같다", () => {
    expect(angleBetweenDeg([0, 0, 2], [3, 0, 3])).toBeCloseTo(45, 12);
  });

  it("유한하지 않거나 길이가 0 이면 NaN — '≤ 기준' 비교에서 거짓이 된다", () => {
    expect(angleBetweenDeg([Number.NaN, 0, 1], [0, 0, 1])).toBeNaN();
    expect(angleBetweenDeg([0, 0, 0], [0, 0, 1])).toBeNaN();
    expect(Number.NaN <= 3).toBe(false);
  });
});

describe("mirrorView · 자취 2값", () => {
  it("좌우를 뒤집으면 가로 각의 부호만 바뀐다", () => {
    const t = viewToTrace(mirrorView(traceToView({ h: 40, v: -8 })));
    expect(t.h).toBeCloseTo(-40, 10);
    expect(t.v).toBeCloseTo(-8, 10);
  });

  it("사선 40° 의 반대쪽은 80° 떨어져 있고, 뒤집으면 겹친다", () => {
    const left = traceToView({ h: 40, v: 0 });
    const right = traceToView({ h: -40, v: 0 });
    expect(angleBetweenDeg(left, right)).toBeCloseTo(80, 9);
    expect(angleBetweenDeg(mirrorView(left), right)).toBeCloseTo(0, 9);
  });

  it("정면은 (0, 0)이고 왕복하면 같은 값이 나온다", () => {
    expect(viewToTrace([0, 0, 1])).toEqual({ h: 0, v: 0 });
    for (const p of [
      { h: 12, v: -7 },
      { h: -45, v: 20 },
      { h: 0, v: 30 },
    ]) {
      const back = viewToTrace(traceToView(p));
      expect(back.h).toBeCloseTo(p.h, 10);
      expect(back.v).toBeCloseTo(p.v, 10);
    }
  });

  it("세로로만 움직이면 두 방향 사이의 각이 세로 각의 차와 같다", () => {
    expect(angleBetweenDeg(traceToView({ h: 0, v: 5 }), traceToView({ h: 0, v: -4 }))).toBeCloseTo(9, 9);
  });
});
