/**
 * FaceLandmarker 생성.
 *
 * `@mediapipe/tasks-vision` 은 top-level import 하지 않고 동적 import 한다. 홈 화면만 보는
 * 사람에게 모듈을 내려보낼 이유가 없고, 정적 내보내기 프리렌더에서 브라우저 전역을
 * 건드리지 않게 하려는 것이다.
 *
 * WASM 은 같은 출처(/mediapipe/wasm, scripts/copy-wasm.mjs 가 복사), 모델은 Google 공식 URL.
 *
 * 사용 통계: 1.0.1 은 createFromOptions 마다 로거를 만들어 odml.pa.googleapis.com 으로 POST 한다
 * (끄는 옵션 없음). 모듈을 import 하기 전에 fetch 가드를 설치해 그 요청이 기기를 떠나기 전에
 * 막는다(netguard.ts). 배포본에서는 강제 CSP connect-src 가 한 겹 더 막는다.
 * GPU 실패 시 CPU 로 자동 폴백하지 않는다 — 점검에서는 "GPU 가 되는가" 자체가
 * 측정 대상이라, 조용히 CPU 로 바꾸면 결과가 거짓말이 된다.
 */

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { installFetchGuard } from "./netguard";

/** package.json 의 @mediapipe/tasks-vision 과 반드시 같아야 한다(copy-wasm 이 설치본을 검사). */
export const MP_VERSION = "1.0.1";
export const WASM_BASE = "/mediapipe/wasm";
export const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export type Delegate = "CPU" | "GPU";
export type RunningMode = "VIDEO" | "IMAGE";

export interface LoadTimings {
  importMs: number;
  /** SIMD 탐지(forVisionTasks). 파일을 받지 않는다. */
  filesetMs: number;
  /** WASM(약 12MB)·모델(약 3.6MB) 받기 + WASM 컴파일 + 그래프 초기화(createFromOptions). */
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
/**
 * 마지막 단계(createFromOptions)의 제한 시간. 이 단계 안에서 WASM(약 12MB)을 받아
 * 컴파일하고 모델(약 3.6MB)도 받는다 — forVisionTasks 는 SIMD 탐지 뒤 경로 문자열만 돌려준다
 * (vision_bundle.mjs). 휴대폰 통신망의 첫 로드가 30초 안에 15MB 를 받지 못해 "실패"로 적히지 않게 넉넉히.
 */
export const MODEL_INIT_TIMEOUT_MS = 60_000;

function withTimeout<T>(p: Promise<T>, what: string, ms: number, onLate?: (v: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(`${what}: ${ms / 1000}초 안에 끝나지 않음`));
    }, ms);
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

/**
 * 엔진 인스턴스 수. createFromOptions 마다 WASM 모듈 인스턴스(초기 메모리 18MB, 최대 2GB)와
 * WebGL 캔버스가 새로 생기고 close() 는 그래프만 닫는다. 아이폰 탭이 메모리로 죽으면 원인을 D1 에서
 * 따라갈 수 있게, 만든 수와 닫은 수를 센다(보고서 2·5·6·7번에 남는다).
 */
let createdCount = 0;
let closedCount = 0;

export interface EngineCounts {
  created: number;
  closed: number;
  /** 지금 열려 있는 수(= created − closed). */
  live: number;
}

export function engineCounts(): EngineCounts {
  return { created: createdCount, closed: closedCount, live: createdCount - closedCount };
}

/** close() 를 감싸 닫은 수를 센다. 누가 어디서 닫든(컨텍스트 정리, 늦게 온 인스턴스) 한 번만 센다. */
function countClose(l: FaceLandmarker): FaceLandmarker {
  createdCount++;
  const orig = l.close.bind(l);
  let done = false;
  l.close = () => {
    if (!done) {
      done = true;
      closedCount++;
    }
    orig();
  };
  return l;
}

export async function loadFaceLandmarker(opts: {
  delegate: Delegate;
  numFaces: number;
  runningMode: RunningMode;
  onProgress?: (msg: string) => void;
}): Promise<LoadedLandmarker> {
  const progress = opts.onProgress ?? (() => {});
  // 반드시 import 전에. 로거가 만들어지는 createFromOptions 보다 앞서야 한다.
  installFetchGuard();
  const t0 = performance.now();

  progress("모듈 불러오는 중…");
  const mod = await withTimeout(import("@mediapipe/tasks-vision"), "모듈 import", STEP_TIMEOUT_MS);
  const t1 = performance.now();

  // forVisionTasks 는 WASM 을 받지 않는다. SIMD 지원을 탐지해 로더·WASM 경로 문자열만 고른다.
  progress("SIMD 탐지 중…");
  const fileset = await withTimeout(mod.FilesetResolver.forVisionTasks(WASM_BASE), "SIMD 탐지", STEP_TIMEOUT_MS);
  const t2 = performance.now();

  progress(
    `WASM(약 12MB)·모델(약 3.6MB) 받고 초기화 중… (${opts.delegate}, ${opts.runningMode}, 최대 ${MODEL_INIT_TIMEOUT_MS / 1000}초)`,
  );
  const landmarker = await withTimeout(
    mod.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: opts.delegate },
      runningMode: opts.runningMode,
      numFaces: opts.numFaces,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
    }).then(countClose),
    "모델 초기화",
    MODEL_INIT_TIMEOUT_MS,
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
