import { describe, expect, it } from "vitest";
import { YAW_SIGN } from "@/core/matrix";
import { FIXTURE_LABELS, fixtureFromMatrices } from "./fixture";

const deg = (d: number) => (d * Math.PI) / 180;

/** yaw d°, 이동 (1, 2, −40) 을 행 우선으로. */
function rowYaw(d: number, tz = -40): number[] {
  const c = Math.cos(deg(d));
  const s = Math.sin(deg(d));
  return [c, 0, s, 1, 0, 1, 0, 2, -s, 0, c, tz, 0, 0, 0, 1];
}

describe("fixtureFromMatrices", () => {
  it("행 우선 행렬 목록: 원소별 중앙값을 'row' 로 판별해 분해한다", () => {
    const mats = [rowYaw(19), rowYaw(20), rowYaw(21), rowYaw(20), rowYaw(20, -41)];
    const f = fixtureFromMatrices("selfLeft20", mats);
    expect(f.name).toBe("selfLeft20");
    expect(f.layout).toBe("row");
    expect(f.frames).toBe(5);
    expect(f.matrix).toEqual(rowYaw(20));
    expect(f.angles!.yaw).toBeCloseTo(YAW_SIGN * 20, 3);
    expect(f.angles!.pitch).toBeCloseTo(0, 3);
    expect(f.angles!.roll).toBeCloseTo(0, 3);
  });

  it("열 우선이면 'col'", () => {
    const col = (m: number[]) => [0, 1, 2, 3].flatMap((c) => [0, 1, 2, 3].map((r) => m[r * 4 + c]));
    const f = fixtureFromMatrices("front", Array.from({ length: 6 }, () => col(rowYaw(-20))));
    expect(f.layout).toBe("col");
    expect(f.angles!.yaw).toBeCloseTo(YAW_SIGN * -20, 3);
  });

  it("배치를 판별할 수 없으면 layout·angles 를 null 로 명시한다", () => {
    const noT = rowYaw(20).map((v, i) => ([3, 7, 11].includes(i) ? 0 : v));
    const f = fixtureFromMatrices("front", Array.from({ length: 5 }, () => noT));
    expect(f.layout).toBeNull();
    expect(f.angles).toBeNull();
  });

  it("프레임이 모자라거나 비유한 값이 섞이면 예외(채워서 만들지 않는다)", () => {
    expect(() => fixtureFromMatrices("front", [rowYaw(0), rowYaw(0)])).toThrow(/2개뿐/);
    const bad = rowYaw(0);
    bad[5] = Number.NaN;
    expect(() => fixtureFromMatrices("front", [rowYaw(0), rowYaw(0), rowYaw(0), rowYaw(0), bad])).toThrow(/중앙값/);
  });
});

describe("FIXTURE_LABELS", () => {
  it("기울임은 방향이 박힌 문장이다(roll 부호를 정하려면 방향이 필요)", () => {
    expect(FIXTURE_LABELS.tilt).toContain("오른쪽 귀");
    expect(FIXTURE_LABELS.selfLeft20).toContain("왼쪽");
  });
});
