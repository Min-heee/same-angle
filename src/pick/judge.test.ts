import { describe, expect, it } from "vitest";
import { compareToReference } from "./compare";
import {
  WARNING_ORDER,
  assessReference,
  judge,
  judgeCandidate,
  orientationOf,
  warningsOf,
  type JudgeContext,
  type JudgeNumbers,
} from "./judge";
import { RULES } from "./rules";
import { BASE_FRAME, synthFace, synthFrame } from "./testkit";

/** 아무 경고도 뜨지 않는 숫자 묶음. 시험마다 한 값만 바꾼다. */
const clean = (over: Partial<JudgeNumbers> = {}): JudgeNumbers => ({
  angleDeg: 1,
  mirroredAngleDeg: 1,
  referenceOrientation: "portrait",
  videoOrientation: "portrait",
  roiEmptyFraction: 0,
  frameScale: 1,
  qualityScale: 1,
  sharpness: 100,
  referenceSharpness: 100,
  meanLuma: 120,
  referenceMeanLuma: 120,
  residual: 0.01,
  position: 0.01,
  remeasureShiftDeg: 0.2,
  videoDurationSec: 12,
  referenceClipRatio: 0,
  ...over,
});

describe("warningsOf — 경계값", () => {
  it("아무 문제 없으면 경고 없음, 판정은 가까운 장면", () => {
    expect(judge(clean())).toEqual({ verdict: "close", warnings: [] });
  });

  it("W1: 각도차 3° 는 통과, 넘으면 경고 + 가까운 장면 아님", () => {
    expect(warningsOf(clean({ angleDeg: 3 }))).toEqual([]);
    expect(judge(clean({ angleDeg: 3.0001, mirroredAngleDeg: 50 }))).toEqual({ verdict: "notClose", warnings: ["W1"] });
    expect(judge(clean({ angleDeg: Number.NaN, mirroredAngleDeg: null }))).toEqual({ verdict: "notClose", warnings: ["W1"] });
  });

  it("W10: 가깝지 않은데 기준 방향의 좌우를 뒤집으면 3° 안일 때만", () => {
    expect(warningsOf(clean({ angleDeg: 80, mirroredAngleDeg: 1 }))).toEqual(["W1", "W10"]);
    expect(warningsOf(clean({ angleDeg: 80, mirroredAngleDeg: 3.1 }))).toEqual(["W1"]);
    expect(warningsOf(clean({ angleDeg: 80, mirroredAngleDeg: null }))).toEqual(["W1"]);
    // 가까운 장면이면(정면 사진처럼 뒤집어도 가까운 경우) 띄우지 않는다.
    expect(warningsOf(clean({ angleDeg: 1, mirroredAngleDeg: 1 }))).toEqual([]);
  });

  it("W12: 세로·가로가 다를 때. 정사각형은 어느 쪽과도 다르다고 하지 않는다", () => {
    expect(warningsOf(clean({ videoOrientation: "landscape" }))).toEqual(["W12"]);
    expect(warningsOf(clean({ referenceOrientation: "landscape", videoOrientation: "landscape" }))).toEqual([]);
    expect(warningsOf(clean({ referenceOrientation: "square", videoOrientation: "landscape" }))).toEqual([]);
  });

  it("W3: 관심 영역의 빈 곳 2% 는 통과, 넘으면 경고", () => {
    expect(warningsOf(clean({ roiEmptyFraction: 0.02 }))).toEqual([]);
    expect(warningsOf(clean({ roiEmptyFraction: 0.0201 }))).toEqual(["W3"]);
    expect(warningsOf(clean({ roiEmptyFraction: null }))).toEqual([]);
  });

  it("W11: 틀 배율은 양쪽으로 본다(1.3 초과 또는 1/1.3 미만)", () => {
    expect(warningsOf(clean({ frameScale: 1.3 }))).toEqual([]);
    expect(warningsOf(clean({ frameScale: 1.31 }))).toEqual(["W11"]);
    expect(warningsOf(clean({ frameScale: 1 / 1.3 + 1e-9 }))).toEqual([]);
    expect(warningsOf(clean({ frameScale: 0.76 }))).toEqual(["W11"]);
  });

  it("W2: 화질 배율 1.3 은 통과, 넘으면 경고. 줄여 그리는 쪽(1 미만)은 경고가 아니다", () => {
    expect(warningsOf(clean({ qualityScale: 1.3 }))).toEqual([]);
    expect(warningsOf(clean({ qualityScale: 1.3001 }))).toEqual(["W2"]);
    expect(warningsOf(clean({ qualityScale: 0.4 }))).toEqual([]);
    expect(warningsOf(clean({ qualityScale: null }))).toEqual([]);
  });

  it("W2 와 W11 은 따로다: 틀은 같은데 동영상 해상도가 낮으면 W2 만", () => {
    expect(warningsOf(clean({ frameScale: 1, qualityScale: 1.5 }))).toEqual(["W2"]);
    expect(warningsOf(clean({ frameScale: 1.5, qualityScale: 1.0 }))).toEqual(["W11"]);
  });

  it("W8: 고른 장면의 선명도가 기준 사진의 0.5배 미만", () => {
    expect(warningsOf(clean({ sharpness: 50 }))).toEqual([]);
    expect(warningsOf(clean({ sharpness: 49.9 }))).toEqual(["W8"]);
    expect(warningsOf(clean({ sharpness: 10, referenceSharpness: null }))).toEqual([]);
  });

  it("W9: 밝기 차 30 은 통과, 넘으면 경고(어느 쪽이 밝든)", () => {
    expect(warningsOf(clean({ meanLuma: 150 }))).toEqual([]);
    expect(warningsOf(clean({ meanLuma: 150.5 }))).toEqual(["W9"]);
    expect(warningsOf(clean({ meanLuma: 89 }))).toEqual(["W9"]);
    expect(warningsOf(clean({ meanLuma: null }))).toEqual([]);
  });

  it("W13: 남는 오차 4% 는 통과, 넘으면 경고", () => {
    expect(warningsOf(clean({ residual: 0.04 }))).toEqual([]);
    expect(warningsOf(clean({ residual: 0.0401 }))).toEqual(["W13"]);
  });

  it("W4: 위치 차 0.05 는 통과, 넘으면 경고", () => {
    expect(warningsOf(clean({ position: 0.05 }))).toEqual([]);
    expect(warningsOf(clean({ position: 0.0501 }))).toEqual(["W4"]);
  });

  it("W5: 다시 잰 방향이 1° 넘게 다르면", () => {
    expect(warningsOf(clean({ remeasureShiftDeg: 1 }))).toEqual([]);
    expect(warningsOf(clean({ remeasureShiftDeg: 1.01 }))).toEqual(["W5"]);
    expect(warningsOf(clean({ remeasureShiftDeg: null }))).toEqual([]);
  });

  it("W6: 60초를 넘으면. W7: 기준 사진의 클리핑 5% 초과", () => {
    expect(warningsOf(clean({ videoDurationSec: 60 }))).toEqual([]);
    expect(warningsOf(clean({ videoDurationSec: 60.1 }))).toEqual(["W6"]);
    expect(warningsOf(clean({ referenceClipRatio: 0.05 }))).toEqual([]);
    expect(warningsOf(clean({ referenceClipRatio: 0.06 }))).toEqual(["W7"]);
    expect(warningsOf(clean({ referenceClipRatio: null }))).toEqual([]);
  });

  it("전부 걸리면 표의 순서대로 13개가 나온다", () => {
    const all = warningsOf(
      clean({
        angleDeg: 80,
        mirroredAngleDeg: 1,
        videoOrientation: "landscape",
        roiEmptyFraction: 0.5,
        frameScale: 2,
        qualityScale: 2,
        sharpness: 1,
        meanLuma: 250,
        residual: 0.5,
        position: 0.5,
        remeasureShiftDeg: 5,
        videoDurationSec: 90,
        referenceClipRatio: 0.5,
      }),
    );
    expect(all).toEqual([...WARNING_ORDER]);
    expect(all).toHaveLength(13);
  });

  it("경계값은 규칙 값에서 읽는다 — 통과 기준을 5° 로 올리면 4° 는 가까운 장면이다", () => {
    const loose = { ...RULES, select: { ...RULES.select, passDeg: 5 } };
    expect(judge(clean({ angleDeg: 4 }), loose)).toEqual({ verdict: "close", warnings: [] });
    expect(judge(clean({ angleDeg: 4 })).verdict).toBe("notClose");
  });
});

