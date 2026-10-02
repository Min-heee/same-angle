import { describe, expect, it } from "vitest";
import { emptyFraction, outputGeometry, outputSize, outputTransform, qualityScaleOf, roiRect, warpRgba } from "./output";
import {
  IDENTITY,
  applySimilarity,
  fitSimilarity,
  fromParams,
  invert,
  isSimilarityMatrix,
  rotationDegOf,
  scaleOf,
  toCanvasTransform,
  type Point,
  type Similarity,
} from "./similarity";

describe("outputSize — 출력 틀", () => {
  it("기준 사진과 같은 화면비, 긴 변은 1920px 까지", () => {
    expect(outputSize({ width: 3024, height: 4032 })).toEqual({ width: 1440, height: 1920 });
    expect(outputSize({ width: 4032, height: 3024 })).toEqual({ width: 1920, height: 1440 });
  });

  it("기준 사진이 작으면 키우지 않는다", () => {
    expect(outputSize({ width: 600, height: 800 })).toEqual({ width: 600, height: 800 });
  });

  it("크기가 올바르지 않으면 null", () => {
    expect(outputSize({ width: 0, height: 100 })).toBeNull();
    expect(outputSize({ width: Number.NaN, height: 100 })).toBeNull();
    expect(outputSize({ width: 100, height: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe("outputTransform — 장면 원본 픽셀 → 출력 픽셀", () => {
  const base = {
    referenceMeasured: { width: 720, height: 960 },
    frameMeasured: { width: 540, height: 960 },
    frameNative: { width: 1080, height: 1920 },
    output: { width: 1440, height: 1920 },
  };

  it("세 단계(÷ 줄인 비, 기준점 맞춤, × 출력 비)를 순서대로 건 것과 같다", () => {
    const fit = fromParams(8, 1.1, 30, -12);
    const t = outputTransform({ ...base, fit });
    const p = { x: 400, y: 900 };
    const measured = { x: p.x * 0.5, y: p.y * 0.5 }; // 1920 → 960
    const onRef = applySimilarity(fit, measured);
    const want = { x: onRef.x * 2, y: onRef.y * 2 }; // 960 → 1920
    const got = applySimilarity(t, p);
    expect(got.x).toBeCloseTo(want.x, 9);
    expect(got.y).toBeCloseTo(want.y, 9);
  });

  it("화질 배율 k: 원본 한 픽셀이 출력에서 몇 픽셀인가", () => {
    // 맞춤 배율 1, 동영상 1080p, 출력 긴 변 1920 → k = 0.5 × 1 × 2 = 1.
    expect(qualityScaleOf(outputTransform({ ...base, fit: IDENTITY }))).toBeCloseTo(1, 12);
    // 동영상 해상도가 낮으면(720p) 맞춤 배율이 1 이어도 k 가 커진다.
    const low = { ...base, frameNative: { width: 720, height: 1280 } };
    expect(qualityScaleOf(outputTransform({ ...low, fit: IDENTITY }))).toBeCloseTo(1.5, 12);
    // 얼굴이 작게 찍혀 1.25배로 맞추면 k 도 1.25배.
    expect(qualityScaleOf(outputTransform({ ...base, fit: fromParams(0, 1.25, 0, 0) }))).toBeCloseTo(1.25, 12);
  });

  it("회전은 맞춤의 회전 그대로다(확대 단계는 돌리지 않는다)", () => {
    const t = outputTransform({ ...base, fit: fromParams(-11, 0.9, 5, 5) });
    expect(rotationDegOf(t)).toBeCloseTo(-11, 9);
    expect(isSimilarityMatrix(toCanvasTransform(t))).toBe(true);
  });
});

describe("roiRect — 관심 영역", () => {
  const measured = { width: 720, height: 960 };
  const out = { width: 1440, height: 1920 };

  it("얼굴 박스를 위로 0.6배, 좌우로 0.3배씩, 아래로 0.1배 넓힌 것(출력 픽셀)", () => {
    const r = roiRect({ x: 210, y: 305, width: 300, height: 350 }, measured, out);
    expect(r.x).toBeCloseTo((210 - 90) * 2, 9);
    expect(r.x + r.width).toBeCloseTo((210 + 300 + 90) * 2, 9);
    expect(r.y).toBeCloseTo((305 - 210) * 2, 9);
    expect(r.y + r.height).toBeCloseTo((305 + 350 + 35) * 2, 9);
  });

  it("출력 틀 밖으로 나가면 잘린다", () => {
    const r = roiRect({ x: 10, y: 50, width: 300, height: 350 }, measured, out);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    const far = roiRect({ x: 5000, y: 5000, width: 10, height: 10 }, measured, out);
    expect(far.width).toBe(0);
    expect(far.height).toBe(0);
  });
});

describe("emptyFraction — 빈 곳", () => {
  const rect = { x: 0, y: 0, width: 100, height: 100 };

  it("전부 덮이면 0, 전혀 안 덮이면 1", () => {
    expect(emptyFraction(rect, IDENTITY, { width: 100, height: 100 })).toBeCloseTo(0, 12);
    expect(emptyFraction(rect, fromParams(0, 3, -50, -50), { width: 100, height: 100 })).toBeCloseTo(0, 12);
    expect(emptyFraction(rect, fromParams(0, 1, 500, 0), { width: 100, height: 100 })).toBe(1);
  });

  it("절반만 덮이면 0.5, 4분의 1 만 덮이면 0.75", () => {
    expect(emptyFraction(rect, fromParams(0, 1, 50, 0), { width: 100, height: 100 })).toBeCloseTo(0.5, 12);
    expect(emptyFraction(rect, fromParams(0, 1, 50, 50), { width: 100, height: 100 })).toBeCloseTo(0.75, 12);
  });

  it("45° 돌린 정사각형과 겹치는 넓이는 정팔각형이다: 빈 비율 1 − 2(√2 − 1)", () => {
    // (50, 50) 둘레로 45° 회전.
    const c = { x: 50, y: 50 };
    const rot = fromParams(45, 1, 0, 0);
    const moved = applySimilarity(rot, c);
    const t: Similarity = { ...rot, tx: c.x - moved.x, ty: c.y - moved.y };
    expect(emptyFraction(rect, t, { width: 100, height: 100 })).toBeCloseTo(1 - 2 * (Math.SQRT2 - 1), 9);
  });

  it("넓이가 0 인 영역은 null(잴 영역이 없다)", () => {
    expect(emptyFraction({ x: 0, y: 0, width: 0, height: 10 }, IDENTITY, { width: 10, height: 10 })).toBeNull();
  });
});

describe("outputGeometry — 기준 사진 4:3, 동영상 16:9", () => {
  // 같은 거리에서 찍어 얼굴의 픽셀 크기가 같고 둘 다 가운데에 있는 경우.
  // 기준(재는 픽셀 720×960)과 장면(540×960)의 중심을 맞추려면 오른쪽으로 90px.
  const g = outputGeometry({
    fit: fromParams(0, 1, 90, 0),
    referenceMeasured: { width: 720, height: 960 },
    frameMeasured: { width: 540, height: 960 },
    frameNative: { width: 1080, height: 1920 },
    referenceOriginal: { width: 3024, height: 4032 },
    referenceBox: { x: 210, y: 305, width: 300, height: 350 },
  })!;

  it("출력 전체로는 가장자리 25% 가 비는 것이 정상이다", () => {
    expect(g.size).toEqual({ width: 1440, height: 1920 });
    expect(g.totalEmptyFraction).toBeCloseTo(0.25, 9);
  });

  it("관심 영역(머리 둘레)은 비지 않는다 — 그래서 경고가 늘 뜨지 않는다", () => {
    expect(g.roiEmptyFraction).toBeCloseTo(0, 12);
    expect(g.qualityScale).toBeCloseTo(1, 12);
  });

  it("얼굴이 동영상 가장자리에 붙어 찍혔으면 관심 영역이 빈다", () => {
    const shifted = outputGeometry({
      fit: fromParams(0, 1, 400, 0),
      referenceMeasured: { width: 720, height: 960 },
      frameMeasured: { width: 540, height: 960 },
      frameNative: { width: 1080, height: 1920 },
      referenceOriginal: { width: 3024, height: 4032 },
      referenceBox: { x: 210, y: 305, width: 300, height: 350 },
    })!;
    // 장면은 출력의 x ≥ 800 만 덮는다. 관심 영역은 x 240~1200 → 560/960 이 빈다.
    expect(shifted.roiEmptyFraction).toBeCloseTo(560 / 960, 9);
  });

  it("기준 사진 크기가 올바르지 않으면 null", () => {
    expect(
      outputGeometry({
        fit: IDENTITY,
        referenceMeasured: { width: 720, height: 960 },
        frameMeasured: { width: 540, height: 960 },
        frameNative: { width: 1080, height: 1920 },
        referenceOriginal: { width: 0, height: 0 },
        referenceBox: { x: 0, y: 0, width: 1, height: 1 },
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 실제로 그려서 확인: 표식을 그린 합성 이미지를 변환해 표식이 기대 위치에 오는지 픽셀로 본다.

type Rgb = [number, number, number];
const FILL: [number, number, number, number] = [128, 128, 128, 255];

function blankImage(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([0, 0, 0, 255], i * 4);
  return d;
}

/** (cx, cy) 를 가운데로 3×3 칸을 칠한다. */
function drawMarker(d: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, rgb: Rgb): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = Math.floor(cx) + dx;
      const y = Math.floor(cy) + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      d.set([rgb[0], rgb[1], rgb[2], 255], (y * w + x) * 4);
    }
  }
}

function pixel(d: Uint8ClampedArray, w: number, x: number, y: number): number[] {
  const o = (Math.floor(y) * w + Math.floor(x)) * 4;
  return [d[o], d[o + 1], d[o + 2], d[o + 3]];
}

const colorOf = (i: number): Rgb => [40 + i * 20, 250 - i * 20, 60 + ((i * 53) % 150)];

describe("warpRgba — 픽셀로 확인", () => {
  it("이동만: 표식이 그만큼 옮겨 가고, 덮이지 않은 곳은 단색", () => {
    const src = blankImage(40, 30);
    drawMarker(src, 40, 30, 10.5, 12.5, [255, 0, 0]);
    const out = warpRgba(src, { width: 40, height: 30 }, fromParams(0, 1, 7, -4), { width: 60, height: 40 }, FILL);
    expect(pixel(out, 60, 17.5, 8.5)).toEqual([255, 0, 0, 255]);
    expect(pixel(out, 60, 10.5, 12.5)).toEqual([0, 0, 0, 255]); // 원래 자리에는 없다
    expect(pixel(out, 60, 2, 20)).toEqual(FILL); // 장면이 덮지 못한 곳
    expect(pixel(out, 60, 55, 38)).toEqual(FILL);
  });

  it("회전·확대·이동: 캔버스 정의로 계산한 자리에 표식이 온다(1px 이내)", () => {
    const sw = 120;
    const sh = 90;
    const src = blankImage(sw, sh);
    const marks: Point[] = [
      { x: 30.5, y: 20.5 },
      { x: 90.5, y: 25.5 },
      { x: 60.5, y: 70.5 },
    ];
    marks.forEach((m, i) => drawMarker(src, sw, sh, m.x, m.y, colorOf(i)));
    const t = fromParams(17, 1.3, 40, -10);
    const out = warpRgba(src, { width: sw, height: sh }, t, { width: 200, height: 200 }, FILL);
    const m6 = toCanvasTransform(t);
    marks.forEach((m, i) => {
      const x = m6[0] * m.x + m6[2] * m.y + m6[4];
      const y = m6[1] * m.x + m6[3] * m.y + m6[5];
      expect(pixel(out, 200, x, y).slice(0, 3)).toEqual(colorOf(i));
    });
  });

  it("역변환을 넘기면 표식이 그 자리에 오지 않는다(방향을 거꾸로 쓴 결함을 잡는 시험인지 확인)", () => {
    const sw = 120;
    const sh = 90;
    const src = blankImage(sw, sh);
    const mark = { x: 30.5, y: 20.5 };
    drawMarker(src, sw, sh, mark.x, mark.y, [255, 0, 0]);
    const t = fromParams(17, 1.3, 40, -10);
    const wrong = warpRgba(src, { width: sw, height: sh }, invert(t)!, { width: 200, height: 200 }, FILL);
    const p = applySimilarity(t, mark);
    expect(pixel(wrong, 200, p.x, p.y).slice(0, 3)).not.toEqual([255, 0, 0]);
  });

  it("끝에서 끝까지: 기준점 맞춤 → 출력 변환 → 그리기. 장면의 표식이 기준 사진의 기준점 자리에 겹친다", () => {
    // 기준 사진: 240×320(재는 크기 = 원본 크기). 기준점 다섯 개.
    const refSize = { width: 240, height: 320 };
    const refPoints: Point[] = [
      { x: 80.5, y: 120.5 },
      { x: 160.5, y: 120.5 },
      { x: 120.5, y: 160.5 },
      { x: 60.5, y: 150.5 },
      { x: 180.5, y: 150.5 },
    ];
    // 장면: 640×360(화면비가 다르다), 재는 크기는 그 절반(320×180). 얼굴이 9° 기울고 0.8배로, 다른 자리에 찍혔다.
    const native = { width: 640, height: 360 };
    const measured = { width: 320, height: 180 };
    const truth = fromParams(-9, 1 / 0.8, 14, 22); // 장면(재는 픽셀) → 기준(재는 픽셀)
    const sceneMeasured = refPoints.map((p) => applySimilarity(invert(truth)!, p));
    const sceneNative = sceneMeasured.map((p) => ({ x: p.x * 2, y: p.y * 2 }));
    const src = blankImage(native.width, native.height);
    sceneNative.forEach((p, i) => drawMarker(src, native.width, native.height, p.x, p.y, colorOf(i)));

    const fit = fitSimilarity(sceneMeasured, refPoints)!;
    const g = outputGeometry({
      fit,
      referenceMeasured: refSize,
      frameMeasured: measured,
      frameNative: native,
      referenceOriginal: refSize,
      referenceBox: { x: 60, y: 100, width: 120, height: 100 },
    })!;
    expect(g.size).toEqual(refSize);
    // 원본 → 출력의 배율은 (재는 비 0.5) × (맞춤 1.25) = 0.625, 회전은 −9°.
    expect(scaleOf(g.transform)).toBeCloseTo(0.625, 9);
    expect(rotationDegOf(g.transform)).toBeCloseTo(-9, 9);

    const out = warpRgba(src, native, g.transform, g.size, FILL);
    refPoints.forEach((p, i) => {
      // 3×3 표식이 0.625배로 줄어 약 1.9px 이 된다. 기준점 자리의 픽셀이 그 표식 색이어야 한다(1px 이내).
      expect(pixel(out, refSize.width, p.x, p.y).slice(0, 3)).toEqual(colorOf(i));
    });
  });

  it("크기가 맞지 않는 입력과 배율 0 은 예외", () => {
    expect(() => warpRgba(new Uint8ClampedArray(10), { width: 4, height: 4 }, IDENTITY, { width: 4, height: 4 }, FILL)).toThrow(RangeError);
    expect(() =>
      warpRgba(blankImage(4, 4), { width: 4, height: 4 }, { a: 0, b: 0, tx: 0, ty: 0 }, { width: 4, height: 4 }, FILL),
    ).toThrow(RangeError);
  });
});
