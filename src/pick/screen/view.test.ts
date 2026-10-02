import { describe, expect, it } from "vitest";
import type { TracePoint } from "../direction";
import { judgeCandidate } from "../judge";
import { ALWAYS_SHOWN, warningMessage } from "../messages";
import { analyze, type ScanPhase } from "../pipeline";
import { RULES } from "../rules";
import { crossSweep, synthFace, synthFrame, type SynthFrameOptions } from "../testkit";
import { RETAKE_LIMIT, type PickedAnalysis } from "./flow";
import {
  LABEL_CORRECTED,
  LABEL_CURRENT,
  LABEL_REFERENCE,
  NAME_WINNER,
  candidatesOf,
  holdBackView,
  progressView,
  resultView,
  saveGate,
  timeLabel,
  tracePlot,
  type ResultInput,
} from "./view";

/*
 * 결과 화면이 그릴 것. 측정값은 합성이고(얼굴 모델을 거치지 않는다), 분석은 진짜 엔진이 돈다.
 * 확인하는 것: 화면이 엔진의 판정을 그대로 옮기는가, 통과 기준을 넘는 장면을 "가까운 장면"으로
 * 적는 곳이 없는가, 방향을 말하지 않는가.
 */

const DIRECTION_WORDS = /왼쪽|오른쪽|좌측|우측/;
const BEFORE_AFTER = /전후|시술 전|시술 후|개선|호전|→|➜|✅|✔/;

async function input(
  referenceDir: TracePoint,
  alter?: (t: number, phase: ScanPhase) => Partial<SynthFrameOptions> | undefined,
  over: Partial<ResultInput> = {},
): Promise<ResultInput> {
  const sweep = crossSweep();
  const face = synthFace({ dir: referenceDir });
  const r = await analyze({
    reference: face,
    durationSec: sweep.durationSec,
    measureAt: async (t, phase) => synthFrame({ timeSec: t, dir: sweep.at(t), ...alter?.(t, phase) }),
  });
  if (r.kind !== "picked") throw new Error(`고르지 못함: ${r.kind}`);
  return {
    reference: { faceCount: 1, face, faceFailure: null, sharpness: 100, skin: { meanLuma: 128, clipRatio: 0 } },
    referenceOriginal: { width: 3024, height: 4032 },
    videoNative: { width: 1440, height: 1920 },
    videoDurationSec: sweep.durationSec,
    analysis: r as PickedAnalysis,
    chosenRank: 1,
    ...over,
  };
}

const allText = (v: NonNullable<ReturnType<typeof resultView>>) =>
  [
    v.title,
    v.summary,
    v.retakeAdvice ?? "",
    ...v.warnings.shown,
    ...v.warnings.folded,
    ...v.notes,
    ...v.rows.flatMap((r) => [r.label, r.value, r.hint ?? ""]),
    ...v.candidates.map((c) => c.label),
  ].join("\n");

