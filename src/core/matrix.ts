/**
 * MediaPipe FaceLandmarker 의 얼굴 변환 행렬(4×4)을 읽고 각도로 분해한다.
 *
 * 왜 행렬인가(TECH-NOTES 4절): FaceLandmarker 결과에는 world 좌표가 없고, 정규화 이미지
 * 좌표로 각을 재면 화면비 때문에 틀어진다. 행렬은
 * 정규 얼굴 모델(cm)에서 현재 얼굴로 가는 회전·균등 스케일·이동이다.
 *
 * 이 모듈에서 확신하지 못하는 것 두 가지는 **값이 아니라 판별·상수로** 남긴다.
 *  1. 16개 숫자의 배치(열 우선/행 우선). 소스(matrix.cc)는 열 우선이라고 읽히지만 JS
 *     바인딩을 거친 뒤에도 그런지는 실기기로 확인 전이다. 그래서 가정하지 않고
 *     `detectLayout` 이 아핀 행렬의 마지막 행(0,0,0,1)이 어디 있는지로 판별한다.
 *  2. yaw·pitch·roll 의 부호. 아래 SIGN 상수 세 개에만 둔다. D1 실측 픽스처(자기 왼쪽
 *     20° 등)로 확정하고, 틀렸으면 이 세 줄만 바꾼다.
 *
 * 순수 함수다. DOM·카메라·시계를 부르지 않는다.
 */

/** [추론] 규약 R = Ry·Rx·Rz 에서 나온 yaw 에 곱하는 부호. D1 픽스처로 확정 전. */
export const YAW_SIGN = 1;
/** [추론] 같은 규약의 pitch 부호. D1 픽스처로 확정 전. */
export const PITCH_SIGN = 1;
/** [추론] 같은 규약의 roll 부호. D1 픽스처로 확정 전. */
export const ROLL_SIGN = 1;

export type MatrixLayout = "col" | "row";

/**
 * 배치 판별 허용치.
 *
 * 마지막 행은 이론상 정확히 0,0,0,1 이지만 float32 를 거쳐 오므로 약간의 여유를 둔다.
 * 반대로 이동값(cm)은 얼굴이 카메라 앞 수십 cm 에 있으면 0 에서 한참 멀다. 이 허용치보다
 * 작은 이동은 "0으로 보인다"로 취급해, 그런 입력은 배치를 판별할 수 없다고 답한다.
 */
export const LAYOUT_EPS = 1e-4;

function isFiniteArray16(data: ArrayLike<number>): boolean {
  if (data == null || data.length !== 16) return false;
  for (let i = 0; i < 16; i++) {
    if (typeof data[i] !== "number" || !Number.isFinite(data[i])) return false;
  }
  return true;
}

const near = (v: number, target: number) => Math.abs(v - target) <= LAYOUT_EPS;

/**
 * 16개 숫자가 열 우선인지 행 우선인지 판별한다.
 *
 * 4×4 아핀 행렬의 마지막 행은 (0,0,0,1)이다.
 *  - 열 우선(data[c*4+r]): 마지막 행 = data[3], data[7], data[11], data[15]. 이동 = data[12..14].
 *  - 행 우선(data[r*4+c]): 마지막 행 = data[12], data[13], data[14], data[15]. 이동 = data[3], data[7], data[11].
 *
 * 한쪽만 맞으면 그 배치다. 둘 다 맞으면(이동이 전부 0에 가까움) 둘 다 틀리면(아핀이 아님)
 * 알 수 없으므로 null 을 돌려준다 — 추측해서 하나를 고르지 않는다.
 */
export function detectLayout(data: ArrayLike<number>): MatrixLayout | null {
  if (!isFiniteArray16(data)) return null;
  const colOk = near(data[3], 0) && near(data[7], 0) && near(data[11], 0) && near(data[15], 1);
  const rowOk = near(data[12], 0) && near(data[13], 0) && near(data[14], 0) && near(data[15], 1);
  if (colOk && !rowOk) return "col";
  if (rowOk && !colOk) return "row";
  return null;
}

/** (r, c) 원소. r·c 는 0~3. */
export function at(data: ArrayLike<number>, r: number, c: number, layout: MatrixLayout): number {
  return layout === "col" ? data[c * 4 + r] : data[r * 4 + c];
}

