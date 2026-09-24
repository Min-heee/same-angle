"use client";

/**
 * 5. 같은 프레임 비교(실험 0 일부): 한 비디오 프레임을 VIDEO(루프 엔진)·IMAGE CPU·IMAGE GPU
 * 세 경로로 재서 각도 차를 본다.
 *
 * GPU 위임은 예외 없이 조용히 틀릴 수 있다(TECH-NOTES 3절, 세그멘터 #6142). 그래서 같은
 * 픽셀에 CPU 결과를 대조한다. 캔버스로 한 번 떠 둔 프레임을 세 경로에 똑같이 넣는다.
 * VIDEO 는 버튼을 누른 즉시(다른 await 전에) 재서, 루프와 같은 엔진·같은 타임스탬프 규칙을 쓴다.
 */

import { useCallback, useEffect, useState } from "react";
import type { JsonValue } from "@/core/report";
import { diffSamples, sampleToJson } from "../compare";
import { summarizeResult, useSpike, type FrameSample } from "../context";
import { grabVideoFrame } from "../canvas";
import type { Delegate } from "../engine";
import s from "../spike.module.css";
import { Json, Section } from "../ui";
import { errText, fmt, num } from "../util";

interface Run {
  frame: string;
  videoEngine: string;
  results: Record<string, JsonValue>;
  diffsVsVideo: Record<string, JsonValue>;
  imageInitMs: Record<string, number | null>;
  errors: string[];
}

export function SameFrameSection() {
  const { engine, videoRef, nextTs, imageEngine, sections, setSection } = useSpike();
  const sec = sections.sameFrame;
  const [runs, setRuns] = useState<Run[]>([]);
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
    try {
      const canvas = grabVideoFrame(video);
      const W = canvas.width;
      const H = canvas.height;

      const t0 = performance.now();
      const vres = engine.landmarker.detectForVideo(canvas, nextTs());
      const vSample = summarizeResult(vres, W, H, performance.now() - t0);

      const samples: Record<string, FrameSample | null> = { VIDEO: vSample };
      const initMs: Record<string, number | null> = {};
      for (const d of ["CPU", "GPU"] as Delegate[]) {
        try {
          const { landmarker, initMs: ms } = await imageEngine(d);
          initMs[`IMAGE_${d}`] = num(ms, 1);
          const t1 = performance.now();
          const res = landmarker.detect(canvas);
          samples[`IMAGE_${d}`] = summarizeResult(res, W, H, performance.now() - t1);
        } catch (e) {
          samples[`IMAGE_${d}`] = null;
          errors.push(`IMAGE_${d}: ${errText(e)}`);
        }
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
        errors,
      };
      setRuns((p) => [...p, r].slice(-10));
      setSection("sameFrame", {
        status: errors.length ? "failed" : "done",
        reason: errors.length ? errors.join(" / ") : null,
      });
    } catch (e) {
      setSection("sameFrame", { status: "failed", reason: errText(e) });
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
      how="얼굴이 화면에 있을 때 [이 프레임 비교]. 처음 한 번은 IMAGE 엔진 두 개를 새로 만들어 몇 초 걸립니다. 정면·돌린 자세에서 몇 번씩."
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