describe("resultView — 가까운 장면", () => {
  it("1등이 통과 기준 안이면 '가까운 장면을 골랐습니다'와 각도 차·기준값이 나온다", async () => {
    const v = resultView(await input({ h: 0, v: 0 }))!;
    expect(v.verdict).toBe("close");
    expect(v.noCloseScene).toBe(false);
    expect(v.title).toBe("가까운 장면을 골랐습니다");
    expect(v.summary).toBe(`각도 차 0.0° · 통과 기준 ${RULES.select.passDeg}° 이하`);
    expect(v.retakeAdvice).toBeNull();
    expect(v.switched).toBe(false);
    expect(v.correctionAvailable).toBe(true);
  });

  it("판정·경고·숫자는 엔진의 judgeCandidate 가 낸 것과 같다(화면이 따로 계산하지 않는다)", async () => {
    const i = await input({ h: 1.5, v: 0.5 });
    const v = resultView(i)!;
    const w = i.analysis.winner;
    const engine = judgeCandidate(
      {
        face: w.measurement.face,
        sharpness: w.measurement.sharpness,
        meanLuma: w.measurement.skin?.meanLuma ?? null,
        comparison: w.comparison,
        remeasureShiftDeg: w.remeasureShiftDeg,
      },
      {
        reference: i.reference,
        referenceOriginal: i.referenceOriginal,
        videoNative: i.videoNative,
        videoDurationSec: i.videoDurationSec,
      },
    );
    expect(v.judgement).toEqual(engine);
    expect(v.verdict).toBe(engine.verdict);
  });

  it("상시 문장 세 줄이 그대로 있다", async () => {
    const v = resultView(await input({ h: 0, v: 0 }))!;
    expect(v.always).toEqual(ALWAYS_SHOWN);
    expect(v.always).toHaveLength(3);
  });

  it("고른 시각은 근삿값으로 적는다", async () => {
    const v = resultView(await input({ h: 0, v: 0 }))!;
    expect(v.timeText).toMatch(/^약 \d+\.\d초$/);
    expect(timeLabel(3.4567)).toBe("약 3.5초");
    expect(v.rows.find((r) => r.label === "고른 시각")?.hint).toBe("근삿값입니다");
  });

  it("두 사진의 원래 해상도가 숫자 표에 나란히 있다", async () => {
    const v = resultView(await input({ h: 0, v: 0 }))!;
    expect(v.rows.find((r) => r.label === "기준 사진 해상도")?.value).toBe("3024×4032");
    expect(v.rows.find((r) => r.label === "동영상 해상도")?.value).toBe("1440×1920");
  });

  it("뺀 장면 수를 사유별로 적는다", async () => {
    const i = await input({ h: 0, v: 0 }, (t) => (t >= 9 ? { failure: "noFace" } : undefined));
    const row = resultView(i)!.rows.find((r) => r.label === "뺀 장면")!;
    expect(row.value).toBe(`${i.analysis.excluded.total}장`);
    expect(row.hint).toContain(`얼굴 없음 ${i.analysis.excluded.X1}장`);
    expect(i.analysis.excluded.X1).toBeGreaterThan(0);
    // 0장인 사유는 적지 않는다.
    expect(row.hint).not.toContain("0장");
  });

  it("뺀 장면이 없으면 사유 줄이 없고, 얼굴이 둘 이상이던 장면은 따로 적는다", async () => {
    const none = resultView(await input({ h: 0, v: 0 }))!.rows.find((r) => r.label === "뺀 장면")!;
    expect(none.value).toBe("0장");
    expect(none.hint).toBeUndefined();
    const i = await input({ h: 0, v: 0 }, (t) => (t >= 9 ? { failure: "multipleFaces" } : undefined));
    const row = resultView(i)!.rows.find((r) => r.label === "뺀 장면")!;
    expect(i.analysis.multipleFaces).toBe(i.analysis.excluded.X1);
    expect(row.hint).toBe(`얼굴이 둘 이상 ${i.analysis.multipleFaces}장`);
  });

  it("늘 보이는 숫자는 각도 차와 보정량 다섯 줄이고, 나머지와 겹치지 않는다", async () => {
    const v = resultView(await input({ h: 0, v: 0 }))!;
    expect(v.keyRows.map((r) => r.label)).toEqual(["각도 차", "맞춘 기울기", "얼굴 크기 차", "늘려 그린 배율", "위치 차"]);
    expect(v.keyRows.length + v.moreRows.length).toBe(v.rows.length);
    for (const r of v.rows) expect(v.keyRows.includes(r) !== v.moreRows.includes(r)).toBe(true);
  });
});

describe("resultView — 가까운 장면 없음", () => {
  // 기준 방향이 동영상이 지나간 곳에서 멀다: 가장 가까운 장면도 통과 기준을 넘는다.
  const far = () => input({ h: 20, v: 0 });

  it("제목이 '가까운 장면이 없습니다'이고, 엔진의 W1 문장으로 다시 찍기를 권한다", async () => {
    const i = await far();
    const v = resultView(i)!;
    expect(v.verdict).toBe("notClose");
    expect(v.noCloseScene).toBe(true);
    expect(v.title).toBe("가까운 장면이 없습니다");
    expect(v.summary).toContain(`통과 기준 ${RULES.select.passDeg}°를 넘습니다`);
    expect(v.retakeAdvice).toBe(warningMessage("W1", { numbers: v.judgement.numbers, videoNative: i.videoNative }));
    expect(v.retakeAdvice).toContain("다시 찍기를 권합니다");
    expect(v.warnings.shown[0]).toBe(v.retakeAdvice);
  });

  it("어느 후보에도 '가까운 장면'이라는 말이 붙지 않는다", async () => {
    const i = await far();
    for (const c of candidatesOf(i.analysis)) {
      const v = resultView({ ...i, chosenRank: c.rank })!;
      expect(v.verdict).toBe("notClose");
      expect(v.title).not.toMatch(/가까운 장면(을 골랐|입니다)/);
      for (const chip of v.candidates) {
        expect(chip.verdict).toBe("notClose");
        expect(chip.label).not.toContain("가까운 장면");
      }
    }
  });

  it("방향을 말하지 않는다(왼쪽·오른쪽)", async () => {
    expect(allText(resultView(await far())!)).not.toMatch(DIRECTION_WORDS);
  });
});

