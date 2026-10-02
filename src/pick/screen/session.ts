/**
 * 고르기 화면의 접착부: 상태(`flow.ts`)와 엔진·브라우저 사이를 잇는다.
 *
 * 브라우저가 하는 일(파일 열기, 얼굴 모델, 장면 뽑기, 그림 그리기, 해시)은 전부 `PickDeps` 로
 * **밖에서 받는다.** 그래서 노드 시험이 가짜 측정값을 넣어 흐름 전체(기준 사진 → 동영상 → 분석 →
 * 후보 바꾸기 → 저장)를 돌려 볼 수 있다. 진짜 구현은 `browser.ts` 에 있다.
 *
 * 지키는 것:
 *  - 판정을 하지 않는다. 엔진의 결과를 상태에 넣고, 기록은 엔진의 `buildPickRecord` 가 만든다.
 *  - 늦게 끝난 일은 버린다. 기준 사진·동영상을 다시 고르면 세대가 올라가고, 예전 세대의 결과는
 *    상태에 닿지 못하고 그 손잡이(동영상·그림)는 닫힌다.
 *  - 동영상을 건드리는 일(장면 뽑기)은 한 줄로 세운다. 탐색이 겹치면 다른 장면이 그려진다.
 *  - 큰 그림은 지금 보는 후보 하나만 들고 있는다(아이폰 사파리의 캔버스 메모리 한도, PRD 9절).
 *  - 사진·동영상·그림은 기기 메모리에만 있다. 여기에는 네트워크로 보내는 코드가 없다.
 *  - 입력은 동영상 1개 또는 사진 여러 장(PRD v0.3.1)이다. 갈리는 곳은 여는 일·분석·그림 뽑기·기록의
 *    종류뿐이고, 그 뒤(후보 바꾸기, 저장, 다시 찍기)는 같은 길을 탄다. 사진의 **파일 이름은 화면
 *    상태에만 두고 기록과 저장 파일 이름에는 넘기지 않는다.**
 */

import { photoNumberOf, planPhotoSet, type AnalyzePhotosOptions } from "../burst";
import { assessReference, type JudgeContext } from "../judge";
import type { FaceReading, FrameSize, Measured } from "../measure";
import type { OutputGeometry } from "../output";
import { outputSize } from "../output";
import type { AnalysisResult, AnalyzeOptions, Candidate } from "../pipeline";
import { buildPhotoPickRecord, buildPickRecord, type ShotKind } from "../record";
import { RULES } from "../rules";
import { bandLines, exportNames, memoForRecord } from "./exportplan";
import { failureOf, type Failure } from "./failure";
import {
  initialState,
  photoSetOf,
  pickedOf,
  reduce,
  retakeCountOf,
  type Action,
  type ExportFile,
  type PickState,
  type PickedAnalysis,
} from "./flow";
import { candidateOf, candidatesOf, contextForCandidate, judgeOf, type SourceInput } from "./view";

export interface ModelHandle {
  close(): void;
}

export interface ReferenceHandle {
  /** 회전 정보를 반영한 원본 크기. */
  width: number;
  height: number;
  close(): void;
}

export interface VideoHandle {
  width: number;
  height: number;
  durationSec: number;
  close(): void;
}

/** 사진 여러 장(연사)의 손잡이. 순번 순서로 세운 파일 묶음이다. */
export interface PhotoSetHandle {
  count: number;
  close(): void;
}

/** 후보 한 장을 원본 크기로 다시 뽑아 그린 것. */
export interface RenderedCandidate {
  /** 화면에 보일 그림 주소(blob:). */
  thumbUrl: string | null;
  originalUrl: string;
  /** 보정본. 틀을 만들지 못했으면 null. */
  correctedUrl: string | null;
  /** 이 그림을 뽑을 때 브라우저가 알려 준 장면 시각. 모르면 null. */
  grabbedTimeSec: number | null;
  /** 아래에 띠를 붙인 PNG 를 만든다. 보정본이 없는데 보정본을 달라고 하면 예외. */
  exportPng(kind: "corrected" | "original", lines: readonly string[]): Promise<Blob>;
  /** 큰 그림(캔버스와 주소)을 놓는다. `keepThumb` 이면 작은 그림 주소는 남긴다. */
  release(keepThumb: boolean): void;
}

