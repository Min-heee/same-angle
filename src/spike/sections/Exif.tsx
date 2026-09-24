"use client";

/**
 * 7. 옛 사진(EXIF 회전): 사진 앱의 사진을 IMAGE 모드에 넣을 때 EXIF 방향이 반영되는가.
 *
 * 참고 기준(PRD F1)은 사진 앱의 옛 사진이다. 아이폰 사진은 픽셀을 눕혀 저장하고 EXIF 로
 * 세우는 경우가 있어, 방향이 무시되면 roll 이 ±90° 로 읽히거나 얼굴을 못 찾는다.
 * 세 경로를 나란히 잰다:
 *  A. createImageBitmap(file, {imageOrientation:'from-image'}) — TECH-NOTES 가 "안전한 경로"로 본 것
 *  B. createImageBitmap(file, {imageOrientation:'none'}) — 방향을 무시하면 어떻게 되는지 대조
 *  C. HTMLImageElement 를 그대로 detect 에 — 가장 흔히 쓰는 경로
 *
 * 사진은 메모리에서만 쓰고 버린다. 파일 이름도 남기지 않는다(형식·크기만).
 */

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import type { JsonValue } from "@/core/report";
import { sampleToJson } from "../compare";
import { useSpike } from "../context";
import { summarizeResult } from "../sample";
import s from "../spike.module.css";
import { Json, Section } from "../ui";
import { errText, fmt } from "../util";

type PathResult = { size: string | null; result: JsonValue; error: string | null };

export function ExifSection() {
  const { imageEngine, sections, setSection } = useSpike();
  const sec = sections.exif;
  const [runs, setRuns] = useState<JsonValue[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (runs.length) setSection("exif", { data: { runs } });
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

        const viaBitmap = async (orientation: ImageOrientation): Promise<PathResult> => {
          let bmp: ImageBitmap | null = null;
          try {
            bmp = await createImageBitmap(file, { imageOrientation: orientation });
            const t0 = performance.now();
            const res = landmarker.detect(bmp);
            return {
              size: `${bmp.width}x${bmp.height}`,
              result: sampleToJson(summarizeResult(res, bmp.width, bmp.height, performance.now() - t0)),
              error: null,
            };
          } catch (e) {
            return { size: bmp ? `${bmp.width}x${bmp.height}` : null, result: null, error: errText(e) };
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
            const t0 = performance.now();
            const res = landmarker.detect(img);
            return {
              size: `${img.naturalWidth}x${img.naturalHeight}`,
              result: sampleToJson(summarizeResult(res, img.naturalWidth, img.naturalHeight, performance.now() - t0)),
              error: null,
            };
          } catch (e) {
            return { size: null, result: null, error: errText(e) };
          } finally {
            URL.revokeObjectURL(url);
          }
        };

        const r = {
          file: { type: file.type || "(빈 값)", bytes: file.size },
          fromImage: await viaBitmap("from-image"),
          none: await viaBitmap("none"),
          imgElement: await viaImg(),
        };
        setRuns((p) => [...p, r as unknown as JsonValue].slice(-6));
        const errs = [r.fromImage, r.none, r.imgElement].filter((x) => x.error).map((x) => x.error);
        setSection("exif", { status: "done", reason: errs.length ? `일부 경로 실패: ${errs.join(" / ")}` : null });
      } catch (e) {
        setSection("exif", { status: "failed", reason: errText(e) });
      } finally {
        input.value = "";
        setBusy(false);
      }
    },
    [imageEngine, setSection],
  );

  const last = runs[runs.length - 1] as
    | Record<"fromImage" | "none" | "imgElement", { size: string | null; result: { faces: number; roll: number | null } | null; error: string | null }>
    | undefined;
  const line = (label: string, x: PathResult | undefined) => {
    const r = x?.result as { faces: number; roll: number | null } | null | undefined;
    return (
      <li>
        {label}: {x?.size ?? "—"} · {x?.error ? `실패 ${x.error}` : r ? `얼굴 ${r.faces} · roll ${fmt(r.roll)}°` : "—"}
      </li>
    );
  };

  return (
    <Section
      no={7}
      title="옛 사진(EXIF 회전)"
      refText="TECH-NOTES 6절 '그 밖의 미확인' — IMAGE 모드의 EXIF 회전 반영"
      how="[사진 고르기]로 세로로 찍은 옛 얼굴 사진 한 장을 고르세요. 세 경로의 크기와 roll 이 같으면 EXIF 가 반영된 것입니다."
      status={sec.status}
      reason={sec.reason}
    >
      <input className={s.file} type="file" accept="image/*" onChange={onFile} disabled={busy} aria-label="사진 고르기" />
      <p className={s.ref} style={{ marginTop: 6 }}>사진은 이 기기 메모리에서만 재고 버립니다. 보고서에는 형식·크기·각도 숫자만 남습니다.</p>
      {last ? (
        <ul className={s.list}>
          {line("A from-image", last.fromImage as PathResult)}
          {line("B none", last.none as PathResult)}
          {line("C <img>", last.imgElement as PathResult)}
        </ul>
      ) : null}
      {last ? <Json value={last} summary={`마지막 결과(총 ${runs.length}회)`} /> : null}
    </Section>
  );
}