describe("resultView — 경계값", () => {
  it("딱 3°는 가까운 장면이고, 조금 넘으면 아니다(반올림 전 값으로)", async () => {
    // 동영상이 한 자세로 가만히 있다. 기준 방향만 3° / 3.04° 떨어뜨린다.
    const still = async (deg: number) => {
      const face = synthFace({ dir: { h: deg, v: 0 } });
      const r = await analyze({
        reference: face,
        durationSec: 4,
        measureAt: async (t) => synthFrame({ timeSec: t, dir: { h: 0, v: 0 } }),
      });
      if (r.kind !== "picked") throw new Error("고르지 못함");
      return resultView({
        reference: { faceCount: 1, face, faceFailure: null, sharpness: 100, skin: { meanLuma: 128, clipRatio: 0 } },
        referenceOriginal: { width: 3024, height: 4032 },
        videoNative: { width: 1440, height: 1920 },
        videoDurationSec: 4,
        analysis: r,
        chosenRank: 1,
      })!;
    };
    const over = await still(3.04);
    expect(over.verdict).toBe("notClose");
    // "3.0°" 로 적으면 "3.0°인데 왜 아니냐"가 된다. 한 자리 더 보인다.
    expect(over.angleText).toBe("3.04°");
    expect(over.title).toBe("가까운 장면이 없습니다");
    const under = await still(2.96);
    expect(under.verdict).toBe("close");
    expect(under.angleText).toBe("2.96°");
  });
});

describe("resultView — 후보", () => {
  it("후보마다 판정이 따로 붙고, 지금 보는 후보가 표시된다", async () => {
    const i = await input({ h: 0, v: 0 });
    expect(i.analysis.runnerUps.length).toBeGreaterThan(0);
    const v = resultView(i)!;
    expect(v.candidates.map((c) => c.rank)).toEqual(candidatesOf(i.analysis).map((c) => c.rank));
    expect(v.candidates.filter((c) => c.chosen).map((c) => c.rank)).toEqual([1]);
    expect(v.candidates[0].isWinner).toBe(true);
    for (const [k, chip] of v.candidates.entries()) {
      expect(chip.verdict).toBe(candidatesOf(i.analysis)[k].verdict);
    }
  });

  it("후보로 바꾸면 숫자·판정이 그 장면 기준으로 다시 나온다", async () => {
    // 시간이 갈수록 고개가 조금씩 기운다(장면마다 회전 보정량이 다르다).
    const i = await input({ h: 0, v: 0 }, (t) => ({ rollDeg: t * 2 }));
    const others = i.analysis.runnerUps.filter((c) => Math.abs(c.comparison.rotationDeg) > 0.3);
    expect(others.length).toBeGreaterThan(0);
    const first = resultView(i)!;
    const second = resultView({ ...i, chosenRank: others[0].rank })!;
    expect(second.switched).toBe(true);
    expect(second.candidates.find((c) => c.chosen)?.rank).toBe(others[0].rank);
    const roll = (v: typeof first) => v.rows.find((r) => r.label === "맞춘 기울기")!.value;
    expect(roll(second)).not.toBe(roll(first));
    expect(second.rows.find((r) => r.label === "고른 순서")!.value).toContain("사람이 바꾼 후보");
    expect(second.title).toBe("가까운 장면입니다(바꾼 후보)");
  });

  it("이름은 누가 골랐는지(도구/후보)이고, 사람이 후보를 바꿔도 1등의 이름은 그대로다", async () => {
    const i = await input({ h: 0, v: 0 });
    expect(i.analysis.runnerUps.length).toBeGreaterThan(0);
    for (const chosenRank of [1, 2]) {
      const chips = resultView({ ...i, chosenRank })!.candidates;
      expect(chips.map((c) => c.name)).toEqual([NAME_WINNER, ...chips.slice(1).map((_, k) => `후보 ${k + 1}`)]);
      // "지금 보는 장면"은 누른 것 하나에만 붙는다.
      expect(chips.filter((c) => c.label.endsWith("지금 보는 장면")).map((c) => c.rank)).toEqual([chosenRank]);
      expect(chips.filter((c) => c.chosen).map((c) => c.rank)).toEqual([chosenRank]);
    }
  });

  it("없는 순위면 null 이다(지어내지 않는다)", async () => {
    expect(resultView({ ...(await input({ h: 0, v: 0 })), chosenRank: 9 })).toBeNull();
  });

  it("가까운 장면이 있는데 통과 기준을 넘는 후보로 바꾸면 그 사실을 제목에 적는다", async () => {
    const i = await input({ h: 0, v: 0 });
    // 후보 하나를 통과 기준 밖으로 바꿔 넣는다(엔진이 낸 구조 그대로, 각도만).
    const bad = { ...i.analysis.runnerUps[0], verdict: "notClose" as const };
    bad.comparison = { ...bad.comparison, angleDeg: 4.5 };
    const analysis = { ...i.analysis, runnerUps: [bad, ...i.analysis.runnerUps.slice(1)] };
    const v = resultView({ ...i, analysis, chosenRank: bad.rank })!;
    expect(v.verdict).toBe("notClose");
    expect(v.noCloseScene).toBe(false);
    expect(v.title).toBe("이 후보는 통과 기준을 넘습니다");
    expect(v.candidates.find((c) => c.rank === bad.rank)!.label).not.toContain("가까운 장면");
  });
});

