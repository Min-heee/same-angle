"use client";

/**
 * 고르기 화면(/pick/)의 껍데기: 접착부(`session.ts`)를 만들고, 상태를 조각(`parts.tsx`)에 나눠 준다.
 *
 * 이 화면은 **카메라 권한을 묻지 않는다.** 파일만 받는다("지금 바로 찍기"는 폰의 카메라 앱이
 * 찍어서 파일로 넘겨주는 것이고, 브라우저가 카메라를 여는 것이 아니다 — 실기기 확인 전).
 *
 * 네트워크: 화면이 뜨자마자 fetch 가드를 깐다(얼굴 모델을 부르기 전에도). 사진·동영상을 보내는
 * 코드는 없다.
 */

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { installFetchGuard } from "@/spike/netguard";
import { viewToTrace } from "../direction";
import { RULES } from "../rules";
import { browserDeps } from "./browser";
import { RETAKE_LIMIT, hasUnsavedWork, pickedOf, retakeCountOf } from "./flow";
import { AnalyzingStep, ReferenceStep, ResultStep, Stepper, StoppedStep, VideoStep } from "./parts";
import s from "./pick.module.css";
import { createPickSession, type PickSession } from "./session";
import { candidateOf, holdBackView, progressView, resultView, saveGate, tracePlot, traceOfCandidate } from "./view";

type WakeLockLike = { release(): Promise<void> };

const LEAVE_CONFIRM = "이 화면을 떠나면 분석 결과와 아직 받지 않은 파일이 사라집니다. 떠날까요?";

/** 분석하는 동안 화면이 꺼지지 않게 부탁한다. 안 되는 브라우저에서는 조용히 넘어간다(안내 문장이 있다). */
function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let lock: WakeLockLike | null = null;
    let gone = false;
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockLike> } };
    nav.wakeLock?.request("screen").then(
      (l) => {
        if (gone) void l.release().catch(() => {});
        else lock = l;
      },
      () => {},
    );
    return () => {
      gone = true;
      if (lock) void lock.release().catch(() => {});
    };
  }, [active]);
}

