import { describe, expect, it } from "vitest";
import {
  LAYOUT_EPS,
  PITCH_SIGN,
  ROLL_SIGN,
  YAW_SIGN,
  at,
  decompose,
  decomposeRaw,
  detectLayout,
  elementwiseMedian,
} from "./matrix";
import { PHONE_ROLL_SIGN } from "./motion";

/*
 * 기대값은 손으로 정한 자세(yaw·pitch·roll·scale·t)이고, 행렬은 테스트 안에서
 * Ry·Rx·Rz 를 직접 곱해 만든다. 구현의 분해 함수를 거꾸로 써서 기대값을 만들지 않는다.
 *
 * 부호: 규약 자체는 `decomposeRaw` 를 손으로 정한 각과 직접 비교해 확인한다(SIGN 곱셈이
 * 무엇이든 가리지 못하게). `decompose` 는 "SIGN 을 곱해 내보내는가"만 본다. SIGN 의 현재 값은
 * 아래 고정 테스트가 따로 못 박는다 — 부호가 옳은지는 합성 데이터로 알 수 없고 D1 실측
 * 픽스처(tests/fixtures/real-matrices.json)가 정한다.
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

describe("부호 상수 고정", () => {
  /*
   * 부호 상수는 [추론] 값이다. 이 줄이 없으면 누가 SIGN 을 −1·0 으로 바꿔도 테스트가 모두
   * 통과한다(기대값을 같은 상수로 만들기 때문). D1 픽스처(tests/fixtures/real-matrices.json)로
   * 부호를 바꿀 때는 이 줄도 그 근거 커밋과 함께 바꾼다(TECH-NOTES 6절 항목 2 "상수 반전, 테스트 갱신").
   */
  it("YAW·PITCH·ROLL·PHONE_ROLL 부호는 지금 모두 +1", () => {
    expect([YAW_SIGN, PITCH_SIGN, ROLL_SIGN, PHONE_ROLL_SIGN]).toEqual([1, 1, 1, 1]);
  });
});

