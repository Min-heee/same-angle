"use client";

import { useCallback, useEffect, useState } from "react";
import type { JsonValue } from "@/core/report";
import { useSpike } from "../context";
import s from "../spike.module.css";
import { Json, KV, Section } from "../ui";
import { errText, toJson } from "../util";

type Violation = { t: number; directive: string; blocked: string; disposition: string };

/** layout.tsx 의 인라인 수집기가 쌓은 CSP 위반 목록. */
function readViolations(): Violation[] {
  const w = window as unknown as { __cspViolations?: Violation[] };
  return Array.isArray(w.__cspViolations) ? [...w.__cspViolations] : [];
}

function collectEnv() {
  const w = window as unknown as Record<string, unknown>;
  const DOE = w.DeviceOrientationEvent as { requestPermission?: unknown } | undefined;
  const DME = w.DeviceMotionEvent as { requestPermission?: unknown } | undefined;
  let webgl2 = false;
  try {
    webgl2 = !!document.createElement("canvas").getContext("webgl2");
  } catch {
    webgl2 = false;
  }
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    isSecureContext: window.isSecureContext,
    userAgent: navigator.userAgent,
    screen: { width: screen.width, height: screen.height },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio,
    orientation: screen.orientation?.type ?? null,
    standalone: nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches,
    features: {
      getUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
      imageCapture: typeof w.ImageCapture === "function",
      requestVideoFrameCallback:
        typeof HTMLVideoElement !== "undefined" && "requestVideoFrameCallback" in HTMLVideoElement.prototype,
      deviceOrientationRequestPermission: typeof DOE?.requestPermission === "function",
      deviceMotionRequestPermission: typeof DME?.requestPermission === "function",
      share: typeof navigator.share === "function",
      canShare: typeof navigator.canShare === "function",
      createImageBitmap: typeof w.createImageBitmap === "function",
      offscreenCanvas: typeof w.OffscreenCanvas === "function",
      webgl2,
      clipboardWriteText: typeof navigator.clipboard?.writeText === "function",
    },
  };
}

export function EnvSection() {
  const { sections, setSection } = useSpike();
  const sec = sections.env;
  const [env, setEnv] = useState<ReturnType<typeof collectEnv> | null>(null);
  const [violations, setViolations] = useState<Violation[]>([]);

  const refresh = useCallback(() => {
    try {
      const e = collectEnv();
      const v = readViolations();
      setEnv(e);
      setViolations(v);
      setSection("env", {
        status: "done",
        reason: e.isSecureContext ? null : "보안 컨텍스트가 아닙니다(HTTPS 아님) — 카메라가 열리지 않습니다.",
        data: { ...(toJson(e) as { [k: string]: JsonValue }), cspViolations: toJson(v) },
      });
    } catch (err) {
      setSection("env", { status: "failed", reason: errText(err) });
    }
  }, [setSection]);

  useEffect(() => {
    refresh();
    // 위반은 페이지를 쓰는 동안 계속 쌓인다(모델·WASM 로드, 공유 등). 몇 초마다 다시 읽는다.
    const id = setInterval(() => {
      const v = readViolations();
      setViolations((prev) => (prev.length === v.length ? prev : v));
    }, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  // 새 위반이 들어오면 보고서 데이터도 갱신한다.
  useEffect(() => {
    if (!env) return;
    setSection("env", {
      data: { ...(toJson(env) as { [k: string]: JsonValue }), cspViolations: toJson(violations) },
    });
  }, [env, violations, setSection]);

  const f = env?.features;
  const yn = (b: boolean | undefined) => (b === undefined ? "—" : b ? "있음" : "없음");

  return (
    <Section
      no={0}
      title="환경"
      refText="TECH-NOTES 6절 항목 10(CSP 동작) · 전 항목의 전제"
      how="열면 자동으로 적힙니다. 다른 섹션을 다 돌린 뒤 [다시 읽기]로 CSP 위반 목록을 갱신하세요."
      status={sec.status}
      reason={sec.reason}
    >
      {env && f ? (
        <KV
          rows={[
            ["보안 컨텍스트", env.isSecureContext ? "예" : "아니오"],
            ["화면 · DPR", `${env.screen.width}×${env.screen.height} · ${env.devicePixelRatio}`],
            ["홈 화면 앱", env.standalone ? "예" : "아니오"],
            ["ImageCapture", yn(f.imageCapture)],
            ["requestVideoFrameCallback", yn(f.requestVideoFrameCallback)],
            ["방향 권한 요청 함수", yn(f.deviceOrientationRequestPermission)],
            ["동작 권한 요청 함수", yn(f.deviceMotionRequestPermission)],
            ["navigator.share / canShare", `${yn(f.share)} / ${yn(f.canShare)}`],
            ["createImageBitmap", yn(f.createImageBitmap)],
            ["WebGL2", yn(f.webgl2)],
            ["CSP 위반(Report-Only)", `${violations.length}건`],
          ]}
        />
      ) : null}
      {violations.length > 0 ? (
        <ul className={s.list}>
          {violations.map((v, i) => (
            <li key={i}>
              {v.directive} ← {v.blocked || "(빈 값)"} {v.disposition === "report" ? "(관찰)" : `(${v.disposition})`}
            </li>
          ))}
        </ul>
      ) : null}
      <p className={s.ref} style={{ marginTop: 8 }}>
        CSP 는 지금 관찰 모드라 아무것도 막지 않습니다. 위반은 이벤트로만 모읍니다. `npm run dev` 에는 헤더가 없어 0건이 정상입니다.
      </p>
      <div className={s.row}>
        <button className={s.btnGhost} onClick={refresh}>
          다시 읽기
        </button>
      </div>
      {env ? <Json value={{ ...env, cspViolations: violations }} /> : null}
    </Section>
  );
}
