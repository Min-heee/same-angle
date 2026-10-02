/**
 * 시험용 합성 데이터. **앱 코드는 이 파일을 가져오지 않는다**(시험 파일만 가져온다).
 *
 * 여기서 만드는 것은 얼굴 사진이 아니라 숫자다: 손으로 정한 자세의 행렬, 손으로 놓은 점 배치,
 * 그 점들을 핀홀 카메라로 투영한 랜드마크. 얼굴 모델을 거치지 않으므로 **행렬·랜드마크 이후의
 * 계산만** 확인한다. 얼굴 모델이 실제 동영상에서 방향을 얼마나 정확히 재는지는 알 수 없다.
 *
 * 점 배치(`FACE_POINTS`)는 정규 얼굴 메시의 실제 좌표가 아니다. 사람 얼굴의 대략적인 치수(cm)를
 * 손으로 적은 것이고, 기준점 번호가 실제 얼굴의 그 자리에 찍히는지와는 무관하다.
 */

import type { NormPoint } from "@/core/face";
import { traceToView, type TracePoint } from "./direction";
import {
  ANCHOR_INDICES,
  ANCHOR_ORDER,
  SKIN_INDICES,
  type FaceReading,
  type FrameMeasurement,
  type FrameSize,
  type RawFace,
} from "./measure";
import { applySimilarity, fromParams, type Point } from "./similarity";

// ---------------------------------------------------------------------------
// 난수(시드 고정)

/** mulberry32. 시드가 같으면 같은 수열. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 표준 정규분포(박스–뮬러). */
export function gauss(rand: () => number): number {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export const uniform = (rand: () => number, lo: number, hi: number) => lo + (hi - lo) * rand();

// ---------------------------------------------------------------------------
// 회전과 행렬

export type M3 = number[][];
const rad = (d: number) => (d * Math.PI) / 180;

export function mul(a: M3, b: M3): M3 {
  return [0, 1, 2].map((r) => [0, 1, 2].map((c) => a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c]));
}
export function mulVec(a: M3, v: readonly number[]): [number, number, number] {
  return [0, 1, 2].map((r) => a[r][0] * v[0] + a[r][1] * v[1] + a[r][2] * v[2]) as [number, number, number];
}
export function Ry(d: number): M3 {
  const c = Math.cos(rad(d));
  const s = Math.sin(rad(d));
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ];
}
export function Rx(d: number): M3 {
  const c = Math.cos(rad(d));
  const s = Math.sin(rad(d));
  return [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c],
  ];
}
export function Rz(d: number): M3 {
  const c = Math.cos(rad(d));
  const s = Math.sin(rad(d));
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
}
export const I3: M3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** 회전 R, 균등 스케일 s, 이동 t 로 4×4 행렬 16개 숫자를 만든다. */
export function matrix16(R: M3, s: number, t: readonly number[], layout: "col" | "row" = "col"): number[] {
  const m = [
    [s * R[0][0], s * R[0][1], s * R[0][2], t[0]],
    [s * R[1][0], s * R[1][1], s * R[1][2], t[1]],
    [s * R[2][0], s * R[2][1], s * R[2][2], t[2]],
    [0, 0, 0, 1],
  ];
  const out: number[] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) out.push(layout === "col" ? m[j][i] : m[i][j]);
  return out;
}

// ---------------------------------------------------------------------------
// 합성 얼굴 점

/** 대략의 얼굴 점(cm). x 는 화면 오른쪽, y 는 위, z 는 카메라 쪽. 실제 메시 좌표가 아니다. */
export const FACE_POINTS: Record<number, [number, number, number]> = {
  [ANCHOR_INDICES.rightEyeOuter]: [-4.45, 2.66, 3.17],
  [ANCHOR_INDICES.rightEyeInner]: [-1.86, 2.59, 3.76],
  [ANCHOR_INDICES.leftEyeInner]: [1.86, 2.59, 3.76],
  [ANCHOR_INDICES.leftEyeOuter]: [4.45, 2.66, 3.17],
  168: [0, 3.0, 5.0],
  6: [0, 2.2, 5.3],
  197: [0, 1.3, 5.9],
  195: [0, 0.5, 6.5],
  5: [0, -0.3, 7.0],
  [ANCHOR_INDICES.subnasale]: [0, -2.0, 5.9],
  127: [-7.3, 2.6, -1.5],
  234: [-7.5, 0.6, -2.0],
  93: [-7.3, -1.0, -1.8],
  356: [7.3, 2.6, -1.5],
  454: [7.5, 0.6, -2.0],
  323: [7.3, -1.0, -1.8],
  [SKIN_INDICES.rightLowerLid]: [-3.1, 2.1, 3.6],
  [SKIN_INDICES.leftLowerLid]: [3.1, 2.1, 3.6],
  [SKIN_INDICES.noseTip]: [0, -1.1, 7.5],
  // 박스를 정하는 이마 위와 턱 끝.
  10: [0, 8.5, 3.5],
  152: [0, -9.0, 4.5],
};

