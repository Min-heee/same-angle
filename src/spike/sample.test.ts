import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { describe, expect, it } from "vitest";
import { YAW_SIGN } from "@/core/matrix";
import { EDGE_MARGIN_FRAC, summarizeResult, toSample } from "./sample";

/*
 * 스파이크 접착부: MediaPipe 결과 → 배치 판별 → 분해, 랜드마크 → 픽셀 박스.
 * 기대값은 손으로 정했다(yaw 20° 행렬, 1920×1080 에서 x 0.4~0.6·y 0.3~0.7 박스).
 */

const deg = (d: number) => (d * Math.PI) / 180;
const c = Math.cos(deg(20));
const s = Math.sin(deg(20));

/** yaw 20°, 이동 (1, 2, −40) 을 행 우선으로 펼친 16개. 이동이 data[3]·[7]·[11] 에 온다. */
const ROW_YAW20 = [c, 0, s, 1, 0, 1, 0, 2, -s, 0, c, -40, 0, 0, 0, 1];
/** 같은 행렬의 열 우선. 이동이 data[12..14]. */
const COL_YAW20 = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 1, 2, -40, 1];

const LMS = [
  { x: 0.4, y: 0.3, z: 0, visibility: 0 },
  { x: 0.6, y: 0.7, z: 0, visibility: 0 },
];

function fake(data: number[] | null, faces = 1): FaceLandmarkerResult {
  return {
    faceLandmarks: Array.from({ length: faces }, () => LMS),
    faceBlendshapes: [],
    facialTransformationMatrixes: data ? [{ rows: 4, columns: 4, data }] : [],
  } as unknown as FaceLandmarkerResult;
}

describe("toSample", () => {
  it("행 우선 행렬은 'row' 로 판별하고 그 배치로 분해한다(yaw 20, tz −40)", () => {
    const { sample } = toSample(fake(ROW_YAW20), 100, 12.5, 33, 1920, 1080);
    expect(sample.layout).toBe("row");
    expect(sample.dec!.yaw).toBeCloseTo(YAW_SIGN * 20, 9);
    expect(sample.dec!.pitch).toBeCloseTo(0, 9);
    expect(sample.dec!.roll).toBeCloseTo(0, 9);
    expect(sample.dec!.t).toEqual([1, 2, -40]);
    expect(sample.t).toBe(100);
    expect(sample.inferMs).toBe(12.5);
    expect(sample.intervalMs).toBe(33);
  });

  it("열 우선 행렬은 'col', 같은 각", () => {
    const { sample } = toSample(fake(COL_YAW20), 0, 1, null, 1920, 1080);
    expect(sample.layout).toBe("col");
    expect(sample.dec!.yaw).toBeCloseTo(YAW_SIGN * 20, 9);
    expect(sample.dec!.t[2]).toBeCloseTo(-40, 12);
  });

  it("박스는 폭 1920·높이 1080 순서로 픽셀화한다(폭 384, 짧은 변 비율 384/1080)", () => {
    const { sample, landmarks } = toSample(fake(ROW_YAW20), 0, 1, null, 1920, 1080);
    expect(sample.box!.width).toBeCloseTo(384, 9);
    expect(sample.box!.height).toBeCloseTo(432, 9);
    expect(sample.box!.shortSideRatio).toBeCloseTo(384 / 1080, 12);
    expect(sample.frameW).toBe(1920);
    expect(sample.frameH).toBe(1080);
    expect(landmarks).toBe(LMS);
    // 여백 = 짧은 변의 2% = 21.6px. 박스(768~1152, 324~756)는 가장자리에서 멀다.
    expect(EDGE_MARGIN_FRAC).toBe(0.02);
    expect(sample.box!.touchesEdge).toBe(false);
  });

  it("표본에는 랜드마크가 들어가지 않는다(보고서로 새는 길 차단)", () => {
    const { sample } = toSample(fake(ROW_YAW20), 0, 1, null, 1920, 1080);
    expect(Object.keys(sample).sort()).toEqual(
      ["box", "dec", "faces", "frameH", "frameW", "inferMs", "intervalMs", "layout", "matrix", "t"].sort(),
    );
  });

  it("얼굴이 둘이면 첫 얼굴만, 얼굴 수는 그대로", () => {
    const { sample } = toSample(fake(ROW_YAW20, 2), 0, 1, null, 1920, 1080);
    expect(sample.faces).toBe(2);
    expect(sample.layout).toBe("row");
  });

  it("얼굴·행렬이 없으면 null 로 명시(0으로 채우지 않는다)", () => {
    const none = toSample(fake(null, 0), 0, 1, null, 1920, 1080);
    expect(none.sample.faces).toBe(0);
    expect(none.sample.matrix).toBeNull();
    expect(none.sample.layout).toBeNull();
    expect(none.sample.dec).toBeNull();
    expect(none.sample.box).toBeNull();
    expect(none.landmarks).toBeNull();
  });

  it("배치를 판별할 수 없는 행렬(이동 0)은 분해하지 않는다", () => {
    const noT = [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
    const { sample } = toSample(fake(noT), 0, 1, null, 1920, 1080);
    expect(sample.matrix).toHaveLength(16);
    expect(sample.layout).toBeNull();
    expect(sample.dec).toBeNull();
  });
});

describe("summarizeResult", () => {
  it("IMAGE 경로 요약: t 0, 간격 null, 나머지는 toSample 과 같다", () => {
    const x = summarizeResult(fake(ROW_YAW20), 1920, 1080, 7);
    expect(x.t).toBe(0);
    expect(x.intervalMs).toBeNull();
    expect(x.inferMs).toBe(7);
    expect(x.layout).toBe("row");
    expect(x.box!.width).toBeCloseTo(384, 9);
  });
});
