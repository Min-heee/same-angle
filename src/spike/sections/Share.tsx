"use client";

/**
 * 10. 공유 테스트: 여러 파일 공유 시트와 파일명 보존, <img> 길게 눌러 저장(TECH-NOTES 6절 항목 8).
 *
 * 실제 사진 대신 캔버스로 그린 **합성 패턴**과 더미 JSON 을 쓴다. 이름은 F4 파일명 규칙
 * (ID_회차_뷰_방식_판정) 모양을 흉내 낸 TEST_01_front_gate_pass.* 이다.
 *
 * navigator.share 는 사용자 탭 안에서 바로 불러야 한다. 파일 준비(toBlob)는 비동기라
 * 공유 버튼 안에서 하면 제스처가 끊길 수 있어[추론], [파일 준비]를 먼저 따로 누른다.
 */

import { useEffect, useRef, useState } from "react";
import type { JsonValue } from "@/core/report";
import { useSpike } from "../context";
import { restoredList } from "../draft";
import { shareProgress } from "../progress";
import s from "../spike.module.css";
import { Section } from "../ui";
import { errText, pushCapped } from "../util";

const BASE = "TEST_01_front_gate_pass";

function drawPattern(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 1080;
  c.height = 1350;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D 캔버스를 만들 수 없습니다.");
  const grad = g.createLinearGradient(0, 0, 1080, 1350);
  grad.addColorStop(0, "#2456c9");
  grad.addColorStop(1, "#1a7f45");
  g.fillStyle = grad;
  g.fillRect(0, 0, 1080, 1350);
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.lineWidth = 2;
  for (let x = 0; x <= 1080; x += 90) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 1350);
    g.stroke();
  }
  for (let y = 0; y <= 1350; y += 90) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(1080, y);
    g.stroke();
  }
  g.fillStyle = "#fff";
  g.font = "bold 64px sans-serif";
  g.fillText("TEST_01", 80, 180);
  g.font = "40px sans-serif";
  g.fillText("합성 패턴 — 사진 아님", 80, 250);
  g.fillText(new Date().toISOString(), 80, 310);
  return c;
}

function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob 이 null 을 돌려줬습니다."))), "image/png"),
  );
}

interface Prepared {
  png: File;
  json: File;
  pngUrl: string;
  jsonUrl: string;
}

