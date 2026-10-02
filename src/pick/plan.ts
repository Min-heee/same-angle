/**
 * 장면 뽑기 계획: 어느 시각의 장면을 잴 것인가(PRD 5절 "장면 뽑기").
 *
 *  - 거친 훑기: 전체를 초당 2장. 60초를 넘으면 앞 60초만.
 *  - 빠른 답: 거친 훑기의 가장 작은 각도차가 8° 이하면 "근처를 지나감". 최종 판정이 아니다.
 *  - 촘촘히 훑기: 거친 훑기에서 각도차가 작은 장면 최대 3곳(서로 0.75초 이상), 각각 앞뒤 0.5초를
 *    1/15초 간격으로.
 *
 * 동영상의 원래 장면 간격은 브라우저가 알려 주지 않아 고정 간격을 쓴다. 탐색이 요청한 시각의
 * 장면을 돌려준다는 보장이 없으므로(사파리 미확인), 고른 장면은 다시 잰다(pipeline.ts).
 *
 * 순수 함수다.
 */

import { RULES, type Rules } from "./rules";
import { atLeastApart } from "./select";

export interface CoarsePlan {
  /** 잴 시각(초, 오름차순). */
  times: number[];
  /** 실제로 보는 길이(초) = min(동영상 길이, 60). */
  effectiveDurationSec: number;
  /** 동영상이 상한을 넘어 앞부분만 보는가(W6). */
  truncated: boolean;
}

/**
 * 거친 훑기 시각: 0, 0.5, 1.0, … (실제로 보는 길이 미만).
 * 길이가 유한한 양수가 아니면 빈 계획 — 호출하는 쪽이 "동영상을 읽을 수 없음"(S3)으로 멈춘다.
 */
export function coarsePlan(durationSec: number, rules: Rules = RULES): CoarsePlan {
  if (!Number.isFinite(durationSec) || !(durationSec > 0)) {
    return { times: [], effectiveDurationSec: 0, truncated: false };
  }
  const max = rules.sampling.maxDurationSec;
  const truncated = durationSec > max;
  const effective = truncated ? max : durationSec;
  const step = 1 / rules.sampling.coarsePerSec;
  const times: number[] = [];
  // i·step 으로 만든다(더해 가면 오차가 쌓인다).
  for (let i = 0; i * step < effective; i++) times.push(i * step);
  return { times, effectiveDurationSec: effective, truncated };
}

export type QuickAnswer = "passedNear" | "notNear";

/** 빠른 답. 쓸 수 있는 거친 장면이 없으면(각도차 null) "notNear". */
export function quickAnswerOf(minCoarseAngleDeg: number | null, rules: Rules = RULES): QuickAnswer {
  return minCoarseAngleDeg !== null && minCoarseAngleDeg <= rules.sampling.quickAnswerDeg ? "passedNear" : "notNear";
}

export interface CoarseHit {
  timeSec: number;
  angleDeg: number;
  score: number;
}

/**
 * 촘촘히 훑을 곳의 가운데 시각. 각도차가 작은 순서로(같으면 점수가 작은 쪽, 그것도 같으면 이른
 * 시각 — PRD 5절), 이미 고른 곳과 0.75초 이상 떨어진 것만 최대 3곳. 간격은 차점 후보와 같은
 * 허용오차로 견준다(정확히 0.75초는 떨어진 것).
 */
export function fineCenters(coarse: readonly CoarseHit[], rules: Rules = RULES): number[] {
  const sorted = [...coarse].sort((a, b) => a.angleDeg - b.angleDeg || a.score - b.score || a.timeSec - b.timeSec);
  const centers: number[] = [];
  for (const c of sorted) {
    if (centers.length >= rules.sampling.fineWindows) break;
    if (centers.every((t) => atLeastApart(t, c.timeSec, rules.sampling.fineWindowMinGapSec))) centers.push(c.timeSec);
  }
  return centers;
}

/**
 * 촘촘히 훑을 시각. 가운데마다 −0.5초에서 +0.5초까지 1/15초 간격(16장 — 가운데 자체는 이미
 * 거친 훑기에서 쟀고, 이 격자는 가운데를 비껴간다).
 *
 * 0 미만이거나 보는 길이 이상인 시각, 이미 쟀거나 계획에 든 시각과 반 간격(1/30초) 안으로 겹치는
 * 시각은 뺀다(창이 겹치면 같은 장면을 두 번 재게 된다).
 */
export function finePlan(
  centers: readonly number[],
  alreadyMeasured: readonly number[],
  effectiveDurationSec: number,
  rules: Rules = RULES,
): number[] {
  const step = rules.sampling.fineStepSec;
  const half = rules.sampling.fineHalfWidthSec;
  const n = Math.round((2 * half) / step);
  const taken = [...alreadyMeasured];
  const out: number[] = [];
  for (const c of centers) {
    for (let k = 0; k <= n; k++) {
      const t = c - half + k * step;
      if (t < 0 || t >= effectiveDurationSec) continue;
      if (taken.some((u) => Math.abs(u - t) < step / 2 - 1e-9)) continue;
      taken.push(t);
      out.push(t);
    }
  }
  return out.sort((a, b) => a - b);
}