describe("detectLayout", () => {
  it.each(POSES)("열 우선은 'col', 행 우선은 'row' (yaw $yaw)", (p) => {
    const M = affine(p.yaw, p.pitch, p.roll, p.scale, p.t);
    expect(detectLayout(colMajor(M))).toBe("col");
    expect(detectLayout(rowMajor(M))).toBe("row");
  });

  it("마지막 행의 float 잡음 1e-6 은 허용하고, 1e-3 은 아핀이 아니라고 본다(LAYOUT_EPS = 1e-4)", () => {
    expect(LAYOUT_EPS).toBe(1e-4);
    const d = colMajor(affine(20, -10, 5, 1, [3.5, 1.25, -52]));
    const noisy = [...d];
    noisy[3] = 1e-6;
    noisy[15] = 1 - 1e-6;
    expect(detectLayout(noisy)).toBe("col");
    const bad = [...d];
    bad[3] = 1e-3;
    expect(detectLayout(bad)).toBeNull();
  });

  it("이동 성분 하나만 0이 아니어도(tz = 0) 배치를 판별한다", () => {
    const M = affine(10, 5, 0, 1, [5, 0, 0]);
    expect(detectLayout(colMajor(M))).toBe("col");
    expect(detectLayout(rowMajor(M))).toBe("row");
    const N = affine(10, 5, 0, 1, [0, 5, 0]);
    expect(detectLayout(colMajor(N))).toBe("col");
    expect(detectLayout(rowMajor(N))).toBe("row");
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

  it("행 우선에서 마지막 원소가 1이 아니면(아핀 아님) null", () => {
    const d = rowMajor(affine(10, 5, 0, 1, [1, 2, -40]));
    d[15] = 2;
    expect(detectLayout(d)).toBeNull();
  });

  it("float32 를 거쳐 온 행렬도 판별한다(MediaPipe Matrix.data 는 Float32Array)", () => {
    const M = affine(20, -10, 5, 1, [3.5, 1.25, -52]);
    const f32 = Float32Array.from(colMajor(M));
    expect(detectLayout(f32)).toBe("col");
    expect(detectLayout(Float32Array.from(rowMajor(M)))).toBe("row");
    const d = decomposeRaw(f32, "col")!;
    expect(d.yaw).toBeCloseTo(20, 4);
    expect(d.pitch).toBeCloseTo(-10, 4);
    expect(d.roll).toBeCloseTo(5, 4);
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

describe("decomposeRaw (부호 곱하기 전 규약 각)", () => {
  it.each(POSES)("손으로 정한 yaw $yaw · pitch $pitch · roll $roll 을 그대로 돌려준다", (p) => {
    const M = affine(p.yaw, p.pitch, p.roll, p.scale, p.t);
    for (const [data, layout] of [
      [colMajor(M), "col"],
      [rowMajor(M), "row"],
    ] as const) {
      const d = decomposeRaw(data, layout)!;
      expect(d.yaw).toBeCloseTo(p.yaw, 9);
      expect(d.pitch).toBeCloseTo(p.pitch, 9);
      expect(d.roll).toBeCloseTo(p.roll, 9);
      expect(d.scale).toBeCloseTo(p.scale, 9);
    }
  });

  it("yaw 20° 만 있는 행렬: yaw 20, pitch 0, roll 0 (손 계산: R02 = sin20°, R22 = cos20°)", () => {
    const c = Math.cos(deg(20));
    const s = Math.sin(deg(20));
    const M = [
      [c, 0, s, 1],
      [0, 1, 0, 2],
      [-s, 0, c, -40],
      [0, 0, 0, 1],
    ];
    const d = decomposeRaw(colMajor(M), "col")!;
    expect(d.yaw).toBeCloseTo(20, 12);
    expect(d.pitch).toBeCloseTo(0, 12);
    expect(d.roll).toBeCloseTo(0, 12);
  });

  it("decompose 는 decomposeRaw 에 SIGN 을 곱한 값", () => {
    const M = affine(20, -10, 5, 1, [3.5, 1.25, -52]);
    const raw = decomposeRaw(colMajor(M), "col")!;
    const signed = decompose(colMajor(M), "col")!;
    expect(signed.yaw).toBe(YAW_SIGN * raw.yaw);
    expect(signed.pitch).toBe(PITCH_SIGN * raw.pitch);
    expect(signed.roll).toBe(ROLL_SIGN * raw.roll);
    expect(signed.t).toEqual(raw.t);
  });

  it("잘못된 입력은 null", () => {
    expect(decomposeRaw([1, 2, 3], "col")).toBeNull();
    expect(decomposeRaw(colMajor(affine(0, 0, 0, 1, [0, 0, -40])), "diag" as never)).toBeNull();
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
    const d = decomposeRaw(colMajor(M), "col")!;
    expect(Number.isNaN(d.pitch)).toBe(false);
    expect(d.pitch).toBeCloseTo(90, 9);
    expect(Number.isFinite(d.yaw)).toBe(true);
    expect(Number.isFinite(d.roll)).toBe(true);

    // 반대쪽 끝도. Rx(−90°) = [[1,0,0],[0,0,1],[0,−1,0]] — R12 만 뒤집고 R21 을 두면
    // det = −1 인 반사가 되어 분해를 거부한다(아래 반사 테스트).
    M[1][2] = 1 + 1e-12;
    M[2][1] = -1;
    const e = decomposeRaw(colMajor(M), "col")!;
    expect(Number.isNaN(e.pitch)).toBe(false);
    expect(e.pitch).toBeCloseTo(-90, 9);
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

  it("전단(비대각 왜곡)도 orthoError 에 잡힌다: M01 = 0.3 → 첫·둘째 열 내적 0.3", () => {
    const M = affine(0, 0, 0, 1, [1, 2, -40]);
    M[0][1] = 0.3;
    // 열 c0 = (1,0,0), c1 = (0.3,1,0): c0·c1 = 0.3, |c1|² − 1 = 0.09 → 최대 0.3
    expect(decompose(colMajor(M), "col")!.orthoError).toBeCloseTo(0.3, 12);
  });

  it("orthoError 는 RᵀR(열끼리 내적)이지 RRᵀ(행끼리)가 아니다", () => {
    // R = [[1, a, 0], [0, 1, 0], [0, b, 1]], a = b = 0.6
    //   RᵀR − I: c1·c1 − 1 = a² + b² = 0.72, c0·c1 = a, c1·c2 = b → 최대 0.72
    //   RRᵀ − I: r0·r0 − 1 = a², r2·r2 − 1 = b², r0·r1 = a, r1·r2 = b, r0·r2 = ab → 최대 0.6
    const M = [
      [1, 0.6, 0, 1],
      [0, 1, 0, 2],
      [0, 0.6, 1, -40],
      [0, 0, 0, 1],
    ];
    expect(decompose(colMajor(M), "col")!.orthoError).toBeCloseTo(0.72, 12);
  });

  it("스케일은 첫 열의 길이다(첫 행이 아니다): yaw 30° 회전에서 x 열만 1.2배", () => {
    const M = affine(30, 0, 0, 1, [1, 2, -40]);
    for (let r = 0; r < 3; r++) M[r][0] *= 1.2;
    // 첫 열 = 1.2·(cos30, 0, −sin30) → 길이 1.2. 첫 행 길이는 √(1.44·cos²30 + sin²30) ≈ 1.153 으로 다르다.
    const firstRow = Math.hypot(M[0][0], M[0][1], M[0][2]);
    expect(Math.abs(firstRow - 1.2)).toBeGreaterThan(0.04);
    const d = decomposeRaw(colMajor(M), "col")!;
    expect(d.scale).toBeCloseTo(1.2, 12);
    // R = M/1.2: 둘째·셋째 열 길이² = 1/1.44 → 1 − 1/1.44
    expect(d.orthoError).toBeCloseTo(1 - 1 / 1.44, 12);
  });

  it("반사 행렬(det < 0)은 RᵀR = I 라 orthoError 로는 안 보이므로 null 로 거부한다", () => {
    const mirror = [
      [-1, 0, 0, 1],
      [0, 1, 0, 2],
      [0, 0, 1, -40],
      [0, 0, 0, 1],
    ];
    expect(detectLayout(colMajor(mirror))).toBe("col");
    expect(decomposeRaw(colMajor(mirror), "col")).toBeNull();
    expect(decompose(colMajor(mirror), "col")).toBeNull();
    expect(decompose(rowMajor(mirror), "row")).toBeNull();

    // 실제 자세에서 한 축만 뒤집은 경우(좌우 반전을 행렬 쪽에서 "고친" 결함)도 같다.
    const posed = affine(20, -10, 5, 1.5, [3.5, 1.25, -52]);
    for (let c = 0; c < 3; c++) posed[0][c] *= -1;
    expect(decompose(colMajor(posed), "col")).toBeNull();

    // 반사가 아닌 회전(det = +1)은 그대로 분해한다.
    expect(decompose(colMajor(affine(20, -10, 5, 1.5, [3.5, 1.25, -52])), "col")).not.toBeNull();
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
