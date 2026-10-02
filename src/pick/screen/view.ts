/**
 * 결과 화면이 그릴 것을 엔진의 결과에서 꺼낸다(PRD F18). **판정을 따로 계산하지 않는다** —
 * 가까움·경고·숫자는 전부 엔진의 `judgeCandidate` 가 낸 것이고, 기록(`buildPickRecord`)도 같은
 * 함수를 쓴다. 그래서 화면에 보인 판정과 저장한 기록의 판정이 다를 수 없다.
 *
 * 문구 규칙(F18):
 *  - 라벨은 "기준 사진 / 이번 사진"뿐이다. 전후 표현·화살표·판정 배지 장식이 없다.
 *  - 통과 기준을 넘는 장면은 1등이든 후보든 어디에서도 "가까운 장면"으로 적지 않는다.
 *  - 방향을 말하지 않는다(왼쪽·오른쪽). 각도 부호를 실기기로 확정하기 전이다.
 *
 * 순수 함수다.
 */

import { photoNumberOf } from "../burst";
import { anchorQuality } from "../compare";
import { viewToTrace, type TracePoint } from "../direction";
import { judgeCandidate, photoJudgeContext, type CandidateJudgement, type JudgeContext } from "../judge";
import type { FaceReading, FrameSize, Measured } from "../measure";
import {
  ALWAYS_SHOWN,
  exclusionSummary,
  formatAngle,
  formatPercent,
  formatRatio,
  photoSetNotices,
  quickAnswerMessage,
  splitWarnings,
  warningMessage,
} from "../messages";
import type { Candidate, Progress, QuickAnswerInfo, SourceKind, TraceEntry } from "../pipeline";
import { RULES, type Rules } from "../rules";
import type { Verdict } from "../select";
import type { PickedAnalysis } from "./flow";

export const LABEL_REFERENCE = "기준 사진";
export const LABEL_CURRENT = "이번 사진";
/** 보정본에 붙는 표시(F18). */
export const LABEL_CORRECTED = "기울기·크기·위치 맞춤";
export const LABEL_ORIGINAL = "원본 장면";

export interface ResultInput {
  reference: Measured & { face: FaceReading };
  /** 기준 사진의 원본 크기. */
  referenceOriginal: FrameSize;
  /** 동영상의 원본 해상도. */
  videoNative: FrameSize;
  videoDurationSec: number;
  analysis: PickedAnalysis;
  chosenRank: number;
  rules?: Rules;
}

/** 사진 여러 장에서 고른 결과를 그릴 때의 입력. 사진마다의 크기는 `analysis.photos` 에 있다. */
export interface PhotoResultInput {
  reference: Measured & { face: FaceReading };
  referenceOriginal: FrameSize;
  /** 고른 파일 수와, 순번 순서의 파일 이름(화면에만 보인다). */
  photos: { selected: number; names: readonly string[] };
  analysis: PickedAnalysis;
  chosenRank: number;
  rules?: Rules;
}

/** 입력원: 동영상이면 그 해상도와 길이, 사진 여러 장이면 "photos". */
export type SourceInput = { videoNative: FrameSize; videoDurationSec: number } | "photos";

/**
 * 후보 하나의 판정 맥락. 동영상이면 모든 후보가 같은 해상도·길이를 쓰고, 사진 여러 장이면 후보마다
 * 그 사진의 원본 크기를 쓴다(묶음에 크기가 다른 사진이 섞여 있을 수 있다). 만들 수 없으면 null.
 */
export function contextForCandidate(
  base: Pick<JudgeContext, "reference" | "referenceOriginal">,
  source: SourceInput,
  analysis: PickedAnalysis,
  candidate: Candidate,
  rules: Rules = RULES,
): JudgeContext | null {
  if (source !== "photos") return { ...base, videoNative: source.videoNative, videoDurationSec: source.videoDurationSec };
  const size = analysis.photos?.sizes[photoNumberOf(candidate.measurement.timeSec) - 1] ?? null;
  return size ? photoJudgeContext(base, size, rules) : null;
}

