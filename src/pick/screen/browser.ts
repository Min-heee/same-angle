/**
 * 접착부(브라우저): `PickDeps` 의 진짜 구현. 엔진의 접착부(`../glue/*`)에 그림 그리기·해시·주소를 더한다.
 *
 * 브라우저에서만 불린다. **실제 얼굴 사진·동영상으로, 그리고 아이폰 사파리에서 아직 돌려 보지 못했다.**
 * 모듈 최상단에서는 아무것도 하지 않는다(정적 내보내기 프리렌더).
 *
 * 네트워크: 이 파일에는 `fetch` 도 `XMLHttpRequest` 도 없다. 파일은 File API·`createImageBitmap`·
 * `<video src=blob:>` 로만 읽고, 해시는 `crypto.subtle` 로 기기 안에서 계산하고, 저장은
 * `<a download href=blob:>` 로 한다. 밖으로 나가는 요청은 얼굴 모델을 받는 것 하나뿐이고(엔진의
 * `loadPickLandmarker` → `spike/engine.ts`, fetch 가드를 먼저 깐다) 이 화면이 새로 더한 것은 없다.
 *
 * 메모리: 원본 크기 캔버스는 지금 보는 후보 한 장만 들고 있는다. 화면에 보이는 그림은 JPEG 로
 * 줄여 blob 주소로 넘긴다(캔버스를 화면에 여러 장 붙여 두지 않는다).
 */

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { analyzeVideo, measureReference } from "../glue/analyze";
import { loadPickLandmarker } from "../glue/landmarker";
import { openReference, type OpenedReference } from "../glue/reference";
import { renderCorrected } from "../glue/render";
import { openVideo, seekTo, type OpenedVideo } from "../glue/video";
import type { FrameSize } from "../measure";
import { bandLayout } from "./exportplan";
import type { PickDeps, RenderedCandidate } from "./session";

/** 화면에 보이는 그림의 긴 변 상한(px). 보정본의 출력 긴 변 상한과 같다. */
const DISPLAY_LONG_SIDE = 1920;
const THUMB_LONG_SIDE = 240;
const DISPLAY_JPEG_QUALITY = 0.9;
const BAND_BACKGROUND = "#14181f";
const BAND_TEXT = "#ffffff";
const BAND_FONT = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

interface LoadedModel {
  landmarker: FaceLandmarker;
  close(): void;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D 캔버스를 만들 수 없습니다.");
  return ctx;
}

function release(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

function toBlob(canvas: HTMLCanvasElement, type: "image/png" | "image/jpeg", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("그림을 파일로 바꾸지 못했습니다."))), type, quality),
  );
}

