import { describe, expect, it } from "vitest";
import { analyze } from "../pipeline";
import { crossSweep, synthFace, synthFrame } from "../testkit";
import {
  MEMO_MAX,
  hasUnsavedWork,
  initialState,
  pickedOf,
  reduce,
  retakeCountOf,
  stepNumber,
  type Action,
  type PickState,
  type PickedAnalysis,
  type ReferenceInfo,
  type StoppedAnalysis,
} from "./flow";

/*
 * 화면 상태의 규칙. 엔진은 진짜를 쓰고(합성 측정값), 여기서는 상태가 어떻게 바뀌는지만 본다.
 */

const info = (): ReferenceInfo => ({
  width: 3024,
  height: 4032,
  measured: { faceCount: 1, face: synthFace(), faceFailure: null, sharpness: 100, skin: { meanLuma: 128, clipRatio: 0 } },
  fileSha256: null,
  previewUrl: null,
});
const videoInfo = { width: 1440, height: 1920, durationSec: 11, fileModifiedAt: null };

async function pickedResult(): Promise<PickedAnalysis> {
  const sweep = crossSweep();
  const r = await analyze({
    reference: synthFace(),
    durationSec: sweep.durationSec,
    measureAt: async (t) => synthFrame({ timeSec: t, dir: sweep.at(t) }),
  });
  if (r.kind !== "picked") throw new Error("고르지 못함");
  return r;
}

async function stoppedResult(stop: "S3" | "S4" = "S4"): Promise<StoppedAnalysis> {
  const r = await analyze({
    reference: synthFace(),
    durationSec: 3,
    measureAt: async (t) => synthFrame({ timeSec: t, failure: "noFace" }),
  });
  if (r.kind !== "stopped") throw new Error("멈추지 않음");
  return { ...r, stop };
}

const run = (s: PickState, ...actions: Action[]) => actions.reduce(reduce, s);

const withReference = () => run(initialState(), { type: "reference/reading" }, { type: "reference/ready", info: info() });
const analyzing = (s: PickState) => run(s, { type: "video/opening" }, { type: "video/ready", info: videoInfo });

describe("flow — 단계", () => {
  it("처음은 기준 사진 단계이고 아무것도 고르지 않았다", () => {
    const s = initialState();
    expect(s.step).toBe("reference");
    expect(s.reference.status).toBe("empty");
    expect(stepNumber(s.step)).toBe(1);
    expect(retakeCountOf(s)).toBe(0);
  });

  it("기준 사진이 준비되기 전에는 동영상 단계로 넘어가지 못한다", () => {
    expect(run(initialState(), { type: "step", step: "video" }).step).toBe("reference");
    expect(run(initialState(), { type: "reference/reading" }, { type: "step", step: "video" }).step).toBe("reference");
    expect(run(withReference(), { type: "step", step: "video" }).step).toBe("video");
  });

  it("기준 사진 없이 동영상을 열지 못한다", () => {
    expect(run(initialState(), { type: "video/opening" }).step).toBe("reference");
  });

  it("동영상을 열면 분석 단계, 끝나면 결과 단계이고 1등이 골라져 있다", async () => {
    const a = analyzing(withReference());
    expect(a.step).toBe("analyzing");
    expect(a.analysis.status).toBe("running");
    const done = run(a, { type: "analysis/done", result: await pickedResult() });
    expect(done.step).toBe("result");
    expect(done.chosenRank).toBe(1);
    expect(pickedOf(done)).not.toBeNull();
    expect(stepNumber(done.step)).toBe(4);
  });

  it("분석 중에는 단계를 옮기지 못하고, 새 동영상도 열지 못한다", () => {
    const a = analyzing(withReference());
    expect(run(a, { type: "step", step: "reference" })).toBe(a);
    expect(run(a, { type: "retake" })).toBe(a);
    expect(run(a, { type: "video/opening" })).toBe(a);
  });

  it("취소하면 동영상 단계로 돌아가고, 취소했다는 사실이 남는다", () => {
    const s = run(analyzing(withReference()), { type: "analysis/cancelling" }, { type: "analysis/cancelled" });
    expect(s.step).toBe("video");
    expect(s.analysis.status).toBe("cancelled");
    expect(s.video.status).toBe("empty");
  });

  it("동영상을 여는 중에 취소해도 동영상 단계로 돌아간다(분석은 시작하지 않았다)", () => {
    const opening = run(withReference(), { type: "video/opening" });
    expect(opening).toMatchObject({ step: "analyzing", video: { status: "opening" }, analysis: { status: "idle" } });
    const s = run(opening, { type: "analysis/cancelled" });
    expect(s).toMatchObject({ step: "video", video: { status: "empty" }, analysis: { status: "cancelled" } });
    // 늦게 도착한 "열림"은 받지 않는다.
    expect(run(s, { type: "video/ready", info: videoInfo })).toBe(s);
    // 아무것도 하고 있지 않을 때의 취소는 아무 일도 하지 않는다.
    const idle = withReference();
    expect(run(idle, { type: "analysis/cancelled" })).toBe(idle);
  });

  it("동영상을 열지 못하면 동영상 단계에서 이유를 보인다", () => {
    const s = run(withReference(), { type: "video/opening" }, {
      type: "video/failed",
      failure: { kind: "stop", code: "S3" },
    });
    expect(s.step).toBe("video");
    expect(s.video).toEqual({ status: "failed", failure: { kind: "stop", code: "S3" } });
  });

  it("진행·빠른 답은 분석 중일 때만 들어간다", () => {
    const progress = { phase: "coarse" as const, done: 3, total: 22 };
    expect(run(withReference(), { type: "analysis/progress", progress }).analysis.status).toBe("idle");
    const a = run(analyzing(withReference()), { type: "analysis/progress", progress });
    expect(a.analysis).toMatchObject({ status: "running", progress });
  });
});

