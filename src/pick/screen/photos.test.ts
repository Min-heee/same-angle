import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { viewToTrace } from "../direction";
import { rejudge, validatePhotoPickRecord, validatePickRecord, type PhotoPickRecord } from "../record";
import { RULES } from "../rules";
import { bandLines } from "./exportplan";
import { failureText } from "./failure";
import { fakeBrowser, fakePhoto, leakedUrls, sha256Hex, type FakeOptions, type FakePhotoSpec } from "./fakes";
import { RETAKE_LIMIT, initialState, photoSetOf, pickedOf, reduce, retakeCountOf, type PickState } from "./flow";
import { BURST_HOW, BURST_NAMES_STAY, BURST_TIPS, BURST_WHEN } from "./guide";
import { AnalyzingStep, CandidateStrip, ResultStep, StoppedStep, Stepper, VideoStep } from "./parts";
import { createPickSession } from "./session";
import {
  candidateOf,
  contextForCandidate,
  holdBackView,
  judgeOf,
  photoLabel,
  progressView,
  resultView,
  saveGate,
  tracePlot,
  traceOfCandidate,
} from "./view";

/*
 * 사진 여러 장(연사) 입력의 화면 흐름(PRD v0.3.1 F22). 브라우저가 하는 일은 전부 가짜이고
 * (`fakes.ts`), "사진"은 이름이 붙은 빈 파일과 그 사진을 재면 나오는 숫자다. 분석은 진짜 엔진이 돈다.
 * **실제 브라우저·실제 카메라의 사진에서의 동작은 여기서 확인하지 못한다.**
 */

const REF = new Blob(["기준 사진(가짜 바이트)"], { type: "image/jpeg" });
const VIDEO = new Blob(["동영상(가짜 바이트)"], { type: "video/mp4" });
const html = (el: ReactElement) => renderToStaticMarkup(el);
const noop = () => {};

/** 환자 이름이 들어간 파일 이름을 흉내 낸다. 기록에 새면 안 되는 글자다. */
const PATIENT = "홍길동";
const nameAt = (n: number) => `${PATIENT}_IMG_${String(n).padStart(4, "0")}.JPG`;

/** 순번 n 의 사진이 보는 방향: 7번째가 기준과 가장 가깝다. */
const dirAt = (n: number) => ({ h: (n - 7) * 1.5 + 0.2, v: 0.1 });

function burst(count: number, alter: (n: number) => FakePhotoSpec | undefined = () => undefined): Blob[] {
  return Array.from({ length: count }, (_, i) => fakePhoto(nameAt(i + 1), { dir: dirAt(i + 1), ...alter(i + 1) }));
}

/** 고른 순서를 뒤섞는다(파일 선택 창이 넘겨주는 순서는 믿을 수 없다). */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = (i * 7 + 3) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function start(opts: FakeOptions = {}) {
  const fake = fakeBrowser(opts);
  const blobs = new Map<string, Blob>();
  const urlFor = fake.deps.urlFor;
  fake.deps.urlFor = (blob) => {
    const u = urlFor(blob);
    blobs.set(u, blob);
    return u;
  };
  const session = createPickSession(fake.deps);
  const history: PickState[] = [];
  session.subscribe(() => history.push(session.getState()));
  return { session, log: fake.log, blobs, history, state: () => session.getState() };
}

async function analyzed(files: readonly Blob[], opts: FakeOptions = {}) {
  const t = start(opts);
  await t.session.chooseReference(REF);
  t.session.goToVideo();
  await t.session.choosePhotos(files);
  return t;
}

async function exported(t: Awaited<ReturnType<typeof analyzed>>) {
  await t.session.prepareExport();
  const s = t.state();
  if (s.exportState.status !== "ready") throw new Error(`저장 파일이 준비되지 않음: ${s.exportState.status}`);
  const files = s.exportState.files;
  const text = await t.blobs.get(files.find((f) => f.kind === "record")!.url)!.text();
  return { files, text, parsed: JSON.parse(text) as unknown };
}

function viewOf(s: PickState) {
  const picked = pickedOf(s);
  const set = photoSetOf(s);
  if (!picked || !set || s.reference.status !== "ready" || s.chosenRank === null) throw new Error("사진 묶음의 결과가 없음");
  const ref = s.reference.info;
  const view = resultView({
    reference: ref.measured,
    referenceOriginal: { width: ref.width, height: ref.height },
    photos: { selected: set.selected, names: set.names },
    analysis: picked,
    chosenRank: s.chosenRank,
  })!;
  return { view, picked, ref, set };
}

