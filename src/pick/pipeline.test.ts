import { describe, expect, it } from "vitest";
import { percentile } from "@/core/stats";
import { angleBetweenDeg, traceToView, type TracePoint } from "./direction";
import type { FrameMeasurement } from "./measure";
import { analyze, type AnalysisResult, type Candidate, type Progress, type QuickAnswerInfo, type ScanPhase } from "./pipeline";
import { RULES } from "./rules";
import { crossSweep, gauss, rng, synthFace, synthFrame, uniform, type SynthFrameOptions } from "./testkit";

/*
 * 합성 동영상: 시각 t 에서의 보는 방향(가로·세로 2값)을 주는 함수 하나다. 얼굴 모델을 거치지 않으므로
 * 확인하는 것은 **순서·제외·고르기·다시 재기의 계산**이고, 실제 동영상에서의 정확도가 아니다.
 *
 * 비율 기준의 분모는 시드 수(1,000)다. 고르기 시험에서는 모든 장면의 기울기·크기·자리·선명도를 같게
 * 두어 각도 차만 견주게 한다.
 */

const SEEDS = 1000;
const NOISE_DEG = 0.5;

interface Call {
  timeSec: number;
  phase: ScanPhase;
}

interface VideoOptions {
  durationSec: number;
  at: (t: number) => TracePoint;
  /** 장면 측정에 넣을 잡음(축마다 σ, °). */
  noiseDeg?: number;
  rand?: () => number;
  /** 장면마다 바꿀 값(흐림·노출·얼굴 없음 등). */
  alter?: (t: number, phase: ScanPhase) => Partial<SynthFrameOptions> | undefined;
}

function video(o: VideoOptions) {
  const calls: Call[] = [];
  const measureAt = async (timeSec: number, phase: ScanPhase): Promise<FrameMeasurement> => {
    calls.push({ timeSec, phase });
    const d = o.at(timeSec);
    const noise = o.noiseDeg && o.rand ? { h: gauss(o.rand) * o.noiseDeg, v: gauss(o.rand) * o.noiseDeg } : { h: 0, v: 0 };
    return synthFrame({ timeSec, dir: { h: d.h + noise.h, v: d.v + noise.v }, ...o.alter?.(timeSec, phase) });
  };
  return { calls, measureAt, durationSec: o.durationSec };
}

const picked = (r: AnalysisResult) => {
  if (r.kind !== "picked") throw new Error(`고르지 못함: ${r.kind}${r.kind === "stopped" ? ` ${r.stop}` : ""}`);
  return r;
};
const trueAngle = (ref: TracePoint, at: (t: number) => TracePoint, t: number) =>
  angleBetweenDeg(traceToView(ref), traceToView(at(t)));

