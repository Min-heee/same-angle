import { describe, expect, it } from "vitest";
import { analyzePhotos } from "./burst";
import type { FaceReading, FrameSize, Measured } from "./measure";
import { analyze, type AnalysisResult } from "./pipeline";
import {
  PHOTO_PICK_RECORD_KIND,
  PHOTO_PICK_RECORD_VERSION,
  PICK_RECORD_KIND,
  PICK_RECORD_VERSION,
  PickRecordError,
  buildPhotoPickRecord,
  buildPickRecord,
  rejudge,
  validatePhotoPickRecord,
  validatePickRecord,
  type PhotoPickRecord,
  type PhotoPickRecordInput,
} from "./record";
import { RULES, RULES_VERSION } from "./rules";
import { synthFace, synthFrame, type SynthFrameOptions } from "./testkit";

/*
 * 사진 여러 장에서 고른 기록(PRD v0.3.1 5절 "기록에 남는 것"). 합성 데이터다.
 * 핵심은 둘이다: 입력 종류·장수·고른 순번이 남는가, **파일 이름이 어디에도 없는가.**
 */

const SHA_A = "a".repeat(64);
const SHA_B = "0123456789abcdef".repeat(4);
const SHA_C = "c".repeat(64);
const SIZE: FrameSize = { width: 6000, height: 4000 };

const reference = (): Measured & { face: FaceReading } =>
  ({ faceCount: 1, face: synthFace(), faceFailure: null, sharpness: 180, skin: { meanLuma: 121, clipRatio: 0.004 } }) as Measured & {
    face: FaceReading;
  };

type Spec = (Partial<Omit<SynthFrameOptions, "timeSec">> & { photoSize?: FrameSize }) | null;

async function run(specs: readonly Spec[]): Promise<Exclude<AnalysisResult, { kind: "cancelled" }>> {
  const res = await analyzePhotos({
    reference: synthFace(),
    count: specs.length,
    measurePhoto: async (n) => {
      const spec = specs[n - 1];
      if (spec === null) return null;
      const { photoSize, ...frame } = spec;
      return { measured: synthFrame({ timeSec: n, ...frame }), size: photoSize ?? SIZE };
    },
  });
  if (res.kind === "cancelled") throw new Error("취소됨");
  return res;
}

const input = (analysis: PhotoPickRecordInput["analysis"], over: Partial<PhotoPickRecordInput> = {}): PhotoPickRecordInput => ({
  createdAt: "2026-10-02T03:04:05.000Z",
  shotKind: "front",
  reference: { measured: reference(), original: { width: 6000, height: 4000 }, fileSha256: SHA_A },
  photos: { selected: 5, chosenFileSha256: SHA_C },
  analysis,
  chosenRank: analysis.kind === "picked" ? 1 : null,
  retakeCount: 0,
  retakeReason: null,
  memo: "3회차 정면",
  files: { originalPngSha256: SHA_B, correctedPngSha256: SHA_A },
  ...over,
});

const FIVE: Spec[] = [{ dir: { h: 6, v: 0 } }, null, { dir: { h: 0.3, v: 0 } }, { dir: { h: 2, v: 0 }, photoSize: { width: 3000, height: 2000 } }, { dir: { h: 4, v: 0 } }];
const roundTrip = (r: PhotoPickRecord): unknown => JSON.parse(JSON.stringify(r));

