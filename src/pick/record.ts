/**
 * 고르기 결과의 기록(JSON): 빌더, 검증기, 다시 판정(PRD 5절 "기록에 남는 것", F19).
 *
 * `core/report.ts`(아이폰 점검 전용 형식)와는 다른 종류의 기록이다. 검사 규칙(금지 키·길이·총량·
 * 유한성)은 그쪽 도우미를 그대로 쓴다.
 *
 *  1. **얼굴이 담긴 것은 들어가지 않는다.** 랜드마크·기준점 좌표·이미지는 필드가 없다. 자취는 거친
 *     훑기 장면의 시각과 보는 방향 2값뿐이다. 기록 전체의 수는 900개 한도 안이다.
 *  2. **빠진 값을 채우지 않는다.** 재지 못한 값은 null 로 적고, 필드 누락·모르는 필드·유한하지 않은
 *     수·버전 불일치는 거부한다.
 *  3. **다시 읽으면 같은 판정이 나온다.** 후보마다 판정에 쓴 숫자 전부(`numbers`)와 규칙 값 전부
 *     (`rules`)가 들어 있어서, `rejudge` 가 살아 있는 결과와 같은 함수(`judge`)로 가까움 판정과
 *     경고를 다시 낸다. 되살릴 수 있는 것은 **판정과 경고**이고 고르기 자체는 아니다(모든 장면의
 *     표는 넣지 않는다).
 *
 * **사진 여러 장에서 고른 기록(PRD v0.3.1)** 은 종류 이름이 다른 별도 형식(`PhotoPickRecord`)이다.
 * 동영상 기록의 형식은 그대로 둔다. 사진 기록에는 입력 종류·장수·고른 순번이 들어가고, 시각·길이
 * 칸이 없다. **파일 이름은 넣지 않는다** — 빌더가 파일 이름을 받지도 않는다.
 *
 * 환자를 가리키는 값은 넣지 않는다. 자유 메모는 사용자가 쓴 그대로 들어가므로, 이름 대신 병원이
 * 쓰는 번호를 권한다(화면 안내).
 *
 * 순수 함수다. 시계를 부르지 않고(createdAt 은 호출하는 쪽이 넣는다) 해시도 계산하지 않는다
 * (접착부가 기기 안에서 계산해 넘긴다).
 */

import {
  checkBudget,
  checkFiniteNumber,
  checkJson,
  checkKeys,
  isPlainObject,
  newBudget,
  type Errors,
} from "@/core/report";
import { photoNumberOf } from "./burst";
import { anchorQuality } from "./compare";
import { viewToTrace } from "./direction";
import type { ExclusionCounts } from "./exclude";
import {
  WARNING_ORDER,
  judge,
  judgeCandidate,
  orientationOf,
  photoJudgeContext,
  type JudgeContext,
  type JudgeNumbers,
  type Judgement,
  type Orientation,
  type StopCode,
  type WarningCode,
} from "./judge";
import type { FaceReading, FrameSize, Measured } from "./measure";
import type { AnalysisResult, Candidate, ScanPhase } from "./pipeline";
import type { QuickAnswer } from "./plan";
import { RULES, RULES_VERSION, type Rules } from "./rules";
import type { Verdict } from "./select";
import { rotationDegOf, scaleOf } from "./similarity";

export const PICK_RECORD_KIND = "same-angle-pick-record";
/** 형식을 바꾸면 올린다. 다른 버전은 읽지 않는다. */
export const PICK_RECORD_VERSION = 1;

export const SHOT_KINDS = ["front", "frontDown", "leftOblique", "rightOblique"] as const;
export type ShotKind = (typeof SHOT_KINDS)[number];

/** 자유 메모·사유 메모의 최대 길이(글자). */
export const MAX_MEMO_LENGTH = 500;
/** 후보 수의 상한(1등 + 차점 후보 3). */
export const MAX_RECORD_CANDIDATES = 4;

export interface RecordCandidate {
  /** 다시 잰 값으로 매긴 순위(1 이 1등)와 다시 재기 전의 순위. */
  rank: number;
  analysisRank: number;
  /** 고른 시각(초): 실제 장면 시각과 요청한 시각. */
  timeSec: number;
  requestedTimeSec: number;
  /** `timeSec` 이 브라우저가 알려 준 값인가. */
  timeIsReported: boolean;
  /** 분석(다시 재기 전) 때의 값. */
  analysis: { timeSec: number; angleDeg: number; score: number; phase: ScanPhase };
  /** 판정에 쓴 숫자 전부. */
  numbers: JudgeNumbers;
  verdict: Verdict;
  warnings: WarningCode[];
  /** 점수. */
  score: number;
  /** 보는 방향 2값과 참고용 축별 각(°). */
  direction: { h: number; v: number };
  axes: { yaw: number; pitch: number; roll: number };
  /**
   * 보정량: 장면 원본 픽셀 → 출력 픽셀의 닮음 변환(회전 °, 배율, 이동 픽셀)과 출력 크기.
   * 보정본의 틀을 만들지 못했으면 null.
   */
  correction: {
    rotationDeg: number;
    scale: number;
    translateX: number;
    translateY: number;
    outputWidth: number;
    outputHeight: number;
    /** 출력 전체의 빈 비율(정보). */
    totalEmptyFraction: number | null;
  } | null;
}

