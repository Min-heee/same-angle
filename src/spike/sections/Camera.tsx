"use client";

/**
 * 1. 카메라 경로(PRD F11, TECH-NOTES 3절).
 *
 * 확인하려는 것: 후면 카메라가 어떤 해상도로 열리는가, 장치 목록과 라벨(한국어로 현지화되는지),
 * 특정 렌즈를 deviceId 로 고를 수 있는가, getSettings/getCapabilities 에 무엇이 오는가,
 * 폰을 돌리면 스트림 크기가 어떻게 바뀌는가, torch 를 끌 수 있는가.
 *
 * 라벨은 **그대로** 보여 주고 기록한다. "Back Ultra Wide" 같은 영어 문자열로 렌즈를 고르면
 * 한국어 기기에서 조용히 틀린다(TECH-NOTES 3절).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { JsonValue } from "@/core/report";
import { useSpike } from "../context";
import s from "../spike.module.css";
import { Json, KV, Section } from "../ui";
import { errText, pushCapped, shortId, toJson } from "../util";

interface Attempt {
  label: string;
  ok: boolean;
  error: string | null;
}

interface DeviceRow {
  label: string;
  deviceId: string;
  groupIdShort: string | null;
}

interface StartRecord {
  how: string;
  trackLabel: string;
  settings: JsonValue;
  capabilities: JsonValue;
  torchOff: string;
}

interface ResizeRow {
  t: number;
  w: number;
  h: number;
  orientation: string | null;
}

/**
 * 보고서에 남기는 최근 기록 수. 시도 기록은 오류 문장(최대 400자)을 담아 글자 수가 크다.
 * 20건 + 시작 기록 6건이 보고서 섹션 글자 한도(MAX_SECTION_CHARS 24,000) 안에 들도록 잡았다.
 */
const ATTEMPTS_KEEP = 20;
const STARTS_KEEP = 6;

/** 후보 제약: 앞에서부터 시도해 처음 열리는 것을 쓴다. */
const CANDIDATES: { label: string; c: MediaTrackConstraints }[] = [
  {
    label: "environment · 1920×1080 ideal",
    c: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  },
  {
    label: "environment · 1280×720 ideal",
    c: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
  },
  { label: "environment", c: { facingMode: { ideal: "environment" } } },
];

async function torchOff(track: MediaStreamTrack): Promise<string> {
  const caps = (track.getCapabilities?.() ?? {}) as { torch?: unknown };
  try {
    await track.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] });
    const now = (track.getSettings() as { torch?: unknown }).torch;
    return `적용됨(capabilities.torch=${JSON.stringify(caps.torch ?? null)}, settings.torch=${JSON.stringify(now ?? null)})`;
  } catch (e) {
    return `실패: ${errText(e)} (capabilities.torch=${JSON.stringify(caps.torch ?? null)})`;
  }
}

