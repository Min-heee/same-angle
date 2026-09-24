"use client";

/**
 * 11. 네트워크: 이 페이지가 지금까지 받은 리소스의 출처 목록(Resource Timing).
 *
 * 한계를 분명히 적는다. Resource Timing 은 페이지가 **받은** 것의 목록이고, 모든 요청을
 * 빠짐없이 보여 준다는 보장이 없다(버퍼 크기, 일부 요청 종류). 업로드 요청은 앱 코드가
 * 만들지 않지만, 그것의 확실한 확인은 맥 사파리 웹 인스펙터의 네트워크 기록으로 한다
 * (TECH-NOTES 6절 항목 10, PRD F10).
 */

import { useCallback, useEffect, useState } from "react";
import { MODEL_URL } from "../engine";
import { useSpike } from "../context";
import s from "../spike.module.css";
import { KV, Section } from "../ui";
import { errText } from "../util";

interface OriginRow {
  origin: string;
  count: number;
  allowed: boolean;
  types: string[];
}

export function NetworkSection() {
  const { sections, setSection } = useSpike();
  const sec = sections.network;
  const [rows, setRows] = useState<OriginRow[]>([]);

  useEffect(() => {
    // 기본 버퍼(250개)를 넘기면 뒤의 항목이 빠진다. 점검 동안은 넉넉히.
    try {
      performance.setResourceTimingBufferSize(2000);
    } catch {
      /* 없으면 기본값 */
    }
  }, []);

  const refresh = useCallback(() => {
    try {
      const allow = new Set([window.location.origin, new URL(MODEL_URL).origin]);
      const map = new Map<string, OriginRow>();
      const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      for (const e of entries) {
        let origin: string;
        if (/^(blob|data):/i.test(e.name)) origin = e.name.slice(0, e.name.indexOf(":") + 1);
        else {
          try {
            origin = new URL(e.name).origin;
          } catch {
            origin = "(해석 불가)";
          }
        }
        const allowed = allow.has(origin) || origin === "blob:" || origin === "data:";
        const row = map.get(origin) ?? { origin, count: 0, allowed, types: [] };
        row.count++;
        if (!row.types.includes(e.initiatorType)) row.types.push(e.initiatorType);
        map.set(origin, row);
      }
      const list = [...map.values()].sort((a, b) => b.count - a.count);
      setRows(list);
      const outside = list.filter((r) => !r.allowed);
      setSection("network", {
        status: "done",
        reason: outside.length ? `허용 목록 밖 출처 ${outside.length}곳` : null,
        data: {
          totalEntries: entries.length,
          allowlist: [...allow],
          origins: list.map((r) => ({ origin: r.origin, count: r.count, allowed: r.allowed, initiatorTypes: r.types })),
          outsideCount: outside.reduce((n, r) => n + r.count, 0),
          note: "Resource Timing 기준. 업로드 여부의 확실한 확인은 맥 사파리 웹 인스펙터로.",
        },
      });
    } catch (e) {
      setSection("network", { status: "failed", reason: errText(e) });
    }
  }, [setSection]);

  const outside = rows.filter((r) => !r.allowed);

  return (
    <Section
      no={11}
      title="네트워크"
      refText="TECH-NOTES 6절 항목 10(허용 목록 밖 요청 0건)"
      how="다른 섹션을 다 돌린 뒤 [출처 목록 새로 고침]. 허용 목록은 이 사이트 자신과 storage.googleapis.com(모델 파일)뿐입니다."
      status={sec.status}
      reason={sec.reason}
    >
      <div className={s.row}>
        <button className={s.btn} onClick={refresh}>
          출처 목록 새로 고침
        </button>
      </div>
      {rows.length > 0 ? (
        <>
          <KV rows={[["허용 목록 밖", `${outside.length}곳`]]} />
          <ul className={s.list}>
            {rows.map((r) => (
              <li key={r.origin}>
                {r.allowed ? "허용" : "밖"} · {r.origin} · {r.count}건 ({r.types.join(", ")})
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className={s.note}>
        업로드 요청은 앱이 만들지 않습니다. 다만 이 목록만으로는 증명이 되지 않으니, 확실한 확인은 아이폰을 맥에 연결해 사파리 웹
        인스펙터의 네트워크 기록(POST/PUT 0건)으로 하세요.
      </p>
    </Section>
  );
}
