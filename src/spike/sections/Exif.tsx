"use client";

/**
 * 7. 옛 사진(EXIF 회전): 사진 앱의 사진을 IMAGE 모드에 넣을 때 EXIF 방향이 반영되는가.
 *
 * 참고 기준(PRD F1)은 사진 앱의 옛 사진이다. 아이폰 사진은 픽셀을 눕혀 저장하고 EXIF 로
 * 세우는 경우가 있어, 방향이 무시되면 roll 이 ±90° 로 읽히거나 얼굴을 못 찾는다.
 *
 * 판정에는 파일 자체의 Orientation 이 필요하다. 세 경로가 같다는 것만으로는 "반영됨"과 "회전이
 * 없는 사진"을 구별할 수 없다. 그래서 JPEG 앞 128KB 에서 Orientation(0x0112)과 SOF 의 원본
 * 픽셀 크기를 읽고(exif.ts), orientation 5~8 사진에서 A·C 의 폭·높이가 원본과 뒤바뀌고 roll 이
 * 0 근처면 "반영됨"으로 본다. 1·없음은 판정 불가로 적는다(아이폰 사진 선택기는 트랜스코딩한
 * JPEG 을 넘길 수 있다).
 *
 *  A. createImageBitmap(file, {imageOrientation:'from-image'}) — TECH-NOTES 가 "안전한 경로"로 본 것
 *  B. createImageBitmap(file, {imageOrientation:'none'}) — 스펙 옛 값. 지금 스펙의 값은
 *     'from-image'|'flipY' 라 엔진에 따라 TypeError 이거나 A 와 같다. 동작 기록만 하고 판정에 쓰지 않는다.
 *  C. HTMLImageElement — 가장 흔히 쓰는 경로
 *
 * 메모리: 아이폰 사진은 12~48MP 다. detect 에 넣은 크기로 MediaPipe 가 자기 WebGL 캔버스를 키우므로
 * (4032×3024 사진이면 12MP 캔버스), 긴 변이 1920 을 넘으면 원본을 넣지 않고 긴 변 1920 으로 줄인
 * 캔버스로 잰다. 방향 판정에는 원본 해상도가 필요 없다 — 크기 판정은 원본 비트맵의 폭·높이로,
 * roll 은 크기와 무관하다. 제품도 저장본을 긴 변 약 1920 으로 줄여 IMAGE 로 잰다(TECH-NOTES 2.2).
 * 다 쓴 캔버스는 바로 놓는다.
 *
 * 사진은 메모리에서만 쓰고 버린다. 파일 이름도 남기지 않는다(형식·크기·orientation 숫자만).
 */

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import type { JsonValue } from "@/core/report";
import { downscale, releaseCanvas } from "../canvas";
import { sampleToJson } from "../compare";
import { useSpike } from "../context";
import { restoredList } from "../draft";
import { engineCounts, type EngineCounts } from "../engine";
import { EXIF_READ_BYTES, exifVerdict, readJpegInfo, type ExifVerdict, type JpegInfo, type PathLook } from "../exif";
import { summarizeResult } from "../sample";
import s from "../spike.module.css";
import { Json, Section } from "../ui";
import { errText, fmt } from "../util";

/** 긴 변이 이보다 큰 사진은 원본을 detect 에 넣지 않고 이 길이로 줄인다. */
const DETECT_LONG_SIDE = 1920;

type PathResult = { size: string | null; detectInput: string | null; result: JsonValue; error: string | null };

type Run = {
  file: { type: string; bytes: number };
  jpeg: JpegInfo;
  fromImage: PathResult;
  legacyNone: PathResult;
  imgElement: PathResult;
  verdict: ExifVerdict;
  /** 이 기록을 남길 때의 엔진 인스턴스 수(메모리 사고 추적용). 옛 임시 저장본에는 없다. */
  engines?: EngineCounts;
};

function look(p: PathResult): PathLook | null {
  if (!p.size || !p.result || typeof p.result !== "object" || Array.isArray(p.result)) return null;
  const [w, h] = p.size.split("x").map(Number);
  const r = p.result as { faces?: unknown; roll?: unknown };
  return {
    width: w,
    height: h,
    faces: typeof r.faces === "number" ? r.faces : 0,
    roll: typeof r.roll === "number" ? r.roll : null,
  };
}

