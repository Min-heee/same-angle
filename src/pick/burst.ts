/**
 * 사진 여러 장(연사)에서 고르기(PRD v0.3.1 5절 "사진 여러 장에서 고를 때 달라지는 점").
 *
 * 고르는 규칙은 동영상과 **같은 함수**를 쓴다(제외 `exclude.ts`, 견줌 `compare.ts`, 고르기
 * `select.ts`, 다시 잰 뒤의 순위 `pipeline.ts` 의 `finalizeShortlist`). 여기서 가르는 것은 입력뿐이다:
 *
 *  - **순서.** 시각 대신 순번(1부터). 고른 파일을 파일 이름 순으로 세운 차례다. 엔진에는 그 순번을
 *    `timeSec` 자리에 넣는다 — 서로 다른 사진의 차가 1 이상이라 "0.3초 이상 떨어진 후보"가
 *    "서로 다른 파일"이 되고, 동률의 "이른 시각"이 "앞 순번"이 된다.
 *  - **훑기 없음.** 본 사진을 모두 한 장씩 잰다. 빠른 답은 없다.
 *  - **읽지 못한 파일.** 그 사진만 빼고 센다. 순번은 그대로 차지한다. 한 장도 읽지 못하면 S6.
 *  - **X3 의 기준.** 그 묶음에서 X1·X2 를 통과한 사진들의 선명도 중앙값.
 *  - **다시 재기.** 1등과 후보(최대 4장)의 파일을 다시 풀어 같은 방식·같은 크기로 다시 잰다.
 *
 * 이 모듈은 파일도 캔버스도 얼굴 모델도 모른다. "이 순번의 사진을 풀어 재서 달라"는 함수 하나만
 * 받는다. 사진을 쌓아 두지 않는다. 남는 것은 측정값(숫자)과 사진마다의 크기뿐이다.
 *
 * **파일 이름은 순서를 정하는 데만 쓰고 결과에 넣지 않는다.** 환자 이름이 들어 있을 수 있다.
 *
 * 순수 함수다. 실제 카메라로 찍은 사진으로는 아직 돌려 보지 못했다.
 */

import { viewToTrace } from "./direction";
import { countExclusions, countReason, sharpnessBaseline } from "./exclude";
import {
  toFrameMeasurement,
  type FaceReading,
  type FrameMeasurement,
  type FrameSize,
  type Measured,
} from "./measure";
import {
  evaluate,
  finalizeShortlist,
  toRanked,
  type AnalysisCounts,
  type AnalysisResult,
  type PhotoSetSummary,
  type Progress,
  type TraceEntry,
} from "./pipeline";
import { RULES, type Rules } from "./rules";
import { select } from "./select";

// ---------------------------------------------------------------------------
// 순서와 장수 상한

type Chunk = { digits: boolean; text: string };

function chunks(name: string): Chunk[] {
  const out: Chunk[] = [];
  for (const m of name.matchAll(/\d+|\D+/g)) out.push({ digits: /^\d/.test(m[0]), text: m[0] });
  return out;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 파일 이름의 순서. 이름 속 숫자는 수로 견준다(`IMG_2` 가 `IMG_10` 보다 앞).
 *
 * 기기 설정(로케일)에 따라 달라지지 않게 `localeCompare` 를 쓰지 않는다. 글자는 소문자로 바꿔
 * 코드 순으로, 숫자는 자릿수(앞의 0 을 뗀 뒤)와 값으로 견준다. 그래도 같으면 원래 글자대로 견준다.
 */
export function comparePhotoNames(a: string, b: string): number {
  const ca = chunks(a);
  const cb = chunks(b);
  for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
    const x = ca[i];
    const y = cb[i];
    if (x.digits && y.digits) {
      const nx = x.text.replace(/^0+(?=\d)/, "");
      const ny = y.text.replace(/^0+(?=\d)/, "");
      if (nx.length !== ny.length) return nx.length - ny.length;
      const c = byCodeUnit(nx, ny);
      if (c !== 0) return c;
    } else {
      const c = byCodeUnit(x.text.toLowerCase(), y.text.toLowerCase());
      if (c !== 0) return c;
    }
  }
  if (ca.length !== cb.length) return ca.length - cb.length;
  return byCodeUnit(a, b);
}

