/**
 * 접착부: 얼굴 모델을 고르기용 설정으로 불러오고, 캔버스 한 장에서 얼굴을 읽는다.
 *
 * 브라우저에서만 불린다. **실제 얼굴 동영상으로 아직 돌려 보지 못했다.**
 *
 * 재는 방식은 하나로 고정한다(PRD 5절): 한 장씩 따로 재는 방식(IMAGE), CPU, 얼굴 수 2.
 * 기준 사진·모든 장면·다시 재기가 같은 인스턴스를 쓴다. `src/spike/engine.ts` 를 고치지 않고
 * 가져다 쓴다 — fetch 가드를 먼저 까는 순서가 그 안에 있다.
 */

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { loadFaceLandmarker, type LoadedLandmarker } from "@/spike/engine";
import type { RawFace } from "../measure";
import { RULES } from "../rules";

export function loadPickLandmarker(onProgress?: (msg: string) => void): Promise<LoadedLandmarker> {
  return loadFaceLandmarker({
    delegate: "CPU",
    numFaces: RULES.measure.numFaces,
    runningMode: "IMAGE",
    onProgress,
  });
}

/** 캔버스 한 장에서 얼굴마다 랜드마크와 변환 행렬을 꺼낸다. 값을 고치거나 고르지 않는다. */
export function detectFaces(landmarker: FaceLandmarker, canvas: HTMLCanvasElement): RawFace[] {
  const result = landmarker.detect(canvas);
  return result.faceLandmarks.map((landmarks, i) => ({
    landmarks,
    matrix: result.facialTransformationMatrixes?.[i]?.data ?? null,
  }));
}
