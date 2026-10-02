/**
 * 장면 하나(또는 기준 사진)의 측정값: 타입과, 얼굴 모델 출력에서 그 값을 만드는 순수 함수.
 *
 * 흐름(접착부 `glue/measure.ts` 가 따른다):
 *   1. 얼굴 모델 출력(얼굴마다 랜드마크 + 4×4 행렬) → `readFaces` → 얼굴 읽기 또는 실패 사유
 *   2. 얼굴 읽기가 알려 주는 두 영역(`sharpnessRect`, `skinPatch`)만 캔버스에서 다시 뽑아
 *      `core/pixels` 로 선명도·휘도·클리핑을 잰다
 *   3. `toMeasurement` 로 묶는다
 *
 * 좌표는 전부 **재는 캔버스의 픽셀**(긴 변 960px)이다. 정규화 좌표는 x·y 의 단위가 달라
 * 회전과 거리가 틀어지므로 여기서 한 번 픽셀로 바꾸고 다시 쓰지 않는다.
 *
 * 기준점(anchors)과 얼굴 박스 좌표는 이 값 안에만 있고 **기록(JSON)에는 들어가지 않는다**.
 *
 * 순수 함수다. 캔버스·얼굴 모델을 부르지 않는다.
 */

import { faceBox, type NormPoint } from "@/core/face";
import { viewFromMatrix, type Vec3 } from "./direction";
import { RULES, type Rules } from "./rules";
import type { Point } from "./similarity";

