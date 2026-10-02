/**
 * 접착부: 고른 장면에 닮음 변환을 적용해 보정본을 그린다.
 *
 * 브라우저에서만 불린다. **실제 장면으로 아직 그려 보지 못했다.** 변환의 방향과 눈금은 순수 함수
 * (`output.ts`)와 그 픽셀 시험(`warpRgba`)이 맡고, 여기서는 그 숫자를 캔버스에 넘기기만 한다.
 *
 * 빈 곳은 채우지 않고 단색으로 둔다. 좌우 뒤집기·찌그러뜨리기·색 보정은 없다(F17).
 */

import type { OutputGeometry } from "../output";
import { toCanvasTransform } from "../similarity";

/** 빈 곳의 색. 사진으로 오인되지 않게 중간 회색. */
export const EMPTY_FILL = "#808080";

/**
 * @param source 원본 크기의 장면(동영상 요소나, 장면을 원본 크기로 그린 캔버스). 재는 캔버스(960px)를
 *   넘기면 변환의 눈금이 맞지 않는다.
 */
export function renderCorrected(source: CanvasImageSource, geometry: OutputGeometry): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = geometry.size.width;
  canvas.height = geometry.size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D 캔버스를 만들 수 없습니다.");
  ctx.fillStyle = EMPTY_FILL;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.setTransform(...toCanvasTransform(geometry.transform));
  ctx.drawImage(source, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}
