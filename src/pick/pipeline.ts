/**
 * 동영상 분석의 순서: 거친 훑기 → 빠른 답 → 촘촘히 훑기 → 고르기 → 다시 재기 → 판정.
 *
 * 이 모듈은 동영상도 캔버스도 얼굴 모델도 모른다. "이 시각의 장면을 재서 달라"는 함수
 * (`measureAt`) 하나만 받는다. 브라우저에서는 접착부(`glue/`)가 그 함수를 주고, 시험에서는 합성
 * 궤적이 준다. 그래서 순서·제외·고르기·다시 재기 전체를 노드에서 시험할 수 있다.
 *
 * 장면 이미지를 쌓아 두지 않는다. 남는 것은 측정값(숫자)뿐이다.
 *
 * **다시 재기.** 1등과 후보(최대 4장)를 같은 시각으로 다시 가서 같은 방식으로 다시 잰다.
 * 순위·판정·기록·보정에는 다시 잰 값을 쓴다 — 탐색이 같은 장면을 돌려준다는 보장이 없기 때문이다.
 * 다시 쟀더니 제외 조건에 걸린 장면은 버린다. 네 장이 모두 버려지면 그다음 순위를 찾아 내려가지
 * 않고 "쓸 수 있는 장면 없음"(S4)으로 멈춘다 [가정: PRD 가 정하지 않은 경우].
 */

import { compareToReference, type Comparison } from "./compare";
import { angleBetweenDeg, viewToTrace } from "./direction";
import {
  countExclusions,
  countReason,
  exclusionOf,
  sharpnessBaseline,
  type Exclusion,
  type ExclusionCounts,
} from "./exclude";
import type { FaceReading, FrameMeasurement, FrameSize } from "./measure";
import { coarsePlan, fineCenters, finePlan, quickAnswerOf, type QuickAnswer } from "./plan";
import { RULES, type Rules } from "./rules";
import { rerank, select, verdictOf, type Rankable, type Verdict } from "./select";

export type ScanPhase = "coarse" | "fine" | "remeasure";

/** 입력의 종류: 동영상 1개 또는 사진 여러 장(연사, PRD v0.3.1). */
export type SourceKind = "video" | "photos";

/**
 * 사진 여러 장에서 고른 분석에만 붙는 묶음 정보(`burst.ts` 의 `analyzePhotos` 가 채운다).
 * 파일 이름은 여기에 없다 — 순번으로만 가리킨다.
 */
export interface PhotoSetSummary {
  /** 본 사진 수(상한을 적용한 뒤). 순번은 1 부터 이 수까지다. */
  count: number;
  /** 읽지 못해 뺀 사진 수. */
  unreadable: number;
  /** 사진마다의 원본 크기(회전 정보를 반영한 뒤). `sizes[순번 − 1]`. 읽지 못했으면 null. */
  sizes: (FrameSize | null)[];
  /** 읽은 사진 가운데 가장 많은 크기. 한 장도 읽지 못했으면 null. */
  commonSize: FrameSize | null;
  /** 가장 많은 크기와 가로·세로가 다른 사진 수. */
  sizeMismatch: number;
}

export interface Progress {
  phase: ScanPhase;
  /** 이 단계에서 잰 장면 수. */
  done: number;
  /** 이 단계에서 잴 장면 수. */
  total: number;
}

export interface QuickAnswerInfo {
  answer: QuickAnswer;
  /** 거친 훑기에서 가장 작은 각도차(°). 쓸 수 있는 장면이 없으면 null. */
  minAngleDeg: number | null;
}

