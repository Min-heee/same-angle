"use client";

/**
 * 3. 흔들림(실험 1: 잡음 바닥). 30초 동안 프레임마다 지표를 모아 요약한다.
 *
 * 통과 문턱은 한 손 정지 상태 잡음의 3배 이상이어야 한다(PRD 5절). 그 σ 를 여기서 잰다.
 * 얼굴이 정확히 1개이고 분해가 된 프레임만 지표에 넣고, 나머지는 종류별로 센다
 * — 빠진 프레임 수가 결과의 일부다.
 *
 * 깨진 기록을 '완료'로 쌓지 않는다: 화면 꺼짐·다른 앱·루프 정지·카메라 끊김이 생기면 곧바로 버리고
 * 실패로 적는다. 끝까지 가도 프레임이 기대치(시작 fps × 30초)의 80% 미만이거나, 최대 간격이
 * 500ms 를 넘거나, 얼굴 프레임이 절반 미만이면 실패다(livestats.checkRecording). 기록 중에는
 * 카메라·모델 버튼이 막힌다(context.recording).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { JsonValue } from "@/core/report";
import { summarize, type Summary } from "@/core/stats";
import { useSpike } from "../context";
import { restoredList } from "../draft";
import { checkRecording } from "../livestats";
import { jitterProgress } from "../progress";
import type { FrameSample } from "../sample";
import s from "../spike.module.css";
import { Section } from "../ui";
import { errText, fmt, num } from "../util";

const HOLDS = [
  { id: "fixed", label: "폰 고정" },
  { id: "oneHand", label: "한 손" },
] as const;
const SUBJECTS = [
  { id: "self", label: "피사체: 본인" },
  { id: "mannequin", label: "피사체: 마네킹" },
] as const;
const VIEWS = [
  { id: "front", label: "정면" },
  { id: "down30", label: "숙임(약 30°)" },
  { id: "oblique45", label: "사선(약 45°)" },
  { id: "crown", label: "정수리" },
] as const;

export const JITTER_SECONDS = 30;
/**
 * 보고서에 남기는 최근 기록 수. 한 번에 수 76개(요약 10지표 × 7 + 개수 6)라 10회 ≈ 760개로
 * 보고서 섹션 한도(MAX_SECTION_NUMBERS 900) 안이다. 늘리면 내보내기가 막히니 한도부터 본다.
 * 잡는 방식 2 × 뷰 4 = 8조합에 재시도 두 번 여유.
 */
export const JITTER_KEEP = 10;

type Metric = "yaw" | "pitch" | "roll" | "scale" | "tz" | "cx" | "cy" | "intervalMs" | "inferMs" | "shortSideRatio";
const METRICS: Metric[] = ["yaw", "pitch", "roll", "scale", "tz", "cx", "cy", "intervalMs", "inferMs", "shortSideRatio"];

function roundSummary(x: Summary | null): JsonValue {
  if (!x) return null;
  return {
    n: x.n,
    mean: num(x.mean, 4),
    std: num(x.std, 4),
    median: num(x.median, 4),
    p95: num(x.p95, 4),
    min: num(x.min, 4),
    max: num(x.max, 4),
  };
}

interface JitterResult {
  hold: string;
  view: string;
  /** 본인/마네킹(체크리스트 항목 6 의 마네킹 검출과 구별). */
  subject: string;
  /** 찍은 카메라(track.getSettings().facingMode). 모르면 null. */
  facingMode: string | null;
  /** 기록이 쓸 만했는가(checkRecording). 실패 기록도 남기되 완료 조건에는 세지 않는다. */
  ok: boolean;
  expectedFrames: number | null;
  maxGapMs: number | null;
  note: string | null;
  seconds: number;
  engine: string;
  frames: number;
  valid: number;
  noFace: number;
  multiFace: number;
  noDecompose: number;
  summaries: Record<Metric, JsonValue>;
}