export interface FrameSize {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 기준점으로 쓰는 랜드마크 번호(MediaPipe Face Mesh 478점 기준) [가정].
 *
 * 표정과 머리카락에 덜 움직이는 점만 쓴다(PRD 5절): 두 눈의 눈머리·눈꼬리, 콧등 중심선, 코 밑,
 * 광대 높이의 얼굴 가장자리. **이마 위쪽·헤어라인·눈썹·입·턱은 쓰지 않는다** — 헤어라인 근처
 * 점은 보려는 변화(헤어라인)와 섞일 수 있다.
 *
 * 번호는 공개된 메시 배치를 기억으로 옮긴 것이고, 실제 얼굴에서 이 점들이 어디에 찍히는지는
 * 아직 눈으로 확인하지 못했다(실제 얼굴 동영상 검증 전). 틀렸으면 이 표만 고친다.
 */
export const ANCHOR_INDICES = {
  /** 찍히는 사람의 오른쪽 눈(화면 왼쪽): 눈꼬리, 눈머리. */
  rightEyeOuter: 33,
  rightEyeInner: 133,
  /** 찍히는 사람의 왼쪽 눈: 눈머리, 눈꼬리. */
  leftEyeInner: 362,
  leftEyeOuter: 263,
  /** 콧등 중심선(미간 아래에서 코끝 위까지). 코끝은 가장 튀어나와 각도에 민감해서 뺐다. */
  bridge: [168, 6, 197, 195, 5],
  /** 코 밑. */
  subnasale: 2,
  /** 광대 높이의 얼굴 가장자리(오른쪽 3점, 왼쪽 3점). */
  faceEdge: [127, 234, 93, 356, 454, 323],
} as const;

/** 기준점 번호를 한 줄로. 순서가 곧 기준 사진과 장면 사이의 짝이다. */
export const ANCHOR_ORDER: readonly number[] = [
  ANCHOR_INDICES.rightEyeOuter,
  ANCHOR_INDICES.rightEyeInner,
  ANCHOR_INDICES.leftEyeInner,
  ANCHOR_INDICES.leftEyeOuter,
  ...ANCHOR_INDICES.bridge,
  ANCHOR_INDICES.subnasale,
  ...ANCHOR_INDICES.faceEdge,
];

/** 피부 패치를 잡는 데만 쓰는 점: 아래 눈꺼풀 가운데(오른쪽·왼쪽), 코끝. 기준점은 아니다. */
export const SKIN_INDICES = { rightLowerLid: 145, leftLowerLid: 374, noseTip: 1 } as const;

/** 랜드마크 배열이 적어도 이만큼은 있어야 위 번호를 읽을 수 있다. */
export const MIN_LANDMARKS = 455;

/**
 * 피부 패치: 눈 밑에서 코끝 높이까지, 두 눈꼬리 사이의 안쪽(뺨 위쪽·콧등·눈 밑).
 * 이마·머리카락·배경이 들어오지 않게 눈 아래로만 잡고, 고개가 기울어도 얼굴을 따라 돌게
 * 눈꼬리를 잇는 선에 맞춘 **기울어진 사각형**으로 둔다 [가정].
 */
export interface SkinPatch {
  /** 사각형 중심(픽셀). */
  cx: number;
  cy: number;
  /** 가로 축의 단위 벡터(오른쪽 눈꼬리 → 왼쪽 눈꼬리). 세로 축은 이것을 90° 돌린 (−uy, ux) 또는 그 반대. */
  ux: number;
  uy: number;
  /** 세로 축의 단위 벡터(눈 → 코끝 쪽). */
  vx: number;
  vy: number;
  halfWidth: number;
  halfHeight: number;
}

/** 얼굴이 정확히 하나이고 행렬·랜드마크를 읽었을 때의 값. */
export interface FaceReading {
  /** 보는 방향(단위 벡터). 각도차의 재료. */
  view: Vec3;
  /** R/s 가 직교에서 벗어난 정도. X1 의 재료. */
  orthoError: number;
  /** 참고용 축별 각(°, 부호 상수를 곱하기 전). 판정에 쓰지 않는다. */
  axes: { yaw: number; pitch: number; roll: number };
  /** 재는 캔버스의 크기(픽셀). */
  frame: FrameSize;
  /** 얼굴 박스(픽셀). 전체 랜드마크의 바깥 사각형. */
  box: Rect;
  /** 얼굴 박스 짧은 변 ÷ 화면 짧은 변. X2 와 틀 배율 f 의 재료. */
  faceShortRatio: number;
  /** 얼굴 박스가 화면 가장자리 여백 안으로 들어갔는가. X2 의 재료. */
  touchesEdge: boolean;
  /** 얼굴 박스 중심이 **화면 중심**에서 벗어난 벡터 ÷ 화면 짧은 변. 위치 차 p 의 재료. */
  offset: Point;
  /** 기준점(픽셀, `ANCHOR_ORDER` 순서). */
  anchors: Point[];
  /** 두 눈 중심 사이의 거리(픽셀). 남는 오차·퍼짐의 단위. */
  eyeDistancePx: number;
  /** 선명도를 잴 영역: 얼굴 박스를 화면 안으로 자른 것. */
  sharpnessRect: Rect;
  /** 노출·밝기를 잴 영역. 화면 밖으로 나가거나 잡을 수 없으면 null. */
  skinPatch: SkinPatch | null;
}

export type FaceFailure = "noFace" | "multipleFaces" | "matrixUnreadable" | "landmarksUnreadable";

/** 얼굴 모델이 얼굴 하나에 대해 주는 것. */
export interface RawFace {
  /** 정규화 랜드마크(x÷폭, y÷높이). */
  landmarks: readonly NormPoint[];
  /** 얼굴 변환 행렬 16개 숫자. 모델이 주지 않았으면 null. */
  matrix: ArrayLike<number> | null;
}

export type FacesReading =
  | { ok: true; faceCount: 1; face: FaceReading }
  | { ok: false; faceCount: number; failure: FaceFailure };

/** 기준 사진과 장면이 함께 쓰는 측정값. */
export interface Measured {
  /** 얼굴 모델이 찾은 얼굴 수. */
  faceCount: number;
  face: FaceReading | null;
  /** 얼굴을 읽지 못한 이유. 읽었으면 null. */
  faceFailure: FaceFailure | null;
  /** 얼굴 박스를 긴 변 256px 로 다시 뽑아 잰 라플라시안 분산. 재지 못했으면 null. */
  sharpness: number | null;
  /** 피부 패치(128×128)의 평균 휘도와 클리핑 비율. 재지 못했으면 null. */
  skin: { meanLuma: number; clipRatio: number } | null;
}

/** 동영상 장면의 측정값. */
export interface FrameMeasurement extends Measured {
  /** 브라우저가 실제로 보여 준 장면의 시각(초). 알 수 없으면 요청한 시각과 같다. */
  timeSec: number;
  /** 탐색을 요청한 시각(초). */
  requestedTimeSec: number;
  /** `timeSec` 이 브라우저가 알려 준 값인가(`mediaTime`), 요청한 값을 그대로 적은 것인가. */
  timeIsReported: boolean;
}

function px(landmarks: readonly NormPoint[], index: number, frame: FrameSize): Point | null {
  const p = landmarks[index];
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { x: p.x * frame.width, y: p.y * frame.height };
}

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

function clipRect(r: Rect, frame: FrameSize): Rect {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(frame.width, r.x + r.width);
  const y1 = Math.min(frame.height, r.y + r.height);
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

/** 피부 패치의 네 꼭짓점(픽셀). */
export function skinPatchCorners(p: SkinPatch): Point[] {
  const out: Point[] = [];
  for (const [su, sv] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    out.push({
      x: p.cx + su * p.halfWidth * p.ux + sv * p.halfHeight * p.vx,
      y: p.cy + su * p.halfWidth * p.uy + sv * p.halfHeight * p.vy,
    });
  }
  return out;
}

/** 두 눈꼬리 사이 거리 가운데 패치 폭으로 쓰는 비율(가운데 80%). */
const SKIN_WIDTH_RATIO = 0.8;
/** 아래 눈꺼풀에서 코끝까지의 거리 가운데, 위에서 이만큼은 건너뛴다(속눈썹·눈 그늘). */
const SKIN_TOP_SKIP = 0.15;

function skinPatchOf(landmarks: readonly NormPoint[], frame: FrameSize): SkinPatch | null {
  const outerR = px(landmarks, ANCHOR_INDICES.rightEyeOuter, frame);
  const outerL = px(landmarks, ANCHOR_INDICES.leftEyeOuter, frame);
  const lidR = px(landmarks, SKIN_INDICES.rightLowerLid, frame);
  const lidL = px(landmarks, SKIN_INDICES.leftLowerLid, frame);
  const tip = px(landmarks, SKIN_INDICES.noseTip, frame);
  if (!outerR || !outerL || !lidR || !lidL || !tip) return null;

  const span = dist(outerR, outerL);
  if (!(span > 1)) return null;
  const ux = (outerL.x - outerR.x) / span;
  const uy = (outerL.y - outerR.y) / span;

  const lidMid = mid(lidR, lidL);
  // 세로 축: 가로 축에 수직이고 코끝 쪽을 향하는 방향.
  let vx = -uy;
  let vy = ux;
  let down = (tip.x - lidMid.x) * vx + (tip.y - lidMid.y) * vy;
  if (down < 0) {
    vx = -vx;
    vy = -vy;
    down = -down;
  }
  if (!(down > 1)) return null;

  const halfHeight = (down * (1 - SKIN_TOP_SKIP)) / 2;
  const centerDown = down * SKIN_TOP_SKIP + halfHeight;
  const patch: SkinPatch = {
    cx: lidMid.x + centerDown * vx,
    cy: lidMid.y + centerDown * vy,
    ux,
    uy,
    vx,
    vy,
    halfWidth: (span * SKIN_WIDTH_RATIO) / 2,
    halfHeight,
  };
  // 화면 밖으로 나간 부분은 캔버스가 검게(휘도 0) 채워 클리핑으로 세어진다. 그런 패치는 재지 않는다.
  for (const c of skinPatchCorners(patch)) {
    if (c.x < 0 || c.y < 0 || c.x > frame.width || c.y > frame.height) return null;
  }
  return patch;
}

/**
 * 피부 패치를 `size`×`size` 캔버스에 펴 그릴 때 `setTransform` 에 넘길 6개 숫자
 * (재는 캔버스 좌표 → 패치 캔버스 좌표). 가로·세로 배율이 달라도 된다 — 통계만 내는 영역이라
 * 모양이 찌그러져도 평균 휘도와 클리핑 비율은 그대로다. **출력 사진에는 쓰지 않는다.**
 */
export function skinPatchToCanvas(p: SkinPatch, size: number): [number, number, number, number, number, number] {
  const sx = size / (2 * p.halfWidth);
  const sy = size / (2 * p.halfHeight);
  // 패치 좌표 (α, β) = ((q − c)·u, (q − c)·v), 캔버스 좌표 = ((α + halfW)·sx, (β + halfH)·sy).
  const a = sx * p.ux;
  const c = sx * p.uy;
  const b = sy * p.vx;
  const d = sy * p.vy;
  const e = sx * (p.halfWidth - (p.cx * p.ux + p.cy * p.uy));
  const f = sy * (p.halfHeight - (p.cx * p.vx + p.cy * p.vy));
  return [a, b, c, d, e, f];
}

/**
 * 얼굴 모델 출력에서 얼굴 읽기를 만든다.
 *
 * 얼굴이 없거나 둘 이상이면, 행렬을 읽지 못하면, 랜드마크가 모자라거나 유한하지 않으면
 * 값을 지어내지 않고 실패 사유를 돌려준다. 직교 오차·크기·가장자리 같은 **문턱은 여기서 보지
 * 않는다**(exclude.ts). 여기서는 읽을 수 있는지만 본다.
 */
export function readFaces(faces: readonly RawFace[], frame: FrameSize, rules: Rules = RULES): FacesReading {
  if (faces.length === 0) return { ok: false, faceCount: 0, failure: "noFace" };
  if (faces.length > 1) return { ok: false, faceCount: faces.length, failure: "multipleFaces" };
  const { landmarks, matrix } = faces[0];

  const reading = matrix === null ? null : viewFromMatrix(matrix);
  if (reading === null) return { ok: false, faceCount: 1, failure: "matrixUnreadable" };

  const fail: FacesReading = { ok: false, faceCount: 1, failure: "landmarksUnreadable" };
  if (!(frame.width > 0) || !(frame.height > 0)) return fail;
  if (landmarks.length < MIN_LANDMARKS) return fail;

  const short = Math.min(frame.width, frame.height);
  const box = faceBox(landmarks, frame.width, frame.height, short * rules.exclude.edgeMarginRatio);
  if (box === null || !(box.width > 0) || !(box.height > 0)) return fail;

  const anchors: Point[] = [];
  for (const i of ANCHOR_ORDER) {
    const p = px(landmarks, i, frame);
    if (p === null) return fail;
    anchors.push(p);
  }
  // ANCHOR_ORDER 의 앞 네 점이 눈꼬리·눈머리·눈머리·눈꼬리다.
  const eyeDistancePx = dist(mid(anchors[0], anchors[1]), mid(anchors[2], anchors[3]));
  if (!(eyeDistancePx > 0)) return fail;

  const rect: Rect = { x: box.minX, y: box.minY, width: box.width, height: box.height };
  return {
    ok: true,
    faceCount: 1,
    face: {
      view: reading.view,
      orthoError: reading.orthoError,
      axes: { yaw: reading.yaw, pitch: reading.pitch, roll: reading.roll },
      frame: { width: frame.width, height: frame.height },
      box: rect,
      faceShortRatio: box.shortSideRatio,
      touchesEdge: box.touchesEdge,
      offset: { x: (box.cx - frame.width / 2) / short, y: (box.cy - frame.height / 2) / short },
      anchors,
      eyeDistancePx,
      sharpnessRect: clipRect(rect, frame),
      skinPatch: skinPatchOf(landmarks, frame),
    },
  };
}

function finiteOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 얼굴 읽기와 픽셀 지표를 측정값으로 묶는다. 유한하지 않은 픽셀 지표는 null("재지 못함")로 적는다. */
export function toMeasured(
  reading: FacesReading,
  pixels: { sharpness: number | null; skin: { meanLuma: number; clipRatio: number } | null },
): Measured {
  const skin =
    pixels.skin && Number.isFinite(pixels.skin.meanLuma) && Number.isFinite(pixels.skin.clipRatio)
      ? { meanLuma: pixels.skin.meanLuma, clipRatio: pixels.skin.clipRatio }
      : null;
  if (!reading.ok) {
    return { faceCount: reading.faceCount, face: null, faceFailure: reading.failure, sharpness: null, skin: null };
  }
  return { faceCount: 1, face: reading.face, faceFailure: null, sharpness: finiteOrNull(pixels.sharpness), skin };
}

/** 장면 측정값. `reportedTimeSec` 은 브라우저가 알려 준 실제 장면 시각이고, 없으면 null 을 넘긴다. */
export function toFrameMeasurement(
  measured: Measured,
  requestedTimeSec: number,
  reportedTimeSec: number | null,
): FrameMeasurement {
  const reported = finiteOrNull(reportedTimeSec);
  return {
    ...measured,
    timeSec: reported ?? requestedTimeSec,
    requestedTimeSec,
    timeIsReported: reported !== null,
  };
}