describe("resultView — 문구 규칙(F18)", () => {
  it("라벨은 '기준 사진 / 이번 사진'이고 보정본에는 '기울기·크기·위치 맞춤'이 붙는다", () => {
    expect(LABEL_REFERENCE).toBe("기준 사진");
    expect(LABEL_CURRENT).toBe("이번 사진");
    expect(LABEL_CORRECTED).toBe("기울기·크기·위치 맞춤");
  });

  it("전후 표현·화살표·판정 장식이 없다", async () => {
    for (const dir of [{ h: 0, v: 0 }, { h: 20, v: 0 }]) {
      expect(allText(resultView(await input(dir))!)).not.toMatch(BEFORE_AFTER);
    }
  });

  it("경고는 표의 순서로 3개까지 펼치고 나머지는 접는다", async () => {
    // 기울기·크기·자리·밝기를 한꺼번에 어긋나게 해서 경고를 여럿 낸다.
    const i = await input({ h: 20, v: 0 }, () => ({ size: 0.6, shift: { x: 120, y: 0 }, meanLuma: 40 }), {
      videoNative: { width: 1920, height: 1080 },
    });
    const v = resultView(i)!;
    expect(v.judgement.warnings.length).toBeGreaterThan(RULES.warn.maxShown);
    expect(v.warnings.shown).toHaveLength(RULES.warn.maxShown);
    expect(v.warnings.shown.length + v.warnings.folded.length).toBe(v.judgement.warnings.length);
  });

  it("기준 사진 크기를 모르면 보정본이 없다고 적고, 원본만 보이게 한다", async () => {
    const v = resultView(await input({ h: 0, v: 0 }, undefined, { referenceOriginal: { width: 0, height: 0 } }))!;
    expect(v.correctionAvailable).toBe(false);
    expect(v.notes.join(" ")).toContain("보정본을 만들지 못했습니다");
  });
});

