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
  /**
   * getUserMedia 가 연 그대로의 설정과, torch 끄기(applyConstraints) 뒤의 설정.
   * applyConstraints 는 트랙의 제약 집합을 통째로 바꾸므로 UA 가 해상도를 다시 고를 수 있다.
   * 둘 다 남겨야 "후면 카메라가 어떤 해상도로 열리는가"(D1 질문)와 그 뒤의 변화를 가를 수 있다.
   */
  settingsBeforeTorch: JsonValue;
  settingsAfterTorch: JsonValue;
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

/** 해상도 제약만 남긴다(facingMode·deviceId 는 applyConstraints 로 바꾸는 대상이 아니다). */
function sizeOnly(c: MediaTrackConstraints): MediaTrackConstraints {
  const out: MediaTrackConstraints = {};
  if (c.width !== undefined) out.width = c.width;
  if (c.height !== undefined) out.height = c.height;
  return out;
}

/** deviceId·groupId 를 앞 8자로 줄인 JSON(출처별 무작위 값이지만 통째로 남길 이유가 없다). */
function shortenIds(x: JsonValue): JsonValue {
  if (x && typeof x === "object" && !Array.isArray(x)) {
    if ("deviceId" in x) x.deviceId = shortId(String(x.deviceId));
    if ("groupId" in x) x.groupId = shortId(String(x.groupId));
  }
  return x;
}

/**
 * torch 를 끈다. 제약 집합을 통째로 바꾸는 호출이라, 연 때의 해상도 ideal 을 같이 넣어
 * torch 한 줄 때문에 해상도가 기본값으로 다시 골라지지 않게 한다.
 */
async function torchOff(track: MediaStreamTrack, keep: MediaTrackConstraints): Promise<string> {
  const caps = (track.getCapabilities?.() ?? {}) as { torch?: unknown };
  try {
    await track.applyConstraints({ ...keep, advanced: [{ torch: false } as MediaTrackConstraintSet] });
    const now = (track.getSettings() as { torch?: unknown }).torch;
    return `적용됨(capabilities.torch=${JSON.stringify(caps.torch ?? null)}, settings.torch=${JSON.stringify(now ?? null)})`;
  } catch (e) {
    return `실패: ${errText(e)} (capabilities.torch=${JSON.stringify(caps.torch ?? null)})`;
  }
}

/** getSettings JSON 에서 "1920×1080". 없으면 "—". */
function sizeOf(x: JsonValue): string {
  if (x && typeof x === "object" && !Array.isArray(x) && typeof x.width === "number" && typeof x.height === "number") {
    return `${x.width}×${x.height}`;
  }
  return "—";
}

export function CameraSection() {
  const { videoRef, stream, setStream, sections, setSection, stopLoop, startLoop, loopRunning, engineRef } = useSpike();
  const sec = sections.camera;

  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [selected, setSelected] = useState("");
  const [starts, setStarts] = useState<StartRecord[]>([]);
  const [resizes, setResizes] = useState<ResizeRow[]>([]);
  const [busy, setBusy] = useState(false);
  /** 카메라를 다시 켤 때 추론을 어떻게 했는지(2번이 조용히 멈추지 않게 알린다). */
  const [loopNote, setLoopNote] = useState<string | null>(null);
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
    async (ms: MediaStream, how: string, requested: MediaTrackConstraints) => {
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
      const before = track ? shortenIds(toJson(track.getSettings())) : null;
      const torch = track ? await torchOff(track, sizeOnly(requested)) : "비디오 트랙 없음";
      const after = track ? shortenIds(toJson(track.getSettings())) : null;
      const caps = track && typeof track.getCapabilities === "function" ? shortenIds(toJson(track.getCapabilities())) : null;
      setStarts((p) =>
        pushCapped(
          p,
          {
            how,
            trackLabel: track?.label ?? "",
            settingsBeforeTorch: before,
            settingsAfterTorch: after,
            capabilities: caps,
            torchOff: torch,
          },
          STARTS_KEEP,
        ),
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
  /**
   * 카메라를 다시 켜면 stopCurrent 가 추론 루프도 멈춘다. 돌던 루프는 새 스트림에서 이어서
   * 돌리고, 아니면 멈춰 있다고 적는다(3·4·9번 버튼이 조용히 꺼지지 않게).
   */
  const afterRestart = useCallback(
    (wasRunning: boolean) => {
      if (wasRunning && engineRef.current) {
        startLoop();
        setLoopNote("카메라를 다시 켜서 2번 추론을 이어서 돌립니다.");
      } else if (engineRef.current) {
        setLoopNote("추론이 멈춰 있습니다 — 2번에서 [추론 시작]을 누르세요.");
      } else {
        setLoopNote(null);
      }
    },
    [engineRef, startLoop],
  );

  const start = useCallback(async () => {
    setBusy(true);
    setSection("camera", { status: "running", reason: null });
    const wasRunning = loopRunning;
    stopCurrent();
    let lastErr: unknown = null;
    for (const cand of CANDIDATES) {
      try {
        const ms = await navigator.mediaDevices.getUserMedia({ video: cand.c, audio: false });
        setAttempts((p) => pushCapped(p, { label: cand.label, ok: true, error: null }, ATTEMPTS_KEEP));
        await attach(ms, cand.label, cand.c);
        setSection("camera", { status: "done", reason: null });
        afterRestart(wasRunning);
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
    setLoopNote(null);
    setBusy(false);
  }, [afterRestart, attach, loopRunning, setSection, stopCurrent]);

  const restartWithDevice = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setSection("camera", { status: "running", reason: null });
    const wasRunning = loopRunning;
    stopCurrent();
    const label = devices.find((d) => d.deviceId === selected)?.label ?? "(라벨 없음)";
    const how = `deviceId 선택: ${label}`;
    const video: MediaTrackConstraints = { deviceId: { exact: selected }, width: { ideal: 1920 }, height: { ideal: 1080 } };
    try {
      const ms = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      setAttempts((p) => pushCapped(p, { label: how, ok: true, error: null }, ATTEMPTS_KEEP));
      await attach(ms, how, video);
      setSection("camera", { status: "done", reason: null });
      afterRestart(wasRunning);
    } catch (e) {
      setAttempts((p) => pushCapped(p, { label: how, ok: false, error: errText(e) }, ATTEMPTS_KEEP));
      setSection("camera", { status: "failed", reason: errText(e) });
    }
    setBusy(false);
  }, [afterRestart, attach, devices, loopRunning, selected, setSection, stopCurrent]);

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
        <button
          className={s.btnGhost}
          onClick={() => {
            stopCurrent();
            setLoopNote(null);
          }}
          disabled={!stream}
        >
          끄기
        </button>
      </div>
      {loopNote ? (
        <p className={s.how} role="status">
          {loopNote}
        </p>
      ) : null}

      {devices.length > 0 ? (
        <div className={s.row}>
          <select
            className={s.select}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            aria-label="카메라 장치"
          >
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
            ["해상도(torch 끄기 전 → 후)", `${sizeOf(lastStart.settingsBeforeTorch)} → ${sizeOf(lastStart.settingsAfterTorch)}`],
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

      {lastStart ? (
        <Json
          value={{
            settingsBeforeTorch: lastStart.settingsBeforeTorch,
            settingsAfterTorch: lastStart.settingsAfterTorch,
            capabilities: lastStart.capabilities,
          }}
          summary="getSettings(전·후) / getCapabilities"
        />
      ) : null}
    </Section>
  );
}