export const LANDMARK_COUNT = 478;

export interface Pose {
  /** 얼굴 회전(정규 얼굴 → 카메라). */
  R: M3;
  /** 이동(cm). 카메라는 −z 를 본다. 얼굴은 z 가 음수인 곳에 있다. */
  t: [number, number, number];
  scale?: number;
}

/**
 * 합성 얼굴 점을 핀홀 카메라로 투영한 랜드마크(정규화 좌표)와 그 자세의 행렬.
 * 번호가 없는 점은 얼굴 가운데(콧등 근처)의 한 점으로 채운다 — 박스에 영향을 주지 않는다.
 */
export function syntheticFace(pose: Pose, frame: FrameSize, focalPx: number, layout: "col" | "row" = "col"): RawFace {
  const s = pose.scale ?? 1;
  const project = (p: readonly number[]): NormPoint => {
    const q = mulVec(pose.R, p).map((v, i) => s * v + pose.t[i]);
    const depth = -q[2];
    return {
      x: (frame.width / 2 + (focalPx * q[0]) / depth) / frame.width,
      y: (frame.height / 2 - (focalPx * q[1]) / depth) / frame.height,
    };
  };
  const filler = project([0, 1.0, 5.5]);
  const landmarks: NormPoint[] = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) landmarks.push(FACE_POINTS[i] ? project(FACE_POINTS[i]) : { ...filler });
  return { landmarks, matrix: matrix16(pose.R, s, pose.t, layout) };
}

// ---------------------------------------------------------------------------
// 합성 측정값(얼굴 읽기를 직접 만든다)

/** 기준점 배치(재는 픽셀, 눈 사이 거리 약 126px). `FACE_POINTS` 의 정면 투영을 20px/cm 로 옮긴 것. */
export const BASE_FRAME: FrameSize = { width: 720, height: 960 };
const PX_PER_CM = 20;

export function baseAnchors(): Point[] {
  return ANCHOR_ORDER.map((i) => {
    const p = FACE_POINTS[i];
    return { x: BASE_FRAME.width / 2 + p[0] * PX_PER_CM, y: BASE_FRAME.height / 2 - p[1] * PX_PER_CM };
  });
}

/** 기준점 배치의 눈 사이 거리(픽셀). */
export function eyeDistanceOf(anchors: readonly Point[]): number {
  const r = { x: (anchors[0].x + anchors[1].x) / 2, y: (anchors[0].y + anchors[1].y) / 2 };
  const l = { x: (anchors[2].x + anchors[3].x) / 2, y: (anchors[2].y + anchors[3].y) / 2 };
  return Math.hypot(r.x - l.x, r.y - l.y);
}

export interface SynthFaceOptions {
  /** 보는 방향 2값(°). */
  dir?: TracePoint;
  /** 화면 안에서 도는 기울기(°). 기준 배치를 화면 중심 둘레로 이만큼 돌린다. */
  rollDeg?: number;
  /** 얼굴 크기 배율(기준 배치 대비). */
  size?: number;
  /** 화면 속 자리 이동(픽셀). */
  shift?: Point;
  frame?: FrameSize;
  orthoError?: number;
  touchesEdge?: boolean;
  /** 기준점마다 더할 잡음(픽셀). */
  jitter?: (i: number) => Point;
}

