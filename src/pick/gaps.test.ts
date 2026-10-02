import { describe, expect, it } from "vitest";
import { compareToReference } from "./compare";
import type { FaceReading, FrameMeasurement, Measured } from "./measure";
import { ANCHOR_INDICES, readFaces } from "./measure";
import { outputTransform, qualityScaleOf } from "./output";
import { analyze, type AnalysisResult, type ScanPhase } from "./pipeline";
import { fineCenters } from "./plan";
import { buildPickRecord, rejudge, type PickRecord, type PickRecordInput } from "./record";
import { RULES } from "./rules";
import { pickRunnerUps } from "./select";
import { IDENTITY, fitSimilarity } from "./similarity";
import { I3, synthFace, synthFrame, syntheticFace, type SynthFrameOptions } from "./testkit";

/*
 * 변이 시험(일부러 결함을 넣어 보기)에서 살아남은 변이를 잡으려고 더한 시험. 전부 합성 값이다.
 * 각 시험 제목 끝의 [기호]는 잡으려는 변이다.
 */

describe("고르기 — 경계", () => {
  it("차점 후보 간격: 정확히 0.3초 떨어진 장면은 담고, 0.29초는 담지 않는다 [S09]", () => {
    const w = { timeSec: 0, angleDeg: 0, score: 0, sharpness: 100 };
    const at = { timeSec: RULES.select.runnerUpMinGapSec, angleDeg: 1, score: 1, sharpness: 100 };
    const near = { ...at, timeSec: 0.29 };
    expect(pickRunnerUps([w, at], w)).toEqual([at]);
    expect(pickRunnerUps([w, near], w)).toEqual([]);
  });

  it("촘촘히 훑을 곳은 점수가 아니라 각도차 순서로 고른다 [L03]", () => {
    // 0초 장면이 각도차는 작고 점수는 크다(기울기·크기 감점). 두 장면은 0.75초 안이라 하나만 남는다.
    const hits = [
      { timeSec: 0, angleDeg: 1, score: 9 },
      { timeSec: 0.5, angleDeg: 2, score: 3 },
    ];
    expect(fineCenters(hits)).toEqual([0]);
  });
});

describe("견주기 — 단위", () => {
  it("남는 오차는 기준 사진의 눈 사이 거리 단위다: 장면이 절반 크기로 찍혀도 값이 같다 [C06]", () => {
    const ref = synthFace();
    const wobble = (k: number) => (i: number) => ({ x: (i % 2 ? 4 : -4) * k, y: (i % 3 ? -3 : 3) * k });
    const full = compareToReference(ref, synthFace({ jitter: wobble(1) }))!;
    const half = compareToReference(ref, synthFace({ size: 0.5, jitter: wobble(0.5) }))!;
    expect(full.residual).toBeGreaterThan(0.01);
    expect(half.residual).toBeCloseTo(full.residual, 9);
  });

  it("출력 비는 기준 사진을 잰 캔버스의 긴 변으로 정한다(작은 기준 사진) [O06]", () => {
    // 기준 사진 600×800 은 줄이지 않고 그대로 잰다(긴 변 800). 장면은 1080×1920 → 540×960.
    const t = outputTransform({
      fit: IDENTITY,
      referenceMeasured: { width: 600, height: 800 },
      frameMeasured: { width: 540, height: 960 },
      frameNative: { width: 1080, height: 1920 },
      output: { width: 600, height: 800 },
    });
    // 원본 → 재는 캔버스 0.5배, 맞춤 1배, 재는 캔버스 → 출력 1배.
    expect(qualityScaleOf(t)).toBeCloseTo(0.5, 12);
  });
});

describe("읽을 수 없는 입력", () => {
  it("기준점이 거의 한 점에 몰리면(0 은 아님) 맞춤을 구하지 않는다 [M08]", () => {
    const from = [
      { x: 10, y: 10 },
      { x: 10 + 1e-7, y: 10 },
      { x: 10, y: 10 + 1e-7 },
    ];
    const to = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(fitSimilarity(from, to)).toBeNull();
  });

  it("두 눈 중심이 겹치면(눈 사이 거리 0) landmarksUnreadable [A11]", () => {
    const frame = { width: 720, height: 960 };
    const f = syntheticFace({ R: I3, t: [0, 0, -50] }, frame, 1000);
    const eyes: number[] = [
      ANCHOR_INDICES.rightEyeOuter,
      ANCHOR_INDICES.rightEyeInner,
      ANCHOR_INDICES.leftEyeInner,
      ANCHOR_INDICES.leftEyeOuter,
    ];
    const one = f.landmarks[ANCHOR_INDICES.rightEyeOuter];
    const landmarks = f.landmarks.map((p, i) => (eyes.includes(i) ? { ...one } : p));
    expect(readFaces([{ ...f, landmarks }], frame)).toMatchObject({ ok: false, failure: "landmarksUnreadable" });
  });
});

