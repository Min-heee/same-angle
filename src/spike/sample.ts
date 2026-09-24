/**
 * FaceLandmarker 결과 한 개를 보고서용 숫자(배치·분해 각·박스)로 바꾸는 접착부.
 *
 * 코어 수학(matrix·face)이 D1 보고서에 들어가는 길은 여기 하나뿐이다. 흔들림(실험 1)은 원 행렬 없이
 * 요약값만 보고서에 남기므로, 여기서 배치를 무시하거나 폭·높이를 뒤바꾸면 D1 뒤에 다시 계산해
 * 고칠 수 없다. 그래서 'use client' 없는 순수 모듈로 두고 node 테스트로 고정한다(sample.test.ts).
 *
 * MediaPipe 는 타입만 가져온다(런타임 import 없음).
 */

import type { FaceLandmarkerResult, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { faceBox, type FaceBox } from "@/core/face";
import { decompose, detectLayout, type Decomposed, type MatrixLayout } from "@/core/matrix";

/** 경계 접촉 여백: 프레임 짧은 변의 2%. [추론] 초깃값, H2 문턱은 D1 뒤에 정한다. */
export const EDGE_MARGIN_FRAC = 0.02;

export interface FrameSample {
  /** 추론 시작 시각(performance.now). */
  t: number;
  inferMs: number;
  /** 직전 추론 시작과의 간격. 첫 프레임(루프 시작·재개 직후 포함)은 null. */
  intervalMs: number | null;
  faces: number;
  /** 첫 얼굴의 행렬(16개). 없으면 null. */
  matrix: number[] | null;
  layout: MatrixLayout | null;
  dec: Decomposed | null;
  box: FaceBox | null;
  frameW: number;
  frameH: number;
}

/** 첫 얼굴의 결과만 뽑아 표본으로. 랜드마크는 오버레이·픽셀 측정용으로만 돌려주고 표본에는 넣지 않는다. */
export function toSample(
  res: FaceLandmarkerResult,
  t: number,
  inferMs: number,
  intervalMs: number | null,
  frameW: number,
  frameH: number,
): { sample: FrameSample; landmarks: NormalizedLandmark[] | null } {
  const faces = res.faceLandmarks?.length ?? 0;
  const lms = faces > 0 ? res.faceLandmarks[0] : null;
  const raw = res.facialTransformationMatrixes?.[0]?.data;
  const matrix = raw && raw.length > 0 ? Array.from(raw) : null;
  const layout = matrix ? detectLayout(matrix) : null;
  const dec = matrix && layout ? decompose(matrix, layout) : null;
  const box = lms ? faceBox(lms, frameW, frameH, EDGE_MARGIN_FRAC * Math.min(frameW, frameH)) : null;
  return {
    sample: { t, inferMs, intervalMs, faces, matrix, layout, dec, box, frameW, frameH },
    landmarks: lms,
  };
}

/** 결과 하나를 분해까지 마친 요약으로(IMAGE 경로·같은 프레임 비교에서 쓴다). */
export function summarizeResult(res: FaceLandmarkerResult, frameW: number, frameH: number, inferMs: number): FrameSample {
  return toSample(res, 0, inferMs, null, frameW, frameH).sample;
}
