"use client";

/**
 * 4. 자세 픽스처: 6개 자세의 행렬 16개 숫자를 남긴다(TECH-NOTES 5절 실측 픽스처).
 *
 * yaw·pitch·roll 의 부호는 합성 데이터로 잡을 수 없다. 이 여섯 개가 D2 에서 부호·안내 방향
 * 테스트의 실제 데이터가 된다. 그래서 저장하는 것은 행렬 숫자·이름·그때 분해한 각뿐이고,
 * 이미지와 랜드마크는 남기지 않는다.
 *
 * 부호를 정하려면 **어느 카메라로 찍었는지**가 픽스처마다 붙어 있어야 한다(전면 카메라 프레임은
 * 좌우가 뒤집혀 있을 수 있다). 1번의 시작 기록만으로는 어느 시작이 픽스처 시점의 카메라였는지
 * 이어지지 않으므로, 저장하는 순간의 트랙 정보(facingMode·라벨·영상 크기·엔진)를
 * fixtures 섹션 data.captures 에 픽스처마다 남긴다(보고서 스키마는 그대로).
 *
 * 누른 뒤 3초 카운트다운(삐 소리)을 주는 것은, 후면 카메라로 혼자 찍으면 화면을 볼 수 없고
 * 누르는 손이 폰을 흔들기 때문이다. 그다음 1초 동안 모은 행렬의 원소별 중앙값을 쓴다.
 * 그 사이 화면이 꺼지거나 루프·카메라가 멈추면 그 픽스처는 버린다.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { FIXTURE_NAMES, type FixtureName, type JsonValue } from "@/core/report";
import { engineKeyOf, useSpike } from "../context";
import { restoredList } from "../draft";
import { FIXTURE_LABELS, fixtureFromMatrices } from "../fixture";
import { fixturesProgress } from "../progress";
import s from "../spike.module.css";
import { Section } from "../ui";
import { errText, fmt, shortId } from "../util";

const COUNTDOWN_S = 3;
const COLLECT_MS = 1000;

interface Capture {
  name: FixtureName;
  facingMode: string | null;
  trackLabel: string | null;
  deviceIdShort: string | null;
  videoSize: string | null;
  engine: string | null;
  /** performance.now() 기준 ms(1번 시작 기록의 t 와 같은 시계). */
  t: number;
}

