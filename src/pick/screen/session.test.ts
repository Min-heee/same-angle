import { describe, expect, it } from "vitest";
import { rejudge, validatePickRecord, type PickRecord } from "../record";
import { RULES_VERSION } from "../rules";
import { BAND_NOTICE } from "./exportplan";
import {
  fakeBrowser,
  leakedUrls,
  namedError,
  referenceFailed,
  referenceMeasured,
  sha256Hex,
  type FakeOptions,
} from "./fakes";
import { pickedOf, retakeCountOf, type PickState } from "./flow";
import { createPickSession } from "./session";

/*
 * 접착부 시험: 브라우저가 하는 일(파일·모델·장면·그림·해시)을 전부 가짜로 넣고 흐름을 끝까지 돌린다.
 * 측정값은 합성이고 분석은 진짜 엔진이 돈다. **실제 브라우저·실제 얼굴에서의 동작은 확인하지 못한다.**
 */

const PHOTO = new Blob(["기준 사진(가짜 바이트)"], { type: "image/jpeg" });
const VIDEO = new Blob(["동영상(가짜 바이트)"], { type: "video/mp4" });
const videoFile = (lastModified?: number) => Object.assign(new Blob(["v"], { type: "video/mp4" }), { lastModified });

function start(opts: FakeOptions = {}) {
  const { deps, log } = fakeBrowser(opts);
  const session = createPickSession(deps);
  const history: PickState[] = [];
  session.subscribe(() => history.push(session.getState()));
  return { session, log, history, state: () => session.getState() };
}

/** 기준 사진 → 동영상까지 끝낸 상태. */
async function analyzed(opts: FakeOptions = {}) {
  const t = start(opts);
  await t.session.chooseReference(PHOTO);
  t.session.goToVideo();
  await t.session.chooseVideo(VIDEO);
  return t;
}

async function readRecord(t: Awaited<ReturnType<typeof analyzed>>, blobs: Map<string, Blob>): Promise<PickRecord> {
  const s = t.state();
  if (s.exportState.status !== "ready") throw new Error(`저장 파일이 준비되지 않음: ${s.exportState.status}`);
  const file = s.exportState.files.find((f) => f.kind === "record")!;
  const parsed: unknown = JSON.parse(await blobs.get(file.url)!.text());
  const v = validatePickRecord(parsed);
  if (!v.ok) throw new Error(v.errors.join(" / "));
  return v.record;
}

/** 저장 파일의 내용을 주소로 찾을 수 있게 가짜 urlFor 를 감싼다. */
function captureBlobs(opts: FakeOptions = {}) {
  const fake = fakeBrowser(opts);
  const blobs = new Map<string, Blob>();
  const urlFor = fake.deps.urlFor;
  fake.deps.urlFor = (blob) => {
    const u = urlFor(blob);
    blobs.set(u, blob);
    return u;
  };
  const session = createPickSession(fake.deps);
  return { session, log: fake.log, blobs, state: () => session.getState(), history: [] as PickState[] };
}

async function analyzedWithBlobs(opts: FakeOptions = {}) {
  const t = captureBlobs(opts);
  await t.session.chooseReference(PHOTO);
  t.session.goToVideo();
  await t.session.chooseVideo(VIDEO);
  return t;
}

