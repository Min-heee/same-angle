/**
 * 닮음 변환(회전·균등 확대·이동)만 다룬다. 뒤집기·찌그러뜨리기·원근은 **표현할 수 없다**.
 *
 * 변환을 숫자 네 개(a, b, tx, ty)로 둔다.
 *
 *   x′ = a·x − b·y + tx
 *   y′ = b·x + a·y + ty        (a = s·cosθ, b = s·sinθ)
 *
 * 이 꼴은 어떤 값을 넣어도 직교·균등 배율·뒤집기 없음이다(행렬식 = a² + b² > 0). 일반 2×3
 * 아핀으로 두고 "닮음인지 검사"하는 대신, 닮음이 아닌 것을 만들 수 없게 했다(PRD F17: 사진을
 * 지어내지 않는다). 캔버스에 넘기는 6개 숫자는 `toCanvasTransform` 한 곳에서만 만든다.
 *
 * 좌표는 **픽셀**이어야 한다. 정규화 좌표(x÷폭, y÷높이)는 두 축의 단위가 달라 회전이 틀어진다.
 * 이미지 좌표는 y 가 아래로 자라므로 θ 의 부호는 화면에서 시계 방향이 양이다. 판정에는 |θ| 만 쓴다.
 *
 * 순수 함수다.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Similarity {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

const RAD2DEG = 180 / Math.PI;

export const IDENTITY: Similarity = { a: 1, b: 0, tx: 0, ty: 0 };

/** 균등 배율(> 0). */
export function scaleOf(t: Similarity): number {
  return Math.hypot(t.a, t.b);
}

/** 회전 θ(°, −180~180]. */
export function rotationDegOf(t: Similarity): number {
  return Math.atan2(t.b, t.a) * RAD2DEG;
}

export function applySimilarity(t: Similarity, p: Point): Point {
  return { x: t.a * p.x - t.b * p.y + t.tx, y: t.b * p.x + t.a * p.y + t.ty };
}

/** `outer ∘ inner`: inner 를 먼저, outer 를 나중에 적용한 변환. */
export function compose(outer: Similarity, inner: Similarity): Similarity {
  return {
    a: outer.a * inner.a - outer.b * inner.b,
    b: outer.b * inner.a + outer.a * inner.b,
    tx: outer.a * inner.tx - outer.b * inner.ty + outer.tx,
    ty: outer.b * inner.tx + outer.a * inner.ty + outer.ty,
  };
}

/** 역변환. 배율이 0 이면 null. */
export function invert(t: Similarity): Similarity | null {
  const d = t.a * t.a + t.b * t.b;
  if (!(d > 0) || !Number.isFinite(d)) return null;
  const a = t.a / d;
  const b = -t.b / d;
  return { a, b, tx: -(a * t.tx - b * t.ty), ty: -(b * t.tx + a * t.ty) };
}

/** 원점 기준 균등 확대. 재는 크기(긴 변 960px)와 원본·출력 크기 사이를 오갈 때 쓴다. */
export function uniformScale(k: number): Similarity {
  return { a: k, b: 0, tx: 0, ty: 0 };
}

/** 회전(°)·배율·이동으로 직접 만든다. 합성 시험에서 참값을 심을 때 쓴다. */
export function fromParams(rotationDeg: number, scale: number, tx: number, ty: number): Similarity {
  const r = rotationDeg / RAD2DEG;
  return { a: scale * Math.cos(r), b: scale * Math.sin(r), tx, ty };
}

/**
 * 캔버스 `setTransform(a, b, c, d, e, f)` 에 넘길 6개 숫자.
 * 캔버스의 정의는 x′ = a·x + c·y + e, y′ = b·x + d·y + f 이므로 (a, b, −b, a, tx, ty).
 * **원본 좌표 → 출력 좌표** 방향이다(그릴 때 역변환을 넘기면 반대로 돈다).
 */
export function toCanvasTransform(t: Similarity): [number, number, number, number, number, number] {
  return [t.a, t.b, -t.b, t.a, t.tx, t.ty];
}

/**
 * 6개 숫자가 닮음 변환인지: 두 열이 직교하고 길이가 같고 행렬식이 양수(뒤집기 없음).
 * `toCanvasTransform` 의 출력을 시험이 독립적으로 확인하는 데 쓴다.
 */
