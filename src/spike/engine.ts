/**
 * FaceLandmarker 생성.
 *
 * `@mediapipe/tasks-vision` 은 top-level import 하지 않고 동적 import 한다. 홈 화면만 보는
 * 사람에게 모듈을 내려보낼 이유가 없고, 정적 내보내기 프리렌더에서 브라우저 전역을
 * 건드리지 않게 하려는 것이다.
 *
 * WASM 은 같은 출처(/mediapipe/wasm, scripts/copy-wasm.mjs 가 복사), 모델은 Google 공식 URL.
 * GPU 실패 시 CPU 로 자동 폴백하지 않는다 — 점검에서는 "GPU 가 되는가" 자체가
 * 측정 대상이라, 조용히 CPU 로 바꾸면 결과가 거짓말이 된다.
 */

import type { FaceLandmarker } from "@mediapipe/tasks-vision";

/** package.json 의 @mediapipe/tasks-vision 과 반드시 같아야 한다(copy-wasm 이 설치본을 검사). */
export const MP_VERSION = "1.0.1";
export const WASM_BASE = "/mediapipe/wasm";
export const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export type Delegate = "CPU" | "GPU";
export type RunningMode = "VIDEO" | "IMAGE";

export interface LoadTimings {
  importMs: number;
  filesetMs: number;
  createMs: number;
  totalMs: number;
}

export interface LoadedLandmarker {
  landmarker: FaceLandmarker;
  delegate: Delegate;
  numFaces: number;
  runningMode: RunningMode;
  timings: LoadTimings;
}

/** 단계마다 제한 시간. 영원한 대기는 복구할 수 없지만 실패는 화면에 적을 수 있다. */
export const STEP_TIMEOUT_MS = 30_000;

function withTimeout<T>(p: Promise<T>, what: string, onLate?: (v: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(`${what}: ${STEP_TIMEOUT_MS / 1000}초 안에 끝나지 않음`));
    }, STEP_TIMEOUT_MS);
    p.then(
      (v) => {
        if (settled) {
          onLate?.(v);
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export async function loadFaceLandmarker(opts: {
  delegate: Delegate;
  numFaces: number;
  runningMode: RunningMode;
  onProgress?: (msg: string) => void;
}): Promise<LoadedLandmarker> {
  const progress = opts.onProgress ?? (() => {});
  const t0 = performance.now();

  progress("모듈 불러오는 중…");
  const mod = await withTimeout(import("@mediapipe/tasks-vision"), "모듈 import");
  const t1 = performance.now();

  progress("WASM 경로 확인 중…");
  const fileset = await withTimeout(mod.FilesetResolver.forVisionTasks(WASM_BASE), "WASM 파일셋");
  const t2 = performance.now();

  progress(`모델 받고 초기화 중… (${opts.delegate}, ${opts.runningMode})`);
  const landmarker = await withTimeout(
    mod.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: opts.delegate },
      runningMode: opts.runningMode,
      numFaces: opts.numFaces,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
    }),
    "모델 초기화",
    // 제한 시간 뒤에 도착한 인스턴스는 아무도 쓰지 않는다. 닫지 않으면 WASM·GPU 자원이 남는다.
    (late) => late.close(),
  );
  const t3 = performance.now();
  progress("준비 완료");

  return {
    landmarker,
    delegate: opts.delegate,
    numFaces: opts.numFaces,
    runningMode: opts.runningMode,
    timings: { importMs: t1 - t0, filesetMs: t2 - t1, createMs: t3 - t2, totalMs: t3 - t0 },
  };
}