export interface AnalyzeOptions {
  /** 기준 사진의 얼굴 읽기(`assessReference` 를 통과한 것). */
  reference: FaceReading;
  /** 동영상 길이(초). */
  durationSec: number;
  /**
   * 그 시각의 장면을 재서 돌려준다. 기준 사진과 **같은 방식·같은 크기**로 재야 한다.
   * 장면을 읽지 못하면 예외를 던진다(분석 전체가 그 예외로 끝난다).
   */
  measureAt: (timeSec: number, phase: ScanPhase) => Promise<FrameMeasurement>;
  rules?: Rules;
  onProgress?: (p: Progress) => void;
  /** 거친 훑기가 끝나면 한 번 불린다. 최종 판정이 아니다. */
  onQuickAnswer?: (q: QuickAnswerInfo) => void;
  /** true 를 돌려주면 다음 장면을 재기 전에 그만둔다. */
  isCancelled?: () => boolean;
  /** 장면 사이마다 불린다. 얼굴 모델 호출이 화면을 멈추므로 여기서 화면에 차례를 넘긴다. */
  yieldToUi?: () => Promise<void>;
}

/** 자취 그림의 점 하나: 거친 훑기 장면의 시각과 보는 방향 2값. */
export interface TraceEntry {
  timeSec: number;
  h: number;
  v: number;
  /** 제외 조건에 걸리지 않은 장면인가. */
  usable: boolean;
}

type MeasuredFace = FrameMeasurement & { face: FaceReading };

export interface Candidate {
  /** 다시 잰 값으로 매긴 순위. 1 이 1등. */
  rank: number;
  /** 다시 재기 전의 순위. 다르면 다시 재면서 순위가 바뀐 것이다. */
  analysisRank: number;
  /** 다시 잰 측정값. 보정·판정·기록에 쓴다. */
  measurement: MeasuredFace;
  /** 다시 잰 값으로 견준 결과. */
  comparison: Comparison;
  /** 다시 잰 각도차로 한 가까움 판정. 후보마다 따로 붙는다. */
  verdict: Verdict;
  /** 분석(다시 재기 전) 때의 값. */
  analysis: { timeSec: number; requestedTimeSec: number; angleDeg: number; score: number; phase: ScanPhase };
  /** 분석 때와 다시 쟀을 때 보는 방향의 차(°). W5 의 재료. */
  remeasureShiftDeg: number;
}

export interface AnalysisCounts {
  coarse: number;
  fine: number;
  remeasure: number;
}

interface Common {
  /** 뺀 장면 수(사유별). 거친·촘촘히 훑기 장면이 대상이다. */
  excluded: ExclusionCounts;
  /**
   * X1 로 뺀 장면 가운데 **얼굴이 둘 이상**이어서 뺀 수. 뒤에 선 사람이나 거울 때문에 멈췄을 때
   * "얼굴 없음"으로 뭉뚱그리지 않고 원인을 말하려는 것이다. 화면 문장에만 쓰고 기록에는 넣지 않는다
   * (기록의 `excluded.X1` 에 이미 들어 있다).
   */
  multipleFaces: number;
  /** 다시 쟀더니 제외 조건에 걸려 버린 장면 수. */
  remeasureDropped: number;
  measured: AnalysisCounts;
  quickAnswer: QuickAnswerInfo | null;
  trace: TraceEntry[];
  /** 60초를 넘어 앞부분만 봤는가. */
  truncated: boolean;
  effectiveDurationSec: number;
  /** 사진 여러 장에서 고른 분석이면 그 묶음의 정보. 동영상이면 없다. */
  photos?: PhotoSetSummary;
}

export type AnalysisResult =
  | { kind: "cancelled" }
  | ({ kind: "stopped"; stop: "S3" | "S4" | "S6" } & Common)
  | ({
      kind: "picked";
      /** 1등. `verdict` 가 "notClose" 면 "가까운 장면 없음"이다. */
      winner: Candidate;
      /** 차점 후보(최대 3장, 없을 수 있음). */
      runnerUps: Candidate[];
      /** X3 의 기준이 된 선명도 중앙값. */
      sharpnessBaseline: number | null;
    } & Common);

export interface Evaluated {
  measurement: FrameMeasurement;
  phase: ScanPhase;
  exclusion: Exclusion | null;
  comparison: Comparison | null;
}

export interface Ranked extends Rankable {
  measurement: MeasuredFace;
  comparison: Comparison;
  phase: ScanPhase;
}

