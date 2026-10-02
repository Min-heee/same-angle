/**
 * 기준 사진과 장면 사이의 차이와 점수(PRD 5절 "각도 차와 점수").
 *
 *   각도차 = ∠(v_기준, v_장면)                         … 찍은 뒤 못 고친다
 *   점수   = 각도차 + 0.1·|θ| + 5·|ln f| + 10·p        … 작을수록 가깝다
 *
 *   θ  기준점을 겹치는 데 필요한 회전(°)
 *   f  틀 배율: 얼굴이 화면 짧은 변에서 차지하는 비율의 비(기준 사진 ÷ 장면)
 *   p  위치 차: 얼굴 박스 중심이 화면 중심에서 벗어난 벡터(각자 자기 화면의 짧은 변 단위)의 차의 크기
 *
 * 순수 함수다.
 */

import { angleBetweenDeg, mirrorView } from "./direction";
import type { FaceReading } from "./measure";
import { RULES, type Rules } from "./rules";
import { fitSimilarity, residualRms, rotationDegOf, scaleOf, spreadOf, type Similarity } from "./similarity";

export interface Comparison {
  /** 보는 방향의 차(°). 가까움 판정은 이 값으로만 한다. */
  angleDeg: number;
  /** 기준 방향의 좌우를 뒤집었을 때의 각도차(°). W10 의 재료. */
  mirroredAngleDeg: number;
  /** 장면(재는 픽셀) → 기준 사진(재는 픽셀)의 닮음 변환. 보정에 그대로 쓴다. */
  fit: Similarity;
  /** 맞추는 데 필요한 회전 θ(°). */
  rotationDeg: number;
  /** 기준점 맞춤의 배율(재는 픽셀 사이). */
  fitScale: number;
  /** 틀 배율 f. */
  frameScale: number;
  /** 위치 차 p. */
  position: number;
  /** 남는 오차: 맞춘 뒤 기준점끼리 거리의 RMS ÷ 기준 사진의 눈 사이 거리. */
  residual: number;
  /** 점수. */
  score: number;
}

/** 점수식 한 곳. 화면의 규칙표와 시험이 같은 식을 읽는다. */
export function scoreOf(
  parts: { angleDeg: number; rotationDeg: number; frameScale: number; position: number },
  rules: Rules = RULES,
): number {
  return (
    parts.angleDeg +
    rules.score.rollPerDeg * Math.abs(parts.rotationDeg) +
    rules.score.lnFrameScale * Math.abs(Math.log(parts.frameScale)) +
    rules.score.position * parts.position
  );
}

/**
 * 장면을 기준 사진과 견준다.
 *
 * 기준점 맞춤을 구하지 못하거나(점이 한데 몰림) 어느 값이든 유한하지 않으면 null — 호출하는 쪽은
 * 그런 장면을 "랜드마크를 읽을 수 없음"(X1)으로 뺀다. 0 이나 기본값으로 채워 견주지 않는다.
 */
export function compareToReference(ref: FaceReading, frame: FaceReading, rules: Rules = RULES): Comparison | null {
  const fit = fitSimilarity(frame.anchors, ref.anchors);
  if (fit === null) return null;

  const angleDeg = angleBetweenDeg(ref.view, frame.view);
  const mirroredAngleDeg = angleBetweenDeg(mirrorView(ref.view), frame.view);
  const rotationDeg = rotationDegOf(fit);
  const fitScale = scaleOf(fit);
  const frameScale = ref.faceShortRatio / frame.faceShortRatio;
  const position = Math.hypot(ref.offset.x - frame.offset.x, ref.offset.y - frame.offset.y);
  const residual = residualRms(fit, frame.anchors, ref.anchors) / ref.eyeDistancePx;
  const score = scoreOf({ angleDeg, rotationDeg, frameScale, position }, rules);

  const all = [angleDeg, mirroredAngleDeg, rotationDeg, fitScale, frameScale, position, residual, score];
  if (!all.every((v) => Number.isFinite(v))) return null;
  if (!(frameScale > 0)) return null;

  return { angleDeg, mirroredAngleDeg, fit, rotationDeg, fitScale, frameScale, position, residual, score };
}

export interface AnchorQuality {
  count: number;
  /** 퍼짐 Σr²(눈 사이 거리 단위). */
  spread: number;
  /** 12점 이상이고 퍼짐이 8 이상인가(PRD 7절에서 식으로 유도한 조건). */
  sufficient: boolean;
}

/**
 * 기준 사진의 기준점이 맞춤을 믿을 만큼 퍼져 있는가.
 *
 * 사선 사진처럼 얼굴이 옆으로 돌면 화면 위에서 점들이 좁아져 퍼짐이 줄 수 있다[추론]. 그때는
 * 회전·배율 보정량의 오차가 커진다. 결과와 기록에 그대로 적는다.
 */
export function anchorQuality(ref: FaceReading, rules: Rules = RULES): AnchorQuality {
  const count = ref.anchors.length;
  const spread = spreadOf(ref.anchors, ref.eyeDistancePx);
  return {
    count,
    spread,
    sufficient: count >= rules.anchors.minCount && spread >= rules.anchors.minSpread,
  };
}