export function JitterSection() {
  const { subscribe, subscribeInterrupt, loopRunning, engine, sections, setSection, beep, setRecording, liveRef, stream, restored } =
    useSpike();
  const sec = sections.jitter;
  const [hold, setHold] = useState<string>("oneHand");
  const [view, setView] = useState<string>("front");
  const [subject, setSubject] = useState<string>("self");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [results, setResults] = useState<JitterResult[]>(() =>
    restoredList<JitterResult>(restored?.sections.jitter.data, "results"),
  );
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  useEffect(() => {
    if (results.length === 0) return;
    setSection("jitter", { data: { results: results as unknown as JsonValue } });
  }, [results, setSection]);

  const record = useCallback(() => {
    if (!engine) return;
    const samples: FrameSample[] = [];
    const unsub = subscribe((x) => samples.push(x));
    const t0 = performance.now();
    const cur = liveRef.current;
    const fpsAtStart = cur && !cur.stale ? cur.fps : null;
    const facingMode = (stream?.getVideoTracks()[0]?.getSettings().facingMode as string | undefined) ?? null;
    beep("start");
    setRecording("흔들림");
    setSection("jitter", { status: "running", reason: null });
    setRemaining(JITTER_SECONDS);

    // 중단되면 곧바로 버린다(숨김 구간이 intervalMs 요약에 섞이지 않게).
    const unsubInt = subscribeInterrupt((k) => {
      cleanup();
      const why =
        k === "hidden"
          ? "화면이 꺼졌거나 다른 앱으로 가서 이번 기록을 버렸습니다 — 자동 잠금을 끄고 다시 [30초 기록]."
          : k === "loopStopped"
            ? "추론 루프가 멈춰 이번 기록을 버렸습니다 — 2번에서 [추론 시작] 뒤 다시."
            : "카메라가 끊겨 이번 기록을 버렸습니다 — 1번 [카메라 다시 켜기] 뒤 다시.";
      setSection("jitter", { status: "failed", reason: why });
      beep("error");
    });

    const tick = setInterval(() => {
      const left = Math.max(0, JITTER_SECONDS - Math.floor((performance.now() - t0) / 1000));
      setRemaining(left);
    }, 250);

    const done = setTimeout(() => {
      cleanup();
      try {
        const valid = samples.filter((x) => x.faces === 1 && x.dec !== null);
        const col = (f: (x: FrameSample) => number | null | undefined) =>
          valid.map(f).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        const pick: Record<Metric, (x: FrameSample) => number | null | undefined> = {
          yaw: (x) => x.dec?.yaw,
          pitch: (x) => x.dec?.pitch,
          roll: (x) => x.dec?.roll,
          scale: (x) => x.dec?.scale,
          tz: (x) => x.dec?.t[2],
          cx: (x) => x.box?.centerShort.x,
          cy: (x) => x.box?.centerShort.y,
          intervalMs: (x) => x.intervalMs,
          inferMs: (x) => x.inferMs,
          shortSideRatio: (x) => x.box?.shortSideRatio,
        };
        const summaries = Object.fromEntries(METRICS.map((m) => [m, roundSummary(summarize(col(pick[m])))])) as Record<
          Metric,
          JsonValue
        >;
        const check = checkRecording({
          seconds: JITTER_SECONDS,
          fpsAtStart,
          frames: samples.length,
          valid: valid.length,
          intervals: samples.map((x) => x.intervalMs).filter((v): v is number => typeof v === "number"),
          faceOptional: view === "crown",
        });
        const r: JitterResult = {
          hold,
          view,
          subject,
          facingMode,
          ok: check.ok,
          expectedFrames: check.expectedFrames,
          maxGapMs: num(check.maxGapMs, 1),
          note: check.reason,
          seconds: JITTER_SECONDS,
          engine: `${engine.delegate}/${engine.numFaces}`,
          frames: samples.length,
          valid: valid.length,
          noFace: samples.filter((x) => x.faces === 0).length,
          multiFace: samples.filter((x) => x.faces > 1).length,
          noDecompose: samples.filter((x) => x.faces === 1 && x.dec === null).length,
          summaries,
        };
        const next = [...results, r].slice(-JITTER_KEEP);
        setResults(next);
        if (!check.ok) {
          setSection("jitter", { status: "failed", reason: check.reason });
          beep("error");
        } else {
          const p = jitterProgress(next.map((x) => ({ hold: x.hold, view: x.view, ok: x.ok !== false })));
          setSection("jitter", {
            status: p.done ? "done" : "running",
            reason: [check.reason, p.note].filter(Boolean).join(" · "),
          });
          beep("end");
        }
      } catch (e) {
        setSection("jitter", { status: "failed", reason: errText(e) });
        beep("error");
      }
    }, JITTER_SECONDS * 1000);

    const cleanup = () => {
      unsub();
      unsubInt();
      setRecording(null);
      clearInterval(tick);
      clearTimeout(done);
      setRemaining(null);
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;
  }, [beep, engine, hold, liveRef, results, setRecording, setSection, stream, subject, subscribe, subscribeInterrupt, view]);

  const cancel = () => {
    cleanupRef.current?.();
    const p = jitterProgress(results.map((x) => ({ hold: x.hold, view: x.view, ok: x.ok !== false })));
    setSection("jitter", { status: results.length ? (p.done ? "done" : "running") : "idle", reason: `기록을 취소했습니다. ${p.note}` });
  };

  const std = (r: JitterResult, m: Metric, d = 2) => {
    const x = r.summaries[m] as { std: number | null } | null;
    return x ? fmt(x.std, d) : "—";
  };

  return (
    <Section
      no={3}
      title="흔들림(실험 1)"
      refText="TECH-NOTES 6절 항목 6(30° 숙임·45° 사선 떨림, 마네킹) · 5절 실험 1"
      how={`잡는 방식·뷰·피사체를 고르고 [${JITTER_SECONDS}초 기록]. 삐 소리부터 끝 소리(삐삐)까지 화면을 건드리지 말고 자세를 유지하세요(자동 잠금은 '안 함'). 완료 조건: 한 손 × 정면·숙임·사선.`}
      status={sec.status}
      reason={sec.reason}
    >
      <div className={s.row}>
        <select className={s.select} value={hold} onChange={(e) => setHold(e.target.value)} aria-label="잡는 방식">
          {HOLDS.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
        </select>
        <select className={s.select} value={view} onChange={(e) => setView(e.target.value)} aria-label="뷰">
          {VIEWS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <select className={s.select} value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="피사체">
          {SUBJECTS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      <div className={s.row}>
        {remaining === null ? (
          <button className={s.btn} onClick={record} disabled={!loopRunning}>
            {JITTER_SECONDS}초 기록
          </button>
        ) : (
          <button className={s.btnGhost} onClick={cancel}>
            취소 ({remaining}초 남음)
          </button>
        )}
      </div>
      {!loopRunning ? <p className={s.ref} style={{ marginTop: 6 }}>2번에서 추론을 시작해야 기록할 수 있습니다.</p> : null}
      {remaining !== null ? (
        <p className={s.countdown} aria-live="assertive">
          {remaining}
        </p>
      ) : null}

      {results.length > 0 ? (
        <ul className={s.list}>
          {results.map((r, i) => (
            <li key={i}>
              {r.ok === false ? "✕ " : ""}
              {HOLDS.find((h) => h.id === r.hold)?.label}·{VIEWS.find((v) => v.id === r.view)?.label}
              {r.subject === "mannequin" ? "·마네킹" : ""} · 유효 {r.valid}/{r.frames} · σ
              yaw {std(r, "yaw")} pitch {std(r, "pitch")} roll {std(r, "roll")}° · σ 중심x {std(r, "cx", 4)}
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}