/** 기준 배치에 닮음 변환을 걸어 얼굴 읽기를 만든다. 기울기·크기·자리는 심은 값 그대로다. */
export function synthFace(o: SynthFaceOptions = {}): FaceReading {
  const frame = o.frame ?? BASE_FRAME;
  const size = o.size ?? 1;
  const shift = o.shift ?? { x: 0, y: 0 };
  const c = { x: BASE_FRAME.width / 2, y: BASE_FRAME.height / 2 };
  // 화면 중심 둘레로 돌리고 키운 뒤, 이 화면의 중심 + shift 로 옮긴다.
  const rot = fromParams(o.rollDeg ?? 0, size, 0, 0);
  const place = (p: Point): Point => {
    const q = applySimilarity(rot, { x: p.x - c.x, y: p.y - c.y });
    return { x: q.x + frame.width / 2 + shift.x, y: q.y + frame.height / 2 + shift.y };
  };
  const anchors = baseAnchors().map((p, i) => {
    const q = place(p);
    const j = o.jitter?.(i);
    return j ? { x: q.x + j.x, y: q.y + j.y } : q;
  });
  // 얼굴 박스: 기준 배치에서 폭 15cm·높이 17.5cm, 중심은 화면 중심보다 0.25cm 아래.
  const bw = 15 * PX_PER_CM * size;
  const bh = 17.5 * PX_PER_CM * size;
  const bc = place({ x: c.x, y: c.y + 0.25 * PX_PER_CM });
  const short = Math.min(frame.width, frame.height);
  const box = { x: bc.x - bw / 2, y: bc.y - bh / 2, width: bw, height: bh };
  return {
    view: traceToView(o.dir ?? { h: 0, v: 0 }),
    orthoError: o.orthoError ?? 0,
    axes: { yaw: o.dir?.h ?? 0, pitch: o.dir?.v ?? 0, roll: o.rollDeg ?? 0 },
    frame,
    box,
    faceShortRatio: Math.min(bw, bh) / short,
    touchesEdge: o.touchesEdge ?? false,
    offset: { x: (bc.x - frame.width / 2) / short, y: (bc.y - frame.height / 2) / short },
    anchors,
    eyeDistancePx: eyeDistanceOf(anchors),
    sharpnessRect: box,
    skinPatch: null,
  };
}

export interface SynthFrameOptions extends SynthFaceOptions {
  timeSec: number;
  sharpness?: number | null;
  clipRatio?: number;
  meanLuma?: number;
  /** 얼굴을 읽지 못한 장면으로 만든다. */
  failure?: FrameMeasurement["faceFailure"];
}

export function synthFrame(o: SynthFrameOptions): FrameMeasurement {
  const time = { timeSec: o.timeSec, requestedTimeSec: o.timeSec, timeIsReported: false };
  if (o.failure) {
    return {
      ...time,
      faceCount: o.failure === "noFace" ? 0 : o.failure === "multipleFaces" ? 2 : 1,
      face: null,
      faceFailure: o.failure,
      sharpness: null,
      skin: null,
    };
  }
  return {
    ...time,
    faceCount: 1,
    face: synthFace(o),
    faceFailure: null,
    sharpness: o.sharpness === undefined ? 100 : o.sharpness,
    skin: { meanLuma: o.meanLuma ?? 128, clipRatio: o.clipRatio ?? 0 },
  };
}

// ---------------------------------------------------------------------------
// 합성 동영상(보는 방향의 궤적)

/**
 * PRD 3절의 찍는 방법: 3초 정지 뒤 십자 왕복(오른쪽·가운데·왼쪽·가운데·위·가운데·아래·가운데),
 * 한쪽 끝까지 `reachDeg`(기본 10°), 초당 `speed`(기본 10°). 기본값이면 11초.
 * 쉬는 자세는 (0, 0)이다.
 */
export function crossSweep(reachDeg = 10, speed = 10, holdSec = 3): { durationSec: number; at: (t: number) => TracePoint } {
  const leg = reachDeg / speed;
  const durationSec = holdSec + 8 * leg;
  const at = (t: number): TracePoint => {
    if (t <= holdSec) return { h: 0, v: 0 };
    const u = Math.min(t - holdSec, 8 * leg - 1e-12);
    const k = Math.floor(u / leg);
    const f = (u - k * leg) / leg;
    const out = k % 2 === 0 ? f : 1 - f;
    const amount = out * reachDeg;
    switch (Math.floor(k / 2)) {
      case 0:
        return { h: amount, v: 0 };
      case 1:
        return { h: -amount, v: 0 };
      case 2:
        return { h: 0, v: amount };
      default:
        return { h: 0, v: -amount };
    }
  };
  return { durationSec, at };
}