describe("analyze — 심어 둔 정답", () => {
  it("기준 자세를 지나가는 순간의 장면을 고른다(거친 훑기 사이에 있어도 촘촘히 훑어서 찾는다)", async () => {
    // 가로로 −20° → +20° 를 8초에(초당 5°). 기준 자세는 +3.3° → t = 4.66초(거친 격자 4.5 와 5.0 사이).
    const at = (t: number) => ({ h: -20 + 5 * t, v: 0 });
    const v = video({ durationSec: 8, at });
    const r = picked(await analyze({ reference: synthFace({ dir: { h: 3.3, v: 0 } }), ...v }));
    expect(Math.abs(r.winner.measurement.timeSec - 4.66)).toBeLessThanOrEqual(1 / 30 + 1e-9);
    expect(r.winner.comparison.angleDeg).toBeLessThan(0.2);
    expect(r.winner.verdict).toBe("close");
    expect(r.winner.rank).toBe(1);
    expect(r.quickAnswer).toEqual({ answer: "passedNear", minAngleDeg: expect.any(Number) });
  });

  it("장면 수: 거친 훑기는 초당 2장, 촘촘히 훑기는 창마다 최대 16장, 다시 재기는 최대 4장", async () => {
    const sweep = crossSweep();
    const v = video(sweep);
    const r = picked(await analyze({ reference: synthFace(), ...v }));
    expect(r.measured.coarse).toBe(22); // 11초
    expect(r.measured.fine).toBeLessThanOrEqual(48);
    expect(r.measured.fine).toBeGreaterThan(0);
    expect(r.measured.remeasure).toBeLessThanOrEqual(4);
    expect(v.calls).toHaveLength(r.measured.coarse + r.measured.fine + r.measured.remeasure);
    // 순서: 거친 → 촘촘 → 다시.
    const phases = v.calls.map((c) => c.phase);
    expect(phases.lastIndexOf("coarse")).toBeLessThan(phases.indexOf("fine"));
    expect(phases.lastIndexOf("fine")).toBeLessThan(phases.indexOf("remeasure"));
    // 60초 상한에서도 172장을 넘지 않는다.
    const long = video({ durationSec: 90, at: (t) => ({ h: 10 * Math.sin(t), v: 0 }) });
    const lr = picked(await analyze({ reference: synthFace(), ...long }));
    expect(long.calls.length).toBeLessThanOrEqual(172);
    expect(lr.truncated).toBe(true);
    expect(lr.effectiveDurationSec).toBe(60);
    expect(Math.max(...long.calls.map((c) => c.timeSec))).toBeLessThan(60);
  });

  it("자취에는 거친 훑기 장면의 시각과 보는 방향 2값만 남는다", async () => {
    const sweep = crossSweep();
    const r = picked(await analyze({ reference: synthFace(), ...video(sweep) }));
    expect(r.trace).toHaveLength(22);
    for (const p of r.trace) {
      const want = sweep.at(p.timeSec);
      expect(p.h).toBeCloseTo(want.h, 9);
      expect(p.v).toBeCloseTo(want.v, 9);
      expect(Object.keys(p).sort()).toEqual(["h", "timeSec", "usable", "v"]);
    }
  });
});

describe(`analyze — 고르기 정확도(시드 ${SEEDS}개, 3초 정지 뒤 십자 왕복, 초당 10°, 11초)`, () => {
  /** 고른 장면의 실제 각도차 − 잰 장면 가운데 가장 작은 실제 각도차. */
  async function gap(seed: number, frameNoise: boolean, referenceNoise: boolean): Promise<number> {
    const r = rng(seed);
    const sweep = crossSweep();
    // 기준 자세는 움직이는 구간의 궤적 위 임의 지점.
    const ref = sweep.at(uniform(r, 3, sweep.durationSec));
    const noisyRef = referenceNoise ? { h: ref.h + gauss(r) * NOISE_DEG, v: ref.v + gauss(r) * NOISE_DEG } : ref;
    const v = video({ ...sweep, noiseDeg: frameNoise ? NOISE_DEG : 0, rand: r });
    const res = picked(await analyze({ reference: synthFace({ dir: noisyRef }), ...v }));
    const best = Math.min(...v.calls.filter((c) => c.phase !== "remeasure").map((c) => trueAngle(ref, sweep.at, c.timeSec)));
    return trueAngle(ref, sweep.at, res.winner.measurement.timeSec) - best;
  }

  it("잡음 없음: 고른 장면이 잰 장면 가운데 가장 가까운 장면이다 — 전부", async () => {
    let worst = 0;
    for (let seed = 1; seed <= SEEDS; seed++) worst = Math.max(worst, await gap(seed, false, false));
    expect(worst).toBeLessThanOrEqual(1e-9);
  });

  it("장면 측정에만 잡음(축마다 σ 0.5°): 차의 95번째 백분위 1.0° 이하", async () => {
    const gaps: number[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) gaps.push(await gap(seed, true, false));
    expect(percentile(gaps, 95)!).toBeLessThanOrEqual(1.0);
  });

  it("기준 사진 측정에도 같은 잡음: 95번째 백분위 1.5° 이하", async () => {
    const gaps: number[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) gaps.push(await gap(seed, true, true));
    expect(percentile(gaps, 95)!).toBeLessThanOrEqual(1.5);
  });
});

