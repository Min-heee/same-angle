import { describe, expect, it } from "vitest";
import {
  REPORT_KIND,
  REPORT_VERSION,
  ReportValidationError,
  SECTION_KEYS,
  buildReport,
  finiteOrNull,
  reportFileName,
  validateReport,
  type ReportInput,
  type SectionKey,
  type SectionResult,
} from "./report";

function idleSections(): Record<SectionKey, SectionResult> {
  return Object.fromEntries(
    SECTION_KEYS.map((k) => [k, { status: "idle", reason: null, data: null }]),
  ) as Record<SectionKey, SectionResult>;
}

function sampleInput(): ReportInput {
  const sections = idleSections();
  sections.env = {
    status: "done",
    reason: null,
    data: { isSecureContext: true, imageCapture: false, violations: [] },
  };
  sections.face = {
    status: "done",
    reason: null,
    data: {
      snapshots: [{ delegate: "CPU", numFaces: 2, medianInferMs: 41.5, p95InferMs: 60.25, fps: 14.2 }],
      layoutCounts: { col: 120, row: 0, unknown: 0 },
    },
  };
  sections.camera = { status: "failed", reason: "NotAllowedError: 권한 거부", data: { attempts: [] } };
  return {
    createdAt: "2026-09-24T07:05:00.000Z",
    device: { userAgent: "Mozilla/5.0 (iPhone)", screenWidth: 393, screenHeight: 852, devicePixelRatio: 3 },
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

describe("buildReport · validateReport", () => {
  it("만들고 → JSON 문자열 → 파싱 → 검증 통과, 원본과 같다(왕복)", () => {
    const built = buildReport(sampleInput());
    expect(built.kind).toBe(REPORT_KIND);
    expect(built.version).toBe(REPORT_VERSION);
    const parsed: unknown = JSON.parse(JSON.stringify(built));
    const v = validateReport(parsed);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.report).toEqual(built);
  });

  it("필드가 빠지면 거부하고 채우지 않는다", () => {
    const r = JSON.parse(JSON.stringify(buildReport(sampleInput())));
    delete r.device.devicePixelRatio;
    delete r.sections.network;
    delete r.manualChecks;
    const v = validateReport(r);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors).toContain("report.device.devicePixelRatio: 없음");
      expect(v.errors).toContain("report.sections.network: 없음");
      expect(v.errors).toContain("report.manualChecks: 없음");
    }
    // 검증기가 입력을 고치지 않았다.
    expect(r.manualChecks).toBeUndefined();
  });

  it("모르는 필드는 거부", () => {
    const r = JSON.parse(JSON.stringify(buildReport(sampleInput())));
    r.extra = 1;
    r.fixtures[0].note = "x";
    const v = validateReport(r);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors).toContain("report.extra: 모르는 필드");
      expect(v.errors).toContain("report.fixtures[0].note: 모르는 필드");
    }
  });

  it("버전이 다르면 거부", () => {
    const r = JSON.parse(JSON.stringify(buildReport(sampleInput())));
    r.version = 2;
    expect(validateReport(r).ok).toBe(false);
    r.version = "1";
    expect(validateReport(r).ok).toBe(false);
  });

  it("비유한 수는 섹션 데이터·픽스처·기기 정보 어디서든 거부(빌더가 예외)", () => {
    const a = sampleInput();
    a.sections.face.data = { fps: Number.NaN };
    expect(() => buildReport(a)).toThrow(ReportValidationError);

    const b = sampleInput();
    b.fixtures[0].matrix[5] = Number.POSITIVE_INFINITY;
    expect(() => buildReport(b)).toThrow(/matrix\[5\]/);

    const c = sampleInput();
    c.device.devicePixelRatio = Number.NaN;
    expect(() => buildReport(c)).toThrow(/devicePixelRatio/);
  });

  it("undefined 는 JSON 으로 왕복하지 않으므로 거부", () => {
    const a = sampleInput();
    a.sections.env.data = { x: undefined as unknown as null };
    expect(() => buildReport(a)).toThrow(/undefined/);
  });

  it("행렬이 16개가 아니면 거부", () => {
    const a = sampleInput();
    a.fixtures[0].matrix = a.fixtures[0].matrix.slice(0, 15);
    expect(() => buildReport(a)).toThrow(/16개/);
  });

  it("픽스처 이름은 정해진 6개만", () => {
    const a = sampleInput();
    (a.fixtures[0] as { name: string }).name = "sideways";
    expect(() => buildReport(a)).toThrow(/name/);
  });

  describe("이미지·랜드마크가 섞여 들어오는 길을 막는다", () => {
    it("landmarks·image 같은 키(대소문자 무시)", () => {
      const a = sampleInput();
      a.sections.face.data = { faceLandmarks: [[0.1, 0.2]] };
      expect(() => buildReport(a)).toThrow(/이미지·랜드마크/);
      const b = sampleInput();
      b.sections.exif.data = { nested: { Image: "x" } };
      expect(() => buildReport(b)).toThrow(/이미지·랜드마크/);
    });

    it("data: URL 문자열", () => {
      const a = sampleInput();
      a.sections.share.data = { preview: "data:image/png;base64,iVBORw0KGgo=" };
      expect(() => buildReport(a)).toThrow(/data: URL/);
    });

    it("긴 문자열(base64 이미지 크기)과 긴 배열(랜드마크 478점 크기)", () => {
      const a = sampleInput();
      a.sections.share.data = { s: "A".repeat(5000) };
      expect(() => buildReport(a)).toThrow(/너무 김/);
      const b = sampleInput();
      b.sections.face.data = { xs: Array.from({ length: 478 }, () => 0.5) };
      expect(() => buildReport(b)).toThrow(/너무 김/);
    });
  });

  it("상태 값은 idle/running/done/failed 만", () => {
    const a = sampleInput();
    (a.sections.env as { status: string }).status = "ok";
    expect(() => buildReport(a)).toThrow(/status/);
  });

  it("createdAt 은 UTC ISO 문자열만", () => {
    const a = sampleInput();
    a.createdAt = "2026-09-24 16:05";
    expect(() => buildReport(a)).toThrow(/createdAt/);
  });

  it("객체가 아닌 입력", () => {
    expect(validateReport(null).ok).toBe(false);
    expect(validateReport([]).ok).toBe(false);
    expect(validateReport("{}").ok).toBe(false);
  });
});

describe("reportFileName", () => {
  it("현지 시각으로 same-angle-d1-report-YYYYMMDD-HHmm.json", () => {
    expect(reportFileName(new Date(2026, 8, 24, 9, 5, 59))).toBe("same-angle-d1-report-20260924-0905.json");
    expect(reportFileName(new Date(2026, 0, 3, 23, 40))).toBe("same-angle-d1-report-20260103-2340.json");
  });
});

describe("finiteOrNull", () => {
  it("유한한 수만 통과", () => {
    expect(finiteOrNull(1.5)).toBe(1.5);
    expect(finiteOrNull(0)).toBe(0);
    expect(finiteOrNull(Number.NaN)).toBeNull();
    expect(finiteOrNull(Number.POSITIVE_INFINITY)).toBeNull();
    expect(finiteOrNull("1")).toBeNull();
    expect(finiteOrNull(undefined)).toBeNull();
  });
});