function PickScreen({ session }: { session: PickSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const running = state.step === "analyzing";
  useWakeLock(running);

  useEffect(() => {
    if (!running) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") session.noteHidden();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [running, session]);

  // 분석 중이거나 결과가 떠 있을 때 새로 고치거나 창을 닫으면 브라우저가 한 번 묻게 한다.
  // 분석과 저장 전 파일은 기기 메모리에만 있어 그대로 사라진다(아이폰 사파리는 이 물음을 무시할 수 있다).
  const unsaved = hasUnsavedWork(state);
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);

  // 단계가 바뀌면 맨 위로. 긴 안내를 읽다가 다음 단계의 머리를 놓치지 않게.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [state.step]);

  const refInfo = state.reference.status === "ready" ? state.reference.info : null;
  const vidInfo = state.video.status === "ready" ? state.video.info : null;
  const picked = pickedOf(state);
  const passDeg = RULES.select.passDeg;
  const retakeCount = retakeCountOf(state);

  const view = useMemo(() => {
    if (!picked || !refInfo || !vidInfo || state.chosenRank === null) return null;
    return resultView({
      reference: refInfo.measured,
      referenceOriginal: { width: refInfo.width, height: refInfo.height },
      videoNative: { width: vidInfo.width, height: vidInfo.height },
      videoDurationSec: vidInfo.durationSec,
      analysis: picked,
      chosenRank: state.chosenRank,
    });
  }, [picked, refInfo, vidInfo, state.chosenRank]);

  const plot = useMemo(() => {
    if (!refInfo || state.analysis.status !== "done") return null;
    const chosen = picked && state.chosenRank !== null ? candidateOf(picked, state.chosenRank) : null;
    return tracePlot(
      state.analysis.result.trace,
      viewToTrace(refInfo.measured.face.view),
      chosen ? traceOfCandidate(chosen) : null,
      passDeg,
    );
  }, [refInfo, state.analysis, picked, state.chosenRank, passDeg]);

  let body;
  if (state.step === "reference") {
    body = (
      <ReferenceStep
        shotKind={state.shotKind}
        status={state.reference.status}
        failure={state.reference.status === "failed" ? state.reference.failure : null}
        modelMessage={state.modelMessage}
        info={refInfo}
        onShotKind={session.setShotKind}
        onFile={(file) => void session.chooseReference(file)}
        onRetry={() => void session.retryReference()}
        onNext={session.goToVideo}
      />
    );
  } else if (state.step === "video") {
    const failure =
      state.video.status === "failed"
        ? state.video.failure
        : state.analysis.status === "failed"
          ? state.analysis.failure
          : null;
    body = (
      <VideoStep
        shotKind={state.shotKind}
        failure={failure}
        cancelled={state.analysis.status === "cancelled"}
        retakeCount={retakeCount}
        onFile={(file) => void session.chooseVideo(file)}
        onBack={session.backToReference}
      />
    );
  } else if (state.step === "analyzing") {
    const a = state.analysis.status === "running" ? state.analysis : null;
    const tooLong = vidInfo !== null && vidInfo.durationSec > RULES.sampling.maxDurationSec;
    body = (
      <AnalyzingStep
        video={vidInfo}
        progress={progressView(a?.progress ?? null, a?.quickAnswer ?? null)}
        cancelling={a?.cancelling ?? false}
        truncatedSec={tooLong ? RULES.sampling.maxDurationSec : null}
        onCancel={session.cancel}
      />
    );
  } else if (view && plot && refInfo && state.chosenRank !== null) {
    body = (
      <ResultStep
        view={view}
        passDeg={passDeg}
        referenceUrl={refInfo.previewUrl}
        aspect={refInfo.width / refInfo.height}
        images={state.images}
        chosenRank={state.chosenRank}
        imageStatus={state.imageStatus}
        showAnyway={state.showAnyway}
        hiddenDuringAnalysis={state.hiddenDuringAnalysis}
        plot={plot}
        gate={saveGate(view.verdict, retakeCount, RETAKE_LIMIT)}
        holdBack={holdBackView(view, retakeCount, RETAKE_LIMIT)}
        memo={state.memo}
        retakeReason={state.retakeReason}
        exportState={state.exportState}
        onShowAnyway={session.showAnyway}
        onRetake={session.retake}
        onReset={session.reset}
        onChoose={(rank) => void session.chooseCandidate(rank)}
        onMemo={session.setMemo}
        onReason={session.setRetakeReason}
        onPrepare={() => void session.prepareExport()}
      />
    );
  } else if (state.analysis.status === "done" && state.analysis.result.kind === "stopped") {
    const r = state.analysis.result;
    body = (
      <StoppedStep
        failure={{ kind: "stop", code: r.stop, excluded: r.excluded, multipleFaces: r.multipleFaces }}
        plot={plot}
        passDeg={passDeg}
        onRetake={session.retake}
        onReset={session.reset}
      />
    );
  } else {
    body = (
      <section className={s.card}>
        <p>보여 줄 결과가 없습니다.</p>
        <div className={s.actions}>
          <button type="button" className={s.btn} onClick={session.reset}>
            처음부터
          </button>
        </div>
      </section>
    );
  }

  return (
    <>
      <Stepper step={state.step} />
      {body}
    </>
  );
}

export default function PickApp() {
  const [session, setSession] = useState<PickSession | null>(null);

  useEffect(() => {
    // 얼굴 모델을 부르기 전에도 허용 목록 밖 요청을 막아 둔다.
    installFetchGuard();
    const created = createPickSession(browserDeps);
    setSession(created);
    return () => {
      created.dispose();
      setSession(null);
    };
  }, []);

  return (
    <main className={s.page}>
      <header className={s.header}>
        <Link
          href="/"
          className={s.home}
          onClick={(e) => {
            // 앱 안에서 옮겨 가는 것이라 브라우저가 묻지 않는다. 사라질 것이 있으면 여기서 묻는다.
            if (session && hasUnsavedWork(session.getState()) && !window.confirm(LEAVE_CONFIRM)) e.preventDefault();
          }}
        >
          같은각도 처음으로
        </Link>
        <h1>동영상에서 같은 각도 사진 고르기</h1>
        <p className={s.lede}>
          지난번 사진과 가장 가까운 장면을 동영상에서 골라, 기울기·크기·위치를 맞춰 줍니다. 얼굴이 보이는 사진만 됩니다.
        </p>
      </header>

      {session ? <PickScreen session={session} /> : <p className={s.muted}>준비하는 중…</p>}

      <footer className={s.footer}>
        <p>사진과 동영상은 이 기기 안에서만 처리합니다. 얼굴을 찾는 프로그램 파일만 처음 한 번 받습니다(모델 파일은 Google 서버에서).</p>
        <p>의료기기가 아닙니다. 모발·두피 상태나 치료 효과를 판단하지 않습니다.</p>
        <p>실제 얼굴 동영상으로 검증하기 전입니다. 숫자와 기준값은 전부 초깃값입니다.</p>
      </footer>
    </main>
  );
}