describe("analyze — 나쁜 장면 빼기", () => {
  it(`가장 가깝지만 흐리거나 노출이 날아간 장면은 고르지 않는다 — 시드 ${SEEDS}개에서 0번`, async () => {
    let chosenBad = 0;
    let excludedTotal = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = rng(seed);
      // 초당 5° 로 한 번 지나간다. 기준 자세를 지나는 시각 둘레 ±0.25초를 나쁘게 만든다.
      const at = (t: number) => ({ h: -25 + 5 * t, v: 0 });
      const tStar = uniform(r, 2, 8);
      const bad = (t: number) => Math.abs(t - tStar) <= 0.25;
      const blur = seed % 2 === 0;
      const v = video({
        durationSec: 10,
        at,
        alter: (t) => (bad(t) ? (blur ? { sharpness: 10 } : { clipRatio: 0.4 }) : undefined),
      });
      const res = picked(await analyze({ reference: synthFace({ dir: at(tStar) }), ...v }));
      for (const c of [res.winner, ...res.runnerUps]) if (bad(c.measurement.timeSec)) chosenBad++;
      excludedTotal += blur ? res.excluded.X3 : res.excluded.X4;
      // 나쁜 구간 바로 밖의 장면이 1등이다(초당 5° × 0.25초 = 1.25° 남짓).
      expect(res.winner.comparison.angleDeg).toBeGreaterThan(1.24);
      expect(res.winner.comparison.angleDeg).toBeLessThan(1.25 + 5 / 15 + 1e-6);
    }
    expect(chosenBad).toBe(0);
    expect(excludedTotal).toBeGreaterThan(SEEDS);
  });

  it("얼굴이 가장자리에 걸렸거나 행렬이 직교에서 벗어난 장면도 고르지 않는다", async () => {
    const at = (t: number) => ({ h: -10 + 5 * t, v: 0 });
    const v = video({
      durationSec: 4,
      at,
      alter: (t) => (Math.abs(t - 2) < 0.2 ? (t < 2 ? { touchesEdge: true } : { orthoError: 0.05 }) : undefined),
    });
    const res = picked(await analyze({ reference: synthFace({ dir: { h: 0, v: 0 } }), ...v }));
    expect(Math.abs(res.winner.measurement.timeSec - 2)).toBeGreaterThanOrEqual(0.2);
    expect(res.excluded.X1).toBeGreaterThan(0);
    expect(res.excluded.X2).toBeGreaterThan(0);
    expect(res.excluded.total).toBe(res.excluded.X1 + res.excluded.X2 + res.excluded.X3 + res.excluded.X4);
  });
});

describe("analyze — 동률 규칙", () => {
  it("점수 차 0.5 안에 더 선명한 장면이 있으면 그 장면을 고른다", async () => {
    // 3초 동안 가만히(각도차 0.3° 근처), 그 가운데 t = 1.5 의 장면만 3배 선명하다.
    const v = video({
      durationSec: 3,
      at: () => ({ h: 0.3, v: 0 }),
      alter: (t) => (t === 1.5 ? { sharpness: 300 } : undefined),
    });
    const res = picked(await analyze({ reference: synthFace(), ...v }));
    expect(res.winner.measurement.timeSec).toBe(1.5);
    expect(res.winner.verdict).toBe("close");
  });

  it("더 선명한 장면이 3° 바로 밖에 있으면 3° 안의 장면을 고르고 판정은 '가까운 장면'이다", async () => {
    const v = video({
      durationSec: 2,
      at: (t) => (t < 1 ? { h: 2.9, v: 0 } : { h: 3.1, v: 0 }),
      alter: (t) => (t >= 1 ? { sharpness: 180 } : undefined),
    });
    const res = picked(await analyze({ reference: synthFace(), ...v }));
    expect(res.winner.measurement.timeSec).toBeLessThan(1);
    expect(res.winner.verdict).toBe("close");
    expect(res.winner.comparison.angleDeg).toBeCloseTo(2.9, 6);
  });
});

