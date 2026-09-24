"use client";

/**
 * 12. 결과 내보내기: 모든 섹션 결과를 core/report 빌더로 모아 JSON 한 개로.
 *
 * 빌더는 검증까지 한다. 이미지·랜드마크 키, data: URL, 비유한 수가 섞이면 내보내지 않고
 * 어디가 틀렸는지 화면에 적는다 — 틀린 보고서를 조용히 고쳐서 내보내지 않는다.
 */

import { useMemo, useState } from "react";
import { ReportValidationError, buildReport, reportFileName, type Report } from "@/core/report";
import { useSpike } from "../context";
import s from "../spike.module.css";
import { Section } from "../ui";
import { errText } from "../util";

export function ExportSection() {
  const { sections, fixtures, manualChecks } = useSpike();
  const [built, setBuilt] = useState<{ report: Report; text: string; name: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  const doneCount = useMemo(() => Object.values(sections).filter((x) => x.status === "done").length, [sections]);

  /** 동기로 만든다 — 공유 버튼이 제스처 안에서 곧바로 share 를 부를 수 있게. */
  const build = () => {
    try {
      const now = new Date();
      const report = buildReport({
        createdAt: now.toISOString(),
        device: {
          userAgent: navigator.userAgent,
          screenWidth: screen.width,
          screenHeight: screen.height,
          devicePixelRatio: window.devicePixelRatio,
        },
        sections,
        fixtures,
        manualChecks,
      });
      const text = JSON.stringify(report, null, 2);
      const b = { report, text, name: reportFileName(now) };
      setBuilt(b);
      setErrors([]);
      return b;
    } catch (e) {
      setBuilt(null);
      setErrors(e instanceof ReportValidationError ? e.errors : [errText(e)]);
      setStatus("failed");
      return null;
    }
  };

  const shareOrDownload = () => {
    const b = build();
    if (!b) return;
    const file = new File([b.text], b.name, { type: "application/json" });
    let canShareFile = false;
    try {
      canShareFile = typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
    } catch {
      canShareFile = false;
    }
    if (canShareFile) {
      navigator.share({ files: [file], title: b.name }).then(
        () => {
          setStatus("done");
          setMsg(`공유했습니다: ${b.name}`);
        },
        (e) => setMsg(`공유 취소/실패: ${errText(e)} — [다운로드] 나 [복사]를 쓰세요.`),
      );
      return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = b.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setStatus("done");
    setMsg(`다운로드했습니다: ${b.name}`);
  };

  const copy = () => {
    const b = build();
    if (!b) return;
    if (typeof navigator.clipboard?.writeText !== "function") {
      setMsg("클립보드 API 가 없습니다. 아래 글상자를 길게 눌러 전체 선택·복사하세요.");
      return;
    }
    navigator.clipboard.writeText(b.text).then(
      () => {
        setStatus("done");
        setMsg(`복사했습니다(${b.text.length.toLocaleString()}자). 개발 대화창에 붙여 넣으세요.`);
      },
      (e) => setMsg(`복사 실패: ${errText(e)} — 아래 글상자를 길게 눌러 복사하세요.`),
    );
  };

  return (
    <Section
      no={12}
      title="결과 내보내기"
      refText="TECH-NOTES 6절 전체 — 결과를 개발 대화창으로"
      how="다 돌렸으면 [공유/다운로드] 또는 [복사]. 개발 대화창에 JSON 을 그대로 붙여 넣으면 됩니다."
      status={status}
      reason={msg}
    >
      <p className={s.promise}>
        보고서에는 <strong>이미지와 얼굴 랜드마크 좌표가 들어가지 않습니다.</strong> 기기 정보(userAgent·화면 크기·DPR), 측정 숫자,
        자세 픽스처의 행렬 16개 숫자만 들어갑니다. 내보내기 전에 검사기가 이미지·랜드마크 키와 data: URL 을 거부합니다.
      </p>
      <p className={s.ref} style={{ marginTop: 8 }}>
        완료된 섹션 {doneCount}/{Object.keys(sections).length} · 픽스처 {fixtures.length}/6
      </p>
      <div className={s.row}>
        <button className={s.btn} onClick={shareOrDownload}>
          공유/다운로드
        </button>
        <button className={s.btnGhost} onClick={copy}>
          복사
        </button>
      </div>
      <div className={s.row}>
        <button className={s.small} onClick={() => build()}>
          미리 보기만
        </button>
      </div>
      {errors.length > 0 ? (
        <div className={s.reason}>
          보고서 검사 실패 — 내보내지 않았습니다:
          <ul className={s.list}>
            {errors.slice(0, 20).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {built ? (
        <>
          <p className={s.ref} style={{ marginTop: 8 }}>
            {built.name} · {built.text.length.toLocaleString()}자
          </p>
          <textarea className={s.textarea} readOnly value={built.text} aria-label="보고서 JSON" />
        </>
      ) : null}
    </Section>
  );
}
