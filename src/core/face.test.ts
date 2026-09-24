import { describe, expect, it } from "vitest";
import { faceBox } from "./face";

describe("faceBox", () => {
  // 1920×1080 가로 프레임. 짧은 변 = 1080.
  const W = 1920;
  const H = 1080;

  it("정규화 좌표를 픽셀로 되돌려 박스·중심·비율을 낸다", () => {
    // x 0.4~0.6 → 768~1152 px(폭 384), y 0.3~0.7 → 324~756 px(높이 432)
    const b = faceBox(
      [
        { x: 0.4, y: 0.3 },
        { x: 0.6, y: 0.7 },
        { x: 0.5, y: 0.5 },
      ],
      W,
      H,
      0,
    )!;
    expect(b.minX).toBeCloseTo(768, 9);
    expect(b.maxX).toBeCloseTo(1152, 9);
    expect(b.minY).toBeCloseTo(324, 9);
    expect(b.maxY).toBeCloseTo(756, 9);
    expect(b.width).toBeCloseTo(384, 9);
    expect(b.height).toBeCloseTo(432, 9);
    expect(b.cx).toBeCloseTo(960, 9);
    expect(b.cy).toBeCloseTo(540, 9);
    // 짧은 변 384 ÷ 1080
    expect(b.shortSideRatio).toBeCloseTo(384 / 1080, 12);
    expect(b.centerShort.x).toBeCloseTo(960 / 1080, 12);
    expect(b.centerShort.y).toBeCloseTo(0.5, 12);
    expect(b.touchesEdge).toBe(false);
  });

  it("정규화 좌표에서 바로 재면 틀리는 경우: 정규화상 정사각형이 픽셀로는 16:9", () => {
    const b = faceBox(
      [
        { x: 0.25, y: 0.25 },
        { x: 0.75, y: 0.75 },
      ],
      W,
      H,
      0,
    )!;
    expect(b.width).toBeCloseTo(960, 9);
    expect(b.height).toBeCloseTo(540, 9);
    expect(b.shortSideRatio).toBeCloseTo(0.5, 12);
  });

  it("여백 안으로 들어오면 경계 접촉", () => {
    // minX = 0.01·1920 = 19.2 px
    const pts = [
      { x: 0.01, y: 0.3 },
      { x: 0.3, y: 0.7 },
    ];
    expect(faceBox(pts, W, H, 10)!.touchesEdge).toBe(false);
    expect(faceBox(pts, W, H, 20)!.touchesEdge).toBe(true);
  });

  it("위쪽 가장자리(정수리·이마가 잘리는 구도)도 접촉", () => {
    // minY = 0.005·1080 = 5.4 px ≤ 10
    expect(
      faceBox(
        [
          { x: 0.5, y: 0.005 },
          { x: 0.6, y: 0.4 },
        ],
        W,
        H,
        10,
      )!.touchesEdge,
    ).toBe(true);
  });

  it("여백과 딱 같은 거리면 접촉(경계 포함)", () => {
    // minX = (10/1920)·1920 = 10 px = 여백
    expect(
      faceBox(
        [
          { x: 10 / 1920, y: 0.5 },
          { x: 0.6, y: 0.6 },
        ],
        W,
        H,
        10,
      )!.touchesEdge,
    ).toBe(true);
  });

  it("오른쪽·아래 가장자리와 화면 밖 좌표도 접촉으로 본다", () => {
    expect(
      faceBox(
        [
          { x: 0.5, y: 0.5 },
          { x: 0.7, y: 1.02 },
        ],
        W,
        H,
        0,
      )!.touchesEdge,
    ).toBe(true);
    expect(
      faceBox(
        [
          { x: 0.5, y: 0.5 },
          { x: 1, y: 0.6 },
        ],
        W,
        H,
        0,
      )!.touchesEdge,
    ).toBe(true);
  });

  it("세로 프레임(1080×1920)에서는 폭이 짧은 변", () => {
    const b = faceBox(
      [
        { x: 0.3, y: 0.4 },
        { x: 0.7, y: 0.6 },
      ],
      1080,
      1920,
      0,
    )!;
    // 폭 432, 높이 384 → 짧은 변 384 ÷ 1080
    expect(b.shortSideRatio).toBeCloseTo(384 / 1080, 12);
    expect(b.centerShort.y).toBeCloseTo(960 / 1080, 12);
  });

  it("빈 점, 비유한 좌표, 잘못된 프레임·여백은 null", () => {
    expect(faceBox([], W, H, 0)).toBeNull();
    expect(faceBox([{ x: Number.NaN, y: 0.5 }], W, H, 0)).toBeNull();
    expect(faceBox([{ x: 0.5, y: 0.5 }], 0, H, 0)).toBeNull();
    expect(faceBox([{ x: 0.5, y: 0.5 }], W, Number.POSITIVE_INFINITY, 0)).toBeNull();
    expect(faceBox([{ x: 0.5, y: 0.5 }], W, H, -1)).toBeNull();
  });
});