export interface PickRecord {
  kind: typeof PICK_RECORD_KIND;
  version: typeof PICK_RECORD_VERSION;
  /** 저장한 날짜(기기 시계, ISO 8601 UTC). */
  createdAt: string;
  rulesVersion: string;
  /** 경계값 전부. 다시 판정할 때 이 값을 쓴다. */
  rules: Rules;
  shotKind: ShotKind;
  reference: {
    width: number;
    height: number;
    measuredWidth: number;
    measuredHeight: number;
    /** 기준 사진 파일의 SHA-256. 기준 사진을 바꾸면 이 값이 달라진다. */
    fileSha256: string | null;
    sharpness: number | null;
    meanLuma: number | null;
    clipRatio: number | null;
    direction: { h: number; v: number };
    axes: { yaw: number; pitch: number; roll: number };
    faceShortRatio: number;
    anchors: { count: number; spread: number; sufficient: boolean };
  };
  video: {
    width: number;
    height: number;
    durationSec: number;
    effectiveDurationSec: number;
    orientation: Orientation;
    /** 동영상 파일의 수정 시각(촬영 시각과 다를 수 있다). 모르면 null. */
    fileModifiedAt: string | null;
  };
  /** 결과를 내지 못하고 멈췄으면 그 코드, 아니면 null. */
  stop: StopCode | null;
  /** 저장한 장면의 순위. 1 이면 도구가 고른 1등, 다른 값이면 사람이 바꾼 후보. 멈췄으면 null. */
  chosenRank: number | null;
  candidates: RecordCandidate[];
  excluded: ExclusionCounts;
  remeasureDropped: number;
  measured: { coarse: number; fine: number; remeasure: number };
  quickAnswer: { answer: QuickAnswer; minAngleDeg: number | null } | null;
  /** 자취: 거친 훑기 장면의 시각과 보는 방향 2값. 세 배열의 길이가 같다. */
  trace: { timeSec: number[]; h: number[]; v: number[] };
  /** 다시 찍은 횟수와, 가까운 장면 없이 저장할 때의 사유. */
  retakeCount: number;
  retakeReason: string | null;
  memo: string | null;
  /** 원본 장면 PNG 와 보정본 PNG 의 SHA-256. */
  files: { originalPngSha256: string | null; correctedPngSha256: string | null };
}

export class PickRecordError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`기록 검증 실패: ${errors.join(" / ")}`);
    this.name = "PickRecordError";
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// 만들기

/** 규칙 값을 JSON 으로 왕복하는 보통 객체로 복사한다. */
export function rulesSnapshot(rules: Rules = RULES): Rules {
  return JSON.parse(JSON.stringify(rules)) as Rules;
}

/** 동영상 기록과 사진 기록의 후보가 함께 갖는 칸(판정에 쓴 숫자·판정·경고·방향·보정량). */
type CandidateCore = Pick<
  RecordCandidate,
  "rank" | "analysisRank" | "numbers" | "verdict" | "warnings" | "score" | "direction" | "axes" | "correction"
>;

function candidateCore(c: Candidate, ctx: JudgeContext, rules: Rules): CandidateCore {
  const j = judgeCandidate(
    {
      face: c.measurement.face,
      sharpness: c.measurement.sharpness,
      meanLuma: c.measurement.skin?.meanLuma ?? null,
      comparison: c.comparison,
      remeasureShiftDeg: c.remeasureShiftDeg,
    },
    ctx,
    rules,
  );
  const out = j.output;
  return {
    rank: c.rank,
    analysisRank: c.analysisRank,
    numbers: j.numbers,
    verdict: j.verdict,
    warnings: j.warnings,
    score: c.comparison.score,
    direction: viewToTrace(c.measurement.face.view),
    axes: { ...c.measurement.face.axes },
    correction: out
      ? {
          rotationDeg: rotationDegOf(out.transform),
          scale: scaleOf(out.transform),
          translateX: out.transform.tx,
          translateY: out.transform.ty,
          outputWidth: out.size.width,
          outputHeight: out.size.height,
          totalEmptyFraction: out.totalEmptyFraction,
        }
      : null,
  };
}

function candidateRecord(c: Candidate, ctx: JudgeContext, rules: Rules): RecordCandidate {
  const core = candidateCore(c, ctx, rules);
  // 칸의 순서는 예전 그대로 둔다(내보낸 JSON 의 모양이 바뀌지 않게).
  return {
    rank: core.rank,
    analysisRank: core.analysisRank,
    timeSec: c.measurement.timeSec,
    requestedTimeSec: c.measurement.requestedTimeSec,
    timeIsReported: c.measurement.timeIsReported,
    analysis: {
      timeSec: c.analysis.timeSec,
      angleDeg: c.analysis.angleDeg,
      score: c.analysis.score,
      phase: c.analysis.phase,
    },
    numbers: core.numbers,
    verdict: core.verdict,
    warnings: core.warnings,
    score: core.score,
    direction: core.direction,
    axes: core.axes,
    correction: core.correction,
  };
}

export interface PickRecordInput {
  createdAt: string;
  shotKind: ShotKind;
  reference: {
    measured: Measured & { face: FaceReading };
    original: FrameSize;
    fileSha256: string | null;
  };
  video: { native: FrameSize; durationSec: number; fileModifiedAt: string | null };
  /** 분석 결과(고름 또는 멈춤). 취소한 분석은 기록하지 않는다. */
  analysis: Exclude<AnalysisResult, { kind: "cancelled" }>;
  /** 저장한 장면의 순위. 멈췄으면 null. */
  chosenRank: number | null;
  retakeCount: number;
  retakeReason: string | null;
  memo: string | null;
  files: { originalPngSha256: string | null; correctedPngSha256: string | null };
  rules?: Rules;
}

