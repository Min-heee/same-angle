import { describe, expect, it } from "vitest";
import { angleDiffDeg, circularMeanDeg, phoneRollDeg, wrapDeg } from "./motion";

describe("phoneRollDeg", () => {
  it("atan2(gx, gy) 를 도로: (0, 9.81) → 0°, (9.81, 9.81) → 45°, (9.81, 0) → 90°", () => {
    // 기대값은 부호 상수 없이 손으로 적은 값이다. PHONE_ROLL_SIGN 을 D1 실측으로 바꾸면
    // 이 줄들도 근거 커밋과 함께 바꾼다(부호 고정 테스트는 matrix.test.ts).
    expect(phoneRollDeg(0, 9.81)).toBeCloseTo(0, 12);
    expect(phoneRollDeg(9.81, 9.81)).toBeCloseTo(45, 12);
    expect(phoneRollDeg(9.81, 0)).toBeCloseTo(90, 12);
    expect(phoneRollDeg(-9.81, 0)).toBeCloseTo(-90, 12);
  });

  it("gy 가 −g 인 기기에서 곧게 들면 ±180° 근처", () => {
    expect(Math.abs(phoneRollDeg(0.01, -9.81)!)).toBeCloseTo(180, 0);
  });

  it("비유한·누락·영벡터는 null", () => {
    expect(phoneRollDeg(Number.NaN, 1)).toBeNull();
    expect(phoneRollDeg(1, Number.POSITIVE_INFINITY)).toBeNull();
    expect(phoneRollDeg(null, 1)).toBeNull();
    expect(phoneRollDeg(1, undefined)).toBeNull();
    expect(phoneRollDeg(0, 0)).toBeNull();
  });
});

describe("wrapDeg · angleDiffDeg", () => {
  it("(−180, 180] 로 감는다", () => {
    expect(wrapDeg(190)).toBe(-170);
    expect(wrapDeg(-190)).toBe(170);
    expect(wrapDeg(180)).toBe(180);
    expect(wrapDeg(-180)).toBe(180);
    expect(wrapDeg(720 + 10)).toBe(10);
  });

  it("경계를 넘는 차: 179 − (−179) = −2", () => {
    expect(angleDiffDeg(179, -179)).toBe(-2);
    expect(angleDiffDeg(-179, 179)).toBe(2);
    expect(angleDiffDeg(10, 7)).toBe(3);
  });
});

describe("circularMeanDeg", () => {
  it("±180° 를 가로지르는 표본: 산술 평균은 0 이지만 원형 평균은 180", () => {
    expect(circularMeanDeg([179, -179])).toBeCloseTo(180, 9);
    expect(circularMeanDeg([170, -170, 180])).toBeCloseTo(180, 9);
  });

  it("경계에서 먼 표본은 산술 평균과 같다", () => {
    expect(circularMeanDeg([10, 20])).toBeCloseTo(15, 9);
    expect(circularMeanDeg([-5, 5, 0])).toBeCloseTo(0, 9);
  });

  it("빈 배열·상쇄되는 표본은 null, 비유한 값은 예외", () => {
    expect(circularMeanDeg([])).toBeNull();
    expect(circularMeanDeg([0, 180])).toBeNull();
    expect(() => circularMeanDeg([1, Number.NaN])).toThrow(RangeError);
  });
});
