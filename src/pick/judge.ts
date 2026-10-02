/**
 * 판정: 가까움, 경고(W), 기준 사진에서의 멈춤(S1·S2)(PRD 5절 "멈춤과 경고").
 *
 * 판정은 **숫자 묶음 하나(`JudgeNumbers`)와 규칙 값**에서만 나온다. 그 숫자 묶음이 그대로 기록에
 * 들어가므로, 내보낸 기록을 다시 읽어 같은 함수에 넣으면 같은 판정과 경고가 나온다(F19).
 * 화면이 판정을 따로 계산하지 않는다.
 *
 * 재지 못한 값(null)으로는 경고를 띄우지 않는다. 재지 못했다는 사실은 기록에 null 로 남는다.
 *
 * 순수 함수다.
 */

import type { Comparison } from "./compare";
import type { FaceReading, FrameSize, Measured } from "./measure";
import { outputGeometry, type OutputGeometry } from "./output";
import { RULES, type Rules } from "./rules";
import { verdictOf, type Verdict } from "./select";

export type StopCode = "S1" | "S2" | "S3" | "S4" | "S5" | "S6";

/** 표의 순서. 경고가 여럿이면 이 순서대로 3개까지 펼쳐 보인다. */
export const WARNING_ORDER = [
  "W1",
  "W10",
  "W12",
  "W3",
  "W11",
  "W2",
  "W8",
  "W9",
  "W13",
  "W4",
  "W5",
  "W6",
  "W7",
] as const;
export type WarningCode = (typeof WARNING_ORDER)[number];

export type Orientation = "portrait" | "landscape" | "square";

export function orientationOf(size: FrameSize): Orientation {
  return size.height > size.width ? "portrait" : size.width > size.height ? "landscape" : "square";
}

/** 판정에 쓰는 숫자 전부. 기록의 후보 항목에 그대로 들어간다. */
export interface JudgeNumbers {
  /** 다시 잰 각도차(°). */
  angleDeg: number;
  /** 기준 방향의 좌우를 뒤집었을 때의 각도차(°). */
  mirroredAngleDeg: number | null;
  referenceOrientation: Orientation;
  /** 동영상의 세로·가로. 사진 여러 장에서는 그 후보 사진의 세로·가로. */
  videoOrientation: Orientation;
  /** 관심 영역의 빈 비율(0~1). */
  roiEmptyFraction: number | null;
  /** 틀 배율 f(기준 사진 ÷ 장면). */
  frameScale: number;
  /** 화질 배율 k. */
  qualityScale: number | null;
  /** 장면과 기준 사진의 선명도. */
  sharpness: number | null;
  referenceSharpness: number | null;
  /** 장면과 기준 사진의 피부 패치 평균 휘도(0~255). */
  meanLuma: number | null;
  referenceMeanLuma: number | null;
  /** 남는 오차(눈 사이 거리 대비). */
  residual: number;
  /** 위치 차 p. */
  position: number;
  /** 분석 때와 다시 쟀을 때 보는 방향의 차(°). */
  remeasureShiftDeg: number | null;
  /** 동영상 길이(초). 사진 여러 장에서 골랐으면 길이가 없어 null 이다. */
  videoDurationSec: number | null;
  /** 기준 사진의 피부 패치 클리핑 비율. */
  referenceClipRatio: number | null;
}

/** 숫자 묶음에서 경고를 낸다. 표의 순서로 돌려준다. */
export function warningsOf(n: JudgeNumbers, rules: Rules = RULES): WarningCode[] {
  const w = new Set<WarningCode>();
  const pass = rules.select.passDeg;

  // W1: `> 기준` 이 아니라 `!(≤ 기준)` — NaN 은 "가깝지 않다".
  const notClose = !(n.angleDeg <= pass);
  if (notClose) w.add("W1");
  if (notClose && n.mirroredAngleDeg !== null && n.mirroredAngleDeg <= pass) w.add("W10");

  if (
    n.referenceOrientation !== "square" &&
    n.videoOrientation !== "square" &&
    n.referenceOrientation !== n.videoOrientation
  ) {
    w.add("W12");
  }

  if (n.roiEmptyFraction !== null && n.roiEmptyFraction > rules.warn.maxRoiEmpty) w.add("W3");
  if (n.frameScale > rules.warn.maxFrameScale || n.frameScale < 1 / rules.warn.maxFrameScale) w.add("W11");
  if (n.qualityScale !== null && n.qualityScale > rules.warn.maxQualityScale) w.add("W2");
  if (
    n.sharpness !== null &&
    n.referenceSharpness !== null &&
    n.sharpness < n.referenceSharpness * rules.warn.minSharpnessVsReference
  ) {
    w.add("W8");
  }
  if (
    n.meanLuma !== null &&
    n.referenceMeanLuma !== null &&
    Math.abs(n.meanLuma - n.referenceMeanLuma) > rules.warn.maxLumaDiff
  ) {
    w.add("W9");
  }
  if (n.residual > rules.warn.maxResidual) w.add("W13");
  if (n.position > rules.warn.maxPosition) w.add("W4");
  if (n.remeasureShiftDeg !== null && n.remeasureShiftDeg > rules.warn.maxRemeasureShiftDeg) w.add("W5");
  if (n.videoDurationSec !== null && n.videoDurationSec > rules.sampling.maxDurationSec) w.add("W6");
  if (n.referenceClipRatio !== null && n.referenceClipRatio > rules.exclude.maxClipRatio) w.add("W7");

  return WARNING_ORDER.filter((c) => w.has(c));
}