export type AnalyzeHooks = Pick<AnalyzeOptions, "onProgress" | "onQuickAnswer" | "isCancelled">;
export type PhotoAnalyzeHooks = Pick<AnalyzePhotosOptions, "onProgress" | "isCancelled">;

/** 브라우저가 해 주는 일. 시험에서는 가짜를 넣는다. */
export interface PickDeps<
  M extends ModelHandle,
  R extends ReferenceHandle,
  V extends VideoHandle,
  P extends PhotoSetHandle = PhotoSetHandle,
> {
  loadModel(onProgress: (message: string) => void): Promise<M>;
  openReference(file: Blob): Promise<R>;
  measureReference(model: M, reference: R): Measured;
  /** 기준 사진을 그 크기로 줄여 그린 그림의 주소. 만들지 못하면 null. */
  referencePreview(reference: R, size: FrameSize): Promise<string | null>;
  openVideo(file: Blob): Promise<V>;
  analyzeVideo(model: M, reference: FaceReading, video: V, hooks: AnalyzeHooks): Promise<AnalysisResult>;
  renderCandidate(video: V, requestedTimeSec: number, geometry: OutputGeometry | null): Promise<RenderedCandidate>;
  /** 순번 순서로 세운 사진 파일 묶음을 받는다. 여기서는 풀지 않는다. */
  openPhotos(files: readonly Blob[]): Promise<P>;
  /** 사진을 한 장씩 풀어 재고 고른다. 읽지 못한 파일은 결과의 `photos.unreadable` 로 센다. */
  analyzePhotos(model: M, reference: FaceReading, photos: P, hooks: PhotoAnalyzeHooks): Promise<AnalysisResult>;
  /**
   * 그 순번의 사진을 원본 크기로 다시 풀어 그린다. 원본 사진 그림은 긴 변 `maxLongSidePx` 까지로 줄인다.
   * 보정본은 `geometry` 의 크기 그대로다.
   */
  renderPhoto(
    photos: P,
    photoNumber: number,
    geometry: OutputGeometry | null,
    maxLongSidePx: number,
  ): Promise<RenderedCandidate>;
  /** SHA-256(소문자 16진수). 기기 안에서 계산한다. 계산할 수 없으면 null. */
  hashBlob(blob: Blob): Promise<string | null>;
  urlFor(blob: Blob): string;
  revokeUrl(url: string): void;
  now(): Date;
}

/** 파일의 수정 시각과 이름. 브라우저의 File 에만 있다. */
type MaybeFile = Blob & { lastModified?: number; name?: unknown };

/** 파일 이름. 순서를 정하고 화면에 보이는 데만 쓴다. 없으면 빈 문자열. */
function nameOf(file: MaybeFile): string {
  return typeof file.name === "string" ? file.name : "";
}

