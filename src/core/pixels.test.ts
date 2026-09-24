import { describe, expect, it } from "vitest";
import { clipRatio, laplacianVariance, lumaArray, meanLuma, pixelMetrics } from "./pixels";

/** 회색값 격자(행 목록)를 RGBA 로. */
function grayRGBA(rows: number[][]): Uint8ClampedArray {
  const h = rows.length;
  const w = rows[0].length;
  const out = new Uint8ClampedArray(w * h * 4);
  rows.flat().forEach((v, i) => {
    out.set([v, v, v, 255], i * 4);
  });
  return out;
}

describe("lumaArray", () => {
  it("Rec.709 계수: 순수 빨강 255 → 54.213, 초록 255 → 182.376, 파랑 255 → 18.411", () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    const y = lumaArray(data, 3, 1);
    expect(y[0]).toBeCloseTo(54.213, 9);
    expect(y[1]).toBeCloseTo(182.376, 9);
    expect(y[2]).toBeCloseTo(18.411, 9);
  });

  it("회색은 그 값 그대로(계수 합 1)", () => {
    const y = lumaArray(grayRGBA([[0, 128, 255]]), 3, 1);
    expect(y[0]).toBe(0);
    expect(y[1]).toBeCloseTo(128, 9);
    expect(y[2]).toBeCloseTo(255, 9);
  });

  it("길이와 크기가 안 맞으면 예외", () => {
    expect(() => lumaArray(new Uint8ClampedArray(12), 2, 2)).toThrow(RangeError);
    expect(() => lumaArray(new Uint8ClampedArray(0), 0, 0)).toThrow(RangeError);
  });
});

describe("meanLuma · clipRatio", () => {
  it("4×3, 가운데 한 칸만 10: 평균 10/12, 클리핑(≤5) 11/12", () => {
    const rows = [
      [0, 0, 0, 0],
      [0, 10, 0, 0],
      [0, 0, 0, 0],
    ];
    const y = lumaArray(grayRGBA(rows), 4, 3);
    expect(meanLuma(y)).toBeCloseTo(10 / 12, 9);
    expect(clipRatio(y)).toBeCloseTo(11 / 12, 12);
  });

  it("경계 포함: 5·250 은 클리핑, 6·249 는 아님", () => {
    expect(clipRatio([5, 6, 249, 250])).toBe(0.5);
    // 경계 바로 안쪽·바깥쪽.
    expect(clipRatio([5.01, 249.99])).toBe(0);
    expect(clipRatio([4.99, 250.01])).toBe(1);
  });
});

describe("laplacianVariance", () => {
  it("4×3 손계산: 안쪽 두 칸의 응답 −40, 10 → 평균 −15, 모분산 625", () => {
    const rows = [
      [0, 0, 0, 0],
      [0, 10, 0, 0],
      [0, 0, 0, 0],
    ];
    const y = lumaArray(grayRGBA(rows), 4, 3);
    expect(laplacianVariance(y, 4, 3)).toBeCloseTo(625, 6);
  });

  it("폭 3·높이 4, 세로 이웃이 있는 비정사각: 안쪽 두 칸 응답 10, −40 → 평균 −15, 모분산 625", () => {
    // 행 간격은 폭(3)이다. 높이(4)로 착각하면 위·아래 이웃을 잘못 집어 −20·400 이 나온다.
    const rows = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 10, 0],
      [0, 0, 0],
    ];
    const y = lumaArray(grayRGBA(rows), 3, 4);
    expect(laplacianVariance(y, 3, 4)).toBeCloseTo(625, 6);
  });

  it("평평한 면은 0", () => {
    const y = new Float64Array(25).fill(77);
    expect(laplacianVariance(y, 5, 5)).toBe(0);
  });

  it("선형 기울기(가장자리 없음)도 0", () => {
    // 라플라시안은 1차 기울기에 반응하지 않는다.
    const rows = [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => 10 * c + 5 * r));
    const y = lumaArray(grayRGBA(rows), 4, 4);
    expect(laplacianVariance(y, 4, 4)).toBeCloseTo(0, 9);
  });

  it("3 미만 크기는 계산할 칸이 없어 null", () => {
    expect(laplacianVariance(new Float64Array(4), 2, 2)).toBeNull();
    expect(laplacianVariance(new Float64Array(6), 3, 2)).toBeNull();
  });

  it("길이가 안 맞으면 예외", () => {
    expect(() => laplacianVariance(new Float64Array(8), 3, 3)).toThrow(RangeError);
  });
});

describe("pixelMetrics", () => {
  it("세 지표를 함께", () => {
    const rows = [
      [0, 0, 0, 0],
      [0, 10, 0, 0],
      [0, 0, 0, 0],
    ];
    const m = pixelMetrics(grayRGBA(rows), 4, 3);
    expect(m.meanLuma).toBeCloseTo(10 / 12, 9);
    expect(m.clipRatio).toBeCloseTo(11 / 12, 12);
    expect(m.laplacianVariance).toBeCloseTo(625, 6);
  });
});
