import { describe, expect, it } from "vitest";
import { judge } from "./judge";
import type { FaceReading, Measured } from "./measure";
import { analyze, type AnalysisResult } from "./pipeline";
import {
  MAX_MEMO_LENGTH,
  PICK_RECORD_KIND,
  PICK_RECORD_VERSION,
  PickRecordError,
  buildPickRecord,
  pickRecordFileName,
  rejudge,
  rulesSnapshot,
  validatePickRecord,
  type PickRecord,
  type PickRecordInput,
} from "./record";
import { RULES, RULES_VERSION } from "./rules";
import { crossSweep, synthFace, synthFrame, type SynthFrameOptions } from "./testkit";

const SHA_A = "a".repeat(64);
const SHA_B = "0123456789abcdef".repeat(4);

const reference = (over: Partial<Measured> = {}): Measured & { face: FaceReading } => ({
  faceCount: 1,
  face: synthFace(),
  faceFailure: null,
  sharpness: 180,
  skin: { meanLuma: 121, clipRatio: 0.004 },
  ...over,
} as Measured & { face: FaceReading });

async function run(
  at: (t: number) => { h: number; v: number },
  durationSec: number,
  alter?: (t: number) => Partial<SynthFrameOptions> | undefined,
): Promise<Exclude<AnalysisResult, { kind: "cancelled" }>> {
  const res = await analyze({
    reference: synthFace(),
    durationSec,
    measureAt: async (t) => synthFrame({ timeSec: t, dir: at(t), ...alter?.(t) }),
  });
  if (res.kind === "cancelled") throw new Error("취소됨");
  return res;
}

const input = (analysis: PickRecordInput["analysis"], over: Partial<PickRecordInput> = {}): PickRecordInput => ({
  createdAt: "2026-10-02T03:04:05.000Z",
  shotKind: "front",
  reference: { measured: reference(), original: { width: 3024, height: 4032 }, fileSha256: SHA_A },
  video: { native: { width: 1440, height: 1920 }, durationSec: 11, fileModifiedAt: "2026-10-02T03:00:00Z" },
  analysis,
  chosenRank: analysis.kind === "picked" ? 1 : null,
  retakeCount: 0,
  retakeReason: null,
  memo: "3회차 정면",
  files: { originalPngSha256: SHA_B, correctedPngSha256: SHA_A },
  ...over,
});

const sweep = crossSweep();
const closeRun = () => run(sweep.at, sweep.durationSec);
const farRun = () => run(() => ({ h: 6, v: 0 }), 3);
const roundTrip = (r: PickRecord): unknown => JSON.parse(JSON.stringify(r));

