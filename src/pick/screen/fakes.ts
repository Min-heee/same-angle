/**
 * 시험용 가짜 브라우저. **앱 코드는 이 파일을 가져오지 않는다**(시험 파일만 가져온다).
 *
 * 접착부(`session.ts`)가 받는 `PickDeps` 를 전부 가짜로 채운다: 파일 열기·얼굴 모델·장면 뽑기·그림·
 * 해시. 얼굴 사진도 동영상도 없다. "동영상"은 시각 t 에서의 보는 방향을 주는 함수이고, 측정값은
 * `testkit.ts` 의 합성 값이다. 분석은 **진짜 엔진(`analyze`)** 이 돈다 — 가짜인 것은 측정뿐이다.
 *
 * 그래서 이 시험이 확인하는 것은 화면 흐름과 접착(순서, 늦게 끝난 일 버리기, 주소·손잡이 놓기,
 * 기록 만들기)이고, 실제 브라우저·실제 얼굴에서의 동작이 아니다.
 */

import { createHash } from "node:crypto";
import { analyzePhotos } from "../burst";
import type { TracePoint } from "../direction";
import type { FrameMeasurement, FrameSize, Measured } from "../measure";
import { analyze, type ScanPhase } from "../pipeline";
import { crossSweep, synthFace, synthFrame, type SynthFrameOptions } from "../testkit";
import type {
  ModelHandle,
  PhotoSetHandle,
  PickDeps,
  ReferenceHandle,
  RenderedCandidate,
  VideoHandle,
} from "./session";

export type FakeModel = ModelHandle & { id: number };
export type FakeReference = ReferenceHandle & { id: number };
export type FakeVideo = VideoHandle & { id: number; closed: boolean };
export type FakePhotoSet = PhotoSetHandle & { id: number; closed: boolean; files: readonly Blob[] };

/**
 * 가짜 사진 한 장이 "재면 나오는 값". 얼굴 사진이 아니라 숫자다. `unreadable` 이면 브라우저가 풀지
 * 못하는 파일(RAW·HEIC 등)을 흉내 낸다.
 */
export interface FakePhotoSpec extends Partial<Omit<SynthFrameOptions, "timeSec">> {
  unreadable?: boolean;
  /** 그 사진의 원본 크기. 없으면 묶음의 기본 크기. */
  photoSize?: FrameSize;
}

const PHOTO_SPECS = new WeakMap<Blob, FakePhotoSpec>();

/** 가짜 사진 파일. 이름이 붙은 Blob 이고, 내용은 이름뿐이다(얼굴 사진이 아니다). */
export function fakePhoto(name: string, spec: FakePhotoSpec = {}): Blob {
  const file = Object.assign(new Blob([`사진:${name}`]), { name });
  PHOTO_SPECS.set(file, spec);
  return file;
}

/** 가짜 사진의 이름(시험이 순서를 확인할 때 쓴다). */
export function fakePhotoName(file: Blob): string {
  return (file as Blob & { name?: string }).name ?? "";
}