function modifiedAtOf(file: MaybeFile): string | null {
  const t = file.lastModified;
  if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface PickSession {
  getState(): PickState;
  subscribe(listener: () => void): () => void;
  setShotKind(kind: ShotKind): void;
  chooseReference(file: Blob): Promise<void>;
  /** 얼굴 모델을 받지 못했을 때 같은 사진으로 다시. */
  retryReference(): Promise<void>;
  goToVideo(): void;
  backToReference(): void;
  chooseVideo(file: Blob): Promise<void>;
  /** 동영상 대신 연사로 찍은 사진 여러 장을 고른다. 파일 이름 순으로 세우고 상한까지만 본다. */
  choosePhotos(files: readonly Blob[]): Promise<void>;
  cancel(): void;
  noteHidden(): void;
  chooseCandidate(rank: number): Promise<void>;
  showAnyway(): void;
  retake(): void;
  setMemo(memo: string): void;
  setRetakeReason(reason: string | null): void;
  prepareExport(): Promise<void>;
  reset(): void;
  /** 화면을 떠날 때. 모델·사진·동영상·그림을 전부 놓는다. */
  dispose(): void;
}

export function createPickSession<
  M extends ModelHandle,
  R extends ReferenceHandle,
  V extends VideoHandle,
  P extends PhotoSetHandle = PhotoSetHandle,
>(deps: PickDeps<M, R, V, P>, shotKind: ShotKind = "front"): PickSession {
  let state = initialState(shotKind);
  const listeners = new Set<() => void>();
  const dispatch = (a: Action) => {
    const next = reduce(state, a);
    if (next === state) return;
    state = next;
    for (const l of listeners) l();
  };

  let disposed = false;
  let model: M | null = null;
  let modelLoading: Promise<M> | null = null;
  let reference: R | null = null;
  let referenceFile: Blob | null = null;
  let video: V | null = null;
  /** 사진 여러 장이 입력일 때의 손잡이와, 순번 순서의 파일(`files[순번 − 1]`). 동영상과 함께 있지 않다. */
  let photos: { handle: P; files: readonly Blob[] } | null = null;
  /** 기준 사진을 고를 때마다, 동영상을 고를 때마다 오른다. 늦게 끝난 일을 가려낸다. */
  let referenceGen = 0;
  let videoGen = 0;
  let cancelRequested = false;
  /** 지금 보는 후보의 큰 그림. */
  let current: { rank: number; rendered: RenderedCandidate } | null = null;
  /** 놓아야 할 주소들(작은 그림, 기준 사진 그림, 저장 파일). */
  const thumbUrls = new Set<string>();
  let previewUrl: string | null = null;
  let exportUrls: string[] = [];
  /** 저장 파일 묶음의 세대. 메모·사유·후보·사진 종류가 바뀌면 오르고, 만들던 묶음은 버려진다. */
  let exportGen = 0;
  /** 동영상을 건드리는 일을 한 줄로 세운다. */
  let videoQueue: Promise<void> = Promise.resolve();

  // 클로저 안에서 바뀌는 값은 함수로 읽는다(타입 좁히기가 예전 값을 붙들지 않게).
  const currentRank = (): number | null => current?.rank ?? null;
  const exportStatus = (): PickState["exportState"]["status"] => state.exportState.status;

  const enqueue = (job: () => Promise<void>): Promise<void> => {
    const run = videoQueue.then(job, job);
    videoQueue = run.catch(() => {});
    return run;
  };

  const dropExport = () => {
    exportGen++;
    for (const u of exportUrls) deps.revokeUrl(u);
    exportUrls = [];
  };

  const dropImages = () => {
    if (current) {
      current.rendered.release(false);
      current = null;
    }
    for (const u of thumbUrls) deps.revokeUrl(u);
    thumbUrls.clear();
    dropExport();
  };

  const dropVideo = () => {
    videoGen++;
    cancelRequested = true;
    dropImages();
    if (video) {
      video.close();
      video = null;
    }
    if (photos) {
      photos.handle.close();
      photos = null;
    }
  };

  const dropReference = () => {
    referenceGen++;
    dropVideo();
    if (reference) {
      reference.close();
      reference = null;
    }
    if (previewUrl) {
      deps.revokeUrl(previewUrl);
      previewUrl = null;
    }
  };

  const ensureModel = (): Promise<M> => {
    if (model) return Promise.resolve(model);
    if (!modelLoading) {
      modelLoading = deps
        .loadModel((message) => dispatch({ type: "model/progress", message }))
        .then(
          (m) => {
            modelLoading = null;
            if (disposed) {
              m.close();
              throw new Error("화면을 떠났습니다.");
            }
            model = m;
            return m;
          },
          (e) => {
            modelLoading = null;
            throw e;
          },
        );
    }
    return modelLoading;
  };

  const referenceInfo = () => (state.reference.status === "ready" ? state.reference.info : null);
  const videoInfo = () => (state.video.status === "ready" ? state.video.info : null);
  const photoHandle = () => photos;

  /** 지금의 입력원: 동영상이면 그 해상도와 길이, 사진 여러 장이면 "photos". 없으면 null. */
  const sourceInput = (): SourceInput | null => {
    if (photoSetOf(state)) return "photos";
    const vid = videoInfo();
    return vid ? { videoNative: { width: vid.width, height: vid.height }, videoDurationSec: vid.durationSec } : null;
  };

  /** 후보 하나의 판정 맥락. 화면(`view.ts`)과 기록이 같은 함수로 만든다. */
  const contextOf = (analysis: PickedAnalysis, candidate: Candidate): JudgeContext | null => {
    const ref = referenceInfo();
    const src = sourceInput();
    if (!ref || !src) return null;
    return contextForCandidate(
      { reference: ref.measured, referenceOriginal: { width: ref.width, height: ref.height } },
      src,
      analysis,
      candidate,
    );
  };

  /** 후보 하나를 다시 뽑아 그린다. 작은 그림은 남기고, `keep` 이면 큰 그림도 지금 보는 것으로 둔다. */
  const renderOne = async (analysis: PickedAnalysis, rank: number, keep: boolean, gen: number): Promise<void> => {
    const candidate = candidateOf(analysis, rank);
    const ctx = candidate ? contextOf(analysis, candidate) : null;
    const set = photoHandle();
    if (!candidate || !ctx || (!video && !set)) return;
    const geometry = judgeOf(candidate, ctx).output;
    let rendered: RenderedCandidate;
    if (set) {
      // 사진 여러 장: 그 순번의 파일을 원본 크기로 다시 푼다.
      rendered = await deps.renderPhoto(
        set.handle,
        photoNumberOf(candidate.measurement.timeSec),
        geometry,
        RULES.photos.outputMaxLongSidePx,
      );
    } else if (video) {
      rendered = await deps.renderCandidate(video, candidate.measurement.requestedTimeSec, geometry);
    } else {
      return;
    }
    if (gen !== videoGen || disposed) {
      rendered.release(false);
      return;
    }
    const known = state.images[rank]?.thumbUrl ?? null;
    let thumbUrl = known;
    if (known === null && rendered.thumbUrl !== null) {
      thumbUrl = rendered.thumbUrl;
      thumbUrls.add(rendered.thumbUrl);
    } else if (rendered.thumbUrl !== null) {
      // 이미 작은 그림이 있으면 새로 만든 것은 버린다.
      deps.revokeUrl(rendered.thumbUrl);
    }
    if (keep && state.chosenRank === rank) {
      if (current) current.rendered.release(true);
      current = { rank, rendered };
      dispatch({
        type: "images",
        rank,
        images: {
          thumbUrl,
          originalUrl: rendered.originalUrl,
          correctedUrl: rendered.correctedUrl,
          grabbedTimeSec: rendered.grabbedTimeSec,
        },
      });
    } else {
      rendered.release(true);
      dispatch({ type: "images", rank, images: { thumbUrl } });
    }
  };

  /** 지금 고른 후보의 큰 그림을 만든다. */
  const renderChosen = (gen: number): Promise<void> =>
    enqueue(async () => {
      const analysis = pickedOf(state);
      const rank = state.chosenRank;
      if (!analysis || rank === null || gen !== videoGen) return;
      if (current && current.rank === rank) {
        // 다른 후보로 갔다가 그림을 만들기 전에 돌아온 경우. 들고 있는 그림이 그대로 맞다.
        dispatch({ type: "imageStatus", status: "ready" });
        return;
      }
      dispatch({ type: "imageStatus", status: "rendering" });
      try {
        // 예전 후보의 큰 그림 주소를 상태에서 먼저 지운다(놓인 주소를 화면이 가리키지 않게).
        if (current) {
          const old = current.rank;
          current.rendered.release(true);
          current = null;
          dispatch({ type: "images", rank: old, images: { originalUrl: null, correctedUrl: null, grabbedTimeSec: null } });
        }
        await renderOne(analysis, rank, true, gen);
        if (gen === videoGen && state.chosenRank === rank) {
          dispatch({ type: "imageStatus", status: currentRank() === rank ? "ready" : "failed" });
        }
      } catch {
        if (gen === videoGen) dispatch({ type: "imageStatus", status: "failed" });
      }
    });

  /** 차점 후보의 작은 그림을 차례로 만든다. 실패해도 결과 화면은 그대로다(그림 없이 숫자만 보인다). */
  const renderThumbs = (gen: number): Promise<void> =>
    enqueue(async () => {
      const analysis = pickedOf(state);
      if (!analysis || gen !== videoGen) return;
      for (const c of candidatesOf(analysis)) {
        if (gen !== videoGen || disposed) return;
        if (state.images[c.rank]?.thumbUrl) continue;
        try {
          await renderOne(analysis, c.rank, false, gen);
        } catch {
          // 작은 그림 하나를 못 만든 것으로 멈추지 않는다.
        }
      }
    });

  const startReference = async (file: Blob): Promise<void> => {
    dropReference();
    const gen = referenceGen;
    referenceFile = file;
    dispatch({ type: "reference/reading" });
    const stale = () => gen !== referenceGen || disposed;
    const fail = (failure: Failure) => {
      if (!stale()) dispatch({ type: "reference/failed", failure });
    };

    let opened: R;
    try {
      opened = await deps.openReference(file);
    } catch (e) {
      fail(failureOf(e, "reference"));
      return;
    }
    if (stale()) {
      opened.close();
      return;
    }

    let m: M;
    try {
      m = await ensureModel();
    } catch (e) {
      opened.close();
      fail(failureOf(e, "model"));
      return;
    }
    if (stale()) {
      opened.close();
      return;
    }

    let measured: Measured;
    try {
      measured = deps.measureReference(m, opened);
    } catch (e) {
      opened.close();
      fail(failureOf(e, "analysis"));
      return;
    }
    const assessed = assessReference(measured);
    if (!assessed.ok) {
      opened.close();
      fail({ kind: "stop", code: assessed.stop, reason: assessed.reason });
      return;
    }

    const size = { width: opened.width, height: opened.height };
    const [sha, preview] = await Promise.all([
      deps.hashBlob(file).catch(() => null),
      deps.referencePreview(opened, outputSize(size) ?? size).catch(() => null),
    ]);
    if (stale()) {
      opened.close();
      if (preview) deps.revokeUrl(preview);
      return;
    }
    reference = opened;
    previewUrl = preview;
    dispatch({
      type: "reference/ready",
      info: {
        width: opened.width,
        height: opened.height,
        measured: { ...measured, face: assessed.face },
        fileSha256: sha,
        previewUrl: preview,
      },
    });
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setShotKind(kind) {
      if (kind !== state.shotKind) dropExport();
      dispatch({ type: "shotKind", shotKind: kind });
    },

    chooseReference: (file) => startReference(file),
    retryReference: () => (referenceFile ? startReference(referenceFile) : Promise.resolve()),

    goToVideo: () => dispatch({ type: "step", step: "video" }),
    backToReference: () => dispatch({ type: "step", step: "reference" }),

    async chooseVideo(file) {
      const ref = referenceInfo();
      if (!ref || !model || state.analysis.status === "running" || state.video.status === "opening") return;
      const m = model;
      dropVideo();
      const gen = videoGen;
      cancelRequested = false;
      dispatch({ type: "video/opening" });
      const stale = () => gen !== videoGen || disposed;

      let opened: V;
      try {
        opened = await deps.openVideo(file);
      } catch (e) {
        if (!stale()) dispatch({ type: "video/failed", failure: failureOf(e, "video") });
        return;
      }
      if (stale()) {
        opened.close();
        return;
      }
      video = opened;
      dispatch({
        type: "video/ready",
        info: {
          width: opened.width,
          height: opened.height,
          durationSec: opened.durationSec,
          fileModifiedAt: modifiedAtOf(file),
        },
      });

      let result: AnalysisResult;
      try {
        result = await deps.analyzeVideo(m, ref.measured.face, opened, {
          onProgress: (progress) => {
            if (!stale()) dispatch({ type: "analysis/progress", progress });
          },
          onQuickAnswer: (quickAnswer) => {
            if (!stale()) dispatch({ type: "analysis/quick", quickAnswer });
          },
          isCancelled: () => cancelRequested || stale(),
        });
      } catch (e) {
        if (stale()) return;
        const failure = failureOf(e, "analysis");
        opened.close();
        video = null;
        // 분석 도중 장면을 읽지 못한 것(VideoUnreadableError)은 "동영상을 읽을 수 없음"으로 나온다.
        dispatch({ type: "analysis/failed", failure });
        return;
      }
      if (stale()) return;

      if (result.kind === "cancelled") {
        opened.close();
        video = null;
        dispatch({ type: "analysis/cancelled" });
        return;
      }
      dispatch({ type: "analysis/done", result });
      if (result.kind === "picked") {
        await renderChosen(gen);
        await renderThumbs(gen);
      } else {
        // 멈춘 결과에서는 동영상을 더 쓸 일이 없다.
        opened.close();
        video = null;
      }
    },

    async choosePhotos(files) {
      const ref = referenceInfo();
      if (!ref || !model || state.analysis.status === "running" || state.video.status === "opening") return;
      if (files.length === 0) return;
      const m = model;
      dropVideo();
      const gen = videoGen;
      cancelRequested = false;
      dispatch({ type: "video/opening" });
      const stale = () => gen !== videoGen || disposed;

      // 파일 이름 순으로 세우고 상한까지만 본다. 이름은 여기와 화면 상태에만 있다.
      const names = files.map(nameOf);
      const plan = planPhotoSet(names);
      const ordered = plan.order.map((i) => files[i]);

      let opened: P;
      try {
        opened = await deps.openPhotos(ordered);
      } catch (e) {
        if (!stale()) dispatch({ type: "video/failed", failure: failureOf(e, "analysis") });
        return;
      }
      if (stale()) {
        opened.close();
        return;
      }
      photos = { handle: opened, files: ordered };
      dispatch({
        type: "photos/ready",
        set: { selected: plan.selected, used: plan.used, names: plan.order.map((i) => names[i]) },
      });

      let result: AnalysisResult;
      try {
        result = await deps.analyzePhotos(m, ref.measured.face, opened, {
          onProgress: (progress) => {
            if (!stale()) dispatch({ type: "analysis/progress", progress });
          },
          isCancelled: () => cancelRequested || stale(),
        });
      } catch (e) {
        if (stale()) return;
        opened.close();
        photos = null;
        dispatch({ type: "analysis/failed", failure: failureOf(e, "analysis") });
        return;
      }
      if (stale()) return;

      if (result.kind === "cancelled") {
        opened.close();
        photos = null;
        dispatch({ type: "analysis/cancelled" });
        return;
      }
      dispatch({ type: "analysis/done", result });
      if (result.kind === "picked") {
        await renderChosen(gen);
        await renderThumbs(gen);
      } else {
        // 멈춘 결과에서는 사진을 더 쓸 일이 없다.
        opened.close();
        photos = null;
      }
    },

    cancel() {
      if (state.video.status === "opening") {
        // 여는 중에는 기다릴 분석이 없다. 세대를 올려 늦게 열린 동영상이 닫히게 하고 바로 돌아간다
        // (열기가 끝나거나 제한 시간이 될 때까지 버튼이 반응하지 않던 문제).
        videoGen++;
        cancelRequested = true;
        dispatch({ type: "analysis/cancelled" });
        return;
      }
      if (state.analysis.status !== "running") return;
      cancelRequested = true;
      dispatch({ type: "analysis/cancelling" });
    },

    noteHidden: () => dispatch({ type: "hidden" }),

    async chooseCandidate(rank) {
      const before = state.chosenRank;
      dispatch({ type: "candidate", rank });
      if (state.chosenRank === before) return;
      dropExport();
      await renderChosen(videoGen);
    },

    showAnyway: () => dispatch({ type: "showAnyway" }),

    retake: () => dispatch({ type: "retake" }),

    setMemo(memo) {
      const before = state.memo;
      dispatch({ type: "memo", memo });
      if (state.memo !== before) dropExport();
    },

    setRetakeReason(reason) {
      const before = state.retakeReason;
      dispatch({ type: "retakeReason", reason });
      if (state.retakeReason !== before) dropExport();
    },

    async prepareExport() {
      const analysis = pickedOf(state);
      const ref = referenceInfo();
      const vid = videoInfo();
      const photoSet = photoSetOf(state);
      const rank = state.chosenRank;
      if (!analysis || !ref || (!vid && !photoSet) || rank === null || state.exportState.status === "preparing") return;
      const candidate = candidateOf(analysis, rank);
      if (!candidate) return;
      const gen = videoGen;
      const snapshot = { memo: state.memo, reason: state.retakeReason, shotKind: state.shotKind };
      const ctx = contextOf(analysis, candidate);
      if (!ctx) return;
      const j = judgeOf(candidate, ctx);
      // 통과 기준을 넘는 장면은 사유 없이 저장하지 않는다(화면의 버튼이 잠겨 있어도 여기서 한 번 더 막는다).
      if (j.verdict !== "close" && snapshot.reason === null) return;
      dropExport();
      // 만드는 동안 메모·사유·후보·사진 종류가 바뀌면 세대가 올라 이 묶음은 버려진다
      // (기록에 적힌 메모·해시와 파일이 어긋나지 않게).
      const mine = exportGen;
      const stale = () => mine !== exportGen || gen !== videoGen || disposed;

      dispatch({ type: "export", exportState: { status: "preparing" } });
      const made: string[] = [];
      try {
        // 큰 그림이 아직 없으면(만들지 못했으면) 한 번 더 만든다.
        if (!current || current.rank !== rank) await renderChosen(gen);
        if (stale()) return;
        if (!current || current.rank !== rank) throw new Error("고른 장면의 그림을 만들지 못했습니다.");
        const rendered = current.rendered;

        const now = deps.now();
        const noCloseScene = analysis.winner.verdict !== "close";
        const names = exportNames({ shotKind: snapshot.shotKind, date: now, memo: snapshot.memo });
        const band = (kind: "corrected" | "original") =>
          bandLines({
            kind,
            verdict: j.verdict,
            noCloseScene,
            angleDeg: j.numbers.angleDeg,
            shotKind: snapshot.shotKind,
            date: now,
            source: photoSet ? "photos" : undefined,
          });

        const originalPng = await rendered.exportPng("original", band("original"));
        const correctedPng = rendered.correctedUrl !== null ? await rendered.exportPng("corrected", band("corrected")) : null;
        const [originalSha, correctedSha] = await Promise.all([
          deps.hashBlob(originalPng).catch(() => null),
          correctedPng ? deps.hashBlob(correctedPng).catch(() => null) : Promise.resolve(null),
        ]);
        if (stale()) return;

        const common = {
          createdAt: now.toISOString(),
          shotKind: snapshot.shotKind,
          reference: {
            measured: ref.measured,
            original: { width: ref.width, height: ref.height },
            fileSha256: ref.fileSha256,
          },
          analysis,
          chosenRank: rank,
          retakeCount: retakeCountOf(state),
          // 사유는 통과 기준을 넘은 장면을 저장할 때만 남긴다.
          retakeReason: j.verdict === "close" ? null : snapshot.reason,
          memo: memoForRecord(snapshot.memo),
          files: { originalPngSha256: originalSha, correctedPngSha256: correctedSha },
        };
        let record: unknown;
        if (photoSet) {
          // 사진 여러 장: 어느 파일인지는 이름이 아니라 순번과 원본 파일의 해시로 남긴다.
          const file = photoHandle()?.files[photoNumberOf(candidate.measurement.timeSec) - 1];
          const chosenFileSha256 = file ? await deps.hashBlob(file).catch(() => null) : null;
          if (stale()) return;
          record = buildPhotoPickRecord({ ...common, photos: { selected: photoSet.selected, chosenFileSha256 } });
        } else if (vid) {
          record = buildPickRecord({
            ...common,
            video: {
              native: { width: vid.width, height: vid.height },
              durationSec: vid.durationSec,
              fileModifiedAt: vid.fileModifiedAt,
            },
          });
        } else {
          return;
        }
        const recordBlob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });

        const file = (kind: ExportFile["kind"], label: string, name: string, blob: Blob): ExportFile => {
          const url = deps.urlFor(blob);
          made.push(url);
          return { kind, label, name, url, bytes: blob.size };
        };
        const files: ExportFile[] = [];
        if (correctedPng) files.push(file("corrected", "보정본 PNG", names.corrected, correctedPng));
        files.push(file("original", photoSet ? "원본 사진 PNG" : "원본 장면 PNG", names.original, originalPng));
        files.push(file("record", "기록 JSON", names.record, recordBlob));

        if (stale()) {
          for (const u of made) deps.revokeUrl(u);
          return;
        }
        exportUrls = made;
        dispatch({ type: "export", exportState: { status: "ready", files } });
      } catch (e) {
        for (const u of made) deps.revokeUrl(u);
        if (!stale()) {
          const f = failureOf(e, "export");
          dispatch({ type: "export", exportState: { status: "failed", detail: f.kind === "stop" ? (f.detail ?? "") : f.detail } });
        }
      } finally {
        // 이 묶음이 아직 "만드는 중"으로 남아 있으면 되돌린다(도중에 빠져나온 경우).
        if (!stale() && exportStatus() === "preparing") {
          dispatch({ type: "export", exportState: { status: "idle" } });
        }
      }
    },

    reset() {
      dropReference();
      referenceFile = null;
      dispatch({ type: "reset" });
    },

    dispose() {
      if (disposed) return;
      dropReference();
      disposed = true;
      referenceFile = null;
      if (model) {
        model.close();
        model = null;
      }
      listeners.clear();
    },
  };
}