/** "7번째 사진(IMG_0007.JPG)". 파일 이름을 모르면 순번만. 파일 이름은 화면에만 쓴다. */
export function photoLabel(photoNumber: number, name?: string | null): string {
  return name ? `${photoNumber}번째 사진(${name})` : `${photoNumber}번째 사진`;
}

export function judgeContextOf(input: Omit<ResultInput, "analysis" | "chosenRank" | "rules">): JudgeContext {
  return {
    reference: input.reference,
    referenceOriginal: input.referenceOriginal,
    videoNative: input.videoNative,
    videoDurationSec: input.videoDurationSec,
  };
}

export function candidatesOf(analysis: PickedAnalysis): Candidate[] {
  return [analysis.winner, ...analysis.runnerUps];
}

export function candidateOf(analysis: PickedAnalysis, rank: number): Candidate | null {
  return candidatesOf(analysis).find((c) => c.rank === rank) ?? null;
}

/** 후보 하나의 숫자 묶음·보정본 틀·판정. 엔진 함수를 그대로 부른다. */
export function judgeOf(candidate: Candidate, ctx: JudgeContext, rules: Rules = RULES): CandidateJudgement {
  return judgeCandidate(
    {
      face: candidate.measurement.face,
      sharpness: candidate.measurement.sharpness,
      meanLuma: candidate.measurement.skin?.meanLuma ?? null,
      comparison: candidate.comparison,
      remeasureShiftDeg: candidate.remeasureShiftDeg,
    },
    ctx,
    rules,
  );
}

/** "동영상의 약 3.4초 장면". 탐색이 정확하다는 보장이 없어 근삿값이라고 적는다(PRD 9절). */
export function timeLabel(timeSec: number): string {
  return `약 ${timeSec.toFixed(1)}초`;
}

export interface CandidateChip {
  rank: number;
  /** 지금 화면에서 보고 있는(저장할) 장면인가. 사람이 눌러 바꾼다. */
  chosen: boolean;
  /** 도구가 고른 1등인가. 사람이 다른 후보를 눌러도 바뀌지 않는다. */
  isWinner: boolean;
  /** 썸네일 아래의 이름: "도구가 고른 장면" 또는 "후보 N". */
  name: string;
  verdict: Verdict;
  angleText: string;
  timeText: string;
  /** 누르는 것의 이름(화면 낭독기용이기도 하다). */
  label: string;
}

export interface NumberRow {
  label: string;
  value: string;
  hint?: string;
}

export interface ResultView {
  /** 입력의 종류. 화면이 "동영상"·"사진" 낱말을 고르는 데 쓴다. */
  source: SourceKind;
  /** 지금 보는 장면의 자리: "동영상의 약 3.4초" 또는 "7번째 사진(파일 이름)". */
  whereText: string;
  /** 사진 묶음에 대한 알림(읽지 못한 사진, 상한을 넘겨 보지 않은 사진, 크기가 다른 사진). 동영상이면 비어 있다. */
  inputNotices: string[];
  /** 지금 보고 있는 후보의 판정. */
  verdict: Verdict;
  /** 동영상 전체의 판정: 1등조차 통과 기준을 넘으면 true. */
  noCloseScene: boolean;
  title: string;
  /** 제목 바로 아래 한 줄: 각도 차와 기준값. */
  summary: string;
  angleText: string;
  /** 통과 기준을 넘었을 때의 안내(엔진의 W1 문장). 가까운 장면이면 null. */
  retakeAdvice: string | null;
  timeText: string;
  /** 사람이 후보로 바꿨는가. */
  switched: boolean;
  /** 보정본을 만들 수 있는가(틀을 만들지 못하면 false). */
  correctionAvailable: boolean;
  warnings: { shown: string[]; folded: string[] };
  /** 경고 코드가 없는 참고 문장(기준점이 좁게 모임 등). */
  notes: string[];
  /** 숫자 전부. */
  rows: NumberRow[];
  /** 접지 않고 늘 보이는 숫자: 각도 차와 보정량(기울기·크기·늘려 그린 배율·위치). */
  keyRows: NumberRow[];
  /** "숫자 더 보기"에 접어 두는 나머지. */
  moreRows: NumberRow[];
  candidates: CandidateChip[];
  always: readonly string[];
  judgement: CandidateJudgement;
}

