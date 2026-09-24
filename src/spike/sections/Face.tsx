"use client";

/**
 * 2. 얼굴 인식: 초기화 시간, CPU/GPU 추론 시간·fps, numFaces 1/2 비용, 행렬 배치, visibility.
 *
 * 성능 비교는 [지금 성능 저장]으로 설정별 스냅샷을 남겨서 한다(예: CPU·2명 → CPU·1명 → GPU·2명).
 * 요약 창은 **지금 엔진으로 모은 프레임만** 쓴다(엔진을 바꾸거나 루프를 다시 시작하면 비운다).
 * 스냅샷은 이 엔진으로 30프레임·5초 이상 모인 뒤에만 누를 수 있다 — 옛 엔진 프레임이 섞인
 * 값으로 체크리스트 1(CPU 8fps)·5(numFaces 2 의 fps 하락) 를 판정하지 않게.
 *
 * 스냅샷을 잊어도 엔진별 마지막 요약(byEngine)은 보고서에 자동으로 들어간다(내보내기 직전 수집).
 */

import { useCallback, useEffect, useState } from "react";
import type { JsonValue } from "@/core/report";
import { engineKeyOf, engineStatsJson, useLive, useSpike } from "../context";
import { restoredList } from "../draft";
import { loadFaceLandmarker, type Delegate } from "../engine";
import { SNAPSHOT_MIN_FRAMES, SNAPSHOT_MIN_MS } from "../livestats";
import { faceProgress } from "../progress";
import { EDGE_MARGIN_FRAC } from "../sample";
import s from "../spike.module.css";
import { KV, Section } from "../ui";
import { errText, fmt, num, pushCapped } from "../util";

interface LoadRow {
  delegate: Delegate;
  numFaces: number;
  ok: boolean;
  error: string | null;
  importMs: number | null;
  /** SIMD 탐지만(파일을 받지 않는다). */
  simdCheckMs: number | null;
  /** WASM(약 12MB)·모델(약 3.6MB) 받기 + 컴파일 + 초기화. 첫 로드의 통신 시간은 전부 여기 든다. */
  wasmModelInitMs: number | null;
  totalMs: number | null;
}

interface Snapshot {
  delegate: Delegate;
  numFaces: number;
  loopKind: string | null;
  /** 이 엔진(세대)으로 모은 프레임 수. */
  frames: number;
  /** 세대 시작 뒤 경과 초. */
  seconds: number;
  fps: number | null;
  inferMedianMs: number | null;
  inferP95Ms: number | null;
  videoSize: string;
  faces: number;
  shortSideRatio: number | null;
  touchesEdge: boolean | null;
  tz: number | null;
  /** 폰–얼굴 거리(cm). 고르지 않았으면 null. H2(짧은 변 20%)가 뜻하는 촬영 거리(항목 7). */
  distanceCm: number | null;
}

const DISTANCES = [20, 30, 40, 50, 60] as const;

