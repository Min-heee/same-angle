"use client";

/**
 * 6. takePhoto 대 비디오 프레임(실험 0): 같은 순간의 비디오 프레임과 ImageCapture.takePhoto()
 * 사진을 둘 다 IMAGE CPU 로 재서 해상도·종횡비·각도·크기 차를 본다.
 *
 * 기본 설계는 "저장본 = 게이트가 판정한 비디오 프레임"이고, takePhoto 는 여기서 편향이 ε 안으로
 * 확인될 때만 켠다(TECH-NOTES 2.2). takePhoto 가 화각을 바꾸면(더 넓은 사진 센서 영역)
 * 크기·위치 비교가 깨진다.
 *
 * 사진은 메모리에서 재고 바로 버린다(ImageBitmap.close). 저장·전송하지 않는다.
 *
 * 사진은 긴 변 1920 으로 줄인 것만 잰다. 원본(12~48MP)을 그대로 detect 에 넣으면 MediaPipe 가
 * 자기 WebGL 캔버스를 그 크기로 키워 구형 아이폰에서 탭이 죽을 수 있고, 제품도 저장본을 긴 변
 * 약 1920 으로 줄여 IMAGE 로 잰다(TECH-NOTES 2.2). 원본 크기·종횡비는 숫자로만 남긴다.
 */

import { useCallback, useEffect, useState } from "react";
import type { JsonValue } from "@/core/report";
import { diffSamples, sampleToJson } from "../compare";
import { downscale, grabVideoFrame, releaseCanvas } from "../canvas";
import { useSpike } from "../context";
import { restoredList } from "../draft";
import { engineCounts } from "../engine";
import { summarizeResult } from "../sample";
import s from "../spike.module.css";
import { Json, Section } from "../ui";
import { errText, fmt, num, toJson } from "../util";

/** lib.dom 에 없는 ImageCapture 의 최소 형태. */
interface ImageCaptureLike {
  takePhoto(settings?: { fillLightMode?: string }): Promise<Blob>;
  getPhotoCapabilities?(): Promise<unknown>;
  getPhotoSettings?(): Promise<unknown>;
}
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

const LONG_SIDE = 1920;

