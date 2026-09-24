/**
 * 실험 1(잡음 바닥)·폰 기울기·추론 시간 기록을 요약하는 통계 함수.
 *
 * 입력에 비유한 값이 섞이면 예외를 던진다. 조용히 빼거나 0으로 바꾸면 "몇 개가 빠졌는지"가
 * 사라지고, 잡음 바닥처럼 작은 값을 재는 실험에서는 그 한 개가 결론을 바꾼다.
 * 호출하는 쪽이 비유한 표본을 따로 세어 거르고, 그 개수를 함께 기록한다.
 *
 * 순수 함수다.
 */

export class NonFiniteSampleError extends RangeError {
  constructor(index: number) {
    super(`표본 ${index}번이 유한한 수가 아닙니다.`);
    this.name = "NonFiniteSampleError";
  }
}

function assertFinite(xs: readonly number[]): void {
  for (let i = 0; i < xs.length; i++) {
    if (typeof xs[i] !== "number" || !Number.isFinite(xs[i])) throw new NonFiniteSampleError(i);
  }
}

/** 산술 평균. 빈 배열은 null. */
export function mean(xs: readonly number[]): number | null {
  assertFinite(xs);
  if (xs.length === 0) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/**
 * 표본 표준편차(분모 n−1). 표본 1개로는 흩어짐을 알 수 없으므로 n < 2 는 null.
 * 실험 1의 σ 는 "이 기기·이 자세에서 프레임마다 얼마나 흔들리는가"의 추정이라 n−1 을 쓴다.
 */
export function sampleStd(xs: readonly number[]): number | null {
  assertFinite(xs);
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  let ss = 0;
  for (const x of xs) ss += (x - m) * (x - m);
  return Math.sqrt(ss / (xs.length - 1));
}

/**
 * 백분위수 p(0~100), 선형 보간.
 *
 * 정의: 오름차순 정렬 x[0..n−1] 에서 위치 h = (n−1)·p/100 을 잡고,
 *   x[⌊h⌋] + (h − ⌊h⌋)·(x[⌊h⌋+1] − x[⌊h⌋])
 * 를 돌려준다. (NumPy percentile 기본 'linear', Hyndman–Fan 7번과 같은 정의.)
 * p=0 은 최솟값, p=100 은 최댓값, p=50 은 중앙값과 같다.
 * 빈 배열은 null, p 가 [0, 100] 밖이거나 유한하지 않으면 예외.
 */
export function percentile(xs: readonly number[], p: number): number | null {
  assertFinite(xs);
  if (!Number.isFinite(p) || p < 0 || p > 100) {
    throw new RangeError(`백분위 p 는 0~100 이어야 합니다: ${p}`);
  }
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const h = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** 중앙값 = 50 백분위. */
export function median(xs: readonly number[]): number | null {
  return percentile(xs, 50);
}

export interface Summary {
  n: number;
  mean: number;
  /** 표본 표준편차. n = 1 이면 null. */
  std: number | null;
  median: number;
  p95: number;
  min: number;
  max: number;
}

/** 한 지표의 요약. 빈 배열은 null. */
export function summarize(xs: readonly number[]): Summary | null {
  assertFinite(xs);
  if (xs.length === 0) return null;
  let min = xs[0];
  let max = xs[0];
  for (const x of xs) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return {
    n: xs.length,
    mean: mean(xs)!,
    std: sampleStd(xs),
    median: median(xs)!,
    p95: percentile(xs, 95)!,
    min,
    max,
  };
}
