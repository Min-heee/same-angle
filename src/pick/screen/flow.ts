/**
 * 고르기 화면의 상태와 그 바뀜(리듀서). 화면은 이 상태만 그린다.
 *
 * 흐름: ① 기준 사진 → ② 동영상 → ③ 분석 → ④ 결과·저장(저장은 결과 화면 맨 아래에 있다).
 *
 * 여기서 지키는 규칙:
 *  - 기준 사진을 바꾸면 동영상·분석·다시 찍은 횟수·메모가 전부 비워진다(다른 사진의 결과가 남지 않는다).
 *  - 다시 찍은 횟수 = **끝까지 간 분석**(고름 또는 "쓸 수 있는 장면 없음")의 수 − 1. 취소했거나
 *    동영상을 열지 못한 것은 세지 않는다 [가정].
 *  - 후보·메모·사유를 바꾸면 만들어 둔 저장 파일은 버린다(기록의 해시·메모와 파일이 어긋나지 않게).
 *  - 판정은 여기서 하지 않는다. 엔진의 결과(`AnalysisResult`)를 그대로 들고 있을 뿐이다.
 *
 * 순수 함수다. 브라우저 API·시계를 부르지 않는다. 이미지 주소(blob:)는 문자열로만 들고, 만들고
 * 놓는 일은 `session.ts` 가 한다.
 */

import type { FaceReading, Measured } from "../measure";
import type { AnalysisResult, Progress, QuickAnswerInfo } from "../pipeline";
import type { ShotKind } from "../record";
import type { Failure } from "./failure";

export type Step = "reference" | "video" | "analyzing" | "result";

/** 다시 찍기를 권하는 횟수의 상한(PRD 3절 5번) [가정]. 넘으면 사유를 남기고 저장하라고 안내한다. */
export const RETAKE_LIMIT = 2;

/** 가까운 장면 없이 저장할 때 고르는 사유(PRD 3절 5번). 기록의 `retakeReason` 에 그대로 들어간다. */
export const RETAKE_REASONS = ["자세 유지가 어려움", "시간 부족", "기타"] as const;

/** 자유 메모의 길이 상한(글자). 기록 형식의 상한(500)보다 짧게 잡는다 — 파일 이름에도 붙는다. */
export const MEMO_MAX = 120;

export interface ReferenceInfo {
  /** 회전 정보를 반영한 원본 크기. */
  width: number;
  height: number;
  /** 얼굴을 읽은 측정값. 기준점 좌표가 들어 있어 기기 메모리에만 둔다(기록에 넣지 않는다). */
  measured: Measured & { face: FaceReading };
  fileSha256: string | null;
  /** 화면에 보일 줄인 그림(blob:). 만들지 못했으면 null. */
  previewUrl: string | null;
}

export interface VideoInfo {
  width: number;
  height: number;
  durationSec: number;
  /** 파일의 수정 시각(ISO). 촬영 시각과 다를 수 있다. */
  fileModifiedAt: string | null;
}

export type PickedAnalysis = Extract<AnalysisResult, { kind: "picked" }>;
export type StoppedAnalysis = Extract<AnalysisResult, { kind: "stopped" }>;

/** 후보 하나의 그림 주소. 고른 후보만 큰 그림이 있고, 나머지는 작은 그림만 있다. */
export interface CandidateImages {
  thumbUrl: string | null;
  originalUrl: string | null;
  correctedUrl: string | null;
  /** 그림을 뽑을 때 브라우저가 알려 준 장면 시각. 모르면 null. */
  grabbedTimeSec: number | null;
}

export interface ExportFile {
  kind: "corrected" | "original" | "record";
  label: string;
  name: string;
  url: string;
  bytes: number;
}

export type ExportState =
  | { status: "idle" }
  | { status: "preparing" }
  | { status: "ready"; files: ExportFile[] }
  | { status: "failed"; detail: string };

export interface PickState {
  step: Step;
  shotKind: ShotKind;
  /** 얼굴 모델을 받는 동안의 진행 문장. */
  modelMessage: string | null;
  reference:
    | { status: "empty" }
    | { status: "reading" }
    | { status: "ready"; info: ReferenceInfo }
    | { status: "failed"; failure: Failure };
  video:
    | { status: "empty" }
    | { status: "opening" }
    | { status: "ready"; info: VideoInfo }
    | { status: "failed"; failure: Failure };
  analysis:
    | { status: "idle" }
    | { status: "running"; progress: Progress | null; quickAnswer: QuickAnswerInfo | null; cancelling: boolean }
    | { status: "cancelled" }
    | { status: "failed"; failure: Failure }
    | { status: "done"; result: PickedAnalysis | StoppedAnalysis };
  /** 지금 보고 있는(저장할) 후보의 순위. */
  chosenRank: number | null;
  images: Record<number, CandidateImages>;
  /** 고른 후보의 큰 그림을 만드는 중인가, 만들지 못했는가. */
  imageStatus: "idle" | "rendering" | "ready" | "failed";
  /** "가까운 장면 없음"인데 그래도 가장 가까운 장면을 보겠다고 눌렀는가. */
  showAnyway: boolean;
  /** 이 기준 사진으로 끝까지 간 분석 수. 다시 찍은 횟수는 여기서 나온다(`retakeCountOf`). */
  completedAnalyses: number;
  /** 분석하는 동안 화면이 꺼지거나 다른 앱으로 갔는가. */
  hiddenDuringAnalysis: boolean;
  memo: string;
  retakeReason: string | null;
  exportState: ExportState;
}