describe("buildPickRecord — 기록에 남는 것", () => {
  it("종류·버전·규칙 버전과 경계값 전부가 들어간다", async () => {
    const r = buildPickRecord(input(await closeRun()));
    expect(r.kind).toBe(PICK_RECORD_KIND);
    expect(r.version).toBe(PICK_RECORD_VERSION);
    expect(r.rulesVersion).toBe(RULES_VERSION);
    expect(r.rules).toEqual(rulesSnapshot());
    expect(r.rules.select.passDeg).toBe(3);
    expect(Object.keys(r.rules)).toEqual(Object.keys(RULES));
  });

  it("1등과 후보(최대 4장)의 숫자·판정·보정량·고른 시각이 들어간다", async () => {
    const analysis = await closeRun();
    if (analysis.kind !== "picked") throw new Error("고르지 못함");
    const r = buildPickRecord(input(analysis));
    expect(r.stop).toBeNull();
    expect(r.chosenRank).toBe(1);
    expect(r.candidates).toHaveLength(1 + analysis.runnerUps.length);
    expect(r.candidates.length).toBeLessThanOrEqual(4);
    const first = r.candidates[0];
    expect(first.rank).toBe(1);
    expect(first.verdict).toBe("close");
    expect(first.timeSec).toBe(analysis.winner.measurement.timeSec);
    expect(first.requestedTimeSec).toBe(analysis.winner.measurement.requestedTimeSec);
    expect(first.numbers.angleDeg).toBe(analysis.winner.comparison.angleDeg);
    expect(first.score).toBe(analysis.winner.comparison.score);
    // 보정량: 원본 1440×1920 → 출력 1440×1920, 같은 얼굴이므로 회전 0·배율 1.
    expect(first.correction).not.toBeNull();
    expect(first.correction!.scale).toBeCloseTo(1, 9);
    expect(first.correction!.rotationDeg).toBeCloseTo(0, 9);
    expect(first.correction!.outputWidth).toBe(1440);
    expect(first.correction!.outputHeight).toBe(1920);
  });

  it("뺀 장면 수·잰 장면 수·자취·해상도·해시·메모가 들어간다", async () => {
    const analysis = await run(sweep.at, sweep.durationSec, (t) => (t === 5 ? { clipRatio: 0.5 } : undefined));
    const r = buildPickRecord(input(analysis, { retakeCount: 2, retakeReason: "자세 유지가 어려움" }));
    expect(r.excluded.X4).toBeGreaterThanOrEqual(1);
    expect(r.measured.coarse).toBe(22);
    expect(r.trace.timeSec).toHaveLength(22);
    expect(r.trace.h).toHaveLength(22);
    expect(r.trace.v).toHaveLength(22);
    expect(r.reference).toMatchObject({ width: 3024, height: 4032, measuredWidth: 720, measuredHeight: 960, fileSha256: SHA_A });
    expect(r.reference.anchors).toMatchObject({ count: 16, sufficient: true });
    expect(r.video).toMatchObject({ width: 1440, height: 1920, durationSec: 11, orientation: "portrait" });
    expect(r.files).toEqual({ originalPngSha256: SHA_B, correctedPngSha256: SHA_A });
    expect(r.retakeCount).toBe(2);
    expect(r.retakeReason).toBe("자세 유지가 어려움");
    expect(r.memo).toBe("3회차 정면");
    expect(r.quickAnswer!.answer).toBe("passedNear");
  });

  it("가까운 장면이 없어도 저장된다 — 판정과 W1 이 기록에 남는다", async () => {
    const r = buildPickRecord(input(await farRun(), { retakeCount: 2, retakeReason: "시간 부족" }));
    expect(r.candidates[0].verdict).toBe("notClose");
    expect(r.candidates[0].warnings).toContain("W1");
    expect(r.candidates.every((c) => c.verdict === "notClose")).toBe(true);
  });

  it("사람이 후보로 바꿔 저장하면 그 순위가 남는다", async () => {
    const analysis = await closeRun();
    const r = buildPickRecord(input(analysis, { chosenRank: 2 }));
    expect(r.chosenRank).toBe(2);
    expect(() => buildPickRecord(input(analysis, { chosenRank: 9 }))).toThrow(PickRecordError);
  });

  it("멈춘 분석(S4)도 기록할 수 있다: 후보는 없고 뺀 장면 수가 남는다", async () => {
    const stopped = await run(() => ({ h: 0, v: 0 }), 3, () => ({ failure: "noFace" }));
    const r = buildPickRecord(input(stopped));
    expect(r.stop).toBe("S4");
    expect(r.candidates).toEqual([]);
    expect(r.chosenRank).toBeNull();
    expect(r.excluded).toEqual({ X1: 6, X2: 0, X3: 0, X4: 0, total: 6 });
    expect(validatePickRecord(roundTrip(r)).ok).toBe(true);
  });

  it("재지 못한 값은 0 이 아니라 null 로 들어간다", async () => {
    const r = buildPickRecord(
      input(await closeRun(), {
        reference: { measured: reference({ sharpness: null, skin: null }), original: { width: 3024, height: 4032 }, fileSha256: null },
        files: { originalPngSha256: null, correctedPngSha256: null },
        memo: null,
        video: { native: { width: 1440, height: 1920 }, durationSec: 11, fileModifiedAt: null },
      }),
    );
    expect(r.reference.sharpness).toBeNull();
    expect(r.reference.meanLuma).toBeNull();
    expect(r.reference.clipRatio).toBeNull();
    expect(r.reference.fileSha256).toBeNull();
    expect(r.candidates[0].numbers.referenceSharpness).toBeNull();
    expect(r.candidates[0].numbers.referenceMeanLuma).toBeNull();
    expect(r.video.fileModifiedAt).toBeNull();
    expect(validatePickRecord(roundTrip(r)).ok).toBe(true);
  });
});