describe("analyze — 가까운 장면 없음", () => {
  const allCandidates = (r: AnalysisResult & { kind: "picked" }): Candidate[] => [r.winner, ...r.runnerUps];

  it(`가장 가까운 장면이 3.5° 이상인 묶음: '가까운 장면'으로 표시된 수 0 — 시드 ${SEEDS}개 전부`, async () => {
    let markedClose = 0;
    let noneFound = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = rng(seed);
      const sweep = crossSweep();
      // 십자의 두 팔에서 모두 3.6° 이상 떨어진 기준 자세.
      const sign = () => (r() < 0.5 ? -1 : 1);
      const ref = { h: sign() * uniform(r, 3.6, 9), v: sign() * uniform(r, 3.6, 9) };
      const res = picked(await analyze({ reference: synthFace({ dir: ref }), ...video(sweep) }));
      if (res.winner.verdict === "notClose") noneFound++;
      for (const c of allCandidates(res)) if (c.verdict === "close") markedClose++;
      expect(res.winner.comparison.angleDeg).toBeGreaterThanOrEqual(3.5);
    }
    expect(noneFound).toBe(SEEDS);
    expect(markedClose).toBe(0);
  });

  it("경계: 가장 가까운 장면이 2.999° 면 가까운 장면, 3.001° 면 없음", async () => {
    for (const [deg, want] of [
      [2.999, "close"],
      [3.001, "notClose"],
    ] as const) {
      const v = video({ durationSec: 2, at: () => ({ h: deg, v: 0 }) });
      const res = picked(await analyze({ reference: synthFace(), ...v }));
      expect(res.winner.verdict).toBe(want);
    }
  });

  it("빠른 답은 최종 판정이 아니다: 거친 훑기 최소 6° 면 '근처를 지나감'이지만 판정은 '없음'일 수 있다", async () => {
    const quick: QuickAnswerInfo[] = [];
    const v = video({ durationSec: 3, at: () => ({ h: 6, v: 0 }) });
    const res = picked(await analyze({ reference: synthFace(), ...v, onQuickAnswer: (q) => quick.push(q) }));
    expect(quick).toHaveLength(1);
    expect(quick[0].answer).toBe("passedNear");
    expect(quick[0].minAngleDeg).toBeCloseTo(6, 6);
    expect(res.winner.verdict).toBe("notClose");
    const far = video({ durationSec: 3, at: () => ({ h: 9, v: 0 }) });
    const fr = picked(await analyze({ reference: synthFace(), ...far }));
    expect(fr.quickAnswer!.answer).toBe("notNear");
  });
});

