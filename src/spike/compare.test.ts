import { describe, expect, it } from "vitest";
import { diffSamples, sampleToJson } from "./compare";
import type { FrameSample } from "./sample";

function sample(p: { yaw: number; pitch: number; roll: number; tz: number; cx: number; cy: number; matrix?: number[] }): FrameSample {
  return {
    t: 0,
    inferMs: 10,
    intervalMs: null,
    faces: 1,
    matrix: p.matrix ?? null,
    layout: p.matrix ? "col" : null,
    dec: { yaw: p.yaw, pitch: p.pitch, roll: p.roll, scale: 1, t: [0, 0, p.tz], orthoError: 0 },
    box: {
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
      width: 1,
      height: 1,
      cx: 0,
      cy: 0,
      shortSideRatio: 0.3,
      centerShort: { x: p.cx, y: p.cy },
      touchesEdge: false,
    },
    frameW: 1920,
    frameH: 1080,
  };
}

describe("diffSamples", () => {
  it("b − a 부호, 크기는 |ln(|tz_a| / |tz_b|)|, 중심은 짧은 변 눈금의 차", () => {
    const a = sample({ yaw: 2, pitch: -1, roll: 0.5, tz: -40, cx: 0.5, cy: 0.4 });
    const b = sample({ yaw: 5, pitch: 1, roll: -0.5, tz: -44, cx: 0.55, cy: 0.38 });
    const d = diffSamples(a, b) as Record<string, number | null>;
    expect(d.dYaw).toBe(3);
    expect(d.dPitch).toBe(2);
    expect(d.dRoll).toBe(-1);
    // |ln(40/44)| = 0.0953101…
    expect(d.sizeLogRatio).toBeCloseTo(Math.abs(Math.log(40 / 44)), 5);
    expect(d.sizeLogRatio).toBeCloseTo(0.09531, 5);
    expect(d.dCx).toBeCloseTo(0.05, 4);
    expect(d.dCy).toBeCloseTo(-0.02, 4);
    expect(d.maxAbsMatrixDiff).toBeNull();
  });

  it("크기 비는 방향과 무관(a·b 를 바꿔도 같은 값), 각도 차는 부호가 뒤집힌다", () => {
    const a = sample({ yaw: 2, pitch: 0, roll: 0, tz: -40, cx: 0.5, cy: 0.5 });
    const b = sample({ yaw: 5, pitch: 0, roll: 0, tz: -44, cx: 0.5, cy: 0.5 });
    const ab = diffSamples(a, b) as Record<string, number>;
    const ba = diffSamples(b, a) as Record<string, number>;
    expect(ab.sizeLogRatio).toBe(ba.sizeLogRatio);
    expect(ab.dYaw).toBe(-ba.dYaw);
  });

  it("같은 배치의 행렬이 있으면 원소별 최대 차를 적는다", () => {
    const m1 = Array.from({ length: 16 }, () => 0);
    const m2 = [...m1];
    m2[7] = -0.25;
    const d = diffSamples(sample({ yaw: 0, pitch: 0, roll: 0, tz: -40, cx: 0, cy: 0, matrix: m1 }), sample({ yaw: 0, pitch: 0, roll: 0, tz: -40, cx: 0, cy: 0, matrix: m2 })) as Record<string, number>;
    expect(d.maxAbsMatrixDiff).toBe(0.25);
    expect(d.sizeLogRatio).toBe(0);
  });

  it("한쪽이라도 분해가 없으면 null", () => {
    const a = sample({ yaw: 0, pitch: 0, roll: 0, tz: -40, cx: 0, cy: 0 });
    expect(diffSamples(a, null)).toBeNull();
    expect(diffSamples(null, a)).toBeNull();
    expect(diffSamples(a, { ...a, dec: null })).toBeNull();
  });
});

describe("sampleToJson", () => {
  it("숫자만 반올림해 적고 행렬·랜드마크는 넣지 않는다", () => {
    const x = sampleToJson(sample({ yaw: 1.23456, pitch: 0, roll: 0, tz: -40.12345, cx: 0.123456, cy: 0.5, matrix: Array(16).fill(0) })) as Record<string, unknown>;
    expect(x.yaw).toBe(1.235);
    expect(x.tz).toBe(-40.123);
    expect(x.cx).toBe(0.1235);
    expect(x.frame).toBe("1920x1080");
    expect("matrix" in x).toBe(false);
    expect(sampleToJson(null)).toBeNull();
  });
});