describe("flow — 늦게 온 결과를 받지 않는다", () => {
  it("기준 사진을 읽는 중이 아니면 '준비됨'을 받지 않는다", () => {
    const s = initialState();
    expect(run(s, { type: "reference/ready", info: info() })).toBe(s);
    expect(run(s, { type: "reference/failed", failure: { kind: "stop", code: "S1" } })).toBe(s);
  });

  it("분석 중이 아니면 분석 결과를 받지 않는다", async () => {
    const s = withReference();
    expect(run(s, { type: "analysis/done", result: await pickedResult() })).toBe(s);
    expect(run(s, { type: "analysis/cancelled" })).toBe(s);
  });
});

describe("flow — 기준 사진을 바꾸면 전부 비운다", () => {
  it("동영상·분석·후보·메모·횟수가 남지 않는다", async () => {
    const done = run(
      analyzing(withReference()),
      { type: "analysis/done", result: await pickedResult() },
      { type: "memo", memo: "3회차" },
      { type: "images", rank: 1, images: { thumbUrl: "blob:a" } },
    );
    expect(done.completedAnalyses).toBe(1);
    const s = run(done, { type: "reference/reading" });
    expect(s.step).toBe("reference");
    expect(s.video.status).toBe("empty");
    expect(s.analysis.status).toBe("idle");
    expect(s.chosenRank).toBeNull();
    expect(s.images).toEqual({});
    expect(s.memo).toBe("");
    expect(s.completedAnalyses).toBe(0);
  });
});

describe("flow — 다시 찍은 횟수", () => {
  it("끝까지 간 분석만 센다: 첫 동영상은 0번, 두 번째는 1번, 세 번째는 2번", async () => {
    const result = await pickedResult();
    let s = run(analyzing(withReference()), { type: "analysis/done", result });
    expect(retakeCountOf(s)).toBe(0);
    s = run(analyzing(run(s, { type: "retake" })), { type: "analysis/done", result });
    expect(retakeCountOf(s)).toBe(1);
    s = run(analyzing(run(s, { type: "retake" })), { type: "analysis/done", result: await stoppedResult("S4") });
    expect(retakeCountOf(s)).toBe(2);
  });

  it("취소·열지 못한 동영상·읽다 멈춘 동영상(S3)은 세지 않는다", async () => {
    let s = run(analyzing(withReference()), { type: "analysis/done", result: await pickedResult() });
    s = run(analyzing(run(s, { type: "retake" })), { type: "analysis/cancelled" });
    s = run(s, { type: "video/opening" }, { type: "video/failed", failure: { kind: "stop", code: "S3" } });
    s = run(analyzing(s), { type: "analysis/failed", failure: { kind: "stop", code: "S3" } });
    s = run(analyzing(s), { type: "analysis/done", result: await stoppedResult("S3") });
    expect(s.completedAnalyses).toBe(1);
    expect(retakeCountOf(s)).toBe(0);
  });

  it("새 동영상을 열면 예전 결과·'그래도 보기'·사유가 비워진다", async () => {
    let s = run(
      analyzing(withReference()),
      { type: "analysis/done", result: await pickedResult() },
      { type: "showAnyway" },
      { type: "retakeReason", reason: "시간 부족" },
    );
    s = run(s, { type: "retake" }, { type: "video/opening" });
    expect(s.showAnyway).toBe(false);
    expect(s.retakeReason).toBeNull();
    expect(s.chosenRank).toBeNull();
    expect(s.analysis.status).toBe("idle");
  });
});