describe("analyze — 차점 후보", () => {
  it("정지 구간이 있으면 가까운 후보가 1장 이상 나온다(눈을 감았을 때 바꿀 장면)", async () => {
    const sweep = crossSweep();
    const res = picked(await analyze({ reference: synthFace(), ...video(sweep) }));
    const close = res.runnerUps.filter((c) => c.verdict === "close");
    expect(close.length).toBeGreaterThanOrEqual(1);
    expect(res.runnerUps.length).toBeLessThanOrEqual(3);
    // 1등과, 그리고 서로 0.3초 이상 떨어져 있다.
    const times = [res.winner, ...res.runnerUps].map((c) => c.measurement.timeSec);
    for (let i = 0; i < times.length; i++) {
      for (let j = i + 1; j < times.length; j++) expect(Math.abs(times[i] - times[j])).toBeGreaterThanOrEqual(0.3 - 1e-9);
    }
    expect([res.winner, ...res.runnerUps].map((c) => c.rank)).toEqual(times.map((_, i) => i + 1));
  });

  it("한 번 지나가기만 하면: 3° 를 넘는 후보에 '가까운 장면'이 붙지 않는다", async () => {
    // 초당 20° 로 한 번. 0.3초 떨어진 장면은 6° 밖이다.
    const at = (t: number) => ({ h: -40 + 20 * t, v: 0 });
    const res = picked(await analyze({ reference: synthFace(), ...video({ durationSec: 4, at }) }));
    expect(res.winner.verdict).toBe("close");
    expect(res.runnerUps.length).toBeGreaterThan(0);
    for (const c of res.runnerUps) {
      expect(c.comparison.angleDeg).toBeGreaterThan(3);
      expect(c.verdict).toBe("notClose");
    }
  });

  it("판정은 후보마다 따로이고, 늘 그 후보의 각도차와 맞는다", async () => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = rng(seed);
      const sweep = crossSweep(10, uniform(r, 5, 30));
      const ref = sweep.at(uniform(r, 0, sweep.durationSec));
      const res = picked(await analyze({ reference: synthFace({ dir: ref }), ...video({ ...sweep, noiseDeg: 0.5, rand: r }) }));
      for (const c of [res.winner, ...res.runnerUps]) {
        expect(c.verdict).toBe(c.comparison.angleDeg <= RULES.select.passDeg ? "close" : "notClose");
      }
    }
  });
});

describe("analyze — 다시 재기", () => {
  it("1등과 후보를 같은 시각으로 다시 가서 잰다", async () => {
    const sweep = crossSweep();
    const v = video(sweep);
    const res = picked(await analyze({ reference: synthFace(), ...v }));
    const again = v.calls.filter((c) => c.phase === "remeasure").map((c) => c.timeSec);
    const before = v.calls.filter((c) => c.phase !== "remeasure").map((c) => c.timeSec);
    expect(again).toHaveLength(1 + res.runnerUps.length);
    for (const t of again) expect(before).toContain(t);
  });

  it("순위·판정에는 다시 잰 값을 쓴다: 다시 쟀더니 1등이 3° 를 넘으면 2등이 1등이 된다", async () => {
    // 가만히 있는 3초. 분석 때는 t = 1.0 이 가장 가깝지만(0.1°), 다시 재면 그 시각에 다른 장면(4°)이 나온다.
    const v = video({
      durationSec: 3,
      at: () => ({ h: 1, v: 0 }),
      alter: (t, phase) => {
        if (t !== 1) return undefined;
        return phase === "remeasure" ? { dir: { h: 4, v: 0 } } : { dir: { h: 0.1, v: 0 } };
      },
    });
    const res = picked(await analyze({ reference: synthFace(), ...v }));
    expect(res.winner.measurement.timeSec).not.toBe(1);
    expect(res.winner.verdict).toBe("close");
    expect(res.winner.analysisRank).toBeGreaterThan(1);
    const demoted = res.runnerUps.find((c) => c.measurement.timeSec === 1)!;
    expect(demoted.analysisRank).toBe(1);
    expect(demoted.verdict).toBe("notClose");
    expect(demoted.comparison.angleDeg).toBeCloseTo(4, 6);
    expect(demoted.analysis.angleDeg).toBeCloseTo(0.1, 6);
    // 분석 때와 다시 쟀을 때의 방향 차(W5 의 재료)가 남는다.
    expect(demoted.remeasureShiftDeg).toBeCloseTo(3.9, 6);
    expect(res.winner.remeasureShiftDeg).toBeCloseTo(0, 9);
  });

  it("다시 쟀더니 모든 장면이 3° 를 넘으면 '가까운 장면 없음'이다(분석 때 가까웠더라도)", async () => {
    const v = video({
      durationSec: 2,
      at: () => ({ h: 0.5, v: 0 }),
      alter: (_t, phase) => (phase === "remeasure" ? { dir: { h: 5, v: 0 } } : undefined),
    });
    const res = picked(await analyze({ reference: synthFace(), ...v }));
    for (const c of [res.winner, ...res.runnerUps]) expect(c.verdict).toBe("notClose");
    expect(res.winner.analysis.angleDeg).toBeCloseTo(0.5, 6);
  });

  it("다시 쟀더니 제외 조건에 걸린 장면은 버리고 센다. 모두 버려지면 S4", async () => {
    const some = video({
      durationSec: 3,
      at: () => ({ h: 1, v: 0 }),
      alter: (t, phase) => (phase === "remeasure" && t === 0 ? { failure: "noFace" } : undefined),
    });
    const res = picked(await analyze({ reference: synthFace(), ...some }));
    expect(res.remeasureDropped).toBe(1);
    expect([res.winner, ...res.runnerUps].every((c) => c.measurement.timeSec !== 0)).toBe(true);

    const all = video({
      durationSec: 3,
      at: () => ({ h: 1, v: 0 }),
      alter: (_t, phase) => (phase === "remeasure" ? { sharpness: 1 } : undefined),
    });
    const stopped = await analyze({ reference: synthFace(), ...all });
    expect(stopped.kind).toBe("stopped");
    if (stopped.kind === "stopped") {
      expect(stopped.stop).toBe("S4");
      expect(stopped.remeasureDropped).toBe(4);
    }
  });
});

