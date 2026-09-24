"use client";

/**
 * 11. 네트워크: 이 페이지가 지금까지 받은 리소스의 출처 목록(Resource Timing).
 *
 * 한계를 분명히 적는다. Resource Timing 은 페이지가 **받은** 것의 목록이고, 모든 요청을
 * 빠짐없이 보여 준다는 보장이 없다(버퍼 크기, 일부 요청 종류). 업로드 요청은 앱 코드가
 * 만들지 않지만, 그것의 확실한 확인은 맥 사파리 웹 인스펙터의 네트워크 기록으로 한다
 * (TECH-NOTES 6절 항목 10, PRD F10).
 *
 * 함께 적는 것:
 *  - fetch 가드가 막은 요청(출처·메서드·횟수). MediaPipe 사용 통계(odml.pa.googleapis.com)가
 *    여기에 잡히는 것이 정상이다 — 막혔다는 뜻이다(netguard.ts).
 *  - CSP 강제 시험: 가드를 우회해 루프백 주소(https://127.0.0.1:9)로 fetch 를 한 번 보내고,
 *    connect-src 'enforce' 위반 이벤트가 오는지 본다. 루프백이라 CSP 가 막지 못해도 기기 밖으로
 *    나가지 않는다. 배포본(강제 헤더 있음)에서는 enforce 위반이 있어야 통과, dev 서버는 없는 게 정상.
 */

import { useCallback, useEffect, useState } from "react";
import { MODEL_URL } from "../engine";
import { blockedRequests, fetchGuardInstalled, probeCsp, type CspProbeResult } from "../netguard";
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
  const [probe, setProbe] = useState<CspProbeResult | null>(null);

  useEffect(() => {
    // 기본 버퍼(250개)를 넘기면 뒤의 항목이 빠진다. 점검 동안은 넉넉히.
    try {
      performance.setResourceTimingBufferSize(2000);
    } catch {
      /* 없으면 기본값 */
    }
    // 강제 CSP 가 실제로 막는지: 열자마자 한 번(루프백 주소라 기기 밖으로 나가지 않는다).
    let alive = true;
    void probeCsp().then((r) => {
      if (alive) setProbe(r);
    });
    return () => {
      alive = false;
    };
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
      const blocked = blockedRequests();
      setSection("network", {
        status: "done",
        reason: outside.length ? `허용 목록 밖 출처 ${outside.length}곳` : null,
        data: {
          totalEntries: entries.length,
          allowlist: [...allow],
          origins: list.map((r) => ({ origin: r.origin, count: r.count, allowed: r.allowed, initiatorTypes: r.types })),
          outsideCount: outside.reduce((n, r) => n + r.count, 0),
          fetchGuard: { installed: fetchGuardInstalled(), blocked: blocked.map((b) => ({ ...b })) },
          cspProbe: probe ? { ...probe } : null,
          note: "Resource Timing 기준. 업로드 여부의 확실한 확인은 맥 사파리 웹 인스펙터로. fetchGuard.blocked 는 보내기 전에 막은 요청.",
        },
      });
    } catch (e) {
      setSection("network", { status: "failed", reason: errText(e) });
    }
  }, [probe, setSection]);

  const outside = rows.filter((r) => !r.allowed);
  const blocked = rows.length > 0 || probe ? blockedRequests() : [];

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
      <KV
        rows={[
          [
            "CSP 강제 시험",
            probe === null
              ? "재는 중…"
              : probe.enforceViolation
                ? "막힘(connect-src enforce) — 통과"
                : `enforce 위반 없음 — 배포본이면 실패, dev 서버면 정상 (${probe.error ?? "요청이 끝남"})`,
          ],
          ["가드가 막은 요청", blocked.length ? blocked.map((b) => `${b.method} ${b.origin} ×${b.count}`).join(", ") : "0건"],
        ]}
      />
      {rows.length > 0 ? (
        <>
          <KV rows={[["허용 목록 밖(받은 리소스)", `${outside.length}곳`]]} />
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
        앱 코드는 업로드 요청을 만들지 않고, MediaPipe 가 보내려는 사용 통계는 가드와 CSP 가 막습니다. 다만 이 목록만으로는 증명이
        되지 않으니, 확실한 확인은 아이폰을 맥에 연결해 사파리 웹 인스펙터의 네트워크 기록(odml.pa.googleapis.com 요청 0건,
        POST/PUT 0건)으로 하세요.
      </p>
    </Section>
  );
}
