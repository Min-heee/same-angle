/**
 * 접착부: 사진 여러 장(연사)을 **한 장씩** 풀어 잰다(PRD v0.3.1 F22).
 *
 * 브라우저에서만 불린다. **실제 카메라로 찍은 사진으로, 그리고 아이폰 사파리에서 아직 돌려 보지 못했다.**
 * 미확인: 2,400만 화소 사진을 푸는 시간과 메모리, HEIC·RAW 를 넣었을 때의 동작, 카메라가 붙인 회전
 * 정보(EXIF)를 브라우저가 늘 반영하는지.
 *
 * 사진은 기준 사진과 **같은 길**로 연다(`openReference`: `createImageBitmap` + 회전 정보 반영).
 * 한 장을 풀어 재는 캔버스(긴 변 960px)에 줄여 그리고, 재고, 바로 놓는다. 풀어 둔 그림을 쌓아 두지
 * 않는다 — 들고 있는 것은 파일 손잡이뿐이다. 파일은 File API 로만 읽고 어디에도 보내지 않는다.
 */

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { analyzePhotos, type AnalyzePhotosOptions, type PhotoReading } from "../burst";
import type { FaceReading } from "../measure";
import type { AnalysisResult } from "../pipeline";
import { createMeasurer, drawForMeasure } from "./measure";
import { ReferenceUnreadableError, openReference, type OpenedReference } from "./reference";
import { yieldToUi } from "./video";

export interface OpenedPhotoSet {
  /** 순번 순서의 파일. `files[순번 − 1]`. */
  files: readonly Blob[];
  count: number;
  /** 파일 손잡이를 놓는다. 파일 자체는 건드리지 않는다. */
  close(): void;
}

/** 순번 순서로 세운 파일 묶음을 받는다. 여기서는 아무것도 풀지 않는다. */
export function openPhotoSet(files: readonly Blob[]): OpenedPhotoSet {
  let held: readonly Blob[] = [...files];
  return {
    get files() {
      return held;
    },
    count: held.length,
    close() {
      held = [];
    },
  };
}

/**
 * 그 순번의 사진을 푼다. 브라우저가 풀지 못하는 파일(형식, 손상)이면 null — 그 사진은 "읽지 못해
 * 뺀 사진"으로 세어진다. 그 밖의 오류는 그대로 던진다(조용히 넘기지 않는다).
 */
export async function openPhoto(set: OpenedPhotoSet, photoNumber: number): Promise<OpenedReference | null> {
  const file = set.files[photoNumber - 1];
  if (!file) return null;
  try {
    return await openReference(file);
  } catch (e) {
    if (e instanceof ReferenceUnreadableError) return null;
    throw e;
  }
}

export async function analyzePhotoSet(
  landmarker: FaceLandmarker,
  reference: FaceReading,
  set: OpenedPhotoSet,
  hooks: Pick<AnalyzePhotosOptions, "onProgress" | "isCancelled"> = {},
): Promise<AnalysisResult> {
  const canvas = document.createElement("canvas");
  const measurer = createMeasurer(landmarker);
  try {
    return await analyzePhotos({
      reference,
      count: set.count,
      measurePhoto: async (photoNumber): Promise<PhotoReading | null> => {
        const opened = await openPhoto(set, photoNumber);
        if (opened === null) return null;
        try {
          drawForMeasure(canvas, opened.bitmap, opened.width, opened.height);
          return { measured: measurer.measure(canvas), size: { width: opened.width, height: opened.height } };
        } finally {
          // 풀어 둔 그림은 재자마자 놓는다. 다음 사진을 풀기 전에 메모리가 돌아오게.
          opened.close();
        }
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