describe("orientationOf", () => {
  it("세로·가로·정사각형", () => {
    expect(orientationOf({ width: 1080, height: 1920 })).toBe("portrait");
    expect(orientationOf({ width: 1920, height: 1080 })).toBe("landscape");
    expect(orientationOf({ width: 500, height: 500 })).toBe("square");
  });
});

describe("assessReference — 기준 사진에서 멈춤", () => {
  it("얼굴을 읽었으면 통과", () => {
    const m = synthFrame({ timeSec: 0 });
    const a = assessReference(m);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.face).toBe(m.face);
  });

  it("S1: 얼굴이 없음(정수리 등). 행렬·랜드마크를 읽지 못한 경우도 S1 이고 사유로 구별한다", () => {
    expect(assessReference(synthFrame({ timeSec: 0, failure: "noFace" }))).toEqual({ ok: false, stop: "S1", reason: "noFace" });
    expect(assessReference(synthFrame({ timeSec: 0, failure: "matrixUnreadable" }))).toEqual({
      ok: false,
      stop: "S1",
      reason: "matrixUnreadable",
    });
  });

  it("S2: 얼굴이 둘 이상", () => {
    expect(assessReference(synthFrame({ timeSec: 0, failure: "multipleFaces" }))).toEqual({
      ok: false,
      stop: "S2",
      reason: "multipleFaces",
    });
  });
});

