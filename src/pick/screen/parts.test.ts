import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { viewToTrace } from "../direction";
import { ALWAYS_SHOWN } from "../messages";
import { RULES, RULES_VERSION } from "../rules";
import { fakeBrowser, referenceMeasured, type FakeOptions } from "./fakes";
import { RETAKE_LIMIT, pickedOf, retakeCountOf, type PickState } from "./flow";
import { SAY, NOT_FOR } from "./guide";
import { OTHER_FACE_NOTE } from "./failure";
import {
  AnalyzingStep,
  COMPARE_INITIAL,
  CandidateStrip,
  CompareView,
  FailureBox,
  FilePick,
  ReferenceStep,
  ResultStep,
  SavePanel,
  Stepper,
  StoppedStep,
  TraceFigure,
  VideoStep,
} from "./parts";
import { createPickSession } from "./session";
import {
  NAME_WINNER,
  candidateOf,
  holdBackView,
  progressView,
  resultView,
  saveGate,
  tracePlot,
  traceOfCandidate,
} from "./view";

/*
 * 화면 조각을 노드에서 문자열(HTML)로 그려 본다. 브라우저 없이 확인할 수 있는 것만 본다:
 * 무엇이 보이고 무엇이 안 보이는가, 문구 규칙을 지키는가. 누르기·겹쳐 보기 같은 동작과 실제
 * 모양(390px 에서 버튼 크기 등)은 여기서 확인하지 못한다.
 *
 * 결과 화면의 값은 가짜 측정값을 넣은 접착부(session)가 만든 상태에서 그대로 가져온다.
 */

const html = (el: ReactElement) => renderToStaticMarkup(el);
const noop = () => {};
const PHOTO = new Blob(["p"]);
const VIDEO = new Blob(["v"]);

async function resultState(opts: FakeOptions = {}): Promise<PickState> {
  const session = createPickSession(fakeBrowser(opts).deps);
  await session.chooseReference(PHOTO);
  await session.chooseVideo(VIDEO);
  return session.getState();
}

