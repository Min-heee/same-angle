import { describe, expect, it } from "vitest";
import { RULES } from "./rules";
import {
  TIME_EPS_SEC,
  atLeastApart,
  isClose,
  pickRunnerUps,
  pickWinner,
  rerank,
  select,
  verdictOf,
  type Rankable,
} from "./select";

interface Item extends Rankable {
  id: string;
}
const it_ = (id: string, timeSec: number, angleDeg: number, over: Partial<Rankable> = {}): Item => ({
  id,
  timeSec,
  angleDeg,
  score: angleDeg,
  sharpness: 100,
  ...over,
});

describe("가까움 판정 — 반올림하기 전 값으로", () => {
  it("3° 는 가까움, 조금이라도 넘으면 아님", () => {
    expect(isClose(3)).toBe(true);
    expect(isClose(3 + 1e-9)).toBe(false);
    expect(isClose(3.04)).toBe(false); // "3.0°" 로 보이지만 가깝지 않다
    expect(isClose(2.96)).toBe(true);
    expect(verdictOf(3)).toBe("close");
    expect(verdictOf(3.0001)).toBe("notClose");
  });

  it("NaN 은 가깝지 않다", () => {
    expect(isClose(Number.NaN)).toBe(false);
    expect(verdictOf(Number.NaN)).toBe("notClose");
  });
});

describe("pickWinner — 1등", () => {
  it("심어 둔 정답: 각도차가 가장 작은 장면을 고른다", () => {
    const items = [it_("a", 0, 9), it_("b", 0.5, 6), it_("answer", 1, 0.4), it_("c", 1.5, 5), it_("d", 2, 8)];
    expect(pickWinner(items)!.id).toBe("answer");
  });

  it("장면이 없으면 null", () => {
    expect(pickWinner([])).toBeNull();
    expect(select([])).toBeNull();
  });

  it("동률 폭(최소 점수 + 0.5) 안에 더 선명한 장면이 있으면 그 장면을 고른다", () => {
    const items = [it_("closest", 1, 1.0, { sharpness: 100 }), it_("sharper", 2, 1.4, { sharpness: 300 })];
    expect(pickWinner(items)!.id).toBe("sharper");
  });

  it("동률 폭의 경계: 정확히 +0.5 는 안, 조금 넘으면 밖", () => {
    const inBand = [it_("closest", 1, 1.0, { sharpness: 100 }), it_("sharper", 2, 1.5, { sharpness: 300 })];
    expect(pickWinner(inBand)!.id).toBe("sharper");
    const outBand = [it_("closest", 1, 1.0, { sharpness: 100 }), it_("sharper", 2, 1.51, { sharpness: 300 })];
    expect(pickWinner(outBand)!.id).toBe("closest");
  });

  it("더 선명한 장면이 3° 바로 밖에 있으면 고르지 않는다 — 선명도 때문에 판정이 뒤집히지 않는다", () => {
    const items = [it_("inside", 1, 2.9, { sharpness: 100 }), it_("outside", 2, 3.1, { sharpness: 900 })];
    const w = pickWinner(items)!;
    expect(w.id).toBe("inside");
    expect(verdictOf(w.angleDeg)).toBe("close");
  });

  it("동률 폭은 각도차가 아니라 점수로 잰다(감점이 큰 장면은 폭 밖)", () => {
    const items = [
      it_("clean", 1, 1.0, { score: 1.0, sharpness: 100 }),
      it_("tilted", 2, 1.1, { score: 2.1, sharpness: 900 }),
    ];
    expect(pickWinner(items)!.id).toBe("clean");
  });

  it("선명도가 같으면 점수가 작은 쪽, 그것도 같으면 이른 시각", () => {
    expect(pickWinner([it_("late", 5, 1.2), it_("low", 3, 1.0), it_("high", 1, 1.3)])!.id).toBe("low");
    expect(pickWinner([it_("late", 5, 1.0), it_("early", 2, 1.0), it_("mid", 3, 1.0)])!.id).toBe("early");
  });

  it("3° 안에 장면이 하나도 없으면 전체에서 각도차가 가장 작은 장면(선명도는 보지 않는다)", () => {
    const items = [
      it_("far-sharp", 1, 6, { sharpness: 900 }),
      it_("nearest", 2, 3.5, { sharpness: 10 }),
      it_("mid", 3, 3.7, { sharpness: 900 }),
    ];
    const w = pickWinner(items)!;
    expect(w.id).toBe("nearest");
    expect(verdictOf(w.angleDeg)).toBe("notClose");
  });

  it("3° 밖에서는 점수가 아니라 각도차로 고른다. 각도차가 같을 때만 점수, 그다음 시각", () => {
    const byAngle = [it_("a", 1, 4.0, { score: 9 }), it_("b", 2, 4.5, { score: 4.5 })];
    expect(pickWinner(byAngle)!.id).toBe("a");
    const tie = [it_("a", 2, 4.0, { score: 5 }), it_("b", 3, 4.0, { score: 4.2 }), it_("c", 1, 4.0, { score: 5 })];
    expect(pickWinner(tie)!.id).toBe("b");
    expect(pickWinner([it_("late", 4, 4.0), it_("early", 1, 4.0)])!.id).toBe("early");
  });

  it("경계값: 정확히 3° 인 장면은 통과 장면으로 다뤄진다", () => {
    const items = [it_("edge", 1, 3, { sharpness: 50 }), it_("outside", 2, 3.0001, { sharpness: 900 })];
    expect(pickWinner(items)!.id).toBe("edge");
  });

  it("입력 배열을 바꾸지 않는다", () => {
    const items = [it_("b", 2, 2), it_("a", 1, 1), it_("c", 3, 5)];
    const before = items.map((i) => i.id);
    select(items);
    expect(items.map((i) => i.id)).toEqual(before);
  });
});