/** 도구가 고른 1등의 이름. "고른 장면"만 쓰면 사람이 눌러 고른 것과 헷갈린다. */
export const NAME_WINNER = "도구가 고른 장면";

/** 접지 않고 늘 보이는 숫자의 라벨(각도 차와 보정량). 차이를 숫자로 말하는 것이 이 도구의 약속이다. */
const KEY_ROW_LABELS: readonly string[] = ["각도 차", "맞춘 기울기", "얼굴 크기 차", "늘려 그린 배율", "위치 차"];

const size = (s: FrameSize) => `${s.width}×${s.height}`;
const fixed = (v: number | null, d: number) => (v === null || !Number.isFinite(v) ? "—" : v.toFixed(d));

function chipOf(c: Candidate, chosenRank: number, rules: Rules, photos: boolean): CandidateChip {
  const angleText = formatAngle(c.comparison.angleDeg, rules.select.passDeg);
  // 후보 조각은 좁다. 사진 묶음에서는 순번만 적고, 파일 이름은 지금 보는 사진의 자리 표시에 적는다.
  const timeText = photos ? photoLabel(photoNumberOf(c.measurement.timeSec)) : timeLabel(c.measurement.timeSec);
  const name = c.rank === 1 ? NAME_WINNER : `후보 ${c.rank - 1}`;
  const chosen = c.rank === chosenRank;
  // 통과 기준을 넘는 후보에는 "가까운 장면"이라는 말을 붙이지 않는다.
  const tail = c.verdict === "close" ? `가까운 장면, 각도 차 ${angleText}` : `각도 차 ${angleText}`;
  return {
    rank: c.rank,
    chosen,
    isWinner: c.rank === 1,
    name,
    verdict: c.verdict,
    angleText,
    timeText,
    label: `${name} · ${timeText} · ${tail}${chosen ? " · 지금 보는 장면" : ""}`,
  };
}