describe("progressView", () => {
  it("아직 진행이 없으면 '여는 중'이다", () => {
    expect(progressView(null, null)).toEqual({ label: "동영상을 여는 중", count: null, fraction: 0, quick: null });
  });

  it("'몇 장면 중 몇 장면'을 적는다", () => {
    const p = progressView({ phase: "coarse", done: 7, total: 24 }, null);
    expect(p.count).toBe("24장면 중 7장면");
    expect(p.label).toContain("훑어보는 중");
  });

  it("단계가 넘어가도 진행이 뒤로 가지 않고 1 을 넘지 않는다", () => {
    const seq = [
      progressView({ phase: "coarse", done: 0, total: 22 }, null),
      progressView({ phase: "coarse", done: 22, total: 22 }, null),
      progressView({ phase: "fine", done: 0, total: 40 }, null),
      progressView({ phase: "fine", done: 40, total: 40 }, null),
      progressView({ phase: "remeasure", done: 0, total: 4 }, null),
      progressView({ phase: "remeasure", done: 4, total: 4 }, null),
    ].map((p) => p.fraction);
    for (let k = 1; k < seq.length; k++) expect(seq[k]).toBeGreaterThanOrEqual(seq[k - 1]);
    expect(seq.at(-1)).toBeCloseTo(1, 9);
    expect(progressView({ phase: "fine", done: 99, total: 3 }, null).fraction).toBeLessThanOrEqual(1);
    expect(progressView({ phase: "fine", done: 0, total: 0 }, null).fraction).toBeCloseTo(0.45, 9);
  });

  it("빠른 답은 최종 판정이 아니라고 읽히는 문장이다", () => {
    const near = progressView({ phase: "fine", done: 1, total: 10 }, { answer: "passedNear", minAngleDeg: 2 });
    const far = progressView({ phase: "fine", done: 1, total: 10 }, { answer: "notNear", minAngleDeg: 15 });
    expect(near.quick).toContain("자세히 보는 중");
    expect(far.quick).toContain("끝까지 살펴봅니다");
    expect(`${near.quick}${far.quick}`).not.toContain("가까운 장면");
  });
});

describe("tracePlot — 자취 그림", () => {
  const trace = [
    { timeSec: 0, h: 0, v: 0, usable: true },
    { timeSec: 0.5, h: 10, v: 0, usable: true },
    { timeSec: 1, h: -10, v: 0, usable: false },
    { timeSec: 1.5, h: 0, v: 10, usable: true },
  ];

  it("기준 방향이 가운데이고, 통과 기준 원의 반지름은 각도에 비례한다", () => {
    const p = tracePlot(trace, { h: 0, v: 0 }, null, 3, 280);
    expect(p.center).toEqual({ x: 140, y: 140 });
    expect(p.rangeDeg).toBe(15);
    expect(p.passRadius).toBeCloseTo((3 * 140) / 15, 9);
    expect(p.points[0]).toMatchObject({ x: 140, y: 140, usable: true });
  });

  it("가로로 벗어난 점은 가로로, 세로로 벗어난 점은 화면 위쪽으로 간다", () => {
    const p = tracePlot(trace, { h: 0, v: 0 }, null, 3, 280);
    expect(p.points[1].x).toBeGreaterThan(140);
    expect(p.points[1].y).toBeCloseTo(140, 9);
    expect(p.points[3].y).toBeLessThan(140);
    expect(p.points[3].x).toBeCloseTo(140, 9);
  });

  it("기준 방향이 멀면 가운데를 기준 방향에 두고 범위를 넓힌다(점이 그림 밖으로 나가지 않는다)", () => {
    const p = tracePlot(trace, { h: 30, v: 0 }, { h: 10, v: 0 }, 3, 280);
    expect(p.rangeDeg).toBeGreaterThanOrEqual(40);
    for (const pt of [...p.points, p.chosen!]) {
      expect(pt.x).toBeGreaterThanOrEqual(0);
      expect(pt.x).toBeLessThanOrEqual(280);
    }
    // 고른 장면(가로 10°)은 기준(가로 30°)에서 20° 떨어져 있다.
    expect((140 - p.chosen!.x) / (140 / p.rangeDeg)).toBeCloseTo(20, 9);
  });

  it("뺀 장면도 점으로 남고 표시가 다르다", () => {
    const p = tracePlot(trace, { h: 0, v: 0 }, null);
    expect(p.points.filter((pt) => !pt.usable)).toHaveLength(1);
  });

  it("유한하지 않은 값은 그리지 않는다", () => {
    const p = tracePlot([{ timeSec: 0, h: Number.NaN, v: 0, usable: true }], { h: 0, v: 0 }, { h: Number.NaN, v: 0 });
    expect(p.points).toHaveLength(0);
    expect(p.chosen).toBeNull();
    expect(Number.isFinite(p.rangeDeg)).toBe(true);
  });

  it("장면이 하나도 없어도 통과 기준 원은 그려진다", () => {
    const p = tracePlot([], { h: 0, v: 0 }, null, 3);
    expect(p.rangeDeg).toBe(10);
    expect(p.passRadius).toBeGreaterThan(0);
    expect(p.rings.length).toBeGreaterThan(0);
  });
});