export interface PhotoPlan {
  /** 볼 사진: 고른 파일 목록에서의 자리(0부터). 이 배열의 i번째가 순번 i + 1 이다. */
  order: number[];
  /** 고른 파일 수. */
  selected: number;
  /** 실제로 보는 수 = min(고른 수, 상한). */
  used: number;
  /** 상한을 넘겨 보지 않는 수. */
  overLimit: number;
}

/**
 * 고른 파일을 이름 순으로 세우고(이름이 같으면 고른 순서), 상한을 넘으면 앞에서부터 상한만큼만 본다.
 * 파일 이름은 여기서만 쓰고 돌려주지 않는다.
 */
export function planPhotoSet(names: readonly string[], rules: Rules = RULES): PhotoPlan {
  const sorted = names.map((_, i) => i).sort((i, j) => comparePhotoNames(names[i], names[j]) || i - j);
  const max = Math.max(0, Math.floor(rules.photos.maxCount));
  const order = sorted.slice(0, max);
  return { order, selected: names.length, used: order.length, overLimit: names.length - order.length };
}

// ---------------------------------------------------------------------------
// 크기가 섞였는가

/**
 * 읽은 사진 가운데 가장 많은 크기(가로×세로)와, 그 크기와 다른 사진 수.
 * 가장 많은 크기가 둘 이상이면 순번이 앞인 쪽을 고른다. 읽은 사진이 없으면 null 과 0.
 */
export function sizeSummary(sizes: readonly (FrameSize | null)[]): { commonSize: FrameSize | null; sizeMismatch: number } {
  const counts = new Map<string, { size: FrameSize; n: number }>();
  let readable = 0;
  for (const s of sizes) {
    if (s === null) continue;
    readable++;
    const key = `${s.width}x${s.height}`;
    const hit = counts.get(key);
    if (hit) hit.n++;
    else counts.set(key, { size: { width: s.width, height: s.height }, n: 1 });
  }
  let best: { size: FrameSize; n: number } | null = null;
  // Map 은 넣은 순서대로 돈다. `>` 라서 같은 수면 먼저 나온(순번이 앞인) 크기가 남는다.
  for (const c of counts.values()) if (best === null || c.n > best.n) best = c;
  return best === null ? { commonSize: null, sizeMismatch: 0 } : { commonSize: best.size, sizeMismatch: readable - best.n };
}

// ---------------------------------------------------------------------------
// 분석

/** 사진 한 장을 잰 값과 그 사진의 원본 크기(회전 정보를 반영한 뒤). */
export interface PhotoReading {
  measured: Measured;
  size: FrameSize;
}

export interface AnalyzePhotosOptions {
  /** 기준 사진의 얼굴 읽기(`assessReference` 를 통과한 것). */
  reference: FaceReading;
  /** 볼 사진 수(`planPhotoSet` 의 `used`). 순번은 1 부터 이 수까지다. */
  count: number;
  /**
   * 그 순번의 사진을 풀어 재서 돌려준다. 기준 사진과 **같은 방식·같은 크기**로 재야 한다.
   * 그 파일을 읽지 못하면 null 을 돌려준다(예외를 던지면 분석 전체가 그 예외로 끝난다).
   */
  measurePhoto: (photoNumber: number, phase: "coarse" | "remeasure") => Promise<PhotoReading | null>;
  rules?: Rules;
  /** `total` 은 그 단계에서 볼 사진 수, `done` 은 지금까지 본 수(읽지 못한 것 포함). */
  onProgress?: (p: Progress) => void;
  isCancelled?: () => boolean;
  yieldToUi?: () => Promise<void>;
}

/**
 * 사진 여러 장에서 고른다. 결과의 모양은 동영상 분석과 같고(`AnalysisResult`), 장면의 `timeSec`
 * 자리에 순번이 들어 있으며, `photos` 에 묶음 정보가 붙는다.
 */