/** 결과 화면이 그릴 것 전부. 후보를 바꾸면 그 순위로 다시 부른다. */
export function resultView(input: ResultInput | PhotoResultInput): ResultView | null {
  const rules = input.rules ?? RULES;
  const a = input.analysis;
  const chosen = candidateOf(a, input.chosenRank);
  if (chosen === null) return null;

  const photoInput = "photos" in input ? input.photos : null;
  const source: SourceKind = photoInput ? "photos" : "video";
  const base = { reference: input.reference, referenceOriginal: input.referenceOriginal };
  const ctx = contextForCandidate(base, "photos" in input ? "photos" : input, a, chosen, rules);
  if (ctx === null) return null;
  /** 지금 보는 장면의 원본 크기: 동영상 해상도 또는 그 사진의 크기. */
  const native = ctx.videoNative;
  const photoNumber = photoNumberOf(chosen.measurement.timeSec);
  const whereText = photoInput
    ? photoLabel(photoNumber, photoInput.names[photoNumber - 1])
    : `동영상의 ${timeLabel(chosen.measurement.timeSec)}`;
  const j = judgeOf(chosen, ctx, rules);
  const n = j.numbers;
  const pass = rules.select.passDeg;
  const angleText = formatAngle(n.angleDeg, pass);
  const noCloseScene = a.winner.verdict !== "close";
  const switched = chosen.rank !== 1;

  let title: string;
  if (j.verdict === "close") title = switched ? "가까운 장면입니다(바꾼 후보)" : "가까운 장면을 골랐습니다";
  else title = noCloseScene ? "가까운 장면이 없습니다" : "이 후보는 통과 기준을 넘습니다";

  const summary =
    j.verdict === "close"
      ? `각도 차 ${angleText} · 통과 기준 ${pass}° 이하`
      : `각도 차 ${angleText} · 통과 기준 ${pass}°를 넘습니다`;

  const messages = (codes: readonly (typeof j.warnings)[number][]) =>
    codes.map((code) => warningMessage(code, { numbers: n, videoNative: native, source }, rules));
  const split = splitWarnings(j.warnings, rules);

  const notes: string[] = [];
  const anchors = anchorQuality(input.reference.face, rules);
  if (!anchors.sufficient) {
    notes.push("기준 사진에서 얼굴 점들이 좁게 모여 있어 기울기·크기 맞춤이 덜 정확할 수 있습니다.");
  }
  if (j.output === null) notes.push("기준 사진의 크기를 알 수 없어 보정본을 만들지 못했습니다. 원본 장면만 보입니다.");
  if (a.remeasureDropped > 0) {
    notes.push(`다시 쟀더니 쓸 수 없게 된 ${photoInput ? "사진" : "장면"} ${a.remeasureDropped}장을 버렸습니다.`);
  }

  const c = chosen.comparison;
  const sharpRatio =
    n.sharpness !== null && n.referenceSharpness !== null && n.referenceSharpness > 0
      ? n.sharpness / n.referenceSharpness
      : null;
  const rows: NumberRow[] = [
    { label: "각도 차", value: angleText, hint: `통과 기준 ${pass}° 이하. 찍은 뒤에는 고칠 수 없습니다` },
    photoInput
      ? {
          label: "고른 사진",
          value: whereText,
          hint: `본 ${a.photos?.count ?? photoInput.selected}장 가운데. 순번은 파일 이름 순입니다`,
        }
      : { label: "고른 시각", value: whereText, hint: "근삿값입니다" },
    { label: "고른 순서", value: switched ? `사람이 바꾼 후보(${chosen.rank}번째)` : "도구가 고른 1등" },
    { label: "맞춘 기울기", value: `${Math.abs(c.rotationDeg).toFixed(1)}°`, hint: "회전으로 맞춘 양" },
    {
      label: "얼굴 크기 차",
      value: `${formatRatio(1 / c.frameScale)}배`,
      hint: "이번 장면의 얼굴이 화면에서 차지하는 크기 ÷ 기준 사진",
    },
    {
      label: "늘려 그린 배율",
      value: n.qualityScale === null ? "—" : `${formatRatio(n.qualityScale)}배`,
      hint: photoInput ? "고른 사진의 한 픽셀이 보정본에서 몇 픽셀인가" : "장면의 한 픽셀이 보정본에서 몇 픽셀인가",
    },
    { label: "위치 차", value: formatPercent(c.position), hint: "화면 짧은 변 대비" },
    { label: "맞춘 뒤 남는 어긋남", value: formatPercent(c.residual), hint: "눈 사이 거리 대비" },
    { label: "선명도", value: sharpRatio === null ? "—" : `기준 사진의 ${formatRatio(sharpRatio)}배` },
    {
      label: "밝기(피부 평균)",
      value: `${fixed(n.meanLuma, 0)} / 기준 ${fixed(n.referenceMeanLuma, 0)}`,
      hint: "0~255. 같은 조명이라는 뜻은 아닙니다",
    },
    { label: "머리 둘레 빈 곳", value: n.roiEmptyFraction === null ? "—" : formatPercent(n.roiEmptyFraction) },
    {
      label: "보정본 전체 빈 곳",
      value: j.output?.totalEmptyFraction == null ? "—" : formatPercent(j.output.totalEmptyFraction),
      hint: "채우지 않고 회색으로 둡니다",
    },
    { label: "다시 잰 방향 차", value: n.remeasureShiftDeg === null ? "—" : `${n.remeasureShiftDeg.toFixed(2)}°` },
    { label: "기준 사진 해상도", value: size(input.referenceOriginal) },
    photoInput
      ? { label: "고른 사진 해상도", value: size(native), hint: "보정본은 이보다 작을 수 있습니다. 온전한 화소는 원본 파일에 있습니다" }
      : { label: "동영상 해상도", value: size(native), hint: "동영상 장면은 사진보다 화질이 낮습니다" },
    { label: "보정본 크기", value: j.output ? size(j.output.size) : "—" },
    photoInput
      ? {
          label: "잰 사진",
          value: `${a.measured.coarse}장(+다시 잰 ${a.measured.remeasure}장)`,
          hint: `고른 ${photoInput.selected}장 가운데`,
        }
      : {
          label: "잰 장면",
          value: `${a.measured.coarse + a.measured.fine}장(+다시 잰 ${a.measured.remeasure}장)`,
        },
    {
      label: photoInput ? "뺀 사진" : "뺀 장면",
      value: `${a.excluded.total}장`,
      // 0장인 사유는 적지 않는다. 얼굴이 둘 이상이던 장면은 "얼굴 없음"과 따로 적는다.
      hint: exclusionSummary(a.excluded, a.multipleFaces) || undefined,
    },
  ];
  const keyRows = rows.filter((r) => KEY_ROW_LABELS.includes(r.label));
  const moreRows = rows.filter((r) => !KEY_ROW_LABELS.includes(r.label));

  return {
    source,
    whereText,
    inputNotices:
      photoInput && a.photos
        ? photoSetNotices(a.photos, photoInput.selected, a.photos.count, rules)
        : [],
    verdict: j.verdict,
    noCloseScene,
    title,
    summary,
    angleText,
    retakeAdvice:
      j.verdict === "close" ? null : warningMessage("W1", { numbers: n, videoNative: native, source }, rules),
    timeText: photoInput ? photoLabel(photoNumber) : timeLabel(chosen.measurement.timeSec),
    switched,
    correctionAvailable: j.output !== null,
    warnings: { shown: messages(split.shown), folded: messages(split.folded) },
    notes,
    rows,
    keyRows,
    moreRows,
    candidates: candidatesOf(a).map((cand) => chipOf(cand, input.chosenRank, rules, photoInput !== null)),
    always: ALWAYS_SHOWN,
    judgement: j,
  };
}