describe("기준 사진", () => {
  it("얼굴을 읽으면 준비됨: 크기·해시·미리보기가 들어가고, 모델을 한 번 받는다", async () => {
    const t = start();
    await t.session.chooseReference(PHOTO);
    const s = t.state();
    expect(s.step).toBe("reference");
    expect(s.reference.status).toBe("ready");
    if (s.reference.status !== "ready") return;
    expect(s.reference.info).toMatchObject({ width: 3024, height: 4032 });
    expect(s.reference.info.fileSha256).toBe(sha256Hex(await PHOTO.arrayBuffer()));
    expect(s.reference.info.previewUrl).toMatch(/^blob:fake\/preview\//);
    expect(t.log.modelLoads).toBe(1);
    // 읽는 동안 '읽는 중'과 모델 진행 문장이 화면에 닿았다.
    expect(t.history.some((h) => h.reference.status === "reading" && h.modelMessage !== null)).toBe(true);
    expect(s.modelMessage).toBeNull();
  });

  it.each([
    ["얼굴 없음(정수리 등)", "noFace", "S1"],
    ["얼굴이 둘", "multipleFaces", "S2"],
    ["얼굴은 있지만 방향을 못 읽음", "matrixUnreadable", "S1"],
  ] as const)("%s → %s 로 멈추고, 연 사진을 닫고, 다음 단계로 못 간다", async (_name, failure, code) => {
    const t = start({ reference: () => referenceFailed(failure) });
    await t.session.chooseReference(PHOTO);
    const s = t.state();
    expect(s.reference).toMatchObject({ status: "failed", failure: { kind: "stop", code, reason: failure } });
    expect(t.log.referencesClosed).toBe(t.log.referencesOpened);
    t.session.goToVideo();
    expect(t.state().step).toBe("reference");
  });

  it("파일을 열 수 없으면 S5 이고 모델을 받으러 가지 않는다", async () => {
    const t = start({ referenceUnreadable: true });
    await t.session.chooseReference(PHOTO);
    expect(t.state().reference).toMatchObject({ status: "failed", failure: { kind: "stop", code: "S5" } });
    expect(t.log.modelLoads).toBe(0);
  });

  it("모델을 받지 못하면 그 이유로 멈추고, 같은 사진으로 다시 하면 된다", async () => {
    let fail = true;
    const t = start({ modelFails: () => fail });
    await t.session.chooseReference(PHOTO);
    expect(t.state().reference).toMatchObject({ status: "failed", failure: { kind: "model" } });
    expect(t.log.referencesClosed).toBe(1);
    fail = false;
    await t.session.retryReference();
    expect(t.state().reference.status).toBe("ready");
    expect(t.log.modelLoads).toBe(2);
  });

  it("사진을 바꾸면 예전 사진과 그 미리보기를 놓는다", async () => {
    const t = start();
    await t.session.chooseReference(PHOTO);
    const first = t.state().reference.status === "ready" ? t.state().reference : null;
    await t.session.chooseReference(new Blob(["다른 사진"]));
    expect(t.log.referencesOpened).toBe(2);
    expect(t.log.referencesClosed).toBe(1);
    expect(first && first.status === "ready" && t.log.revoked.includes(first.info.previewUrl!)).toBe(true);
    // 모델은 다시 받지 않는다.
    expect(t.log.modelLoads).toBe(1);
  });

  it("사진을 연달아 고르면 나중 것만 남는다(늦게 끝난 앞의 것은 버리고 닫는다)", async () => {
    const t = start();
    const a = t.session.chooseReference(PHOTO);
    const b = t.session.chooseReference(new Blob(["두 번째"]));
    await Promise.all([a, b]);
    const s = t.state();
    expect(s.reference.status).toBe("ready");
    expect(t.log.referencesOpened - t.log.referencesClosed).toBe(1);
    if (s.reference.status === "ready") {
      expect(s.reference.info.fileSha256).toBe(sha256Hex(new TextEncoder().encode("두 번째")));
    }
  });
});

describe("동영상 분석 — 가까운 장면", () => {
  it("결과 단계로 가고, 1등이 골라지고, 그 그림(원본·보정본)과 후보의 작은 그림이 준비된다", async () => {
    const t = await analyzed();
    const s = t.state();
    expect(s.step).toBe("result");
    const picked = pickedOf(s)!;
    expect(picked.winner.verdict).toBe("close");
    expect(s.chosenRank).toBe(1);
    expect(s.imageStatus).toBe("ready");
    expect(s.images[1].originalUrl).toMatch(/original/);
    expect(s.images[1].correctedUrl).toMatch(/corrected/);
    for (const c of [picked.winner, ...picked.runnerUps]) expect(s.images[c.rank].thumbUrl).toMatch(/thumb/);
    // 큰 그림은 지금 보는 후보 하나만 들고 있다.
    for (const c of picked.runnerUps) expect(s.images[c.rank].originalUrl).toBeNull();
    expect(picked.runnerUps.length).toBeGreaterThan(0);
  });

  it("받은 동영상의 실제 해상도·길이·수정 시각이 상태에 들어간다", async () => {
    const t = start({ videoSize: { width: 1080, height: 1920 } });
    await t.session.chooseReference(PHOTO);
    await t.session.chooseVideo(videoFile(Date.UTC(2026, 9, 2, 3, 0, 0)));
    expect(t.state().video).toEqual({
      status: "ready",
      info: { width: 1080, height: 1920, durationSec: 11, fileModifiedAt: "2026-10-02T03:00:00.000Z" },
    });
  });

  it("수정 시각을 모르면 null 이다(지어내지 않는다)", async () => {
    const t = await analyzed();
    expect(t.state().video).toMatchObject({ status: "ready", info: { fileModifiedAt: null } });
  });

  it("진행(몇 장면 중 몇 장면)과 빠른 답이 분석 도중에 화면에 닿는다", async () => {
    const t = await analyzed();
    const running = t.history.filter((h) => h.analysis.status === "running");
    const phases = new Set(running.map((h) => (h.analysis.status === "running" ? h.analysis.progress?.phase : null)));
    expect(phases.has("coarse")).toBe(true);
    expect(phases.has("fine")).toBe(true);
    expect(phases.has("remeasure")).toBe(true);
    const quick = running.find((h) => h.analysis.status === "running" && h.analysis.quickAnswer !== null);
    expect(quick?.analysis).toMatchObject({ quickAnswer: { answer: "passedNear" } });
    // 빠른 답은 거친 훑기가 끝난 뒤에 온다.
    const firstQuick = t.history.indexOf(quick!);
    const firstFine = t.history.findIndex((h) => h.analysis.status === "running" && h.analysis.progress?.phase === "fine");
    expect(firstQuick).toBeLessThan(firstFine);
  });

  it("장면 뽑기는 겹치지 않고, 고른 장면을 다시 잰 시각으로 뽑는다", async () => {
    const t = await analyzed();
    const picked = pickedOf(t.state())!;
    expect(t.log.renders.every((r) => !r.overlapped)).toBe(true);
    expect(t.log.renders[0].requestedTimeSec).toBe(picked.winner.measurement.requestedTimeSec);
    expect(t.log.renders.every((r) => r.hadGeometry)).toBe(true);
    // 후보마다 한 번씩만 뽑는다(1등은 큰 그림을 만들 때 작은 그림도 같이 만든다).
    expect(t.log.renders).toHaveLength(1 + picked.runnerUps.length);
  });

  it("기준 사진 없이는 동영상을 받지 않는다", async () => {
    const t = start();
    await t.session.chooseVideo(VIDEO);
    expect(t.state().step).toBe("reference");
    expect(t.log.videos).toHaveLength(0);
  });
});

describe("동영상 분석 — 실패와 취소", () => {
  it("동영상을 열 수 없으면 동영상 단계에서 S3 를 보인다", async () => {
    const t = await analyzed({ videoUnreadable: true });
    const s = t.state();
    expect(s.step).toBe("video");
    expect(s.video).toMatchObject({ status: "failed", failure: { kind: "stop", code: "S3" } });
    expect(retakeCountOf(s)).toBe(0);
  });

  it("분석 도중 장면을 읽지 못하면 S3 로 멈추고 동영상을 닫는다", async () => {
    const t = await analyzed({
      beforeMeasure: (_t, _phase, count) => {
        if (count === 5) throw namedError("VideoUnreadableError", "동영상을 읽을 수 없습니다: 2.00초로 옮기기 중 오류");
      },
    });
    const s = t.state();
    expect(s.step).toBe("video");
    expect(s.analysis).toMatchObject({ status: "failed", failure: { kind: "stop", code: "S3" } });
    expect(t.log.videos[0].closed).toBe(true);
  });

  it("얼굴이 한 장면도 없으면 S4: 결과 단계에서 멈춘 이유와 뺀 장면 수를 들고 있고, 동영상을 닫는다", async () => {
    const t = await analyzed({ alter: () => ({ failure: "noFace" }) });
    const s = t.state();
    expect(s.step).toBe("result");
    expect(s.analysis).toMatchObject({ status: "done", result: { kind: "stopped", stop: "S4" } });
    if (s.analysis.status === "done") expect(s.analysis.result.excluded.X1).toBe(22);
    expect(s.chosenRank).toBeNull();
    expect(t.log.videos[0].closed).toBe(true);
    expect(t.log.renders).toHaveLength(0);
  });

  it("취소하면 다음 장면을 재지 않고 동영상 단계로 돌아간다", async () => {
    const fake = fakeBrowser({
      beforeMeasure: (_t, _phase, count) => {
        if (count === 6) session.cancel();
      },
    });
    const session = createPickSession(fake.deps);
    await session.chooseReference(PHOTO);
    await session.chooseVideo(VIDEO);
    const s = session.getState();
    expect(s.step).toBe("video");
    expect(s.analysis.status).toBe("cancelled");
    expect(fake.log.measures).toBe(6);
    expect(fake.log.videos[0].closed).toBe(true);
    expect(retakeCountOf(s)).toBe(0);
  });

  it("동영상을 여는 중에 취소하면 바로 돌아가고, 늦게 열린 동영상은 닫히고 분석은 시작하지 않는다", async () => {
    const fake = fakeBrowser();
    // 열기가 끝나지 않고 걸려 있는 동영상을 흉내 낸다.
    const openVideo = fake.deps.openVideo;
    let letOpen: () => void = () => {};
    const gate = new Promise<void>((resolve) => (letOpen = resolve));
    fake.deps.openVideo = async (file) => {
      await gate;
      return openVideo(file);
    };
    const session = createPickSession(fake.deps);
    await session.chooseReference(PHOTO);
    const pending = session.chooseVideo(VIDEO);
    expect(session.getState()).toMatchObject({ step: "analyzing", video: { status: "opening" } });

    session.cancel();
    // 열기가 끝나기를 기다리지 않고 바로 동영상 단계다.
    expect(session.getState()).toMatchObject({ step: "video", video: { status: "empty" }, analysis: { status: "cancelled" } });

    letOpen();
    await pending;
    const s = session.getState();
    expect(s).toMatchObject({ step: "video", video: { status: "empty" }, analysis: { status: "cancelled" } });
    expect(fake.log.videos).toHaveLength(1);
    expect(fake.log.videos[0].closed).toBe(true);
    expect(fake.log.measures).toBe(0);
    expect(retakeCountOf(s)).toBe(0);

    // 취소한 뒤 다시 고르면 처음처럼 끝까지 간다.
    await session.chooseVideo(VIDEO);
    expect(session.getState().step).toBe("result");
    expect(pickedOf(session.getState())).not.toBeNull();
  });

  it("분석 중에 기준 사진을 바꾸면 그 분석은 버려지고 동영상이 닫힌다", async () => {
    let swap: Promise<void> | null = null;
    const fake = fakeBrowser({
      beforeMeasure: (_t, _phase, count) => {
        if (count === 4) swap = session.chooseReference(new Blob(["새 기준 사진"]));
      },
    });
    const session = createPickSession(fake.deps);
    await session.chooseReference(PHOTO);
    await session.chooseVideo(VIDEO);
    await swap;
    const s = session.getState();
    expect(s.step).toBe("reference");
    expect(s.reference.status).toBe("ready");
    expect(s.analysis.status).toBe("idle");
    expect(s.video.status).toBe("empty");
    expect(fake.log.videos[0].closed).toBe(true);
    expect(pickedOf(s)).toBeNull();
  });
});

describe("늦게 끝난 분석", () => {
  it("예전 분석이 뒤늦게 끝나도 새 동영상의 결과와 손잡이를 건드리지 않는다", async () => {
    // 첫 분석 도중에 기준 사진을 바꾸고 새 동영상까지 끝낸 뒤에야 첫 분석이 풀려난다.
    let second: Promise<void> | null = null;
    const fake = fakeBrowser({
      beforeMeasure: async (_t, _phase, count) => {
        if (count === 4) {
          second = (async () => {
            await session.chooseReference(new Blob(["새 기준 사진"]));
            await session.chooseVideo(VIDEO);
          })();
          await second;
        }
      },
    });
    const session = createPickSession(fake.deps);
    await session.chooseReference(PHOTO);
    await session.chooseVideo(VIDEO);
    await second;
    const s = session.getState();
    expect(s.step).toBe("result");
    expect(fake.log.videos.map((v) => v.closed)).toEqual([true, false]);
    // 새 동영상이 살아 있어서 후보를 바꾸면 그 장면을 다시 뽑을 수 있다.
    const other = pickedOf(s)!.runnerUps[0];
    await session.chooseCandidate(other.rank);
    expect(session.getState().imageStatus).toBe("ready");
    expect(session.getState().images[other.rank].originalUrl).not.toBeNull();
  });
});

describe("가까운 장면 없음과 다시 찍기", () => {
  const far: FakeOptions = { reference: () => referenceMeasured({ h: 20, v: 0 }) };

  it("1등이 통과 기준을 넘으면 '그래도 보기'를 누르기 전에는 가려 둔다", async () => {
    const t = await analyzed(far);
    const s = t.state();
    expect(pickedOf(s)!.winner.verdict).toBe("notClose");
    expect(s.showAnyway).toBe(false);
    t.session.showAnyway();
    expect(t.state().showAnyway).toBe(true);
  });

  it("다시 찍은 횟수는 끝까지 간 분석마다 하나씩 오르고, 새 동영상에서는 예전 그림을 놓는다", async () => {
    const t = await analyzed(far);
    expect(retakeCountOf(t.state())).toBe(0);
    t.session.retake();
    expect(t.state().step).toBe("video");
    await t.session.chooseVideo(VIDEO);
    expect(retakeCountOf(t.state())).toBe(1);
    t.session.retake();
    await t.session.chooseVideo(VIDEO);
    expect(retakeCountOf(t.state())).toBe(2);
    expect(t.log.videos.map((v) => v.closed)).toEqual([true, true, false]);
    // 지금 결과의 주소만 살아 있다(기준 사진 미리보기 + 이번 동영상의 그림).
    const alive = new Set(leakedUrls(t.log));
    const s = t.state();
    for (const img of Object.values(s.images)) {
      for (const u of [img.thumbUrl, img.originalUrl, img.correctedUrl]) if (u) expect(alive.has(u)).toBe(true);
    }
    const expected = Object.values(s.images).flatMap((i) => [i.thumbUrl, i.originalUrl, i.correctedUrl]).filter(Boolean);
    expect(alive.size).toBe(expected.length + 1);
  });
});

describe("후보 바꾸기", () => {
  it("바꾸면 그 후보의 큰 그림을 만들고, 예전 큰 그림은 놓고 작은 그림은 남긴다", async () => {
    const t = await analyzed();
    const picked = pickedOf(t.state())!;
    const other = picked.runnerUps[0];
    const before = t.state().images[1];
    await t.session.chooseCandidate(other.rank);
    const s = t.state();
    expect(s.chosenRank).toBe(other.rank);
    expect(s.imageStatus).toBe("ready");
    expect(s.images[other.rank].originalUrl).not.toBeNull();
    expect(s.images[other.rank].correctedUrl).not.toBeNull();
    expect(s.images[1].originalUrl).toBeNull();
    expect(s.images[1].thumbUrl).toBe(before.thumbUrl);
    expect(t.log.revoked).toContain(before.originalUrl);
    expect(t.log.revoked).not.toContain(before.thumbUrl);
    expect(t.log.renders.at(-1)!.requestedTimeSec).toBe(other.measurement.requestedTimeSec);
  });

  it("연달아 바꿔도 장면 뽑기는 겹치지 않고, 마지막에 고른 후보의 그림이 남는다", async () => {
    const t = await analyzed();
    const picked = pickedOf(t.state())!;
    const ranks = picked.runnerUps.map((c) => c.rank);
    await Promise.all([...ranks.map((r) => t.session.chooseCandidate(r)), t.session.chooseCandidate(1)]);
    const s = t.state();
    expect(s.chosenRank).toBe(1);
    expect(s.imageStatus).toBe("ready");
    expect(s.images[1].originalUrl).not.toBeNull();
    for (const r of ranks) expect(s.images[r].originalUrl).toBeNull();
    expect(t.log.renders.every((r) => !r.overlapped)).toBe(true);
  });

  it("없는 순위로는 바뀌지 않는다", async () => {
    const t = await analyzed();
    const renders = t.log.renders.length;
    await t.session.chooseCandidate(42);
    expect(t.state().chosenRank).toBe(1);
    expect(t.log.renders).toHaveLength(renders);
  });

  it("그림을 만들지 못해도 결과(숫자)는 그대로 있고, 못 만들었다는 상태가 남는다", async () => {
    const t = await analyzed({ renderFails: () => true });
    const s = t.state();
    expect(s.step).toBe("result");
    expect(pickedOf(s)).not.toBeNull();
    expect(s.imageStatus).toBe("failed");
  });
});

describe("저장", () => {
  it("보정본 PNG·원본 장면 PNG·기록 JSON 세 파일이 만들어지고 이름에 종류·날짜가 붙는다", async () => {
    const t = await analyzedWithBlobs();
    await t.session.prepareExport();
    const s = t.state();
    expect(s.exportState.status).toBe("ready");
    if (s.exportState.status !== "ready") return;
    expect(s.exportState.files.map((f) => f.kind)).toEqual(["corrected", "original", "record"]);
    expect(s.exportState.files.map((f) => f.label)).toEqual(["보정본 PNG", "원본 장면 PNG", "기록 JSON"]);
    for (const f of s.exportState.files) {
      expect(f.name).toMatch(/^같은각도_정면_\d{8}-\d{4}_(보정본\.png|원본장면\.png|기록\.json)$/);
      expect(f.bytes).toBeGreaterThan(0);
    }
  });

  it("기록은 엔진의 검사를 통과하고, 다시 읽으면 같은 판정과 경고가 나온다", async () => {
    const t = await analyzedWithBlobs();
    await t.session.prepareExport();
    const record = await readRecord(t, t.blobs);
    expect(record.rulesVersion).toBe(RULES_VERSION);
    expect(record.stop).toBeNull();
    expect(record.chosenRank).toBe(1);
    expect(record.shotKind).toBe("front");
    expect(record.createdAt).toBe("2026-10-02T05:30:00.000Z");
    expect(record.candidates.length).toBe(1 + pickedOf(t.state())!.runnerUps.length);
    for (const r of rejudge(record)) expect(r.matchesRecord).toBe(true);
    expect(record.candidates[0].verdict).toBe("close");
  });

  it("기록의 해시는 실제로 만든 두 PNG 와 기준 사진 파일의 것이다", async () => {
    const t = await analyzedWithBlobs();
    await t.session.prepareExport();
    const s = t.state();
    if (s.exportState.status !== "ready") throw new Error("준비되지 않음");
    const record = await readRecord(t, t.blobs);
    const bytes = async (kind: string) =>
      t.blobs.get(s.exportState.status === "ready" ? s.exportState.files.find((f) => f.kind === kind)!.url : "")!.arrayBuffer();
    expect(record.files.correctedPngSha256).toBe(sha256Hex(await bytes("corrected")));
    expect(record.files.originalPngSha256).toBe(sha256Hex(await bytes("original")));
    expect(record.files.correctedPngSha256).not.toBe(record.files.originalPngSha256);
    expect(record.reference.fileSha256).toBe(sha256Hex(await PHOTO.arrayBuffer()));
  });

  it("두 PNG 의 띠에 '내부 기록용 · 광고·홍보 사용 금지'가 들어가고, 가까운 장면이면 표시가 없다", async () => {
    const t = await analyzedWithBlobs();
    await t.session.prepareExport();
    expect(t.log.pngs.map((p) => p.kind).sort()).toEqual(["corrected", "original"]);
    for (const p of t.log.pngs) {
      expect(p.lines[0]).toBe(BAND_NOTICE);
      expect(p.lines.join("\n")).not.toContain("가까운 장면");
    }
    expect(t.log.pngs.find((p) => p.kind === "corrected")!.lines[1]).toContain("기울기·크기·위치 맞춤");
  });

  it("메모와 사진 종류가 파일 이름과 기록에 들어간다", async () => {
    const t = await analyzedWithBlobs();
    t.session.setShotKind("frontDown");
    t.session.setMemo("  3회차 A-12  ");
    await t.session.prepareExport();
    const s = t.state();
    if (s.exportState.status !== "ready") throw new Error("준비되지 않음");
    expect(s.exportState.files[0].name).toMatch(/^같은각도_정면숙임_\d{8}-\d{4}_3회차-A-12_보정본\.png$/);
    const record = await readRecord(t, t.blobs);
    expect(record.memo).toBe("3회차 A-12");
    expect(record.shotKind).toBe("frontDown");
    // 가까운 장면을 저장할 때는 사유가 들어가지 않는다.
    expect(record.retakeReason).toBeNull();
  });

  it("가까운 장면을 저장할 때는 골라 둔 사유가 있어도 기록에 넣지 않는다", async () => {
    const t = await analyzedWithBlobs();
    t.session.setRetakeReason("시간 부족");
    await t.session.prepareExport();
    expect((await readRecord(t, t.blobs)).retakeReason).toBeNull();
  });

  it("사람이 바꾼 후보를 저장하면 기록에 그 순위가 남고, PNG 도 그 장면에서 나온다", async () => {
    const t = await analyzedWithBlobs();
    const other = pickedOf(t.state())!.runnerUps[0];
    await t.session.chooseCandidate(other.rank);
    await t.session.prepareExport();
    const record = await readRecord(t, t.blobs);
    expect(record.chosenRank).toBe(other.rank);
    for (const p of t.log.pngs) expect(p.requestedTimeSec).toBe(other.measurement.requestedTimeSec);
  });

  it("가까운 장면 없이 저장하면 띠와 기록에 표시·사유·다시 찍은 횟수가 남는다", async () => {
    const t = await analyzedWithBlobs({ reference: () => referenceMeasured({ h: 20, v: 0 }) });
    t.session.retake();
    await t.session.chooseVideo(VIDEO);
    t.session.showAnyway();
    t.session.setRetakeReason("자세 유지가 어려움");
    await t.session.prepareExport();
    const record = await readRecord(t, t.blobs);
    expect(record.candidates.find((c) => c.rank === record.chosenRank)!.verdict).toBe("notClose");
    expect(record.candidates[0].warnings).toContain("W1");
    expect(record.retakeReason).toBe("자세 유지가 어려움");
    expect(record.retakeCount).toBe(1);
    for (const p of t.log.pngs) expect(p.lines.join("\n")).toContain("가까운 장면 없음");
    for (const r of rejudge(record)) expect(r.matchesRecord).toBe(true);
  });

  it("통과 기준을 넘는 장면은 사유를 고르기 전에는 저장 파일을 만들지 않는다", async () => {
    const t = await analyzedWithBlobs({ reference: () => referenceMeasured({ h: 20, v: 0 }) });
    t.session.showAnyway();
    await t.session.prepareExport();
    expect(t.state().exportState.status).toBe("idle");
    expect(t.log.pngs).toHaveLength(0);
    t.session.setRetakeReason("기타");
    await t.session.prepareExport();
    expect(t.state().exportState.status).toBe("ready");
  });

  it("메모·사유·후보를 바꾸면 만들어 둔 파일을 버리고 그 주소를 놓는다", async () => {
    for (const change of ["memo", "reason", "candidate", "shotKind"] as const) {
      const t = await analyzedWithBlobs();
      await t.session.prepareExport();
      const s = t.state();
      if (s.exportState.status !== "ready") throw new Error("준비되지 않음");
      const urls = s.exportState.files.map((f) => f.url);
      if (change === "memo") t.session.setMemo("바뀐 메모");
      if (change === "reason") t.session.setRetakeReason("기타");
      if (change === "candidate") await t.session.chooseCandidate(pickedOf(s)!.runnerUps[0].rank);
      if (change === "shotKind") t.session.setShotKind("rightOblique");
      expect(t.state().exportState.status).toBe("idle");
      for (const u of urls) expect(t.log.revoked).toContain(u);
    }
  });

  it("파일을 만드는 도중에 메모가 바뀌면 그 묶음은 버린다(기록의 메모와 파일이 어긋나지 않는다)", async () => {
    const t = await analyzedWithBlobs();
    const p = t.session.prepareExport();
    t.session.setMemo("도중에 바꿈");
    await p;
    expect(t.state().exportState.status).toBe("idle");
    await t.session.prepareExport();
    expect((await readRecord(t, t.blobs)).memo).toBe("도중에 바꿈");
  });

  it("그림을 만들지 못한 장면은 저장 파일도 만들지 못하고, 그 사실을 알린다", async () => {
    const t = await analyzedWithBlobs({ renderFails: () => true });
    await t.session.prepareExport();
    expect(t.state().exportState).toMatchObject({ status: "failed" });
  });

  it("결과가 없으면 아무것도 만들지 않는다", async () => {
    const t = start();
    await t.session.prepareExport();
    expect(t.state().exportState.status).toBe("idle");
  });

  it("기록에는 이미지·주소·좌표가 들어가지 않는다", async () => {
    const t = await analyzedWithBlobs();
    t.session.setMemo("메모");
    await t.session.prepareExport();
    const text = JSON.stringify(await readRecord(t, t.blobs));
    expect(text).not.toMatch(/blob:|data:image|anchors"\s*:\s*\[|landmarks/);
  });
});

describe("놓기", () => {
  it("처음부터 하면 사진·동영상·그림을 전부 놓고 모델만 남긴다", async () => {
    const t = await analyzedWithBlobs();
    await t.session.prepareExport();
    t.session.reset();
    expect(t.state().step).toBe("reference");
    expect(t.state().reference.status).toBe("empty");
    expect(leakedUrls(t.log)).toEqual([]);
    expect(t.log.referencesClosed).toBe(t.log.referencesOpened);
    expect(t.log.videos.every((v) => v.closed)).toBe(true);
    expect(t.log.modelClosed).toBe(0);
  });

  it("화면을 떠나면 모델까지 닫고, 남는 주소가 없다", async () => {
    const t = await analyzedWithBlobs();
    await t.session.chooseCandidate(pickedOf(t.state())!.runnerUps[0].rank);
    await t.session.prepareExport();
    t.session.dispose();
    expect(leakedUrls(t.log)).toEqual([]);
    expect(t.log.modelClosed).toBe(1);
    expect(t.log.referencesClosed).toBe(t.log.referencesOpened);
    expect(t.log.videos.every((v) => v.closed)).toBe(true);
  });

  it("분석 도중에 화면을 떠나도 동영상이 닫히고 남는 주소가 없다", async () => {
    const fake = fakeBrowser({
      beforeMeasure: (_t, _phase, count) => {
        if (count === 3) session.dispose();
      },
    });
    const session = createPickSession(fake.deps);
    await session.chooseReference(PHOTO);
    await session.chooseVideo(VIDEO);
    expect(fake.log.videos[0].closed).toBe(true);
    expect(leakedUrls(fake.log)).toEqual([]);
    expect(fake.log.modelClosed).toBe(1);
  });

  it("모델을 받는 도중에 화면을 떠나면, 늦게 온 모델을 닫는다", async () => {
    const fake = fakeBrowser({
      // 모델을 받는 도중(받기가 끝나기 직전)에 화면을 떠난다.
      modelFails: () => {
        session.dispose();
        return false;
      },
    });
    const session = createPickSession(fake.deps);
    await session.chooseReference(PHOTO);
    expect(fake.log.modelLoads).toBe(1);
    expect(fake.log.modelClosed).toBe(fake.log.modelLoads);
    expect(fake.log.referencesClosed).toBe(fake.log.referencesOpened);
    expect(leakedUrls(fake.log)).toEqual([]);
  });
});
