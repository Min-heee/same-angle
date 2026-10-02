import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFaces, type RawFace } from "../measure";
import type { OutputGeometry } from "../output";
import { RULES } from "../rules";
import { fromParams, toCanvasTransform } from "../similarity";
import { Ry, syntheticFace } from "../testkit";

/*
 * 접착부(glue/)의 배선 시험. **가짜 캔버스·가짜 동영상·가짜 얼굴 모델**이다 — 실제 브라우저에서
 * 그림이 맞게 나오는지, 탐색이 맞는 장면을 주는지는 여기서 알 수 없다(실기기 확인 몫).
 * 확인하는 것은 "순수 함수가 낸 숫자를 그대로 넘기는가"뿐이다.
 */

const engine = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@/spike/engine", () => ({
  loadFaceLandmarker: async (opts: unknown) => {
    engine.calls.push(opts);
    return { landmarker: {}, delegate: "CPU", numFaces: 0, runningMode: "IMAGE", timings: {} };
  },
}));

type Call = [string, ...unknown[]];

interface FakeCanvas {
  width: number;
  height: number;
  log: Call[];
  getContext(): unknown;
}

let pixel = 128;
let canvases: FakeCanvas[] = [];

function fakeCanvas(width = 0, height = 0): FakeCanvas {
  const log: Call[] = [];
  const ctx = {
    fillStyle: "",
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    fillRect: (...a: unknown[]) => void log.push(["fillRect", ...a]),
    clearRect: (...a: unknown[]) => void log.push(["clearRect", ...a]),
    setTransform: (...a: unknown[]) => void log.push(["setTransform", ...a]),
    drawImage: (...a: unknown[]) => void log.push(["drawImage", ...a]),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4).fill(pixel),
    }),
  };
  const c: FakeCanvas = { width, height, log, getContext: () => ctx };
  canvases.push(c);
  return c;
}

beforeEach(() => {
  pixel = 128;
  canvases = [];
  engine.calls.length = 0;
  vi.stubGlobal("document", { createElement: () => fakeCanvas() });
});
afterEach(() => vi.unstubAllGlobals());

const FRAME = { width: 720, height: 960 };
const faceAt = (yawDeg: number): RawFace => syntheticFace({ R: Ry(yawDeg), t: [0, 0, -50] }, FRAME, 1000);
const landmarkerOf = (faces: () => RawFace[]) =>
  ({
    detect: () => {
      const fs = faces();
      return {
        faceLandmarks: fs.map((f) => f.landmarks),
        facialTransformationMatrixes: fs.map((f) => ({ data: f.matrix })),
      };
    },
  }) as unknown as FaceLandmarker;

describe("renderCorrected — 순수 함수가 낸 변환을 그대로 캔버스에 넘긴다", () => {
  it("회색으로 채우고 → 변환을 걸고 → 원본을 (0, 0)에 그리고 → 변환을 되돌린다 [B01]", async () => {
    const { renderCorrected, EMPTY_FILL } = await import("./render");
    const transform = fromParams(-10, 1.25, 30, 40);
    const geometry = { size: { width: 1440, height: 1920 }, transform } as OutputGeometry;
    const source = { tag: "원본 장면" } as unknown as CanvasImageSource;
    const out = renderCorrected(source, geometry) as unknown as FakeCanvas;
    expect([out.width, out.height]).toEqual([1440, 1920]);
    expect(out.log).toEqual([
      ["fillRect", 0, 0, 1440, 1920],
      ["setTransform", ...toCanvasTransform(transform)],
      ["drawImage", source, 0, 0],
      ["setTransform", 1, 0, 0, 1, 0, 0],
    ]);
    expect((out.getContext() as { fillStyle: string }).fillStyle).toBe(EMPTY_FILL);
  });
});

describe("loadPickLandmarker — 재는 방식은 하나", () => {
  it("한 장씩(IMAGE)·CPU·얼굴 수는 규칙 상수(2: 둘 이상을 알아보려면 2 가 필요하다) [B02]", async () => {
    const { loadPickLandmarker } = await import("./landmarker");
    await loadPickLandmarker();
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]).toMatchObject({ delegate: "CPU", runningMode: "IMAGE", numFaces: RULES.measure.numFaces });
    expect(RULES.measure.numFaces).toBe(2);
  });
});

