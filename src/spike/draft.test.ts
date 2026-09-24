import { describe, expect, it } from "vitest";
import { SECTION_KEYS, type SectionKey, type SectionResult } from "@/core/report";
import { INTERRUPTED_REASON, parseDraft, restoredList, serializeDraft, type Draft } from "./draft";

function draft(): Draft {
  const sections = Object.fromEntries(SECTION_KEYS.map((k) => [k, { status: "idle", reason: null, data: null }])) as Record<
    SectionKey,
    SectionResult
  >;
  sections.jitter = { status: "running", reason: null, data: { results: [{ view: "front" }] } };
  sections.face = { status: "done", reason: null, data: { snapshots: [] } };
  return {
    savedAt: "2026-09-24T07:05:00.000Z",
    sections,
    fixtures: [
      {
        name: "front",
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.5, -1.25, -42, 1],
        layout: "col",
        angles: { yaw: 0, pitch: 0, roll: 0 },
        frames: 12,
      },
    ],
    manualChecks: { filesAppNamesKept: true, longPressSaved: null },
  };
}

describe("parseDraft", () => {
  it("저장 → 읽기 왕복. 진행 중이던 섹션은 실패로 바꾸고 이유를 적는다", () => {
    const d = parseDraft(serializeDraft(draft()))!;
    expect(d.savedAt).toBe("2026-09-24T07:05:00.000Z");
    expect(d.fixtures).toHaveLength(1);
    expect(d.manualChecks.filesAppNamesKept).toBe(true);
    expect(d.sections.face.status).toBe("done");
    expect(d.sections.jitter.status).toBe("failed");
    expect(d.sections.jitter.reason).toBe(INTERRUPTED_REASON);
    expect(d.sections.jitter.data).toEqual({ results: [{ view: "front" }] });
  });

  it("보고서 검사에 걸리는 초안(이미지 키·섹션 누락)은 채워 살리지 않고 버린다", () => {
    const a = draft();
    a.sections.face.data = { image: "x" };
    expect(parseDraft(serializeDraft(a))).toBeNull();
    const b = JSON.parse(serializeDraft(draft()));
    delete b.sections.network;
    expect(parseDraft(JSON.stringify(b))).toBeNull();
  });

  it("빈 값·깨진 JSON·다른 초안 버전은 null", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("{")).toBeNull();
    const c = JSON.parse(serializeDraft(draft()));
    c.draftVersion = 2;
    expect(parseDraft(JSON.stringify(c))).toBeNull();
  });
});

describe("restoredList", () => {
  it("섹션 데이터의 배열 필드만 꺼낸다", () => {
    expect(restoredList({ runs: [1, 2] }, "runs")).toEqual([1, 2]);
    expect(restoredList({ runs: 1 }, "runs")).toEqual([]);
    expect(restoredList(null, "runs")).toEqual([]);
    expect(restoredList([1], "runs")).toEqual([]);
  });
});