/**
 * 기록을 만들고 검사한다. 검사에 걸리면 PickRecordError — 고쳐서 내보내지 않는다.
 * 후보의 숫자·판정·경고는 화면이 쓰는 것과 같은 함수(`judgeCandidate`)로 여기서 다시 계산한다.
 */
export function buildPickRecord(input: PickRecordInput): PickRecord {
  const rules = input.rules ?? RULES;
  const a = input.analysis;
  const ref = input.reference.measured;
  const ctx: JudgeContext = {
    reference: ref,
    referenceOriginal: input.reference.original,
    videoNative: input.video.native,
    videoDurationSec: input.video.durationSec,
  };
  const candidates = a.kind === "picked" ? [a.winner, ...a.runnerUps].map((c) => candidateRecord(c, ctx, rules)) : [];

  const record: PickRecord = {
    kind: PICK_RECORD_KIND,
    version: PICK_RECORD_VERSION,
    createdAt: input.createdAt,
    rulesVersion: RULES_VERSION,
    rules: rulesSnapshot(rules),
    shotKind: input.shotKind,
    reference: {
      width: input.reference.original.width,
      height: input.reference.original.height,
      measuredWidth: ref.face.frame.width,
      measuredHeight: ref.face.frame.height,
      fileSha256: input.reference.fileSha256,
      sharpness: ref.sharpness,
      meanLuma: ref.skin?.meanLuma ?? null,
      clipRatio: ref.skin?.clipRatio ?? null,
      direction: viewToTrace(ref.face.view),
      axes: { ...ref.face.axes },
      faceShortRatio: ref.face.faceShortRatio,
      anchors: anchorQuality(ref.face, rules),
    },
    video: {
      width: input.video.native.width,
      height: input.video.native.height,
      durationSec: input.video.durationSec,
      effectiveDurationSec: a.effectiveDurationSec,
      orientation: orientationOf(input.video.native),
      fileModifiedAt: input.video.fileModifiedAt,
    },
    stop: a.kind === "stopped" ? a.stop : null,
    chosenRank: input.chosenRank,
    candidates,
    excluded: { ...a.excluded },
    remeasureDropped: a.remeasureDropped,
    measured: { ...a.measured },
    quickAnswer: a.quickAnswer ? { ...a.quickAnswer } : null,
    trace: {
      timeSec: a.trace.map((t) => t.timeSec),
      h: a.trace.map((t) => t.h),
      v: a.trace.map((t) => t.v),
    },
    retakeCount: input.retakeCount,
    retakeReason: input.retakeReason,
    memo: input.memo,
    files: { ...input.files },
  };

  const result = validatePickRecord(record);
  if (!result.ok) throw new PickRecordError(result.errors);
  return result.record;
}

// ---------------------------------------------------------------------------
// 사진 여러 장에서 고른 기록(PRD v0.3.1)

export const PHOTO_PICK_RECORD_KIND = "same-angle-photo-pick-record";
/** 형식을 바꾸면 올린다. 다른 버전은 읽지 않는다. */
export const PHOTO_PICK_RECORD_VERSION = 1;

export interface PhotoRecordCandidate extends CandidateCore {
  /** 순번(1부터): 고른 파일을 파일 이름 순으로 세운 차례. **파일 이름은 기록하지 않는다.** */
  photoNumber: number;
  /** 그 사진의 원본 크기(회전 정보를 반영한 뒤). */
  width: number;
  height: number;
  /** 다시 재기 전의 값. */
  analysis: { angleDeg: number; score: number };
}

export interface PhotoPickRecord {
  kind: typeof PHOTO_PICK_RECORD_KIND;
  version: typeof PHOTO_PICK_RECORD_VERSION;
  /** 입력 종류. */
  source: "photos";
  createdAt: string;
  rulesVersion: string;
  rules: Rules;
  shotKind: ShotKind;
  reference: PickRecord["reference"];
  photos: {
    /** 고른 파일 수. */
    selected: number;
    /** 실제로 본 수(상한을 적용한 뒤). */
    used: number;
    /** 읽지 못해 뺀 수. */
    unreadable: number;
    /** 가장 많은 크기와 가로·세로가 다른 사진 수. */
    sizeMismatch: number;
    /** 읽은 사진 가운데 가장 많은 크기. 한 장도 읽지 못했으면 null. */
    commonWidth: number | null;
    commonHeight: number | null;
    /** 저장한 사진의 순번. 멈췄으면 null. */
    chosenNumber: number | null;
    /** 저장한 사진 원본 파일의 SHA-256. 어느 파일인지는 이름이 아니라 이 값으로 잇는다. */
    chosenFileSha256: string | null;
  };
  stop: StopCode | null;
  chosenRank: number | null;
  candidates: PhotoRecordCandidate[];
  excluded: ExclusionCounts;
  remeasureDropped: number;
  /** 잰 사진 수(읽을 수 있었던 것)와 다시 잰 수. */
  measured: { photos: number; remeasure: number };
  /** 자취: 얼굴을 읽은 사진의 순번과 보는 방향 2값. 세 배열의 길이가 같다. */
  trace: { photoNumber: number[]; h: number[]; v: number[] };
  retakeCount: number;
  retakeReason: string | null;
  memo: string | null;
  files: { originalPngSha256: string | null; correctedPngSha256: string | null };
}