/** 이름으로 알아보는 접착부 예외(브라우저 모듈을 끌어오지 않는다). */
export function namedError(name: "ReferenceUnreadableError" | "VideoUnreadableError", message: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

/** 얼굴을 읽은 기준 사진의 측정값. */
export function referenceMeasured(dir: TracePoint = { h: 0, v: 0 }): Measured {
  return { faceCount: 1, face: synthFace({ dir }), faceFailure: null, sharpness: 100, skin: { meanLuma: 128, clipRatio: 0 } };
}

export function referenceFailed(failure: NonNullable<Measured["faceFailure"]>): Measured {
  const faceCount = failure === "noFace" ? 0 : failure === "multipleFaces" ? 2 : 1;
  return { faceCount, face: null, faceFailure: failure, sharpness: null, skin: null };
}

export interface FakeOptions {
  /** 기준 사진을 재면 나오는 값. */
  reference?: () => Measured;
  referenceSize?: FrameSize;
  /** 기준 사진 파일을 열 수 없게 한다(S5). */
  referenceUnreadable?: boolean;
  /** 얼굴 모델 받기가 실패하는가(부를 때마다 묻는다). */
  modelFails?: () => boolean;
  videoSize?: FrameSize;
  durationSec?: number;
  /** 동영상을 열 수 없게 한다(S3). */
  videoUnreadable?: boolean;
  /** 시각 t 에서의 보는 방향. 기본은 PRD 의 찍는 방법(3초 정지 뒤 십자 왕복). */
  at?: (t: number) => TracePoint;
  /** 장면마다 바꿀 값(얼굴 없음·흐림 등). */
  alter?: (t: number, phase: ScanPhase) => Partial<SynthFrameOptions> | undefined;
  /** 장면을 재기 직전에 불린다. 여기서 예외를 던지면 그 장면을 읽지 못한 것이다. */
  beforeMeasure?: (t: number, phase: ScanPhase, count: number) => void | Promise<void>;
  /** 그림 그리기를 실패시킨다(부를 때마다 묻는다). */
  renderFails?: (requestedTimeSec: number) => boolean;
  /** 사진 묶음의 기본 원본 크기. */
  photoSize?: FrameSize;
  /** 사진을 재기 직전에 불린다(순번, 단계). 여기서 예외를 던지면 분석이 그 예외로 끝난다. */
  beforePhoto?: (photoNumber: number, phase: "coarse" | "remeasure") => void | Promise<void>;
  /** 다시 잴 때 그 순번의 사진을 읽지 못하게 한다. */
  photoUnreadableOnRemeasure?: (photoNumber: number) => boolean;
  now?: Date;
}

export interface FakeLog {
  /** 만든 주소와 놓은 주소. 끝나면 같아야 한다(새는 주소 없음). */
  created: string[];
  revoked: string[];
  modelLoads: number;
  modelClosed: number;
  referencesOpened: number;
  referencesClosed: number;
  videos: FakeVideo[];
  photoSets: FakePhotoSet[];
  /** 사진을 풀어 잰 기록(순번, 단계, 파일 이름)과, 그때 다른 사진이 풀려 있었는지. */
  photoMeasures: { photoNumber: number; phase: "coarse" | "remeasure"; name: string; overlapped: boolean }[];
  /** 사진 그림 요청(순번, 파일 이름, 원본 사진 그림의 긴 변 상한). */
  photoRenders: { photoNumber: number; name: string; hadGeometry: boolean; maxLongSidePx: number }[];
  /** 장면 뽑기 요청(시각)과, 그때 다른 뽑기가 끝나지 않았는지. */
  renders: { requestedTimeSec: number; overlapped: boolean; hadGeometry: boolean }[];
  /** 큰 그림을 놓은 기록. */
  releases: { requestedTimeSec: number; keepThumb: boolean }[];
  /** 만든 PNG 의 내용(가짜: 종류·시각·띠의 줄). */
  pngs: { kind: "corrected" | "original"; requestedTimeSec: number; lines: string[] }[];
  measures: number;
}

export function sha256Hex(bytes: ArrayBuffer | Uint8Array): string {
  return createHash("sha256")
    .update(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .digest("hex");
}

export function fakeBrowser(opts: FakeOptions = {}): {
  deps: PickDeps<FakeModel, FakeReference, FakeVideo>;
  log: FakeLog;
} {
  const log: FakeLog = {
    created: [],
    revoked: [],
    modelLoads: 0,
    modelClosed: 0,
    referencesOpened: 0,
    referencesClosed: 0,
    videos: [],
    photoSets: [],
    photoMeasures: [],
    photoRenders: [],
    renders: [],
    releases: [],
    pngs: [],
    measures: 0,
  };
  let seq = 0;
  const url = (tag: string) => {
    const u = `blob:fake/${tag}/${++seq}`;
    log.created.push(u);
    return u;
  };
  const revoke = (u: string) => {
    log.revoked.push(u);
  };
  const sweep = crossSweep();
  const at = opts.at ?? sweep.at;
  const durationSec = opts.durationSec ?? sweep.durationSec;
  let rendering = 0;
  let decoding = 0;

  /** 가짜 그림 한 벌(원본·보정본·작은 그림). 동영상 장면과 사진이 함께 쓴다. */
  const rendered = (requestedTimeSec: number, hasGeometry: boolean): RenderedCandidate => {
    const urls = [url("original")];
    const correctedUrl = hasGeometry ? url("corrected") : null;
    if (correctedUrl) urls.push(correctedUrl);
    let thumb: string | null = url("thumb");
    let released = false;
    return {
      thumbUrl: thumb,
      originalUrl: urls[0],
      correctedUrl,
      grabbedTimeSec: null,
      async exportPng(kind, lines) {
        if (released) throw new Error("놓은 그림에서 PNG 를 만들려 했습니다.");
        if (kind === "corrected" && correctedUrl === null) throw new Error("보정본이 없습니다.");
        log.pngs.push({ kind, requestedTimeSec, lines: [...lines] });
        return new Blob([`${kind}@${requestedTimeSec}\n${lines.join("\n")}`], { type: "image/png" });
      },
      release(keepThumb) {
        if (!released) for (const u of urls) revoke(u);
        released = true;
        log.releases.push({ requestedTimeSec, keepThumb });
        if (!keepThumb && thumb) {
          revoke(thumb);
          thumb = null;
        }
      },
    };
  };

  const deps: PickDeps<FakeModel, FakeReference, FakeVideo, FakePhotoSet> = {
    async loadModel(onProgress) {
      log.modelLoads++;
      onProgress("가짜 모델 받는 중…");
      await Promise.resolve();
      if (opts.modelFails?.()) throw new Error("Failed to fetch");
      return { id: log.modelLoads, close: () => void log.modelClosed++ };
    },

    async openReference() {
      await Promise.resolve();
      if (opts.referenceUnreadable) throw namedError("ReferenceUnreadableError", "기준 사진을 읽을 수 없습니다: 가짜");
      log.referencesOpened++;
      const size = opts.referenceSize ?? { width: 3024, height: 4032 };
      return { id: log.referencesOpened, ...size, close: () => void log.referencesClosed++ };
    },

    measureReference: () => (opts.reference ?? (() => referenceMeasured()))(),

    referencePreview: async () => url("preview"),

    async openVideo() {
      await Promise.resolve();
      if (opts.videoUnreadable) throw namedError("VideoUnreadableError", "동영상을 읽을 수 없습니다: 가짜");
      const size = opts.videoSize ?? { width: 1440, height: 1920 };
      const v: FakeVideo = {
        id: log.videos.length + 1,
        ...size,
        durationSec,
        closed: false,
        close() {
          v.closed = true;
        },
      };
      log.videos.push(v);
      return v;
    },

    analyzeVideo: (_model, reference, video, hooks) =>
      analyze({
        reference,
        durationSec: video.durationSec,
        measureAt: async (timeSec, phase): Promise<FrameMeasurement> => {
          log.measures++;
          await opts.beforeMeasure?.(timeSec, phase, log.measures);
          return synthFrame({ timeSec, dir: at(timeSec), ...opts.alter?.(timeSec, phase) });
        },
        yieldToUi: () => Promise.resolve(),
        ...hooks,
      }),

    async renderCandidate(_video, requestedTimeSec, geometry): Promise<RenderedCandidate> {
      const overlapped = rendering > 0;
      rendering++;
      try {
        await Promise.resolve();
        log.renders.push({ requestedTimeSec, overlapped, hadGeometry: geometry !== null });
        if (opts.renderFails?.(requestedTimeSec)) throw new Error("가짜 그림 실패");
        return rendered(requestedTimeSec, geometry !== null);
      } finally {
        rendering--;
      }
    },

    async openPhotos(files) {
      await Promise.resolve();
      const p: FakePhotoSet = {
        id: log.photoSets.length + 1,
        count: files.length,
        files: [...files],
        closed: false,
        close() {
          p.closed = true;
        },
      };
      log.photoSets.push(p);
      return p;
    },

    analyzePhotos: (_model, reference, photos, hooks) =>
      analyzePhotos({
        reference,
        count: photos.count,
        measurePhoto: async (photoNumber, phase) => {
          const file = photos.files[photoNumber - 1];
          const spec = PHOTO_SPECS.get(file) ?? {};
          // 한 장씩 풀어야 한다: 다른 사진이 아직 풀려 있으면 겹친 것이다.
          log.photoMeasures.push({ photoNumber, phase, name: fakePhotoName(file), overlapped: decoding > 0 });
          decoding++;
          try {
            await opts.beforePhoto?.(photoNumber, phase);
            if (spec.unreadable) return null;
            if (phase === "remeasure" && opts.photoUnreadableOnRemeasure?.(photoNumber)) return null;
            log.measures++;
            const { unreadable: _u, photoSize, ...frame } = spec;
            void _u;
            return {
              measured: synthFrame({ timeSec: photoNumber, ...frame }),
              size: photoSize ?? opts.photoSize ?? { width: 4000, height: 6000 },
            };
          } finally {
            decoding--;
          }
        },
        yieldToUi: () => Promise.resolve(),
        ...hooks,
      }),

    async renderPhoto(photos, photoNumber, geometry, maxLongSidePx): Promise<RenderedCandidate> {
      const overlapped = rendering > 0;
      rendering++;
      try {
        await Promise.resolve();
        const name = fakePhotoName(photos.files[photoNumber - 1]);
        log.photoRenders.push({ photoNumber, name, hadGeometry: geometry !== null, maxLongSidePx });
        log.renders.push({ requestedTimeSec: photoNumber, overlapped, hadGeometry: geometry !== null });
        if (opts.renderFails?.(photoNumber)) throw new Error("가짜 그림 실패");
        return rendered(photoNumber, geometry !== null);
      } finally {
        rendering--;
      }
    },

    hashBlob: async (blob) => sha256Hex(await blob.arrayBuffer()),
    urlFor: () => url("file"),
    revokeUrl: revoke,
    now: () => opts.now ?? new Date("2026-10-02T05:30:00.000Z"),
  };

  return { deps, log };
}

/** 놓지 않고 남은 주소. 화면을 떠난 뒤에는 비어 있어야 한다. */
export function leakedUrls(log: FakeLog): string[] {
  const revoked = new Set(log.revoked);
  return log.created.filter((u) => !revoked.has(u));
}
