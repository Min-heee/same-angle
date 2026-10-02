import { describe, expect, it } from "vitest";
import { RULES } from "../rules";
import {
  BAND_NOTICE,
  MEMO_IN_NAME_MAX,
  bandLayout,
  bandLines,
  dateStamp,
  exportNames,
  memoForName,
  memoForRecord,
  notCloseMark,
} from "./exportplan";

// 기기 현지 시각으로 만든다(시험이 시간대에 따라 달라지지 않게).
const DATE = new Date(2026, 9, 2, 14, 5);

describe("파일 이름(F19: 사진 종류·날짜·메모)", () => {
  it("메모가 없으면 종류와 날짜만 붙는다", () => {
    expect(exportNames({ shotKind: "front", date: DATE, memo: "" })).toEqual({
      corrected: "같은각도_정면_20261002-1405_보정본.png",
      original: "같은각도_정면_20261002-1405_원본장면.png",
      record: "같은각도_정면_20261002-1405_기록.json",
    });
  });

  it("메모가 있으면 날짜 뒤에 붙고, 종류 이름의 공백은 뺀다", () => {
    const n = exportNames({ shotKind: "frontDown", date: DATE, memo: " 3회차 재촬영 " });
    expect(n.corrected).toBe("같은각도_정면숙임_20261002-1405_3회차-재촬영_보정본.png");
  });

  it("세 파일의 이름은 서로 다르고, 앞부분(종류·날짜·메모)이 같다", () => {
    const n = exportNames({ shotKind: "leftOblique", date: DATE, memo: "A-12" });
    const names = [n.corrected, n.original, n.record];
    expect(new Set(names).size).toBe(3);
    for (const name of names) expect(name.startsWith("같은각도_왼쪽사선_20261002-1405_A-12_")).toBe(true);
  });

  it("날짜는 한 자리 수를 0 으로 채운다", () => {
    expect(dateStamp(new Date(2026, 0, 3, 4, 5))).toBe("20260103-0405");
  });
});

describe("메모를 파일 이름에 붙이기", () => {
  it.each([
    ["../../etc/passwd", "etc-passwd"],
    ["a/b\\c:d*e?f\"g<h>i|j", "a-b-c-d-e-f-g-h-i-j"],
    ["  여러   칸  ", "여러-칸"],
    ["줄\n바꿈\t탭", "줄-바꿈-탭"],
    ["...", ""],
    ["", ""],
    ["#3 & 50% {x}", "3-50-x"],
  ])("%j → %j", (memo, expected) => {
    expect(memoForName(memo)).toBe(expected);
  });

  it("경로를 벗어나게 하는 글자가 남지 않는다", () => {
    const out = memoForName("..\\..\\x/../y.png");
    expect(out).not.toMatch(/[\\/.:]/);
  });

  it("길면 자르고, 잘린 끝에 줄표가 남지 않는다", () => {
    const out = memoForName("가나다 ".repeat(20));
    expect([...out].length).toBeLessThanOrEqual(MEMO_IN_NAME_MAX);
    expect(out.endsWith("-")).toBe(false);
  });

  it("기록에는 쓴 그대로(앞뒤 공백만 떼고) 들어가고, 비면 null 이다", () => {
    expect(memoForRecord("  3회차 / 재촬영  ")).toBe("3회차 / 재촬영");
    expect(memoForRecord("   ")).toBeNull();
  });
});

describe("저장 이미지 아래 띠", () => {
  const base = { shotKind: "front" as const, date: DATE, angleDeg: 1.2 };

  it("첫 줄은 늘 '내부 기록용 · 광고·홍보 사용 금지'다", () => {
    for (const kind of ["corrected", "original"] as const) {
      for (const verdict of ["close", "notClose"] as const) {
        expect(bandLines({ ...base, kind, verdict, noCloseScene: verdict === "notClose" })[0]).toBe(BAND_NOTICE);
      }
    }
    expect(BAND_NOTICE).toBe("내부 기록용 · 광고·홍보 사용 금지");
  });

  it("보정본에는 보정했다는 사실이, 원본에는 보정하지 않았다는 사실이 들어간다", () => {
    const c = bandLines({ ...base, kind: "corrected", verdict: "close", noCloseScene: false });
    const o = bandLines({ ...base, kind: "original", verdict: "close", noCloseScene: false });
    expect(c[1]).toContain("기울기·크기·위치 맞춤");
    expect(c[1]).toContain("회전·확대·이동만");
    expect(o[1]).toContain("보정 없음");
  });

  it("가까운 장면이면 통과 기준을 넘었다는 표시가 없다", () => {
    const lines = bandLines({ ...base, kind: "corrected", verdict: "close", noCloseScene: false });
    expect(lines.join("\n")).not.toMatch(/가까운 장면/);
    expect(notCloseMark("close", false, 1.2)).toBeNull();
  });

  it("가까운 장면이 없으면 '가까운 장면 없음'과 각도 차·기준값을 새긴다(보정본·원본 모두)", () => {
    for (const kind of ["corrected", "original"] as const) {
      const lines = bandLines({ ...base, kind, verdict: "notClose", noCloseScene: true, angleDeg: 4.23 });
      expect(lines).toContain(`가까운 장면 없음 · 각도 차 4.2°(통과 기준 ${RULES.select.passDeg}° 넘음)`);
    }
  });

  it("가까운 장면이 있는데 사람이 통과 기준을 넘는 후보를 고르면 '가까운 장면 아님'이다", () => {
    expect(notCloseMark("notClose", false, 5)).toContain("가까운 장면 아님");
  });

  it("기준값 근처의 각도는 한 자리 더 적는다(3.0° 로 보이는데 표시가 붙는 일이 없게)", () => {
    expect(notCloseMark("notClose", true, 3.04)).toContain("3.04°");
  });

  it("마지막 줄에 사진 종류와 날짜가 들어간다", () => {
    const lines = bandLines({ ...base, kind: "original", verdict: "close", noCloseScene: false, shotKind: "rightOblique" });
    expect(lines.at(-1)).toBe("같은각도 · 오른쪽 사선 · 2026-10-02");
  });

  it("띠의 높이는 줄 수만큼이고, 좁은 이미지에서도 글자가 14px 아래로 내려가지 않는다", () => {
    const wide = bandLayout(1920, 4);
    expect(wide.fontPx).toBe(48);
    expect(wide.height).toBe(wide.paddingY * 2 + wide.lineHeight * 4);
    const narrow = bandLayout(200, 3);
    expect(narrow.fontPx).toBe(14);
    expect(narrow.height).toBeGreaterThan(narrow.lineHeight * 3);
  });
});