export interface PhotoPickRecordInput {
  createdAt: string;
  shotKind: ShotKind;
  reference: PickRecordInput["reference"];
  /** 고른 파일 수와, 저장한 사진 원본 파일의 해시. **파일 이름을 받는 칸은 없다.** */
  photos: { selected: number; chosenFileSha256: string | null };
  /** `analyzePhotos` 의 결과(고름 또는 멈춤). `photos` 묶음 정보가 붙어 있어야 한다. */
  analysis: Exclude<AnalysisResult, { kind: "cancelled" }>;
  chosenRank: number | null;
  retakeCount: number;
  retakeReason: string | null;
  memo: string | null;
  files: { originalPngSha256: string | null; correctedPngSha256: string | null };
  rules?: Rules;
}

/**
 * 사진 여러 장에서 고른 기록을 만들고 검사한다. 검사에 걸리면 PickRecordError.
 * 후보의 숫자·판정·경고는 화면이 쓰는 것과 같은 함수로 여기서 다시 계산한다(후보마다 그 사진의
 * 원본 크기로).
 */
export function buildPhotoPickRecord(input: PhotoPickRecordInput): PhotoPickRecord {
  const rules = input.rules ?? RULES;
  const a = input.analysis;
  const set = a.photos;
  if (!set) throw new PickRecordError(["analysis.photos: 사진 묶음 정보가 없음(동영상 분석은 buildPickRecord 로)"]);
  const ref = input.reference.measured;
  const base = { reference: ref, referenceOriginal: input.reference.original };

  const list = a.kind === "picked" ? [a.winner, ...a.runnerUps] : [];
  const candidates = list.map((c): PhotoRecordCandidate => {
    const photoNumber = photoNumberOf(c.measurement.timeSec);
    const size = set.sizes[photoNumber - 1] ?? null;
    if (size === null) throw new PickRecordError([`candidates(rank ${c.rank}): ${photoNumber}번째 사진의 크기를 모름`]);
    return {
      ...candidateCore(c, photoJudgeContext(base, size, rules), rules),
      photoNumber,
      width: size.width,
      height: size.height,
      analysis: { angleDeg: c.analysis.angleDeg, score: c.analysis.score },
    };
  });
  const chosen = candidates.find((c) => c.rank === input.chosenRank) ?? null;

  const record: PhotoPickRecord = {
    kind: PHOTO_PICK_RECORD_KIND,
    version: PHOTO_PICK_RECORD_VERSION,
    source: "photos",
    createdAt: input.createdAt,
    rulesVersion: RULES_VERSION,
    rules: rulesSnapshot(rules),
    shotKind: input.shotKind,
    reference: {
      width: input.reference.original.width,
      height: input.reference.original.height,
      measuredWidth: ref.face.frame.width,
      measuredHeight: ref.face.frame.height,
      fileSha256: input.reference.fileSha256,
      sharpness: ref.sharpness,
      meanLuma: ref.skin?.meanLuma ?? null,
      clipRatio: ref.skin?.clipRatio ?? null,
      direction: viewToTrace(ref.face.view),
      axes: { ...ref.face.axes },
      faceShortRatio: ref.face.faceShortRatio,
      anchors: anchorQuality(ref.face, rules),
    },
    photos: {
      selected: input.photos.selected,
      used: set.count,
      unreadable: set.unreadable,
      sizeMismatch: set.sizeMismatch,
      commonWidth: set.commonSize?.width ?? null,
      commonHeight: set.commonSize?.height ?? null,
      chosenNumber: chosen?.photoNumber ?? null,
      chosenFileSha256: chosen ? input.photos.chosenFileSha256 : null,
    },
    stop: a.kind === "stopped" ? a.stop : null,
    chosenRank: input.chosenRank,
    candidates,
    excluded: { ...a.excluded },
    remeasureDropped: a.remeasureDropped,
    measured: { photos: a.measured.coarse, remeasure: a.measured.remeasure },
    trace: {
      photoNumber: a.trace.map((t) => photoNumberOf(t.timeSec)),
      h: a.trace.map((t) => t.h),
      v: a.trace.map((t) => t.v),
    },
    retakeCount: input.retakeCount,
    retakeReason: input.retakeReason,
    memo: input.memo,
    files: { ...input.files },
  };

  const result = validatePhotoPickRecord(record);
  if (!result.ok) throw new PickRecordError(result.errors);
  return result.record;
}

// ---------------------------------------------------------------------------
// 검사

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const ORIENTATIONS: readonly string[] = ["portrait", "landscape", "square"];
const PHASES: readonly string[] = ["coarse", "fine", "remeasure"];
const STOPS: readonly string[] = ["S1", "S2", "S3", "S4", "S5"];
/** 사진 기록의 멈춤: 쓸 수 있는 사진 없음(S4), 한 장도 읽지 못함(S6). */
const PHOTO_STOPS: readonly string[] = ["S4", "S6"];

/** 기록의 모양: 동영상에서 고른 기록 또는 사진 여러 장에서 고른 기록. */
type Shape = "video" | "photos";