describe("flow — 후보·메모를 바꾸면 만들어 둔 저장 파일을 버린다", () => {
  const ready = { status: "ready" as const, files: [] };

  it("후보를 바꾸면 저장 파일이 비워지고 큰 그림을 다시 만들어야 한다", async () => {
    const result = await pickedResult();
    expect(result.runnerUps.length).toBeGreaterThan(0);
    const s = run(
      analyzing(withReference()),
      { type: "analysis/done", result },
      { type: "imageStatus", status: "ready" },
      { type: "export", exportState: ready },
    );
    const other = result.runnerUps[0].rank;
    const t = run(s, { type: "candidate", rank: other });
    expect(t.chosenRank).toBe(other);
    expect(t.exportState.status).toBe("idle");
    expect(t.imageStatus).toBe("idle");
  });

  it("없는 순위나 같은 순위로는 바뀌지 않는다", async () => {
    const s = run(analyzing(withReference()), { type: "analysis/done", result: await pickedResult() });
    expect(run(s, { type: "candidate", rank: 99 })).toBe(s);
    expect(run(s, { type: "candidate", rank: 1 })).toBe(s);
  });

  it("메모·사유·사진 종류가 바뀌면 비워지고, 같은 값이면 그대로다", async () => {
    const s = run(
      analyzing(withReference()),
      { type: "analysis/done", result: await pickedResult() },
      { type: "export", exportState: ready },
    );
    expect(run(s, { type: "memo", memo: "a" }).exportState.status).toBe("idle");
    expect(run(s, { type: "retakeReason", reason: "기타" }).exportState.status).toBe("idle");
    expect(run(s, { type: "shotKind", shotKind: "frontDown" }).exportState.status).toBe("idle");
    expect(run(s, { type: "memo", memo: "" })).toBe(s);
    expect(run(s, { type: "shotKind", shotKind: "front" })).toBe(s);
  });

  it("메모는 정한 길이에서 자른다", () => {
    const s = run(initialState(), { type: "memo", memo: "가".repeat(MEMO_MAX + 50) });
    expect(s.memo.length).toBe(MEMO_MAX);
  });
});

describe("flow — 떠나면 사라지는 일이 있는가", () => {
  it("분석 중이거나 고른 결과가 떠 있을 때만 true", async () => {
    expect(hasUnsavedWork(initialState())).toBe(false);
    expect(hasUnsavedWork(withReference())).toBe(false);
    expect(hasUnsavedWork(run(withReference(), { type: "step", step: "video" }))).toBe(false);
    expect(hasUnsavedWork(run(withReference(), { type: "video/opening" }))).toBe(true);
    const a = analyzing(withReference());
    expect(hasUnsavedWork(a)).toBe(true);
    const done = run(a, { type: "analysis/done", result: await pickedResult() });
    expect(hasUnsavedWork(done)).toBe(true);
    // 다시 찍으러 동영상 단계로 돌아가면 결과는 아직 들고 있지만 보고 있지 않다.
    expect(hasUnsavedWork(run(done, { type: "retake" }))).toBe(false);
    // 멈춘 결과(쓸 수 있는 장면 없음)와 취소에는 잃을 것이 없다.
    expect(hasUnsavedWork(run(a, { type: "analysis/done", result: await stoppedResult() }))).toBe(false);
    expect(hasUnsavedWork(run(a, { type: "analysis/cancelled" }))).toBe(false);
    expect(hasUnsavedWork(run(done, { type: "reset" }))).toBe(false);
  });
});

describe("flow — 화면 꺼짐", () => {
  it("분석 중에 숨겨졌을 때만 표시한다", () => {
    expect(run(withReference(), { type: "hidden" }).hiddenDuringAnalysis).toBe(false);
    expect(run(analyzing(withReference()), { type: "hidden" }).hiddenDuringAnalysis).toBe(true);
  });
});

describe("flow — 처음부터", () => {
  it("고른 사진 종류만 남기고 전부 비운다", async () => {
    const s = run(
      run(initialState(), { type: "shotKind", shotKind: "leftOblique" }, { type: "reference/reading" }, {
        type: "reference/ready",
        info: info(),
      }),
      { type: "video/opening" },
      { type: "video/ready", info: videoInfo },
      { type: "analysis/done", result: await pickedResult() },
      { type: "reset" },
    );
    expect(s).toEqual(initialState("leftOblique"));
  });
});
