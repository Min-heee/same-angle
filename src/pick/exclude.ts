/**
 * 후보에서 빼는 조건 X1~X4(PRD 5절).
 *
 *  X1  얼굴이 없거나 둘 이상, 행렬·랜드마크를 읽을 수 없음, 직교에서 벗어남
 *  X2  얼굴 박스가 화면 가장자리에 걸리거나 너무 작음
 *  X3  흔들림: 선명도가 (거친 훑기에서 X1·X2 를 통과한 장면들의 중앙값 × 0.5) 미만
 *  X4  노출 사고: 피부 패치의 클리핑 비율 5% 초과
 *
 * 한 장면에는 표의 순서대로 **처음 걸린 조건 하나**만 붙인다(사유별로 세기 위해서).
 *
 * 재지 못한 값은 통과시키지 않는다. 선명도를 재지 못한 장면은 X3, 피부 패치를 재지 못한 장면은
 * X4 로 빼고, 사유(reason)에 "재지 못함"이라고 따로 적는다 — "흔들림"으로 뭉뚱그리지 않는다.
 *
 * 알려진 한계(PRD): X3 은 그 동영상 안에서의 비교라 동영상 전체가 흐리면 아무것도 걸리지 않는다
 * (W8 이 따로 본다). 가만히 있는 구간이 절반을 넘으면 움직이는 구간이 통째로 걸릴 수 있다.
 *
 * 순수 함수다.
 */

import { median } from "@/core/stats";
import type { Measured } from "./measure";
import { RULES, type Rules } from "./rules";

export type ExcludeCode = "X1" | "X2" | "X3" | "X4";

export type ExcludeReason =
  | "noFace"
  | "multipleFaces"
  | "matrixUnreadable"
  | "landmarksUnreadable"
  | "notOrthogonal"
  | "touchesEdge"
  | "tooSmall"
  | "sharpnessUnmeasured"
  | "blurry"
  | "exposureUnmeasured"
  | "clipped";

export interface Exclusion {
  code: ExcludeCode;
  reason: ExcludeReason;
}

export const REASON_CODE: Record<ExcludeReason, ExcludeCode> = {
  noFace: "X1",
  multipleFaces: "X1",
  matrixUnreadable: "X1",
  landmarksUnreadable: "X1",
  notOrthogonal: "X1",
  touchesEdge: "X2",
  tooSmall: "X2",
  sharpnessUnmeasured: "X3",
  blurry: "X3",
  exposureUnmeasured: "X4",
  clipped: "X4",
};

const ex = (reason: ExcludeReason): Exclusion => ({ code: REASON_CODE[reason], reason });

/** X1·X2 만 본다. 선명도 기준(X3)을 정할 모집단을 고르는 데 쓴다. */
export function faceExclusion(m: Measured, rules: Rules = RULES): Exclusion | null {
  if (m.face === null) return ex(m.faceFailure ?? "noFace");
  // `> 기준` 이 아니라 `!(≤ 기준)`: NaN 이 통과하지 못하게.
  if (!(m.face.orthoError <= rules.exclude.maxOrthoError)) return ex("notOrthogonal");
  if (m.face.touchesEdge) return ex("touchesEdge");
  if (!(m.face.faceShortRatio >= rules.exclude.minFaceShortRatio)) return ex("tooSmall");
  return null;
}

/**
 * X3 의 기준이 되는 선명도: 거친 훑기 장면 가운데 X1·X2 를 통과하고 선명도를 잰 장면들의 중앙값.
 * 그런 장면이 하나도 없으면 null(견줄 것이 없다).
 */
export function sharpnessBaseline(coarse: readonly Measured[], rules: Rules = RULES): number | null {
  const xs: number[] = [];
  for (const m of coarse) {
    if (faceExclusion(m, rules) !== null) continue;
    if (m.sharpness === null || !Number.isFinite(m.sharpness)) continue;
    xs.push(m.sharpness);
  }
  return median(xs);
}

/**
 * 한 장면의 제외 판정. 빼지 않으면 null.
 *
 * @param baseline `sharpnessBaseline` 의 결과. null 이면 흔들림은 견주지 않는다(선명도를 재지
 *   못한 장면은 그래도 뺀다).
 */
export function exclusionOf(m: Measured, baseline: number | null, rules: Rules = RULES): Exclusion | null {
  const face = faceExclusion(m, rules);
  if (face !== null) return face;
  if (m.sharpness === null || !Number.isFinite(m.sharpness)) return ex("sharpnessUnmeasured");
  if (baseline !== null && m.sharpness < baseline * rules.exclude.sharpnessMedianFactor) return ex("blurry");
  if (m.skin === null) return ex("exposureUnmeasured");
  if (!(m.skin.clipRatio <= rules.exclude.maxClipRatio)) return ex("clipped");
  return null;
}

export interface ExclusionCounts {
  X1: number;
  X2: number;
  X3: number;
  X4: number;
  /** 뺀 장면의 합. */
  total: number;
}

export function emptyCounts(): ExclusionCounts {
  return { X1: 0, X2: 0, X3: 0, X4: 0, total: 0 };
}

/** 그 사유로 뺀 장면 수. X1 안에서 "얼굴이 둘 이상"을 따로 알리는 데 쓴다. */
export function countReason(list: readonly (Exclusion | null)[], reason: ExcludeReason): number {
  let n = 0;
  for (const e of list) if (e !== null && e.reason === reason) n++;
  return n;
}

/** 사유별로 센다. null(빼지 않음)은 세지 않는다. */
export function countExclusions(list: readonly (Exclusion | null)[]): ExclusionCounts {
  const c = emptyCounts();
  for (const e of list) {
    if (e === null) continue;
    c[e.code]++;
    c.total++;
  }
  return c;
}
