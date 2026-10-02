import { describe, expect, it } from "vitest";
import { coarsePlan, fineCenters, finePlan, quickAnswerOf } from "./plan";
import { RULES } from "./rules";

describe("coarsePlan — 거친 훑기", () => {
  it("12초 동영상은 초당 2장으로 24장(0, 0.5, …, 11.5)", () => {
    const p = coarsePlan(12);
    expect(p.times).toHaveLength(24);
    expect(p.times[0]).toBe(0);
    expect(p.times[23]).toBe(11.5);
    expect(p.truncated).toBe(false);
    expect(p.effectiveDurationSec).toBe(12);
  });

  it("길이와 같은 시각은 넣지 않는다(끝 장면은 탐색이 안 될 수 있다)", () => {
    expect(coarsePlan(2).times).toEqual([0, 0.5, 1, 1.5]);
    expect(coarsePlan(2.01).times).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(coarsePlan(0.3).times).toEqual([0]);
  });

  it("60초를 넘으면 앞 60초만 본다(120장). 정확히 60초는 넘은 것이 아니다", () => {
    const over = coarsePlan(60.5);
    expect(over.truncated).toBe(true);
    expect(over.effectiveDurationSec).toBe(60);
    expect(over.times).toHaveLength(120);
    expect(Math.max(...over.times)).toBe(59.5);
    expect(coarsePlan(60).truncated).toBe(false);
    expect(coarsePlan(600).times).toHaveLength(120);
  });

  it("길이를 알 수 없으면 빈 계획", () => {
    for (const d of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(coarsePlan(d)).toEqual({ times: [], effectiveDurationSec: 0, truncated: false });
    }
  });
});

describe("quickAnswerOf — 빠른 답", () => {
  it("8° 이하면 근처를 지나감, 넘으면 아님, 장면이 없어도 아님", () => {
    expect(quickAnswerOf(8)).toBe("passedNear");
    expect(quickAnswerOf(8.01)).toBe("notNear");
    expect(quickAnswerOf(0)).toBe("passedNear");
    expect(quickAnswerOf(null)).toBe("notNear");
    expect(quickAnswerOf(Number.NaN)).toBe("notNear");
  });
});

describe("fineCenters — 촘촘히 훑을 곳", () => {
  const hit = (timeSec: number, angleDeg: number, score = angleDeg) => ({ timeSec, angleDeg, score });

  it("각도차가 작은 순서로 최대 3곳, 서로 0.75초 이상", () => {
    const coarse = [hit(0, 9), hit(0.5, 4), hit(1, 1), hit(1.5, 2), hit(2, 6), hit(5, 3), hit(8, 5), hit(10, 7)];
    // 1.0(1°) → 1.5(2°)는 0.5초라 건너뜀 → 5.0(3°) → 0.5(4°)는 1.0 과 0.5초라 건너뜀 → 8.0(5°)
    expect(fineCenters(coarse)).toEqual([1, 5, 8]);
  });

  it("경계: 정확히 0.75초는 떨어진 것으로 본다", () => {
    expect(fineCenters([hit(1, 1), hit(1.75, 2)])).toEqual([1, 1.75]);
  });

  it("각도차가 같으면 점수, 그다음 이른 시각", () => {
    expect(fineCenters([hit(4, 2, 2.5), hit(2, 2, 2.1), hit(9, 2, 2.1)])).toEqual([2, 9, 4]);
  });

  it("장면이 모자라면 있는 만큼만", () => {
    expect(fineCenters([])).toEqual([]);
    expect(fineCenters([hit(3, 1)])).toEqual([3]);
  });
});

describe("finePlan — 촘촘히 훑을 시각", () => {
  it("가운데 앞뒤 0.5초를 1/15초 간격으로 16장. 가운데 자체는 비껴간다", () => {
    const times = finePlan([5], [], 60);
    expect(times).toHaveLength(16);
    expect(times[0]).toBeCloseTo(4.5, 12);
    expect(times[15]).toBeCloseTo(5.5, 12);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(1 / 15, 12);
    expect(times.some((t) => Math.abs(t - 5) < 1e-9)).toBe(false);
  });

  it("이미 잰 시각(거친 훑기)과 겹치는 것은 다시 재지 않는다", () => {
    const coarse = [4.5, 5, 5.5];
    const times = finePlan([5], coarse, 60);
    expect(times).toHaveLength(14);
    for (const t of times) for (const c of coarse) expect(Math.abs(t - c)).toBeGreaterThan(1 / 30 - 1e-9);
  });

  it("0 미만과 보는 길이 이상은 뺀다", () => {
    const head = finePlan([0], [], 60);
    expect(Math.min(...head)).toBeGreaterThanOrEqual(0);
    expect(head).toHaveLength(8);
    const tail = finePlan([11.5], [], 11.8);
    expect(Math.max(...tail)).toBeLessThan(11.8);
  });

  it("창이 겹치면 같은 시각을 두 번 넣지 않는다", () => {
    const times = finePlan([5, 5.75], [], 60);
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(1 / 30 - 1e-9);
    expect(times.length).toBeLessThan(32);
  });

  it("최대 장면 수: 거친 120 + 촘촘 48 + 다시 4 = 172 를 넘지 않는다", () => {
    const coarse = coarsePlan(600);
    const fine = finePlan([10.25, 30.25, 50.25], coarse.times, coarse.effectiveDurationSec);
    expect(fine.length).toBeLessThanOrEqual(RULES.sampling.fineWindows * 16);
    expect(coarse.times.length + fine.length + RULES.sampling.remeasureCount).toBeLessThanOrEqual(172);
  });

  it("가운데가 없으면 빈 계획", () => {
    expect(finePlan([], [1, 2], 60)).toEqual([]);
  });
});
