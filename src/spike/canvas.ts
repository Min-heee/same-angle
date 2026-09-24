/**
 * 비디오 프레임·이미지를 캔버스로 옮기는 도우미. 브라우저에서만 불린다(모듈 최상단에서는 아무것도 하지 않는다).
 *
 * 좌우 반전을 하지 않는다. 기준 사진과 좌우가 어긋나면 yaw 부호가 뒤집힌다(PRD F11).
 */

/** 지금 비디오 프레임을 원본 해상도 그대로 새 캔버스에. */
export function grabVideoFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!(w > 0 && h > 0)) throw new Error("비디오 프레임이 아직 없습니다(videoWidth 0).");
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D 캔버스를 만들 수 없습니다.");
  ctx.drawImage(video, 0, 0, w, h);
  return c;
}

/** 긴 변이 maxLong 이하가 되게 줄인 캔버스. 이미 작으면 같은 크기로 복사. */
export function downscale(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxLong: number,
): HTMLCanvasElement {
  const k = Math.min(1, maxLong / Math.max(width, height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(width * k));
  c.height = Math.max(1, Math.round(height * k));
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D 캔버스를 만들 수 없습니다.");
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

/**
 * 다 쓴 캔버스의 픽셀 버퍼를 바로 놓는다. 사파리는 전체 캔버스 메모리에 한도가 있고, 가비지
 * 수거를 기다리면 12MP 사진 몇 장으로 한도에 닿는다(TECH-NOTES 3절).
 */
export function releaseCanvas(c: HTMLCanvasElement | null | undefined): void {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}