export async function analyzePhotos(opts: AnalyzePhotosOptions): Promise<AnalysisResult> {
  const rules = opts.rules ?? RULES;
  const cancelled = () => opts.isCancelled?.() === true;
  // 상한은 호출하는 쪽(`planPhotoSet`)이 이미 적용했지만 여기서 한 번 더 막는다.
  const count = Number.isFinite(opts.count) ? Math.min(Math.max(0, Math.floor(opts.count)), rules.photos.maxCount) : 0;
  const measured: AnalysisCounts = { coarse: 0, fine: 0, remeasure: 0 };
  const sizes: (FrameSize | null)[] = [];

  const summary = (): PhotoSetSummary => {
    const unreadable = sizes.filter((s) => s === null).length;
    return { count, unreadable, sizes: [...sizes], ...sizeSummary(sizes) };
  };
  type Stopped = Extract<AnalysisResult, { kind: "stopped" }>;
  const common = (over: Partial<Omit<Stopped, "kind" | "stop">>) => ({
    excluded: countExclusions([]),
    multipleFaces: 0,
    remeasureDropped: 0,
    measured,
    quickAnswer: null,
    trace: [] as TraceEntry[],
    truncated: false,
    effectiveDurationSec: 0,
    photos: summary(),
    ...over,
  });

  // 1. 모두 한 장씩 잰다. 읽지 못한 파일은 빼고 센다.
  const frames: FrameMeasurement[] = [];
  for (let n = 1; n <= count; n++) {
    if (cancelled()) return { kind: "cancelled" };
    const reading = await opts.measurePhoto(n, "coarse");
    if (reading === null) {
      sizes.push(null);
    } else {
      sizes.push({ width: reading.size.width, height: reading.size.height });
      frames.push(toFrameMeasurement(reading.measured, n, null));
      measured.coarse++;
    }
    opts.onProgress?.({ phase: "coarse", done: n, total: count });
    if (opts.yieldToUi) await opts.yieldToUi();
  }
  if (frames.length === 0) return { kind: "stopped", stop: "S6", ...common({}) };

  // 2. 제외와 견줌. X3 의 기준은 이 묶음의 중앙값이다.
  const baseline = sharpnessBaseline(frames, rules);
  const all = frames.map((m) => evaluate(opts.reference, m, "coarse", baseline, rules));

  const trace: TraceEntry[] = [];
  for (const e of all) {
    if (e.measurement.face === null) continue;
    trace.push({ timeSec: e.measurement.timeSec, ...viewToTrace(e.measurement.face.view), usable: e.exclusion === null });
  }
  const exclusions = all.map((e) => e.exclusion);
  const excluded = countExclusions(exclusions);
  const multipleFaces = countReason(exclusions, "multipleFaces");

  // 3. 고르기(동영상과 같은 함수). 순번의 차가 1 이상이라 서로 다른 파일은 늘 후보가 될 수 있다.
  const ranked = all.map(toRanked).filter((r): r is NonNullable<typeof r> => r !== null);
  const picked = select(ranked, rules);
  if (picked === null) return { kind: "stopped", stop: "S4", ...common({ excluded, multipleFaces, trace }) };
  const shortlist = [picked.winner, ...picked.runnerUps].slice(0, rules.sampling.remeasureCount);

  // 4. 다시 재기: 파일을 다시 풀어 같은 방식·같은 크기로.
  const again: (FrameMeasurement | null)[] = [];
  for (let i = 0; i < shortlist.length; i++) {
    if (cancelled()) return { kind: "cancelled" };
    const n = shortlist[i].measurement.requestedTimeSec;
    const reading = await opts.measurePhoto(n, "remeasure");
    again.push(reading === null ? null : toFrameMeasurement(reading.measured, n, null));
    measured.remeasure++;
    opts.onProgress?.({ phase: "remeasure", done: i + 1, total: shortlist.length });
    if (opts.yieldToUi) await opts.yieldToUi();
  }

  // 5. 다시 잰 값으로 순위와 판정(동영상과 같은 함수).
  const final = finalizeShortlist(opts.reference, shortlist, again, baseline, rules);
  if (final.winner === null) {
    return {
      kind: "stopped",
      stop: "S4",
      ...common({ excluded, multipleFaces, remeasureDropped: final.remeasureDropped, trace }),
    };
  }
  return {
    kind: "picked",
    winner: final.winner,
    runnerUps: final.runnerUps,
    sharpnessBaseline: baseline,
    ...common({ excluded, multipleFaces, remeasureDropped: final.remeasureDropped, trace }),
  };
}

/** 후보(또는 자취의 점)의 순번. 사진 묶음의 분석에서는 `timeSec` 자리에 순번이 들어 있다. */
export function photoNumberOf(timeSec: number): number {
  return Math.round(timeSec);
}
