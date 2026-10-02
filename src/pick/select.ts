/**
 * 고르기: 1등과 차점 후보, 가까움 판정(PRD 5절).
 *
 * **1등.** 각도차가 통과 기준(3°) 이하인 장면이 있으면 그 안에서, 하나도 없으면 전체에서 고른다.
 *   - 통과 장면이 있을 때: 점수가 (가장 작은 점수 + 0.5) 이하인 장면들 가운데 가장 선명한 장면.
 *     선명도가 같으면 점수가 작은 쪽, 그것도 같으면 이른 시각.
 *   - 없을 때: 각도차가 가장 작은 장면. 같으면 점수가 작은 쪽, 그것도 같으면 이른 시각.
 *   통과 장면 안에서만 선명도를 견주므로 선명도 때문에 판정이 뒤집히지 않는다.
 *
 * **차점 후보.** 1등과, 그리고 서로 0.3초 이상 떨어진 장면 가운데 점수 순서로 최대 3장.
 *   후보마다 가까움 판정을 따로 붙인다(통과 기준을 넘는 후보는 "가까운 장면"이 아니다).
 *   "0.3초 이상"은 정확히 0.3초를 포함한다. 시각은 이진 소수라 2.8 − 2.5 가 0.2999…로 나오므로
 *   `TIME_EPS_SEC` 만큼의 허용오차를 두고 견준다(`atLeastApart`).
 *
 * **가까움 판정.** 각도차 ≤ 3° (반올림하기 전 값). NaN 은 가깝지 않다.
 *
 * 순수 함수다. 입력 배열을 바꾸지 않는다.
 */

import { RULES, type Rules } from "./rules";

/** 고르기에 필요한 값. 호출하는 쪽의 장면 타입이 이것을 만족하면 된다. */
export interface Rankable {
  /** 장면 시각(초). */
  timeSec: number;
  /** 각도차(°). */
  angleDeg: number;
  /** 점수. */
  score: number;
  /** 선명도. */
  sharpness: number;
}

export type Verdict = "close" | "notClose";

/**
 * 시각 간격을 견줄 때의 허용오차(초). 규칙 값이 아니라 부동소수 오차를 덮는 값이다.
 *
 * 거친 격자(0.5초)와 촘촘 격자(1/15초) 사이에는 명목상 정확히 0.3초인 간격이 구조적으로 생기는데,
 * 그 차가 0.2999999999999998 이나 0.30000000000000004 로 나와 `>=` 판정이 장면마다 갈렸다
 * (독립 대조 200개 중 15개에서 차점 후보가 달라짐). 장면 간격(1/30초 이상)보다 훨씬 작은 값이다.
 */
export const TIME_EPS_SEC = 1e-6;

/** 두 시각이 `gapSec` 이상 떨어졌는가. 정확히 `gapSec` 이면 떨어진 것이다. */
export function atLeastApart(aSec: number, bSec: number, gapSec: number): boolean {
  return Math.abs(aSec - bSec) >= gapSec - TIME_EPS_SEC;
}

/** 가까움 판정. 반올림하지 않은 값으로 한다. */
export function isClose(angleDeg: number, rules: Rules = RULES): boolean {
  return angleDeg <= rules.select.passDeg;
}

export function verdictOf(angleDeg: number, rules: Rules = RULES): Verdict {
  return isClose(angleDeg, rules) ? "close" : "notClose";
}

const byScoreThenTime = (a: Rankable, b: Rankable) => a.score - b.score || a.timeSec - b.timeSec;

/** 1등. 장면이 없으면 null. */
export function pickWinner<T extends Rankable>(items: readonly T[], rules: Rules = RULES): T | null {
  if (items.length === 0) return null;
  const close = items.filter((it) => isClose(it.angleDeg, rules));

  if (close.length === 0) {
    return [...items].sort((a, b) => a.angleDeg - b.angleDeg || byScoreThenTime(a, b))[0];
  }

  let minScore = Infinity;
  for (const it of close) if (it.score < minScore) minScore = it.score;
  const band = close.filter((it) => it.score <= minScore + rules.select.tieScoreBand);
  return [...band].sort((a, b) => b.sharpness - a.sharpness || byScoreThenTime(a, b))[0];
}

/**
 * 차점 후보. 1등을 뺀 장면을 점수 순서로 훑으며, 1등과 이미 고른 후보 모두에서 0.3초 이상
 * 떨어진 장면만 담는다. 없으면 빈 배열(초당 10°로 한 번 지나가기만 한 동영상이면 흔하다).
 */
export function pickRunnerUps<T extends Rankable>(items: readonly T[], winner: T, rules: Rules = RULES): T[] {
  const gap = rules.select.runnerUpMinGapSec;
  const taken: T[] = [winner];
  const out: T[] = [];
  for (const it of [...items].sort(byScoreThenTime)) {
    if (out.length >= rules.select.maxRunnerUps) break;
    if (it === winner) continue;
    if (taken.every((t) => atLeastApart(t.timeSec, it.timeSec, gap))) {
      taken.push(it);
      out.push(it);
    }
  }
  return out;
}

export interface Selection<T> {
  winner: T;
  runnerUps: T[];
}

/** 1등 + 차점 후보. 장면이 없으면 null. */
export function select<T extends Rankable>(items: readonly T[], rules: Rules = RULES): Selection<T> | null {
  const winner = pickWinner(items, rules);
  if (winner === null) return null;
  return { winner, runnerUps: pickRunnerUps(items, winner, rules) };
}

/**
 * 다시 잰 값으로 순위를 다시 매긴다. 대상은 이미 간격을 두고 고른 1등·후보(최대 4장)라서
 * 간격 조건은 다시 보지 않는다 — 다시 재면서 장면 시각이 조금 달라졌다고 후보를 버리지 않는다.
 * 1등은 같은 규칙으로, 나머지는 점수 순서로.
 */
export function rerank<T extends Rankable>(items: readonly T[], rules: Rules = RULES): Selection<T> | null {
  const winner = pickWinner(items, rules);
  if (winner === null) return null;
  return { winner, runnerUps: items.filter((it) => it !== winner).sort(byScoreThenTime) };
}
