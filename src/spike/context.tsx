"use client";

/**
 * 점검 페이지의 공유 상태: 카메라 스트림, VIDEO 추론 엔진과 프레임 루프, IMAGE 엔진(지연 생성),
 * 섹션 결과, 픽스처, 중단 감지, 임시 저장.
 *
 * 프레임마다 React 상태를 바꾸면 추론보다 렌더가 더 비싸진다. 그래서 프레임 결과는 ref 와
 * 구독자(흔들림 기록·픽스처)에게만 흘리고, 화면용 요약(live)은 250ms 에 한 번 **별도 컨텍스트**로
 * 올린다(useLive). 섹션 컴포넌트 대부분은 live 를 구독하지 않으므로 4Hz 로 다시 그려지지 않는다
 * — 이 페이지가 재는 fps 에 페이지 자신의 렌더 비용이 섞이지 않게.
 *
 * 중단(아이폰에서 흔한 것): 화면 꺼짐·다른 앱으로 전환(visibilitychange/pagehide), 카메라 트랙의
 * mute·ended, 루프 정지. 생기면 (1) 롤링 창을 비우고(세대 교체), (2) 구독자에게 알려 진행 중인
 * 기록을 실패로 버리게 하고, (3) 돌아왔을 때 카메라가 끊겼으면 1번을 실패로 둔다.
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
  type JsonValue,
  type ManualChecks,
  type SectionKey,
  type SectionResult,
} from "@/core/report";
import { beep, type BeepKind } from "./beep";
import { DRAFT_KEY, parseDraft, serializeDraft, type Draft } from "./draft";
import { loadFaceLandmarker, type Delegate, type LoadedLandmarker } from "./engine";
import { INFER_WINDOW, summarizeLive, type LiveSummary } from "./livestats";
import { toSample, type FrameSample } from "./sample";
import { nextTimestamp } from "./timestamp";
import { errText, pushCapped } from "./util";

export type { FrameSample };

/** 오버레이에 찍는 점: 코끝 1, 눈꼬리 33·263, 턱 152, 이마 10, 입꼬리 61·291. */
export const OVERLAY_POINTS = [1, 33, 263, 152, 10, 61, 291] as const;
/** visibility 가 실제로 채워지는지 볼 점. */
export const VISIBILITY_POINTS = [1, 33, 263] as const;

export interface LiveStats extends LiveSummary {
  last: FrameSample | null;
  visibility: (number | string)[];
  engineKey: string | null;
}

export type LoopKind = "requestVideoFrameCallback" | "requestAnimationFrame";

/** 진행 중인 기록을 깨는 사건. */
export type InterruptKind = "hidden" | "loopStopped" | "cameraLost";

export type CamState = "off" | "live" | "muted" | "ended";

export interface PageEvent {
  t: number;
  kind: string;
}

/** 엔진(방식/인원)별로 따로 세는 값. 엔진이 바뀌어도 앞 엔진의 수치가 섞이지 않게. */
export interface EngineStats {
  layoutCounts: { col: number; row: number; unknown: number };
  maxOrthoError: number;
  frames: number;
  /** 마지막으로 본 실시간 요약(루프가 돌 때 250ms 마다 갱신). */
  lastLive: { fps: number | null; inferMedian: number | null; inferP95: number | null; genFrames: number } | null;
}

export const engineKeyOf = (e: { delegate: string; numFaces: number } | null) => (e ? `${e.delegate}/${e.numFaces}` : null);

export interface SpikeApi {
  videoRef: RefObject<HTMLVideoElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;

  stream: MediaStream | null;
  setStream: (s: MediaStream | null) => void;
  camState: CamState;
  /** 최근 중단 기록(화면 숨김·트랙 mute/ended). 1번 섹션 데이터에 들어간다. */
  pageEventsRef: MutableRefObject<PageEvent[]>;
  wakeLockRef: MutableRefObject<{ supported: boolean | null; log: PageEvent[] }>;

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
  subscribeInterrupt: (fn: (k: InterruptKind) => void) => () => void;

  /** 지금 진행 중인 기록 이름. 있으면 카메라·모델 버튼을 막는다. */
  recording: string | null;
  setRecording: (r: string | null) => void;

  loopRunning: boolean;
  loopKind: LoopKind | null;
  loopError: string | null;
  startLoop: () => void;
  stopLoop: () => void;
  /** 250ms 마다 갱신되는 요약의 최신값(ref). 렌더 없이 읽을 때. */
  liveRef: MutableRefObject<LiveStats | null>;
  engineStatsRef: MutableRefObject<Record<string, EngineStats>>;