describe("기록에 넣지 않는 것", () => {
  it("랜드마크·기준점 좌표·얼굴 박스·이미지는 들어가지 않는다", async () => {
    const r = buildPickRecord(input(await closeRun()));
    const text = JSON.stringify(r);
    for (const key of ['"landmarks"', '"box"', '"view"', '"skinPatch"', '"sharpnessRect"', '"image"', '"fit"', "data:"]) {
      expect(text).not.toContain(key);
    }
    // 기준점은 개수와 퍼짐만 남고 좌표 배열은 없다.
    expect(r.reference.anchors).toEqual({ count: 16, spread: expect.any(Number), sufficient: true });
    // 기준점의 픽셀 좌표가 숫자로 새어 들어가지 않았는지: 첫 기준점의 x 값이 본문에 없다.
    expect(text).not.toContain(String(synthFace().anchors[0].x));
  });

  it("수의 총량은 900개 한도 안이다 — 60초 동영상(자취 120점) + 후보 4장이어도", async () => {
    const long = await run((t) => ({ h: 8 * Math.sin(t / 2), v: 0 }), 90);
    const r = buildPickRecord(input(long, { video: { native: { width: 1440, height: 1920 }, durationSec: 90, fileModifiedAt: null } }));
    expect(r.trace.timeSec).toHaveLength(120);
    expect(r.candidates.length).toBe(4);
    let numbers = 0;
    JSON.stringify(r, (_k, v) => {
      if (typeof v === "number") numbers++;
      return v;
    });
    expect(numbers).toBeLessThanOrEqual(900);
    expect(r.candidates[0].warnings).toContain("W6");
  });
});