export function FaceSection() {
  const api = useSpike();
  const {
    engine,
    setEngine,
    stream,
    loopRunning,
    loopKind,
    loopError,
    startLoop,
    stopLoop,
    sections,
    setSection,
    recording,
    restored,
    registerCollector,
  } = api;
  const live = useLive();
  const sec = sections.face;

  const [delegate, setDelegate] = useState<Delegate>("CPU");
  const [numFaces, setNumFaces] = useState(2);
  const [progress, setProgress] = useState("");
  const [loads, setLoads] = useState<LoadRow[]>(() => restoredList<LoadRow>(restored?.sections.face.data, "loads"));
  const [snaps, setSnaps] = useState<Snapshot[]>(() => restoredList<Snapshot>(restored?.sections.face.data, "snapshots"));
  const [distance, setDistance] = useState("");
  const [busy, setBusy] = useState(false);

  /** 보고서 데이터. live(4Hz)에 매이지 않게 ref 에서 읽는다 — 이 페이지의 렌더 비용이 fps 에 섞이지 않게. */
  const buildData = useCallback(
    (): JsonValue => ({
      loads: loads.map((l) => ({ ...l })),
      loopKind,
      loopError,
      snapshots: snaps.map((x) => ({ ...x })),
      byEngine: engineStatsJson(api.engineStatsRef.current),
      visibilitySeen: api.liveRef.current?.visibility ?? [],
      edgeMarginFrac: EDGE_MARGIN_FRAC,
    }),
    [api.engineStatsRef, api.liveRef, loads, loopError, loopKind, snaps],
  );

  useEffect(() => {
    if (loads.length === 0) return;
    setSection("face", { data: buildData() });
  }, [buildData, loads.length, setSection]);

  // 스냅샷을 잊어도 엔진별 마지막 요약이 보고서에 들어가게 내보내기 직전에 한 번 더.
  useEffect(() => registerCollector("face", () => (loads.length ? { data: buildData() } : null)), [buildData, loads.length, registerCollector]);

  useEffect(() => {
    if (loopError) setSection("face", { status: "failed", reason: `추론 중 예외: ${loopError}` });
  }, [loopError, setSection]);

  const markProgress = useCallback(
    (list: Snapshot[]) => {
      const p = faceProgress(list);
      setSection("face", { status: p.done ? "done" : "running", reason: p.note });
    },
    [setSection],
  );

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
            simdCheckMs: num(l.timings.simdCheckMs, 1),
            wasmModelInitMs: num(l.timings.wasmModelInitMs, 1),
            totalMs: num(l.timings.totalMs, 1),
          },
          20,
        ),
      );
      // 불러오기만으로는 완료가 아니다(추론 0프레임). 스냅샷 조건을 보여 준다.
      markProgress(snaps);
    } catch (e) {
      setProgress("");
      setLoads((p) =>
        pushCapped(
          p,
          { delegate, numFaces, ok: false, error: errText(e), importMs: null, simdCheckMs: null, wasmModelInitMs: null, totalMs: null },
          20,
        ),
      );
      setSection("face", { status: "failed", reason: errText(e) });
    }
    setBusy(false);
  }, [api.engineRef, delegate, markProgress, numFaces, setEngine, setSection, snaps, stopLoop]);

  const snapshot = useCallback(() => {
    const cur = api.liveRef.current;
    if (!engine || !cur || !cur.snapshotReady || cur.engineKey !== engineKeyOf(engine)) return;
    const v = api.videoRef.current;
    const last = cur.last;
    const snap: Snapshot = {
      delegate: engine.delegate,
      numFaces: engine.numFaces,
      loopKind,
      frames: cur.genFrames,
      seconds: num(cur.genElapsedMs / 1000, 1) ?? 0,
      fps: num(cur.fps, 2),
      inferMedianMs: num(cur.inferMedian, 2),
      inferP95Ms: num(cur.inferP95, 2),
      videoSize: v ? `${v.videoWidth}x${v.videoHeight}` : "",
      faces: last?.faces ?? 0,
      shortSideRatio: num(last?.box?.shortSideRatio, 4),
      touchesEdge: last?.box ? last.box.touchesEdge : null,
      tz: num(last?.dec?.t[2], 2),
      distanceCm: distance ? Number(distance) : null,
    };
    const next = pushCapped(snaps, snap, 30);
    setSnaps(next);
    markProgress(next);
  }, [api.liveRef, api.videoRef, distance, engine, loopKind, markProgress, snaps]);

  const last = live?.last ?? null;
  const d = last?.dec ?? null;
  const ready = !!live?.snapshotReady && live.engineKey === engineKeyOf(engine);
  const locked = recording !== null;

  return (
    <Section
      no={2}
      title="얼굴 인식"
      refText="TECH-NOTES 6절 항목 1(fps·초기화·GPU), 항목 5(numFaces 2 비용·visibility), 항목 7(H2 거리)"
      how="방식·인원을 고르고 [모델 불러오기] → 카메라가 켜져 있으면 [추론 시작]. 30프레임·5초가 모이면 폰–얼굴 거리를 고르고 [지금 성능 저장]. 방식·인원을 바꿔 두 엔진 이상 저장하면 완료입니다."
      status={sec.status}
      reason={sec.reason}
    >
      <div className={s.seg}>
        <fieldset className={s.fieldset}>
          <legend className={s.visuallyHidden}>추론 방식</legend>
          {(["CPU", "GPU"] as const).map((x) => (
            <label key={x}>
              <input type="radio" name="delegate" checked={delegate === x} onChange={() => setDelegate(x)} /> {x}
            </label>
          ))}
        </fieldset>
        <fieldset className={s.fieldset}>
          <legend className={s.visuallyHidden}>최대 인원</legend>
          {[1, 2].map((n) => (
            <label key={n}>
              <input type="radio" name="numFaces" checked={numFaces === n} onChange={() => setNumFaces(n)} /> {n}명
            </label>
          ))}
        </fieldset>
      </div>

      <div className={s.row}>
        <button className={s.btn} onClick={load} disabled={busy || locked}>
          모델 불러오기
        </button>
        {loopRunning ? (
          <button className={s.btnGhost} onClick={stopLoop} disabled={locked}>
            추론 멈춤
          </button>
        ) : (
          <button className={s.btnGhost} onClick={startLoop} disabled={!engine || !stream || locked}>
            추론 시작
          </button>
        )}
      </div>
      {locked ? <p className={s.ref} style={{ marginTop: 6 }}>{recording} 기록 중에는 모델·추론 버튼을 막습니다.</p> : null}
      {!loopRunning && !locked && (!stream || !engine) ? (
        <p className={s.how} role="status">
          {!stream && !engine
            ? "[추론 시작]은 1번에서 카메라를 켜고 여기서 [모델 불러오기]를 한 뒤에 켜집니다."
            : !stream
              ? "1번에서 카메라를 먼저 켜세요. 켜면 [추론 시작]을 누를 수 있습니다."
              : "먼저 [모델 불러오기]를 누르세요."}
        </p>
      ) : null}
      <div className={s.row}>
        <select
          className={s.select}
          value={distance}
          onChange={(e) => setDistance(e.target.value)}
          aria-label="폰과 얼굴 사이 거리"
        >
          <option value="">폰–얼굴 거리: 모름</option>
          {DISTANCES.map((cm) => (
            <option key={cm} value={String(cm)}>
              폰–얼굴 거리: 약 {cm}cm
            </option>
          ))}
        </select>
        <button className={s.btnGhost} onClick={snapshot} disabled={!loopRunning || !ready}>
          {ready || !loopRunning
            ? "지금 성능 저장"
            : `모으는 중 ${Math.min(live?.genFrames ?? 0, SNAPSHOT_MIN_FRAMES)}/${SNAPSHOT_MIN_FRAMES}프레임 · ${Math.min(
                Math.floor((live?.genElapsedMs ?? 0) / 1000),
                SNAPSHOT_MIN_MS / 1000,
              )}/${SNAPSHOT_MIN_MS / 1000}초`}
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
            ["추론 ms 중앙값 / p95", `${fmt(live.inferMedian, 1)} / ${fmt(live.inferP95, 1)} (최근 ${live.inferN})`],
            ["유효 fps(최근 5초)", live.stale ? "프레임 안 옴" : fmt(live.fps, 1)],
            ["이 엔진으로 모은 프레임", `${live.genFrames} · ${fmt(live.genElapsedMs / 1000, 0)}초`],
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
                {l.ok
                  ? `총 ${l.totalMs}ms (import ${l.importMs} / SIMD 탐지 ${l.simdCheckMs} / WASM·모델 받고 초기화 ${l.wasmModelInitMs})`
                  : `실패 ${l.error}`}
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
                {x.delegate}·{x.numFaces}명 · {x.fps ?? "—"}fps({x.frames}프레임) · 중앙 {x.inferMedianMs ?? "—"}ms · p95{" "}
                {x.inferP95Ms ?? "—"}ms · {x.videoSize} · 박스 {x.shortSideRatio ?? "—"} · 거리{" "}
                {x.distanceCm === null ? "모름" : `${x.distanceCm}cm`}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className={s.ref} style={{ marginTop: 8 }}>
        H2 거리: 폰–얼굴 거리를 바꿔 가며 &lsquo;박스 짧은 변 비율&rsquo;이 20% 근처가 되는 거리에서 거리를 고르고 [지금 성능 저장]. 거리는
        스냅샷에 함께 남습니다.
      </p>
    </Section>
  );
}
