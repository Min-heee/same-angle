/**
 * 접착부: 기준 사진 재기와 동영상 분석을 순수 파이프라인에 잇는다.
 *
 * 브라우저에서만 불린다. **실제 얼굴 사진·동영상으로 아직 돌려 보지 못했다.**
 *
 * 기준 사진·모든 장면·다시 재기가 같은 재는 캔버스(긴 변 960px)와 같은 얼굴 모델 인스턴스를 쓴다.
 */

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { toFrameMeasurement, type FaceReading, type Measured } from "../measure";
import { analyze, type AnalysisResult, type AnalyzeOptions } from "../pipeline";
import { createMeasurer, drawForMeasure } from "./measure";
import type { OpenedReference } from "./reference";
import { seekTo, yieldToUi, type OpenedVideo } from "./video";

/** 기준 사진을 잰다. 얼굴을 읽었는지는 `assessReference` 로 판정한다. */
export function measureReference(landmarker: FaceLandmarker, reference: OpenedReference): Measured {
  const canvas = document.createElement("canvas");
  const measurer = createMeasurer(landmarker);
  try {
    drawForMeasure(canvas, reference.bitmap, reference.width, reference.height);
    return measurer.measure(canvas);
  } finally {
    measurer.dispose();
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function analyzeVideo(
  landmarker: FaceLandmarker,
  reference: FaceReading,
  opened: OpenedVideo,
  hooks: Pick<AnalyzeOptions, "onProgress" | "onQuickAnswer" | "isCancelled"> = {},
): Promise<AnalysisResult> {
  const canvas = document.createElement("canvas");
  const measurer = createMeasurer(landmarker);
  try {
    return await analyze({
      reference,
      durationSec: opened.durationSec,
      measureAt: async (timeSec) => {
        const reported = await seekTo(opened.video, timeSec);
        drawForMeasure(canvas, opened.video, opened.width, opened.height);
        return toFrameMeasurement(measurer.measure(canvas), timeSec, reported);
      },
      yieldToUi,
      ...hooks,
    });
  } finally {
    measurer.dispose();
    canvas.width = 0;
    canvas.height = 0;
  }
}
