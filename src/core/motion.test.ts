import { describe, expect, it } from "vitest";
import { PHONE_ROLL_SIGN, angleDiffDeg, phoneRollDeg, wrapDeg } from "./motion";

describe("phoneRollDeg", () => {
  it("atan2(gx, gy) 를 도로: (0, 9.81) → 0°, (9.81, 9.81) → 45°, (9.81, 0) → 90°", () => {
    expect(phoneRollDeg(0, 9.81)).toBe(0);
    expect(phoneRollDeg(9.81, 9.81)).toBeCloseTo(PHONE_ROLL_SIGN * 45, 12);
    expect(phoneRollDeg(9.81, 0)).toBeCloseTo(PHONE_ROLL_SIGN * 90, 12);
    expect(phoneRollDeg(-9.81, 0)).toBeCloseTo(PHONE_ROLL_SIGN * -90, 12);
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