/** 상태에서 결과 화면의 속성을 만든다(PickApp 이 하는 일과 같다). */
function resultProps(s: PickState, over: Partial<Parameters<typeof ResultStep>[0]> = {}) {
  const picked = pickedOf(s)!;
  if (s.reference.status !== "ready" || s.video.status !== "ready" || s.chosenRank === null) throw new Error("결과 없음");
  const ref = s.reference.info;
  const view = resultView({
    reference: ref.measured,
    referenceOriginal: { width: ref.width, height: ref.height },
    videoNative: { width: s.video.info.width, height: s.video.info.height },
    videoDurationSec: s.video.info.durationSec,
    analysis: picked,
    chosenRank: s.chosenRank,
  })!;
  const plot = tracePlot(
    picked.trace,
    viewToTrace(ref.measured.face.view),
    traceOfCandidate(candidateOf(picked, s.chosenRank)!),
  );
  return {
    view,
    passDeg: RULES.select.passDeg,
    referenceUrl: ref.previewUrl,
    aspect: ref.width / ref.height,
    images: s.images,
    chosenRank: s.chosenRank,
    imageStatus: s.imageStatus,
    showAnyway: s.showAnyway,
    hiddenDuringAnalysis: s.hiddenDuringAnalysis,
    plot,
    gate: saveGate(view.verdict, retakeCountOf(s), RETAKE_LIMIT),
    holdBack: holdBackView(view, retakeCountOf(s), RETAKE_LIMIT),
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

const FORBIDDEN = /전후|시술 전|시술 후|개선|호전|→|➜|✅|✔|합격|불합격/;
const DIRECTION = /더 왼쪽|더 오른쪽|왼쪽으로 더|오른쪽으로 더/;

describe("단계 표시줄", () => {
  it("네 단계가 있고 지금 단계가 표시된다", () => {
    const out = html(createElement(Stepper, { step: "analyzing" }));
    // 저장은 결과 화면 안에 있어서 넷째 단계의 이름에 함께 적는다(표시줄에 없는 다섯째 단계를 두지 않는다).
    for (const name of ["1. 기준 사진", "2. 동영상", "3. 분석", "4. 결과·저장"]) expect(out).toContain(name);
    expect(out.match(/<li/g)).toHaveLength(4);
    expect(out.match(/aria-current="step"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-current="step"[^>]*>3\. 분석/);
  });
});

describe("파일 고르기", () => {
  it("사진은 image/*, 동영상은 video/* 만 받는다", () => {
    expect(html(createElement(FilePick, { label: "기준 사진 고르기", accept: "image/*", onFile: noop }))).toContain(
      'accept="image/*"',
    );
    const video = html(createElement(VideoStep, { shotKind: "front", failure: null, cancelled: false, retakeCount: 0, onFile: noop, onBack: noop }));
    expect(video.match(/accept="video\/\*"/g)).toHaveLength(2);
  });

  it("'지금 바로 찍기'에만 capture 가 붙는다(앱 안 녹화가 아니라 폰 카메라가 파일을 넘긴다)", () => {
    const out = html(createElement(VideoStep, { shotKind: "front", failure: null, cancelled: false, retakeCount: 0, onFile: noop, onBack: noop }));
    expect(out.match(/capture="environment"/g)).toHaveLength(1);
    expect(out).toContain("동영상 고르기");
    expect(out).toContain("지금 바로 찍기");
  });

  it("어느 화면에도 <form> 이 없다(CSP form-action 'none')", async () => {
    const s = await resultState();
    const all = [
      html(createElement(ReferenceStep, { shotKind: "front", status: "empty", failure: null, modelMessage: null, info: null, onShotKind: noop, onFile: noop, onRetry: noop, onNext: noop })),
      html(createElement(VideoStep, { shotKind: "front", failure: null, cancelled: false, retakeCount: 0, onFile: noop, onBack: noop })),
      html(createElement(ResultStep, resultProps(s))),
    ].join("");
    expect(all).not.toMatch(/<form/);
  });
});

describe("① 기준 사진", () => {
  const base = { shotKind: "front" as const, failure: null, modelMessage: null, info: null, onShotKind: noop, onFile: noop, onRetry: noop, onNext: noop };

  it("처음에는 사진 종류 네 가지와 고르기 버튼만 있고, 다음으로 가는 버튼은 없다", () => {
    const out = html(createElement(ReferenceStep, { ...base, status: "empty" }));
    for (const kind of ["정면", "정면 숙임", "왼쪽 사선", "오른쪽 사선"]) expect(out).toContain(`>${kind}</button>`);
    expect(out).toContain("기준 사진 고르기");
    expect(out).toContain("얼굴이 보이는 사진만");
    expect(out).not.toContain("다음: 동영상 고르기");
  });

  it("읽는 동안: 처음 한 번 받는 파일이 있다는 것과 사진이 기기 안에만 있다는 것을 말한다", () => {
    const out = html(createElement(ReferenceStep, { ...base, status: "reading", modelMessage: "모듈 불러오는 중…" }));
    expect(out).toContain("얼굴을 찾는 중");
    expect(out).toContain("이 기기 안에서만");
    expect(out).toContain("모듈 불러오는 중…");
    // 얼굴 모델 라이브러리의 진행 원문은 개발자용으로 접어 둔다.
    expect(out).toMatch(/<details[^>]*><summary>자세히\(개발자용\)<\/summary><p[^>]*>모듈 불러오는 중…/);
    expect(out).toMatch(/<input[^>]*disabled/);
  });

  it("얼굴 없음(S1): 쉬운 말로 이유를 말하고 다음 버튼이 없다", () => {
    const out = html(createElement(ReferenceStep, { ...base, status: "failed", failure: { kind: "stop", code: "S1", reason: "noFace" } }));
    expect(out).toContain("얼굴이 보이지 않아 각도를 잴 수 없습니다");
    expect(out).toContain('role="alert"');
    expect(out).not.toContain("다음: 동영상 고르기");
    expect(out).not.toContain("같은 사진으로 다시 해 보기");
  });

  it("모델을 받지 못했을 때만 '같은 사진으로 다시 해 보기'가 나온다", () => {
    const out = html(createElement(ReferenceStep, { ...base, status: "failed", failure: { kind: "model", detail: "TypeError: Failed to fetch" } }));
    expect(out).toContain("인터넷 연결을 확인");
    expect(out).toContain("같은 사진으로 다시 해 보기");
    expect(out).toContain("TypeError: Failed to fetch");
  });

  it("준비되면: 미리보기·크기·'이 환자의 사진이 맞는지'·다음 버튼", () => {
    const out = html(createElement(ReferenceStep, { ...base, status: "ready", info: { width: 3024, height: 4032, previewUrl: "blob:x/1" } }));
    expect(out).toContain('src="blob:x/1"');
    expect(out).toContain("3024×4032");
    expect(out).toContain("이 환자의 사진이 맞는지 확인해 주세요");
    expect(out).toContain("사람을 확인하지 않습니다");
    expect(out).toContain("다음: 동영상 고르기");
  });

  it("숙임·사선을 고르면 '아직 확인하지 못했다'가 보인다", () => {
    expect(html(createElement(ReferenceStep, { ...base, status: "empty", shotKind: "frontDown" }))).toContain("확인하지 못했습니다");
    expect(html(createElement(ReferenceStep, { ...base, status: "empty" }))).not.toContain("확인하지 못했습니다");
  });
});

describe("② 동영상", () => {
  const base = { failure: null, cancelled: false, retakeCount: 0, onFile: noop, onBack: noop };

  it("고른 사진 종류에 맞는 안내 문장과, 이 방법을 쓰지 않는 경우가 보인다", () => {
    for (const kind of ["front", "frontDown", "leftOblique"] as const) {
      const out = html(createElement(VideoStep, { ...base, shotKind: kind }));
      expect(out).toContain(SAY[kind].line);
      expect(out).toContain(NOT_FOR);
    }
  });

  it("찍은 동영상이 소리와 함께 폰에 남는다고 알린다", () => {
    expect(html(createElement(VideoStep, { ...base, shotKind: "front" }))).toContain("소리와 함께 폰에 남습니다");
  });

  it("동영상을 열 수 없으면(S3) 이유와 형식 안내가 보인다", () => {
    const out = html(createElement(VideoStep, { ...base, shotKind: "front", failure: { kind: "stop", code: "S3" } }));
    expect(out).toContain("이 동영상은 이 브라우저에서 열 수 없습니다");
    expect(out).toContain("HEVC");
  });

  it("취소한 뒤에는 취소했다고 알린다", () => {
    expect(html(createElement(VideoStep, { ...base, shotKind: "front", cancelled: true }))).toContain("분석을 취소했습니다");
  });
});

describe("③ 분석", () => {
  const video = { width: 1080, height: 1920, durationSec: 12.34 };

  it("받은 동영상의 해상도·길이, 몇 장면 중 몇 장면, 취소 버튼, 화면 꺼짐 안내가 보인다", () => {
    const out = html(
      createElement(AnalyzingStep, {
        video,
        progress: progressView({ phase: "coarse", done: 7, total: 24 }, null),
        cancelling: false,
        truncatedSec: null,
        onCancel: noop,
      }),
    );
    expect(out).toContain("1080×1920, 12.3초");
    expect(out).toContain("24장면 중 7장면");
    expect(out).toContain(">취소</button>");
    expect(out).toContain("이 화면을 켜 두세요");
    expect(out).toContain("어디로도 보내지 않습니다");
    expect(out).toMatch(/role="progressbar"[^>]*aria-valuenow="13"/);
  });

  it("빠른 답이 오면 보이고, 취소를 누른 뒤에는 버튼이 잠긴다", () => {
    const out = html(
      createElement(AnalyzingStep, {
        video,
        progress: progressView({ phase: "fine", done: 1, total: 30 }, { answer: "notNear", minAngleDeg: 14 }),
        cancelling: true,
        truncatedSec: 60,
        onCancel: noop,
      }),
    );
    expect(out).toContain("기준 자세 근처를 지나가지 않은 것 같습니다");
    expect(out).toContain("취소하는 중…");
    expect(out).toMatch(/<button[^>]*disabled/);
    expect(out).toContain("앞 60초만 봅니다");
  });
});

describe("④ 결과 — 가까운 장면", () => {
  it("제목·각도 차·기준 사진/이번 사진 라벨·보정 표시·상시 문장 세 줄·저장이 보인다", async () => {
    const s = await resultState();
    const out = html(createElement(ResultStep, resultProps(s)));
    expect(out).toContain("가까운 장면을 골랐습니다");
    expect(out).toContain(`통과 기준 ${RULES.select.passDeg}° 이하`);
    expect(out).toContain("기준 사진");
    expect(out).toContain("이번 사진");
    expect(out).toContain("기울기·크기·위치 맞춤");
    for (const line of ALWAYS_SHOWN) expect(out).toContain(line.replace(/'/g, "&#x27;"));
    expect(out).toContain('id="pick-save"');
    // 단계 표시줄에 없는 "⑤"를 쓰지 않는다.
    expect(out).not.toContain("⑤");
    expect(out).toContain("저장할 파일 만들기");
    expect(out).toContain(RULES_VERSION);
  });

  it("각도 차와 보정량(기울기·크기·늘려 그린 배율·위치)은 접지 않고 보인다", async () => {
    const out = html(createElement(ResultStep, resultProps(await resultState())));
    const fold = out.indexOf("<summary>숫자 더 보기</summary>");
    expect(fold).toBeGreaterThan(0);
    const open = out.slice(0, fold);
    for (const label of ["각도 차", "맞춘 기울기", "얼굴 크기 차", "늘려 그린 배율", "위치 차"]) {
      expect(open).toContain(`<dt>${label}</dt>`);
      // 접힌 표에 한 번 더 나오지 않는다.
      expect(out.slice(fold)).not.toContain(`<dt>${label}</dt>`);
    }
    expect(out.slice(fold)).toContain("<dt>뺀 장면</dt>");
    // 저장이 맨 아래에 있다는 것과 그리로 가는 링크.
    expect(open).toContain('href="#pick-save"');
  });

  it("경고는 사진보다 먼저 나온다(판정 상자 바로 아래)", async () => {
    // 세로 기준 사진에 가로 동영상: 방향이 다르다는 경고(W12)가 뜬다.
    const s = await resultState({ videoSize: { width: 1920, height: 1080 } });
    const props = resultProps(s);
    expect(props.view.warnings.shown.length).toBeGreaterThan(0);
    const out = html(createElement(ResultStep, props));
    const firstWarning = out.indexOf(props.view.warnings.shown[0]);
    expect(firstWarning).toBeGreaterThan(out.indexOf(props.view.summary));
    expect(firstWarning).toBeLessThan(out.indexOf("<img"));
    expect(firstWarning).toBeLessThan(out.indexOf("다른 후보로 바꾸기"));
  });

  it("기준 사진과 고른 장면의 보정본이 나란히 그려진다", async () => {
    const s = await resultState();
    const out = html(createElement(ResultStep, resultProps(s)));
    expect(out).toContain(`src="${s.reference.status === "ready" ? s.reference.info.previewUrl : ""}"`);
    expect(out).toContain(`src="${s.images[1].correctedUrl}"`);
    expect(out).not.toContain(`src="${s.images[1].originalUrl}"`);
  });

  it("후보 썸네일이 후보 수만큼 있고, 지금 보는 것 하나만 눌린 상태다", async () => {
    const s = await resultState();
    const props = resultProps(s);
    const out = html(
      createElement(CandidateStrip, { candidates: props.view.candidates, images: s.images, aspect: 0.75, onChoose: noop }),
    );
    expect(out.match(/<button/g)).toHaveLength(props.view.candidates.length);
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
    for (const c of props.view.candidates) expect(out).toContain(`src="${s.images[c.rank].thumbUrl}"`);
  });

  it("후보를 바꿔도 '도구가 고른 장면'은 1등에 남고, '지금 보는 장면'만 옮겨 간다", async () => {
    const session = createPickSession(fakeBrowser().deps);
    await session.chooseReference(PHOTO);
    await session.chooseVideo(VIDEO);
    const strip = (s: PickState) => {
      const props = resultProps(s);
      expect(props.view.candidates.length).toBeGreaterThan(1);
      return html(
        createElement(CandidateStrip, { candidates: props.view.candidates, images: s.images, aspect: 0.75, onChoose: noop }),
      );
    };
    const before = strip(session.getState());
    await session.chooseCandidate(2);
    const after = strip(session.getState());
    for (const out of [before, after]) {
      expect(out.match(new RegExp(NAME_WINNER, "g"))).toHaveLength(2); // 이름표 + 낭독용 이름
      expect(out.match(/>지금 보는 장면</g)).toHaveLength(1);
      // 이름만으로 "고른 장면"이라고 적지 않는다(사람이 고른 것과 헷갈린다).
      expect(out).not.toMatch(/>고른 장면</);
    }
    // 처음에는 1등이, 바꾼 뒤에는 후보 1이 "지금 보는 장면"이다.
    expect(before).toMatch(new RegExp(`aria-pressed="true"[^>]*aria-label="${NAME_WINNER}[^"]*지금 보는 장면"`));
    expect(after).toMatch(/aria-pressed="true"[^>]*aria-label="후보 1[^"]*지금 보는 장면"/);
  });

  it("작은 그림의 틀은 기준 사진과 같은 모양이다(가로 사진이 세로 틀에 잘리지 않게)", async () => {
    const s = await resultState();
    const candidates = resultProps(s).view.candidates;
    const wide = html(createElement(CandidateStrip, { candidates, images: s.images, aspect: 4 / 3, onChoose: noop }));
    expect(wide).toContain(`aspect-ratio:${4 / 3}`);
    const tall = html(createElement(CandidateStrip, { candidates, images: s.images, aspect: 0.75, onChoose: noop }));
    expect(tall).toContain("aspect-ratio:0.75");
  });

  it("후보가 1등뿐이면 바꿀 후보가 없다고 말한다", async () => {
    const s = await resultState();
    const one = resultProps(s).view.candidates.slice(0, 1);
    const out = html(createElement(CandidateStrip, { candidates: one, images: s.images, aspect: 0.75, onChoose: noop }));
    expect(out).toContain("바꿔 볼 다른 후보가 없습니다");
    expect(out).not.toContain("<button");
  });

  it("전후 표현·화살표·판정 장식·방향 지시가 없다", async () => {
    const out = html(createElement(ResultStep, resultProps(await resultState())));
    expect(out).not.toMatch(FORBIDDEN);
    expect(out).not.toMatch(DIRECTION);
  });

  it("그림을 만드는 중이거나 못 만들었으면 그 사실을 사진 자리에 적는다", () => {
    const base = {
      referenceUrl: "blob:r",
      aspect: 0.75,
      images: null,
      correctionAvailable: true,
      timeText: "약 1.0초",
      state: COMPARE_INITIAL,
      onState: noop,
    };
    expect(html(createElement(CompareView, { ...base, imageStatus: "rendering" }))).toContain("그림을 만드는 중");
    expect(html(createElement(CompareView, { ...base, imageStatus: "failed" }))).toContain("그림을 만들지 못했습니다");
  });

  it("보정본을 만들 수 없으면 원본 장면을 보이고 '맞춘 것'은 누를 수 없다", () => {
    const out = html(
      createElement(CompareView, {
        referenceUrl: "blob:r",
        aspect: 0.75,
        images: { thumbUrl: null, originalUrl: "blob:o", correctedUrl: null, grabbedTimeSec: null },
        imageStatus: "ready",
        correctionAvailable: false,
        timeText: "약 1.0초",
        state: COMPARE_INITIAL,
        onState: noop,
      }),
    );
    expect(out).toContain('src="blob:o"');
    expect(out).toMatch(/<button[^>]*disabled[^>]*>맞춘 것/);
    expect(out).toContain("원본 장면 · 동영상의 약 1.0초");
  });

  it("겹쳐 보기: 받은 보기 상태대로 그리고, 진하기 조절이 그림보다 위에 있다", () => {
    const out = html(
      createElement(CompareView, {
        referenceUrl: "blob:r",
        aspect: 0.75,
        images: { thumbUrl: null, originalUrl: "blob:o", correctedUrl: "blob:c", grabbedTimeSec: null },
        imageStatus: "ready",
        correctionAvailable: true,
        timeText: "약 1.0초",
        state: { mode: "overlay", variant: "original", opacity: 35 },
        onState: noop,
      }),
    );
    expect(out).toContain("진하기 35%");
    expect(out).toContain("opacity:0.35");
    // 원본을 보고 있었으면 원본 그대로다(후보를 바꿔도 보기 상태는 결과 화면이 들고 있다).
    expect(out).toContain('src="blob:o"');
    expect(out).not.toContain('src="blob:c"');
    expect(out.indexOf('type="range"')).toBeLessThan(out.indexOf("<img"));
    // 그림 높이를 화면 높이 안으로 누른다(넓은 화면에서 그림과 조절이 한 화면에 들어오게).
    expect(out).toMatch(/max-width:calc\(\d+vh \* 0\.7500\)/);
  });

  it("분석 중에 화면이 꺼졌으면 결과 위에 알린다", async () => {
    const s = await resultState();
    expect(html(createElement(ResultStep, resultProps(s, { hiddenDuringAnalysis: true })))).toContain("화면이 꺼졌거나");
    expect(html(createElement(ResultStep, resultProps(s)))).not.toContain("화면이 꺼졌거나");
  });
});

describe("④ 결과 — 가까운 장면 없음", () => {
  const far: FakeOptions = { reference: () => referenceMeasured({ h: 20, v: 0 }) };

  it("사진을 보이기 전에 다시 찍기를 먼저 권하고, 두 버튼과 자취 그림만 보인다", async () => {
    const out = html(createElement(ResultStep, resultProps(await resultState(far))));
    expect(out).toContain("가까운 장면이 없습니다");
    expect(out).toContain("다시 찍기를 권합니다");
    expect(out).toContain("다시 찍은 동영상 고르기");
    expect(out).toContain("그래도 가장 가까운 장면 보기");
    expect(out).toContain("<svg");
    // 사진·후보·저장은 아직 보이지 않는다.
    expect(out).not.toContain("<img");
    expect(out).not.toContain('id="pick-save"');
    expect(out).not.toContain("다른 후보로 바꾸기");
    // 주 버튼(첫 버튼)은 다시 찍기다.
    expect(out.indexOf("다시 찍은 동영상 고르기")).toBeLessThan(out.indexOf("그래도 가장 가까운 장면 보기"));
  });

  it("다시 찍기 상한을 채우면 첫 화면부터 '더 찍지 않아도 된다'고 말하고, 주 버튼이 보고 저장하기로 바뀐다", async () => {
    const s = await resultState(far);
    const props = resultProps(s);
    const out = html(
      createElement(ResultStep, {
        ...props,
        gate: saveGate(props.view.verdict, RETAKE_LIMIT, RETAKE_LIMIT),
        holdBack: holdBackView(props.view, RETAKE_LIMIT, RETAKE_LIMIT),
      }),
    );
    expect(out).toContain("가까운 장면이 없습니다");
    expect(out).toContain(`${RETAKE_LIMIT}번 다시 찍었습니다`);
    expect(out).toContain("더 찍지 않아도 됩니다");
    expect(out).not.toContain("다시 찍기를 권합니다");
    expect(out).toContain("가장 가까운 장면 보고 저장하기");
    expect(out.indexOf("가장 가까운 장면 보고 저장하기")).toBeLessThan(out.indexOf("한 번 더 찍은 동영상 고르기"));
    // 상한을 채워도 사진은 눌러야 보인다(가까운 장면 없음을 먼저 읽게 한다).
    expect(out).not.toContain("<img");
    expect(out).not.toMatch(DIRECTION);

    // 사진을 연 뒤에도 "다시 찍기를 권합니다"를 되풀이하지 않는다. 각도 차와 표시가 남는다는 사실은 그대로 보인다.
    const shown = html(
      createElement(ResultStep, {
        ...props,
        showAnyway: true,
        gate: saveGate(props.view.verdict, RETAKE_LIMIT, RETAKE_LIMIT),
        holdBack: holdBackView(props.view, RETAKE_LIMIT, RETAKE_LIMIT),
      }),
    );
    expect(shown).toContain("<img");
    expect(shown).not.toContain("다시 찍기를 권합니다");
    expect(shown).not.toContain("다시 찍기를 먼저 권합니다");
    expect(shown).toContain(`가장 가까운 장면은 ${props.view.angleText} 차이입니다.`);
    expect(shown).toContain("표시가 남습니다");
    expect(shown).toContain("가까운 장면 없이 저장하는 사유");
  });

  it("어디에도 '가까운 장면을 골랐습니다'·'가까움'이 없다(그래도 보기를 누른 뒤에도)", async () => {
    const s = await resultState(far);
    for (const showAnyway of [false, true]) {
      const out = html(createElement(ResultStep, resultProps(s, { showAnyway })));
      expect(out).not.toContain("가까운 장면을 골랐습니다");
      expect(out).not.toContain("가까운 장면입니다");
      expect(out).not.toContain("· 가까움");
    }
  });

  it("그래도 보기를 누르면 사진과 저장이 열리고, 저장하려면 사유를 골라야 한다", async () => {
    const s = await resultState(far);
    const out = html(createElement(ResultStep, resultProps(s, { showAnyway: true })));
    expect(out).toContain("<img");
    expect(out).toContain("가까운 장면 없이 저장하는 사유");
    for (const reason of ["자세 유지가 어려움", "시간 부족", "기타"]) expect(out).toContain(reason);
    expect(out).toContain("사유를 먼저 골라 주세요");
    expect(out).toMatch(/<button[^>]*disabled[^>]*>저장할 파일 만들기/);
    expect(out).toContain("다시 찍기를 먼저 권합니다");
  });

  it("방향을 말하지 않고, 아직 말해 주지 못한다고 적는다", async () => {
    const out = html(createElement(ResultStep, resultProps(await resultState(far))));
    expect(out).toContain("어느 쪽으로 더 움직여야 하는지는 아직 말해 주지 못합니다");
    expect(out).not.toMatch(DIRECTION);
  });
});

describe("자취 그림", () => {
  it("점의 수가 장면 수와 같고, 축에 왼쪽·오른쪽 글자가 없다", async () => {
    const s = await resultState();
    const props = resultProps(s);
    const out = html(createElement(TraceFigure, { plot: props.plot, passDeg: 3 }));
    // 눈금 원 + 통과 기준 원 + 장면 점 + 지금 보는 장면
    const circles = out.match(/<circle/g)!.length;
    expect(circles).toBe(props.plot.rings.length + 1 + props.plot.points.length + 1);
    const svg = out.slice(out.indexOf("<svg"), out.indexOf("</svg>"));
    expect(svg).not.toMatch(/왼쪽|오른쪽|위|아래/);
    expect(out).toContain("어림 그림");
  });
});

describe("멈춘 결과(S4)", () => {
  it("이유와 뺀 장면 수, 다시 찍은 동영상 고르기가 보인다", async () => {
    const s = await resultState({ alter: () => ({ failure: "noFace" }) });
    if (s.analysis.status !== "done" || s.analysis.result.kind !== "stopped") throw new Error("멈추지 않음");
    const r = s.analysis.result;
    const out = html(
      createElement(StoppedStep, {
        failure: { kind: "stop", code: r.stop, excluded: r.excluded },
        plot: null,
        passDeg: 3,
        onRetake: noop,
        onReset: noop,
      }),
    );
    expect(out).toContain("쓸 수 있는 장면이 없습니다");
    expect(out).toContain("얼굴 없음 22장");
    // 0장인 사유는 적지 않는다.
    expect(out).not.toContain("0장");
    expect(out).not.toContain(OTHER_FACE_NOTE);
    expect(out).toContain("다시 찍은 동영상 고르기");
    expect(out).not.toContain("<img");
  });

  it("다른 얼굴이 함께 찍혀 멈췄으면 '얼굴 없음'이라 하지 않고 원인과 할 일을 말한다", async () => {
    const s = await resultState({ alter: () => ({ failure: "multipleFaces" }) });
    if (s.analysis.status !== "done" || s.analysis.result.kind !== "stopped") throw new Error("멈추지 않음");
    const r = s.analysis.result;
    expect(r.multipleFaces).toBe(22);
    const out = html(
      createElement(StoppedStep, {
        failure: { kind: "stop", code: r.stop, excluded: r.excluded, multipleFaces: r.multipleFaces },
        plot: null,
        passDeg: 3,
        onRetake: noop,
        onReset: noop,
      }),
    );
    expect(out).toContain("얼굴이 둘 이상 22장");
    expect(out).not.toContain("얼굴 없음");
    expect(out).toContain(OTHER_FACE_NOTE);
  });
});

describe("저장(결과 화면 맨 아래)", () => {
  const base = { memo: "", retakeReason: null, imageReady: true, onMemo: noop, onReason: noop, onPrepare: noop };

  it("파일을 만들기 전에는 내려받는 링크가 없다", () => {
    const out = html(createElement(SavePanel, { ...base, gate: saveGate("close", 0, 2), exportState: { status: "idle" } }));
    expect(out).toContain("저장할 파일 만들기");
    expect(out).not.toContain("download=");
    expect(out).toContain("환자 이름 대신 병원에서 쓰는 번호");
  });

  it("만든 뒤에는 세 파일을 하나씩 내려받는 링크가 있고, 이름이 그대로 붙는다", () => {
    const files = [
      { kind: "corrected" as const, label: "보정본 PNG", name: "같은각도_정면_20261002-1430_보정본.png", url: "blob:f/1", bytes: 2_400_000 },
      { kind: "original" as const, label: "원본 장면 PNG", name: "같은각도_정면_20261002-1430_원본장면.png", url: "blob:f/2", bytes: 3_100_000 },
      { kind: "record" as const, label: "기록 JSON", name: "같은각도_정면_20261002-1430_기록.json", url: "blob:f/3", bytes: 5_300 },
    ];
    const out = html(createElement(SavePanel, { ...base, gate: saveGate("close", 0, 2), exportState: { status: "ready", files } }));
    for (const f of files) {
      expect(out).toContain(`href="${f.url}"`);
      expect(out).toContain(`download="${f.name}"`);
      expect(out).toContain(`${f.label} 저장`);
    }
    expect(out).toContain("2.3MB");
    expect(out).toContain("5KB");
    expect(out).toContain("내부 기록용");
    expect(out).toContain("통제하지 못합니다");
    expect(out).not.toContain("저장할 파일 만들기");
  });

  it("그림이 아직 없으면 만들기 버튼이 잠긴다", () => {
    const out = html(createElement(SavePanel, { ...base, imageReady: false, gate: saveGate("close", 0, 2), exportState: { status: "idle" } }));
    expect(out).toMatch(/<button[^>]*disabled[^>]*>저장할 파일 만들기/);
  });

  it("만들지 못했으면 그 사실을 알린다", () => {
    const out = html(createElement(SavePanel, { ...base, gate: saveGate("close", 0, 2), exportState: { status: "failed", detail: "Error: x" } }));
    expect(out).toContain("저장할 파일을 만들지 못했습니다");
    expect(out).toContain('role="alert"');
  });
});

describe("실패 상자", () => {
  it("개발자용 원문은 접어 둔다", () => {
    const out = html(createElement(FailureBox, { failure: { kind: "unknown", detail: "RangeError: x" } }));
    expect(out).toContain("<details");
    expect(out).toContain("RangeError: x");
    expect(out).toContain("알 수 없는 문제로 멈췄습니다");
  });
});