describe("analyze — 멈춤", () => {
  it("S4: 전부 제외. 사유별 수가 남고 빠른 답은 '지나가지 않음'", async () => {
    const quick: QuickAnswerInfo[] = [];
    const v = video({
      durationSec: 4,
      at: () => ({ h: 0, v: 0 }),
      alter: (t) => (t < 2 ? { failure: "noFace" } : t < 3 ? { clipRatio: 0.9 } : { touchesEdge: true }),
    });
    const res = await analyze({ reference: synthFace(), ...v, onQuickAnswer: (q) => quick.push(q) });
    expect(res.kind).toBe("stopped");
    if (res.kind !== "stopped") return;
    expect(res.stop).toBe("S4");
    expect(res.excluded).toEqual({ X1: 4, X2: 2, X3: 0, X4: 2, total: 8 });
    expect(quick).toEqual([{ answer: "notNear", minAngleDeg: null }]);
    // 쓸 장면이 없으면 촘촘히 훑지도 다시 재지도 않는다.
    expect(v.calls.every((c) => c.phase === "coarse")).toBe(true);
  });

  it("S4: 얼굴이 한 번도 보이지 않는 동영상(정수리만 찍음)", async () => {
    const v = video({ durationSec: 5, at: () => ({ h: 0, v: 0 }), alter: () => ({ failure: "noFace" }) });
    const res = await analyze({ reference: synthFace(), ...v });
    expect(res).toMatchObject({ kind: "stopped", stop: "S4", excluded: { X1: 10, total: 10 }, trace: [] });
  });

  it("S4: 얼굴이 둘씩 잡히는 동영상(뒤에 선 사람, 거울)", async () => {
    const v = video({ durationSec: 2, at: () => ({ h: 0, v: 0 }), alter: () => ({ failure: "multipleFaces" }) });
    expect(await analyze({ reference: synthFace(), ...v })).toMatchObject({
      kind: "stopped",
      stop: "S4",
      excluded: { X1: 4 },
      multipleFaces: 4,
    });
  });

  it("얼굴이 둘 이상이던 장면 수를 X1 안에서 따로 센다(얼굴 없음과 섞지 않는다)", async () => {
    // 0~1.5초: 얼굴 없음(4장), 2~2.5초: 얼굴 둘(2장), 나머지는 정상.
    const v = video({
      durationSec: 6,
      at: (t) => ({ h: t - 4, v: 0 }),
      alter: (t) => (t < 2 ? { failure: "noFace" } : t < 3 ? { failure: "multipleFaces" } : undefined),
    });
    const res = picked(await analyze({ reference: synthFace(), ...v }));
    expect(res.excluded.X1).toBeGreaterThanOrEqual(6);
    expect(res.multipleFaces).toBeGreaterThanOrEqual(2);
    expect(res.multipleFaces).toBeLessThan(res.excluded.X1);
    // 얼굴이 한 번도 둘로 잡히지 않으면 0.
    const clean = video({ durationSec: 4, at: (t) => ({ h: t - 2, v: 0 }) });
    expect(picked(await analyze({ reference: synthFace(), ...clean })).multipleFaces).toBe(0);
  });

  it("S3: 길이를 알 수 없는 동영상은 한 장도 재지 않고 멈춘다", async () => {
    for (const d of [Number.NaN, 0, Number.POSITIVE_INFINITY]) {
      const v = video({ durationSec: d, at: () => ({ h: 0, v: 0 }) });
      const res = await analyze({ reference: synthFace(), ...v });
      expect(res).toMatchObject({ kind: "stopped", stop: "S3" });
      expect(v.calls).toHaveLength(0);
    }
  });

  it("얼굴이 보이는 장면이 일부만 있어도 그 안에서 고른다", async () => {
    const v = video({
      durationSec: 6,
      at: (t) => ({ h: t - 3, v: 0 }),
      alter: (t) => (t < 2 || t > 4.2 ? { failure: "noFace" } : undefined),
    });
    const res = picked(await analyze({ reference: synthFace(), ...v }));
    expect(res.winner.measurement.timeSec).toBeGreaterThanOrEqual(2);
    expect(res.winner.measurement.timeSec).toBeLessThanOrEqual(4.2);
    expect(res.excluded.X1).toBeGreaterThan(0);
  });
});

