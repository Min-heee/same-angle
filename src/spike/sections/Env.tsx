"use client";

import { useCallback, useEffect, useState } from "react";
import type { JsonValue } from "@/core/report";
import { audioState, beep, unlockAudio, type AudioState } from "../beep";
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

/**
 * WebGL2 지원 여부. 한 번만 재고 기억한다. 잰 컨텍스트는 곧바로 loseContext 로 돌려준다 —
 * WebKit 은 활성 WebGL 컨텍스트 수에 상한이 있어 넘으면 가장 오래된 것(돌고 있는 MediaPipe 엔진의
 * GPU 컨텍스트일 수 있다)을 잃는다. [다시 읽기]를 누를 때마다 새로 만들지 않는다.
 */
let webgl2Cache: boolean | null = null;
function hasWebgl2(): boolean {
  if (webgl2Cache !== null) return webgl2Cache;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    webgl2Cache = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl2Cache = false;
  }
  return webgl2Cache;
}

function collectEnv() {
  const w = window as unknown as Record<string, unknown>;
  const DOE = w.DeviceOrientationEvent as { requestPermission?: unknown } | undefined;
  const DME = w.DeviceMotionEvent as { requestPermission?: unknown } | undefined;
  const webgl2 = hasWebgl2();
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
      wakeLock: typeof (navigator as Navigator & { wakeLock?: unknown }).wakeLock === "object",
      localStorage: (() => {
        try {
          return typeof window.localStorage?.getItem === "function";
        } catch {
          return false;
        }
      })(),
    },
  };
}

export function EnvSection() {
  const { sections, setSection } = useSpike();
  const sec = sections.env;
  const [env, setEnv] = useState<ReturnType<typeof collectEnv> | null>(null);
  const [violations, setViolations] = useState<Violation[]>([]);
  // 소리는 한 손 점검의 유일한 신호다(beep.ts). 켜졌는지(running)와 무음 스위치를 무시하는
  // 세션(playback)인지를 보고서에 남겨, "삐 소리를 못 들었다"를 D1 뒤에 가릴 수 있게 한다.
  const [audio, setAudio] = useState<AudioState | null>(null);
  const [soundTested, setSoundTested] = useState(false);

  const refresh = useCallback(() => {
    try {
      const e = collectEnv();
      const v = readViolations();
      setEnv(e);
      setViolations(v);
      setAudio(audioState());
      setSection("env", {
        status: "done",
        reason: e.isSecureContext ? null : "보안 컨텍스트가 아닙니다(HTTPS 아님) — 카메라가 열리지 않습니다.",
      });
    } catch (err) {
      setSection("env", { status: "failed", reason: errText(err) });
    }
  }, [setSection]);

  useEffect(() => {
    refresh();
    // 위반은 페이지를 쓰는 동안 계속 쌓인다(모델·WASM 로드, 공유 등). 몇 초마다 다시 읽는다.
    // 오디오 상태도 전화·다른 앱 소리로 바뀌므로(interrupted) 같이 다시 읽는다.
    const id = setInterval(() => {
      const v = readViolations();
      setViolations((prev) => (prev.length === v.length ? prev : v));
      const a = audioState();
      setAudio((prev) => (prev && prev.context === a.context && prev.session === a.session ? prev : a));
    }, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  // 환경·위반·소리 상태가 바뀌면 보고서 데이터도 갱신한다.
  useEffect(() => {
    if (!env) return;
    setSection("env", {
      data: {
        ...(toJson(env) as { [k: string]: JsonValue }),
        cspViolations: toJson(violations),
        audio: audio ? { context: audio.context, session: audio.session, soundTested } : null,
      },
    });
  }, [env, violations, audio, soundTested, setSection]);

  /** 클릭 핸들러 안에서 잠금 해제 → 소리. 잠시 뒤 상태를 다시 읽는다(resume 은 비동기). */
  const testSound = () => {
    unlockAudio();
    beep("start");
    setSoundTested(true);
    setTimeout(() => setAudio(audioState()), 400);
  };

  const audioLabel = (a: AudioState | null) => {
    if (!a) return "—";
    const ctx =
      a.context === "running"
        ? "켜짐"
        : a.context === "none"
          ? "아직 안 만듦(화면을 한 번 누르세요)"
          : a.context === "unsupported"
            ? "지원 안 함"
            : `꺼짐(${a.context})`;
    const session =
      a.session === null ? "무음 스위치를 따름" : a.session === "playback" ? "무음 스위치 무시(playback)" : a.session;
    return `${ctx} · ${session}`;
  };

  const f = env?.features;
  const yn = (b: boolean | undefined) => (b === undefined ? "—" : b ? "있음" : "없음");

  return (
    <Section
      no={0}
      title="환경"
      refText="TECH-NOTES 6절 항목 10(CSP 동작) · 전 항목의 전제"
      how="열면 자동으로 적히고, CSP 위반 목록은 3초마다 스스로 갱신됩니다. 먼저 [소리 시험]으로 삐 소리를 확인하세요."
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
            ["CSP 위반(관찰 + 강제)", `${violations.length}건`],
            ["소리", audioLabel(audio)],
          ]}
        />
      ) : null}
      <div className={s.row}>
        <button className={s.btn} onClick={testSound}>
          소리 시험
        </button>
      </div>
      <p className={s.ref} style={{ marginTop: 6 }}>
        높은 삐 소리가 한 번 나야 합니다. 안 들리면 옆면 무음 스위치를 끄고 음량을 올린 뒤 다시 누르세요. 소리가 &lsquo;무음 스위치를
        따름&rsquo;이면 무음 모드에서는 3·4·8번의 삐 소리가 나지 않습니다.
      </p>
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
        CSP 는 connect-src 만 강제(enforce)하고 나머지 지시어는 관찰(Report-Only)합니다. 위반은 이벤트로 모읍니다. `npm run dev` 에는
        헤더가 없어 0건이 정상입니다. 11번의 CSP 강제 시험이 connect-src enforce 위반을 하나 남깁니다(루프백 주소).
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
