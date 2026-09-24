"use client";

/**
 * 점검 페이지 공용 조각: 섹션 틀, 상태 칩, 키-값 표.
 */

import type { ReactNode } from "react";
import type { SectionStatus } from "@/core/report";
import s from "./spike.module.css";

const STATUS_LABEL: Record<SectionStatus, string> = {
  idle: "대기",
  running: "진행",
  done: "완료",
  failed: "실패",
};

export function StatusChip({ status }: { status: SectionStatus }) {
  return <span className={`${s.chip} ${s[`chip_${status}`]}`}>{STATUS_LABEL[status]}</span>;
}

export function Section(props: {
  no: number;
  title: string;
  /** "TECH-NOTES 6절 항목 n" 표기. */
  refText: string;
  /** 한 줄 하는 법. */
  how: ReactNode;
  status: SectionStatus;
  reason?: string | null;
  children: ReactNode;
}) {
  return (
    <section className={s.section} id={`s${props.no}`}>
      <div className={s.sectionHead}>
        <div>
          <h2>
            {props.no}. {props.title}
          </h2>
          <p className={s.ref}>{props.refText}</p>
        </div>
        <StatusChip status={props.status} />
      </div>
      <p className={s.how}>{props.how}</p>
      {props.status === "failed" && props.reason ? <p className={s.reason}>실패 이유: {props.reason}</p> : null}
      {props.status !== "failed" && props.reason ? <p className={s.note}>{props.reason}</p> : null}
      {props.children}
    </section>
  );
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className={s.kv}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Json({ value, summary = "원자료 보기" }: { value: unknown; summary?: string }) {
  return (
    <details className={s.details}>
      <summary>{summary}</summary>
      <pre className={s.pre}>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