type Obj = Record<string, unknown>;

function obj(v: unknown, path: string, keys: readonly string[], errors: Errors): Obj | null {
  if (!isPlainObject(v)) {
    errors.push(`${path}: 객체가 아님`);
    return null;
  }
  checkKeys(v, keys, path, errors);
  return v;
}

function num(o: Obj, key: string, path: string, errors: Errors): void {
  if (key in o) checkFiniteNumber(o[key], `${path}.${key}`, errors);
}

function numOrNull(o: Obj, key: string, path: string, errors: Errors): void {
  if (key in o && o[key] !== null) checkFiniteNumber(o[key], `${path}.${key}`, errors);
}

function count(o: Obj, key: string, path: string, errors: Errors): void {
  if (!(key in o)) return;
  const v = o[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) errors.push(`${path}.${key}: 0 이상의 정수가 아님`);
}

function oneOf(o: Obj, key: string, allowed: readonly string[], path: string, errors: Errors): void {
  if (key in o && !(typeof o[key] === "string" && allowed.includes(o[key] as string))) {
    errors.push(`${path}.${key}: ${allowed.join("/")} 중 하나가 아님`);
  }
}

function bool(o: Obj, key: string, path: string, errors: Errors): void {
  if (key in o && typeof o[key] !== "boolean") errors.push(`${path}.${key}: true/false 가 아님`);
}

function isoOrNull(v: unknown, path: string, nullable: boolean, errors: Errors): void {
  if (v === null && nullable) return;
  if (typeof v !== "string" || !ISO_UTC.test(v) || Number.isNaN(Date.parse(v))) {
    errors.push(`${path}: ISO 8601(UTC) 형식이 아님`);
  }
}

function shaOrNull(o: Obj, key: string, path: string, errors: Errors): void {
  if (!(key in o) || o[key] === null) return;
  if (typeof o[key] !== "string" || !SHA256_HEX.test(o[key] as string)) {
    errors.push(`${path}.${key}: SHA-256(소문자 16진수 64자)이 아님`);
  }
}

function memoOrNull(o: Obj, key: string, path: string, errors: Errors): void {
  if (!(key in o) || o[key] === null) return;
  const v = o[key];
  if (typeof v !== "string") errors.push(`${path}.${key}: 문자열/null 이 아님`);
  else if (v.length > MAX_MEMO_LENGTH) errors.push(`${path}.${key}: 너무 김(${v.length} > ${MAX_MEMO_LENGTH})`);
}

const NUMBER_KEYS_REQUIRED = ["angleDeg", "frameScale", "residual", "position", "videoDurationSec"] as const;
const NUMBER_KEYS_NULLABLE = [
  "mirroredAngleDeg",
  "roiEmptyFraction",
  "qualityScale",
  "sharpness",
  "referenceSharpness",
  "meanLuma",
  "referenceMeanLuma",
  "remeasureShiftDeg",
  "referenceClipRatio",
] as const;
const JUDGE_KEYS: readonly string[] = [
  ...NUMBER_KEYS_REQUIRED,
  ...NUMBER_KEYS_NULLABLE,
  "referenceOrientation",
  "videoOrientation",
];

function checkRules(v: unknown, errors: Errors): void {
  const groups = Object.keys(RULES) as (keyof typeof RULES)[];
  const r = obj(v, "record.rules", groups, errors);
  if (!r) return;
  for (const g of groups) {
    if (!(g in r)) continue;
    const keys = Object.keys(RULES[g]);
    const go = obj(r[g], `record.rules.${g}`, keys, errors);
    if (go) for (const k of keys) num(go, k, `record.rules.${g}`, errors);
  }
}

function checkDirection(v: unknown, path: string, errors: Errors): void {
  const d = obj(v, path, ["h", "v"], errors);
  if (d) for (const k of ["h", "v"]) num(d, k, path, errors);
}

function checkAxes(v: unknown, path: string, errors: Errors): void {
  const d = obj(v, path, ["yaw", "pitch", "roll"], errors);
  if (d) for (const k of ["yaw", "pitch", "roll"]) num(d, k, path, errors);
}

const CANDIDATE_CORE_KEYS = ["rank", "analysisRank", "numbers", "verdict", "warnings", "score", "direction", "axes", "correction"];
const VIDEO_CANDIDATE_KEYS = [...CANDIDATE_CORE_KEYS, "timeSec", "requestedTimeSec", "timeIsReported", "analysis"];
const PHOTO_CANDIDATE_KEYS = [...CANDIDATE_CORE_KEYS, "photoNumber", "width", "height", "analysis"];