export type Action =
  | { type: "shotKind"; shotKind: ShotKind }
  | { type: "model/progress"; message: string | null }
  | { type: "reference/reading" }
  | { type: "reference/ready"; info: ReferenceInfo }
  | { type: "reference/failed"; failure: Failure }
  | { type: "step"; step: "reference" | "video" }
  | { type: "video/opening" }
  | { type: "video/ready"; info: VideoInfo }
  | { type: "video/failed"; failure: Failure }
  | { type: "analysis/progress"; progress: Progress }
  | { type: "analysis/quick"; quickAnswer: QuickAnswerInfo }
  | { type: "analysis/cancelling" }
  | { type: "analysis/cancelled" }
  | { type: "analysis/failed"; failure: Failure }
  | { type: "analysis/done"; result: PickedAnalysis | StoppedAnalysis }
  | { type: "hidden" }
  | { type: "candidate"; rank: number }
  | { type: "images"; rank: number; images: Partial<CandidateImages> }
  | { type: "imageStatus"; status: PickState["imageStatus"] }
  | { type: "showAnyway" }
  | { type: "retake" }
  | { type: "memo"; memo: string }
  | { type: "retakeReason"; reason: string | null }
  | { type: "export"; exportState: ExportState }
  | { type: "reset" };

export function initialState(shotKind: ShotKind = "front"): PickState {
  return {
    step: "reference",
    shotKind,
    modelMessage: null,
    reference: { status: "empty" },
    video: { status: "empty" },
    analysis: { status: "idle" },
    chosenRank: null,
    images: {},
    imageStatus: "idle",
    showAnyway: false,
    completedAnalyses: 0,
    hiddenDuringAnalysis: false,
    memo: "",
    retakeReason: null,
    exportState: { status: "idle" },
  };
}

/** 동영상 하나에 딸린 것(분석·후보·그림·저장 파일)을 비운다. 기준 사진과 횟수는 그대로다. */
function clearVideo(s: PickState): PickState {
  return {
    ...s,
    video: { status: "empty" },
    analysis: { status: "idle" },
    chosenRank: null,
    images: {},
    imageStatus: "idle",
    showAnyway: false,
    hiddenDuringAnalysis: false,
    retakeReason: null,
    exportState: { status: "idle" },
  };
}

const EMPTY_IMAGES: CandidateImages = { thumbUrl: null, originalUrl: null, correctedUrl: null, grabbedTimeSec: null };

