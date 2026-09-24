"use client";

/**
 * 점검 페이지의 공유 상태: 카메라 스트림, VIDEO 추론 엔진과 프레임 루프, IMAGE 엔진(지연 생성),
 * 섹션 결과, 픽스처.
 *
 * 프레임마다 React 상태를 바꾸면 추론보다 렌더가 더 비싸진다. 그래서 프레임 결과는 ref 와
 * 구독자(흔들림 기록·픽스처)에게만 흘리고, 화면용 요약은 250ms 에 한 번만 상태로 올린다.
 */

import type { FaceLandmarker, FaceLandmarkerResult, NormalizedLandmark } from "@mediapipe/tasks-vision";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
import {
  SECTION_KEYS,
  type FixtureRecord,
  type ManualChecks,
  type SectionKey,
  type SectionResult,
} from "@/core/report";
import { median, percentile } from "@/core/stats";
import { beep, type BeepKind } from "./beep";
import { loadFaceLandmarker, type Delegate, type LoadedLandmarker } from "./engine";
import { toSample, type FrameSample } from "./sample";
import { nextTimestamp } from "./timestamp";
import { errText } from "./util";

/** 오버레이에 찍는 점: 코끝 1, 눈꼬리 33·263, 턱 152, 이마 10, 입꼬리 61·291. */
export const OVERLAY_POINTS = [1, 33, 263, 152, 10, 61, 291] as const;
/** visibility 가 실제로 채워지는지 볼 점. */
export const VISIBILITY_POINTS = [1, 33, 263] as const;

export interface LiveStats {
  n: number;
  fps: number | null;
  inferMedian: number | null;
  inferP95: number | null;
  last: FrameSample | null;
  visibility: (number | string)[];
}

export type LoopKind = "requestVideoFrameCallback" | "requestAnimationFrame";

export interface SpikeApi {
  videoRef: RefObject<HTMLVideoElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;

  stream: MediaStream | null;
  setStream: (s: MediaStream | null) => void;

  engine: LoadedLandmarker | null;
  engineRef: MutableRefObject<LoadedLandmarker | null>;
  setEngine: (e: LoadedLandmarker | null) => void;
  /** VIDEO 엔진 타임스탬프(루프와 같은 프레임 비교가 함께 쓴다). */
  nextTs: () => number;

  /** IMAGE 모드 엔진을 필요할 때 만든다. 처음 만들 때만 initMs 가 있다. */
  imageEngine: (d: Delegate) => Promise<{ landmarker: FaceLandmarker; initMs: number | null }>;

  latestRef: MutableRefObject<FrameSample | null>;
  latestLandmarksRef: MutableRefObject<NormalizedLandmark[] | null>;
  subscribe: (fn: (s: FrameSample) => void) => () => void;

  loopRunning: boolean;
  loopKind: LoopKind | null;
  loopError: string | null;
  startLoop: () => void;
  stopLoop: () => void;
  live: LiveStats | null;
  layoutCountsRef: MutableRefObject<{ col: number; row: number; unknown: number }>;
  maxOrthoRef: MutableRefObject<number>;

  sections: Record<SectionKey, SectionResult>;
  setSection: (key: SectionKey, patch: Partial<SectionResult>) => void;

  fixtures: FixtureRecord[];
  setFixtures: (f: (prev: FixtureRecord[]) => FixtureRecord[]) => void;

  manualChecks: ManualChecks;
  setManualChecks: (m: ManualChecks) => void;

  beep: (k: BeepKind) => void;
}

export type { FrameSample };

const Ctx = createContext<SpikeApi | null>(null);

export function useSpike(): SpikeApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("SpikeProvider 밖에서 useSpike 를 불렀습니다.");
  return v;
}

function initialSections(): Record<SectionKey, SectionResult> {
  return Object.fromEntries(SECTION_KEYS.map((k) => [k, { status: "idle", reason: null, data: null }])) as Record<
    SectionKey,
    SectionResult
  >;
}

