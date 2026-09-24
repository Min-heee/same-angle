"use client";

/**
 * 9. 픽셀 지표 비용: 얼굴 박스를 128² 로 재표본 → getImageData → 휘도·클리핑·라플라시안.
 *
 * 실제 지표는 뺨·콧등·눈 밑 다각형(피부 패치)이지만(TECH-NOTES 2.3), 여기서는 비용만 재므로
 * 같은 크기(128²)의 얼굴 박스로 대신한다. 아이폰에서 getImageData 가 프레임마다 쓸 만한
 * 비용인지가 질문이다. 픽셀 자체는 남기지 않고 걸린 시간과 지표 숫자만 남긴다.
 */

import { useCallback, useEffect, useState } from "react";
import type { JsonValue } from "@/core/report";
import { pixelMetrics } from "@/core/pixels";
import { summarize } from "@/core/stats";
import { useSpike } from "../context";
import s from "../spike.module.css";
import { Section } from "../ui";
import { errText, fmt, num } from "../util";

const SIZE = 128;
const REPEATS = 20;

export function PixelCostSection() {
  const { videoRef, latestRef, loopRunning, sections, setSection } = useSpike();
  const sec = sections.pixelCost;
  const [runs, setRuns] = useState<JsonValue[]>([]);

  useEffect(() => {
    if (runs.length) setSection("pixelCost", { data: { size: SIZE, repeats: REPEATS, runs } });
  }, [runs, setSection]);

  const run = useCallback(() => {
    const video = videoRef.current;
    const box = latestRef.current?.box;
    if (!video) return;
    setSection("pixelCost", { status: "running", reason: null });
    try {
      if (!box) throw new Error("최근 프레임에 얼굴 박스가 없습니다. 얼굴을 화면에 두세요.");
      const W = video.videoWidth;
      const H = video.videoHeight;
      const sx = Math.max(0, Math.floor(box.minX));
      const sy = Math.max(0, Math.floor(box.minY));
      const sw = Math.min(W, Math.ceil(box.maxX)) - sx;
      const sh = Math.min(H, Math.ceil(box.maxY)) - sy;
      if (sw <= 0 || sh <= 0) throw new Error("박스가 화면 밖입니다.");

      const c = document.createElement("canvas");
      c.width = SIZE;
      c.height = SIZE;
      const g = c.getContext("2d", { willReadFrequently: true });
      if (!g) throw new Error("2D 캔버스를 만들 수 없습니다.");

      const draw: number[] = [];
      const read: number[] = [];
      const compute: number[] = [];
      const total: number[] = [];
      let last = null;
      for (let i = 0; i < REPEATS; i++) {
        const t0 = performance.now();
        g.drawImage(video, sx, sy, sw, sh, 0, 0, SIZE, SIZE);
        const t1 = performance.now();
        const img = g.getImageData(0, 0, SIZE, SIZE);
        const t2 = performance.now();
        last = pixelMetrics(img.data, SIZE, SIZE);
        const t3 = performance.now();
        draw.push(t1 - t0);
        read.push(t2 - t1);
        compute.push(t3 - t2);
        total.push(t3 - t0);
      }
      const med = (xs: number[]) => {
        const x = summarize(xs);
        return x ? { median: num(x.median, 3), p95: num(x.p95, 3), max: num(x.max, 3) } : null;
      };
      setRuns((p) =>
        [
          ...p,
          {
            source: `${sw}x${sh} → ${SIZE}x${SIZE}`,
            drawMs: med(draw),
            getImageDataMs: med(read),
            computeMs: med(compute),
            totalMs: med(total),
            metrics: last
              ? {
                  meanLuma: num(last.meanLuma, 2),
                  clipRatio: num(last.clipRatio, 4),
                  laplacianVariance: num(last.laplacianVariance, 2),
                }
              : null,
          } as JsonValue,
        ].slice(-10),
      );
      setSection("pixelCost", { status: "done", reason: null });
    } catch (e) {
      setSection("pixelCost", { status: "failed", reason: errText(e) });
    }
  }, [latestRef, setSection, videoRef]);

  const last = runs[runs.length - 1] as { totalMs: { median: number; p95: number } | null; source: string } | undefined;

  return (
    <Section
      no={9}
      title="픽셀 지표 비용"
      refText="TECH-NOTES 6절 '그 밖의 미확인' — 아이폰 getImageData·지표 계산 비용"
      how={`추론이 도는 동안 얼굴을 화면에 두고 [${REPEATS}회 재기]. 얼굴 박스를 ${SIZE}²로 줄여 읽고 계산하는 시간을 잽니다.`}
      status={sec.status}
      reason={sec.reason}
    >
      <div className={s.row}>
        <button className={s.btn} onClick={run} disabled={!loopRunning}>
          {REPEATS}회 재기
        </button>
      </div>
      {last ? (
        <p className={s.how}>
          {last.source} · 합계 중앙 {fmt(last.totalMs?.median, 2)}ms · p95 {fmt(last.totalMs?.p95, 2)}ms
        </p>
      ) : null}
    </Section>
  );
}
