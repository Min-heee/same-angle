"use client";

/**
 * 4. 자세 픽스처: 6개 자세의 행렬 16개 숫자를 남긴다(TECH-NOTES 5절 실측 픽스처).
 *
 * yaw·pitch·roll 의 부호는 합성 데이터로 잡을 수 없다. 이 여섯 개가 D2 에서 부호·안내 방향
 * 테스트의 실제 데이터가 된다. 그래서 저장하는 것은 행렬 숫자·이름·그때 분해한 각뿐이고,
 * 이미지와 랜드마크는 남기지 않는다.
 *
 * 누른 뒤 3초 카운트다운(삐 소리)을 주는 것은, 후면 카메라로 혼자 찍으면 화면을 볼 수 없고
 * 누르는 손이 폰을 흔들기 때문이다. 그다음 1초 동안 모은 행렬의 원소별 중앙값을 쓴다.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { decompose, detectLayout, elementwiseMedian } from "@/core/matrix";
import { FIXTURE_NAMES, type FixtureName, type FixtureRecord } from "@/core/report";
import { useSpike } from "../context";
import s from "../spike.module.css";
import { Section } from "../ui";
import { errText, fmt, num } from "../util";

export const FIXTURE_LABELS: Record<FixtureName, string> = {
  front: "정면",
  selfLeft20: "자기 왼쪽 약 20°",
  selfRight20: "자기 오른쪽 약 20°",
  chinDown: "숙임",
  chinUp: "젖힘",
  tilt: "기울임",
};

const COUNTDOWN_S = 3;
const COLLECT_MS = 1000;
/** 1초에 이보다 적게 모이면 중앙값을 믿기 어렵다. [추론] 초깃값. */
const MIN_FRAMES = 5;

export function FixturesSection() {
  const { subscribe, loopRunning, engine, fixtures, setFixtures, sections, setSection, beep } = useSpike();
  const sec = sections.fixtures;
  const [active, setActive] = useState<FixtureName | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const unsubRef = useRef<(() => void) | null>(null);

  const clearAll = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    unsubRef.current?.();
    unsubRef.current = null;
  };
  useEffect(() => clearAll, []);

  useEffect(() => {
    setSection("fixtures", {
      data: {
        names: fixtures.map((f) => f.name),
        engine: engine ? `${engine.delegate}/${engine.numFaces}` : null,
        note: "행렬 숫자는 보고서의 fixtures 에 있습니다.",
      },
    });
  }, [fixtures, engine, setSection]);

  const capture = useCallback(
    (name: FixtureName) => {
      if (!engine || active) return;
      setActive(name);
      setSection("fixtures", { status: "running", reason: null });
      setCount(COUNTDOWN_S);
      beep("tick");
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
              clearAll();
              setCount(null);
              setActive(null);
              try {
                if (mats.length < MIN_FRAMES) {
                  throw new Error(`1초 동안 얼굴 1개 프레임이 ${mats.length}개뿐입니다(최소 ${MIN_FRAMES}).`);
                }
                const med = elementwiseMedian(mats);
                if (!med) throw new Error("행렬 중앙값을 만들 수 없습니다(비유한 값).");
                const layout = detectLayout(med);
                const dec = layout ? decompose(med, layout) : null;
                const rec: FixtureRecord = {
                  name,
                  matrix: med,
                  layout,
                  angles: dec ? { yaw: num(dec.yaw, 3)!, pitch: num(dec.pitch, 3)!, roll: num(dec.roll, 3)! } : null,
                  frames: mats.length,
                };
                setFixtures((prev) => [...prev.filter((f) => f.name !== name), rec]);
                setSection("fixtures", { status: "done", reason: null });
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
    [active, beep, engine, setFixtures, setSection, subscribe],
  );

  return (
    <Section
      no={4}
      title="자세 픽스처"
      refText="TECH-NOTES 6절 항목 2(yaw·pitch·roll 부호) · 5절 실측 픽스처"
      how="자세 버튼을 누르고 삐 소리 세 번 안에 자세를 잡으세요. 높은 삐 소리부터 1초 동안 모읍니다(끝나면 삐삐). 다시 누르면 덮어씁니다."
      status={sec.status}
      reason={sec.reason}
    >
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
        <p className={s.countdown}>
          {active ? FIXTURE_LABELS[active] : ""} {count > 0 ? count : "모으는 중"}
        </p>
      ) : null}
      {fixtures.length > 0 ? (
        <ul className={s.list}>
          {FIXTURE_NAMES.filter((n) => fixtures.some((f) => f.name === n)).map((n) => {
            const f = fixtures.find((x) => x.name === n)!;
            return (
              <li key={n}>
                {FIXTURE_LABELS[n]} · {f.frames}프레임 · 배치 {f.layout ?? "판별 불가"} · yaw {fmt(f.angles?.yaw)} pitch{" "}
                {fmt(f.angles?.pitch)} roll {fmt(f.angles?.roll)}
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className={s.ref} style={{ marginTop: 8 }}>
        &lsquo;자기 왼쪽&rsquo;은 찍히는 사람 기준 왼쪽입니다. 어느 카메라(전면·후면)로 찍었는지는 1번 기록에 남습니다.
      </p>
    </Section>
  );
}
