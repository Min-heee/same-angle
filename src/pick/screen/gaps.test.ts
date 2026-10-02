import { describe, expect, it } from "vitest";
import { analyze } from "../pipeline";
import { synthFace, synthFrame } from "../testkit";
import type { PickedAnalysis } from "./flow";
import { resultView, type ResultInput } from "./view";

/*
 * 변이 시험에서 살아남은 화면 변이를 잡으려고 더한 시험. 합성 값이다.
 * 모든 장면이 10° 기울고 0.8배로 찍힌 동영상: 숫자 줄이 방향(부호)과 역수를 틀리지 않는지 본다.
 */

async function input(): Promise<ResultInput> {
  const face = synthFace();
  const r = await analyze({
    reference: face,
    durationSec: 4,
    measureAt: async (t) => synthFrame({ timeSec: t, dir: { h: -10 + 5 * t, v: 0 }, rollDeg: 10, size: 0.8 }),
  });
  if (r.kind !== "picked") throw new Error(`고르지 못함: ${r.kind}`);
  return {
    reference: { faceCount: 1, face, faceFailure: null, sharpness: 100, skin: { meanLuma: 128, clipRatio: 0 } },
    referenceOriginal: { width: 3024, height: 4032 },
    videoNative: { width: 1440, height: 1920 },
    videoDurationSec: 4,
    analysis: r as PickedAnalysis,
    chosenRank: 1,
  };
}

const row = (v: NonNullable<ReturnType<typeof resultView>>, label: string) => v.rows.find((r) => r.label === label)?.value;

describe("resultView — 숫자 줄", () => {
  it("얼굴 크기 차는 '이번 장면 ÷ 기준 사진'이다: 0.8배로 찍혔으면 0.80배 [V06]", async () => {
    const v = resultView(await input())!;
    expect(row(v, "얼굴 크기 차")).toBe("0.80배");
  });

  it("맞춘 기울기는 크기만 보인다(부호로 방향을 암시하지 않는다) [V08]", async () => {
    const i = await input();
    expect(i.analysis.winner.comparison.rotationDeg).toBeCloseTo(-10, 6);
    const v = resultView(i)!;
    expect(row(v, "맞춘 기울기")).toBe("10.0°");
    for (const r of v.rows) expect(r.value).not.toMatch(/(^|[^0-9a-zA-Z가-힣])-\d/);
  });
});