function resultProps(s: PickState, over: Partial<Parameters<typeof ResultStep>[0]> = {}) {
  const { view, picked, ref } = viewOf(s);
  return {
    view,
    passDeg: RULES.select.passDeg,
    referenceUrl: ref.previewUrl,
    aspect: ref.width / ref.height,
    images: s.images,
    chosenRank: s.chosenRank!,
    imageStatus: s.imageStatus,
    showAnyway: s.showAnyway,
    hiddenDuringAnalysis: s.hiddenDuringAnalysis,
    plot: tracePlot(picked.trace, viewToTrace(ref.measured.face.view), traceOfCandidate(candidateOf(picked, s.chosenRank!)!)),
    gate: saveGate(view.verdict, retakeCountOf(s), RETAKE_LIMIT),
    holdBack: holdBackView(view, retakeCountOf(s), RETAKE_LIMIT, view.source),
    memo: s.memo,
    retakeReason: s.retakeReason,
    exportState: s.exportState,
    onShowAnyway: noop,
    onRetake: noop,
    onReset: noop,
    onChoose: noop,
    onMemo: noop,
    onReason: noop,
    onPrepare: noop,
    ...over,
  };
}

describe("사진 여러 장 고르기 — 심어 둔 정답", () => {
  it("순서를 섞어 골라도 파일 이름 순으로 세우고, 기준과 가장 가까운 7번째 사진을 고른다", async () => {
    const t = await analyzed(shuffled(burst(25)));
    const s = t.state();
    expect(s.step).toBe("result");
    const set = photoSetOf(s)!;
    expect(set).toMatchObject({ selected: 25, used: 25 });
    expect(set.names).toEqual(Array.from({ length: 25 }, (_, i) => nameAt(i + 1)));
    const { view, picked } = viewOf(s);
    expect(picked.winner.measurement.timeSec).toBe(7);
    expect(picked.winner.verdict).toBe("close");
    expect(view.whereText).toBe(`7번째 사진(${nameAt(7)})`);
    expect(view.title).toBe("가까운 장면을 골랐습니다");
  });

  it("사진을 한 장씩 푼다: 한 장을 재는 동안 다른 사진이 풀려 있지 않다", async () => {
    const t = await analyzed(shuffled(burst(25)));
    expect(t.log.photoMeasures.filter((m) => m.phase === "coarse").map((m) => m.photoNumber)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
    expect(t.log.photoMeasures.some((m) => m.overlapped)).toBe(false);
    // 순번 n 으로 푼 파일은 이름 순으로 n 번째 파일이다.
    for (const m of t.log.photoMeasures) expect(m.name).toBe(nameAt(m.photoNumber));
  });

  it("고른 사진과 후보의 그림은 그 순번의 파일에서, 긴 변 4096px 상한으로 뽑는다", async () => {
    const t = await analyzed(burst(25));
    const picked = pickedOf(t.state())!;
    const numbers = [picked.winner, ...picked.runnerUps].map((c) => c.measurement.timeSec);
    expect(t.log.photoRenders.map((r) => r.photoNumber)).toEqual(numbers);
    expect(t.log.photoRenders[0]).toEqual({ photoNumber: 7, name: nameAt(7), hadGeometry: true, maxLongSidePx: 4096 });
    expect(t.log.renders.some((r) => r.overlapped)).toBe(false);
    const s = t.state();
    expect(s.imageStatus).toBe("ready");
    expect(s.images[1].correctedUrl).toMatch(/^blob:fake\/corrected\//);
    for (const c of [picked.winner, ...picked.runnerUps]) expect(s.images[c.rank].thumbUrl).toMatch(/^blob:fake\/thumb\//);
  });

  it("진행률이 'N장 중 M장'으로 화면에 닿는다. 빠른 답은 없다", async () => {
    const t = await analyzed(burst(25));
    const running = t.history.filter((s) => s.analysis.status === "running");
    const counts = running.map((s) =>
      s.analysis.status === "running" ? progressView(s.analysis.progress, s.analysis.quickAnswer, "photos").count : null,
    );
    expect(counts).toContain("25장 중 1장");
    expect(counts).toContain("25장 중 25장");
    expect(running.every((s) => s.analysis.status === "running" && s.analysis.quickAnswer === null)).toBe(true);
    expect(running.some((s) => s.video.status === "photos")).toBe(true);
  });

  it("후보를 바꾸면 그 사진의 자리 표시·그림으로 바뀐다", async () => {
    const t = await analyzed(burst(25));
    await t.session.chooseCandidate(2);
    const { view, picked } = viewOf(t.state());
    const n = picked.runnerUps[0].measurement.timeSec;
    expect(view.whereText).toBe(`${n}번째 사진(${nameAt(n)})`);
    expect(view.switched).toBe(true);
    expect(t.log.photoRenders.at(-1)).toMatchObject({ photoNumber: n, hadGeometry: true });
  });
});

describe("사진 여러 장 고르기 — 나쁜 사진·읽지 못한 파일·상한·크기", () => {
  it("가장 가깝지만 흐린 사진, 노출이 날아간 사진은 고르지 않는다", async () => {
    const blurry = await analyzed(burst(25, (n) => (n === 7 ? { sharpness: 20 } : undefined)));
    expect(pickedOf(blurry.state())!.winner.measurement.timeSec).not.toBe(7);
    expect(pickedOf(blurry.state())!.excluded.X3).toBe(1);
    const clipped = await analyzed(burst(25, (n) => (n === 7 ? { clipRatio: 0.4 } : undefined)));
    expect(pickedOf(clipped.state())!.winner.measurement.timeSec).not.toBe(7);
    expect(pickedOf(clipped.state())!.excluded.X4).toBe(1);
  });

  it("읽지 못한 파일은 조용히 넘기지 않는다: 'N장은 읽지 못해 뺐습니다'가 결과에 보이고 순번은 밀리지 않는다", async () => {
    const t = await analyzed(burst(25, (n) => (n === 2 || n === 3 || n === 20 ? { unreadable: true } : undefined)));
    const { view, picked } = viewOf(t.state());
    expect(picked.photos).toMatchObject({ count: 25, unreadable: 3 });
    expect(view.inputNotices[0]).toMatch(/^3장은 읽지 못해 뺐습니다\./);
    expect(view.whereText).toBe(`7번째 사진(${nameAt(7)})`);
    expect(html(createElement(ResultStep, resultProps(t.state())))).toContain("3장은 읽지 못해 뺐습니다.");
  });

  it("전부 읽지 못하면 S6 으로 멈추고, 다시 찍은 횟수로 세지 않는다", async () => {
    const t = await analyzed(burst(4, () => ({ unreadable: true })));
    const s = t.state();
    expect(s.step).toBe("result");
    expect(s.analysis).toMatchObject({ status: "done", result: { kind: "stopped", stop: "S6" } });
    expect(s.completedAnalyses).toBe(0);
    expect(t.log.photoSets[0].closed).toBe(true);
    const text = failureText({ kind: "stop", code: "S6", source: "photos" });
    expect(text.message).toBe("고른 사진 가운데 이 브라우저에서 열 수 있는 것이 없습니다. JPEG로 저장한 사진을 골라 주세요.");
    expect(text.action).toBe("다른 사진들 고르기");
    expect(text.note).toContain("RAW");
  });

  it("상한(60장)을 넘기면 이름 순으로 앞 60장만 재고, 넘긴 것을 알린다", async () => {
    const t = await analyzed(shuffled(burst(61)));
    const set = photoSetOf(t.state())!;
    expect(set).toMatchObject({ selected: 61, used: 60 });
    expect(set.names).not.toContain(nameAt(61));
    expect(t.log.photoSets[0].count).toBe(60);
    expect(t.log.photoMeasures.filter((m) => m.phase === "coarse")).toHaveLength(60);
    expect(viewOf(t.state()).view.inputNotices).toContain("사진이 61장이라 파일 이름 순으로 앞 60장만 봤습니다.");
  });

  it("크기가 다른 사진이 섞이면 알리고, 후보마다 그 사진의 크기로 판정한다", async () => {
    const small = { width: 2000, height: 3000 };
    const t = await analyzed(burst(10, (n) => (n === 7 ? { photoSize: small } : undefined)));
    const { view, picked, ref } = viewOf(t.state());
    expect(view.inputNotices).toContain("크기가 다른 사진이 1장 섞여 있습니다. 같은 설정으로 찍은 사진만 넣어 주세요.");
    expect(view.rows.find((r) => r.label === "고른 사진 해상도")?.value).toBe("2000×3000");
    const base = { reference: ref.measured, referenceOriginal: { width: ref.width, height: ref.height } };
    const winner = contextForCandidate(base, "photos", picked, picked.winner)!;
    const runner = contextForCandidate(base, "photos", picked, picked.runnerUps[0])!;
    expect(winner.videoNative).toEqual(small);
    expect(runner.videoNative).toEqual({ width: 4000, height: 6000 });
    // 작은 사진은 두 배 늘려 그린다.
    expect(judgeOf(picked.winner, winner).numbers.qualityScale! / judgeOf(picked.runnerUps[0], runner).numbers.qualityScale!).toBeCloseTo(2, 6);
  });

  it("얼굴이 하나도 없는 묶음은 '쓸 수 있는 사진이 없습니다'로 멈춘다", async () => {
    const t = await analyzed(burst(5, () => ({ failure: "noFace" })));
    const s = t.state();
    if (s.analysis.status !== "done" || s.analysis.result.kind !== "stopped") throw new Error("멈추지 않음");
    const r = s.analysis.result;
    expect(r.stop).toBe("S4");
    const out = html(
      createElement(StoppedStep, {
        failure: { kind: "stop", code: r.stop, excluded: r.excluded, multipleFaces: r.multipleFaces, source: "photos" },
        plot: null,
        passDeg: 3,
        onRetake: noop,
        onReset: noop,
      }),
    );
    expect(out).toContain("쓸 수 있는 사진이 없습니다(얼굴 없음 5장). 다시 찍어 주세요.");
    expect(out).toContain("다시 찍은 사진들 고르기");
    expect(s.completedAnalyses).toBe(1);
  });

  it("다시 풀 때 읽지 못한 후보는 버리고, 버렸다고 알린다", async () => {
    const t = await analyzed(burst(10), { photoUnreadableOnRemeasure: (n) => n === 7 });
    const { view, picked } = viewOf(t.state());
    expect(picked.winner.measurement.timeSec).not.toBe(7);
    expect(picked.remeasureDropped).toBe(1);
    expect(view.notes).toContain("다시 쟀더니 쓸 수 없게 된 사진 1장을 버렸습니다.");
  });
});

describe("사진 여러 장 고르기 — 흐름", () => {
  it("기준 사진 없이는 받지 않고, 빈 묶음도 받지 않는다", async () => {
    const t = start();
    await t.session.choosePhotos(burst(3));
    expect(t.state().video.status).toBe("empty");
    await t.session.chooseReference(REF);
    await t.session.choosePhotos([]);
    expect(t.state().video.status).toBe("empty");
    expect(t.log.photoSets).toHaveLength(0);
  });

  it("취소하면 다음 사진을 풀지 않고 ② 로 돌아가며 묶음을 놓는다", async () => {
    const hold: { t?: ReturnType<typeof start> } = {};
    const t = start({
      beforePhoto: (n) => {
        if (n === 3) hold.t?.session.cancel();
      },
    });
    hold.t = t;
    await t.session.chooseReference(REF);
    await t.session.choosePhotos(burst(25));
    const s = t.state();
    expect(s.step).toBe("video");
    expect(s.analysis.status).toBe("cancelled");
    expect(t.log.photoMeasures).toHaveLength(3);
    expect(t.log.photoSets[0].closed).toBe(true);
    expect(s.completedAnalyses).toBe(0);
  });

  it("사진을 풀다 난 다른 오류는 알 수 없는 문제로 멈춘다(읽지 못한 사진으로 세지 않는다)", async () => {
    const t = await analyzed(burst(5), {
      beforePhoto: (n) => {
        if (n === 2) throw new Error("캔버스를 만들 수 없음");
      },
    });
    const s = t.state();
    expect(s.step).toBe("video");
    expect(s.analysis).toMatchObject({ status: "failed", failure: { kind: "unknown" } });
    expect(t.log.photoSets[0].closed).toBe(true);
  });

  it("다시 찍은 횟수는 동영상과 사진 묶음을 번갈아 넣어도 함께 센다", async () => {
    const far = (n: number) => ({ dir: { h: 6 + n, v: 0 } });
    const t = await analyzed(burst(5, far));
    expect(viewOf(t.state()).view.noCloseScene).toBe(true);
    expect(retakeCountOf(t.state())).toBe(0);
    t.session.retake();
    await t.session.chooseVideo(VIDEO);
    expect(retakeCountOf(t.state())).toBe(1);
    expect(t.state().video.status).toBe("ready");
    expect(t.log.photoSets[0].closed).toBe(true);
    t.session.retake();
    await t.session.choosePhotos(burst(5, far));
    expect(retakeCountOf(t.state())).toBe(2);
    expect(t.log.videos[0].closed).toBe(true);
    const hb = holdBackView(viewOf(t.state()).view, retakeCountOf(t.state()), RETAKE_LIMIT, "photos");
    expect(hb.exhausted).toBe(true);
    expect(hb.secondary.label).toBe("한 번 더 찍은 사진들 고르기");
  });

  it("가까운 사진이 없으면 사진보다 먼저 다시 찍기를 권한다(낱말만 '사진들')", async () => {
    const t = await analyzed(burst(5, (n) => ({ dir: { h: 6 + n, v: 0 } })));
    const { view } = viewOf(t.state());
    expect(view.title).toBe("가까운 장면이 없습니다");
    const hb = holdBackView(view, 0, RETAKE_LIMIT, "photos");
    expect(hb.primary).toEqual({ action: "retake", label: "다시 찍은 사진들 고르기" });
    const out = html(createElement(ResultStep, resultProps(t.state())));
    expect(out).toContain("다시 찍은 사진들 고르기");
    expect(out).not.toContain("이번 사진");
  });

  it("기준 사진을 바꾸거나 화면을 떠나면 묶음을 놓고, 남는 주소가 없다", async () => {
    const t = await analyzed(burst(10));
    await t.session.prepareExport();
    t.session.dispose();
    expect(t.log.photoSets[0].closed).toBe(true);
    expect(leakedUrls(t.log)).toEqual([]);
    const u = await analyzed(burst(10));
    await u.session.chooseReference(REF);
    expect(u.log.photoSets[0].closed).toBe(true);
    expect(u.state().video.status).toBe("empty");
  });

  it("리듀서: 사진 묶음은 '여는 중'일 때만 받는다. 받으면 분석이 시작되고, 기준 사진을 바꾸면 비워진다", () => {
    const set = { selected: 3, used: 3, names: ["a", "b", "c"] };
    const idle = initialState();
    expect(reduce(idle, { type: "photos/ready", set })).toBe(idle);
    expect(photoSetOf(idle)).toBeNull();
    const opening: PickState = { ...idle, step: "analyzing", video: { status: "opening" } };
    const ready = reduce(opening, { type: "photos/ready", set });
    expect(photoSetOf(ready)).toEqual(set);
    expect(ready.analysis).toEqual({ status: "running", progress: null, quickAnswer: null, cancelling: false });
    expect(photoSetOf(reduce(ready, { type: "reference/reading" }))).toBeNull();
    // 취소하면 묶음 자리도 비운다.
    expect(reduce(ready, { type: "analysis/cancelled" }).video.status).toBe("empty");
  });
});

describe("사진 여러 장 고르기 — 저장과 기록", () => {
  it("세 파일이 만들어지고, 기록은 사진 기록의 검사를 통과하며 다시 읽으면 같은 판정이 나온다", async () => {
    const t = await analyzed(shuffled(burst(25)));
    const { files, parsed } = await exported(t);
    expect(files.map((f) => f.label)).toEqual(["보정본 PNG", "원본 사진 PNG", "기록 JSON"]);
    const v = validatePhotoPickRecord(parsed);
    if (!v.ok) throw new Error(v.errors.join(" / "));
    const r: PhotoPickRecord = v.record;
    expect(r.source).toBe("photos");
    expect(r.photos).toMatchObject({ selected: 25, used: 25, unreadable: 0, sizeMismatch: 0, chosenNumber: 7 });
    expect(r.candidates[0]).toMatchObject({ rank: 1, photoNumber: 7, width: 4000, height: 6000 });
    for (const a of rejudge(r)) expect(a.matchesRecord).toBe(true);
    // 동영상 기록의 검사기는 이 기록을 받지 않는다.
    expect(validatePickRecord(parsed).ok).toBe(false);
  });

  it("기록에 파일 이름이 없다: 환자 이름도, 확장자도, 어느 사진의 이름도", async () => {
    const t = await analyzed(shuffled(burst(25, (n) => (n === 4 ? { unreadable: true } : undefined))));
    t.session.setMemo("3회차");
    const { text, files } = await exported(t);
    expect(text).not.toContain(PATIENT);
    expect(text).not.toContain("IMG_");
    expect(text).not.toMatch(/\.jpe?g/i);
    for (let n = 1; n <= 25; n++) expect(text).not.toContain(nameAt(n));
    // 저장 파일의 이름에도 들어가지 않는다.
    for (const f of files) expect(f.name).not.toContain(PATIENT);
    // 화면 상태에는 있다(화면에만 보인다).
    expect(photoSetOf(t.state())!.names[6]).toBe(nameAt(7));
  });

  it("어느 파일인지는 순번과 원본 파일의 해시로 잇는다", async () => {
    const files = burst(25);
    const t = await analyzed(shuffled(files));
    const { parsed } = await exported(t);
    const r = parsed as PhotoPickRecord;
    expect(r.photos.chosenFileSha256).toBe(sha256Hex(await files[6].arrayBuffer()));
    expect(r.reference.fileSha256).toBe(sha256Hex(await REF.arrayBuffer()));
  });

  it("사람이 바꾼 후보를 저장하면 그 사진의 순번과 해시가 남는다", async () => {
    const files = burst(25);
    const t = await analyzed(files);
    await t.session.chooseCandidate(2);
    const n = pickedOf(t.state())!.runnerUps[0].measurement.timeSec;
    const r = (await exported(t)).parsed as PhotoPickRecord;
    expect(r.chosenRank).toBe(2);
    expect(r.photos.chosenNumber).toBe(n);
    expect(r.photos.chosenFileSha256).toBe(sha256Hex(await files[n - 1].arrayBuffer()));
    expect(t.log.pngs.at(-1)?.requestedTimeSec).toBe(n);
  });

  it("PNG 의 띠: 원본 쪽은 '동영상의 한 장면'이 아니라 고른 사진이라고 적는다", async () => {
    const t = await analyzed(burst(25));
    await exported(t);
    const original = t.log.pngs.find((p) => p.kind === "original")!;
    expect(original.lines[0]).toBe("내부 기록용 · 광고·홍보 사용 금지");
    expect(original.lines[1]).toBe("원본 사진: 고른 사진(보정 없음, 크면 긴 변 4096px 로 줄임)");
    expect(original.lines.join(" ")).not.toContain("동영상");
    const date = new Date("2026-10-02T05:30:00.000Z");
    expect(bandLines({ kind: "original", verdict: "close", noCloseScene: false, angleDeg: 1, shotKind: "front", date })[1]).toBe(
      "원본 장면: 동영상의 한 장면 그대로(보정 없음)",
    );
  });

  it("가까운 사진 없이 저장하려면 사유가 있어야 하고, 기록에 사유와 표시가 남는다", async () => {
    const t = await analyzed(burst(5, (n) => ({ dir: { h: 6 + n, v: 0 } })));
    t.session.showAnyway();
    await t.session.prepareExport();
    expect(t.state().exportState.status).toBe("idle");
    t.session.setRetakeReason("시간 부족");
    const r = (await exported(t)).parsed as PhotoPickRecord;
    expect(r.retakeReason).toBe("시간 부족");
    expect(r.candidates[0].warnings).toContain("W1");
    expect(t.log.pngs[0].lines.join(" ")).toContain("가까운 장면 없음");
  });
});

describe("사진 여러 장 고르기 — 화면 조각", () => {
  const videoStep = () =>
    html(createElement(VideoStep, { shotKind: "front", failure: null, cancelled: false, retakeCount: 0, onFile: noop, onPhotos: noop, onBack: noop }));

  it("② 단계에 선택지가 둘이다: 동영상 고르기(그대로)와 사진 여러 장 고르기(연사)", () => {
    const out = videoStep();
    expect(out).toContain("동영상 고르기");
    expect(out).toContain("지금 바로 찍기");
    expect(out).toContain("사진 여러 장 고르기(연사)");
    // 사진 쪽은 image/* 를 여러 장 받고, 카메라를 열지 않는다.
    expect(out.match(/<input[^>]*accept="image\/\*"[^>]*>/g)).toHaveLength(1);
    expect(out).toMatch(/<input[^>]*accept="image\/\*"[^>]*multiple/);
    expect(out.match(/multiple/g)).toHaveLength(1);
    expect(out.match(/capture=/g)).toHaveLength(1);
    expect(out.match(/accept="video\/\*"/g)).toHaveLength(2);
  });

  it("연사 안내: 전용 카메라나 폰 연사로 20~30장, 화질이 중요하면 이쪽, 상한 60장, 파일 이름은 기록에 넣지 않음", () => {
    const out = videoStep();
    expect(out).toContain(BURST_HOW);
    expect(out).toContain(BURST_WHEN);
    for (const tip of BURST_TIPS) expect(out).toContain(tip);
    expect(out).toContain("한 번에 60장까지 봅니다");
    expect(out).toContain(BURST_NAMES_STAY);
    expect(out).toContain("실제 카메라로 찍은 사진으로는 아직 돌려 보지 못했습니다");
  });

  it("연사 안내 문장은 설계 문서(PRD 3절)와 같다", () => {
    const prd = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/PRD.md"), "utf8");
    for (const line of [BURST_HOW, BURST_WHEN, ...BURST_TIPS]) expect({ line, found: prd.includes(line) }).toEqual({ line, found: true });
    expect(prd).toContain(`**${RULES.photos.maxCount}장.**`);
    expect(prd).toContain(`**${RULES.photos.outputMaxLongSidePx}px**`);
  });

  it("단계 표시줄의 둘째 단계는 '동영상·사진'이다", () => {
    expect(html(createElement(Stepper, { step: "video" }))).toContain("2. 동영상·사진");
  });

  it("③ 분석: 받은 사진 수와 'N장 중 M장'이 보인다", () => {
    const out = html(
      createElement(AnalyzingStep, {
        video: null,
        photos: { selected: 72, used: 60 },
        progress: progressView({ phase: "coarse", done: 7, total: 60 }, null, "photos"),
        cancelling: false,
        truncatedSec: null,
        onCancel: noop,
      }),
    );
    expect(out).toContain("받은 사진: 72장");
    expect(out).toContain("파일 이름 순으로 앞 60장만 봅니다");
    expect(out).toContain("60장 중 7장");
    expect(out).toContain("사진을 한 장씩 재는 중");
    expect(out).not.toContain("장면 중");
    expect(out).toContain(">취소</button>");
  });

  it("진행 표시: 다시 재는 단계의 문장과 몫, 동영상 쪽은 그대로", () => {
    expect(progressView(null, null, "photos")).toMatchObject({ label: "사진을 준비하는 중", count: null, fraction: 0 });
    const again = progressView({ phase: "remeasure", done: 2, total: 4 }, null, "photos");
    expect(again).toMatchObject({ label: "고른 사진을 다시 재는 중", count: "4장 중 2장" });
    expect(again.fraction).toBeCloseTo(0.95, 9);
    expect(progressView({ phase: "coarse", done: 7, total: 24 }, null).count).toBe("24장면 중 7장면");
    expect(progressView({ phase: "coarse", done: 7, total: 24 }, null, "video").label).toBe("동영상 전체를 훑어보는 중");
  });

  it("④ 결과: 자리 표시는 'N번째 사진(파일 이름)'이고, 결과 화면에 '동영상'이라는 말이 사진을 가리키며 나오지 않는다", async () => {
    const t = await analyzed(burst(25));
    const out = html(createElement(ResultStep, resultProps(t.state())));
    expect(out).toContain(`7번째 사진(${nameAt(7)})`);
    expect(out).toContain("가까운 장면을 골랐습니다");
    expect(out).toContain("기준 사진");
    expect(out).toContain("이번 사진");
    expect(out).toContain("사진들이 본 방향");
    expect(out).toContain("원본 사진");
    expect(out).not.toContain("동영상의");
    expect(out).not.toContain("동영상이 지나간");
    expect(out).not.toContain("동영상 해상도");
    // 저장·나란히·겹쳐 보기·늘 보이는 문장은 그대로다.
    for (const same of ["나란히", "겹쳐 보기", "저장할 파일 만들기", "측정 오차는 아직 재지 않았습니다"]) expect(out).toContain(same);
    expect(out).not.toMatch(/전후|시술 전|시술 후|개선|호전|→|합격|불합격/);
    expect(out).not.toMatch(/더 왼쪽|더 오른쪽|왼쪽으로 더|오른쪽으로 더/);
  });

  it("숫자 표: 고른 사진·고른 사진 해상도·잰 사진·뺀 사진", async () => {
    const t = await analyzed(burst(25, (n) => (n === 25 ? { failure: "noFace" } : undefined)));
    const { view } = viewOf(t.state());
    const row = (label: string) => view.rows.find((r) => r.label === label);
    expect(row("고른 사진")).toMatchObject({ value: `7번째 사진(${nameAt(7)})`, hint: "본 25장 가운데. 순번은 파일 이름 순입니다" });
    expect(row("고른 사진 해상도")?.value).toBe("4000×6000");
    expect(row("잰 사진")?.value).toMatch(/^25장\(\+다시 잰 \d장\)$/);
    expect(row("뺀 사진")).toMatchObject({ value: "1장", hint: "얼굴 없음 1장" });
    expect(row("고른 시각")).toBeUndefined();
    expect(row("동영상 해상도")).toBeUndefined();
    // 보정본은 기준 사진(3024×4032)의 크기 그대로다(4096 상한 안).
    expect(row("보정본 크기")?.value).toBe("3024×4032");
    // 늘 보이는 다섯 줄은 동영상과 같은 라벨이다.
    expect(view.keyRows.map((r) => r.label)).toEqual(["각도 차", "맞춘 기울기", "얼굴 크기 차", "늘려 그린 배율", "위치 차"]);
  });

  it("후보 조각에는 순번이 보이고, 통과 기준을 넘는 후보에는 '가까운 장면'이 붙지 않는다", async () => {
    const t = await analyzed(burst(25));
    const { view } = viewOf(t.state());
    expect(view.candidates[0]).toMatchObject({ name: "도구가 고른 장면", timeText: "7번째 사진" });
    for (const c of view.candidates) {
      expect(c.timeText).toMatch(/^\d+번째 사진$/);
      if (c.verdict !== "close") expect(c.label).not.toContain("가까운 장면");
    }
    const one = html(createElement(CandidateStrip, { candidates: view.candidates.slice(0, 1), images: {}, aspect: 0.75, source: "photos", onChoose: noop }));
    expect(one).toContain("쓸 수 있는 사진이 한 장뿐입니다");
  });

  it("파일 이름을 모르면 순번만 적는다", () => {
    expect(photoLabel(3)).toBe("3번째 사진");
    expect(photoLabel(3, "")).toBe("3번째 사진");
    expect(photoLabel(3, "DSC_0003.JPG")).toBe("3번째 사진(DSC_0003.JPG)");
  });
});

describe("동영상 쪽은 그대로다", () => {
  it("동영상을 고르면 결과의 자리 표시는 '동영상의 약 N초'이고 묶음 알림이 없다", async () => {
    const t = start();
    await t.session.chooseReference(REF);
    await t.session.chooseVideo(VIDEO);
    const s = t.state();
    if (s.video.status !== "ready" || s.reference.status !== "ready") throw new Error("결과 없음");
    const view = resultView({
      reference: s.reference.info.measured,
      referenceOriginal: { width: s.reference.info.width, height: s.reference.info.height },
      videoNative: { width: s.video.info.width, height: s.video.info.height },
      videoDurationSec: s.video.info.durationSec,
      analysis: pickedOf(s)!,
      chosenRank: 1,
    })!;
    expect(view.source).toBe("video");
    expect(view.whereText).toMatch(/^동영상의 약 \d+\.\d초$/);
    expect(view.inputNotices).toEqual([]);
    expect(view.rows.map((r) => r.label)).toContain("동영상 해상도");
    expect(photoSetOf(s)).toBeNull();
    expect(t.log.photoSets).toHaveLength(0);
    // 보정본의 긴 변 상한은 1920px 그대로다(기준 사진 3024×4032).
    expect(view.rows.find((r) => r.label === "보정본 크기")?.value).toBe("1440×1920");
    await t.session.prepareExport();
    const st = t.state();
    if (st.exportState.status !== "ready") throw new Error("저장 파일 없음");
    expect(st.exportState.files.map((f) => f.label)).toEqual(["보정본 PNG", "원본 장면 PNG", "기록 JSON"]);
    const record: unknown = JSON.parse(await t.blobs.get(st.exportState.files[2].url)!.text());
    expect(validatePickRecord(record).ok).toBe(true);
    expect(t.log.pngs.find((p) => p.kind === "original")!.lines[1]).toBe("원본 장면: 동영상의 한 장면 그대로(보정 없음)");
  });
});
