import { describe, expect, it } from "vitest";
import { WARNING_ORDER, type JudgeNumbers, type StopCode } from "./judge";
import {
  ALWAYS_SHOWN,
  formatAngle,
  formatPercent,
  formatRatio,
  quickAnswerMessage,
  splitWarnings,
  exclusionSummary,
  stopMessage,
  warningMessage,
} from "./messages";

const numbers: JudgeNumbers = {
  angleDeg: 4.26,
  mirroredAngleDeg: 1,
  referenceOrientation: "portrait",
  videoOrientation: "landscape",
  roiEmptyFraction: 0.123,
  frameScale: 0.8,
  qualityScale: 1.47,
  sharpness: 10,
  referenceSharpness: 100,
  meanLuma: 200,
  referenceMeanLuma: 120,
  residual: 0.1,
  position: 0.2,
  remeasureShiftDeg: 2,
  videoDurationSec: 90,
  referenceClipRatio: 0.2,
};
const ctx = { numbers, videoNative: { width: 1920, height: 1080 } };
const STOPS: StopCode[] = ["S1", "S2", "S3", "S4", "S5"];

/** 방향을 말하는 낱말. 각도 부호를 실기기로 확정하기 전에는 문장에 나오면 안 된다. */
const DIRECTION_WORDS = /왼쪽|오른쪽|위로|아래로|더 숙|더 들|더 돌/;

describe("사유와 문장의 짝", () => {
  it("멈춤 코드마다 문장이 하나씩 있고 서로 다르다", () => {
    const sentences = STOPS.map((c) => stopMessage(c, { X1: 1, X2: 2, X3: 3, X4: 4, total: 10 }));
    expect(new Set(sentences).size).toBe(STOPS.length);
    for (const s of sentences) expect(s.length).toBeGreaterThan(10);
  });

  it("경고 코드마다 문장이 하나씩 있고 서로 다르다", () => {
    const sentences = WARNING_ORDER.map((c) => warningMessage(c, ctx));
    expect(sentences).toHaveLength(13);
    expect(new Set(sentences).size).toBe(13);
    for (const s of sentences) expect(s.length).toBeGreaterThan(8);
  });

  it("PRD 표의 문장 그대로다(핵심 구절)", () => {
    expect(stopMessage("S1")).toContain("얼굴이 보이지 않아 각도를 잴 수 없습니다");
    expect(stopMessage("S2")).toContain("한 사람만 나온 사진");
    expect(stopMessage("S3")).toContain("이 동영상은 이 브라우저에서 열 수 없습니다");
    expect(stopMessage("S5")).toContain("JPEG로 저장해 주세요");
    expect(warningMessage("W1", ctx)).toBe("가장 가까운 장면은 4.3° 차이입니다. 다시 찍기를 권합니다.");
    expect(warningMessage("W10", ctx)).toContain("반대쪽을 찍었거나 좌우가 뒤집힌 사진");
    expect(warningMessage("W12", ctx)).toBe("기준 사진은 세로, 동영상은 가로입니다. 같은 방향으로 찍어 주세요.");
    expect(warningMessage("W3", ctx)).toBe("머리 둘레 12.3%가 동영상에 찍히지 않아 비었습니다.");
    expect(warningMessage("W2", ctx)).toContain("1.47배 늘려 그렸습니다(동영상 1920×1080)");
    expect(warningMessage("W6", ctx)).toBe("앞 60초만 봤습니다.");
    expect(warningMessage("W8", ctx)).toContain("숱이 달라 보일 수 있습니다");
    expect(warningMessage("W5", ctx)).toContain("다시 잰 값으로 판정했습니다");
  });

  it("W11 은 '장면이 기준 사진의 몇 배'로 말한다(f 의 역수)", () => {
    // f = 0.8 → 장면의 얼굴이 기준의 1.25배.
    expect(warningMessage("W11", ctx)).toContain("기준 사진의 1.25배입니다");
    expect(warningMessage("W11", ctx)).toContain("원근");
  });

  it("S4 는 뺀 장면 수를 사유별로 말한다", () => {
    expect(stopMessage("S4", { X1: 20, X2: 1, X3: 3, X4: 2, total: 26 })).toBe(
      "쓸 수 있는 장면이 없습니다(얼굴 없음 20장, 잘림·작음 1장, 흔들림 3장, 노출 2장). 다시 찍어 주세요.",
    );
    expect(stopMessage("S4")).toBe("쓸 수 있는 장면이 없습니다. 다시 찍어 주세요.");
  });

  it("S4: 0장인 사유는 적지 않는다", () => {
    expect(stopMessage("S4", { X1: 20, X2: 0, X3: 3, X4: 0, total: 23 })).toBe(
      "쓸 수 있는 장면이 없습니다(얼굴 없음 20장, 흔들림 3장). 다시 찍어 주세요.",
    );
    // 다시 잰 장면이 전부 탈락한 경우처럼 뺀 장면이 하나도 없으면 괄호도 없다.
    expect(stopMessage("S4", { X1: 0, X2: 0, X3: 0, X4: 0, total: 0 })).toBe(
      "쓸 수 있는 장면이 없습니다. 다시 찍어 주세요.",
    );
  });

  it("S4: 얼굴이 둘 이상이어서 뺀 장면은 '얼굴 없음'과 따로 적는다(합은 X1 그대로)", () => {
    const c = { X1: 20, X2: 0, X3: 0, X4: 0, total: 20 };
    expect(stopMessage("S4", c, 14)).toBe(
      "쓸 수 있는 장면이 없습니다(얼굴 없음 6장, 얼굴이 둘 이상 14장). 다시 찍어 주세요.",
    );
    expect(exclusionSummary(c, 20)).toBe("얼굴이 둘 이상 20장");
    // X1 보다 큰 수가 넘어와도 합을 넘겨 적지 않는다.
    expect(exclusionSummary(c, 99)).toBe("얼굴이 둘 이상 20장");
    expect(exclusionSummary(c)).toBe("얼굴 없음 20장");
  });

  it("방향을 말하는 문장은 없다(각도 부호를 실기기로 확정하기 전)", () => {
    const all = [
      ...STOPS.map((c) => stopMessage(c, { X1: 0, X2: 0, X3: 0, X4: 0, total: 0 })),
      ...WARNING_ORDER.map((c) => warningMessage(c, ctx)),
      quickAnswerMessage("passedNear"),
      quickAnswerMessage("notNear"),
      ...ALWAYS_SHOWN,
    ];
    for (const s of all) expect(s).not.toMatch(DIRECTION_WORDS);
  });

  it("코드는 문장에 나오지 않는다", () => {
    for (const c of WARNING_ORDER) expect(warningMessage(c, ctx)).not.toMatch(/\b[WSX]\d+\b/);
    for (const c of STOPS) expect(stopMessage(c)).not.toMatch(/\b[WSX]\d+\b/);
  });
});