export function FixturesSection() {
  const {
    subscribe,
    subscribeInterrupt,
    loopRunning,
    engine,
    fixtures,
    setFixtures,
    sections,
    setSection,
    beep,
    stream,
    videoRef,
    setRecording,
    restored,
  } = useSpike();
  const sec = sections.fixtures;
  const [active, setActive] = useState<FixtureName | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [captures, setCaptures] = useState<Capture[]>(() => restoredList<Capture>(restored?.sections.fixtures.data, "captures"));
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const unsubRef = useRef<(() => void) | null>(null);

  const clearAll = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    unsubRef.current?.();
    unsubRef.current = null;
  }, []);
  useEffect(() => clearAll, [clearAll]);

  useEffect(() => {
    setSection("fixtures", {
      data: {
        names: fixtures.map((f) => f.name),
        engine: engineKeyOf(engine),
        captures: captures as unknown as JsonValue,
        note: "행렬 숫자는 보고서의 fixtures 에 있습니다. captures 는 픽스처마다 찍은 카메라입니다.",
      },
    });
  }, [captures, fixtures, engine, setSection]);

  const facing = (stream?.getVideoTracks()[0]?.getSettings().facingMode as string | undefined) ?? null;

  const capture = useCallback(
    (name: FixtureName) => {
      if (!engine || active) return;
      setActive(name);
      setRecording("자세 픽스처");
      setSection("fixtures", { status: "running", reason: null });
      setCount(COUNTDOWN_S);
      beep("tick");

      const finish = () => {
        clearAll();
        unsubIntRef.current?.();
        unsubIntRef.current = null;
        setRecording(null);
        setCount(null);
        setActive(null);
      };
      const unsubIntRef: { current: (() => void) | null } = { current: null };
      unsubIntRef.current = subscribeInterrupt((k) => {
        finish();
        const why =
          k === "hidden"
            ? "화면이 꺼졌거나 다른 앱으로 가서 버렸습니다"
            : k === "loopStopped"
              ? "추론 루프가 멈춰 버렸습니다"
              : "카메라가 끊겨 버렸습니다";
        setSection("fixtures", { status: "failed", reason: `${FIXTURE_LABELS[name]}: ${why} — 다시 누르세요.` });
        beep("error");
      });

      for (let i = 1; i < COUNTDOWN_S; i++) {
        timersRef.current.push(
          setTimeout(() => {
            setCount(COUNTDOWN_S - i);
            beep("tick");
          }, i * 1000),
        );
      }
      timersRef.current.push(
        setTimeout(() => {
          setCount(0);
          beep("start");
          const mats: number[][] = [];
          unsubRef.current = subscribe((x) => {
            if (x.faces === 1 && x.matrix && x.matrix.length === 16) mats.push(x.matrix);
          });
          timersRef.current.push(
            setTimeout(() => {
              finish();
              try {
                const rec = fixtureFromMatrices(name, mats);
                const track = stream?.getVideoTracks()[0];
                const st = track?.getSettings();
                const v = videoRef.current;
                const cap: Capture = {
                  name,
                  facingMode: (st?.facingMode as string | undefined) ?? null,
                  trackLabel: track?.label ? track.label.slice(0, 80) : null,
                  deviceIdShort: shortId(st?.deviceId),
                  videoSize: v ? `${v.videoWidth}x${v.videoHeight}` : null,
                  engine: engineKeyOf(engine),
                  t: Math.round(performance.now()),
                };
                const nextFx = [...fixtures.filter((f) => f.name !== name), rec];
                setFixtures(() => nextFx);
                setCaptures((p) => [...p.filter((c) => c.name !== name), cap]);
                const p = fixturesProgress(
                  nextFx.map((f) => f.name),
                  FIXTURE_LABELS,
                );
                const warn = cap.facingMode !== "environment" ? ` · 주의: 후면 카메라가 아닙니다(facingMode ${cap.facingMode ?? "모름"})` : "";
                setSection("fixtures", { status: p.done ? "done" : "running", reason: `${p.note}${warn}` });
                beep("end");
              } catch (e) {
                setSection("fixtures", { status: "failed", reason: `${FIXTURE_LABELS[name]}: ${errText(e)}` });
                beep("error");
              }
            }, COLLECT_MS),
          );
        }, COUNTDOWN_S * 1000),
      );
    },
    [active, beep, clearAll, engine, fixtures, setFixtures, setRecording, setSection, stream, subscribe, subscribeInterrupt, videoRef],
  );

  return (
    <Section
      no={4}
      title="자세 픽스처"
      refText="TECH-NOTES 6절 항목 2(yaw·pitch·roll 부호) · 5절 실측 픽스처"
      how="후면 카메라, 폰은 거치(삼각대·물건에 기대기), 머리만 움직이세요. 자세 버튼을 누르고 삐 소리 세 번 안에 자세를 잡으면, 높은 삐 소리부터 1초 동안 모읍니다(끝나면 삐삐). 다시 누르면 덮어씁니다. 6개 모두 저장하면 완료."
      status={sec.status}
      reason={sec.reason}
    >
      {stream && facing !== "environment" ? (
        <p className={s.note}>
          지금 카메라는 후면이 아닙니다(facingMode {facing ?? "모름"}). 픽스처는 후면 카메라로 찍어야 부호 판정에 씁니다 — 1번에서 후면으로
          바꾸세요.
        </p>
      ) : null}
      <div className={s.row}>
        {FIXTURE_NAMES.map((n) => (
          <button
            key={n}
            className={s.btnGhost}
            onClick={() => capture(n)}
            disabled={!loopRunning || active !== null}
            style={fixtures.some((f) => f.name === n) ? { borderStyle: "dashed" } : undefined}
          >
            {FIXTURE_LABELS[n]}
            {fixtures.some((f) => f.name === n) ? " ✓" : ""}
          </button>
        ))}
      </div>
      {!loopRunning ? <p className={s.ref} style={{ marginTop: 6 }}>2번에서 추론을 시작해야 저장할 수 있습니다.</p> : null}
      {count !== null ? (
        <p className={s.countdown} aria-live="assertive">
          {active ? FIXTURE_LABELS[active] : ""} {count > 0 ? count : "모으는 중"}
        </p>
      ) : null}
      {fixtures.length > 0 ? (
        <ul className={s.list}>
          {FIXTURE_NAMES.filter((n) => fixtures.some((f) => f.name === n)).map((n) => {
            const f = fixtures.find((x) => x.name === n)!;
            const c = captures.find((x) => x.name === n);
            return (
              <li key={n}>
                {FIXTURE_LABELS[n]} · {f.frames}프레임 · 배치 {f.layout ?? "판별 불가"} · yaw {fmt(f.angles?.yaw)} pitch{" "}
                {fmt(f.angles?.pitch)} roll {fmt(f.angles?.roll)} · 카메라 {c?.facingMode ?? "모름"}
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className={s.ref} style={{ marginTop: 8 }}>
        &lsquo;자기 왼쪽&rsquo;·&lsquo;오른쪽 귀&rsquo;는 찍히는 사람 기준입니다. 각 픽스처에 찍은 카메라(facingMode·라벨·영상 크기)가 함께
        남습니다.
      </p>
    </Section>
  );
}
