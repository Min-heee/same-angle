import { describe, expect, it } from "vitest";
import { mean, median, percentile, sampleStd, summarize } from "./stats";

describe("mean · sampleStd", () => {
  it("손계산 값", () => {
    // 2,4,4,4,5,5,7,9: 합 40 → 평균 5. 편차 제곱합 32 → n−1=7 로 나눠 √(32/7).
    const xs = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(mean(xs)).toBe(5);
    expect(sampleStd(xs)).toBeCloseTo(Math.sqrt(32 / 7), 12);
  });

  it("빈 배열은 null, 표본 1개의 표준편차는 null", () => {
    expect(mean([])).toBeNull();
    expect(sampleStd([])).toBeNull();
    expect(sampleStd([3])).toBeNull();
  });

  it("비유한 값은 조용히 빼지 않고 예외", () => {
    expect(() => mean([1, Number.NaN])).toThrow(RangeError);
    expect(() => sampleStd([1, Number.POSITIVE_INFINITY])).toThrow(RangeError);
  });
});

describe("percentile · median", () => {
  it("선형 보간: [10,20,30,40] 의 p25 는 h=0.75 → 17.5", () => {
    expect(percentile([40, 10, 30, 20], 25)).toBeCloseTo(17.5, 12);
  });

  it("p95 of 1..20: h = 19·0.95 = 18.05 → 19 + 0.05·1 = 19.05", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(xs, 95)).toBeCloseTo(19.05, 12);
  });

  it("p0 = 최솟값, p100 = 최댓값", () => {
    expect(percentile([5, 1, 9], 0)).toBe(1);
    expect(percentile([5, 1, 9], 100)).toBe(9);
  });

  it("중앙값: 홀수 개는 가운데, 짝수 개는 가운데 둘의 평균", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("원소 1개면 어떤 p 든 그 값", () => {
    expect(percentile([7], 95)).toBe(7);
  });

  it("빈 배열은 null, p 범위 밖은 예외", () => {
    expect(percentile([], 50)).toBeNull();
    expect(() => percentile([1], -1)).toThrow(RangeError);
    expect(() => percentile([1], 101)).toThrow(RangeError);
    expect(() => percentile([1], Number.NaN)).toThrow(RangeError);
  });

  it("입력 배열을 정렬로 바꾸지 않는다", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("summarize", () => {
  it("손계산 요약", () => {
    const s = summarize([2, 4, 4, 4, 5, 5, 7, 9])!;
    expect(s.n).toBe(8);
    expect(s.mean).toBe(5);
    expect(s.std).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(s.median).toBe(4.5);
    // h = 7·0.95 = 6.65 → 7 + 0.65·(9−7) = 8.3
    expect(s.p95).toBeCloseTo(8.3, 12);
    expect(s.min).toBe(2);
    expect(s.max).toBe(9);
  });

  it("빈 배열은 null, 한 개면 std 만 null", () => {
    expect(summarize([])).toBeNull();
    expect(summarize([1.5])).toEqual({
      n: 1,
      mean: 1.5,
      std: null,
      median: 1.5,
      p95: 1.5,
      min: 1.5,
      max: 1.5,
    });
  });

  it("비유한 값은 예외", () => {
    expect(() => summarize([1, Number.NaN])).toThrow(RangeError);
  });
});
