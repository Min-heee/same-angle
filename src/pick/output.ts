/**
 * 보정본의 틀: 출력 크기, 원본 장면 → 출력의 변환, 화질 배율, 관심 영역과 빈 곳(PRD 5절 "닮음 변환 보정").
 *
 * 좌표계가 넷이다. 섞이면 오류 없이 사진만 어긋나므로 이름을 고정한다.
 *
 *   장면 원본 픽셀 ──(÷ 줄인 비)──▶ 장면 재는 픽셀 ──(기준점 맞춤)──▶ 기준 재는 픽셀 ──(× 출력 비)──▶ 출력 픽셀
 *
 * 변환은 전부 닮음 변환이고 합성해도 닮음 변환이다. 빈 곳은 채우지 않는다.
 *
 * 순수 함수다. `warpRgba` 는 캔버스 없이 같은 변환을 픽셀에 적용하는 기준 구현이다 — 시험이
 * "변환 방향을 거꾸로 썼는가, 좌표 눈금을 섞었는가"를 픽셀로 확인하는 데 쓴다.
 */

import type { FrameSize, Rect } from "./measure";
import { RULES, type Rules } from "./rules";
import { applySimilarity, compose, invert, scaleOf, uniformScale, type Point, type Similarity } from "./similarity";

const longSide = (s: FrameSize) => Math.max(s.width, s.height);

/**
 * 출력 크기: 기준 사진과 같은 화면비, 긴 변은 기준 사진의 긴 변과 1920px 가운데 작은 쪽.
 * 크기가 유한한 양수가 아니면 null.
 */