  sections: Record<SectionKey, SectionResult>;
  setSection: (key: SectionKey, patch: Partial<SectionResult>) => void;
  /**
   * 내보내기 직전에 부를 수집기를 등록한다(네트워크 출처 목록·엔진별 요약처럼 매 순간 상태로
   * 올리지 않는 값). 수집기는 섹션 패치를 돌려준다.
   */
  registerCollector: (key: SectionKey, fn: () => Partial<SectionResult> | null) => () => void;
  /** 수집기를 모두 불러 반영한 섹션 결과를 동기로 돌려준다(상태에도 반영). */
  collectSections: () => Record<SectionKey, SectionResult>;

  fixtures: FixtureRecord[];
  setFixtures: (f: (prev: FixtureRecord[]) => FixtureRecord[]) => void;

  manualChecks: ManualChecks;
  setManualChecks: (m: ManualChecks) => void;

  /** 열 때 복원한 임시 저장본(없으면 null). 섹션 화면 상태를 여기서 시작한다. */
  restored: Draft | null;
  /** 임시 저장본을 지우고 새로 시작한다. */
  discardDraft: () => void;

  beep: (k: BeepKind) => void;
}

const Ctx = createContext<SpikeApi | null>(null);
const LiveCtx = createContext<LiveStats | null>(null);

export function useSpike(): SpikeApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("SpikeProvider 밖에서 useSpike 를 불렀습니다.");
  return v;
}

/** 4Hz 로 바뀌는 실시간 요약. 미리보기와 2번만 구독한다. */
export function useLive(): LiveStats | null {
  return useContext(LiveCtx);
}

function initialSections(): Record<SectionKey, SectionResult> {
  return Object.fromEntries(SECTION_KEYS.map((k) => [k, { status: "idle", reason: null, data: null }])) as Record<
    SectionKey,
    SectionResult
  >;
}

function readDraft(): Draft | null {
  try {
    return parseDraft(window.localStorage.getItem(DRAFT_KEY));
  } catch {
    return null;
  }
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

type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener?: (t: string, f: () => void) => void };

/**
 * SpikeProvider 는 브라우저에서만 처음 그려진다(SpikeApp 이 마운트 뒤에 넣는다). 그래서 useState
 * 초기화에서 localStorage 를 읽어도 정적 내보내기 프리렌더와 어긋나지 않는다.
 */