export function reduce(s: PickState, a: Action): PickState {
  switch (a.type) {
    case "shotKind":
      // 사진 종류는 파일 이름과 기록에 들어간다. 바꾸면 만들어 둔 저장 파일을 버린다.
      return a.shotKind === s.shotKind ? s : { ...s, shotKind: a.shotKind, exportState: { status: "idle" } };

    case "model/progress":
      return { ...s, modelMessage: a.message };

    case "reference/reading":
      return {
        ...clearVideo(s),
        step: "reference",
        reference: { status: "reading" },
        completedAnalyses: 0,
        memo: "",
      };
    case "reference/ready":
      return s.reference.status === "reading" ? { ...s, reference: { status: "ready", info: a.info }, modelMessage: null } : s;
    case "reference/failed":
      return s.reference.status === "reading"
        ? { ...s, reference: { status: "failed", failure: a.failure }, modelMessage: null }
        : s;

    case "step":
      if (a.step === "video" && s.reference.status !== "ready") return s;
      // 분석 중에는 단계를 옮기지 않는다(취소가 먼저다).
      if (s.analysis.status === "running") return s;
      return { ...s, step: a.step };

    case "video/opening":
      if (s.reference.status !== "ready" || s.analysis.status === "running") return s;
      return { ...clearVideo(s), step: "analyzing", video: { status: "opening" } };
    case "video/ready":
      return s.video.status === "opening"
        ? {
            ...s,
            video: { status: "ready", info: a.info },
            analysis: { status: "running", progress: null, quickAnswer: null, cancelling: false },
          }
        : s;
    case "video/failed":
      return s.video.status === "opening" ? { ...s, step: "video", video: { status: "failed", failure: a.failure } } : s;

    case "analysis/progress":
      return s.analysis.status === "running" ? { ...s, analysis: { ...s.analysis, progress: a.progress } } : s;
    case "analysis/quick":
      return s.analysis.status === "running" ? { ...s, analysis: { ...s.analysis, quickAnswer: a.quickAnswer } } : s;
    case "analysis/cancelling":
      return s.analysis.status === "running" ? { ...s, analysis: { ...s.analysis, cancelling: true } } : s;
    case "analysis/cancelled":
      // 동영상을 여는 중에 취소한 것도 같은 자리로 돌아간다(분석은 아직 시작하지 않았다).
      return s.analysis.status === "running" || s.video.status === "opening"
        ? { ...s, step: "video", analysis: { status: "cancelled" }, video: { status: "empty" } }
        : s;
    case "analysis/failed":
      return s.analysis.status === "running"
        ? { ...s, step: "video", analysis: { status: "failed", failure: a.failure }, video: { status: "empty" } }
        : s;
    case "analysis/done": {
      if (s.analysis.status !== "running") return s;
      // 동영상을 읽지 못해 멈춘 것(S3)은 끝까지 간 분석이 아니다.
      const completed = !(a.result.kind === "stopped" && a.result.stop === "S3");
      return {
        ...s,
        step: "result",
        analysis: { status: "done", result: a.result },
        chosenRank: a.result.kind === "picked" ? a.result.winner.rank : null,
        completedAnalyses: completed ? s.completedAnalyses + 1 : s.completedAnalyses,
      };
    }

    case "hidden":
      return s.analysis.status === "running" && !s.hiddenDuringAnalysis ? { ...s, hiddenDuringAnalysis: true } : s;

    case "candidate": {
      if (s.analysis.status !== "done" || s.analysis.result.kind !== "picked") return s;
      const r = s.analysis.result;
      const exists = [r.winner, ...r.runnerUps].some((c) => c.rank === a.rank);
      if (!exists || a.rank === s.chosenRank) return s;
      return { ...s, chosenRank: a.rank, imageStatus: "idle", exportState: { status: "idle" } };
    }
    case "images":
      return { ...s, images: { ...s.images, [a.rank]: { ...(s.images[a.rank] ?? EMPTY_IMAGES), ...a.images } } };
    case "imageStatus":
      return { ...s, imageStatus: a.status };

    case "showAnyway":
      return { ...s, showAnyway: true };

    case "retake":
      // 결과 화면에서 동영상 단계로 돌아간다. 횟수는 새 동영상의 분석이 끝까지 가야 오른다.
      if (s.analysis.status === "running" || s.reference.status !== "ready") return s;
      return { ...s, step: "video" };

    case "memo": {
      const memo = a.memo.slice(0, MEMO_MAX);
      return memo === s.memo ? s : { ...s, memo, exportState: { status: "idle" } };
    }
    case "retakeReason":
      return a.reason === s.retakeReason ? s : { ...s, retakeReason: a.reason, exportState: { status: "idle" } };

    case "export":
      return { ...s, exportState: a.exportState };

    case "reset":
      return initialState(s.shotKind);
  }
}

/** 지금 결과가 "고름"이면 그 분석을, 아니면 null. */
export function pickedOf(s: PickState): PickedAnalysis | null {
  return s.analysis.status === "done" && s.analysis.result.kind === "picked" ? s.analysis.result : null;
}

/** 다시 찍은 횟수: 끝까지 간 분석 수 − 1. 첫 동영상은 다시 찍은 것이 아니다. */
export function retakeCountOf(s: Pick<PickState, "completedAnalyses">): number {
  return Math.max(0, s.completedAnalyses - 1);
}

/**
 * 화면을 떠나면 사라지는 일이 있는가: 분석하는 중이거나, 고른 결과가 떠 있을 때.
 *
 * 저장할 파일은 기기 메모리에만 있어서 새로 고치거나 다른 화면으로 가면 분석과 함께 사라진다.
 * 사용자가 파일을 실제로 받았는지는 알 수 없으므로, 결과가 떠 있는 동안에는 늘 true 다.
 */
export function hasUnsavedWork(s: Pick<PickState, "step" | "analysis">): boolean {
  if (s.step === "analyzing") return true;
  return s.step === "result" && s.analysis.status === "done" && s.analysis.result.kind === "picked";
}

/** 단계 표시줄에서 지금 몇 번째인가(1~4). */
export function stepNumber(step: Step): number {
  return { reference: 1, video: 2, analyzing: 3, result: 4 }[step];
}
