import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFaces, type RawFace } from "../measure";
import { Ry, syntheticFace } from "../testkit";

/*
 * 사진 여러 장(연사) 접착부의 배선 시험. **가짜 캔버스·가짜 그림 풀기·가짜 얼굴 모델**이다 — 실제
 * 브라우저가 카메라의 사진을 맞게 푸는지, 회전 정보를 반영하는지는 여기서 알 수 없다.
 * 확인하는 것: 기준 사진과 같은 길로 여는가, 한 장씩 풀고 바로 놓는가, 읽지 못한 파일을 세는가.
 */

vi.mock("@/spike/engine", () => ({
  loadFaceLandmarker: async () => ({ landmarker: {}, delegate: "CPU", numFaces: 0, runningMode: "IMAGE", timings: {} }),
}));

interface FakeCanvas {
  width: number;
  height: number;
  draws: unknown[][];
  getContext(): unknown;
}

let canvases: FakeCanvas[] = [];
/** 지금 풀려 있는(아직 놓지 않은) 그림 수와, 그 최댓값. */
let open = 0;
let maxOpen = 0;
let decoded: { name: string; options: unknown }[] = [];
/** 얼굴 모델이 지금 보고 있는 사진의 이름(마지막으로 캔버스에 그린 그림). */
let current = "";

function fakeCanvas(): FakeCanvas {
  const draws: unknown[][] = [];
  const ctx = {
    fillStyle: "",
    clearRect: () => {},
    setTransform: () => {},
    drawImage: (...a: unknown[]) => {
      draws.push(a);
      const name = (a[0] as { name?: string }).name;
      if (typeof name === "string") current = name;
    },
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(128) }),
  };
  const c: FakeCanvas = { width: 0, height: 0, draws, getContext: () => ctx };
  canvases.push(c);
  return c;
}

type NamedBlob = Blob & { name: string };
const photo = (name: string): NamedBlob => Object.assign(new Blob([name]), { name });

/** 이름이 `bad` 로 시작하면 풀지 못하는 파일, `wide` 로 시작하면 가로 사진이다. */
function fakeDecode(file: NamedBlob, options: unknown) {
  decoded.push({ name: file.name, options });
  if (file.name.startsWith("bad")) return Promise.reject(new Error("The source image could not be decoded."));
  open++;
  maxOpen = Math.max(maxOpen, open);
  const wide = file.name.startsWith("wide");
  return Promise.resolve({ name: file.name, width: wide ? 6000 : 4000, height: wide ? 4000 : 6000, close: () => void open-- });
}

beforeEach(() => {
  canvases = [];
  open = 0;
  maxOpen = 0;
  decoded = [];
  current = "";
  vi.stubGlobal("document", { createElement: () => fakeCanvas() });
  vi.stubGlobal("createImageBitmap", fakeDecode);
});
afterEach(() => vi.unstubAllGlobals());

const FRAME = { width: 640, height: 960 };
const faceAt = (yawDeg: number): RawFace => syntheticFace({ R: Ry(yawDeg), t: [0, 0, -50] }, FRAME, 1000);
/** 이름 끝의 숫자가 그 사진의 좌우 각(°)이다: "p-3" 은 −3°, "p4" 는 4°. */
const yawOf = (name: string) => Number(/(-?\d+)$/.exec(name)?.[1] ?? 0);
const landmarker = {
  detect: () => {
    const f = faceAt(yawOf(current));
    return { faceLandmarks: [f.landmarks], facialTransformationMatrixes: [{ data: f.matrix }] };
  },
} as unknown as FaceLandmarker;

function reference() {
  const ref = readFaces([faceAt(0)], FRAME);
  if (!ref.ok) throw new Error("기준 얼굴을 읽지 못함");
  return ref.face;
}

