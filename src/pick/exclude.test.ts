import { describe, expect, it } from "vitest";
import { NonFiniteSampleError } from "@/core/stats";
import { REASON_CODE, countExclusions, emptyCounts, exclusionOf, faceExclusion, sharpnessBaseline } from "./exclude";
import { RULES } from "./rules";
import { synthFrame } from "./testkit";

const good = (over: Parameters<typeof synthFrame>[0] = { timeSec: 0 }) => synthFrame({ ...over });

describe("X1 — 얼굴·행렬을 읽을 수 없음", () => {
  it("얼굴 없음, 둘 이상, 행렬·랜드마크 읽기 실패", () => {
    for (const failure of ["noFace", "multipleFaces", "matrixUnreadable", "landmarksUnreadable"] as const) {
      expect(exclusionOf(synthFrame({ timeSec: 0, failure }), 100)).toEqual({ code: "X1", reason: failure });
    }
  });

  it("직교 오차: 0.01 은 통과, 넘으면 제외, NaN 도 제외", () => {
    expect(exclusionOf(good({ timeSec: 0, orthoError: 0.01 }), 100)).toBeNull();
    expect(exclusionOf(good({ timeSec: 0, orthoError: 0.0101 }), 100)).toEqual({ code: "X1", reason: "notOrthogonal" });
    expect(exclusionOf(good({ timeSec: 0, orthoError: Number.NaN }), 100)).toEqual({ code: "X1", reason: "notOrthogonal" });
  });
});

describe("X2 — 얼굴 박스가 가장자리에 걸리거나 너무 작음", () => {
  it("가장자리에 걸리면 제외", () => {
    expect(exclusionOf(good({ timeSec: 0, touchesEdge: true }), 100)).toEqual({ code: "X2", reason: "touchesEdge" });
  });

  it("짧은 변의 20%: 정확히 20% 는 통과, 미만은 제외", () => {
    const m = good();
    m.face!.faceShortRatio = 0.2;
    expect(exclusionOf(m, 100)).toBeNull();
    m.face!.faceShortRatio = 0.1999;
    expect(exclusionOf(m, 100)).toEqual({ code: "X2", reason: "tooSmall" });
    m.face!.faceShortRatio = Number.NaN;
    expect(exclusionOf(m, 100)).toEqual({ code: "X2", reason: "tooSmall" });
  });
});

describe("X3 — 흔들림", () => {
  it("기준(중앙값)의 0.5배: 정확히 0.5배는 통과, 미만은 제외", () => {
    expect(exclusionOf(good({ timeSec: 0, sharpness: 50 }), 100)).toBeNull();
    expect(exclusionOf(good({ timeSec: 0, sharpness: 49.99 }), 100)).toEqual({ code: "X3", reason: "blurry" });
  });

  it("선명도를 재지 못한 장면은 통과시키지 않고, 사유를 '재지 못함'으로 적는다", () => {
    expect(exclusionOf(good({ timeSec: 0, sharpness: null }), 100)).toEqual({ code: "X3", reason: "sharpnessUnmeasured" });
    expect(exclusionOf(good({ timeSec: 0, sharpness: null }), null)).toEqual({ code: "X3", reason: "sharpnessUnmeasured" });
  });

  it("기준이 없으면(null) 흔들림은 견주지 않는다", () => {
    expect(exclusionOf(good({ timeSec: 0, sharpness: 0.001 }), null)).toBeNull();
  });

  it("기준은 거친 훑기 장면 가운데 X1·X2 를 통과한 장면들의 중앙값이다", () => {
    const coarse = [
      good({ timeSec: 0, sharpness: 100 }),
      good({ timeSec: 0.5, sharpness: 200 }),
      good({ timeSec: 1, sharpness: 300 }),
      // 아래는 모집단에 들어가지 않는다.
      good({ timeSec: 1.5, sharpness: 9000, touchesEdge: true }),
      good({ timeSec: 2, sharpness: 9000, orthoError: 0.5 }),
      synthFrame({ timeSec: 2.5, failure: "noFace" }),
      good({ timeSec: 3, sharpness: null }),
    ];
    expect(sharpnessBaseline(coarse)).toBe(200);
  });

  it("노출이 나쁜 장면은 모집단에 들어간다(X1·X2 만 거른다)", () => {
    const coarse = [good({ timeSec: 0, sharpness: 100 }), good({ timeSec: 0.5, sharpness: 300, clipRatio: 0.5 })];
    expect(sharpnessBaseline(coarse)).toBe(200);
  });

  it("통과한 장면이 없으면 기준은 null, 유한하지 않은 선명도는 예외 없이 걸러진다", () => {
    expect(sharpnessBaseline([])).toBeNull();
    expect(sharpnessBaseline([synthFrame({ timeSec: 0, failure: "noFace" })])).toBeNull();
    expect(() => sharpnessBaseline([good({ timeSec: 0, sharpness: Number.NaN })])).not.toThrow(NonFiniteSampleError);
    expect(sharpnessBaseline([good({ timeSec: 0, sharpness: Number.NaN })])).toBeNull();
  });
});

