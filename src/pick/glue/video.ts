/**
 * 접착부: 동영상 파일을 열고, 시각을 옮겨 장면을 뽑는다.
 *
 * 브라우저에서만 불린다. **실제 동영상으로, 특히 아이폰 사파리에서 아직 돌려 보지 못했다.**
 * 미확인: 재생 전에 장면을 푸는지, 탐색이 요청한 시각의 장면을 돌려주는지, 멈춘 상태로 탐색한 뒤
 * `requestVideoFrameCallback` 이 불리는지, 세로 동영상의 회전 정보가 반영되는지(PRD 9절).
 *
 * 파일은 `<video src=blob:>` 로만 읽는다. `fetch(blob:)` 는 fetch 가드와 CSP 가 막는다(F10).
 */

const LOAD_TIMEOUT_MS = 15_000;
const SEEK_TIMEOUT_MS = 5_000;
/** 탐색이 끝난 뒤 실제 장면 시각(mediaTime)을 기다리는 시간. 오지 않으면 요청한 시각을 쓴다. */
const MEDIA_TIME_WAIT_MS = 120;

/** 동영상을 읽을 수 없음(S3). */
export class VideoUnreadableError extends Error {
  constructor(detail: string) {
    super(`동영상을 읽을 수 없습니다: ${detail}`);
    this.name = "VideoUnreadableError";
  }
}

export interface OpenedVideo {
  video: HTMLVideoElement;
  /** 원본 해상도(브라우저가 회전 정보를 반영해 알려 준 값). */
  width: number;
  height: number;
  durationSec: number;
  /** blob 주소를 놓고 요소를 비운다. 파일 자체는 건드리지 않는다. */
  close(): void;
}

function once(target: EventTarget, ok: string, timeoutMs: number, what: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const done = (fn: () => void) => {
      clearTimeout(timer);
      target.removeEventListener(ok, onOk);
      target.removeEventListener("error", onError);
      fn();
    };
    const onOk = () => done(resolve);
    const onError = () => done(() => reject(new VideoUnreadableError(`${what} 중 오류`)));
    const timer = setTimeout(
      () => done(() => reject(new VideoUnreadableError(`${what}: ${timeoutMs / 1000}초 안에 끝나지 않음`))),
      timeoutMs,
    );
    target.addEventListener(ok, onOk);
    target.addEventListener("error", onError);
  });
}

export async function openVideo(file: Blob): Promise<OpenedVideo> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  const close = () => {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  };

  try {
    const loaded = once(video, "loadeddata", LOAD_TIMEOUT_MS, "동영상 열기");
    video.src = url;
    await loaded;
    // 아이폰 사파리는 재생 전에 장면을 풀지 않을 수 있다(미확인). 소리 없이 한 번 재생했다 멈춘다.
    try {
      await video.play();
    } catch {
      // 자동 재생이 막혀도 탐색은 될 수 있다. 안 되면 첫 탐색에서 걸린다.
    }
    video.pause();

    const width = video.videoWidth;
    const height = video.videoHeight;
    const durationSec = video.duration;
    if (!(width > 0) || !(height > 0)) throw new VideoUnreadableError("장면 크기를 알 수 없음");
    if (!Number.isFinite(durationSec) || !(durationSec > 0)) throw new VideoUnreadableError("길이를 알 수 없음");
    return { video, width, height, durationSec, close };
  } catch (e) {
    close();
    throw e;
  }
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

/**
 * 그 시각으로 옮기고, 브라우저가 실제로 보여 준 장면의 시각을 알려 주면 돌려준다(아니면 null).
 * 탐색이 끝나지 않으면 VideoUnreadableError.
 */
export async function seekTo(video: HTMLVideoElement, timeSec: number): Promise<number | null> {
  const v = video as FrameCallbackVideo;
  let reported: number | null = null;
  let callbackId: number | null = null;
  let resolveFrame: (() => void) | null = null;
  const framePromise = new Promise<void>((resolve) => {
    resolveFrame = resolve;
  });
  // 장면이 바뀌기 전에 걸어 둬야 그 장면의 콜백을 받는다.
  if (typeof v.requestVideoFrameCallback === "function") {
    callbackId = v.requestVideoFrameCallback((_now, meta) => {
      callbackId = null;
      if (Number.isFinite(meta.mediaTime)) reported = meta.mediaTime;
      resolveFrame?.();
    });
  }

  const seeked = once(video, "seeked", SEEK_TIMEOUT_MS, `${timeSec.toFixed(2)}초로 옮기기`);
  video.currentTime = timeSec;
  try {
    await seeked;
  } catch (e) {
    if (callbackId !== null) v.cancelVideoFrameCallback?.(callbackId);
    throw e;
  }

  if (callbackId !== null) {
    await Promise.race([framePromise, new Promise<void>((r) => setTimeout(r, MEDIA_TIME_WAIT_MS))]);
    if (callbackId !== null) v.cancelVideoFrameCallback?.(callbackId);
  }
  return reported;
}

/** 장면 사이에 화면에 차례를 넘긴다(진행률 그리기, 취소 버튼 누르기). */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