describe("buildPhotoPickRecord — 기록에 남는 것", () => {
  it("입력 종류(photos)·장수·고른 순번이 남는다", async () => {
    const r = buildPhotoPickRecord(input(await run(FIVE)));
    expect(r.kind).toBe(PHOTO_PICK_RECORD_KIND);
    expect(r.version).toBe(PHOTO_PICK_RECORD_VERSION);
    expect(r.source).toBe("photos");
    expect(r.rulesVersion).toBe(RULES_VERSION);
    expect(r.photos).toEqual({
      selected: 5,
      used: 5,
      unreadable: 1,
      sizeMismatch: 1,
      commonWidth: 6000,
      commonHeight: 4000,
      chosenNumber: 3,
      chosenFileSha256: SHA_C,
    });
    expect(r.measured).toEqual({ photos: 4, remeasure: r.candidates.length });
    expect(r.stop).toBeNull();
    expect(r.chosenRank).toBe(1);
  });

  it("후보마다 순번과 그 사진의 원본 크기가 남고, 동영상의 시각·길이 칸은 없다", async () => {
    const r = buildPhotoPickRecord(input(await run(FIVE)));
    expect(r.candidates.map((c) => c.photoNumber)).toEqual([3, 4, 5, 1]);
    expect(r.candidates[0]).toMatchObject({ rank: 1, width: 6000, height: 4000, verdict: "close" });
    expect(r.candidates[1]).toMatchObject({ photoNumber: 4, width: 3000, height: 2000 });
    for (const c of r.candidates) {
      expect(Object.keys(c)).not.toContain("timeSec");
      expect(Object.keys(c)).not.toContain("requestedTimeSec");
      // 길이가 없다. 0 으로 채우지 않고 null 로 적는다.
      expect(c.numbers.videoDurationSec).toBeNull();
      expect(c.warnings).not.toContain("W6");
    }
    expect(Object.keys(r)).not.toContain("video");
    expect(Object.keys(r)).not.toContain("quickAnswer");
  });

  it("자취는 얼굴을 읽은 사진의 순번과 보는 방향 2값이다", async () => {
    const r = buildPhotoPickRecord(input(await run(FIVE)));
    expect(r.trace.photoNumber).toEqual([1, 3, 4, 5]);
    expect(r.trace.h).toHaveLength(4);
    expect(r.trace.v).toHaveLength(4);
    expect(r.trace.h[1]).toBeCloseTo(0.3, 9);
  });

  it("보정량은 후보마다 그 사진의 원본 크기로 센다(작은 사진은 더 늘려 그린다)", async () => {
    const r = buildPhotoPickRecord(input(await run(FIVE)));
    const big = r.candidates.find((c) => c.photoNumber === 3)!;
    const small = r.candidates.find((c) => c.photoNumber === 4)!;
    expect(small.correction!.scale).toBeCloseTo(big.correction!.scale * 2, 9);
    // 보정본의 긴 변은 기준 사진(6000)과 4096 가운데 작은 쪽이다.
    expect(big.correction).toMatchObject({ outputWidth: 4096, outputHeight: 2731 });
    expect(big.numbers.qualityScale).toBeLessThan(1);
  });

  it("사람이 후보로 바꾸면 고른 순번도 그 후보의 순번이다", async () => {
    const r = buildPhotoPickRecord(input(await run(FIVE), { chosenRank: 2 }));
    expect(r.chosenRank).toBe(2);
    expect(r.photos.chosenNumber).toBe(4);
  });

  it("멈춘 기록(S4·S6)에는 후보와 고른 순번이 없고, 읽지 못한 수는 남는다", async () => {
    const s6 = buildPhotoPickRecord(input(await run([null, null]), { photos: { selected: 2, chosenFileSha256: null } }));
    expect(s6).toMatchObject({ stop: "S6", chosenRank: null, candidates: [], photos: { used: 2, unreadable: 2, chosenNumber: null, commonWidth: null } });
    const s4 = buildPhotoPickRecord(input(await run([{ failure: "noFace" }, null]), { photos: { selected: 2, chosenFileSha256: SHA_C } }));
    expect(s4).toMatchObject({ stop: "S4", excluded: { X1: 1, total: 1 }, photos: { unreadable: 1, chosenNumber: null } });
    // 멈췄으면 고른 파일도 없다. 넘겨받은 해시를 적지 않는다.
    expect(s4.photos.chosenFileSha256).toBeNull();
  });

  it("상한을 넘겨 고른 묶음: 고른 수와 본 수가 따로 남는다", async () => {
    const many = Array.from({ length: 60 }, (_, i): Spec => ({ dir: { h: 1 + i * 0.1, v: 0 } }));
    const r = buildPhotoPickRecord(input(await run(many), { photos: { selected: 72, chosenFileSha256: SHA_C } }));
    expect(r.photos).toMatchObject({ selected: 72, used: 60 });
    expect(r.trace.photoNumber).toHaveLength(60);
    // 기록 전체가 검사기의 총량 한도 안이다.
    expect(validatePhotoPickRecord(roundTrip(r)).ok).toBe(true);
  });

  it("동영상 분석을 넣으면 거부한다(사진 묶음 정보가 없다)", async () => {
    const video = await analyze({ reference: synthFace(), durationSec: 2, measureAt: async (t) => synthFrame({ timeSec: t }) });
    if (video.kind === "cancelled") throw new Error("취소됨");
    expect(() => buildPhotoPickRecord(input(video))).toThrow(PickRecordError);
  });
});