function checkCandidate(v: unknown, path: string, errors: Errors, shape: Shape = "video"): void {
  const c = obj(v, path, shape === "photos" ? PHOTO_CANDIDATE_KEYS : VIDEO_CANDIDATE_KEYS, errors);
  if (!c) return;
  for (const k of ["rank", "analysisRank"]) {
    count(c, k, path, errors);
    if (c[k] === 0) errors.push(`${path}.${k}: 1 이상이어야 함`);
  }
  num(c, "score", path, errors);
  oneOf(c, "verdict", ["close", "notClose"], path, errors);

  if (shape === "photos") {
    count(c, "photoNumber", path, errors);
    if (c.photoNumber === 0) errors.push(`${path}.photoNumber: 1 이상이어야 함`);
    for (const k of ["width", "height"]) {
      num(c, k, path, errors);
      if (typeof c[k] === "number" && !((c[k] as number) > 0)) errors.push(`${path}.${k}: 0 보다 커야 함`);
    }
    if ("analysis" in c) {
      const a = obj(c.analysis, `${path}.analysis`, ["angleDeg", "score"], errors);
      if (a) for (const k of ["angleDeg", "score"]) num(a, k, `${path}.analysis`, errors);
    }
  } else {
    for (const k of ["timeSec", "requestedTimeSec"]) num(c, k, path, errors);
    bool(c, "timeIsReported", path, errors);
    if ("analysis" in c) {
      const a = obj(c.analysis, `${path}.analysis`, ["timeSec", "angleDeg", "score", "phase"], errors);
      if (a) {
        for (const k of ["timeSec", "angleDeg", "score"]) num(a, k, `${path}.analysis`, errors);
        oneOf(a, "phase", PHASES, `${path}.analysis`, errors);
      }
    }
  }
  if ("numbers" in c) {
    const n = obj(c.numbers, `${path}.numbers`, JUDGE_KEYS, errors);
    if (n) {
      for (const k of NUMBER_KEYS_REQUIRED) {
        // 사진 여러 장에는 길이가 없다. 그 칸은 null 이어야 한다(0 으로 채우지 않는다).
        if (k === "videoDurationSec" && shape === "photos") {
          if ("videoDurationSec" in n && n.videoDurationSec !== null) {
            errors.push(`${path}.numbers.videoDurationSec: 사진 기록에서는 null 이어야 함`);
          }
          continue;
        }
        num(n, k, `${path}.numbers`, errors);
      }
      for (const k of NUMBER_KEYS_NULLABLE) numOrNull(n, k, `${path}.numbers`, errors);
      oneOf(n, "referenceOrientation", ORIENTATIONS, `${path}.numbers`, errors);
      oneOf(n, "videoOrientation", ORIENTATIONS, `${path}.numbers`, errors);
    }
  }
  if ("warnings" in c) {
    if (!Array.isArray(c.warnings)) errors.push(`${path}.warnings: 배열이 아님`);
    else {
      c.warnings.forEach((w, i) => {
        if (!(WARNING_ORDER as readonly unknown[]).includes(w)) errors.push(`${path}.warnings[${i}]: 모르는 경고 코드`);
      });
    }
  }
  if ("direction" in c) checkDirection(c.direction, `${path}.direction`, errors);
  if ("axes" in c) checkAxes(c.axes, `${path}.axes`, errors);
  if ("correction" in c && c.correction !== null) {
    const keys = ["rotationDeg", "scale", "translateX", "translateY", "outputWidth", "outputHeight"];
    const k2 = obj(c.correction, `${path}.correction`, [...keys, "totalEmptyFraction"], errors);
    if (k2) {
      for (const k of keys) num(k2, k, `${path}.correction`, errors);
      numOrNull(k2, "totalEmptyFraction", `${path}.correction`, errors);
      if (typeof k2.scale === "number" && !(k2.scale > 0)) errors.push(`${path}.correction.scale: 0 보다 커야 함`);
    }
  }
}

const COMMON_TOP_KEYS = [
  "kind",
  "version",
  "createdAt",
  "rulesVersion",
  "rules",
  "shotKind",
  "reference",
  "stop",
  "chosenRank",
  "candidates",
  "excluded",
  "remeasureDropped",
  "measured",
  "trace",
  "retakeCount",
  "retakeReason",
  "memo",
  "files",
];
const VIDEO_TOP_KEYS = [...COMMON_TOP_KEYS, "video", "quickAnswer"];
const PHOTO_TOP_KEYS = [...COMMON_TOP_KEYS, "source", "photos"];