describe("분석 순서 — 다시 재기·자취·제외 수", () => {
  const at = (t: number) => ({ h: -10 + 5 * t, v: 0 });

  it("다시 잴 때는 처음 요청한 시각으로 간다(브라우저가 알려 준 시각이 달라도) [P05]", async () => {
    const calls: { t: number; phase: ScanPhase }[] = [];
    const r = await analyze({
      reference: synthFace(),
      durationSec: 4,
      measureAt: async (t, phase): Promise<FrameMeasurement> => {
        calls.push({ t, phase });
        return { ...synthFrame({ timeSec: t, dir: at(t) }), timeSec: t + 0.02, requestedTimeSec: t, timeIsReported: true };
      },
    });
    expect(r.kind).toBe("picked");
    const asked = new Set(calls.filter((c) => c.phase !== "remeasure").map((c) => c.t));
    const again = calls.filter((c) => c.phase === "remeasure").map((c) => c.t);
    expect(again.length).toBeGreaterThan(0);
    for (const t of again) expect(asked.has(t)).toBe(true);
  });

  it("자취: 얼굴은 읽었지만 뺀 장면은 usable 이 false 다 [P08]", async () => {
    const r = await analyze({
      reference: synthFace(),
      durationSec: 4,
      measureAt: async (t) => synthFrame({ timeSec: t, dir: at(t), ...(t === 1 ? { clipRatio: 0.5 } : {}) }),
    });
    if (r.kind !== "picked") throw new Error("고르지 못함");
    expect(r.trace.find((p) => p.timeSec === 1)?.usable).toBe(false);
    expect(r.trace.filter((p) => !p.usable)).toHaveLength(1);
  });

  it("기준점을 맞출 수 없는 장면은 X1 로 세어진다(조용히 사라지지 않는다) [P09]", async () => {
    const r = await analyze({
      reference: synthFace(),
      durationSec: 4,
      measureAt: async (t) => {
        const f = synthFrame({ timeSec: t, dir: at(t) });
        if (t === 1 && f.face) f.face.anchors = f.face.anchors.map(() => ({ x: 5, y: 5 }));
        return f;
      },
    });
    if (r.kind !== "picked") throw new Error("고르지 못함");
    expect(r.excluded.X1).toBe(1);
    expect(r.excluded.total).toBe(1);
  });
});

describe("기록 — 다시 잰 값과 보정량", () => {
  const SHA = "a".repeat(64);
  const reference = (): Measured & { face: FaceReading } => ({
    faceCount: 1,
    face: synthFace(),
    faceFailure: null,
    sharpness: 180,
    skin: { meanLuma: 121, clipRatio: 0.004 },
  });
  const input = (analysis: PickRecordInput["analysis"], over: Partial<PickRecordInput> = {}): PickRecordInput => ({
    createdAt: "2026-10-02T03:04:05.000Z",
    shotKind: "front",
    reference: { measured: reference(), original: { width: 3024, height: 4032 }, fileSha256: SHA },
    video: { native: { width: 1440, height: 1920 }, durationSec: 4, fileModifiedAt: null },
    analysis,
    chosenRank: analysis.kind === "picked" ? 1 : null,
    retakeCount: 0,
    retakeReason: null,
    memo: null,
    files: { originalPngSha256: SHA, correctedPngSha256: SHA },
    ...over,
  });
  const run = async (
    alter: (t: number, phase: ScanPhase) => Partial<SynthFrameOptions> & { reportedShift?: number },
  ): Promise<Extract<AnalysisResult, { kind: "picked" }>> => {
    const r = await analyze({
      reference: synthFace(),
      durationSec: 4,
      measureAt: async (t, phase) => {
        const { reportedShift, ...o } = alter(t, phase);
        const f = synthFrame({ timeSec: t, dir: { h: -10 + 5 * t, v: 0 }, ...o });
        return reportedShift ? { ...f, timeSec: t + reportedShift, timeIsReported: true } : f;
      },
    });
    if (r.kind !== "picked") throw new Error("고르지 못함");
    return r;
  };

  it("고른 시각과 점수는 다시 잰 값이고, 분석 때 값은 analysis 에 따로 남는다 [R04·R11]", async () => {
    // 다시 잴 때만 장면 시각이 0.02초 밀리고 기울기가 4° 달라진다(점수 +0.4).
    const a = await run((_t, phase) => (phase === "remeasure" ? { reportedShift: 0.02, rollDeg: 4 } : {}));
    const w = a.winner;
    expect(w.measurement.timeSec).not.toBe(w.analysis.timeSec);
    expect(w.comparison.score).not.toBe(w.analysis.score);
    const c = buildPickRecord(input(a)).candidates[0];
    expect(c.timeSec).toBe(w.measurement.timeSec);
    expect(c.score).toBe(w.comparison.score);
    expect(c.analysis.timeSec).toBe(w.analysis.timeSec);
    expect(c.analysis.score).toBe(w.analysis.score);
  });

  it("보정량: 10° 기울고 0.8배로 찍힌 720×960 동영상 → 회전 −10°, 배율 2.5(화질 배율과 같다) [R05·R08]", async () => {
    const a = await run(() => ({ rollDeg: 10, size: 0.8 }));
    const r = buildPickRecord(input(a, { video: { native: { width: 720, height: 960 }, durationSec: 4, fileModifiedAt: null } }));
    const c = r.candidates[0];
    // 원본 → 재는 캔버스 1배, 맞춤 1.25배·−10°, 재는 캔버스(960) → 출력(1920) 2배.
    expect(c.correction!.rotationDeg).toBeCloseTo(-10, 6);
    expect(c.correction!.scale).toBeCloseTo(2.5, 6);
    expect(c.correction!.scale).toBeCloseTo(c.numbers.qualityScale!, 12);
    expect(c.warnings).toContain("W2");
  });

  it("다시 판정: 가까움 판정만 고친 기록은 '기록과 다름'으로 잡힌다 [R02]", async () => {
    const a = await run(() => ({}));
    const record = buildPickRecord(input(a));
    const tampered = JSON.parse(JSON.stringify(record)) as PickRecord;
    expect(tampered.candidates[0].verdict).toBe("close");
    tampered.candidates[0].verdict = "notClose";
    expect(rejudge(tampered)[0].matchesRecord).toBe(false);
    expect(rejudge(record)[0].matchesRecord).toBe(true);
  });
});