describe("pickRunnerUps — 차점 후보", () => {
  it("1등과, 그리고 서로 0.3초 이상 떨어진 장면을 점수 순서로 최대 3장", () => {
    const items = [
      it_("w", 1.0, 0.1),
      it_("near-w", 1.2, 0.2), // 1등과 0.2초 → 제외
      it_("r1", 1.3, 0.5), // 정확히 0.3초 → 포함
      it_("near-r1", 1.5, 0.6), // r1 과 0.2초 → 제외
      it_("r2", 2.0, 0.9),
      it_("r3", 3.0, 1.5),
      it_("r4", 4.0, 2.0), // 넷째는 넘친다
    ];
    const s = select(items)!;
    expect(s.winner.id).toBe("w");
    expect(s.runnerUps.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("떨어진 장면이 없으면 후보는 없다(한 번 지나가기만 한 동영상)", () => {
    const items = [it_("w", 1.0, 0.2), it_("a", 1.1, 0.9), it_("b", 0.9, 1.1)];
    expect(select(items)!.runnerUps).toEqual([]);
  });

  it("후보는 3° 를 넘을 수 있고, 그 후보는 '가까운 장면'이 아니다 — 판정은 후보마다 따로", () => {
    const items = [it_("w", 1.0, 0.5), it_("far", 2.0, 4.2), it_("ok", 3.0, 2.0)];
    const s = select(items)!;
    expect(s.runnerUps.map((r) => r.id)).toEqual(["ok", "far"]);
    expect(s.runnerUps.map((r) => verdictOf(r.angleDeg))).toEqual(["close", "notClose"]);
  });

  it("정확히 0.3초는 부동소수 오차와 상관없이 떨어진 것이다(독립 대조에서 찾은 결함)", () => {
    // 2.8 − 2.5 = 0.2999999999999998, 1.3 − 1.0 = 0.30000000000000004. 둘 다 "0.3초 이상"이다.
    // 거친 격자(0.5초)와 촘촘 격자(1/15초) 사이에 9/30초 간격이 구조적으로 생긴다.
    expect(2.8 - 2.5).toBeLessThan(0.3);
    for (const [tw, tr] of [
      [2.5, 2.8],
      [4.0, 4.3],
      [3.0, 2.7],
      [0.7, 1.0],
      [1.0, 1.3],
      [5 + 2 / 15, 5 + 2 / 15 + 9 / 30],
    ]) {
      const w = it_("w", tw, 0);
      expect(pickRunnerUps([w, it_("r", tr, 1)], w).map((r) => r.id)).toEqual(["r"]);
    }
    // 허용오차는 부동소수 오차만 덮는다: 장면 한 칸(1/30초) 모자란 간격은 여전히 가깝다.
    const w = it_("w", 2.5, 0);
    expect(pickRunnerUps([w, it_("r", 2.5 + 0.3 - 1 / 30, 1)], w)).toEqual([]);
    expect(pickRunnerUps([w, it_("r", 2.5 + 0.3 - 1e-4, 1)], w)).toEqual([]);
    expect(atLeastApart(0, 0.3 - 2 * TIME_EPS_SEC, 0.3)).toBe(false);
    expect(atLeastApart(0.3, 0, 0.3)).toBe(true);
  });

  it("점수가 같으면 이른 시각이 먼저", () => {
    const w = it_("w", 5, 0);
    const out = pickRunnerUps([w, it_("late", 9, 1), it_("early", 1, 1)], w);
    expect(out.map((r) => r.id)).toEqual(["early", "late"]);
  });

  it("최대 수와 간격은 규칙 상수에서 읽는다", () => {
    const items = [it_("w", 0, 0), it_("a", 1, 1), it_("b", 2, 2), it_("c", 3, 3)];
    const one = { ...RULES, select: { ...RULES.select, maxRunnerUps: 1 } };
    expect(select(items, one)!.runnerUps.map((r) => r.id)).toEqual(["a"]);
    const wide = { ...RULES, select: { ...RULES.select, runnerUpMinGapSec: 1.5 } };
    expect(select(items, wide)!.runnerUps.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("rerank — 다시 잰 값으로", () => {
  it("다시 쟀더니 2등이 더 가까우면 순위가 바뀐다", () => {
    const s = rerank([it_("was-1", 1, 3.4), it_("was-2", 2, 1.2), it_("was-3", 3, 2.0)])!;
    expect(s.winner.id).toBe("was-2");
    expect(s.runnerUps.map((r) => r.id)).toEqual(["was-3", "was-1"]);
  });

  it("간격 조건은 다시 보지 않는다(다시 재면서 시각이 조금 달라져도 후보를 버리지 않는다)", () => {
    const s = rerank([it_("a", 1.0, 0.5), it_("b", 1.1, 0.8)])!;
    expect(s.runnerUps.map((r) => r.id)).toEqual(["b"]);
  });

  it("비어 있으면 null", () => {
    expect(rerank([])).toBeNull();
  });
});