describe("X4 — 노출 사고", () => {
  it("클리핑 5%: 정확히 5% 는 통과, 넘으면 제외", () => {
    expect(exclusionOf(good({ timeSec: 0, clipRatio: 0.05 }), 100)).toBeNull();
    expect(exclusionOf(good({ timeSec: 0, clipRatio: 0.0501 }), 100)).toEqual({ code: "X4", reason: "clipped" });
  });

  it("피부 패치를 재지 못한 장면은 통과시키지 않는다", () => {
    const m = good();
    m.skin = null;
    expect(exclusionOf(m, 100)).toEqual({ code: "X4", reason: "exposureUnmeasured" });
  });
});

describe("순서와 세기", () => {
  it("여러 조건에 걸리면 표의 순서대로 처음 걸린 것 하나만 붙는다", () => {
    const all = good({ timeSec: 0, orthoError: 1, touchesEdge: true, sharpness: 1, clipRatio: 1 });
    expect(exclusionOf(all, 100)?.code).toBe("X1");
    const x2 = good({ timeSec: 0, touchesEdge: true, sharpness: 1, clipRatio: 1 });
    expect(exclusionOf(x2, 100)?.code).toBe("X2");
    const x3 = good({ timeSec: 0, sharpness: 1, clipRatio: 1 });
    expect(exclusionOf(x3, 100)?.code).toBe("X3");
    expect(faceExclusion(x3)).toBeNull();
  });

  it("사유마다 코드가 하나씩 정해져 있다", () => {
    expect(REASON_CODE).toEqual({
      noFace: "X1",
      multipleFaces: "X1",
      matrixUnreadable: "X1",
      landmarksUnreadable: "X1",
      notOrthogonal: "X1",
      touchesEdge: "X2",
      tooSmall: "X2",
      sharpnessUnmeasured: "X3",
      blurry: "X3",
      exposureUnmeasured: "X4",
      clipped: "X4",
    });
  });

  it("사유별로 세고, 빼지 않은 장면은 세지 않는다", () => {
    expect(emptyCounts()).toEqual({ X1: 0, X2: 0, X3: 0, X4: 0, total: 0 });
    const c = countExclusions([
      null,
      { code: "X1", reason: "noFace" },
      { code: "X1", reason: "multipleFaces" },
      { code: "X3", reason: "blurry" },
      null,
      { code: "X4", reason: "clipped" },
    ]);
    expect(c).toEqual({ X1: 2, X2: 0, X3: 1, X4: 1, total: 4 });
  });

  it("경계값은 규칙 상수에서 읽는다", () => {
    const strict = { ...RULES, exclude: { ...RULES.exclude, maxClipRatio: 0.01 } };
    expect(exclusionOf(good({ timeSec: 0, clipRatio: 0.03 }), 100, strict)?.reason).toBe("clipped");
    expect(exclusionOf(good({ timeSec: 0, clipRatio: 0.03 }), 100)).toBeNull();
  });
});