describe("사진 기록 — 파일 이름이 없다", () => {
  it("빌더는 파일 이름을 받는 칸이 없고, 기록의 어느 칸에도 이름을 담을 자리가 없다", async () => {
    const r = buildPhotoPickRecord(input(await run(FIVE)));
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          walk(x);
        }
      }
    };
    walk(r);
    for (const k of keys) expect(k).not.toMatch(/name|path|title|label/i);
    // "file" 이 들어간 칸은 해시를 담는 칸뿐이다.
    expect([...keys].filter((k) => /file/i.test(k)).sort()).toEqual(["chosenFileSha256", "fileSha256", "files"]);
    // 글자가 들어가는 칸은 종류·버전·날짜·사진 종류·판정·경고·해시·메모뿐이다.
    const strings: string[] = [];
    const collect = (v: unknown) => {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === "object") Object.values(v).forEach(collect);
    };
    collect({ ...r, memo: null, retakeReason: null });
    for (const str of strings) expect(str).not.toMatch(/\.(jpe?g|png|heic|cr[23]|nef|arw)$/i);
  });

  it("이름처럼 보이는 칸을 끼워 넣은 기록은 검사에서 거부한다", async () => {
    const r = roundTrip(buildPhotoPickRecord(input(await run(FIVE)))) as Record<string, unknown>;
    const withName = { ...r, photos: { ...(r.photos as object), chosenName: "홍길동_0003.JPG" } };
    const res = validatePhotoPickRecord(withName);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toContain("record.photos.chosenName: 모르는 필드");
    const cand = (r.candidates as Record<string, unknown>[]).map((c) => ({ ...c, fileName: "IMG_0003.JPG" }));
    expect(validatePhotoPickRecord({ ...r, candidates: cand }).ok).toBe(false);
  });
});