describe("analyzePhotoSet — 한 장씩 풀어 재고 바로 놓는다", () => {
  it("기준과 가장 가까운 사진을 고르고, 풀어 둔 그림은 한 번에 한 장뿐이며 끝나면 하나도 남지 않는다", async () => {
    const { analyzePhotoSet, openPhotoSet } = await import("./photos");
    const files = ["p-8", "p-5", "p-2", "p1", "p4", "p7"].map(photo);
    const set = openPhotoSet(files);
    const r = await analyzePhotoSet(landmarker, reference(), set);
    if (r.kind !== "picked") throw new Error(`고르지 못함: ${r.kind}`);
    expect(r.winner.measurement.timeSec).toBe(4);
    expect(r.winner.verdict).toBe("close");
    expect(maxOpen).toBe(1);
    expect(open).toBe(0);
    // 여섯 장을 한 번씩 풀고, 고른 사진과 후보를 다시 풀었다.
    expect(decoded.slice(0, 6).map((d) => d.name)).toEqual(files.map((f) => f.name));
    expect(decoded).toHaveLength(6 + 1 + r.runnerUps.length);
    expect(decoded[6].name).toBe("p1");
    // 재는 캔버스와 작은 캔버스는 끝나면 크기를 0 으로 놓는다.
    expect(canvases.every((c) => c.width === 0 && c.height === 0)).toBe(true);
  });

  it("기준 사진과 같은 길로 연다: 회전 정보(EXIF)를 반영해 풀고, 긴 변 960px 로 줄여 잰다", async () => {
    const { analyzePhotoSet, openPhotoSet } = await import("./photos");
    const r = await analyzePhotoSet(landmarker, reference(), openPhotoSet([photo("p1"), photo("wide2")]));
    if (r.kind !== "picked") throw new Error("고르지 못함");
    for (const d of decoded) expect(d.options).toEqual({ imageOrientation: "from-image" });
    // 재는 캔버스(처음 만든 캔버스)에 그린 크기: 세로 사진 640×960, 가로 사진 960×640.
    const sizes = canvases[0].draws.map((a) => [a[3], a[4]]);
    expect(sizes).toContainEqual([640, 960]);
    expect(sizes).toContainEqual([960, 640]);
    // 사진마다의 원본 크기가 결과에 남는다(풀어 본 크기 그대로).
    expect(r.photos?.sizes).toEqual([
      { width: 4000, height: 6000 },
      { width: 6000, height: 4000 },
    ]);
    expect(r.photos?.sizeMismatch).toBe(1);
  });

  it("풀지 못하는 파일은 세고 넘어간다. 순번은 밀리지 않는다", async () => {
    const { analyzePhotoSet, openPhotoSet } = await import("./photos");
    const set = openPhotoSet([photo("bad.CR3"), photo("p6"), photo("bad.HEIC"), photo("p1")]);
    const r = await analyzePhotoSet(landmarker, reference(), set);
    if (r.kind !== "picked") throw new Error("고르지 못함");
    expect(r.photos).toMatchObject({ count: 4, unreadable: 2 });
    expect(r.winner.measurement.timeSec).toBe(4);
    expect(open).toBe(0);
  });

  it("한 장도 풀지 못하면 S6 으로 멈춘다", async () => {
    const { analyzePhotoSet, openPhotoSet } = await import("./photos");
    const r = await analyzePhotoSet(landmarker, reference(), openPhotoSet([photo("bad1.HEIC"), photo("bad2.HEIC")]));
    expect(r).toMatchObject({ kind: "stopped", stop: "S6", photos: { unreadable: 2 } });
  });

  it("그림 풀기가 아닌 곳에서 난 오류는 '읽지 못한 사진'으로 삼키지 않고, 풀어 둔 그림은 놓는다", async () => {
    const { analyzePhotoSet, openPhotoSet } = await import("./photos");
    const broken = { detect: () => { throw new Error("모델 오류"); } } as unknown as FaceLandmarker;
    await expect(analyzePhotoSet(broken, reference(), openPhotoSet([photo("p1")]))).rejects.toThrow("모델 오류");
    expect(open).toBe(0);
  });

  it("묶음을 닫으면 파일 손잡이를 놓는다(그 뒤에는 열 것이 없다)", async () => {
    const { openPhoto, openPhotoSet } = await import("./photos");
    const set = openPhotoSet([photo("p1")]);
    expect(set.count).toBe(1);
    const first = await openPhoto(set, 1);
    expect(first).not.toBeNull();
    first?.close();
    expect(await openPhoto(set, 2)).toBeNull();
    set.close();
    expect(set.files).toHaveLength(0);
    expect(await openPhoto(set, 1)).toBeNull();
  });
});
