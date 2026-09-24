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
 */

import { useCallback, useEffect, useState } from "react";
import type { JsonValue } from "@/core/report";
import { diffSamples, sampleToJson } from "../compare";
import { downscale, grabVideoFrame } from "../canvas";
import { useSpike } from "../context";
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
  const { stream, videoRef, imageEngine, sections, setSection } = useSpike();
  const sec = sections.takePhoto;
  const [runs, setRuns] = useState<JsonValue[]>([]);
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
      const vCanvas = grabVideoFrame(video);
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

      const t0 = performance.now();
      const vSample = summarizeResult(landmarker.detect(vCanvas), vCanvas.width, vCanvas.height, performance.now() - t0);

      let pFull = null;
      try {
        const t1 = performance.now();
        pFull = summarizeResult(landmarker.detect(bitmap), PW, PH, performance.now() - t1);
      } catch (e) {
        notes.push(`원본 크기 판정: ${errText(e)}`);
      }
      const small = downscale(bitmap, PW, PH, LONG_SIDE);
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
          photoFull: sampleToJson(pFull),
          photo1920: sampleToJson(pSmall),
        },
        diffs: {
          photoFull_vs_video: diffSamples(vSample, pFull),
          photo1920_vs_video: diffSamples(vSample, pSmall),
        },
        notes,
      };
      setRuns((p) => [...p, r].slice(-6));
      setSection("takePhoto", { status: "done", reason: notes.length ? notes.join(" / ") : null });
    } catch (e) {
      setSection("takePhoto", { status: "failed", reason: errText(e) });
    } finally {
      bitmap?.close();
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
