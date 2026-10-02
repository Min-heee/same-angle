/**
 * 접착부: 캔버스 한 장 → 측정값. 얼굴 모델과 캔버스만 건드리고, 계산은 전부 순수 함수에 맡긴다.
 *
 * 브라우저에서만 불린다. **실제 얼굴 동영상으로 아직 돌려 보지 못했다.**
 *
 * 픽셀은 얼굴 부분만 읽는다(PRD F15). 선명도는 얼굴 박스를 긴 변 256px 로, 노출·밝기는 피부
 * 패치를 128×128 로 **다시 뽑아** 잰다 — 크기를 고정해야 얼굴이 크게 찍혔는지에 따라 값이 달라지지
 * 않는다. 작은 캔버스 두 장을 재사용하고 장면 이미지를 쌓아 두지 않는다.
 */

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { clipRatio, laplacianVariance, lumaArray, meanLuma } from "@/core/pixels";
import { readFaces, skinPatchToCanvas, toMeasured, type FaceReading, type Measured } from "../measure";
import { RULES } from "../rules";
import { detectFaces } from "./landmarker";

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D 캔버스를 만들 수 없습니다.");
  return ctx;
}

export interface Measurer {
  /** 재는 캔버스(긴 변 960px 로 이미 그려 둔 것) 한 장을 잰다. */
  measure(canvas: HTMLCanvasElement): Measured;
  /** 작은 캔버스의 픽셀 버퍼를 놓는다. */
  dispose(): void;
}

export function createMeasurer(landmarker: FaceLandmarker): Measurer {
  const sharpCanvas = document.createElement("canvas");
  const skinCanvas = document.createElement("canvas");
  const skinSize = RULES.measure.skinPatchPx;
  skinCanvas.width = skinSize;
  skinCanvas.height = skinSize;

  const sharpnessOf = (source: HTMLCanvasElement, face: FaceReading): number | null => {
    const r = face.sharpnessRect;
    if (!(r.width >= 1) || !(r.height >= 1)) return null;
    const k = RULES.measure.sharpnessLongSidePx / Math.max(r.width, r.height);
    const w = Math.max(3, Math.round(r.width * k));
    const h = Math.max(3, Math.round(r.height * k));
    if (sharpCanvas.width !== w) sharpCanvas.width = w;
    if (sharpCanvas.height !== h) sharpCanvas.height = h;
    const ctx = context(sharpCanvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(source, r.x, r.y, r.width, r.height, 0, 0, w, h);
    const luma = lumaArray(ctx.getImageData(0, 0, w, h).data, w, h);
    return laplacianVariance(luma, w, h);
  };

  const skinOf = (source: HTMLCanvasElement, face: FaceReading): { meanLuma: number; clipRatio: number } | null => {
    if (face.skinPatch === null) return null;
    const ctx = context(skinCanvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, skinSize, skinSize);
    ctx.setTransform(...skinPatchToCanvas(face.skinPatch, skinSize));
    ctx.drawImage(source, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const luma = lumaArray(ctx.getImageData(0, 0, skinSize, skinSize).data, skinSize, skinSize);
    return { meanLuma: meanLuma(luma), clipRatio: clipRatio(luma) };
  };

  return {
    measure(canvas) {
      const reading = readFaces(detectFaces(landmarker, canvas), { width: canvas.width, height: canvas.height });
      if (!reading.ok) return toMeasured(reading, { sharpness: null, skin: null });
      return toMeasured(reading, {
        sharpness: sharpnessOf(canvas, reading.face),
        skin: skinOf(canvas, reading.face),
      });
    },
    dispose() {
      sharpCanvas.width = 0;
      sharpCanvas.height = 0;
      skinCanvas.width = 0;
      skinCanvas.height = 0;
    },
  };
}

/**
 * 원본을 재는 캔버스에 긴 변 960px 로 줄여 그린다. 캔버스 한 장을 재사용한다.
 * 원본 크기로 캔버스에 올리지 않고 바로 줄여 그린다(아이폰 사파리의 캔버스 한도, PRD F14).
 */
export function drawForMeasure(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): void {
  const k = Math.min(1, RULES.measure.longSidePx / Math.max(sourceWidth, sourceHeight));
  const w = Math.max(1, Math.round(sourceWidth * k));
  const h = Math.max(1, Math.round(sourceHeight * k));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = context(canvas);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(source, 0, 0, w, h);
}