// ---------------------------------------------------------------------------
// 진행 표시

export interface ProgressView {
  /** 지금 하는 일. */
  label: string;
  /** "24장면 중 7장면". 아직 모르면 null. */
  count: string | null;
  /** 전체 진행(0~1). 단계마다 몫을 나눈 어림이다. */
  fraction: number;
  /** 거친 훑기가 끝나면 먼저 보이는 답. 최종 판정이 아니다. */
  quick: string | null;
}

const PHASE_LABEL: Record<Progress["phase"], string> = {
  coarse: "동영상 전체를 훑어보는 중",
  fine: "가까운 구간을 자세히 보는 중",
  remeasure: "고른 장면을 다시 재는 중",
};

/** 단계별 몫(시작, 폭). 촘촘히 훑을 장면 수는 거친 훑기가 끝나야 알 수 있어 몫으로 나눈다. */
const PHASE_SPAN: Record<Progress["phase"], readonly [number, number]> = {
  coarse: [0, 0.45],
  fine: [0.45, 0.47],
  remeasure: [0.92, 0.08],
};

/** 사진 여러 장: 훑기가 한 번뿐이라 몫이 다르다. 촘촘히 훑기는 없다. */
const PHOTO_PHASE_LABEL: Record<Progress["phase"], string> = {
  coarse: "사진을 한 장씩 재는 중",
  fine: "사진을 한 장씩 재는 중",
  remeasure: "고른 사진을 다시 재는 중",
};
const PHOTO_PHASE_SPAN: Record<Progress["phase"], readonly [number, number]> = {
  coarse: [0, 0.9],
  fine: [0, 0.9],
  remeasure: [0.9, 0.1],
};

export function progressView(
  progress: Progress | null,
  quickAnswer: QuickAnswerInfo | null,
  source: SourceKind = "video",
): ProgressView {
  const quick = quickAnswer ? quickAnswerMessage(quickAnswer.answer) : null;
  if (source === "photos") {
    if (progress === null) return { label: "사진을 준비하는 중", count: null, fraction: 0, quick: null };
    const [start, span] = PHOTO_PHASE_SPAN[progress.phase];
    const part = progress.total > 0 ? Math.min(1, Math.max(0, progress.done / progress.total)) : 0;
    return {
      label: PHOTO_PHASE_LABEL[progress.phase],
      count: `${progress.total}장 중 ${progress.done}장`,
      fraction: Math.min(1, start + span * part),
      quick: null,
    };
  }
  if (progress === null) return { label: "동영상을 여는 중", count: null, fraction: 0, quick };
  const [start, span] = PHASE_SPAN[progress.phase];
  const part = progress.total > 0 ? Math.min(1, Math.max(0, progress.done / progress.total)) : 0;
  return {
    label: PHASE_LABEL[progress.phase],
    count: `${progress.total}장면 중 ${progress.done}장면`,
    fraction: Math.min(1, start + span * part),
    quick,
  };
}

