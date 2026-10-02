/**
 * 보는 방향: 얼굴에서 본 카메라의 방향(단위 벡터).
 *
 *   v = Rᵀ · (−t / |t|)
 *
 * 얼굴 변환 행렬은 정규 얼굴 좌표를 카메라 좌표로 옮긴다(x_cam = s·R·x_face + t). 카메라는
 * 카메라 좌표의 원점에 있으므로, 얼굴 좌표에서 본 카메라의 방향은 Rᵀ·(0 − t) 를 정규화한 것이다.
 *
 * 왜 축별 각(yaw·pitch)의 차가 아닌가(PRD 5절): 축별 각은 카메라 축 기준이라, 얼굴이 화면에서
 * 옮겨 가면 값이 같아도 카메라가 보는 면이 달라진다. v 는
 *  - 카메라만 돌려 얼굴이 화면에서 옮겨 간 경우(M′ = Q·M)에 변하지 않고,
 *  - 화면 안에서 도는 기울기에도 변하지 않는다(광축 둘레 회전은 Q 의 한 경우다).
 * 각도 부호 규약(YAW_SIGN 등)과도 무관하다 — 두 방향 사이의 각만 쓴다.
 *
 * [추론, 검증 전] 행렬은 정해진 화각을 가정하고 만들어진다. 그 가정이 실제와 달라도 v 에서는
 * 지워질 것으로 보지만 얼굴 모델 내부를 확인한 것이 아니다(PRD 7절 "폰만 돌리기" 실험).
 *
 * 순수 함수다.
 */

import { at, decomposeRaw, detectLayout, type MatrixLayout } from "@/core/matrix";

export type Vec3 = readonly [number, number, number];

const RAD2DEG = 180 / Math.PI;

export interface ViewReading {
  /** 보는 방향(단위 벡터, 얼굴 좌표). */
  view: Vec3;
  /** 판별한 행렬 배치. */
  layout: MatrixLayout;
  /** R/s 가 직교에서 벗어난 정도(X1 의 재료). */
  orthoError: number;
  /** 참고용 축별 각(°). 부호 상수를 곱하기 전의 규약 값이고, 판정에는 쓰지 않는다. */
  yaw: number;
  pitch: number;
  roll: number;
}

/**
 * 16개 숫자에서 보는 방향을 구한다.
 *
 * 배치를 판별하지 못하거나, 분해하지 못하거나(스케일 0, 반사), 이동이 0에 가까워 방향을 정할 수
 * 없으면 null. 값을 지어내지 않는다.
 */
export function viewFromMatrix(data: ArrayLike<number>): ViewReading | null {
  const layout = detectLayout(data);
  if (layout === null) return null;
  const d = decomposeRaw(data, layout);
  if (d === null) return null;

  const tLen = Math.hypot(d.t[0], d.t[1], d.t[2]);
  if (!(tLen > 1e-9)) return null;
  const u: Vec3 = [-d.t[0] / tLen, -d.t[1] / tLen, -d.t[2] / tLen];

  // Rᵀ·u: R 의 (r, c) 원소는 M(r, c)/s. Rᵀ 의 i번째 행은 R 의 i번째 열이다.
  const out: number[] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    let sum = 0;
    for (let r = 0; r < 3; r++) sum += (at(data, r, i, layout) / d.scale) * u[r];
    out[i] = sum;
  }
  const n = Math.hypot(out[0], out[1], out[2]);
  if (!(n > 1e-9)) return null;

  return {
    view: [out[0] / n, out[1] / n, out[2] / n],
    layout,
    orthoError: d.orthoError,
    yaw: d.yaw,
    pitch: d.pitch,
    roll: d.roll,
  };
}

/**
 * 두 방향 사이의 각(°, 0~180).
 *
 * acos(내적)은 각이 작을 때 정밀도를 잃는다(0.001° 는 내적으로 1 − 1.5e−10). 그래서
 * atan2(|외적|, 내적)을 쓴다. 길이가 0 이거나 유한하지 않은 벡터는 NaN — 호출하는 쪽이
 * NaN 을 "가깝다"로 읽지 않게, 비교는 항상 `<= 기준` 꼴로 쓴다(NaN 은 거짓).
 */
export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  const cross = Math.hypot(cx, cy, cz);
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (!Number.isFinite(cross) || !Number.isFinite(dot)) return Number.NaN;
  if (cross === 0 && dot === 0) return Number.NaN;
  return Math.atan2(cross, dot) * RAD2DEG;
}

/**
 * 보는 방향의 좌우를 뒤집은 것(얼굴 좌표의 x 부호만 바꾼다).
 *
 * 반대쪽 사선을 찍었거나 좌우가 뒤집힌 사진이면, 기준 방향을 이렇게 뒤집었을 때 가까워진다(W10).
 * 사진을 뒤집는 데 쓰지 않는다 — 의심을 알리는 데만 쓴다.
 */
export function mirrorView(v: Vec3): Vec3 {
  return [-v[0], v[1], v[2]];
}

export interface TracePoint {
  /** 가로 축 각(°). 어느 쪽이 왼쪽인지는 각도 부호를 실기기로 확정하기 전이라 이름을 붙이지 않는다. */
  h: number;
  /** 세로 축 각(°). */
  v: number;
}

/**
 * 자취 그림용 2값. 정면에서 (0, 0)이고, 가로·세로로 얼마나 벗어났는지를 각으로 편다.
 *
 * 정규 얼굴은 +z 쪽을 본다. 정면이면 v ≈ (0, 0, 1). h = atan2(x, z), v = atan2(y, √(x²+z²)).
 */
export function viewToTrace(view: Vec3): TracePoint {
  return {
    h: Math.atan2(view[0], view[2]) * RAD2DEG,
    v: Math.atan2(view[1], Math.hypot(view[0], view[2])) * RAD2DEG,
  };
}

/** `viewToTrace` 의 역. 합성 시험과 기록 다시 읽기에서 쓴다. */
export function traceToView(p: TracePoint): Vec3 {
  const h = p.h / RAD2DEG;
  const v = p.v / RAD2DEG;
  return [Math.sin(h) * Math.cos(v), Math.sin(v), Math.cos(h) * Math.cos(v)];
}