describe("createMeasurer — 픽셀 지표를 그대로 측정값에 싣는다", () => {
  it("피부 패치가 전부 하얗게 날아갔으면 클리핑 비율 1, 평균 휘도 255 [B03]", async () => {
    const { createMeasurer } = await import("./measure");
    pixel = 255;
    const m = createMeasurer(landmarkerOf(() => [faceAt(0)])).measure(
      fakeCanvas(FRAME.width, FRAME.height) as unknown as HTMLCanvasElement,
    );
    expect(m.face).not.toBeNull();
    expect(m.skin?.clipRatio).toBe(1);
    expect(m.skin?.meanLuma).toBeCloseTo(255, 9);
    expect(m.sharpness).toBe(0);
  });

  it("중간 밝기면 클리핑 0, 얼굴이 둘이면 픽셀을 재지 않고 multipleFaces", async () => {
    const { createMeasurer } = await import("./measure");
    const canvas = fakeCanvas(FRAME.width, FRAME.height) as unknown as HTMLCanvasElement;
    const mid = createMeasurer(landmarkerOf(() => [faceAt(0)])).measure(canvas);
    expect(mid.skin?.clipRatio).toBe(0);
    expect(mid.skin?.meanLuma).toBeCloseTo(128, 9);
    const two = createMeasurer(landmarkerOf(() => [faceAt(0), faceAt(5)])).measure(canvas);
    expect(two).toMatchObject({ faceCount: 2, face: null, faceFailure: "multipleFaces", sharpness: null, skin: null });
  });
});

function fakeVideo(reportOffsetSec: number | null) {
  const listeners = new Map<string, Set<() => void>>();
  let frameCb: ((now: number, meta: { mediaTime: number }) => void) | null = null;
  let time = 0;
  const v = {
    addEventListener: (name: string, fn: () => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(fn);
    },
    removeEventListener: (name: string, fn: () => void) => void listeners.get(name)?.delete(fn),
    get currentTime() {
      return time;
    },
    set currentTime(t: number) {
      time = t;
      queueMicrotask(() => {
        const cb = frameCb;
        frameCb = null;
        if (reportOffsetSec !== null) cb?.(0, { mediaTime: t + reportOffsetSec });
        for (const fn of [...(listeners.get("seeked") ?? [])]) fn();
      });
    },
  };
  if (reportOffsetSec !== null) {
    Object.assign(v, {
      requestVideoFrameCallback: (cb: typeof frameCb) => {
        frameCb = cb;
        return 1;
      },
      cancelVideoFrameCallback: () => {
        frameCb = null;
      },
    });
  }
  return v;
}

describe("seekTo·analyzeVideo — 브라우저가 알려 준 장면 시각", () => {
  it("seekTo: 알려 주면 그 시각, 알려 주지 않으면 null", async () => {
    const { seekTo } = await import("./video");
    expect(await seekTo(fakeVideo(0.013) as unknown as HTMLVideoElement, 1.5)).toBeCloseTo(1.513, 12);
    expect(await seekTo(fakeVideo(null) as unknown as HTMLVideoElement, 1.5)).toBeNull();
  });

  it("analyzeVideo: 고른 장면의 시각은 알려 준 시각이고, 요청한 시각도 함께 남는다 [B04]", async () => {
    const { analyzeVideo } = await import("./analyze");
    const video = fakeVideo(0.013);
    // 가로로 −10° → +10° 를 4초에. 얼굴 모델은 지금 시각의 자세를 돌려준다.
    const landmarker = landmarkerOf(() => [faceAt(-10 + 5 * video.currentTime)]);
    const ref = readFaces([faceAt(0)], FRAME);
    if (!ref.ok) throw new Error("기준 얼굴을 읽지 못함");
    const r = await analyzeVideo(landmarker, ref.face, {
      video: video as unknown as HTMLVideoElement,
      width: FRAME.width,
      height: FRAME.height,
      durationSec: 4,
      close: () => {},
    });
    if (r.kind !== "picked") throw new Error(`고르지 못함: ${r.kind}`);
    const m = r.winner.measurement;
    expect(m.timeIsReported).toBe(true);
    expect(m.timeSec).toBeCloseTo(m.requestedTimeSec + 0.013, 12);
    expect(Math.abs(m.requestedTimeSec - 2)).toBeLessThanOrEqual(1 / 15);
    expect(r.winner.verdict).toBe("close");
    // 재는 캔버스는 한 장을 돌려 쓰고, 끝나면 크기를 0 으로 놓는다.
    expect(canvases.every((c) => c.width === 0 && c.height === 0)).toBe(true);
  });
});