export interface Judgement {
  verdict: Verdict;
  warnings: WarningCode[];
}

/** 가까움 판정과 경고를 한 번에. 살아 있는 결과와 다시 읽은 기록이 같은 함수를 쓴다. */
export function judge(n: JudgeNumbers, rules: Rules = RULES): Judgement {
  return { verdict: verdictOf(n.angleDeg, rules), warnings: warningsOf(n, rules) };
}

export type ReferenceAssessment =
  | { ok: true; face: FaceReading }
  | { ok: false; stop: "S1" | "S2"; reason: NonNullable<Measured["faceFailure"]> };

/**
 * 기준 사진을 쓸 수 있는가.
 *
 *  S1  얼굴을 찾지 못함(정수리 등). 얼굴은 찾았지만 행렬·랜드마크를 읽지 못한 경우도 "각도를 잴 수
 *      없음"이라 여기에 넣고, 사유(reason)로 구별한다.
 *  S2  얼굴이 둘 이상.
 */
export function assessReference(reference: Measured): ReferenceAssessment {
  if (reference.face !== null) return { ok: true, face: reference.face };
  const reason = reference.faceFailure ?? "noFace";
  return { ok: false, stop: reason === "multipleFaces" ? "S2" : "S1", reason };
}

/** 후보 하나를 판정할 때 필요한, 후보 밖의 값. */
export interface JudgeContext {
  /** 기준 사진의 측정값(얼굴을 읽은 것). */
  reference: Measured & { face: FaceReading };
  /** 기준 사진의 원본 크기(회전 정보를 반영한 뒤). */
  referenceOriginal: FrameSize;
  /** 동영상의 원본 해상도(회전 정보를 반영한 뒤). 사진 여러 장에서는 **그 후보 사진**의 원본 크기. */
  videoNative: FrameSize;
  /** 동영상 길이(초). 사진 여러 장에서는 null. */
  videoDurationSec: number | null;
  /** 보정본의 긴 변 상한(px). 없으면 `rules.output.maxLongSidePx`. 사진 여러 장에서는 더 크게 잡는다. */
  outputMaxLongSidePx?: number;
}

/**
 * 사진 여러 장에서 고른 후보 하나의 판정 맥락(PRD v0.3.1). 후보마다 그 사진의 원본 크기를 넣는다 —
 * 묶음에 크기가 다른 사진이 섞여 있을 수 있다. 길이는 없고(null), 보정본의 긴 변 상한은
 * `rules.photos.outputMaxLongSidePx` 다.
 */
export function photoJudgeContext(
  base: Pick<JudgeContext, "reference" | "referenceOriginal">,
  photoSize: FrameSize,
  rules: Rules = RULES,
): JudgeContext {
  return {
    reference: base.reference,
    referenceOriginal: base.referenceOriginal,
    videoNative: photoSize,
    videoDurationSec: null,
    outputMaxLongSidePx: rules.photos.outputMaxLongSidePx,
  };
}

export interface CandidateInput {
  /** 다시 잰 장면의 얼굴 읽기. */
  face: FaceReading;
  sharpness: number | null;
  meanLuma: number | null;
  /** 다시 잰 값으로 견준 결과. */
  comparison: Comparison;
  remeasureShiftDeg: number | null;
}

export interface CandidateJudgement extends Judgement {
  numbers: JudgeNumbers;
  /** 보정본의 틀. 기준 사진 크기가 올바르지 않으면 null(그때 W2·W3 은 판정하지 않는다). */
  output: OutputGeometry | null;
}

/** 후보 하나의 숫자 묶음·보정본 틀·판정. 후보를 바꾸면 그 장면으로 다시 부른다(F18). */
export function judgeCandidate(c: CandidateInput, ctx: JudgeContext, rules: Rules = RULES): CandidateJudgement {
  const output = outputGeometry(
    {
      fit: c.comparison.fit,
      referenceMeasured: ctx.reference.face.frame,
      frameMeasured: c.face.frame,
      frameNative: ctx.videoNative,
      referenceOriginal: ctx.referenceOriginal,
      referenceBox: ctx.reference.face.box,
    },
    rules,
    ctx.outputMaxLongSidePx,
  );
  const numbers: JudgeNumbers = {
    angleDeg: c.comparison.angleDeg,
    mirroredAngleDeg: c.comparison.mirroredAngleDeg,
    referenceOrientation: orientationOf(ctx.referenceOriginal),
    videoOrientation: orientationOf(ctx.videoNative),
    roiEmptyFraction: output?.roiEmptyFraction ?? null,
    frameScale: c.comparison.frameScale,
    qualityScale: output?.qualityScale ?? null,
    sharpness: c.sharpness,
    referenceSharpness: ctx.reference.sharpness,
    meanLuma: c.meanLuma,
    referenceMeanLuma: ctx.reference.skin?.meanLuma ?? null,
    residual: c.comparison.residual,
    position: c.comparison.position,
    remeasureShiftDeg: c.remeasureShiftDeg,
    videoDurationSec: ctx.videoDurationSec,
    referenceClipRatio: ctx.reference.skin?.clipRatio ?? null,
  };
  return { ...judge(numbers, rules), numbers, output };
}