function collectErrors(x: unknown, shape: Shape = "video"): Errors {
  const errors: Errors = [];
  if (!isPlainObject(x)) return ["기록이 객체가 아님"];
  const photos = shape === "photos";
  const kind = photos ? PHOTO_PICK_RECORD_KIND : PICK_RECORD_KIND;
  const version = photos ? PHOTO_PICK_RECORD_VERSION : PICK_RECORD_VERSION;

  checkKeys(x, photos ? PHOTO_TOP_KEYS : VIDEO_TOP_KEYS, "record", errors);

  // 자유 형식 검사(유한 수·금지 키·data URL·base64 연속·길이·깊이)와 총량을 기록 전체에 건다.
  const budget = newBudget();
  checkJson(x, "record", 0, errors, budget);
  checkBudget(budget, "record", errors);

  if (x.kind !== kind) errors.push(`record.kind: "${kind}" 가 아님`);
  if (x.version !== version) {
    errors.push(`record.version: ${version} 이 아님(받은 값 ${String(x.version)})`);
  }
  if ("createdAt" in x) isoOrNull(x.createdAt, "record.createdAt", false, errors);
  if ("rulesVersion" in x && typeof x.rulesVersion !== "string") errors.push("record.rulesVersion: 문자열이 아님");
  if ("rules" in x) checkRules(x.rules, errors);
  oneOf(x, "shotKind", SHOT_KINDS, "record", errors);

  if ("reference" in x) {
    const p = "record.reference";
    const r = obj(
      x.reference,
      p,
      [
        "width",
        "height",
        "measuredWidth",
        "measuredHeight",
        "fileSha256",
        "sharpness",
        "meanLuma",
        "clipRatio",
        "direction",
        "axes",
        "faceShortRatio",
        "anchors",
      ],
      errors,
    );
    if (r) {
      for (const k of ["width", "height", "measuredWidth", "measuredHeight", "faceShortRatio"]) num(r, k, p, errors);
      for (const k of ["sharpness", "meanLuma", "clipRatio"]) numOrNull(r, k, p, errors);
      shaOrNull(r, "fileSha256", p, errors);
      if ("direction" in r) checkDirection(r.direction, `${p}.direction`, errors);
      if ("axes" in r) checkAxes(r.axes, `${p}.axes`, errors);
      if ("anchors" in r) {
        const a = obj(r.anchors, `${p}.anchors`, ["count", "spread", "sufficient"], errors);
        if (a) {
          count(a, "count", `${p}.anchors`, errors);
          num(a, "spread", `${p}.anchors`, errors);
          bool(a, "sufficient", `${p}.anchors`, errors);
        }
      }
    }
  }

  if (photos) {
    if ("source" in x && x.source !== "photos") errors.push('record.source: "photos" 가 아님');
    if ("photos" in x) checkPhotoSet(x.photos, errors);
  }

  if (!photos && "video" in x) {
    const p = "record.video";
    const v = obj(
      x.video,
      p,
      ["width", "height", "durationSec", "effectiveDurationSec", "orientation", "fileModifiedAt"],
      errors,
    );
    if (v) {
      for (const k of ["width", "height", "durationSec", "effectiveDurationSec"]) num(v, k, p, errors);
      oneOf(v, "orientation", ORIENTATIONS, p, errors);
      if ("fileModifiedAt" in v) isoOrNull(v.fileModifiedAt, `${p}.fileModifiedAt`, true, errors);
    }
  }

  if ("stop" in x && x.stop !== null) oneOf(x, "stop", photos ? PHOTO_STOPS : STOPS, "record", errors);

  let ranks: number[] = [];
  if ("candidates" in x) {
    if (!Array.isArray(x.candidates)) errors.push("record.candidates: 배열이 아님");
    else {
      if (x.candidates.length > MAX_RECORD_CANDIDATES) {
        errors.push(`record.candidates: 너무 많음(${x.candidates.length} > ${MAX_RECORD_CANDIDATES})`);
      }
      x.candidates.forEach((c, i) => checkCandidate(c, `record.candidates[${i}]`, errors, shape));
      ranks = x.candidates.map((c) => (isPlainObject(c) && typeof c.rank === "number" ? c.rank : Number.NaN));
      if (new Set(ranks).size !== ranks.length) errors.push("record.candidates: 순위가 겹침");
    }
  }

  // 멈춘 기록에는 후보도 저장한 장면도 없고, 고른 기록에는 둘 다 있어야 한다.
  if ("stop" in x && "chosenRank" in x && Array.isArray(x.candidates)) {
    if (x.stop !== null) {
      if (x.chosenRank !== null) errors.push("record.chosenRank: 멈춘 기록에는 null 이어야 함");
      if (x.candidates.length !== 0) errors.push("record.candidates: 멈춘 기록에는 후보가 없어야 함");
    } else {
      if (x.candidates.length === 0) errors.push("record.candidates: 후보가 없음");
      if (typeof x.chosenRank !== "number" || !ranks.includes(x.chosenRank)) {
        errors.push("record.chosenRank: 후보의 순위 가운데 하나가 아님");
      }
    }
  }

  // 사진 기록: 고른 순번은 저장한 후보의 순번과 같아야 하고, 멈춘 기록에는 없어야 한다.
  if (photos && isPlainObject(x.photos) && Array.isArray(x.candidates) && "chosenRank" in x) {
    const chosen = x.candidates.find((c) => isPlainObject(c) && c.rank === x.chosenRank);
    const expected = isPlainObject(chosen) ? chosen.photoNumber : null;
    if (x.photos.chosenNumber !== expected) errors.push("record.photos.chosenNumber: 저장한 후보의 순번과 다름");
  }

  if ("excluded" in x) {
    const e = obj(x.excluded, "record.excluded", ["X1", "X2", "X3", "X4", "total"], errors);
    if (e) {
      for (const k of ["X1", "X2", "X3", "X4", "total"]) count(e, k, "record.excluded", errors);
      const sum = ["X1", "X2", "X3", "X4"].reduce((s, k) => s + (typeof e[k] === "number" ? (e[k] as number) : 0), 0);
      if (typeof e.total === "number" && e.total !== sum) errors.push("record.excluded.total: 사유별 합과 다름");
    }
  }
  count(x, "remeasureDropped", "record", errors);
  count(x, "retakeCount", "record", errors);

  if ("measured" in x) {
    const keys = photos ? ["photos", "remeasure"] : ["coarse", "fine", "remeasure"];
    const m = obj(x.measured, "record.measured", keys, errors);
    if (m) for (const k of keys) count(m, k, "record.measured", errors);
  }

  if (!photos && "quickAnswer" in x && x.quickAnswer !== null) {
    const q = obj(x.quickAnswer, "record.quickAnswer", ["answer", "minAngleDeg"], errors);
    if (q) {
      oneOf(q, "answer", ["passedNear", "notNear"], "record.quickAnswer", errors);
      numOrNull(q, "minAngleDeg", "record.quickAnswer", errors);
    }
  }

  if ("trace" in x) {
    const keys = [photos ? "photoNumber" : "timeSec", "h", "v"];
    const t = obj(x.trace, "record.trace", keys, errors);
    if (t) {
      const lens: number[] = [];
      for (const k of keys) {
        const arr = t[k];
        if (!Array.isArray(arr)) {
          if (k in t) errors.push(`record.trace.${k}: 배열이 아님`);
          continue;
        }
        lens.push(arr.length);
        arr.forEach((n, i) => checkFiniteNumber(n, `record.trace.${k}[${i}]`, errors));
      }
      if (new Set(lens).size > 1) errors.push("record.trace: 세 배열의 길이가 다름");
    }
  }

  memoOrNull(x, "retakeReason", "record", errors);
  memoOrNull(x, "memo", "record", errors);

  if ("files" in x) {
    const f = obj(x.files, "record.files", ["originalPngSha256", "correctedPngSha256"], errors);
    if (f) {
      shaOrNull(f, "originalPngSha256", "record.files", errors);
      shaOrNull(f, "correctedPngSha256", "record.files", errors);
    }
  }

  return errors;
}