export function ExifSection() {
  const { imageEngine, sections, setSection, restored } = useSpike();
  const sec = sections.exif;
  const [runs, setRuns] = useState<Run[]>(() => restoredList<Run>(restored?.sections.exif.data, "runs"));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (runs.length) setSection("exif", { data: { runs: runs as unknown as JsonValue } });
  }, [runs, setSection]);

  const onFile = useCallback(
    async (ev: ChangeEvent<HTMLInputElement>) => {
      const input = ev.currentTarget;
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true);
      setSection("exif", { status: "running", reason: null });
      try {
        const { landmarker } = await imageEngine("CPU");
        const jpeg = readJpegInfo(await file.slice(0, EXIF_READ_BYTES).arrayBuffer());

        /** 크면 줄인 캔버스로 detect. 크기는 원본(방향 반영 후)의 폭·높이로 적는다. */
        const detectSized = (src: ImageBitmap | HTMLImageElement, w: number, h: number): { result: JsonValue; input: string } => {
          if (Math.max(w, h) <= DETECT_LONG_SIDE) {
            const t0 = performance.now();
            const res = landmarker.detect(src);
            return { result: sampleToJson(summarizeResult(res, w, h, performance.now() - t0)), input: "원본" };
          }
          const c = downscale(src, w, h, DETECT_LONG_SIDE);
          try {
            const t0 = performance.now();
            const res = landmarker.detect(c);
            return {
              result: sampleToJson(summarizeResult(res, c.width, c.height, performance.now() - t0)),
              input: `${w}x${h} → ${c.width}x${c.height} 로 줄여서`,
            };
          } finally {
            releaseCanvas(c);
          }
        };

        const viaBitmap = async (orientation: string): Promise<PathResult> => {
          let bmp: ImageBitmap | null = null;
          try {
            bmp = await createImageBitmap(file, { imageOrientation: orientation as ImageOrientation });
            const d = detectSized(bmp, bmp.width, bmp.height);
            return { size: `${bmp.width}x${bmp.height}`, detectInput: d.input, result: d.result, error: null };
          } catch (e) {
            return { size: bmp ? `${bmp.width}x${bmp.height}` : null, detectInput: null, result: null, error: errText(e) };
          } finally {
            bmp?.close();
          }
        };

        const viaImg = async (): Promise<PathResult> => {
          const url = URL.createObjectURL(file);
          try {
            const img = new Image();
            img.src = url;
            await img.decode();
            const d = detectSized(img, img.naturalWidth, img.naturalHeight);
            return { size: `${img.naturalWidth}x${img.naturalHeight}`, detectInput: d.input, result: d.result, error: null };
          } catch (e) {
            return { size: null, detectInput: null, result: null, error: errText(e) };
          } finally {
            URL.revokeObjectURL(url);
          }
        };

        const fromImage = await viaBitmap("from-image");
        const legacyNone = await viaBitmap("none");
        const imgElement = await viaImg();
        const verdict = exifVerdict(jpeg, look(fromImage), look(imgElement));
        const r: Run = {
          file: { type: file.type || "(빈 값)", bytes: file.size },
          jpeg,
          fromImage,
          legacyNone,
          imgElement,
          verdict,
          engines: engineCounts(),
        };
        setRuns((p) => [...p, r].slice(-6));

        const aFaces = look(fromImage)?.faces ?? 0;
        if (fromImage.error || aFaces !== 1) {
          setSection("exif", {
            status: "failed",
            reason: fromImage.error
              ? `A 경로 실패: ${fromImage.error}`
              : `이 사진에서 얼굴을 못 찾음(얼굴 ${aFaces}개) — 얼굴이 보이는 다른 사진으로.`,
          });
        } else if (verdict.status === "undecidable") {
          setSection("exif", { status: "running", reason: verdict.note });
        } else {
          setSection("exif", { status: "done", reason: verdict.note });
        }
      } catch (e) {
        setSection("exif", { status: "failed", reason: errText(e) });
      } finally {
        input.value = "";
        setBusy(false);
      }
    },
    [imageEngine, setSection],
  );

  const last = runs[runs.length - 1];
  const line = (label: string, x: PathResult | undefined) => {
    const r = x?.result as { faces: number; roll: number | null } | null | undefined;
    return (
      <li>
        {label}: {x?.size ?? "—"} · {x?.error ? `실패 ${x.error}` : r ? `얼굴 ${r.faces} · roll ${fmt(r.roll)}°` : "—"}
        {x?.detectInput && x.detectInput !== "원본" ? ` · ${x.detectInput}` : ""}
      </li>
    );
  };

  return (
    <Section
      no={7}
      title="옛 사진(EXIF 회전)"
      refText="TECH-NOTES 6절 '그 밖의 미확인' — IMAGE 모드의 EXIF 회전 반영"
      how="[사진 고르기] → 사진 보관함에서 세로로 찍은 옛 얼굴 사진 1장('사진 찍기'가 아니라 보관함). 판정은 파일의 회전 태그(orientation)로 합니다: 5~8 이면 A·C 가 원본과 폭·높이가 바뀌고 roll 이 0 근처일 때 '반영됨'. 1·없음이면 판정 불가 — 다른 사진으로 한 번 더. 사파리를 떠나니 12번에서 먼저 중간 내보내기."
      status={sec.status}
      reason={sec.reason}
    >
      <div className={s.row}>
        <label className={s.btn} style={{ textAlign: "center", opacity: busy ? 0.45 : 1 }}>
          {busy ? "재는 중…" : "사진 고르기"}
          <input className={s.visuallyHidden} type="file" accept="image/*" onChange={onFile} disabled={busy} />
        </label>
      </div>
      <p className={s.ref} style={{ marginTop: 6 }}>
        사진은 이 기기 메모리에서만 재고 버립니다. 보고서에는 형식·크기·회전 태그·각도 숫자만 남습니다. 긴 변이 1920 을 넘는 사진은 줄여서 잽니다(크기 판정은 원본 크기로).
      </p>
      {last ? (
        <ul className={s.list}>
          <li>
            파일 {last.file.type} · orientation {last.jpeg.orientation ?? "없음"} · 원본 픽셀{" "}
            {last.jpeg.width && last.jpeg.height ? `${last.jpeg.width}x${last.jpeg.height}` : "모름"}
          </li>
          {line("A from-image", last.fromImage)}
          {line("C <img>", last.imgElement)}
          {line("B 'none'(스펙 옛 값 — 동작 기록만)", last.legacyNone)}
          <li>
            판정:{" "}
            {last.verdict.status === "applied" ? "반영됨" : last.verdict.status === "notApplied" ? "반영 안 됨" : "판정 불가"} —{" "}
            {last.verdict.note}
          </li>
        </ul>
      ) : null}
      {last ? <Json value={last} summary={`마지막 결과(총 ${runs.length}회)`} /> : null}
    </Section>
  );
}