describe("validatePickRecord — 고치지 않고 거부한다", () => {
  const good = async () => roundTrip(buildPickRecord(input(await closeRun()))) as Record<string, unknown>;
  const errorsOf = (x: unknown) => {
    const v = validatePickRecord(x);
    return v.ok ? [] : v.errors;
  };

  it("JSON 으로 왕복한 기록은 통과한다", async () => {
    expect(validatePickRecord(await good()).ok).toBe(true);
  });

  it("객체가 아니면 거부", () => {
    expect(validatePickRecord(null).ok).toBe(false);
    expect(validatePickRecord("기록").ok).toBe(false);
    expect(validatePickRecord([]).ok).toBe(false);
  });

  it("필드가 빠지면 거부(기본값으로 채우지 않는다)", async () => {
    const r = await good();
    delete r.excluded;
    expect(errorsOf(r)).toContain("record.excluded: 없음");
    const r2 = await good();
    delete (r2.candidates as Record<string, unknown>[])[0].numbers;
    expect(errorsOf(r2).some((e) => e.includes("candidates[0].numbers: 없음"))).toBe(true);
    const r3 = await good();
    delete ((r3.candidates as Record<string, unknown>[])[0].numbers as Record<string, unknown>).residual;
    expect(errorsOf(r3).some((e) => e.includes("numbers.residual: 없음"))).toBe(true);
  });

  it("모르는 필드는 거부", async () => {
    const r = await good();
    r.patientName = "홍길동";
    expect(errorsOf(r)).toContain("record.patientName: 모르는 필드");
  });

  it("종류·버전이 다르면 읽지 않는다", async () => {
    const r = await good();
    r.version = 2;
    expect(errorsOf(r).some((e) => e.includes("record.version"))).toBe(true);
    const r2 = await good();
    r2.kind = "same-angle-d1-report";
    expect(errorsOf(r2).some((e) => e.includes("record.kind"))).toBe(true);
  });

  it("유한하지 않은 수, 문자열로 된 수는 거부", async () => {
    const r = await good();
    ((r.candidates as Record<string, unknown>[])[0].numbers as Record<string, unknown>).angleDeg = "2.1";
    expect(errorsOf(r).some((e) => e.includes("numbers.angleDeg"))).toBe(true);
    const r2 = await good();
    (r2.reference as Record<string, unknown>).faceShortRatio = Number.NaN;
    expect(errorsOf(r2).some((e) => e.includes("faceShortRatio"))).toBe(true);
  });

  it("랜드마크·이미지 키, data: URL, base64 로 보이는 긴 문자열은 거부", async () => {
    const r = await good();
    (r.reference as Record<string, unknown>).landmarks = [[0.1, 0.2]];
    expect(errorsOf(r).some((e) => e.includes("이미지·랜드마크 키"))).toBe(true);
    const r2 = await good();
    r2.memo = "data:image/png;base64,AAAA";
    expect(errorsOf(r2).some((e) => e.includes("data: URL"))).toBe(true);
    const r3 = await good();
    r3.memo = "A".repeat(300);
    expect(errorsOf(r3).some((e) => e.includes("base64"))).toBe(true);
  });

  it("메모가 너무 길면 거부, 해시가 형식에 맞지 않으면 거부", async () => {
    const r = await good();
    r.memo = "가".repeat(MAX_MEMO_LENGTH + 1);
    expect(errorsOf(r).some((e) => e.includes("record.memo: 너무 김"))).toBe(true);
    const ok = await good();
    ok.memo = "가".repeat(MAX_MEMO_LENGTH);
    expect(validatePickRecord(ok).ok).toBe(true);
    const r2 = await good();
    (r2.files as Record<string, unknown>).originalPngSha256 = "ABC";
    expect(errorsOf(r2).some((e) => e.includes("SHA-256"))).toBe(true);
  });

  it("규칙 값이 하나라도 빠지면 거부(다시 판정할 수 없다)", async () => {
    const r = await good();
    delete ((r.rules as Record<string, unknown>).select as Record<string, unknown>).passDeg;
    expect(errorsOf(r)).toContain("record.rules.select.passDeg: 없음");
  });

  it("모르는 경고 코드·판정·사진 종류는 거부", async () => {
    const r = await good();
    (r.candidates as Record<string, unknown>[])[0].warnings = ["W99"];
    expect(errorsOf(r).some((e) => e.includes("모르는 경고 코드"))).toBe(true);
    const r2 = await good();
    (r2.candidates as Record<string, unknown>[])[0].verdict = "pass";
    expect(errorsOf(r2).some((e) => e.includes("verdict"))).toBe(true);
    const r3 = await good();
    r3.shotKind = "crown";
    expect(errorsOf(r3).some((e) => e.includes("shotKind"))).toBe(true);
  });

  it("앞뒤가 맞지 않는 기록은 거부: 멈췄는데 후보가 있음, 뺀 장면 합이 다름, 자취 길이가 다름", async () => {
    const r = await good();
    r.stop = "S4";
    expect(errorsOf(r).some((e) => e.includes("멈춘 기록"))).toBe(true);
    const r2 = await good();
    (r2.excluded as Record<string, unknown>).total = 99;
    expect(errorsOf(r2)).toContain("record.excluded.total: 사유별 합과 다름");
    const r3 = await good();
    ((r3.trace as Record<string, unknown>).h as number[]).pop();
    expect(errorsOf(r3)).toContain("record.trace: 세 배열의 길이가 다름");
    const r4 = await good();
    r4.candidates = [];
    expect(errorsOf(r4)).toContain("record.candidates: 후보가 없음");
  });

  it("만들 때도 같은 검사를 거친다: 날짜 형식이 틀리면 예외", async () => {
    const analysis = await closeRun();
    expect(() => buildPickRecord(input(analysis, { createdAt: "2026-10-02 12:00" }))).toThrow(PickRecordError);
    expect(() => buildPickRecord(input(analysis, { retakeCount: -1 }))).toThrow(PickRecordError);
    expect(() => buildPickRecord(input(analysis, { shotKind: "crown" as never }))).toThrow(PickRecordError);
  });
});