const PHOTO_SET_KEYS = [
  "selected",
  "used",
  "unreadable",
  "sizeMismatch",
  "commonWidth",
  "commonHeight",
  "chosenNumber",
  "chosenFileSha256",
];

function checkPhotoSet(v: unknown, errors: Errors): void {
  const p = "record.photos";
  const o = obj(v, p, PHOTO_SET_KEYS, errors);
  if (!o) return;
  for (const k of ["selected", "used", "unreadable", "sizeMismatch"]) count(o, k, p, errors);
  for (const k of ["commonWidth", "commonHeight"]) numOrNull(o, k, p, errors);
  if ("chosenNumber" in o && o.chosenNumber !== null) {
    count(o, "chosenNumber", p, errors);
    if (o.chosenNumber === 0) errors.push(`${p}.chosenNumber: 1 이상이어야 함`);
  }
  shaOrNull(o, "chosenFileSha256", p, errors);
  const n = (k: string) => (typeof o[k] === "number" ? (o[k] as number) : Number.NaN);
  if (n("used") > n("selected")) errors.push(`${p}.used: 고른 수보다 많음`);
  if (n("unreadable") > n("used")) errors.push(`${p}.unreadable: 본 수보다 많음`);
  if (n("sizeMismatch") > n("used") - n("unreadable")) errors.push(`${p}.sizeMismatch: 읽은 수보다 많음`);
  if (typeof o.chosenNumber === "number" && o.chosenNumber > n("used")) errors.push(`${p}.chosenNumber: 본 수보다 큼`);
}

export type PickRecordValidation = { ok: true; record: PickRecord } | { ok: false; errors: string[] };

/** 파싱한 JSON(또는 무엇이든)을 검사한다. 고치거나 채우지 않고, 틀린 곳을 전부 모아 돌려준다. */
export function validatePickRecord(x: unknown): PickRecordValidation {
  const errors = collectErrors(x);
  return errors.length === 0 ? { ok: true, record: x as PickRecord } : { ok: false, errors };
}

export type PhotoPickRecordValidation = { ok: true; record: PhotoPickRecord } | { ok: false; errors: string[] };

/** 사진 여러 장에서 고른 기록을 검사한다. 동영상 기록을 넣으면 종류가 달라 거부한다(그 반대도 같다). */
export function validatePhotoPickRecord(x: unknown): PhotoPickRecordValidation {
  const errors = collectErrors(x, "photos");
  return errors.length === 0 ? { ok: true, record: x as PhotoPickRecord } : { ok: false, errors };
}

// ---------------------------------------------------------------------------
// 다시 판정

export interface Rejudged {
  rank: number;
  /** 기록에 적힌 숫자와 기록에 적힌 규칙 값으로 다시 낸 판정. */
  judgement: Judgement;
  /** 기록에 적혀 있던 판정·경고와 같은가. 다르면 기록이 손으로 고쳐졌거나 판정 함수가 바뀐 것이다. */
  matchesRecord: boolean;
}

/**
 * 기록을 다시 판정한다. 살아 있는 결과가 쓰는 `judge` 를 **기록에 적힌 규칙 값**으로 부른다 —
 * 지금 코드의 경계값이 바뀌었어도 그때의 판정이 그대로 나온다.
 */
export function rejudge(
  record: Pick<PickRecord, "rules"> & {
    candidates: readonly Pick<RecordCandidate, "rank" | "numbers" | "verdict" | "warnings">[];
  },
): Rejudged[] {
  return record.candidates.map((c) => {
    const judgement = judge(c.numbers, record.rules);
    const matchesRecord =
      judgement.verdict === c.verdict &&
      judgement.warnings.length === c.warnings.length &&
      judgement.warnings.every((w, i) => w === c.warnings[i]);
    return { rank: c.rank, judgement, matchesRecord };
  });
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** same-angle-pick-YYYYMMDD-HHmm.json (기기 현지 시각). 사진 종류·메모가 붙는 이름 규칙은 내보내기 화면에서 정한다. */
export function pickRecordFileName(date: Date): string {
  const ymd = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  return `same-angle-pick-${ymd}-${pad2(date.getHours())}${pad2(date.getMinutes())}.json`;
}