export function ShareSection() {
  const { sections, setSection, manualChecks, setManualChecks, restored } = useSpike();
  const rdata = restored?.sections.share.data;
  /** a[download] 대안이 됐는지(스키마는 그대로, 섹션 data 에). */
  const [downloadManual, setDownloadManual] = useState<string>(() => {
    const v = rdata && typeof rdata === "object" && !Array.isArray(rdata) ? rdata.downloadManual : null;
    return typeof v === "string" ? v : "";
  });
  const sec = sections.share;
  const [files, setFiles] = useState<Prepared | null>(null);
  const [canShare, setCanShare] = useState<JsonValue>(null);
  const [log, setLog] = useState<{ what: string; result: string }[]>(() => restoredList(rdata, "attempts"));
  const urlsRef = useRef<string[]>([]);

  useEffect(
    () => () => {
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  useEffect(() => {
    if (!files && log.length === 0 && !downloadManual) return;
    setSection("share", {
      data: {
        fileNames: [`${BASE}.png`, `${BASE}.json`],
        pngBytes: files?.png.size ?? null,
        canShare,
        attempts: log,
        downloadManual: downloadManual || null,
      },
    });
  }, [files, canShare, log, downloadManual, setSection]);

  // 완료 = 두 수동 확인(파일 앱 이름 보존, 길게 눌러 저장)에 모두 답함. [파일 준비]만으로는 완료가 아니다.
  useEffect(() => {
    if (!files && log.length === 0 && manualChecks.filesAppNamesKept === null && manualChecks.longPressSaved === null) return;
    const p = shareProgress(manualChecks);
    setSection("share", { status: p.done ? "done" : "running", reason: p.note });
  }, [files, log.length, manualChecks, setSection]);

  const prepare = async () => {
    setSection("share", { status: "running", reason: null });
    try {
      const blob = await toBlob(drawPattern());
      const png = new File([blob], `${BASE}.png`, { type: "image/png" });
      const json = new File(
        [JSON.stringify({ test: true, note: "same-angle D1 공유 시험용 더미 파일", createdAt: new Date().toISOString() }, null, 2)],
        `${BASE}.json`,
        { type: "application/json" },
      );
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      const pngUrl = URL.createObjectURL(png);
      const jsonUrl = URL.createObjectURL(json);
      urlsRef.current = [pngUrl, jsonUrl];
      setFiles({ png, json, pngUrl, jsonUrl });
      const cs = (list: File[]) => {
        try {
          return typeof navigator.canShare === "function" ? navigator.canShare({ files: list }) : null;
        } catch (e) {
          return `예외 ${errText(e)}`;
        }
      };
      setCanShare({ pngAndJson: cs([png, json]), pngOnly: cs([png]), jsonOnly: cs([json]) });
      // 자동으로 잴 수 있는 것(canShare)은 여기까지. 완료 여부는 수동 확인 응답으로 정한다(위 이펙트).
    } catch (e) {
      setSection("share", { status: "failed", reason: errText(e) });
    }
  };

  /** 클릭 핸들러 안에서 곧바로 share 를 부른다(await 전). */
  const share = (list: File[], what: string) => {
    if (typeof navigator.share !== "function") {
      setLog((p) => pushCapped(p, { what, result: "navigator.share 없음" }, 20));
      return;
    }
    let p: Promise<void>;
    try {
      p = navigator.share({ files: list, title: BASE });
    } catch (e) {
      setLog((prev) => pushCapped(prev, { what, result: `동기 예외 ${errText(e)}` }, 20));
      return;
    }
    p.then(
      () => {
        setLog((prev) => pushCapped(prev, { what, result: "완료(시트에서 대상 선택됨)" }, 20));
      },
      (e) => setLog((prev) => pushCapped(prev, { what, result: `거부/취소 ${errText(e)}` }, 20)),
    );
  };

  const tri = (v: boolean | null) => (v === null ? "" : v ? "yes" : "no");
  const fromTri = (s: string) => (s === "" ? null : s === "yes");

  return (
    <Section
      no={10}
      title="공유 테스트"
      refText="TECH-NOTES 6절 항목 8(여러 파일 공유 시트·파일명 보존, <img> 길게 눌러 저장)"
      how="[파일 준비] → [두 파일 공유]에서 '파일에 저장'을 골라 파일 앱에서 이름을 확인하세요(사파리를 떠나니 12번에서 먼저 중간 내보내기). 아래 그림을 길게 눌러 저장, [PNG 다운로드]도 해 보고 세 결과를 아래에 고르세요. 앞의 두 개에 답하면 완료."
      status={sec.status}
      reason={sec.reason}
    >
      <div className={s.row}>
        <button className={s.btn} onClick={prepare}>
          파일 준비
        </button>
      </div>
      {files ? (
        <>
          <div className={s.row}>
            <button className={s.btn} onClick={() => share([files.png, files.json], "PNG+JSON")}>
              두 파일 공유
            </button>
            <button className={s.btnGhost} onClick={() => share([files.png], "PNG만")}>
              PNG만 공유
            </button>
          </div>
          <div className={s.row}>
            <a
              className={s.btnGhost}
              href={files.pngUrl}
              download={`${BASE}.png`}
              onClick={() => setLog((p) => pushCapped(p, { what: "PNG 다운로드", result: "눌림(저장 여부는 아래에 고르세요)" }, 20))}
              style={{ textAlign: "center", textDecoration: "none" }}
            >
              PNG 다운로드
            </a>
            <a
              className={s.btnGhost}
              href={files.jsonUrl}
              download={`${BASE}.json`}
              onClick={() => setLog((p) => pushCapped(p, { what: "JSON 다운로드", result: "눌림(저장 여부는 아래에 고르세요)" }, 20))}
              style={{ textAlign: "center", textDecoration: "none" }}
            >
              JSON 다운로드
            </a>
          </div>
          <p className={s.ref} style={{ marginTop: 8 }}>
            canShare: {JSON.stringify(canShare)}
          </p>
          {/* 길게 눌러 저장 시험용. next/image 가 아니라 blob URL 그대로 보여야 한다. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={s.testImg} src={files.pngUrl} alt="공유 시험용 합성 패턴(사진 아님)" />
        </>
      ) : null}

      <div className={s.row}>
        <select
          className={s.select}
          value={tri(manualChecks.filesAppNamesKept)}
          onChange={(e) => setManualChecks({ ...manualChecks, filesAppNamesKept: fromTri(e.target.value) })}
          aria-label="파일 앱에 이름대로 저장됨"
        >
          <option value="">파일 앱 이름 보존: 안 해 봄</option>
          <option value="yes">파일 앱 이름 보존: 됨</option>
          <option value="no">파일 앱 이름 보존: 안 됨</option>
        </select>
        <select
          className={s.select}
          value={tri(manualChecks.longPressSaved)}
          onChange={(e) => setManualChecks({ ...manualChecks, longPressSaved: fromTri(e.target.value) })}
          aria-label="길게 눌러 저장됨"
        >
          <option value="">길게 눌러 저장: 안 해 봄</option>
          <option value="yes">길게 눌러 저장: 됨</option>
          <option value="no">길게 눌러 저장: 안 됨</option>
        </select>
        <select
          className={s.select}
          value={downloadManual}
          onChange={(e) => setDownloadManual(e.target.value)}
          aria-label="다운로드로 저장됨"
        >
          <option value="">다운로드로 저장: 안 해 봄</option>
          <option value="yes">다운로드로 저장: 됨</option>
          <option value="no">다운로드로 저장: 안 됨</option>
        </select>
      </div>

      {log.length > 0 ? (
        <ul className={s.list}>
          {log.map((l, i) => (
            <li key={i}>
              {l.what}: {l.result}
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}
