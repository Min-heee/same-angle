import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SECTION_KEYS } from "@/core/report";
import { EXPORT_NO, SECTION_NAV, STATUS_MARK, navLabel, nextNav } from "./nav";

const SECTIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "sections");

describe("SECTION_NAV", () => {
  it("0~11 은 보고서 섹션 키 순서 그대로, 12 는 내보내기", () => {
    expect(SECTION_NAV.map((x) => x.no)).toEqual([...Array(13).keys()]);
    expect(SECTION_NAV.slice(0, 12).map((x) => x.key)).toEqual([...SECTION_KEYS]);
    expect(SECTION_NAV[EXPORT_NO]).toEqual({ no: 12, key: null, title: "결과 내보내기" });
  });

  it("제목은 섹션 컴포넌트의 title 과 같다(소스 대조)", () => {
    const found = new Map<number, string>();
    for (const f of readdirSync(SECTIONS_DIR).filter((x) => x.endsWith(".tsx"))) {
      const src = readFileSync(join(SECTIONS_DIR, f), "utf8");
      const m = /no=\{(\d+)\}\s*title="([^"]+)"/.exec(src);
      if (m) found.set(Number(m[1]), m[2]);
    }
    expect(found.size).toBe(13);
    for (const item of SECTION_NAV) expect(found.get(item.no)).toBe(item.title);
  });
});

describe("상태 표시는 색만이 아니라 글자로도", () => {
  it("완료·실패·진행에는 기호가 있고 서로 다르다", () => {
    expect(STATUS_MARK.done).toBe("✓");
    expect(STATUS_MARK.failed).toBe("✕");
    expect(new Set([STATUS_MARK.done, STATUS_MARK.failed, STATUS_MARK.running]).size).toBe(3);
  });

  it("낭독 이름: 번호·제목·상태", () => {
    expect(navLabel(SECTION_NAV[4], "done")).toBe("4번 자세 픽스처, 완료");
    expect(navLabel(SECTION_NAV[1], "failed")).toBe("1번 카메라, 실패");
    expect(navLabel(SECTION_NAV[EXPORT_NO], null)).toBe("12번 결과 내보내기");
  });

  it("다음 섹션: 11 → 12, 12 → 없음", () => {
    expect(nextNav(3)?.title).toBe("자세 픽스처");
    expect(nextNav(11)?.no).toBe(12);
    expect(nextNav(12)).toBeNull();
  });
});