export function TakePhotoSection() {
  const { stream, videoRef, imageEngine, sections, setSection, restored } = useSpike();
  const sec = sections.takePhoto;
  const [runs, setRuns] = useState<JsonValue[]>(() => restoredList<JsonValue>(restored?.sections.takePhoto.data, "runs"));
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    const ok = typeof (window as unknown as { ImageCapture?: unknown }).ImageCapture === "function";
    setSupported(ok);
    if (!ok) {
      setSection("takePhoto", {
        status: "done",
        reason: "이 브라우저에는 ImageCapture 가 없습니다(미지원으로 기록).",
        data: { supported: false },
      });
    }
  }, [setSection]);

  useEffect(() => {
    if (runs.length) setSection("takePhoto", { data: { supported: true, runs } });
  }, [runs, setSection]);

  const run = useCallback(async () => {
    const video = videoRef.current;
    const track = stream?.getVideoTracks()[0];
    const IC = (window as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
    if (!video || !track || !IC) return;
    setBusy(true);
    setSection("takePhoto", { status: "running", reason: null });
    const notes: string[] = [];
    let bitmap: ImageBitmap | null = null;
    let vCanvas: HTMLCanvasElement | null = null;
    let small: HTMLCanvasElement | null = null;
    try {
      const { landmarker } = await imageEngine("CPU");
      const ic = new IC(track);

      let photoCaps: JsonValue = null;
      try {
        photoCaps = toJson(await ic.getPhotoCapabilities?.());
      } catch (e) {
        notes.push(`getPhotoCapabilities: ${errText(e)}`);
      }

      // 거의 같은 순간: 비디오 프레임을 먼저 뜨고 곧바로 takePhoto.
      vCanvas = grabVideoFrame(video);
      const tV = performance.now();
      let blob: Blob;
      let fillLight = "off 요청 수락";
      try {
        blob = await ic.takePhoto({ fillLightMode: "off" });
      } catch (e) {
        fillLight = `off 요청 실패(${errText(e)}) → 옵션 없이 재시도`;
        blob = await ic.takePhoto();
      }
      const takeMs = performance.now() - tV;
      bitmap = await createImageBitmap(blob);
      const PW = bitmap.width;
      const PH = bitmap.height;
      // 원본은 크기만 읽고 곧바로 줄인 뒤 놓는다(원본을 detect 에 넣지 않는다 — 머리 주석).
      small = downscale(bitmap, PW, PH, LONG_SIDE);
      bitmap.close();
      bitmap = null;

      const t0 = performance.now();
      const vSample = summarizeResult(landmarker.detect(vCanvas), vCanvas.width, vCanvas.height, performance.now() - t0);
      const t2 = performance.now();
      const pSmall = summarizeResult(landmarker.detect(small), small.width, small.height, performance.now() - t2);

      // takePhoto 뒤 비디오가 멈추거나 크기가 바뀌는 기기가 있다는 보고가 있어 확인한다[추론].
      const after = { paused: video.paused, size: `${video.videoWidth}x${video.videoHeight}` };
      if (video.paused) {
        try {
          await video.play();
        } catch (e) {
          notes.push(`takePhoto 뒤 video.play(): ${errText(e)}`);
        }
      }

      const r: JsonValue = {
        video: { size: `${vCanvas.width}x${vCanvas.height}`, aspect: num(vCanvas.width / vCanvas.height, 4) },
        photoShot: { size: `${PW}x${PH}`, aspect: num(PW / PH, 4), type: blob.type, bytes: blob.size },
        takePhotoMs: num(takeMs, 1),
        fillLight,
        photoCapabilities: photoCaps,
        videoAfter: after,
        results: {
          videoFrame: sampleToJson(vSample),
          photo1920: sampleToJson(pSmall),
        },
        diffs: {
          photo1920_vs_video: diffSamples(vSample, pSmall),
        },
        engines: { ...engineCounts() },
        notes,
      };
      setRuns((p) => [...p, r].slice(-6));
      if (vSample.faces !== 1 || pSmall.faces !== 1) {
        // 결과는 남기되, 한쪽이라도 얼굴이 1개가 아니면 비교가 안 되므로 실패로 둔다.
        setSection("takePhoto", {
          status: "failed",
          reason: `얼굴을 못 찾음(비디오 ${vSample.faces}개 · 사진 ${pSmall.faces}개) — 얼굴을 화면 가운데에 두고 다시.`,
        });
      } else {
        setSection("takePhoto", { status: "done", reason: notes.length ? notes.join(" / ") : null });
      }
    } catch (e) {
      setSection("takePhoto", { status: "failed", reason: errText(e) });
    } finally {
      bitmap?.close();
      releaseCanvas(vCanvas);
      releaseCanvas(small);
      setBusy(false);
    }
  }, [imageEngine, setSection, stream, videoRef]);

  const last = runs[runs.length - 1] as
    | {
        video: { size: string; aspect: number };
        photoShot: { size: string; aspect: number };
        diffs: { photo1920_vs_video: { dYaw: number; dPitch: number; dRoll: number; sizeLogRatio: number } | null };
      }
    | undefined;

  return (
    <Section
      no={6}
      title="takePhoto 대 비디오 프레임"
      refText="TECH-NOTES 6절 항목 3(화각·종횡비·편향) · 5절 실험 0"
      how="얼굴을 화면에 두고 폰을 멈춘 채 [사진 찍어 비교]. 사진은 재고 곧바로 버립니다."
      status={sec.status}
      reason={sec.reason}
    >
      {supported === false ? <p className={s.note}>미지원: ImageCapture 가 없습니다. 이 결과도 보고서에 남습니다.</p> : null}
      <div className={s.row}>
        <button className={s.btn} onClick={run} disabled={busy || !stream || supported !== true}>
          {busy ? "재는 중…" : "사진 찍어 비교"}
        </button>
      </div>
      {!stream && supported ? <p className={s.ref} style={{ marginTop: 6 }}>1번에서 카메라를 켜세요.</p> : null}
      {last ? (
        <ul className={s.list}>
          <li>
            비디오 {last.video.size}({last.video.aspect}) · 사진 {last.photoShot.size}({last.photoShot.aspect})
          </li>
          <li>
            사진(1920) − 비디오:{" "}
            {last.diffs.photo1920_vs_video
              ? `Δyaw ${fmt(last.diffs.photo1920_vs_video.dYaw, 2)} Δpitch ${fmt(last.diffs.photo1920_vs_video.dPitch, 2)} Δroll ${fmt(
                  last.diffs.photo1920_vs_video.dRoll,
                  2,
                )}° · 크기 ${fmt(last.diffs.photo1920_vs_video.sizeLogRatio, 4)}`
              : "한쪽에서 얼굴을 못 찾음"}
          </li>
        </ul>
      ) : null}
      {last ? <Json value={last} summary={`마지막 결과(총 ${runs.length}회)`} /> : null}
    </Section>
  );
}
