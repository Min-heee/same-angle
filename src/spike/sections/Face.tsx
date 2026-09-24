"use client";

/**
 * 2. 얼굴 인식: 초기화 시간, CPU/GPU 추론 시간·fps, numFaces 1/2 비용, 행렬 배치, visibility.
 *
 * 성능 비교는 [지금 성능 저장]으로 설정별 스냅샷을 남겨서 한다(예: CPU·2명 → CPU·1명 → GPU·2명).
 * 최근 60프레임의 중앙값·p95 라 저장 전 몇 초 기다리면 안정된다.
 */

import { useCallback, useEffect, useState } from "react";
import { useSpike } from "../context";
import { EDGE_MARGIN_FRAC } from "../sample";
import { loadFaceLandmarker, type Delegate } from "../engine";
import s from "../spike.module.css";
import { KV, Section } from "../ui";
import { errText, fmt, num, pushCapped } from "../util";

interface LoadRow {
  delegate: Delegate;
  numFaces: number;
  ok: boolean;
  error: string | null;
  importMs: number | null;
  filesetMs: number | null;
  createMs: number | null;
  totalMs: number | null;
}

interface Snapshot {
  delegate: Delegate;
  numFaces: number;
  loopKind: string | null;
  frames: number;
  fps: number | null;
  inferMedianMs: number | null;
  inferP95Ms: number | null;
  videoSize: string;
  faces: number;
  shortSideRatio: number | null;
  touchesEdge: boolean | null;
  tz: number | null;
}

