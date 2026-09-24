"use client";

/**
 * 8. 폰 기울기: DeviceMotion·DeviceOrientation 권한과 세로 상태 안정성(TECH-NOTES 6절 항목 9).
 *
 * iOS 는 두 권한 요청(requestPermission)을 **사용자 탭 안에서** 불러야 대화상자를 띄운다.
 * 클릭 핸들러에서 await 보다 먼저, 두 함수를 곧바로 부른다 — 앞의 것을 await 한 뒤 두 번째를
 * 부르면 제스처가 끝난 것으로 보고 거부될 수 있다[추론].
 *
 * 폰 롤은 atan2(gx, gy)(core/motion). 곧게 든 상태가 ±180° 근처로 나오는 기기라면 원값을
 * 그대로 평균·표준편차 내면 179°·−179° 가 섞여 평균 0°, σ 200° 같은 무의미한 값이 된다.
 * 그래서 원값 요약은 남기지 않는다. 원형 평균(circularMeanDeg)과, 그 평균·첫 표본 대비
 * 감은 차(−180~180)의 요약만 남긴다. 부호·0점 판단용으로 원 성분 gx·gy·gz 요약도 남긴다.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { JsonValue } from "@/core/report";
import { angleDiffDeg, circularMeanDeg, phoneRollDeg, relToCircularMeanDeg } from "@/core/motion";
import { summarize, type Summary } from "@/core/stats";
import { useSpike } from "../context";
import { restoredList } from "../draft";
import { MOTION_CONDITIONS, motionProgress } from "../progress";
import s from "../spike.module.css";
import { KV, Section } from "../ui";
import { errText, fmt, num } from "../util";

type PermFn = () => Promise<string>;
const RECORD_S = 10;

interface MotionSample {
  t: number;
  gx: number | null;
  gy: number | null;
  gz: number | null;
  roll: number | null;
}
interface OrientSample {
  t: number;
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
}

function round(x: Summary | null): JsonValue {
  if (!x) return null;
  return {
    n: x.n,
    mean: num(x.mean, 3),
    std: num(x.std, 3),
    median: num(x.median, 3),
    p95: num(x.p95, 3),
    min: num(x.min, 3),
    max: num(x.max, 3),
  };
}

const finite = (xs: (number | null)[]) => xs.filter((v): v is number => typeof v === "number" && Number.isFinite(v));

export function MotionSection() {
  const { sections, setSection, beep, subscribeInterrupt, restored } = useSpike();
  const sec = sections.motion;
  const [condition, setCondition] = useState<string>("upright");
  const [perm, setPerm] = useState<{ motion: string; orientation: string } | null>(null);
  const [listening, setListening] = useState(false);
  const [liveM, setLiveM] = useState<MotionSample | null>(null);
  const [liveO, setLiveO] = useState<OrientSample | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [results, setResults] = useState<JsonValue[]>(() => restoredList<JsonValue>(restored?.sections.motion.data, "results"));

  const lastM = useRef<MotionSample | null>(null);
  const lastO = useRef<OrientSample | null>(null);
  const recM = useRef<MotionSample[] | null>(null);
  const recO = useRef<OrientSample[] | null>(null);
  const counts = useRef({ motion: 0, orientation: 0 });
  const detachRef = useRef<(() => void) | null>(null);

  useEffect(() => () => detachRef.current?.(), []);

  useEffect(() => {
    if (!perm) return;
    setSection("motion", { data: { permission: perm, results, eventCounts: { ...counts.current } } });
  }, [perm, results, setSection]);

  // 화면 표시는 4Hz.
  useEffect(() => {
    if (!listening) return;
    const id = setInterval(() => {
      setLiveM(lastM.current);
      setLiveO(lastO.current);
    }, 250);
    return () => clearInterval(id);
  }, [listening]);

  const attach = useCallback(() => {
    detachRef.current?.();
    const onMotion = (e: DeviceMotionEvent) => {
      counts.current.motion++;
      const g = e.accelerationIncludingGravity;
      const m: MotionSample = {
        t: performance.now(),
        gx: g?.x ?? null,
        gy: g?.y ?? null,
        gz: g?.z ?? null,
        roll: phoneRollDeg(g?.x, g?.y),
      };
      lastM.current = m;
      recM.current?.push(m);
    };
    const onOrient = (e: DeviceOrientationEvent) => {
      counts.current.orientation++;
      const o: OrientSample = { t: performance.now(), alpha: e.alpha, beta: e.beta, gamma: e.gamma };
      lastO.current = o;
      recO.current?.push(o);
    };
    window.addEventListener("devicemotion", onMotion);
    window.addEventListener("deviceorientation", onOrient);
    setListening(true);
    detachRef.current = () => {
      window.removeEventListener("devicemotion", onMotion);
      window.removeEventListener("deviceorientation", onOrient);
      setListening(false);
    };
  }, []);

  /** 클릭 핸들러: 두 requestPermission 을 await 전에 곧바로 부른다. */
  const requestPerm = () => {
    const w = window as unknown as {
      DeviceMotionEvent?: { requestPermission?: PermFn };
      DeviceOrientationEvent?: { requestPermission?: PermFn };
    };
    const call = (fn: PermFn | undefined): Promise<string> => {
      if (typeof fn !== "function") return Promise.resolve("요청 함수 없음(허용 불필요로 추정)");
      try {
        return fn();
      } catch (e) {
        return Promise.reject(e);
      }
    };
    const pm = call(w.DeviceMotionEvent?.requestPermission?.bind(w.DeviceMotionEvent));
    const po = call(w.DeviceOrientationEvent?.requestPermission?.bind(w.DeviceOrientationEvent));
    setSection("motion", { status: "running", reason: null });
    void Promise.allSettled([pm, po]).then(([m, o]) => {
      const txt = (r: PromiseSettledResult<string>) => (r.status === "fulfilled" ? r.value : `실패 ${errText(r.reason)}`);
      const p = { motion: txt(m), orientation: txt(o) };
      setPerm(p);
      const denied = [m, o].some((r) => r.status === "rejected" || (r.status === "fulfilled" && r.value === "denied"));
      if (denied) {
        setSection("motion", { status: "failed", reason: `권한: 동작 ${p.motion} / 방향 ${p.orientation}` });
      } else {
        attach();
        setSection("motion", { status: "running", reason: null });
      }
    });
  };

  const record = () => {
    recM.current = [];
    recO.current = [];
    const t0 = performance.now();
    const cond = condition;
    beep("start");
    setSection("motion", { status: "running", reason: null });
    setRemaining(RECORD_S);
    const tick = setInterval(() => setRemaining(Math.max(0, RECORD_S - Math.floor((performance.now() - t0) / 1000))), 250);
    // 화면이 꺼지거나 다른 앱으로 가면 센서 이벤트가 끊긴다. 그 기록은 버린다.
    const unsubInt = subscribeInterrupt((k) => {
      if (k !== "hidden") return;
      clearInterval(tick);
      clearTimeout(done);
      unsubInt();
      setRemaining(null);
      recM.current = null;
      recO.current = null;
      setSection("motion", {
        status: "failed",
        reason: "화면이 꺼졌거나 다른 앱으로 가서 이번 기록을 버렸습니다 — 자동 잠금을 끄고 다시 [10초 기록].",
      });
      beep("error");
    });
    const done = setTimeout(() => {
      unsubInt();
      clearInterval(tick);
      setRemaining(null);
      const ms = recM.current ?? [];
      const os = recO.current ?? [];
      recM.current = null;
      recO.current = null;
      try {
        const rolls = finite(ms.map((x) => x.roll));
        const first = rolls[0];
        const rel = first === undefined ? [] : rolls.map((r) => angleDiffDeg(r, first));
        const circMean = circularMeanDeg(rolls);
        const relMean = relToCircularMeanDeg(rolls) ?? [];
        const dur = (performance.now() - t0) / 1000;
        const r: JsonValue = {
          condition: cond,
          seconds: RECORD_S,
          orientation: screen.orientation?.type ?? null,
          motionEvents: ms.length,
          orientationEvents: os.length,
          motionHz: num(ms.length / dur, 1),
          phoneRollCircularMean: num(circMean, 3),
          phoneRollRelToMean: round(summarize(relMean)),
          phoneRollRelToFirst: round(summarize(rel)),
          gx: round(summarize(finite(ms.map((x) => x.gx)))),
          gy: round(summarize(finite(ms.map((x) => x.gy)))),
          gz: round(summarize(finite(ms.map((x) => x.gz)))),
          beta: round(summarize(finite(os.map((x) => x.beta)))),
          gamma: round(summarize(finite(os.map((x) => x.gamma)))),
        };
        const next = [...results, r].slice(-10);
        setResults(next);
        if (ms.length === 0) {
          setSection("motion", { status: "failed", reason: "10초 동안 devicemotion 이벤트가 없습니다." });
          beep("error");
        } else {
          const p = motionProgress(next.map((x) => String((x as { condition?: unknown }).condition ?? "")));
          setSection("motion", { status: p.done ? "done" : "running", reason: p.note });
          beep("end");
        }
      } catch (e) {
        setSection("motion", { status: "failed", reason: errText(e) });
        beep("error");
      }
    }, RECORD_S * 1000);
  };

  return (
    <Section
      no={8}
      title="폰 기울기"
      refText="TECH-NOTES 6절 항목 9(DeviceMotion·Orientation 권한과 세로 상태 안정성)"
      how={`[동작 센서 허용]을 한 번 누르고, 조건을 고른 뒤 그 자세로 폰을 들고 [${RECORD_S}초 기록]. 두 조건(세로 곧게, 화면 위쪽을 오른쪽으로 약 15° — 화면을 보는 사람 기준 시계 방향)을 각각 한 번씩 하면 완료.`}
      status={sec.status}
      reason={sec.reason}
    >
      <div className={s.row}>
        <select className={s.select} value={condition} onChange={(e) => setCondition(e.target.value)} aria-label="기울기 조건">
          {MOTION_CONDITIONS.map((c) => (
            <option key={c.id} value={c.id}>
              조건: {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className={s.row}>
        <button className={s.btn} onClick={requestPerm}>
          동작 센서 허용
        </button>
        <button className={s.btnGhost} onClick={record} disabled={!listening || remaining !== null}>
          {remaining !== null ? `기록 중 ${remaining}초` : `${RECORD_S}초 기록`}
        </button>
      </div>
      {perm ? (
        <KV
          rows={[
            ["권한(동작 / 방향)", `${perm.motion} / ${perm.orientation}`],
            ["폰 롤 atan2(gx,gy)", `${fmt(liveM?.roll)}°`],
            ["g(x, y, z)", liveM ? `${fmt(liveM.gx, 2)}, ${fmt(liveM.gy, 2)}, ${fmt(liveM.gz, 2)}` : "—"],
            ["beta / gamma", liveO ? `${fmt(liveO.beta)} / ${fmt(liveO.gamma)}°` : "—"],
          ]}
        />
      ) : null}
      {results.length > 0 ? (
        <ul className={s.list}>
          {results.map((r, i) => {
            const x = r as {
              condition?: string;
              phoneRollCircularMean: number | null;
              phoneRollRelToMean: { std: number | null } | null;
              phoneRollRelToFirst: { std: number | null } | null;
              motionHz: number;
            };
            return (
              <li key={i}>
                {MOTION_CONDITIONS.find((c) => c.id === x.condition)?.label.split("(")[0] ?? "조건 모름"} · 롤 원형 평균 {fmt(x.phoneRollCircularMean)}° · 평균 대비 σ {fmt(x.phoneRollRelToMean?.std, 2)}° · 첫 표본 대비 σ{" "}
                {fmt(x.phoneRollRelToFirst?.std, 2)}° · {x.motionHz}Hz
              </li>
            );
          })}
        </ul>
      ) : null}
    </Section>
  );
}