export function outputSize(referenceOriginal: FrameSize, rules: Rules = RULES): FrameSize | null {
  const { width, height } = referenceOriginal;
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  const k = Math.min(1, rules.output.maxLongSidePx / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

export interface OutputGeometryInput {
  /** 장면(재는 픽셀) → 기준 사진(재는 픽셀). `compareToReference` 의 fit. */
  fit: Similarity;
  /** 기준 사진을 잰 캔버스의 크기. */
  referenceMeasured: FrameSize;
  /** 장면을 잰 캔버스의 크기. */
  frameMeasured: FrameSize;
  /** 장면의 원본 크기(동영상 해상도). 출력은 이 크기로 한 번 더 그린 장면에서 만든다. */
  frameNative: FrameSize;
  /** 출력 크기(`outputSize`). */
  output: FrameSize;
}

/**
 * 장면 원본 픽셀 → 출력 픽셀의 닮음 변환.
 *
 * 줄인 비는 긴 변의 비 하나로 쓴다. 줄일 때 폭·높이를 따로 반올림하므로 두 축의 비가 0.1% 안에서
 * 다를 수 있지만, 축마다 다른 비를 쓰면 닮음 변환이 깨진다(찌그러뜨리지 않는다).
 */
export function outputTransform(g: OutputGeometryInput): Similarity {
  const nativeToMeasured = uniformScale(longSide(g.frameMeasured) / longSide(g.frameNative));
  const measuredToOutput = uniformScale(longSide(g.output) / longSide(g.referenceMeasured));
  return compose(measuredToOutput, compose(g.fit, nativeToMeasured));
}

/** 화질 배율 k: 원본 장면의 한 픽셀이 출력에서 몇 픽셀이 되는가. 1.3 을 넘으면 W2. */
export function qualityScaleOf(transform: Similarity): number {
  return scaleOf(transform);
}

/**
 * 관심 영역(출력 픽셀): 기준 사진의 얼굴 박스를 위로 박스 높이의 0.6배, 좌우로 폭의 0.3배씩,
 * 아래로 0.1배 넓힌 사각형을 출력 틀 안으로 자른 것.
 *
 * 왜 출력 전체가 아닌가: 기준 사진이 4:3, 동영상이 16:9 면 같은 거리에서 찍어도 가장자리가 비는
 * 것이 정상이다. 머리 둘레가 비었는지만 본다.
 */
export function roiRect(
  referenceBox: Rect,
  referenceMeasured: FrameSize,
  output: FrameSize,
  rules: Rules = RULES,
): Rect {
  const k = longSide(output) / longSide(referenceMeasured);
  const x0 = (referenceBox.x - rules.output.roiSide * referenceBox.width) * k;
  const x1 = (referenceBox.x + referenceBox.width * (1 + rules.output.roiSide)) * k;
  const y0 = (referenceBox.y - rules.output.roiUp * referenceBox.height) * k;
  const y1 = (referenceBox.y + referenceBox.height * (1 + rules.output.roiDown)) * k;
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  const cx1 = Math.min(output.width, x1);
  const cy1 = Math.min(output.height, y1);
  return { x: cx0, y: cy0, width: Math.max(0, cx1 - cx0), height: Math.max(0, cy1 - cy0) };
}

function polygonArea(poly: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** 볼록 다각형을 반평면 (inside(p) ≥ 0) 으로 자른다(서덜랜드–호지먼의 한 단계). */
function clipHalfPlane(poly: readonly Point[], inside: (p: Point) => number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = inside(a);
    const db = inside(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
  }
  return out;
}

/**
 * 사각형 `rect`(출력 픽셀) 가운데, 변환한 원본 장면이 덮지 **못하는** 비율(0~1).
 *
 * 원본 장면의 네 귀퉁이를 변환하면 기울어진 사각형(볼록)이 된다. 그것을 `rect` 의 네 변으로 잘라
 * 겹치는 넓이를 구한다. `rect` 의 넓이가 0 이면 null(잴 영역이 없다).
 */
export function emptyFraction(rect: Rect, transform: Similarity, source: FrameSize): number | null {
  const area = rect.width * rect.height;
  if (!(area > 0)) return null;
  let poly: Point[] = [
    { x: 0, y: 0 },
    { x: source.width, y: 0 },
    { x: source.width, y: source.height },
    { x: 0, y: source.height },
  ].map((p) => applySimilarity(transform, p));
  poly = clipHalfPlane(poly, (p) => p.x - rect.x);
  poly = clipHalfPlane(poly, (p) => rect.x + rect.width - p.x);
  poly = clipHalfPlane(poly, (p) => p.y - rect.y);
  poly = clipHalfPlane(poly, (p) => rect.y + rect.height - p.y);
  const covered = poly.length >= 3 ? polygonArea(poly) : 0;
  return Math.min(1, Math.max(0, 1 - covered / area));
}

export interface OutputGeometry {
  /** 출력 크기(픽셀). */
  size: FrameSize;
  /** 장면 원본 픽셀 → 출력 픽셀. */
  transform: Similarity;
  /** 화질 배율 k. */
  qualityScale: number;
  /** 관심 영역(출력 픽셀). */
  roi: Rect;
  /** 관심 영역의 빈 비율. 관심 영역이 없으면 null. */
  roiEmptyFraction: number | null;
  /** 출력 전체의 빈 비율(정보로만 보인다). */
  totalEmptyFraction: number | null;
}

/** 보정본의 틀을 한 번에. 기준 사진 원본 크기가 올바르지 않으면 null. */
export function outputGeometry(
  input: Omit<OutputGeometryInput, "output"> & { referenceOriginal: FrameSize; referenceBox: Rect },
  rules: Rules = RULES,
): OutputGeometry | null {
  const size = outputSize(input.referenceOriginal, rules);
  if (size === null) return null;
  if (!(longSide(input.frameNative) > 0) || !(longSide(input.frameMeasured) > 0)) return null;
  if (!(longSide(input.referenceMeasured) > 0)) return null;
  const transform = outputTransform({ ...input, output: size });
  const roi = roiRect(input.referenceBox, input.referenceMeasured, size, rules);
  return {
    size,
    transform,
    qualityScale: qualityScaleOf(transform),
    roi,
    roiEmptyFraction: emptyFraction(roi, transform, input.frameNative),
    totalEmptyFraction: emptyFraction({ x: 0, y: 0, width: size.width, height: size.height }, transform, input.frameNative),
  };
}

/**
 * 캔버스 없이 변환을 픽셀에 적용한다(가장 가까운 픽셀, 빈 곳은 단색).
 *
 * 출력 픽셀 중심 (x + 0.5, y + 0.5) 을 역변환해 원본의 어느 픽셀인지 찾는다. 캔버스의
 * `setTransform(...toCanvasTransform(t))` 뒤 `drawImage(src, 0, 0)` 과 같은 방향이다
 * (보간만 다르다). 시험용 기준 구현이고 화면은 캔버스로 그린다.
 */
export function warpRgba(
  src: ArrayLike<number>,
  srcSize: FrameSize,
  transform: Similarity,
  outSize: FrameSize,
  fill: readonly [number, number, number, number],
): Uint8ClampedArray {
  if (src.length !== srcSize.width * srcSize.height * 4) {
    throw new RangeError(`RGBA 길이 ${src.length} 가 ${srcSize.width}×${srcSize.height}×4 와 다릅니다.`);
  }
  const inv = invert(transform);
  if (inv === null) throw new RangeError("배율이 0 인 변환은 그릴 수 없습니다.");
  const out = new Uint8ClampedArray(outSize.width * outSize.height * 4);
  for (let y = 0; y < outSize.height; y++) {
    for (let x = 0; x < outSize.width; x++) {
      const p = applySimilarity(inv, { x: x + 0.5, y: y + 0.5 });
      const sx = Math.floor(p.x);
      const sy = Math.floor(p.y);
      const o = (y * outSize.width + x) * 4;
      if (sx >= 0 && sy >= 0 && sx < srcSize.width && sy < srcSize.height) {
        const i = (sy * srcSize.width + sx) * 4;
        out[o] = src[i];
        out[o + 1] = src[i + 1];
        out[o + 2] = src[i + 2];
        out[o + 3] = src[i + 3];
      } else {
        out[o] = fill[0];
        out[o + 1] = fill[1];
        out[o + 2] = fill[2];
        out[o + 3] = fill[3];
      }
    }
  }
  return out;
}