describe("judgeCandidate — 후보 하나의 숫자·보정본 틀·판정", () => {
  const refFace = synthFace();
  const ctx: JudgeContext = {
    reference: { faceCount: 1, face: refFace, faceFailure: null, sharpness: 200, skin: { meanLuma: 120, clipRatio: 0.01 } },
    referenceOriginal: { width: 3024, height: 4032 },
    videoNative: { width: 1440, height: 1920 },
    videoDurationSec: 12,
  };
  const candidate = (opts: Parameters<typeof synthFace>[0], sharpness = 150, meanLuma = 125) => {
    const face = synthFace(opts);
    return { face, sharpness, meanLuma, comparison: compareToReference(refFace, face)!, remeasureShiftDeg: 0.1 };
  };

  it("기준과 같은 장면: 가까운 장면, 경고 없음", () => {
    const j = judgeCandidate(candidate({}), ctx);
    expect(j.verdict).toBe("close");
    expect(j.warnings).toEqual([]);
    expect(j.output!.size).toEqual({ width: 1440, height: 1920 });
    // 원본 1440×1920 → 재는 크기 720×960(×0.5) → 맞춤 1 → 출력 1440×1920(×2): k = 1.
    expect(j.numbers.qualityScale).toBeCloseTo(1, 9);
    expect(j.numbers.roiEmptyFraction).toBeCloseTo(0, 9);
  });

  it("같은 장면이라도 동영상 해상도가 낮으면 늘려 그리게 되어 W2 가 뜬다", () => {
    // 원본 1080×1440 → 재는 크기(×2/3) → 출력(×2): k = 1.333 > 1.3.
    const j = judgeCandidate(candidate({}), { ...ctx, videoNative: { width: 1080, height: 1440 } });
    expect(j.numbers.qualityScale).toBeCloseTo(4 / 3, 9);
    expect(j.verdict).toBe("close");
    expect(j.warnings).toEqual(["W2"]);
  });

  it("각도가 4° 다르고 기울고 작게 찍힌 장면: 숫자가 견준 결과 그대로 들어가고 W1 이 뜬다", () => {
    const c = candidate({ dir: { h: 4, v: 0 }, rollDeg: 10, size: 0.7 });
    const j = judgeCandidate(c, { ...ctx, videoNative: { width: 2160, height: 2880 } });
    expect(j.verdict).toBe("notClose");
    expect(j.warnings).toContain("W1");
    expect(j.warnings).toContain("W11"); // f = 1/0.7 = 1.43
    expect(j.numbers.angleDeg).toBe(c.comparison.angleDeg);
    expect(j.numbers.frameScale).toBeCloseTo(1 / 0.7, 9);
    expect(j.numbers.referenceSharpness).toBe(200);
    expect(j.numbers.referenceClipRatio).toBe(0.01);
    expect(j.numbers.videoOrientation).toBe("portrait");
  });

  it("기준 사진의 픽셀 지표를 재지 못했으면 null 로 남고 그 경고는 뜨지 않는다", () => {
    const noPixels: JudgeContext = { ...ctx, reference: { ...ctx.reference, sharpness: null, skin: null } };
    const j = judgeCandidate(candidate({}, 1, 250), { ...noPixels, videoNative: { width: 2160, height: 2880 } });
    expect(j.numbers.referenceSharpness).toBeNull();
    expect(j.numbers.referenceMeanLuma).toBeNull();
    expect(j.numbers.referenceClipRatio).toBeNull();
    expect(j.warnings).toEqual([]);
  });

  it("기준 사진 3:4, 동영상 9:16: 출력 전체는 25% 가 비지만 관심 영역은 비지 않아 W3 이 뜨지 않는다", () => {
    // 같은 거리에서 찍어 얼굴의 픽셀 크기가 같고 둘 다 가운데에 있는 경우(긴 변 화각이 같다고 가정).
    const c = candidate({ frame: { width: 540, height: 960 } });
    const j = judgeCandidate(c, { ...ctx, videoNative: { width: 1080, height: 1920 } });
    expect(j.output!.totalEmptyFraction).toBeCloseTo(0.25, 6);
    expect(j.numbers.roiEmptyFraction).toBeCloseTo(0, 9);
    expect(j.warnings).not.toContain("W3");
    expect(j.numbers.qualityScale).toBeCloseTo(1, 9);
  });

  it("얼굴이 동영상 가장자리 쪽에 찍혀 머리 둘레가 비면 W3", () => {
    const c = candidate({ frame: { width: 540, height: 960 }, shift: { x: -90, y: 0 } });
    const j = judgeCandidate(c, { ...ctx, videoNative: { width: 1080, height: 1920 } });
    expect(j.numbers.roiEmptyFraction!).toBeGreaterThan(0.02);
    expect(j.warnings).toContain("W3");
  });

  it("[알려진 문제] 화면비가 다르면 같은 거리에서 찍어도 틀 배율 f 가 0.75 가 되어 W11 이 뜬다", () => {
    // f 는 '화면 짧은 변 대비 얼굴 크기'의 비다(PRD 5절). 3:4 사진과 9:16 동영상은 긴 변이 같아도 짧은 변이
    // 720 대 540 이라, 얼굴의 픽셀 크기가 같아도 f = 540/720 = 0.75 < 1/1.3 이다. 규칙을 PRD 그대로
    // 구현했을 때 나오는 결과이고, 고칠지는 PRD 에서 정한다(긴 변으로 나누면 이 경우 1 이 된다).
    const c = candidate({ frame: { width: 540, height: 960 } });
    const j = judgeCandidate(c, { ...ctx, videoNative: { width: 1080, height: 1920 } });
    expect(c.comparison.fitScale).toBeCloseTo(1, 9); // 픽셀 크기는 같다
    expect(j.numbers.frameScale).toBeCloseTo(0.75, 9);
    expect(j.warnings).toContain("W11");
  });

  it("세로 기준 사진에 가로 동영상이면 W12", () => {
    const j = judgeCandidate(candidate({ frame: { width: 960, height: 720 } }), {
      ...ctx,
      videoNative: { width: 2880, height: 2160 },
    });
    expect(j.warnings).toContain("W12");
    expect(BASE_FRAME.height).toBeGreaterThan(BASE_FRAME.width);
  });
});