export function SpikeProvider({ children }: { children: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  const [restored] = useState<Draft | null>(readDraft);

  const [stream, setStreamState] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camState, setCamState] = useState<CamState>("off");
  const pageEventsRef = useRef<PageEvent[]>([]);
  const wakeLockRef = useRef<{ supported: boolean | null; log: PageEvent[] }>({ supported: null, log: [] });
  const wakeSentinelRef = useRef<WakeLockSentinelLike | null>(null);

  const [engine, setEngineState] = useState<LoadedLandmarker | null>(null);
  const engineRef = useRef<LoadedLandmarker | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const imageEnginesRef = useRef<Partial<Record<Delegate, Promise<FaceLandmarker>>>>({});

  const latestRef = useRef<FrameSample | null>(null);
  const latestLandmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const listenersRef = useRef(new Set<(s: FrameSample) => void>());
  const interruptListenersRef = useRef(new Set<(k: InterruptKind) => void>());
  const [recording, setRecording] = useState<string | null>(null);

  const [loopRunning, setLoopRunning] = useState(false);
  const [loopKind, setLoopKind] = useState<LoopKind | null>(null);
  const [loopError, setLoopError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const cancelRef = useRef<(() => void) | null>(null);

  // 롤링 창: 지금 엔진 세대의 프레임만.
  const inferMsRef = useRef<number[]>([]);
  const frameTRef = useRef<number[]>([]);
  const genFramesRef = useRef(0);
  const genStartRef = useRef(0);
  const lastStartRef = useRef<number | null>(null);
  const visibilityRef = useRef<(number | string)[]>([]);
  const engineStatsRef = useRef<Record<string, EngineStats>>({});
  const liveRef = useRef<LiveStats | null>(null);
  const [live, setLive] = useState<LiveStats | null>(null);

  const [sections, setSections] = useState<Record<SectionKey, SectionResult>>(() => restored?.sections ?? initialSections());
  const sectionsRef = useRef(sections);
  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);
  const [fixtures, setFixturesState] = useState<FixtureRecord[]>(() => restored?.fixtures ?? []);
  const [manualChecks, setManualChecks] = useState<ManualChecks>(
    () => restored?.manualChecks ?? { filesAppNamesKept: null, longPressSaved: null },
  );
  const collectorsRef = useRef(new Map<SectionKey, () => Partial<SectionResult> | null>());

  const setSection = useCallback((key: SectionKey, patch: Partial<SectionResult>) => {
    setSections((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);

  const setFixtures = useCallback((f: (prev: FixtureRecord[]) => FixtureRecord[]) => setFixturesState(f), []);

  const logEvent = useCallback((kind: string) => {
    pageEventsRef.current = pushCapped(pageEventsRef.current, { t: Math.round(performance.now()), kind }, 20);
  }, []);

  const emitInterrupt = useCallback((k: InterruptKind) => {
    for (const fn of [...interruptListenersRef.current]) {
      try {
        fn(k);
      } catch {
        /* 구독자 하나의 실패가 나머지를 막지 않게 */
      }
    }
  }, []);

  /** 세대 교체: 롤링 창을 비운다. 옛 엔진·멈춘 시간이 새 요약에 섞이지 않게. */
  const resetWindow = useCallback(() => {
    inferMsRef.current = [];
    frameTRef.current = [];
    visibilityRef.current = [];
    genFramesRef.current = 0;
    genStartRef.current = performance.now();
    lastStartRef.current = null;
    latestRef.current = null;
    latestLandmarksRef.current = null;
    liveRef.current = null;
    setLive(null);
  }, []);

  const setEngine = useCallback(
    (e: LoadedLandmarker | null) => {
      engineRef.current = e;
      setEngineState(e);
      resetWindow();
    },
    [resetWindow],
  );

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

  const subscribeInterrupt = useCallback((fn: (k: InterruptKind) => void) => {
    interruptListenersRef.current.add(fn);
    return () => {
      interruptListenersRef.current.delete(fn);
    };
  }, []);

  const stopLoop = useCallback(() => {
    const was = runningRef.current;
    runningRef.current = false;
    cancelRef.current?.();
    cancelRef.current = null;
    setLoopRunning(false);
    if (was) emitInterrupt("loopStopped");
  }, [emitInterrupt]);

  const startLoop = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (runningRef.current) return;
    runningRef.current = true;
    resetWindow();
    setLoopError(null);
    setLoopRunning(true);

    const hasRVFC = typeof video.requestVideoFrameCallback === "function";
    setLoopKind(hasRVFC ? "requestVideoFrameCallback" : "requestAnimationFrame");

    let lastVideoTime = -1;

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
          const interval = lastStartRef.current === null ? null : t0 - lastStartRef.current;
          lastStartRef.current = t0;
          const { sample, landmarks } = toSample(res, t0, t1 - t0, interval, video.videoWidth, video.videoHeight);

          latestRef.current = sample;
          latestLandmarksRef.current = landmarks;
          const inf = inferMsRef.current;
          inf.push(sample.inferMs);
          if (inf.length > INFER_WINDOW) inf.shift();
          const ft = frameTRef.current;
          ft.push(t0);
          while (ft.length > 0 && ft[0] < t0 - 6000) ft.shift();
          genFramesRef.current++;

          const key = engineKeyOf(eng)!;
          const st = (engineStatsRef.current[key] ??= {
            layoutCounts: { col: 0, row: 0, unknown: 0 },
            maxOrthoError: 0,
            frames: 0,
            lastLive: null,
          });
          st.frames++;
          if (sample.layout === "col") st.layoutCounts.col++;
          else if (sample.layout === "row") st.layoutCounts.row++;
          else if (sample.matrix) st.layoutCounts.unknown++;
          if (sample.dec) st.maxOrthoError = Math.max(st.maxOrthoError, sample.dec.orthoError);
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
  }, [nextTs, resetWindow, stopLoop]);

  // 화면 요약은 250ms 에 한 번. 새 프레임이 끊기면 fps 는 null(프레임 안 옴).
  useEffect(() => {
    const id = setInterval(() => {
      if (!runningRef.current) return;
      const now = performance.now();
      const sum = summarizeLive(frameTRef.current, inferMsRef.current, genFramesRef.current, genStartRef.current, now);
      const key = engineKeyOf(engineRef.current);
      const next: LiveStats = { ...sum, last: latestRef.current, visibility: [...visibilityRef.current], engineKey: key };
      liveRef.current = next;
      if (key && engineStatsRef.current[key] && sum.genFrames > 0) {
        engineStatsRef.current[key].lastLive = {
          fps: sum.fps,
          inferMedian: sum.inferMedian,
          inferP95: sum.inferP95,
          genFrames: sum.genFrames,
        };
      }
      setLive(next);
    }, 250);
    return () => clearInterval(id);
  }, []);

  // ---- 카메라 트랙·화면 숨김·wake lock ------------------------------------------------

  const requestWakeLock = useCallback(async () => {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinelLike> } };
    const wl = wakeLockRef.current;
    if (!nav.wakeLock) {
      if (wl.supported !== false) wl.log = pushCapped(wl.log, { t: Math.round(performance.now()), kind: "지원 안 함" }, 10);
      wl.supported = false;
      return;
    }
    wl.supported = true;
    if (wakeSentinelRef.current) return;
    try {
      const s = await nav.wakeLock.request("screen");
      wakeSentinelRef.current = s;
      wl.log = pushCapped(wl.log, { t: Math.round(performance.now()), kind: "획득" }, 10);
      s.addEventListener?.("release", () => {
        wakeSentinelRef.current = null;
        wl.log = pushCapped(wl.log, { t: Math.round(performance.now()), kind: "해제됨" }, 10);
      });
    } catch (e) {
      wl.log = pushCapped(wl.log, { t: Math.round(performance.now()), kind: `요청 실패 ${errText(e).slice(0, 80)}` }, 10);
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    const s = wakeSentinelRef.current;
    wakeSentinelRef.current = null;
    s?.release().catch(() => {});
  }, []);

  const setStream = useCallback(
    (s: MediaStream | null) => {
      streamRef.current = s;
      setStreamState(s);
      setCamState(s ? "live" : "off");
      if (s) void requestWakeLock();
      else releaseWakeLock();
    },
    [releaseWakeLock, requestWakeLock],
  );

  const markCameraLost = useCallback(
    (why: string) => {
      setSection("camera", { status: "failed", reason: `카메라가 끊겼습니다(${why}) — 1번 [카메라 다시 켜기].` });
      emitInterrupt("cameraLost");
    },
    [emitInterrupt, setSection],
  );

  // 트랙의 mute·unmute·ended.
  useEffect(() => {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    const onMute = () => {
      logEvent("track mute");
      setCamState("muted");
      emitInterrupt("cameraLost");
    };
    const onUnmute = () => {
      logEvent("track unmute");
      setCamState("live");
      resetWindow();
    };
    const onEnded = () => {
      logEvent("track ended");
      setCamState("ended");
      markCameraLost("트랙 종료");
    };
    track.addEventListener("mute", onMute);
    track.addEventListener("unmute", onUnmute);
    track.addEventListener("ended", onEnded);
    return () => {
      track.removeEventListener("mute", onMute);
      track.removeEventListener("unmute", onUnmute);
      track.removeEventListener("ended", onEnded);
    };
  }, [emitInterrupt, logEvent, markCameraLost, resetWindow, stream]);

  // 화면 숨김·복귀.
  useEffect(() => {
    let checkTimer: ReturnType<typeof setTimeout> | null = null;
    const onHidden = (why: string) => {
      logEvent(why);
      emitInterrupt("hidden");
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        onHidden("화면 숨김");
        return;
      }
      logEvent("화면 복귀");
      resetWindow();
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track) return;
      if (track.readyState === "ended") {
        setCamState("ended");
        markCameraLost("돌아와 보니 트랙 종료");
        return;
      }
      void requestWakeLock();
      const v = videoRef.current;
      if (v && v.paused) v.play().catch((e) => logEvent(`video.play 실패 ${errText(e).slice(0, 60)}`));
      // iOS 는 돌아온 직후 잠깐 muted 였다가 풀린다. 2초 뒤에도 muted 면 끊긴 것으로 본다.
      if (checkTimer) clearTimeout(checkTimer);
      checkTimer = setTimeout(() => {
        const t = streamRef.current?.getVideoTracks()[0];
        if (t && (t.muted || t.readyState === "ended")) {
          setCamState(t.readyState === "ended" ? "ended" : "muted");
          markCameraLost("돌아온 뒤에도 영상이 멈춤");
        }
      }, 2000);
    };
    const onPageHide = () => onHidden("pagehide");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      if (checkTimer) clearTimeout(checkTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [emitInterrupt, logEvent, markCameraLost, requestWakeLock, resetWindow]);

  // 페이지를 떠날 때 루프·카메라·엔진을 정리한다.
  useEffect(() => {
    // 객체 자체는 바뀌지 않고 안의 키만 늘어나므로, 지금 잡아 둔 참조로 정리해도 된다.
    const imageEngines = imageEnginesRef.current;
    const wake = wakeSentinelRef;
    return () => {
      runningRef.current = false;
      cancelRef.current?.();
      engineRef.current?.landmarker.close();
      for (const p of Object.values(imageEngines)) {
        p?.then((l) => l.close()).catch(() => {});
      }
      wake.current?.release().catch(() => {});
    };
  }, []);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  // ---- 임시 저장 ---------------------------------------------------------------------

  useEffect(() => {
    try {
      window.localStorage.setItem(
        DRAFT_KEY,
        serializeDraft({ savedAt: new Date().toISOString(), sections, fixtures, manualChecks }),
      );
    } catch {
      /* 개인 정보 보호 모드·저장소 가득: 저장 없이 진행(12번 중간 내보내기로 대신) */
    }
  }, [sections, fixtures, manualChecks]);

  const discardDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* 무시 */
    }
    // 섹션마다 복원한 화면 상태가 있으므로 새로 여는 것이 가장 확실하다.
    window.location.reload();
  }, []);

  // ---- 내보내기 직전 수집 --------------------------------------------------------------

  const registerCollector = useCallback((key: SectionKey, fn: () => Partial<SectionResult> | null) => {
    collectorsRef.current.set(key, fn);
    return () => {
      if (collectorsRef.current.get(key) === fn) collectorsRef.current.delete(key);
    };
  }, []);

  const collectSections = useCallback(() => {
    const next = { ...sectionsRef.current };
    for (const [key, fn] of collectorsRef.current) {
      try {
        const patch = fn();
        if (patch) next[key] = { ...next[key], ...patch };
      } catch (e) {
        next[key] = { ...next[key], status: "failed", reason: `수집 실패: ${errText(e)}` };
      }
    }
    sectionsRef.current = next;
    setSections(next);
    return next;
  }, []);

  const api = useMemo<SpikeApi>(
    () => ({
      videoRef,
      overlayRef,
      stream,
      setStream,
      camState,
      pageEventsRef,
      wakeLockRef,
      engine,
      engineRef,
      setEngine,
      nextTs,
      imageEngine,
      latestRef,
      latestLandmarksRef,
      subscribe,
      subscribeInterrupt,
      recording,
      setRecording,
      loopRunning,
      loopKind,
      loopError,
      startLoop,
      stopLoop,
      liveRef,
      engineStatsRef,
      sections,
      setSection,
      registerCollector,
      collectSections,
      fixtures,
      setFixtures,
      manualChecks,
      setManualChecks,
      restored,
      discardDraft,
      beep,
    }),
    [
      stream,
      setStream,
      camState,
      engine,
      setEngine,
      nextTs,
      imageEngine,
      subscribe,
      subscribeInterrupt,
      recording,
      loopRunning,
      loopKind,
      loopError,
      startLoop,
      stopLoop,
      sections,
      setSection,
      registerCollector,
      collectSections,
      fixtures,
      setFixtures,
      manualChecks,
      restored,
      discardDraft,
    ],
  );

  return (
    <Ctx.Provider value={api}>
      <LiveCtx.Provider value={live}>{children}</LiveCtx.Provider>
    </Ctx.Provider>
  );
}

/** 보고서에 넣을 엔진별 요약. */
export function engineStatsJson(stats: Record<string, EngineStats>): JsonValue {
  const r2 = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);
  return Object.fromEntries(
    Object.entries(stats).map(([k, v]) => [
      k,
      {
        frames: v.frames,
        layoutCounts: { ...v.layoutCounts },
        maxOrthoError: Math.round(v.maxOrthoError * 1e6) / 1e6,
        lastLive: v.lastLive
          ? {
              fps: r2(v.lastLive.fps),
              inferMedian: r2(v.lastLive.inferMedian),
              inferP95: r2(v.lastLive.inferP95),
              frames: v.lastLive.genFrames,
            }
          : null,
      },
    ]),
  );
}