describe("analyze — 진행·취소·양보", () => {
  it("진행률을 단계별로 알리고, 장면 사이마다 화면에 차례를 넘긴다", async () => {
    const progress: Progress[] = [];
    let yields = 0;
    const v = video(crossSweep());
    const res = picked(
      await analyze({
        reference: synthFace(),
        ...v,
        onProgress: (p) => progress.push(p),
        yieldToUi: async () => {
          yields++;
        },
      }),
    );
    expect(yields).toBe(v.calls.length);
    expect(progress).toHaveLength(v.calls.length);
    const lastCoarse = progress.filter((p) => p.phase === "coarse").at(-1)!;
    expect(lastCoarse).toEqual({ phase: "coarse", done: 22, total: 22 });
    const lastFine = progress.filter((p) => p.phase === "fine").at(-1)!;
    expect(lastFine.done).toBe(lastFine.total);
    expect(lastFine.total).toBe(res.measured.fine);
  });

  it("취소하면 다음 장면을 재지 않고 끝난다", async () => {
    const v = video(crossSweep());
    let n = 0;
    const res = await analyze({ reference: synthFace(), ...v, isCancelled: () => ++n > 5 });
    expect(res).toEqual({ kind: "cancelled" });
    expect(v.calls).toHaveLength(5);
  });

  it("장면을 읽다 예외가 나면 분석 전체가 그 예외로 끝난다(조용히 건너뛰지 않는다)", async () => {
    const boom = new Error("탐색 실패");
    await expect(
      analyze({
        reference: synthFace(),
        durationSec: 5,
        measureAt: async (t) => {
          if (t >= 2) throw boom;
          return synthFrame({ timeSec: t });
        },
      }),
    ).rejects.toBe(boom);
  });

  it("규칙 값을 넘기면 그 값으로 판정한다", async () => {
    const v = video({ durationSec: 2, at: () => ({ h: 4, v: 0 }) });
    const loose = { ...RULES, select: { ...RULES.select, passDeg: 5 } };
    const res = picked(await analyze({ reference: synthFace(), ...v, rules: loose }));
    expect(res.winner.verdict).toBe("close");
  });
});
