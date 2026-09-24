/**
 * 두 경로(VIDEO/IMAGE, 비디오 프레임/takePhoto 등)의 판정 결과를 나란히 적기 위한 변환.
 * 보고서에 들어가는 것은 각도·스케일·이동·박스 비율 같은 숫자뿐이다.
 */

import type { JsonValue } from "@/core/report";
import type { FrameSample } from "./sample";
import { num } from "./util";

export function sampleToJson(x: FrameSample | null): JsonValue {
  if (!x) return null;
  return {
    faces: x.faces,
    layout: x.layout,
    yaw: num(x.dec?.yaw),
    pitch: num(x.dec?.pitch),
    roll: num(x.dec?.roll),
    scale: num(x.dec?.scale, 4),
    tx: num(x.dec?.t[0], 3),
    ty: num(x.dec?.t[1], 3),
    tz: num(x.dec?.t[2], 3),
    orthoError: num(x.dec?.orthoError, 6),
    shortSideRatio: num(x.box?.shortSideRatio, 4),
    cx: num(x.box?.centerShort.x, 4),
    cy: num(x.box?.centerShort.y, 4),
    inferMs: num(x.inferMs, 1),
    frame: `${x.frameW}x${x.frameH}`,
  };
}

/** b − a. 한쪽이라도 분해가 안 됐으면 null. 크기는 |ln(|tz_a| / |tz_b|)| (TECH-NOTES 2.3 크기 지표). */
export function diffSamples(a: FrameSample | null, b: FrameSample | null): JsonValue {
  if (!a?.dec || !b?.dec) return null;
  const maxAbs =
    a.matrix && b.matrix && a.layout && a.layout === b.layout
      ? Math.max(...a.matrix.map((v, i) => Math.abs(v - b.matrix![i])))
      : null;
  return {
    dYaw: num(b.dec.yaw - a.dec.yaw),
    dPitch: num(b.dec.pitch - a.dec.pitch),
    dRoll: num(b.dec.roll - a.dec.roll),
    sizeLogRatio: num(Math.abs(Math.log(Math.abs(a.dec.t[2]) / Math.abs(b.dec.t[2]))), 5),
    dCx: a.box && b.box ? num(b.box.centerShort.x - a.box.centerShort.x, 4) : null,
    dCy: a.box && b.box ? num(b.box.centerShort.y - a.box.centerShort.y, 4) : null,
    maxAbsMatrixDiff: num(maxAbs, 5),
  };
}
