import { describe, expect, it } from "vitest";
import { nextTimestamp } from "./timestamp";

describe("nextTimestamp", () => {
  it("처음이면 now 그대로", () => {
    expect(nextTimestamp(null, 1234.5)).toBe(1234.5);
  });

  it("충분히 뒤면 now 그대로", () => {
    expect(nextTimestamp(1000, 1033.3)).toBe(1033.3);
  });

  it("같은 ms·되감긴 시각이면 직전 + 1", () => {
    expect(nextTimestamp(1000, 1000)).toBe(1001);
    expect(nextTimestamp(1000, 1000.4)).toBe(1001);
    expect(nextTimestamp(1000, 900)).toBe(1001);
  });

  it("연달아 불러도 엄격히 증가", () => {
    let last: number | null = null;
    const seen: number[] = [];
    for (const now of [5, 5, 5, 4, 10, 10.2, 30]) {
      last = nextTimestamp(last, now);
      seen.push(last);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    expect(seen).toEqual([5, 6, 7, 8, 10, 11, 30]);
  });

  it("now 가 유한하지 않으면 예외", () => {
    expect(() => nextTimestamp(1, Number.NaN)).toThrow(RangeError);
  });
});