export function FaceSection() {
  const api = useSpike();
  const { engine, setEngine, stream, live, loopRunning, loopKind, loopError, startLoop, stopLoop, sections, setSection } =
    api;
  const sec = sections.face;

  const [delegate, setDelegate] = useState<Delegate>("CPU");
  const [numFaces, setNumFaces] = useState(2);
  const [progress, setProgress] = useState("");
  const [loads, setLoads] = useState<LoadRow[]>([]);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loads.length === 0) return;
    const lc = api.layoutCountsRef.current;
    setSection("face", {
      data: {
        loads: loads.map((l) => ({ ...l })),
        loopKind,
        loopError,
        snapshots: snaps.map((x) => ({ ...x })),
        layoutCounts: { ...lc },
        maxOrthoError: num(api.maxOrthoRef.current, 6),
        visibilitySeen: live?.visibility ?? [],
        edgeMarginFrac: EDGE_MARGIN_FRAC,
      },
    });
  }, [loads, snaps, loopKind, loopError, live, api.layoutCountsRef, api.maxOrthoRef, setSection]);

  useEffect(() => {
    if (loopError) setSection("face", { status: "failed", reason: `추론 중 예외: ${loopError}` });
  }, [loopError, setSection]);

  /** 모델은 카메라 없이도 불러올 수 있다(초기화 시간만 재기). */
  const load = useCallback(async () => {
    setBusy(true);
    stopLoop();
    setSection("face", { status: "running", reason: null });
    const old = api.engineRef.current;
    setEngine(null);
    old?.landmarker.close();
    try {
      const l = await loadFaceLandmarker({ delegate, numFaces, runningMode: "VIDEO", onProgress: setProgress });
      setEngine(l);
      setLoads((p) =>
        pushCapped(
          p,
          {
            delegate,
            numFaces,
            ok: true,
            error: null,
            importMs: num(l.timings.importMs, 1),
            filesetMs: num(l.timings.filesetMs, 1),
            createMs: num(l.timings.createMs, 1),
            totalMs: num(l.timings.totalMs, 1),
          },
          20,
        ),
      );
      setSection("face", { status: "done", reason: null });
    } catch (e) {
      setProgress("");
      setLoads((p) =>
        pushCapped(
          p,
          { delegate, numFaces, ok: false, error: errText(e), importMs: null, filesetMs: null, createMs: null, totalMs: null },
          20,
        ),
      );
      setSection("face", { status: "failed", reason: errText(e) });
    }
    setBusy(false);
  }, [api.engineRef, delegate, numFaces, setEngine, setSection, stopLoop]);

  const snapshot = useCallback(() => {
    if (!engine || !live) return;
    const v = api.videoRef.current;
    const last = live.last;
    setSnaps((p) =>
      pushCapped(
        p,
        {
          delegate: engine.delegate,
          numFaces: engine.numFaces,
          loopKind,
          frames: live.n,
          fps: num(live.fps, 2),
          inferMedianMs: num(live.inferMedian, 2),
          inferP95Ms: num(live.inferP95, 2),
          videoSize: v ? `${v.videoWidth}x${v.videoHeight}` : "",
          faces: last?.faces ?? 0,
          shortSideRatio: num(last?.box?.shortSideRatio, 4),
          touchesEdge: last?.box ? last.box.touchesEdge : null,
          tz: num(last?.dec?.t[2], 2),
        },
        30,
      ),
    );
  }, [api.videoRef, engine, live, loopKind]);

  const last = live?.last ?? null;
  const d = last?.dec ?? null;

  return (
    <Section
      no={2}
      title="얼굴 인식"
      refText="TECH-NOTES 6절 항목 1(fps·초기화·GPU), 항목 5(numFaces 2 비용·visibility), 항목 7(H2 거리)"
      how="방식·인원을 고르고 [모델 불러오기] → 카메라가 켜져 있으면 [추론 시작]. 몇 초 뒤 [지금 성능 저장]. 설정을 바꿔 가며 반복하세요."
      status={sec.status}
      reason={sec.reason}
    >
      <div className={s.seg}>
        {(["CPU", "GPU"] as const).map((x) => (
          <label key={x}>
            <input type="radio" name="delegate" checked={delegate === x} onChange={() => setDelegate(x)} /> {x}
          </label>
        ))}
        {[1, 2].map((n) => (
          <label key={n}>
            <input type="radio" name="numFaces" checked={numFaces === n} onChange={() => setNumFaces(n)} /> {n}명
          </label>
        ))}
      </div>

      <div className={s.row}>
        <button className={s.btn} onClick={load} disabled={busy}>
          모델 불러오기
        </button>
        {loopRunning ? (
          <button className={s.btnGhost} onClick={stopLoop}>
            추론 멈춤
          </button>
        ) : (
          <button className={s.btnGhost} onClick={startLoop} disabled={!engine || !stream}>
            추론 시작
          </button>
        )}
      </div>
      <div className={s.row}>
        <button className={s.btnGhost} onClick={snapshot} disabled={!loopRunning || !live}>
          지금 성능 저장
        </button>
      </div>
      {progress ? (
        <p className={s.how} role="status">
          {progress}
        </p>
      ) : null}
      {engine ? (
        <p className={s.ref} style={{ marginTop: 4 }}>
          불러온 엔진: {engine.delegate} · {engine.numFaces}명 · VIDEO · 루프 {loopKind ?? "—"}
        </p>
      ) : null}

      {live ? (
        <KV
          rows={[
            ["추론 ms 중앙값 / p95", `${fmt(live.inferMedian, 1)} / ${fmt(live.inferP95, 1)} (최근 ${live.n})`],
            ["유효 fps", fmt(live.fps, 1)],
            ["얼굴 수", String(last?.faces ?? "—")],
            ["행렬 배치", last?.matrix ? (last.layout ?? "판별 불가") : "행렬 없음"],
            ["yaw / pitch / roll", d ? `${fmt(d.yaw)} / ${fmt(d.pitch)} / ${fmt(d.roll)}°` : "—"],
            ["scale · t(x,y,z)", d ? `${fmt(d.scale, 3)} · ${d.t.map((x) => fmt(x, 1)).join(", ")}` : "—"],
            ["직교 오차", d ? d.orthoError.toExponential(2) : "—"],
            [
              "박스 짧은 변 비율",
              last?.box ? `${fmt(last.box.shortSideRatio * 100, 1)}% ${last.box.touchesEdge ? "· 경계 접촉" : ""}` : "—",
            ],
            ["visibility(1, 33, 263)", live.visibility.length ? live.visibility.map((x) => (typeof x === "number" ? x.toFixed(3) : x)).join(", ") : "—"],
          ]}
        />
      ) : null}

      {loads.length > 0 ? (
        <details className={s.details} open>
          <summary>불러오기 기록 {loads.length}건</summary>
          <ul className={s.list}>
            {loads.map((l, i) => (
              <li key={i}>
                {l.delegate}·{l.numFaces}명 ·{" "}
                {l.ok ? `총 ${l.totalMs}ms (import ${l.importMs} / 파일셋 ${l.filesetMs} / 생성 ${l.createMs})` : `실패 ${l.error}`}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {snaps.length > 0 ? (
        <details className={s.details} open>
          <summary>성능 스냅샷 {snaps.length}건</summary>
          <ul className={s.list}>
            {snaps.map((x, i) => (
              <li key={i}>
                {x.delegate}·{x.numFaces}명 · {x.fps ?? "—"}fps · 중앙 {x.inferMedianMs ?? "—"}ms · p95 {x.inferP95Ms ?? "—"}ms ·{" "}
                {x.videoSize} · 박스 {x.shortSideRatio ?? "—"} · tz {x.tz ?? "—"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className={s.ref} style={{ marginTop: 8 }}>
        H2 거리: 얼굴과 폰 사이 거리를 바꿔 가며 &lsquo;박스 짧은 변 비율&rsquo;이 20% 근처가 되는 거리를 기억해 두고 스냅샷을 저장하세요.
      </p>
    </Section>
  );
}