describe("holdBackView — 가까운 장면이 없을 때 먼저 보이는 안내", () => {
  const far = async () => resultView(await input({ h: 20, v: 0 }))!;

  it("상한 전: 엔진의 W1 문장 그대로 다시 찍기를 권하고, 주 버튼은 다시 찍기다", async () => {
    const v = await far();
    for (const n of [0, RETAKE_LIMIT - 1]) {
      const h = holdBackView(v, n, RETAKE_LIMIT);
      expect(h.exhausted).toBe(false);
      expect(h.message.startsWith(v.retakeAdvice!)).toBe(true);
      expect(h.message).toContain("아직 말해 주지 못합니다");
      expect(h.primary).toEqual({ action: "retake", label: "다시 찍은 동영상 고르기" });
      expect(h.secondary.action).toBe("show");
    }
  });

  it("상한을 채우면: 다시 찍기를 더 권하지 않고, 주 버튼이 보고 저장하기로 바뀐다", async () => {
    const v = await far();
    for (const n of [RETAKE_LIMIT, RETAKE_LIMIT + 1]) {
      const h = holdBackView(v, n, RETAKE_LIMIT);
      expect(h.exhausted).toBe(true);
      expect(h.message).toContain(`가장 가까운 장면은 ${v.angleText} 차이입니다.`);
      expect(h.message).toContain(`${n}번 다시 찍었습니다`);
      expect(h.message).not.toContain("다시 찍기를 권합니다");
      expect(h.message).toContain("가까운 장면 없음");
      expect(h.primary).toEqual({ action: "show", label: "가장 가까운 장면 보고 저장하기" });
      expect(h.secondary.action).toBe("retake");
    }
  });

  it("어느 쪽이든 방향을 말하지 않고, '가까운 장면'이라고 부르지 않는다", async () => {
    const v = await far();
    for (const n of [0, RETAKE_LIMIT]) {
      const h = holdBackView(v, n, RETAKE_LIMIT);
      const text = [h.message, h.primary.label, h.secondary.label].join("\n");
      expect(text).not.toMatch(DIRECTION_WORDS);
      expect(text.replace(/가장 가까운 장면|가까운 장면 없음/g, "")).not.toContain("가까운 장면");
    }
  });
});

describe("saveGate — 저장 전 안내", () => {
  it("가까운 장면이면 사유도 안내도 없다", () => {
    expect(saveGate("close", 0, RETAKE_LIMIT)).toEqual({ needsReason: false, notice: null });
    expect(saveGate("close", 5, RETAKE_LIMIT)).toEqual({ needsReason: false, notice: null });
  });

  it("통과 기준을 넘으면 사유를 골라야 하고, 두 번까지는 다시 찍기를 먼저 권한다", () => {
    const g = saveGate("notClose", 1, RETAKE_LIMIT);
    expect(g.needsReason).toBe(true);
    expect(g.notice).toContain("다시 찍기를 먼저 권합니다");
    expect(g.notice).toContain("다시 찍은 횟수 1번");
  });

  it("두 번 다시 찍은 뒤에는 사유를 남기고 저장하라고 안내한다", () => {
    const g = saveGate("notClose", RETAKE_LIMIT, RETAKE_LIMIT);
    expect(g.needsReason).toBe(true);
    expect(g.notice).toContain("2번 다시 찍었습니다");
    expect(g.notice).not.toContain("먼저 권합니다");
  });

  it("안내는 띠와 기록에 표시가 남는다고 말한다", () => {
    for (const n of [0, 1, 2, 3]) expect(saveGate("notClose", n, RETAKE_LIMIT).notice).toContain("표시가 남습니다");
  });
});
