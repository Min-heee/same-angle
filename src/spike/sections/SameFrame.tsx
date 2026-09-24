"use client";

/**
 * 5. 같은 프레임 비교(실험 0 일부): 한 비디오 프레임을 VIDEO(루프 엔진)·IMAGE CPU·IMAGE GPU
 * 세 경로로 재서 각도 차를 본다.
 *
 * GPU 위임은 예외 없이 조용히 틀릴 수 있다(TECH-NOTES 3절, 세그멘터 #6142). 그래서 같은
 * 픽셀에 CPU 결과를 대조한다. 캔버스로 한 번 떠 둔 프레임을 세 경로에 똑같이 넣는다.
 * VIDEO 는 버튼을 누른 즉시(다른 await 전에) 재서, 루프와 같은 엔진·같은 타임스탬프 규칙을 쓴다.
 *
 * IMAGE GPU 엔진은 비교 한 번마다 만들고 끝나면 닫는다. 엔진마다 WASM 인스턴스와 WebGL 캔버스가
 * 따로 생기므로, 페이지 내내 VIDEO + IMAGE CPU + IMAGE GPU 세 개를 쥐고 있으면 아이폰 탭이
 * 메모리로 쫓겨나기 쉽다. 그 대가로 GPU 초기화 시간이 매번 기록된다(그것도 결과다).
 * IMAGE CPU 는 6·7번과 같이 쓰므로 공유 캐시에 둔다.
 */

import { useCallback, useEffect, useState } from "react";
import type { JsonValue } from "@/core/report";
import { diffSamples, sampleToJson } from "../compare";
import { useSpike } from "../context";
import { restoredList } from "../draft";
import { summarizeResult, type FrameSample } from "../sample";
import { grabVideoFrame, releaseCanvas } from "../canvas";
import { engineCounts, loadFaceLandmarker, type EngineCounts } from "../engine";
import s from "../spike.module.css";
import { Json, Section } from "../ui";
import { errText, fmt, num } from "../util";

interface Run {
  frame: string;
  videoEngine: string;
  results: Record<string, JsonValue>;
  diffsVsVideo: Record<string, JsonValue>;
  imageInitMs: Record<string, number | null>;
  /** 비교가 끝난 뒤(GPU 엔진을 닫은 뒤)의 엔진 인스턴스 수. */
  engines: EngineCounts;
  errors: string[];
}