export function isSimilarityMatrix(m: readonly number[], eps = 1e-9): boolean {
  if (m.length !== 6 || !m.every((v) => Number.isFinite(v))) return false;
  const [a, b, c, d] = m;
  const len1 = Math.hypot(a, b);
  const len2 = Math.hypot(c, d);
  if (!(len1 > 0) || !(len2 > 0)) return false;
  const scale = Math.max(len1, len2);
  if (Math.abs(a * c + b * d) > eps * scale * scale) return false;
  if (Math.abs(len1 - len2) > eps * scale) return false;
  return a * d - b * c > 0;
}

function centroid(ps: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of ps) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ps.length, y: y / ps.length };
}

function allFinite(ps: readonly Point[]): boolean {
  return ps.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

/**
 * `from` 의 점들을 `to` 의 점들에 겹치는 닮음 변환(최소제곱, 뒤집기 없음).
 *
 * 무게중심을 뺀 점 p′, q′ 에 대해
 *   A = Σ p′·q′(내적),  B = Σ p′×q′(외적: pₓ·q_y − p_y·qₓ),  D = Σ|p′|²
 *   a = A/D,  b = B/D,  t = q̄ − (a, b)·p̄
 * 복소수로 쓰면 z = Σ conj(p′)·q′ / Σ|p′|² 이고, 이 해는 회전·균등 배율 안에서의 최소제곱 해다.
 * 반사는 해 공간에 없으므로 좌우가 뒤집힌 입력을 넣어도 뒤집어서 맞추지 않는다(남는 오차가 커진다).
 *
 * 점이 2개 미만이거나, 개수가 다르거나, 유한하지 않거나, `from` 이 한 점에 몰려 있거나(D ≈ 0),
 * 해의 배율이 0 이면 null.
 */
export function fitSimilarity(from: readonly Point[], to: readonly Point[]): Similarity | null {
  if (from.length !== to.length || from.length < 2) return null;
  if (!allFinite(from) || !allFinite(to)) return null;
  const pc = centroid(from);
  const qc = centroid(to);
  let A = 0;
  let B = 0;
  let D = 0;
  for (let i = 0; i < from.length; i++) {
    const px = from[i].x - pc.x;
    const py = from[i].y - pc.y;
    const qx = to[i].x - qc.x;
    const qy = to[i].y - qc.y;
    A += px * qx + py * qy;
    B += px * qy - py * qx;
    D += px * px + py * py;
  }
  if (!(D > 1e-12)) return null;
  const a = A / D;
  const b = B / D;
  if (!(Math.hypot(a, b) > 1e-12)) return null;
  return { a, b, tx: qc.x - (a * pc.x - b * pc.y), ty: qc.y - (b * pc.x + a * pc.y) };
}

/** 변환한 `from` 과 `to` 사이 거리의 RMS(픽셀, `to` 쪽 눈금). */
export function residualRms(t: Similarity, from: readonly Point[], to: readonly Point[]): number {
  if (from.length !== to.length || from.length === 0) return Number.NaN;
  let ss = 0;
  for (let i = 0; i < from.length; i++) {
    const p = applySimilarity(t, from[i]);
    ss += (p.x - to[i].x) ** 2 + (p.y - to[i].y) ** 2;
  }
  return Math.sqrt(ss / from.length);
}

/**
 * 퍼짐 Σr²: 점들이 무게중심에서 떨어진 거리의 제곱합을 `unit`(눈 사이 거리, 픽셀)의 제곱으로 나눈 값.
 *
 * 좌표 잡음이 σ(눈 사이 거리 단위)일 때 회전(라디안)·배율 오차의 표준편차가 σ/√Σr² 이므로
 * (PRD 7절), 이 값이 작으면 맞춤이 흔들린다. 두 눈만 쓰면 0.5 다.
 */
export function spreadOf(points: readonly Point[], unit: number): number {
  if (points.length === 0 || !(unit > 0)) return Number.NaN;
  const c = centroid(points);
  let ss = 0;
  for (const p of points) ss += (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
  return ss / (unit * unit);
}