/** 긴 변이 `maxLong` 이하가 되게 줄여 그린 새 캔버스. */
function scaled(source: CanvasImageSource, size: FrameSize, maxLong: number): HTMLCanvasElement {
  const k = Math.min(1, maxLong / Math.max(size.width, size.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(size.width * k));
  c.height = Math.max(1, Math.round(size.height * k));
  const ctx = context(c);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

async function jpegUrl(source: CanvasImageSource, size: FrameSize, maxLong: number): Promise<string> {
  const c = scaled(source, size, maxLong);
  try {
    return URL.createObjectURL(await toBlob(c, "image/jpeg", DISPLAY_JPEG_QUALITY));
  } finally {
    release(c);
  }
}

/** 사진 아래에 띠를 붙인 PNG. 띠는 사진 밑에 따로 붙어 사진 영역을 가리지 않는다(F19). */
async function pngWithBand(image: HTMLCanvasElement, lines: readonly string[]): Promise<Blob> {
  const layout = bandLayout(image.width, lines.length);
  const out = document.createElement("canvas");
  out.width = image.width;
  out.height = image.height + layout.height;
  try {
    const ctx = context(out);
    ctx.drawImage(image, 0, 0);
    ctx.fillStyle = BAND_BACKGROUND;
    ctx.fillRect(0, image.height, out.width, layout.height);
    ctx.fillStyle = BAND_TEXT;
    ctx.textBaseline = "middle";
    const maxWidth = out.width - layout.paddingX * 2;
    lines.forEach((line, i) => {
      // 첫 줄(내부 기록용 표기)은 굵게. 폭을 넘으면 그 줄만 글자를 줄인다.
      let px = layout.fontPx;
      const font = (size: number) => `${i === 0 ? "700" : "400"} ${size}px ${BAND_FONT}`;
      ctx.font = font(px);
      const w = ctx.measureText(line).width;
      if (w > maxWidth && w > 0) {
        px = Math.max(8, Math.floor((px * maxWidth) / w));
        ctx.font = font(px);
      }
      const y = image.height + layout.paddingY + layout.lineHeight * (i + 0.5);
      ctx.fillText(line, layout.paddingX, y);
    });
    return await toBlob(out, "image/png");
  } finally {
    release(out);
  }
}

async function renderCandidateOf(
  video: OpenedVideo,
  requestedTimeSec: number,
  geometry: Parameters<typeof renderCorrected>[1] | null,
): Promise<RenderedCandidate> {
  const grabbedTimeSec = await seekTo(video.video, requestedTimeSec);
  const native: FrameSize = { width: video.width, height: video.height };

  // 원본 크기로 한 번 그린다. 보정본과 원본 장면이 같은 한 장에서 나오게 한다.
  let original: HTMLCanvasElement | null = document.createElement("canvas");
  let corrected: HTMLCanvasElement | null = null;
  const urls: string[] = [];
  let thumbUrl: string | null = null;
  try {
    original.width = native.width;
    original.height = native.height;
    context(original).drawImage(video.video, 0, 0, native.width, native.height);
    corrected = geometry ? renderCorrected(original, geometry) : null;

    const originalUrl = await jpegUrl(original, native, DISPLAY_LONG_SIDE);
    urls.push(originalUrl);
    let correctedUrl: string | null = null;
    if (corrected) {
      correctedUrl = await jpegUrl(corrected, corrected, DISPLAY_LONG_SIDE);
      urls.push(correctedUrl);
    }
    const thumbSource = corrected ?? original;
    thumbUrl = await jpegUrl(thumbSource, thumbSource, THUMB_LONG_SIDE);

    let originalCanvas: HTMLCanvasElement | null = original;
    let correctedCanvas: HTMLCanvasElement | null = corrected;
    let thumb: string | null = thumbUrl;
    return {
      thumbUrl,
      originalUrl,
      correctedUrl,
      grabbedTimeSec,
      async exportPng(kind, lines) {
        const src = kind === "corrected" ? correctedCanvas : originalCanvas;
        if (!src || src.width === 0) throw new Error(kind === "corrected" ? "보정본이 없습니다." : "원본 장면이 없습니다.");
        return pngWithBand(src, lines);
      },
      release(keepThumb) {
        release(originalCanvas);
        release(correctedCanvas);
        originalCanvas = null;
        correctedCanvas = null;
        for (const u of urls.splice(0)) URL.revokeObjectURL(u);
        if (!keepThumb && thumb) {
          URL.revokeObjectURL(thumb);
          thumb = null;
        }
      },
    };
  } catch (e) {
    release(original);
    release(corrected);
    original = null;
    for (const u of urls) URL.revokeObjectURL(u);
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    throw e;
  }
}

function hex(buffer: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buffer)) s += b.toString(16).padStart(2, "0");
  return s;
}

/** SHA-256 을 기기 안에서 계산한다. 보안 컨텍스트가 아니면(crypto.subtle 없음) null. */
async function sha256(blob: Blob): Promise<string | null> {
  const subtle = typeof crypto !== "undefined" ? crypto.subtle : undefined;
  if (!subtle) return null;
  return hex(await subtle.digest("SHA-256", await blob.arrayBuffer()));
}

export const browserDeps: PickDeps<LoadedModel, OpenedReference, OpenedVideo> = {
  async loadModel(onProgress) {
    const loaded = await loadPickLandmarker(onProgress);
    return { landmarker: loaded.landmarker, close: () => loaded.landmarker.close() };
  },
  openReference,
  measureReference: (model, reference) => measureReference(model.landmarker, reference),
  referencePreview: (reference, size) => jpegUrl(reference.bitmap, size, Math.max(size.width, size.height)),
  openVideo,
  analyzeVideo: (model, reference, video, hooks) => analyzeVideo(model.landmarker, reference, video, hooks),
  renderCandidate: renderCandidateOf,
  hashBlob: sha256,
  urlFor: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
  now: () => new Date(),
};