// ---------------------------------------------------------------------------
// 자취 그림

export interface TracePlot {
  /** 정사각형 그림의 한 변(viewBox). */
  size: number;
  /** 가운데(기준 방향)에서 가장자리까지의 각(°). */
  rangeDeg: number;
  /** 통과 기준 원의 반지름(그림 단위). */
  passRadius: number;
  center: { x: number; y: number };
  points: { x: number; y: number; usable: boolean; timeSec: number }[];
  /** 지금 보고 있는 후보의 자리. */
  chosen: { x: number; y: number } | null;
  /** 눈금 원(°)과 그 반지름. */
  rings: { deg: number; r: number }[];
}

/**
 * 자취 그림: 동영상이 지나간 방향들을 점으로, 기준 방향을 가운데의 통과 기준 원으로(PRD 5절 끝).
 *
 * 가운데가 기준 방향이다. 가로는 좌우, 세로는 위아래로 벗어난 각이고 **어느 쪽이 왼쪽인지는
 * 적지 않는다**. 각이 클 때 가로·세로 2값 평면의 거리는 실제 각도 차와 조금 다르다(어림 그림).
 */
export function tracePlot(
  trace: readonly TraceEntry[],
  reference: TracePoint,
  chosen: TracePoint | null,
  passDeg: number = RULES.select.passDeg,
  size = 280,
): TracePlot {
  const rel = (p: TracePoint) => ({ dh: p.h - reference.h, dv: p.v - reference.v });
  let far = passDeg * 2;
  for (const t of trace) {
    const r = rel(t);
    if (Number.isFinite(r.dh) && Number.isFinite(r.dv)) far = Math.max(far, Math.abs(r.dh), Math.abs(r.dv));
  }
  if (chosen) {
    const r = rel(chosen);
    if (Number.isFinite(r.dh) && Number.isFinite(r.dv)) far = Math.max(far, Math.abs(r.dh), Math.abs(r.dv));
  }
  // 5° 단위로 올림. 가장 먼 점이 가장자리에 붙지 않게 여유를 둔다.
  const rangeDeg = Math.ceil((far * 1.1) / 5) * 5;
  const half = size / 2;
  const k = half / rangeDeg;
  const at = (p: TracePoint) => {
    const r = rel(p);
    // 화면의 y 는 아래로 자란다. 위아래를 뒤집어 그린다(어느 쪽이 위인지도 확정 전이라 이름은 없다).
    return { x: half + r.dh * k, y: half - r.dv * k };
  };
  const rings: { deg: number; r: number }[] = [];
  const stepDeg = rangeDeg <= 10 ? 5 : rangeDeg <= 30 ? 10 : 20;
  for (let d = stepDeg; d <= rangeDeg; d += stepDeg) rings.push({ deg: d, r: d * k });
  return {
    size,
    rangeDeg,
    passRadius: passDeg * k,
    center: { x: half, y: half },
    points: trace
      .filter((t) => Number.isFinite(t.h) && Number.isFinite(t.v))
      .map((t) => ({ ...at(t), usable: t.usable, timeSec: t.timeSec })),
    chosen: chosen && Number.isFinite(chosen.h) && Number.isFinite(chosen.v) ? at(chosen) : null,
    rings,
  };
}

/** 후보의 보는 방향을 자취 그림의 2값으로. */
export function traceOfCandidate(c: Candidate): TracePoint {
  return viewToTrace(c.measurement.face.view);
}

// ---------------------------------------------------------------------------
// 저장 안내

export interface SaveGate {
  /** 저장할 때 사유를 골라야 하는가("가까운 장면 없음" 표시 그대로 저장). */
  needsReason: boolean;
  /** 저장 버튼 위에 보이는 안내. 없으면 null. */
  notice: string | null;
}

