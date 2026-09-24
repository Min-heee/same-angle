"use client";

/**
 * 12. 결과 내보내기: 모든 섹션 결과를 core/report 빌더로 모아 JSON 한 개로.
 *
 * 빌더는 검증까지 한다. 이미지·랜드마크 키, data: URL, 비유한 수가 섞이면 내보내지 않고
 * 어디가 틀렸는지 화면에 적는다 — 틀린 보고서를 조용히 고쳐서 내보내지 않는다.
 *
 * 내보내는 길은 셋이다. 아이폰은 canShare 가 참이라 [공유]가 늘 공유 시트를 띄우므로,
 * 시트를 취소했을 때 갈 곳으로 [파일로 저장](blob <a download>)과 [복사]를 따로 둔다.
 * 결과 문구는 성공·취소·실패를 색으로 가르고(성공이 경고색으로 보이지 않게) 버튼 바로 밑에 둔다.
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
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(null);

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

  /** 파일로 저장: blob 주소를 <a download> 로 연다. 아이폰 사파리는 '다운로드' 확인 뒤 파일 앱에 둔다. */
  const download = (b: { text: string; name: string }) => {
    const url = URL.createObjectURL(new File([b.text], b.name, { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = b.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setStatus("done");
    setMsg({ tone: "ok", text: `파일로 저장했습니다: ${b.name} (파일 앱 → 다운로드)` });
  };

  const saveFile = () => {
    const b = build();
    if (b) download(b);
  };

  /** 공유 시트. 없거나 파일 공유를 못 하면 파일로 저장한다. 클릭 핸들러 안에서 곧바로 share 를 부른다. */
  const share = () => {
    const b = build();
    if (!b) return;
    const file = new File([b.text], b.name, { type: "application/json" });
    let canShareFile = false;
    try {
      canShareFile = typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
    } catch {
      canShareFile = false;
    }
    if (!canShareFile) {
      download(b);
      return;
    }
    navigator.share({ files: [file], title: b.name }).then(
      () => {
        setStatus("done");
        setMsg({ tone: "ok", text: `공유했습니다: ${b.name}` });
      },
      (e) => {
        const cancelled = typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
        setMsg(
          cancelled
            ? { tone: "warn", text: "공유를 취소했습니다. [파일로 저장]이나 [복사]를 쓰거나, 아래 글상자를 길게 눌러 복사하세요." }
            : { tone: "bad", text: `공유 실패: ${errText(e)} — [파일로 저장]이나 [복사]를 쓰세요.` },
        );
      },
    );
  };

  const copy = () => {
    const b = build();
    if (!b) return;
    if (typeof navigator.clipboard?.writeText !== "function") {
      setMsg({ tone: "warn", text: "클립보드 API 가 없습니다. 아래 글상자를 길게 눌러 전체 선택·복사하세요." });
      return;
    }
    navigator.clipboard.writeText(b.text).then(
      () => {
        setStatus("done");
        setMsg({ tone: "ok", text: `복사했습니다(${b.text.length.toLocaleString()}자). 개발 대화창에 붙여 넣으세요.` });
      },
      (e) => setMsg({ tone: "bad", text: `복사 실패: ${errText(e)} — 아래 글상자를 길게 눌러 복사하세요.` }),
    );
  };

  return (
    <Section
      no={12}
      title="결과 내보내기"
      refText="TECH-NOTES 6절 전체 — 결과를 개발 대화창으로"
      how="다 돌렸으면 [공유]·[복사]·[파일로 저장] 중 하나. 개발 대화창에 JSON 을 그대로 붙여 넣으면 됩니다."
      status={status}
    >
      <p className={s.promise}>
        보고서에는 <strong>이미지와 얼굴 랜드마크 좌표가 들어가지 않습니다.</strong> 기기 정보(userAgent·화면 크기·DPR), 측정 숫자,
        자세 픽스처의 행렬 16개 숫자만 들어갑니다. 내보내기 전에 검사기가 이미지·랜드마크 키와 data: URL 을 거부합니다.
      </p>
      <p className={s.ref} style={{ marginTop: 8 }}>
        완료된 섹션 {doneCount}/{Object.keys(sections).length} · 픽스처 {fixtures.length}/6
      </p>
      <div className={s.row}>
        <button className={s.btn} onClick={share}>
          공유
        </button>
        <button className={s.btnGhost} onClick={copy}>
          복사
        </button>
      </div>
      <div className={s.row}>
        <button className={s.btnGhost} onClick={saveFile}>
          파일로 저장
        </button>
        <button className={s.small} onClick={() => build()}>
          미리 보기만
        </button>
      </div>
      <div role="status" aria-live="polite">
        {msg ? <p className={msg.tone === "ok" ? s.okNote : msg.tone === "warn" ? s.note : s.reason}>{msg.text}</p> : null}
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
