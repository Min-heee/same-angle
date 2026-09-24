/**
 * 피부 패치 픽셀 지표: 평균 휘도, 클리핑 비율, 3×3 라플라시안 분산.
 *
 * TECH-NOTES 2.3: 클리핑은 게이트 지표(노출 사고만 거름), 밝기·흐림은 기록·경고만.
 * D1 에서는 이 계산이 아이폰에서 프레임당 몇 ms 드는지만 잰다(9번 항목).
 *
 * 휘도 정의: Rec.709 계수 Y = 0.2126·R + 0.7152·G + 0.0722·B.
 * 캔버스의 RGBA 는 감마가 걸린 sRGB 값이라, 엄밀히는 선형 휘도가 아니라 루마(Y′)다.
 * 기준 대비 차·비율만 보므로 선형화하지 않는다. 계수 합은 1이라 회색(R=G=B=v)은 Y = v.
 *
 * 순수 함수다. 캔버스·getImageData 는 부르지 않고, 그 결과 배열만 받는다.
 */

export const LUMA_R = 0.2126;
export const LUMA_G = 0.7152;
export const LUMA_B = 0.0722;

/** 클리핑으로 보는 휘도 경계(포함). 0~255 눈금. */
export const CLIP_LOW = 5;
export const CLIP_HIGH = 250;

function checkShape(data: ArrayLike<number>, width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`폭·높이는 양의 정수여야 합니다: ${width}×${height}`);
  }
  if (data.length !== width * height * 4) {
    throw new RangeError(`RGBA 길이 ${data.length} 가 ${width}×${height}×4 와 다릅니다.`);
  }
}

/** RGBA 를 휘도 배열로. 알파는 무시한다(캔버스에서 읽은 카메라 프레임은 불투명). */
export function lumaArray(data: ArrayLike<number>, width: number, height: number): Float64Array {
  checkShape(data, width, height);
  const n = width * height;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[i] = LUMA_R * data[o] + LUMA_G * data[o + 1] + LUMA_B * data[o + 2];
  }
  return out;
}

/** 평균 휘도. */
export function meanLuma(luma: ArrayLike<number>): number {
  if (luma.length === 0) throw new RangeError("빈 휘도 배열");
  let s = 0;
  for (let i = 0; i < luma.length; i++) s += luma[i];
  return s / luma.length;
}

/** 휘도 ≤ CLIP_LOW 또는 ≥ CLIP_HIGH 인 픽셀의 비율(0~1). */
export function clipRatio(luma: ArrayLike<number>): number {
  if (luma.length === 0) throw new RangeError("빈 휘도 배열");
  let c = 0;
  for (let i = 0; i < luma.length; i++) {
    if (luma[i] <= CLIP_LOW || luma[i] >= CLIP_HIGH) c++;
  }
  return c / luma.length;
}

/**
 * 3×3 라플라시안(4-이웃: 위+아래+왼+오른 − 4·가운데) 응답의 모분산.
 *
 * 테두리 한 줄은 이웃이 모자라 계산하지 않는다(값을 채워 넣으면 가짜 경계가 생긴다).
 * 그래서 폭·높이가 3 미만이면 계산할 칸이 없어 null.
 * 흐릴수록 값이 작다. 절대값보다 기준 대비 비로 쓴다(TECH-NOTES 2.3).
 */
export function laplacianVariance(luma: ArrayLike<number>, width: number, height: number): number | null {
  if (luma.length !== width * height) {
    throw new RangeError(`휘도 길이 ${luma.length} 가 ${width}×${height} 와 다릅니다.`);
  }
  if (width < 3 || height < 3) return null;
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = luma[i - width] + luma[i + width] + luma[i - 1] + luma[i + 1] - 4 * luma[i];
      n++;
      sum += v;
      sumSq += v * v;
    }
  }
  const m = sum / n;
  // 음수 잔차(부동소수 오차)를 0으로 자른다.
  return Math.max(0, sumSq / n - m * m);
}

export interface PixelMetrics {
  meanLuma: number;
  clipRatio: number;
  laplacianVariance: number | null;
}

/** 세 지표를 한 번에. 휘도 배열은 한 번만 만든다. */
export function pixelMetrics(data: ArrayLike<number>, width: number, height: number): PixelMetrics {
  const luma = lumaArray(data, width, height);
  return {
    meanLuma: meanLuma(luma),
    clipRatio: clipRatio(luma),
    laplacianVariance: laplacianVariance(luma, width, height),
  };
}