/** 장면 하나의 제외 판정과 기준 사진과의 견줌. 동영상과 사진 묶음이 함께 쓴다. */
export function evaluate(
  reference: FaceReading,
  measurement: FrameMeasurement,
  phase: ScanPhase,
  baseline: number | null,
  rules: Rules,
): Evaluated {
  const exclusion = exclusionOf(measurement, baseline, rules);
  if (exclusion !== null || measurement.face === null) return { measurement, phase, exclusion, comparison: null };
  const comparison = compareToReference(reference, measurement.face, rules);
  if (comparison === null) {
    return { measurement, phase, exclusion: { code: "X1", reason: "landmarksUnreadable" }, comparison: null };
  }
  return { measurement, phase, exclusion: null, comparison };
}

/** 고르기에 넣을 수 있는 장면이면 그 값을, 아니면 null. */
export function toRanked(e: Evaluated): Ranked | null {
  if (e.exclusion !== null || e.comparison === null || e.measurement.face === null) return null;
  if (e.measurement.sharpness === null) return null;
  return {
    timeSec: e.measurement.timeSec,
    angleDeg: e.comparison.angleDeg,
    score: e.comparison.score,
    sharpness: e.measurement.sharpness,
    measurement: e.measurement as MeasuredFace,
    comparison: e.comparison,
    phase: e.phase,
  };
}

const notNull = <T>(v: T | null): v is T => v !== null;

export type FinalSelection =
  | { winner: Candidate; runnerUps: Candidate[]; remeasureDropped: number }
  | { winner: null; runnerUps: []; remeasureDropped: number };

/**
 * 다시 잰 값으로 순위와 판정을 매긴다(6단계). 동영상과 사진 묶음이 함께 쓴다.
 *
 * `again[i]` 는 `shortlist[i]` 를 다시 잰 값이다. 다시 재지 못했거나(null — 사진 파일을 다시 풀지
 * 못한 경우) 다시 쟀더니 제외 조건에 걸린 장면은 버린다. 모두 버려지면 그다음 순위를 찾아 내려가지
 * 않는다(`winner` 가 null).
 */
export function finalizeShortlist(
  reference: FaceReading,
  shortlist: readonly Ranked[],
  again: readonly (FrameMeasurement | null)[],
  baseline: number | null,
  rules: Rules,
): FinalSelection {
  let remeasureDropped = 0;
  const survivors: (Ranked & { analysisRank: number; before: Ranked })[] = [];
  again.forEach((m, i) => {
    const r = m === null ? null : toRanked(evaluate(reference, m, "remeasure", baseline, rules));
    if (r === null) {
      remeasureDropped++;
      return;
    }
    survivors.push({ ...r, analysisRank: i + 1, before: shortlist[i] });
  });

  const final = rerank(survivors, rules);
  if (final === null) return { winner: null, runnerUps: [], remeasureDropped };

  const toCandidate = (s: (typeof survivors)[number], rank: number): Candidate => ({
    rank,
    analysisRank: s.analysisRank,
    measurement: s.measurement,
    comparison: s.comparison,
    verdict: verdictOf(s.comparison.angleDeg, rules),
    analysis: {
      timeSec: s.before.timeSec,
      requestedTimeSec: s.before.measurement.requestedTimeSec,
      angleDeg: s.before.angleDeg,
      score: s.before.score,
      phase: s.before.phase,
    },
    remeasureShiftDeg: angleBetweenDeg(s.before.measurement.face.view, s.measurement.face.view),
  });

  return {
    winner: toCandidate(final.winner, 1),
    runnerUps: final.runnerUps.map((s, i) => toCandidate(s, i + 2)),
    remeasureDropped,
  };
}

