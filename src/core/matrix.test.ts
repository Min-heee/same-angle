import { describe, expect, it } from "vitest";
import {
  PITCH_SIGN,
  ROLL_SIGN,
  YAW_SIGN,
  at,
  decompose,
  detectLayout,
  elementwiseMedian,
} from "./matrix";

/*
 * 기대값은 손으로 정한 자세(yaw·pitch·roll·scale·t)이고, 행렬은 테스트 안에서
 * Ry·Rx·Rz 를 직접 곱해 만든다. 구현의 분해 함수를 거꾸로 써서 기대값을 만들지 않는다.
 *
 * 부호: 분해 결과에는 SIGN 상수가 곱해진다. SIGN 은 D1 실측 픽스처로 정할 값이라
 * 여기서는 "상수가 무엇이든 규약대로 복원되는가"만 본다. 부호 자체의 옳고 그름은
 * 실측 픽스처 테스트(D2)가 맡는다 — 합성 데이터로는 부호 오류를 잡을 수 없다.
 */

type M3 = number[][];

const deg = (d: number) => (d * Math.PI) / 180;

function mul(a: M3, b: M3): M3 {
  return [0, 1, 2].map((r) =>
    [0, 1, 2].map((c) => a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c]),
  );
}

function Ry(d: number): M3 {
  const c = Math.cos(deg(d));
  const s = Math.sin(deg(d));
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ];
}
function Rx(d: number): M3 {
  const c = Math.cos(deg(d));
  const s = Math.sin(deg(d));
  return [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c],
  ];
}
function Rz(d: number): M3 {
  const c = Math.cos(deg(d));
  const s = Math.sin(deg(d));
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
}

/** 4×4 아핀 행렬(행·열 인덱스로 접근하는 2차원 배열). */
function affine(yaw: number, pitch: number, roll: number, scale: number, t: number[]): number[][] {
  const R = mul(mul(Ry(yaw), Rx(pitch)), Rz(roll));
  return [
    [R[0][0] * scale, R[0][1] * scale, R[0][2] * scale, t[0]],
    [R[1][0] * scale, R[1][1] * scale, R[1][2] * scale, t[1]],
    [R[2][0] * scale, R[2][1] * scale, R[2][2] * scale, t[2]],
    [0, 0, 0, 1],
  ];
}

/** 열 우선 펼침: data[c*4 + r]. */
function colMajor(M: number[][]): number[] {
  const out: number[] = [];
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out.push(M[r][c]);
  return out;
}
/** 행 우선 펼침: data[r*4 + c]. */
function rowMajor(M: number[][]): number[] {
  return M.flat();
}

const POSES = [
  { yaw: 0, pitch: 0, roll: 0, scale: 1, t: [1, -2, -40] },
  { yaw: 20, pitch: -10, roll: 5, scale: 1, t: [3.5, 1.25, -52] },
  { yaw: -35, pitch: 28, roll: -12, scale: 1, t: [-4, 6, -38] },
  { yaw: 44, pitch: -30, roll: 17, scale: 2.5, t: [0.5, -0.5, -60] },
];

describe("detectLayout", () => {
  it.each(POSES)("열 우선은 'col', 행 우선은 'row' (yaw $yaw)", (p) => {
    const M = affine(p.yaw, p.pitch, p.roll, p.scale, p.t);
    expect(detectLayout(colMajor(M))).toBe("col");
    expect(detectLayout(rowMajor(M))).toBe("row");
  });

  it("이동이 0이면 두 배치가 구별되지 않으므로 null", () => {
    const M = affine(10, 5, 0, 1, [0, 0, 0]);
    expect(detectLayout(colMajor(M))).toBeNull();
  });

  it("마지막 행이 (0,0,0,1)이 아니면(아핀 아님) null", () => {
    const d = colMajor(affine(10, 5, 0, 1, [1, 2, -40]));
    d[15] = 2;
    expect(detectLayout(d)).toBeNull();
  });

  it("길이 15, 비유한 값은 null", () => {
    const d = colMajor(affine(10, 5, 0, 1, [1, 2, -40]));
    expect(detectLayout(d.slice(0, 15))).toBeNull();
    const bad = [...d];
    bad[5] = Number.NaN;
    expect(detectLayout(bad)).toBeNull();
    bad[5] = Number.POSITIVE_INFINITY;
    expect(detectLayout(bad)).toBeNull();
  });
});

describe("at", () => {
  it("같은 행렬을 두 배치로 펼쳐도 (r, c) 원소는 같다", () => {
    const M = affine(20, -10, 5, 1.5, [3, 4, -50]);
    const col = colMajor(M);
    const row = rowMajor(M);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        expect(at(col, r, c, "col")).toBe(M[r][c]);
        expect(at(row, r, c, "row")).toBe(M[r][c]);
      }
    }
  });
});

