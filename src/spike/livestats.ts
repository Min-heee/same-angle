/**
 * 실시간 성능 요약(fps·추론 시간)의 순수 계산. livestats.test.ts 가 고정한다.
 *
 * 규칙(TECH-NOTES 6절 항목 1·5 판정이 섞인 데이터로 나지 않게):
 *  - 창은 **지금 엔진 세대**의 프레임만. 루프를 다시 시작하거나 엔진을 바꾸거나 화면이 꺼졌다
 *    돌아오면 세대가 바뀌고 창을 비운다(옛 엔진 프레임·멈춘 시간이 섞이지 않게).
 *  - fps = 최근 FPS_WINDOW_MS 안의 프레임 수 ÷ min(창 길이, 세대 시작 후 경과). 버퍼의 첫·끝
 *    프레임 사이로 나누면 멈춘 시간이 들어가 크게 낮아진다.
 *  - 마지막 프레임이 STALE_MS 보다 오래됐으면 fps 는 null(프레임 안 옴). 멈춘 화면에 멀쩡한
 *    fps 가 계속 보이지 않게.
 */

import { median, percentile } from "@/core/stats";

export const FPS_WINDOW_MS = 5000;
export const STALE_MS = 1000;
/** 추론 시간 중앙값·p95 에 쓰는 최근 프레임 수. */
export const INFER_WINDOW = 60;
/** 스냅샷을 허락하는 최소 조건: 이 엔진 세대로 모은 프레임 수와 경과 시간. */
export const SNAPSHOT_MIN_FRAMES = 30;
export const SNAPSHOT_MIN_MS = 5000;

export interface LiveSummary {
  /** 이 세대로 모은 프레임 수(전체). */
  genFrames: number;
  /** 세대 시작 후 경과(ms). */
  genElapsedMs: number;
  fps: number | null;
  /** 마지막 프레임 뒤로 STALE_MS 넘게 새 프레임이 없음. */
  stale: boolean;
  inferMedian: number | null;
  inferP95: number | null;
  /** 추론 시간 요약에 들어간 프레임 수(≤ INFER_WINDOW). */
  inferN: number;
  snapshotReady: boolean;
}

/**
 * @param frameTimes 이 세대 프레임의 시작 시각(오름차순). 오래된 것은 호출하는 쪽이 잘라도 된다.
 * @param inferMs 이 세대의 최근 추론 시간(최대 INFER_WINDOW 개).
 */
export function summarizeLive(
  frameTimes: readonly number[],
  inferMs: readonly number[],
  genFrames: number,
  genStart: number,
  now: number,
): LiveSummary {
  const genElapsedMs = Math.max(0, now - genStart);
  const last = frameTimes.length ? frameTimes[frameTimes.length - 1] : null;
  const stale = last === null ? genElapsedMs > STALE_MS : now - last > STALE_MS;
  let fps: number | null = null;
  if (!stale && last !== null) {
    const span = Math.min(FPS_WINDOW_MS, genElapsedMs);
    const inWindow = frameTimes.filter((t) => t >= now - FPS_WINDOW_MS).length;
    fps = span > 0 ? inWindow / (span / 1000) : null;
  }
  const inf = inferMs.slice(-INFER_WINDOW);
  return {
    genFrames,
    genElapsedMs,
    fps,
    stale,
    inferMedian: inf.length ? median(inf) : null,
    inferP95: inf.length ? percentile(inf, 95) : null,
    inferN: inf.length,
    snapshotReady: !stale && genFrames >= SNAPSHOT_MIN_FRAMES && genElapsedMs >= SNAPSHOT_MIN_MS,
  };
}

/**
 * 한 번의 기록(흔들림 30초 등)이 쓸 만한지. 끊김·빈 프레임을 '완료'로 쌓지 않는다.
 * - 프레임 수가 기대치(기록 초 × 시작 때 fps)의 MIN_FRAME_RATIO 미만: 루프가 멈췄거나 끊김
 * - 최대 프레임 간격이 MAX_GAP_MS 초과: 중간에 멈춤(화면 꺼짐·다른 앱)
 * - 얼굴이 잡힌 프레임이 전체의 MIN_VALID_RATIO 미만: 얼굴이 화면에 없었음(얼굴 없는 뷰는 예외)
 */
export const MIN_FRAME_RATIO = 0.8;
export const MAX_GAP_MS = 500;
export const MIN_VALID_RATIO = 0.5;

export interface RecordingCheck {
  ok: boolean;
  expectedFrames: number | null;
  frameRatio: number | null;
  maxGapMs: number | null;
  validRatio: number | null;
  /** 실패면 점검하는 사람이 읽을 이유, 통과인데 참고할 것이 있으면 메모. */
  reason: string | null;
}

export function checkRecording(opts: {
  seconds: number;
  fpsAtStart: number | null;
  frames: number;
  valid: number;
  intervals: readonly number[];
  /** 얼굴이 없어도 정상인 조합(정수리 뷰). */
  faceOptional: boolean;
}): RecordingCheck {
  const expectedFrames = opts.fpsAtStart !== null && opts.fpsAtStart > 0 ? Math.round(opts.seconds * opts.fpsAtStart) : null;
  const frameRatio = expectedFrames ? opts.frames / expectedFrames : null;
  const maxGapMs = opts.intervals.length ? Math.max(...opts.intervals) : null;
  const validRatio = opts.frames > 0 ? opts.valid / opts.frames : null;
  const base = { expectedFrames, frameRatio, maxGapMs, validRatio };
  if (opts.frames === 0) return { ...base, ok: false, reason: "프레임이 하나도 오지 않았습니다 — 2번에서 추론이 도는지 확인하고 다시." };
  if (frameRatio !== null && frameRatio < MIN_FRAME_RATIO) {
    return {
      ...base,
      ok: false,
      reason: `프레임이 기대치의 ${Math.round(frameRatio * 100)}%(${opts.frames}/${expectedFrames})뿐 — 끊김이 있었습니다. 다시.`,
    };
  }
  if (maxGapMs !== null && maxGapMs > MAX_GAP_MS) {
    return { ...base, ok: false, reason: `프레임 사이가 ${Math.round(maxGapMs)}ms 멈췄습니다(>${MAX_GAP_MS}) — 다시.` };
  }
  if (validRatio !== null && validRatio < MIN_VALID_RATIO) {
    if (opts.faceOptional) {
      return { ...base, ok: true, reason: `얼굴이 잡힌 프레임 ${opts.valid}/${opts.frames} — 얼굴 없는 뷰라 기록만 합니다.` };
    }
    return {
      ...base,
      ok: false,
      reason: `얼굴이 잡힌 프레임이 ${opts.valid}/${opts.frames}개뿐 — 얼굴이 화면에 들어오게 하고 다시.`,
    };
  }
  return { ...base, ok: true, reason: expectedFrames === null ? "시작 때 fps 를 몰라 끊김 비율은 재지 못했습니다." : null };
}