describe("늘 보이는 문장·빠른 답", () => {
  it("세 줄이고, 재지 않는 것과 보증이 아니라는 것을 말한다", () => {
    expect(ALWAYS_SHOWN).toHaveLength(3);
    expect(ALWAYS_SHOWN[0]).toContain("머리 젖음·빗질·조명");
    expect(ALWAYS_SHOWN[1]).toContain("촬영 거리가 같았다는 뜻은 아닙니다");
    expect(ALWAYS_SHOWN[2]).toContain("보증이 아닙니다");
  });

  it("빠른 답은 두 문장이고 최종 판정처럼 말하지 않는다", () => {
    expect(quickAnswerMessage("passedNear")).toContain("근처를 지나갔습니다");
    expect(quickAnswerMessage("notNear")).toContain("지나가지 않은 것 같습니다");
    expect(quickAnswerMessage("passedNear")).not.toContain("가까운 장면");
  });
});

describe("formatAngle — 반올림 표기", () => {
  it("보통은 소수 첫째 자리", () => {
    expect(formatAngle(1.234)).toBe("1.2°");
    expect(formatAngle(12.96)).toBe("13.0°");
    expect(formatAngle(0)).toBe("0.0°");
  });

  it("기준값 근처(±0.05°)에서는 둘째 자리까지 — '3.0° 인데 왜 아니냐'가 생기지 않게", () => {
    expect(formatAngle(3.04)).toBe("3.04°");
    expect(formatAngle(2.96)).toBe("2.96°");
    expect(formatAngle(3)).toBe("3.00°");
    expect(formatAngle(3.06)).toBe("3.1°");
    expect(formatAngle(2.94)).toBe("2.9°");
  });

  it("둘째 자리에서도 기준값과 같아 보이면 자리를 더 늘린다", () => {
    expect(formatAngle(3.004)).toBe("3.004°");
    expect(formatAngle(2.9996)).toBe("2.9996°");
  });

  it("기준값을 바꾸면 그 둘레에서 늘린다. 유한하지 않으면 줄표", () => {
    expect(formatAngle(5.02, 5)).toBe("5.02°");
    expect(formatAngle(3.02, 5)).toBe("3.0°");
    expect(formatAngle(Number.NaN)).toBe("—");
  });

  it("배율과 퍼센트 표기", () => {
    expect(formatRatio(1.4666)).toBe("1.47");
    expect(formatRatio(Number.NaN)).toBe("—");
    expect(formatPercent(0.0234)).toBe("2.3%");
    expect(formatPercent(Number.NaN)).toBe("—");
  });
});

describe("splitWarnings", () => {
  it("표의 순서대로 3개까지 펼치고 나머지는 접는다", () => {
    expect(splitWarnings(["W1", "W3", "W2", "W9", "W4"])).toEqual({ shown: ["W1", "W3", "W2"], folded: ["W9", "W4"] });
    expect(splitWarnings(["W4"])).toEqual({ shown: ["W4"], folded: [] });
    expect(splitWarnings([])).toEqual({ shown: [], folded: [] });
  });
});