/**
 * 저장 전 안내(PRD 3절 5번, W1, F20).
 *
 * 통과 기준을 넘는 장면도 저장은 된다. 대신 사유를 골라야 하고, 이미지 띠와 기록에 그 사실이 남는다.
 * 다시 찍기는 두 번까지 권한다 [가정]. 저장을 막지는 않는다.
 */
export function saveGate(verdict: Verdict, retakeCount: number, retakeLimit: number): SaveGate {
  if (verdict === "close") return { needsReason: false, notice: null };
  if (retakeCount < retakeLimit) {
    return {
      needsReason: true,
      notice: `통과 기준을 넘는 장면입니다. 다시 찍기를 먼저 권합니다(다시 찍은 횟수 ${retakeCount}번, ${retakeLimit}번까지 권장). 그래도 저장하면 사진 아래 띠와 기록에 통과 기준을 넘었다는 표시가 남습니다.`,
    };
  }
  return {
    needsReason: true,
    notice: `${retakeCount}번 다시 찍었습니다. 사유를 고르고 저장해 주세요. 사진 아래 띠와 기록에 통과 기준을 넘었다는 표시가 남습니다.`,
  };
}

// ---------------------------------------------------------------------------
// 가까운 장면이 없을 때 먼저 보이는 안내

export interface HoldBackView {
  /** 다시 찍기 상한을 채웠는가. */
  exhausted: boolean;
  /** 사진을 보이기 전에 먼저 보이는 문장. */
  message: string;
  /** 주 버튼이 하는 일과 이름. 상한을 채우기 전에는 다시 찍기, 채운 뒤에는 보고 저장하기. */
  primary: { action: "retake" | "show"; label: string };
  secondary: { action: "retake" | "show"; label: string };
}

/**
 * "가까운 장면 없음"일 때 사진보다 먼저 보이는 안내(PRD 3절 5번).
 *
 * 다시 찍기는 `retakeLimit` 번까지만 권한다. 상한을 채운 뒤에도 "다시 찍기를 권합니다"와 다시 찍기
 * 버튼이 맨 앞에 나오면 촬영 담당이 끝없이 다시 찍게 된다. 그래서 상한을 채우면 문장과 주 버튼을
 * 바꾼다: 가장 가까운 장면을 보고, 사유를 골라 "가까운 장면 없음" 표시 그대로 저장한다.
 *
 * 어느 쪽으로 더 움직여야 하는지는 말하지 않는다(각도 부호를 실기기로 확정하기 전).
 */
export function holdBackView(
  view: Pick<ResultView, "angleText" | "retakeAdvice">,
  retakeCount: number,
  retakeLimit: number,
  source: SourceKind = "video",
): HoldBackView {
  // 다시 찍기는 ② 로 돌아가는 것이라 어느 쪽으로든 다시 찍을 수 있다. 낱말만 들어온 입력에 맞춘다.
  const what = source === "photos" ? "사진들" : "동영상";
  const nearest = `가장 가까운 장면은 ${view.angleText} 차이입니다.`;
  const noDirection = "어느 쪽으로 더 움직여야 하는지는 아직 말해 주지 못합니다. 아래 그림에서 얼마나 빗나갔는지만 볼 수 있습니다.";
  if (retakeCount < retakeLimit) {
    return {
      exhausted: false,
      // 엔진의 W1 문장 그대로("가장 가까운 장면은 N° 차이입니다. 다시 찍기를 권합니다.").
      message: `${view.retakeAdvice ?? `${nearest} 다시 찍기를 권합니다.`} ${noDirection}`,
      primary: { action: "retake", label: `다시 찍은 ${what} 고르기` },
      secondary: { action: "show", label: "그래도 가장 가까운 장면 보기" },
    };
  }
  return {
    exhausted: true,
    message: `${nearest} ${retakeCount}번 다시 찍었습니다. 더 찍지 않아도 됩니다. 가장 가까운 장면을 보고, 사유를 골라 “가까운 장면 없음” 표시 그대로 저장해 주세요.`,
    primary: { action: "show", label: "가장 가까운 장면 보고 저장하기" },
    secondary: { action: "retake", label: `한 번 더 찍은 ${what} 고르기` },
  };
}
