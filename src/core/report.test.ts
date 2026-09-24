import { describe, expect, it } from "vitest";
import {
  MAX_BASE64_RUN,
  MAX_DEPTH,
  MAX_FIXTURES,
  MAX_SECTION_CHARS,
  MAX_SECTION_NUMBERS,
  MAX_STRING_LENGTH,
  REPORT_KIND,
  REPORT_VERSION,
  ReportValidationError,
  SECTION_KEYS,
  buildReport,
  failingSectionKeys,
  finiteOrNull,
  reportFileName,
  validateReport,
  type FixtureRecord,
  type JsonValue,
  type ReportInput,
  type SectionKey,
  type SectionResult,
} from "./report";

function idleSections(): Record<SectionKey, SectionResult> {
  return Object.fromEntries(
    SECTION_KEYS.map((k) => [k, { status: "idle", reason: null, data: null }]),
  ) as Record<SectionKey, SectionResult>;
}

/** 빌더를 거치지 않고 보고서 모양만 만든다(검증기가 오류를 몇 개 모으는지 볼 때). */
function buildLoose(input: ReportInput) {
  return { kind: REPORT_KIND, version: REPORT_VERSION, ...input };
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

  /*
   * 필수 경로 전체. 하나씩 지운 뒤 (1) 거부되는지, (2) "없음"으로 보고되는지,
   * (3) 검증기가 그 자리를 채워 넣지 않았는지 본다. 한두 경로만 보면 나머지 경로에서
   * "누락을 null·0 으로 채우기" 변이가 살아남는다.
   */
  const REQUIRED_PATHS: (string | number)[][] = [
    ["kind"],
    ["version"],
    ["createdAt"],
    ["device"],
    ["device", "userAgent"],
    ["device", "screenWidth"],
    ["device", "screenHeight"],
    ["device", "devicePixelRatio"],
    ["sections"],
    ...SECTION_KEYS.map((k) => ["sections", k]),
    ["sections", "face", "status"],
    ["sections", "face", "reason"],
    ["sections", "face", "data"],
    ["sections", "network", "reason"],
    ["sections", "network", "data"],
    ["fixtures"],
    ["fixtures", 0, "name"],
    ["fixtures", 0, "matrix"],
    ["fixtures", 0, "layout"],
    ["fixtures", 0, "angles"],
    ["fixtures", 0, "angles", "yaw"],
    ["fixtures", 0, "angles", "pitch"],
    ["fixtures", 0, "angles", "roll"],
    ["fixtures", 0, "frames"],
    ["manualChecks"],
    ["manualChecks", "filesAppNamesKept"],
    ["manualChecks", "longPressSaved"],
  ];
  const pathText = (p: (string | number)[]) =>
    "report" + p.map((x) => (typeof x === "number" ? `[${x}]` : `.${x}`)).join("");

  it.each(REQUIRED_PATHS.map((p) => [pathText(p), p] as const))("%s 가 빠지면 거부하고 채우지 않는다", (text, p) => {
    const r = JSON.parse(JSON.stringify(buildReport(sampleInput())));
    let parent = r;
    for (const k of p.slice(0, -1)) parent = parent[k];
    const last = p[p.length - 1];
    delete parent[last];
    const v = validateReport(r);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors).toContain(`${text}: 없음`);
    expect(Object.prototype.hasOwnProperty.call(parent, last)).toBe(false);
  });

  it.each([["createdAt"], ["device"], ["sections"], ["fixtures"], ["manualChecks"]] as const)(
    "buildReport 입력에서 %s 가 빠져도 기본값으로 채우지 않고 '없음'으로 거부",
    (k) => {
      const input = sampleInput() as unknown as Record<string, unknown>;
      delete input[k];
      expect(() => buildReport(input as unknown as ReportInput)).toThrow(new RegExp(`report\\.${k}: 없음`));
    },
  );

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

    const d = sampleInput();
    d.fixtures[0].angles!.yaw = Number.NaN;
    expect(() => buildReport(d)).toThrow(/fixtures\[0\]\.angles\.yaw: 유한한 수가 아님/);

    const e = sampleInput();
    e.device.screenWidth = Number.NaN;
    expect(() => buildReport(e)).toThrow(/device\.screenWidth: 유한한 수가 아님/);

    const f = sampleInput();
    f.device.screenHeight = Number.POSITIVE_INFINITY;
    expect(() => buildReport(f)).toThrow(/device\.screenHeight: 유한한 수가 아님/);
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

  describe("쪼개서 넣으면 노드 한도는 빠져나가지만 섹션 총량에서 막힌다", () => {
    it("랜드마크 478점을 239점씩 두 배열로(배열 하나는 300 이하)", () => {
      const pts = (n: number) => Array.from({ length: n }, (_, i) => [0.4 + i * 1e-4, 0.5, -0.01]);
      const a = sampleInput();
      a.sections.face.data = { lmA: pts(239), lmB: pts(239) };
      expect(() => buildReport(a)).toThrow(/수가 너무 많음\(1434 > 900\)/);
      // x·y 두 좌표만 넣어도(478 × 2 = 956) 막힌다.
      const b = sampleInput();
      b.sections.face.data = {
        xs: Array.from({ length: 239 }, () => [0.5, 0.5]),
        ys: Array.from({ length: 239 }, () => [0.5, 0.5]),
      };
      expect(() => buildReport(b)).toThrow(/face: 수가 너무 많음/);
    });

    it("base64 JPEG 을 2000자 이하 조각 300개로(조각 하나는 문자열 한도 안)", () => {
      const a = sampleInput();
      a.sections.share.data = { jpeg: Array.from({ length: 300 }, () => "/9j/" + "A".repeat(1990)) };
      const v = validateReport(JSON.parse(JSON.stringify({ ...buildLoose(a) })));
      expect(v.ok).toBe(false);
      if (!v.ok) {
        expect(v.errors.some((e) => /share: 글자가 너무 많음/.test(e))).toBe(true);
        expect(v.errors.some((e) => /base64 로 보이는/.test(e))).toBe(true);
      }
    });

    it("base64 조각을 공백으로 끊어 연속 검사를 피해도 글자 총량에서 막힌다", () => {
      const chunk = Array.from({ length: 30 }, () => "QUFB".repeat(15)).join(" "); // 1829자, 연속 60자
      expect(chunk.length).toBeLessThanOrEqual(MAX_STRING_LENGTH);
      const a = sampleInput();
      a.sections.share.data = { parts: Array.from({ length: 20 }, () => chunk) };
      expect(() => buildReport(a)).toThrow(/share: 글자가 너무 많음/);
      expect(() => buildReport(a)).not.toThrow(/base64 로 보이는/);
    });

    it("키 이름도 글자 수에 들어간다", () => {
      const a = sampleInput();
      const obj: { [k: string]: JsonValue } = {};
      for (let i = 0; i < 200; i++) obj[`k${i}_${"x".repeat(150)}`] = null;
      a.sections.share.data = obj;
      expect(() => buildReport(a)).toThrow(/share: 글자가 너무 많음/);
    });

    it(`base64 연속 ${MAX_BASE64_RUN}자는 거부, ${MAX_BASE64_RUN - 1}자는 통과`, () => {
      const a = sampleInput();
      a.sections.share.data = { s: "A".repeat(MAX_BASE64_RUN) };
      expect(() => buildReport(a)).toThrow(/base64 로 보이는/);
      const b = sampleInput();
      b.sections.share.data = { s: "A".repeat(MAX_BASE64_RUN - 1) };
      expect(() => buildReport(b)).not.toThrow();
    });

    it("사람이 읽는 긴 문자열(오류 문장·userAgent·모델 URL)은 base64 로 보지 않는다", () => {
      const a = sampleInput();
      a.sections.face.reason =
        "Error: 모델 초기화: 60초 안에 끝나지 않음 https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
      a.device.userAgent =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
      expect(() => buildReport(a)).not.toThrow();
    });

    it("섹션 한도는 섹션마다 따로 센다: 한도 바로 아래는 통과", () => {
      const a = sampleInput();
      // 900개 = 300 × 3 배열
      a.sections.face.data = { a: Array(300).fill(1), b: Array(300).fill(2), c: Array(300).fill(3) };
      a.sections.jitter.data = { a: Array(300).fill(1), b: Array(300).fill(2), c: Array(300).fill(3) };
      expect(() => buildReport(a)).not.toThrow();
      a.sections.face.data = { a: Array(300).fill(1), b: Array(300).fill(2), c: Array(301).fill(3).slice(0, 300), d: 4 };
      expect(() => buildReport(a)).toThrow(new RegExp(`face: 수가 너무 많음\\(${MAX_SECTION_NUMBERS + 1} > `));
    });

    it("점검 페이지의 가장 큰 섹션 모양(흔들림 10회, 카메라 시도 20건)은 한도 안", () => {
      const summary = { n: 300, mean: 1.2345, std: 0.1234, median: 1.2, p95: 1.5, min: 0.9, max: 1.7 };
      const metrics = ["yaw", "pitch", "roll", "scale", "tz", "cx", "cy", "intervalMs", "inferMs", "shortSideRatio"];
      const jitter = Array.from({ length: 10 }, () => ({
        hold: "oneHand",
        view: "oblique45",
        seconds: 30,
        engine: "GPU/2",
        frames: 420,
        valid: 400,
        noFace: 10,
        multiFace: 5,
        noDecompose: 5,
        summaries: Object.fromEntries(metrics.map((m) => [m, summary])),
      }));
      const longErr = "NotReadableError: " + "카메라를 열 수 없습니다 ".repeat(40).slice(0, 380);
      const camera = {
        attempts: Array.from({ length: 20 }, () => ({ label: "environment · 1920×1080 ideal", ok: false, error: longErr })),
        starts: [],
        resizes: [],
      };
      const a = sampleInput();
      a.sections.jitter.data = { results: jitter } as unknown as JsonValue;
      a.sections.camera.data = camera as unknown as JsonValue;
      expect(() => buildReport(a)).not.toThrow();
      expect(MAX_SECTION_CHARS).toBeGreaterThan(20 * longErr.length);
    });
  });

  describe("거부 분기마다 하나씩", () => {
    it("kind 가 다르면 거부", () => {
      const r = JSON.parse(JSON.stringify(buildReport(sampleInput())));
      r.kind = "other";
      const v = validateReport(r);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errors).toContain(`report.kind: "${REPORT_KIND}" 가 아님`);
    });

    it("픽스처 layout 은 col/row/null 만", () => {
      const a = sampleInput();
      (a.fixtures[0] as { layout: string }).layout = "xyz";
      expect(() => buildReport(a)).toThrow(/fixtures\[0\]\.layout/);
      const b = sampleInput();
      b.fixtures[0].layout = null;
      expect(() => buildReport(b)).not.toThrow();
    });

    it("픽스처 angles 의 비유한 값·빠진 축은 거부, null 은 통과", () => {
      const a = sampleInput();
      a.fixtures[0].angles = { yaw: Number.NaN, pitch: 0, roll: 0 };
      expect(() => buildReport(a)).toThrow(/angles\.yaw: 유한한 수가 아님/);
      const b = sampleInput();
      (b.fixtures[0] as { angles: unknown }).angles = { yaw: 0, pitch: 0 };
      expect(() => buildReport(b)).toThrow(/angles\.roll: 없음/);
      const c = sampleInput();
      (c.fixtures[0] as { angles: unknown }).angles = [0, 0, 0];
      expect(() => buildReport(c)).toThrow(/angles: 객체\/null 이 아님/);
      const d = sampleInput();
      d.fixtures[0].angles = null;
      expect(() => buildReport(d)).not.toThrow();
    });

    it("픽스처 frames 는 1 이상의 정수", () => {
      for (const bad of [0, 1.5, -3]) {
        const a = sampleInput();
        a.fixtures[0].frames = bad;
        expect(() => buildReport(a)).toThrow(/frames: 1 이상의 정수가 아님/);
      }
      const b = sampleInput();
      b.fixtures[0].frames = 1;
      expect(() => buildReport(b)).not.toThrow();
    });

    it(`픽스처는 ${MAX_FIXTURES}개까지`, () => {
      const one = (): FixtureRecord => ({ ...sampleInput().fixtures[0] });
      const a = sampleInput();
      a.fixtures = Array.from({ length: MAX_FIXTURES }, one);
      expect(() => buildReport(a)).not.toThrow();
      a.fixtures = Array.from({ length: MAX_FIXTURES + 1 }, one);
      expect(() => buildReport(a)).toThrow(/fixtures: 너무 많음\(61\)/);
    });

    it("섹션 reason 에도 data: URL·긴 문자열을 넣을 수 없다", () => {
      const a = sampleInput();
      a.sections.camera.reason = "data:image/jpeg;base64,/9j/4AAQ";
      expect(() => buildReport(a)).toThrow(/camera\.reason: data: URL/);
      const b = sampleInput();
      b.sections.camera.reason = "x ".repeat(1001);
      expect(() => buildReport(b)).toThrow(/camera\.reason: 문자열이 너무 김/);
      const c = sampleInput();
      (c.sections.camera as { reason: unknown }).reason = 3;
      expect(() => buildReport(c)).toThrow(/camera\.reason: 문자열\/null 이 아님/);
    });

    it("manualChecks 는 true/false/null 만", () => {
      const a = sampleInput();
      (a.manualChecks as { longPressSaved: unknown }).longPressSaved = "yes";
      expect(() => buildReport(a)).toThrow(/longPressSaved: true\/false\/null 이 아님/);
      const b = sampleInput();
      (b.manualChecks as { filesAppNamesKept: unknown }).filesAppNamesKept = 1;
      expect(() => buildReport(b)).toThrow(/filesAppNamesKept: true\/false\/null 이 아님/);
      const c = sampleInput();
      c.manualChecks = { filesAppNamesKept: false, longPressSaved: true };
      expect(() => buildReport(c)).not.toThrow();
    });

    it(`깊이는 ${MAX_DEPTH}단까지(data 자체가 1단)`, () => {
      const nest = (levels: number): JsonValue => (levels === 0 ? 1 : { a: nest(levels - 1) });
      const a = sampleInput();
      a.sections.env.data = nest(MAX_DEPTH - 1); // 잎이 MAX_DEPTH 단
      expect(() => buildReport(a)).not.toThrow();
      a.sections.env.data = nest(MAX_DEPTH); // 잎이 MAX_DEPTH + 1 단
      expect(() => buildReport(a)).toThrow(/너무 깊음/);
    });

    it("createdAt 은 끝에 Z 가 있어야 한다(현지 시각 문자열 거부)", () => {
      const a = sampleInput();
      a.createdAt = "2026-09-24T07:05:00";
      expect(() => buildReport(a)).toThrow(/createdAt/);
      a.createdAt = "2026-09-24T07:05:00+09:00";
      expect(() => buildReport(a)).toThrow(/createdAt/);
      a.createdAt = "2026-09-24T07:05:00Z";
      expect(() => buildReport(a)).not.toThrow();
    });

    it("Date·Map·클래스 인스턴스는 JSON 값이 아니다", () => {
      class Point {
        x = 1;
      }
      for (const bad of [new Date(0), new Map([["a", 1]]), new Point()]) {
        const a = sampleInput();
        a.sections.env.data = { when: bad as unknown as JsonValue };
        expect(() => buildReport(a)).toThrow(/env\.data\.when: JSON 값이 아님/);
      }
      // 프로토타입이 null 인 객체는 평범한 객체로 본다.
      const b = sampleInput();
      const bare = Object.create(null) as { [k: string]: JsonValue };
      bare.x = 1;
      b.sections.env.data = bare;
      expect(() => buildReport(b)).not.toThrow();
    });

    it("userAgent 에도 문자열 한도가 걸린다", () => {
      const a = sampleInput();
      a.device.userAgent = "M".repeat(MAX_STRING_LENGTH + 1) + " ";
      expect(() => buildReport(a)).toThrow(/userAgent: 문자열이 너무 김/);
      const b = sampleInput();
      (b.device as { userAgent: unknown }).userAgent = 5;
      expect(() => buildReport(b)).toThrow(/userAgent: 문자열이 아님/);
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

describe("failingSectionKeys", () => {
  it("오류 문구에서 섹션 키만 뽑는다(순서는 SECTION_KEYS 순, 중복 없음)", () => {
    expect(
      failingSectionKeys([
        "report.sections.share.data.preview: data: URL 은 넣을 수 없음",
        "report.sections.face.data.xs: 배열이 너무 김(478)",
        "report.sections.face.data.fps: 유한한 수가 아님",
        "report.fixtures[0].frames: 1 이상의 정수가 아님",
        "report.device.screenWidth: 유한한 수가 아님",
      ]),
    ).toEqual(["face", "share"]);
  });

  it("섹션 오류가 없으면 빈 배열, 모르는 키는 무시", () => {
    expect(failingSectionKeys(["report.manualChecks: 없음"])).toEqual([]);
    expect(failingSectionKeys(["report.sections.nope: 모르는 필드"])).toEqual([]);
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