/** 동영상 하나를 분석한다. */
export async function analyze(opts: AnalyzeOptions): Promise<AnalysisResult> {
  const rules = opts.rules ?? RULES;
  const cancelled = () => opts.isCancelled?.() === true;
  const plan = coarsePlan(opts.durationSec, rules);
  const measured: AnalysisCounts = { coarse: 0, fine: 0, remeasure: 0 };

  const common = (over: Partial<Common>): Common => ({
    excluded: countExclusions([]),
    multipleFaces: 0,
    remeasureDropped: 0,
    measured,
    quickAnswer: null,
    trace: [],
    truncated: plan.truncated,
    effectiveDurationSec: plan.effectiveDurationSec,
    ...over,
  });

  if (plan.times.length === 0) return { kind: "stopped", stop: "S3", ...common({}) };

  const scan = async (times: readonly number[], phase: ScanPhase): Promise<FrameMeasurement[] | null> => {
    const out: FrameMeasurement[] = [];
    for (const t of times) {
      if (cancelled()) return null;
      out.push(await opts.measureAt(t, phase));
      measured[phase]++;
      opts.onProgress?.({ phase, done: out.length, total: times.length });
      if (opts.yieldToUi) await opts.yieldToUi();
    }
    return out;
  };

  // 1. 거친 훑기
  const coarseRaw = await scan(plan.times, "coarse");
  if (coarseRaw === null) return { kind: "cancelled" };
  const baseline = sharpnessBaseline(coarseRaw, rules);
  const coarse = coarseRaw.map((m) => evaluate(opts.reference, m, "coarse", baseline, rules));

  const trace: TraceEntry[] = [];
  for (const e of coarse) {
    if (e.measurement.face === null) continue;
    trace.push({ timeSec: e.measurement.timeSec, ...viewToTrace(e.measurement.face.view), usable: e.exclusion === null });
  }

  // 2. 빠른 답
  const coarseRanked = coarse.map(toRanked).filter(notNull);
  let minAngleDeg: number | null = null;
  for (const r of coarseRanked) if (minAngleDeg === null || r.angleDeg < minAngleDeg) minAngleDeg = r.angleDeg;
  const quickAnswer: QuickAnswerInfo = { answer: quickAnswerOf(minAngleDeg, rules), minAngleDeg };
  opts.onQuickAnswer?.(quickAnswer);

  if (coarseRanked.length === 0) {
    const exclusions = coarse.map((e) => e.exclusion);
    return {
      kind: "stopped",
      stop: "S4",
      ...common({
        excluded: countExclusions(exclusions),
        multipleFaces: countReason(exclusions, "multipleFaces"),
        quickAnswer,
        trace,
      }),
    };
  }

  // 3. 촘촘히 훑기
  const centers = fineCenters(coarseRanked, rules);
  const fineTimes = finePlan(centers, plan.times, plan.effectiveDurationSec, rules);
  const fineRaw = await scan(fineTimes, "fine");
  if (fineRaw === null) return { kind: "cancelled" };
  const fine = fineRaw.map((m) => evaluate(opts.reference, m, "fine", baseline, rules));

  const all = [...coarse, ...fine];
  const exclusions = all.map((e) => e.exclusion);
  const excluded = countExclusions(exclusions);
  const multipleFaces = countReason(exclusions, "multipleFaces");

  // 4. 고르기(분석 값으로)
  const picked = select(all.map(toRanked).filter(notNull), rules);
  if (picked === null) return { kind: "stopped", stop: "S4", ...common({ excluded, multipleFaces, quickAnswer, trace }) };
  const shortlist = [picked.winner, ...picked.runnerUps].slice(0, rules.sampling.remeasureCount);

  // 5. 다시 재기
  const again = await scan(
    shortlist.map((r) => r.measurement.requestedTimeSec),
    "remeasure",
  );
  if (again === null) return { kind: "cancelled" };

  const final = finalizeShortlist(opts.reference, shortlist, again, baseline, rules);
  if (final.winner === null) {
    return {
      kind: "stopped",
      stop: "S4",
      ...common({ excluded, multipleFaces, remeasureDropped: final.remeasureDropped, quickAnswer, trace }),
    };
  }

  return {
    kind: "picked",
    winner: final.winner,
    runnerUps: final.runnerUps,
    sharpnessBaseline: baseline,
    ...common({ excluded, multipleFaces, remeasureDropped: final.remeasureDropped, quickAnswer, trace }),
  };
}