export function CameraSection() {
  const { videoRef, stream, setStream, sections, setSection, stopLoop } = useSpike();
  const sec = sections.camera;

  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [selected, setSelected] = useState("");
  const [starts, setStarts] = useState<StartRecord[]>([]);
  const [resizes, setResizes] = useState<ResizeRow[]>([]);
  const [busy, setBusy] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  streamRef.current = stream;

  // 보고서 데이터는 상태에서 한 번에 만든다.
  useEffect(() => {
    if (attempts.length === 0 && starts.length === 0) return;
    setSection("camera", {
      data: {
        attempts: toJson(attempts),
        devices: devices.map((d) => ({ label: d.label, deviceIdShort: shortId(d.deviceId), groupIdShort: d.groupIdShort })),
        starts: starts as unknown as JsonValue,
        resizes: toJson(resizes),
      },
    });
  }, [attempts, devices, starts, resizes, setSection]);

  // 비디오 크기 변화(회전·렌즈 전환) 기록.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onResize = () => {
      setResizes((prev) =>
        pushCapped(
          prev,
          {
            t: Math.round(performance.now()),
            w: v.videoWidth,
            h: v.videoHeight,
            orientation: screen.orientation?.type ?? null,
          },
          50,
        ),
      );
    };
    v.addEventListener("resize", onResize);
    return () => v.removeEventListener("resize", onResize);
  }, [videoRef]);

  const attach = useCallback(
    async (ms: MediaStream, how: string) => {
      const v = videoRef.current;
      if (!v) throw new Error("비디오 요소가 없습니다.");
      v.srcObject = ms;
      try {
        await v.play();
      } catch (e) {
        // autoplay muted playsinline 이면 보통 필요 없지만, 실패하면 이유를 남긴다.
        setAttempts((p) => pushCapped(p, { label: "video.play()", ok: false, error: errText(e) }, ATTEMPTS_KEEP));
      }
      setStream(ms);
      const track = ms.getVideoTracks()[0];
      const torch = track ? await torchOff(track) : "비디오 트랙 없음";
      const settings = track ? toJson(track.getSettings()) : null;
      if (settings && typeof settings === "object" && !Array.isArray(settings) && "deviceId" in settings) {
        settings.deviceId = shortId(String(settings.deviceId));
        if ("groupId" in settings) settings.groupId = shortId(String(settings.groupId));
      }
      const caps = track && typeof track.getCapabilities === "function" ? toJson(track.getCapabilities()) : null;
      if (caps && typeof caps === "object" && !Array.isArray(caps) && "deviceId" in caps) {
        caps.deviceId = shortId(String(caps.deviceId));
        if ("groupId" in caps) caps.groupId = shortId(String(caps.groupId));
      }
      setStarts((p) =>
        pushCapped(p, { how, trackLabel: track?.label ?? "", settings, capabilities: caps, torchOff: torch }, STARTS_KEEP),
      );

      // 권한을 받은 뒤라야 라벨이 채워진다.
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        const rows = list
          .filter((d) => d.kind === "videoinput")
          .map((d) => ({ label: d.label, deviceId: d.deviceId, groupIdShort: shortId(d.groupId) }));
        setDevices(rows);
        const cur = track?.getSettings().deviceId;
        if (cur) setSelected(cur);
      } catch (e) {
        setAttempts((p) => pushCapped(p, { label: "enumerateDevices", ok: false, error: errText(e) }, ATTEMPTS_KEEP));
      }
    },
    [videoRef, setStream],
  );

  const stopCurrent = useCallback(() => {
    stopLoop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setStream(null);
  }, [setStream, stopLoop, videoRef]);

  /**
   * 사용자 제스처 안에서 getUserMedia 를 부른다. async 함수는 첫 await 까지 동기로 돌기 때문에
   * 첫 후보의 getUserMedia 호출은 탭 이벤트 안에서 일어난다.
   */
  const start = useCallback(async () => {
    setBusy(true);
    setSection("camera", { status: "running", reason: null });
    stopCurrent();
    let lastErr: unknown = null;
    for (const cand of CANDIDATES) {
      try {
        const ms = await navigator.mediaDevices.getUserMedia({ video: cand.c, audio: false });
        setAttempts((p) => pushCapped(p, { label: cand.label, ok: true, error: null }, ATTEMPTS_KEEP));
        await attach(ms, cand.label);
        setSection("camera", { status: "done", reason: null });
        setBusy(false);
        return;
      } catch (e) {
        lastErr = e;
        setAttempts((p) => pushCapped(p, { label: cand.label, ok: false, error: errText(e) }, ATTEMPTS_KEEP));
        // 권한 거부는 다음 후보로 넘어가도 같은 결과다.
        if (e instanceof DOMException && e.name === "NotAllowedError") break;
      }
    }
    setSection("camera", { status: "failed", reason: errText(lastErr) });
    setBusy(false);
  }, [attach, setSection, stopCurrent]);

  const restartWithDevice = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setSection("camera", { status: "running", reason: null });
    stopCurrent();
    const label = devices.find((d) => d.deviceId === selected)?.label ?? "(라벨 없음)";
    const how = `deviceId 선택: ${label}`;
    try {
      const ms = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: selected }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      setAttempts((p) => pushCapped(p, { label: how, ok: true, error: null }, ATTEMPTS_KEEP));
      await attach(ms, how);
      setSection("camera", { status: "done", reason: null });
    } catch (e) {
      setAttempts((p) => pushCapped(p, { label: how, ok: false, error: errText(e) }, ATTEMPTS_KEEP));
      setSection("camera", { status: "failed", reason: errText(e) });
    }
    setBusy(false);
  }, [attach, devices, selected, setSection, stopCurrent]);

  const lastStart = starts[starts.length - 1];
  const v = videoRef.current;

  return (
    <Section
      no={1}
      title="카메라"
      refText="TECH-NOTES 6절 항목 4(렌즈 선택·라벨·전환), 항목 7(회전 시 스트림 크기)"
      how="[카메라 켜기] → 권한 허용. 장치 목록에서 렌즈를 골라 [이 장치로 다시 켜기]를 해 보고, 폰을 가로·세로로 돌려 보세요."
      status={sec.status}
      reason={sec.reason}
    >
      <div className={s.row}>
        <button className={s.btn} onClick={start} disabled={busy}>
          {stream ? "카메라 다시 켜기" : "카메라 켜기"}
        </button>
        <button className={s.btnGhost} onClick={stopCurrent} disabled={!stream}>
          끄기
        </button>
      </div>

      {devices.length > 0 ? (
        <div className={s.row}>
          <select className={s.select} value={selected} onChange={(e) => setSelected(e.target.value)}>
            {devices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `(라벨 없음 ${i + 1})`}
              </option>
            ))}
          </select>
          <button className={s.btnGhost} onClick={restartWithDevice} disabled={busy || !selected}>
            이 장치로 다시 켜기
          </button>
        </div>
      ) : null}

      {lastStart ? (
        <KV
          rows={[
            ["연 방법", lastStart.how],
            ["트랙 라벨", lastStart.trackLabel || "(빈 값)"],
            ["videoWidth×Height", v ? `${v.videoWidth}×${v.videoHeight}` : "—"],
            ["torch 끄기", lastStart.torchOff],
            ["장치 수", String(devices.length)],
          ]}
        />
      ) : null}

      {devices.length > 0 ? (
        <ul className={s.list}>
          {devices.map((d, i) => (
            <li key={d.deviceId || i}>
              {d.label || "(라벨 없음)"} <span className={s.ref}>· group {d.groupIdShort ?? "—"}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {resizes.length > 0 ? (
        <details className={s.details}>
          <summary>스트림 크기 변화 {resizes.length}건</summary>
          <ul className={s.list}>
            {resizes.map((r, i) => (
              <li key={i}>
                {r.t}ms · {r.w}×{r.h} · {r.orientation ?? "방향 모름"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {attempts.length > 0 ? (
        <details className={s.details}>
          <summary>시도 기록 {attempts.length}건</summary>
          <ul className={s.list}>
            {attempts.map((a, i) => (
              <li key={i}>
                {a.ok ? "성공" : "실패"} · {a.label}
                {a.error ? ` · ${a.error}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {lastStart ? <Json value={{ settings: lastStart.settings, capabilities: lastStart.capabilities }} summary="getSettings / getCapabilities" /> : null}
    </Section>
  );
}