describe("validatePhotoPickRecord · rejudge", () => {
  it("내보낸 기록을 다시 읽으면 검사를 통과하고, 같은 가까움 판정과 경고가 나온다", async () => {
    const built = buildPhotoPickRecord(input(await run(FIVE)));
    const res = validatePhotoPickRecord(roundTrip(built));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const again = rejudge(res.record);
    expect(again).toHaveLength(built.candidates.length);
    for (const a of again) expect(a.matchesRecord).toBe(true);
    expect(again.map((a) => a.judgement.verdict)).toEqual(built.candidates.map((c) => c.verdict));
  });

  it("가까운 사진이 없는 묶음의 기록도 다시 읽으면 '가까운 장면 없음'(W1)이다", async () => {
    const far = buildPhotoPickRecord(input(await run([{ dir: { h: 5, v: 0 } }, { dir: { h: 7, v: 0 } }]), { retakeReason: "시간 부족" }));
    expect(far.candidates[0].verdict).toBe("notClose");
    expect(far.candidates[0].warnings).toContain("W1");
    for (const a of rejudge(far)) expect(a.matchesRecord).toBe(true);
  });

  it("동영상 기록과 사진 기록은 서로의 검사기를 통과하지 못한다(종류가 다르다)", async () => {
    const photo = roundTrip(buildPhotoPickRecord(input(await run(FIVE))));
    expect(validatePickRecord(photo).ok).toBe(false);
    const analysis = await analyze({ reference: synthFace(), durationSec: 2, measureAt: async (t) => synthFrame({ timeSec: t }) });
    if (analysis.kind === "cancelled") throw new Error("취소됨");
    const video = buildPickRecord({
      createdAt: "2026-10-02T03:04:05.000Z",
      shotKind: "front",
      reference: { measured: reference(), original: { width: 3024, height: 4032 }, fileSha256: SHA_A },
      video: { native: { width: 1440, height: 1920 }, durationSec: 2, fileModifiedAt: null },
      analysis,
      chosenRank: analysis.kind === "picked" ? 1 : null,
      retakeCount: 0,
      retakeReason: null,
      memo: null,
      files: { originalPngSha256: SHA_B, correctedPngSha256: SHA_A },
    });
    expect(validatePhotoPickRecord(JSON.parse(JSON.stringify(video))).ok).toBe(false);
    // 동영상 기록의 형식은 그대로다: 종류·버전이 같고, 사진 쪽 칸이 끼어들지 않았다.
    expect(video.kind).toBe(PICK_RECORD_KIND);
    expect(video.version).toBe(PICK_RECORD_VERSION);
    expect(PICK_RECORD_VERSION).toBe(1);
    expect(Object.keys(video)).not.toContain("source");
    expect(Object.keys(video)).not.toContain("photos");
    expect(Object.keys(video.candidates[0])).not.toContain("photoNumber");
    expect(typeof video.candidates[0].numbers.videoDurationSec).toBe("number");
  });

  it("규칙 값에는 사진 묶음의 값(상한 60장, 크기 0장, 긴 변 4096px)이 함께 들어간다", async () => {
    const r = buildPhotoPickRecord(input(await run(FIVE)));
    expect(r.rules.photos).toEqual({ maxCount: 60, maxSizeMismatch: 0, outputMaxLongSidePx: 4096 });
    expect(Object.keys(r.rules)).toEqual(Object.keys(RULES));
  });

  const broken: [string, (r: Record<string, unknown>) => void, string][] = [
    ["입력 종류가 다름", (r) => void (r.source = "video"), 'record.source: "photos" 가 아님'],
    ["장수 칸 누락", (r) => void delete (r.photos as Record<string, unknown>).unreadable, "record.photos.unreadable: 없음"],
    ["본 수가 고른 수보다 많음", (r) => void ((r.photos as Record<string, unknown>).used = 9), "record.photos.used: 고른 수보다 많음"],
    ["읽지 못한 수가 본 수보다 많음", (r) => void ((r.photos as Record<string, unknown>).unreadable = 6), "record.photos.unreadable: 본 수보다 많음"],
    ["고른 순번이 후보의 순번과 다름", (r) => void ((r.photos as Record<string, unknown>).chosenNumber = 5), "record.photos.chosenNumber: 저장한 후보의 순번과 다름"],
    ["순번이 0", (r) => void ((r.candidates as Record<string, unknown>[])[1].photoNumber = 0), "photoNumber: 1 이상이어야 함"],
    ["순번이 정수가 아님", (r) => void ((r.candidates as Record<string, unknown>[])[1].photoNumber = 2.5), "photoNumber: 0 이상의 정수가 아님"],
    ["사진 크기가 0", (r) => void ((r.candidates as Record<string, unknown>[])[0].width = 0), "width: 0 보다 커야 함"],
    [
      "길이를 0 으로 채움",
      (r) => void (((r.candidates as Record<string, unknown>[])[0].numbers as Record<string, unknown>).videoDurationSec = 0),
      "videoDurationSec: 사진 기록에서는 null 이어야 함",
    ],
    ["해시가 해시가 아님", (r) => void ((r.photos as Record<string, unknown>).chosenFileSha256 = "IMG_0003.JPG"), "chosenFileSha256: SHA-256"],
    ["자취의 길이가 다름", (r) => void (r.trace as Record<string, number[]>).h.pop(), "record.trace: 세 배열의 길이가 다름"],
    ["동영상의 자취 칸", (r) => void ((r.trace as Record<string, unknown>).timeSec = []), "record.trace.timeSec: 모르는 필드"],
    ["모르는 멈춤 코드", (r) => void (r.stop = "S3"), "record.stop: S4/S6 중 하나가 아님"],
    ["버전이 다름", (r) => void (r.version = 2), "record.version: 1 이 아님"],
  ];

  it.each(broken)("거부: %s", async (_name, mutate, message) => {
    const r = roundTrip(buildPhotoPickRecord(input(await run(FIVE)))) as Record<string, unknown>;
    mutate(r);
    const res = validatePhotoPickRecord(r);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" / ")).toContain(message);
  });
});