function drawOverlay(canvas: HTMLCanvasElement | null, sample: FrameSample, lms: NormalizedLandmark[] | null) {
  if (!canvas) return;
  const { frameW: W, frameH: H } = sample;
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const g = canvas.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, W, H);
  const lw = Math.max(2, Math.round(Math.min(W, H) / 200));
  if (sample.box) {
    const b = sample.box;
    g.lineWidth = lw;
    g.strokeStyle = b.touchesEdge ? "#ff5a5a" : "#3ddc84";
    g.strokeRect(b.minX, b.minY, b.width, b.height);
  }
  if (lms) {
    g.fillStyle = "#ffd23f";
    for (const i of OVERLAY_POINTS) {
      const p = lms[i];
      if (!p) continue;
      g.beginPath();
      g.arc(p.x * W, p.y * H, lw * 2, 0, Math.PI * 2);
      g.fill();
    }
  }
}

export function SpikeProvider({ children }: { children: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [engine, setEngineState] = useState<LoadedLandmarker | null>(null);
  const engineRef = useRef<LoadedLandmarker | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const imageEnginesRef = useRef<Partial<Record<Delegate, Promise<FaceLandmarker>>>>({});

  const latestRef = useRef<FrameSample | null>(null);
  const latestLandmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const listenersRef = useRef(new Set<(s: FrameSample) => void>());

  const [loopRunning, setLoopRunning] = useState(false);
  const [loopKind, setLoopKind] = useState<LoopKind | null>(null);
  const [loopError, setLoopError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const cancelRef = useRef<(() => void) | null>(null);

  const inferMsRef = useRef<number[]>([]);
  const frameTRef = useRef<number[]>([]);
  const visibilityRef = useRef<(number | string)[]>([]);
  const layoutCountsRef = useRef({ col: 0, row: 0, unknown: 0 });
  const maxOrthoRef = useRef(0);
  const [live, setLive] = useState<LiveStats | null>(null);

  const [sections, setSections] = useState(initialSections);
  const [fixtures, setFixturesState] = useState<FixtureRecord[]>([]);
  const [manualChecks, setManualChecks] = useState<ManualChecks>({
    filesAppNamesKept: null,
    longPressSaved: null,
  });

  const setSection = useCallback((key: SectionKey, patch: Partial<SectionResult>) => {
    setSections((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);

  const setFixtures = useCallback((f: (prev: FixtureRecord[]) => FixtureRecord[]) => setFixturesState(f), []);

  const setEngine = useCallback((e: LoadedLandmarker | null) => {
    engineRef.current = e;
    setEngineState(e);
  }, []);

  const nextTs = useCallback(() => {
    const ts = nextTimestamp(lastTsRef.current, performance.now());
    lastTsRef.current = ts;
    return ts;
  }, []);

  const imageEngine = useCallback(async (d: Delegate) => {
    const existing = imageEnginesRef.current[d];
    if (existing) return { landmarker: await existing, initMs: null };
    const t0 = performance.now();
    const p = loadFaceLandmarker({ delegate: d, numFaces: 2, runningMode: "IMAGE" }).then((l) => l.landmarker);
    imageEnginesRef.current[d] = p;
    try {
      const landmarker = await p;
      return { landmarker, initMs: performance.now() - t0 };
    } catch (e) {
      // 실패한 약속을 남겨 두면 다음 시도도 곧바로 실패한다. 지운다.
      delete imageEnginesRef.current[d];
      throw e;
    }
  }, []);

  const subscribe = useCallback((fn: (s: FrameSample) => void) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }, []);

  const stopLoop = useCallback(() => {
    runningRef.current = false;
    cancelRef.current?.();
    cancelRef.current = null;
    setLoopRunning(false);
  }, []);

  const startLoop = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (runningRef.current) return;
    runningRef.current = true;
    setLoopError(null);
    setLoopRunning(true);

    const hasRVFC = typeof video.requestVideoFrameCallback === "function";
    setLoopKind(hasRVFC ? "requestVideoFrameCallback" : "requestAnimationFrame");

    let lastVideoTime = -1;
    let lastStart: number | null = null;

    const step = () => {
      if (!runningRef.current) return;
      const eng = engineRef.current;
      if (eng && video.readyState >= 2 && video.videoWidth > 0) {
        // rAF 는 화면 주기로 불리므로 같은 비디오 프레임을 두 번 넣지 않게 거른다.
        const fresh = hasRVFC || video.currentTime !== lastVideoTime;
        if (fresh) {
          lastVideoTime = video.currentTime;
          const ts = nextTs();
          const t0 = performance.now();
          let res: FaceLandmarkerResult;
          try {
            res = eng.landmarker.detectForVideo(video, ts);
          } catch (e) {
            setLoopError(errText(e));
            beep("error");
            stopLoop();
            return;
          }
          const t1 = performance.now();
          const interval = lastStart === null ? null : t0 - lastStart;
          lastStart = t0;
          const { sample, landmarks } = toSample(res, t0, t1 - t0, interval, video.videoWidth, video.videoHeight);

          latestRef.current = sample;
          latestLandmarksRef.current = landmarks;
          const inf = inferMsRef.current;
          inf.push(sample.inferMs);
          if (inf.length > 60) inf.shift();
          const ft = frameTRef.current;
          ft.push(t0);
          if (ft.length > 60) ft.shift();
          if (sample.layout === "col") layoutCountsRef.current.col++;
          else if (sample.layout === "row") layoutCountsRef.current.row++;
          else if (sample.matrix) layoutCountsRef.current.unknown++;
          if (sample.dec) maxOrthoRef.current = Math.max(maxOrthoRef.current, sample.dec.orthoError);
          if (landmarks) {
            visibilityRef.current = VISIBILITY_POINTS.map((i) => {
              const v = (landmarks[i] as { visibility?: unknown } | undefined)?.visibility;
              return typeof v === "number" ? v : `(${typeof v})`;
            });
          }

          drawOverlay(overlayRef.current, sample, landmarks);
          for (const fn of listenersRef.current) {
            try {
              fn(sample);
            } catch {
              /* 구독자 하나의 실패가 루프를 멈추지 않게 */
            }
          }
        }
      }
      schedule();
    };

    const schedule = () => {
      if (!runningRef.current) return;
      if (hasRVFC) {
        const id = video.requestVideoFrameCallback(() => step());
        cancelRef.current = () => video.cancelVideoFrameCallback(id);
      } else {
        const id = requestAnimationFrame(step);
        cancelRef.current = () => cancelAnimationFrame(id);
      }
    };

    schedule();
  }, [nextTs, stopLoop]);

  // 화면 요약은 250ms 에 한 번.
  useEffect(() => {
    const id = setInterval(() => {
      if (!runningRef.current) return;
      const inf = inferMsRef.current;
      const ft = frameTRef.current;
      const fps = ft.length >= 2 ? ((ft.length - 1) / (ft[ft.length - 1] - ft[0])) * 1000 : null;
      setLive({
        n: inf.length,
        fps,
        inferMedian: inf.length ? median(inf) : null,
        inferP95: inf.length ? percentile(inf, 95) : null,
        last: latestRef.current,
        visibility: [...visibilityRef.current],
      });
    }, 250);
    return () => clearInterval(id);
  }, []);

  // 페이지를 떠날 때 루프·카메라·엔진을 정리한다.
  useEffect(() => {
    // 객체 자체는 바뀌지 않고 안의 키만 늘어나므로, 지금 잡아 둔 참조로 정리해도 된다.
    const imageEngines = imageEnginesRef.current;
    return () => {
      runningRef.current = false;
      cancelRef.current?.();
      engineRef.current?.landmarker.close();
      for (const p of Object.values(imageEngines)) {
        p?.then((l) => l.close()).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  const api = useMemo<SpikeApi>(
    () => ({
      videoRef,
      overlayRef,
      stream,
      setStream,
      engine,
      engineRef,
      setEngine,
      nextTs,
      imageEngine,
      latestRef,
      latestLandmarksRef,
      subscribe,
      loopRunning,
      loopKind,
      loopError,
      startLoop,
      stopLoop,
      live,
      layoutCountsRef,
      maxOrthoRef,
      sections,
      setSection,
      fixtures,
      setFixtures,
      manualChecks,
      setManualChecks,
      beep,
    }),
    [
      stream,
      engine,
      setEngine,
      nextTs,
      imageEngine,
      subscribe,
      loopRunning,
      loopKind,
      loopError,
      startLoop,
      stopLoop,
      live,
      sections,
      setSection,
      fixtures,
      setFixtures,
      manualChecks,
    ],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