export interface Decomposed {
  /** 도(°). 부호는 YAW_SIGN 을 곱한 값. */
  yaw: number;
  pitch: number;
  roll: number;
  /** 균등 스케일 = ‖첫 열‖. */
  scale: number;
  /** 이동(정규 얼굴 모델 단위, 명목 cm). */
  t: [number, number, number];
  /**
   * R = M3/s 가 직교 행렬에서 얼마나 벗어났는가: max |RᵀR − I| 원소.
   * H1 "R/s 가 직교에서 허용치 이상 벗어남"의 재료다. 허용치는 여기서 정하지 않는다.
   */
  orthoError: number;
}

const RAD2DEG = 180 / Math.PI;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 행렬을 yaw·pitch·roll(도)·스케일·이동으로 분해한다.
 *
 * s = ‖첫 열‖ 로 나눠 스케일을 걷어 낸 뒤, R = Ry(yaw)·Rx(pitch)·Rz(roll) 규약으로
 *   R12 = −sin(pitch)            → pitch = asin(−R12)
 *   R02 = sin(yaw)·cos(pitch),  R22 = cos(yaw)·cos(pitch) → yaw  = atan2(R02, R22)
 *   R10 = cos(pitch)·sin(roll), R11 = cos(pitch)·cos(roll) → roll = atan2(R10, R11)
 *
 * asin 입력은 [−1, 1]로 클램프한다. float 오차로 |R12| 가 1을 아주 조금 넘으면 NaN 이
 * 나오고, NaN 은 이후 모든 비교를 조용히 거짓으로 만든다.
 *
 * 길이 ≠ 16, 비유한 값, 스케일이 0에 가까운 입력은 null. 0으로 채워 계속하지 않는다.
 */
export function decompose(data: ArrayLike<number>, layout: MatrixLayout): Decomposed | null {
  if (!isFiniteArray16(data)) return null;
  if (layout !== "col" && layout !== "row") return null;

  const m = (r: number, c: number) => at(data, r, c, layout);

  const s = Math.hypot(m(0, 0), m(1, 0), m(2, 0));
  if (!(s > 1e-9)) return null;

  const R: number[][] = [0, 1, 2].map((r) => [0, 1, 2].map((c) => m(r, c) / s));

  // RᵀR − I 의 최대 절대 원소. 균등 스케일이 아니거나 전단이 섞이면 커진다.
  let orthoError = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let dot = 0;
      for (let k = 0; k < 3; k++) dot += R[k][i] * R[k][j];
      orthoError = Math.max(orthoError, Math.abs(dot - (i === j ? 1 : 0)));
    }
  }

  const pitch = Math.asin(clamp(-R[1][2], -1, 1)) * RAD2DEG;
  const yaw = Math.atan2(R[0][2], R[2][2]) * RAD2DEG;
  const roll = Math.atan2(R[1][0], R[1][1]) * RAD2DEG;

  return {
    yaw: YAW_SIGN * yaw,
    pitch: PITCH_SIGN * pitch,
    roll: ROLL_SIGN * roll,
    scale: s,
    t: [m(0, 3), m(1, 3), m(2, 3)],
    orthoError,
  };
}

/**
 * 여러 행렬의 원소별 중앙값(자세 픽스처용). 각 행렬은 16개 유한 값이어야 한다.
 *
 * 원소별 중앙값은 회전 행렬이 아닐 수 있다. 1초 동안 거의 정지한 자세의 튀는 프레임을
 * 걸러 내는 용도이고, 분해 결과의 orthoError 로 얼마나 벗어났는지 함께 본다.
 */
export function elementwiseMedian(matrices: readonly ArrayLike<number>[]): number[] | null {
  if (matrices.length === 0) return null;
  for (const m of matrices) if (!isFiniteArray16(m)) return null;
  const out: number[] = [];
  for (let i = 0; i < 16; i++) {
    const col = matrices.map((m) => m[i]).sort((a, b) => a - b);
    const n = col.length;
    out.push(n % 2 === 1 ? col[(n - 1) / 2] : (col[n / 2 - 1] + col[n / 2]) / 2);
  }
  return out;
}