export function SameFrameSection() {
  const { engine, videoRef, nextTs, imageEngine, sections, setSection, restored } = useSpike();
  const sec = sections.sameFrame;
  const [runs, setRuns] = useState<Run[]>(() => restoredList<Run>(restored?.sections.sameFrame.data, "runs"));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (runs.length) setSection("sameFrame", { data: { runs: runs as unknown as JsonValue } });
  }, [runs, setSection]);

  const run = useCallback(async () => {
    const video = videoRef.current;
    if (!engine || !video) return;
    setBusy(true);
    setSection("sameFrame", { status: "running", reason: null });
    const errors: string[] = [];
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = grabVideoFrame(video);
      const W = canvas.width;
      const H = canvas.height;

      const t0 = performance.now();
      const vres = engine.landmarker.detectForVideo(canvas, nextTs());
      const vSample = summarizeResult(vres, W, H, performance.now() - t0);

      const samples: Record<string, FrameSample | null> = { VIDEO: vSample };
      const initMs: Record<string, number | null> = {};
      try {
        const { landmarker, initMs: ms } = await imageEngine("CPU");
        initMs.IMAGE_CPU = num(ms, 1);
        const t1 = performance.now();
        samples.IMAGE_CPU = summarizeResult(landmarker.detect(canvas), W, H, performance.now() - t1);
      } catch (e) {
        samples.IMAGE_CPU = null;
        errors.push(`IMAGE_CPU: ${errText(e)}`);
      }
      try {
        const g0 = performance.now();
        const gpu = await loadFaceLandmarker({ delegate: "GPU", numFaces: 2, runningMode: "IMAGE" });
        initMs.IMAGE_GPU = num(performance.now() - g0, 1);
        try {
          const t1 = performance.now();
          samples.IMAGE_GPU = summarizeResult(gpu.landmarker.detect(canvas), W, H, performance.now() - t1);
        } finally {
          gpu.landmarker.close();
        }
      } catch (e) {
        samples.IMAGE_GPU = null;
        errors.push(`IMAGE_GPU: ${errText(e)}`);
      }

      const r: Run = {
        frame: `${W}x${H}`,
        videoEngine: `${engine.delegate}/${engine.numFaces}`,
        results: Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, sampleToJson(v)])),
        diffsVsVideo: {
          IMAGE_CPU: diffSamples(vSample, samples.IMAGE_CPU),
          IMAGE_GPU: diffSamples(vSample, samples.IMAGE_GPU),
          GPU_vs_CPU: diffSamples(samples.IMAGE_CPU, samples.IMAGE_GPU),
        },
        imageInitMs: initMs,
        engines: engineCounts(),
        errors,
      };
      setRuns((p) => [...p, r].slice(-10));
      // 얼굴이 정확히 1개가 아닌 프레임은 비교가 안 된다(차가 모두 null). 결과는 남기되 실패로.
      // GPU 경로만 실패했으면 그 자체가 측정 결과(항목 1: GPU 위임)라 완료로 두고 메모한다.
      const cpuFailed = errors.some((e) => e.startsWith("IMAGE_CPU"));
      if (vSample.faces !== 1) {
        setSection("sameFrame", {
          status: "failed",
          reason: `이 프레임에서 얼굴을 못 찾음(얼굴 ${vSample.faces}개) — 얼굴을 화면 가운데에 두고 다시.`,
        });
      } else if (cpuFailed) {
        setSection("sameFrame", { status: "failed", reason: errors.join(" / ") });
      } else {
        setSection("sameFrame", {
          status: "done",
          reason: errors.length ? `GPU 실패(결과로 기록됨) — 다음으로 넘어가도 됩니다: ${errors.join(" / ")}` : null,
        });
      }
    } catch (e) {
      setSection("sameFrame", { status: "failed", reason: errText(e) });
    } finally {
      releaseCanvas(canvas);
    }
    setBusy(false);
  }, [engine, imageEngine, nextTs, setSection, videoRef]);

  const last = runs[runs.length - 1];
  const dd = (k: string) => {
    const x = last?.diffsVsVideo[k] as { dYaw: number; dPitch: number; dRoll: number } | null | undefined;
    return x ? `Δyaw ${fmt(x.dYaw, 2)} Δpitch ${fmt(x.dPitch, 2)} Δroll ${fmt(x.dRoll, 2)}°` : "—";
  };

  return (
    <Section
      no={5}
      title="같은 프레임 비교"
      refText="TECH-NOTES 6절 항목 1(GPU 위임 정확성) · 5절 실험 0"
      how="얼굴이 화면에 있을 때 [이 프레임 비교]. IMAGE GPU 엔진은 매번 새로 만들고 닫아서(메모리) 누를 때마다 몇 초 걸립니다. 정면·돌린 자세에서 몇 번씩."
      status={sec.status}
      reason={sec.reason}
    >
      <div className={s.row}>
        <button className={s.btn} onClick={run} disabled={busy || !engine}>
          {busy ? "재는 중…" : "이 프레임 비교"}
        </button>
      </div>
      {!engine ? <p className={s.ref} style={{ marginTop: 6 }}>2번에서 모델을 먼저 불러오세요(카메라도 켜져 있어야 합니다).</p> : null}
      {last ? (
        <ul className={s.list}>
          <li>프레임 {last.frame} · VIDEO 엔진 {last.videoEngine}</li>
          <li>IMAGE CPU − VIDEO: {dd("IMAGE_CPU")}</li>
          <li>IMAGE GPU − VIDEO: {dd("IMAGE_GPU")}</li>
          <li>GPU − CPU(IMAGE): {dd("GPU_vs_CPU")}</li>
        </ul>
      ) : null}
      {last ? <Json value={last} summary={`마지막 결과(총 ${runs.length}회)`} /> : null}
    </Section>
  );
}