describe("decompose", () => {
  it.each(POSES)(
    "yaw $yaw · pitch $pitch · roll $roll · scale $scale 를 두 배치 모두에서 복원한다",
    (p) => {
      const M = affine(p.yaw, p.pitch, p.roll, p.scale, p.t);
      for (const [data, layout] of [
        [colMajor(M), "col"],
        [rowMajor(M), "row"],
      ] as const) {
        const d = decompose(data, layout);
        expect(d).not.toBeNull();
        expect(d!.yaw).toBeCloseTo(YAW_SIGN * p.yaw, 9);
        expect(d!.pitch).toBeCloseTo(PITCH_SIGN * p.pitch, 9);
        expect(d!.roll).toBeCloseTo(ROLL_SIGN * p.roll, 9);
        expect(d!.scale).toBeCloseTo(p.scale, 9);
        expect(d!.t[0]).toBeCloseTo(p.t[0], 9);
        expect(d!.t[1]).toBeCloseTo(p.t[1], 9);
        expect(d!.t[2]).toBeCloseTo(p.t[2], 9);
        expect(d!.orthoError).toBeLessThan(1e-12);
      }
    },
  );

  it("스케일 2.5 에서도 각이 스케일에 끌려가지 않는다", () => {
    const M = affine(30, 15, -8, 2.5, [2, 2, -45]);
    const d = decompose(colMajor(M), "col")!;
    expect(d.scale).toBeCloseTo(2.5, 12);
    expect(d.yaw).toBeCloseTo(YAW_SIGN * 30, 9);
    expect(d.pitch).toBeCloseTo(PITCH_SIGN * 15, 9);
    expect(d.roll).toBeCloseTo(ROLL_SIGN * -8, 9);
  });

  it("|R12| 가 1을 1e-12 넘어도 NaN 이 아니다(asin 클램프)", () => {
    // 첫 열 (1,0,0) → s = 1. R12 = −(1 + 1e-12) 이면 −R12 = 1 + 1e-12 > 1.
    const M = [
      [1, 0, 0, 1],
      [0, 0, -(1 + 1e-12), 2],
      [0, 1, 0, -40],
      [0, 0, 0, 1],
    ];
    const d = decompose(colMajor(M), "col")!;
    expect(Number.isNaN(d.pitch)).toBe(false);
    expect(d.pitch).toBeCloseTo(PITCH_SIGN * 90, 9);
    expect(Number.isFinite(d.yaw)).toBe(true);
    expect(Number.isFinite(d.roll)).toBe(true);

    // 반대쪽 끝도.
    M[1][2] = 1 + 1e-12;
    const e = decompose(colMajor(M), "col")!;
    expect(Number.isNaN(e.pitch)).toBe(false);
    expect(e.pitch).toBeCloseTo(PITCH_SIGN * -90, 9);
  });

  it("행 우선 데이터를 열 우선으로 잘못 읽으면 값이 달라진다", () => {
    const M = affine(20, -10, 5, 1, [3.5, 1.25, -52]);
    const row = rowMajor(M);
    const right = decompose(row, "row")!;
    const wrong = decompose(row, "col")!;
    // 회전은 전치(역회전)로 읽히고, 이동 자리에는 마지막 행의 0이 읽힌다.
    const maxAngleDiff = Math.max(
      Math.abs(right.yaw - wrong.yaw),
      Math.abs(right.pitch - wrong.pitch),
      Math.abs(right.roll - wrong.roll),
    );
    expect(maxAngleDiff).toBeGreaterThan(1);
    expect(wrong.t).toEqual([0, 0, 0]);
    expect(right.t[2]).toBeCloseTo(-52, 12);
  });

  it("길이 15, 비유한 값, 스케일 0 은 null (0으로 채우지 않는다)", () => {
    const d = colMajor(affine(10, 5, 0, 1, [1, 2, -40]));
    expect(decompose(d.slice(0, 15), "col")).toBeNull();
    const nan = [...d];
    nan[0] = Number.NaN;
    expect(decompose(nan, "col")).toBeNull();
    const inf = [...d];
    inf[14] = Number.NEGATIVE_INFINITY;
    expect(decompose(inf, "col")).toBeNull();
    const zero = colMajor(affine(10, 5, 0, 0, [1, 2, -40]));
    expect(decompose(zero, "col")).toBeNull();
  });

  it("균등 스케일이 아니면 orthoError 가 커진다", () => {
    const M = affine(0, 0, 0, 1, [0, 0, -40]);
    M[1][1] = 1.2; // y 축만 늘림
    const d = decompose(colMajor(M), "col")!;
    // (1.2)² − 1 = 0.44
    expect(d.orthoError).toBeCloseTo(0.44, 12);
  });
});

describe("elementwiseMedian", () => {
  it("원소마다 중앙값(짝수 개면 가운데 둘의 평균)", () => {
    const a = Array.from({ length: 16 }, () => 1);
    const b = Array.from({ length: 16 }, () => 3);
    const c = Array.from({ length: 16 }, () => 10);
    expect(elementwiseMedian([a, c, b])).toEqual(Array.from({ length: 16 }, () => 3));
    expect(elementwiseMedian([a, b])).toEqual(Array.from({ length: 16 }, () => 2));
  });

  it("빈 목록, 길이·값이 잘못된 행렬이 섞이면 null", () => {
    expect(elementwiseMedian([])).toBeNull();
    const ok = Array.from({ length: 16 }, () => 1);
    expect(elementwiseMedian([ok, ok.slice(0, 15)])).toBeNull();
    expect(elementwiseMedian([ok, [...ok.slice(0, 15), Number.NaN]])).toBeNull();
  });
});