describe("rejudge — 내보낸 기록을 다시 읽으면 같은 판정과 경고가 나온다", () => {
  it("가까운 장면", async () => {
    const built = buildPickRecord(input(await closeRun()));
    const v = validatePickRecord(roundTrip(built));
    if (!v.ok) throw new Error(v.errors.join(" / "));
    const again = rejudge(v.record);
    expect(again).toHaveLength(built.candidates.length);
    again.forEach((a, i) => {
      expect(a.matchesRecord).toBe(true);
      expect(a.judgement.verdict).toBe(built.candidates[i].verdict);
      expect(a.judgement.warnings).toEqual(built.candidates[i].warnings);
    });
  });

  it("가까운 장면 없음 + 경고 여럿", async () => {
    const analysis = await run(
      () => ({ h: 5, v: 0 }),
      70,
      () => ({ rollDeg: 8, size: 0.6, shift: { x: 60, y: 0 }, meanLuma: 200 }),
    );
    const built = buildPickRecord(
      input(analysis, { video: { native: { width: 1280, height: 720 }, durationSec: 70, fileModifiedAt: null } }),
    );
    const first = built.candidates[0];
    expect(first.verdict).toBe("notClose");
    for (const w of ["W1", "W12", "W11", "W2", "W9", "W4", "W6"]) expect(first.warnings).toContain(w);
    const v = validatePickRecord(roundTrip(built));
    if (!v.ok) throw new Error(v.errors.join(" / "));
    for (const a of rejudge(v.record)) expect(a.matchesRecord).toBe(true);
    expect(rejudge(v.record)[0].judgement).toEqual({ verdict: first.verdict, warnings: first.warnings });
  });

  it("기록에 적힌 규칙 값으로 판정한다: 그때 통과 기준이 5° 였으면 4° 는 지금도 가까운 장면이다", async () => {
    const loose = { ...RULES, select: { ...RULES.select, passDeg: 5 } };
    const analysis = await analyze({
      reference: synthFace(),
      durationSec: 3,
      measureAt: async (t) => synthFrame({ timeSec: t, dir: { h: 4, v: 0 } }),
      rules: loose,
    });
    if (analysis.kind !== "picked") throw new Error("고르지 못함");
    const built = buildPickRecord(input(analysis, { rules: loose, video: { native: { width: 1440, height: 1920 }, durationSec: 3, fileModifiedAt: null } }));
    expect(built.candidates[0].verdict).toBe("close");
    const again = rejudge(JSON.parse(JSON.stringify(built)) as PickRecord);
    expect(again[0].judgement.verdict).toBe("close");
    expect(again[0].matchesRecord).toBe(true);
    // 지금 코드의 기준(3°)으로 판정하면 다르다 — 그래서 기록의 값을 쓴다.
    expect(judge(built.candidates[0].numbers).verdict).toBe("notClose");
  });

  it("기록의 판정을 손으로 고치면 드러난다", async () => {
    const built = buildPickRecord(input(await farRun()));
    const tampered = JSON.parse(JSON.stringify(built)) as PickRecord;
    tampered.candidates[0].verdict = "close";
    tampered.candidates[0].warnings = [];
    expect(validatePickRecord(tampered).ok).toBe(true); // 형식은 맞다
    const again = rejudge(tampered);
    expect(again[0].matchesRecord).toBe(false);
    expect(again[0].judgement.verdict).toBe("notClose");
    expect(again[0].judgement.warnings).toContain("W1");
  });
});

describe("pickRecordFileName", () => {
  it("same-angle-pick-YYYYMMDD-HHmm.json", () => {
    expect(pickRecordFileName(new Date(2026, 9, 2, 9, 5))).toBe("same-angle-pick-20261002-0905.json");
  });
});
