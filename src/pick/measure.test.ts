import { describe, expect, it } from "vitest";
import { angleBetweenDeg } from "./direction";
import {
  ANCHOR_INDICES,
  ANCHOR_ORDER,
  MIN_LANDMARKS,
  SKIN_INDICES,
  readFaces,
  skinPatchCorners,
  skinPatchToCanvas,
  toFrameMeasurement,
  toMeasured,
  type FacesReading,
  type RawFace,
} from "./measure";
import { RULES } from "./rules";
import { I3, Ry, Rz, matrix16, syntheticFace } from "./testkit";

const FRAME = { width: 720, height: 960 };
const FOCAL = 1000;
const front = () => syntheticFace({ R: I3, t: [0, 0, -50] }, FRAME, FOCAL);
const ok = (r: FacesReading) => {
  if (!r.ok) throw new Error(`읽지 못함: ${r.failure}`);
  return r.face;
};
const pxOf = (face: RawFace, i: number) => ({ x: face.landmarks[i].x * FRAME.width, y: face.landmarks[i].y * FRAME.height });

describe("기준점 번호", () => {
  it("12점 이상이고 겹치지 않으며, 헤어라인·이마 위(10)·턱 끝(152)·코끝(1)은 들어 있지 않다", () => {
    expect(ANCHOR_ORDER.length).toBeGreaterThanOrEqual(RULES.anchors.minCount);
    expect(new Set(ANCHOR_ORDER).size).toBe(ANCHOR_ORDER.length);
    for (const banned of [10, 152, 1]) expect(ANCHOR_ORDER).not.toContain(banned);
    expect(Math.max(...ANCHOR_ORDER, ...Object.values(SKIN_INDICES))).toBeLessThan(MIN_LANDMARKS);
  });
});

describe("readFaces — 읽을 수 있는지만 본다", () => {
  it("얼굴이 없으면 noFace, 둘이면 multipleFaces", () => {
    expect(readFaces([], FRAME)).toEqual({ ok: false, faceCount: 0, failure: "noFace" });
    expect(readFaces([front(), front()], FRAME)).toEqual({ ok: false, faceCount: 2, failure: "multipleFaces" });
  });

  it("행렬이 없거나 읽을 수 없으면 matrixUnreadable", () => {
    const f = front();
    expect(readFaces([{ ...f, matrix: null }], FRAME)).toMatchObject({ ok: false, failure: "matrixUnreadable" });
    expect(readFaces([{ ...f, matrix: [1, 2, 3] }], FRAME)).toMatchObject({ ok: false, failure: "matrixUnreadable" });
    expect(readFaces([{ ...f, matrix: matrix16(I3, 1, [0, 0, 0]) }], FRAME)).toMatchObject({
      ok: false,
      failure: "matrixUnreadable",
    });
  });

  it("랜드마크가 모자라거나 유한하지 않으면 landmarksUnreadable — 채워서 읽지 않는다", () => {
    const f = front();
    expect(readFaces([{ ...f, landmarks: f.landmarks.slice(0, 100) }], FRAME)).toMatchObject({
      ok: false,
      failure: "landmarksUnreadable",
    });
    const broken = f.landmarks.map((p, i) => (i === ANCHOR_INDICES.leftEyeOuter ? { x: Number.NaN, y: p.y } : p));
    expect(readFaces([{ ...f, landmarks: broken }], FRAME)).toMatchObject({ ok: false, failure: "landmarksUnreadable" });
    expect(readFaces([f], { width: 0, height: 960 })).toMatchObject({ ok: false, failure: "landmarksUnreadable" });
  });

  it("정면 얼굴: 보는 방향은 (0,0,1), 기준점은 픽셀 좌표로 순서대로", () => {
    const f = front();
    const face = ok(readFaces([f], FRAME));
    expect(angleBetweenDeg(face.view, [0, 0, 1])).toBeLessThan(1e-9);
    expect(face.anchors).toHaveLength(ANCHOR_ORDER.length);
    ANCHOR_ORDER.forEach((idx, k) => {
      expect(face.anchors[k].x).toBeCloseTo(pxOf(f, idx).x, 9);
      expect(face.anchors[k].y).toBeCloseTo(pxOf(f, idx).y, 9);
    });
    expect(face.frame).toEqual(FRAME);
    expect(face.orthoError).toBeLessThan(1e-12);
  });

  it("눈 사이 거리는 두 눈 중심(눈머리·눈꼬리의 가운데) 사이의 픽셀 거리다", () => {
    const f = front();
    const face = ok(readFaces([f], FRAME));
    const r = (pxOf(f, 33).x + pxOf(f, 133).x) / 2;
    const l = (pxOf(f, 362).x + pxOf(f, 263).x) / 2;
    expect(face.eyeDistancePx).toBeCloseTo(l - r, 6);
    expect(face.eyeDistancePx).toBeGreaterThan(50);
  });

  it("위치는 화면 중심 기준이다: 가운데 얼굴은 0 근처, 화면비가 달라도 같은 값", () => {
    const tall = ok(readFaces([syntheticFace({ R: I3, t: [0, 0, -50] }, { width: 720, height: 960 }, FOCAL)], { width: 720, height: 960 }));
    const wide = ok(readFaces([syntheticFace({ R: I3, t: [0, 0, -50] }, { width: 1280, height: 720 }, FOCAL)], { width: 1280, height: 720 }));
    expect(Math.abs(tall.offset.x)).toBeLessThan(1e-9);
    // 박스 중심은 이마 위·턱 끝의 가운데라 화면 중심에서 조금 벗어나 있다. 두 화면에서 같다.
    expect(wide.offset.x).toBeCloseTo(tall.offset.x, 9);
    expect(wide.offset.y).toBeCloseTo(tall.offset.y, 9);
    // 짧은 변이 같고(720) 얼굴 크기가 같으므로 크기 비율도 같다.
    expect(wide.faceShortRatio).toBeCloseTo(tall.faceShortRatio, 9);
  });

  it("얼굴이 옆으로 옮겨 가면 위치가 짧은 변 단위로 그만큼 달라진다", () => {
    // 박스의 좌우 끝은 얼굴 가장자리 점(z = −2cm, 카메라에서 52cm)이다. 5cm 옆으로 옮기면
    // 화면에서 1000·5/52 = 96.15px, 짧은 변 720 의 0.13355.
    const moved = ok(readFaces([syntheticFace({ R: I3, t: [5, 0, -50] }, FRAME, FOCAL)], FRAME));
    const center = ok(readFaces([front()], FRAME));
    expect(moved.offset.x - center.offset.x).toBeCloseTo((1000 * 5) / 52 / 720, 9);
    expect(moved.offset.y).toBeCloseTo(center.offset.y, 9);
  });

  it("가장자리 여백은 짧은 변의 2%: 여백 안으로 들어가면 touchesEdge", () => {
    expect(ok(readFaces([front()], FRAME)).touchesEdge).toBe(false);
    // 얼굴 박스 폭은 약 300px. 오른쪽으로 210px 옮기면 오른쪽 가장자리(720)에 닿는다.
    const near = ok(readFaces([syntheticFace({ R: I3, t: [10.5, 0, -50] }, FRAME, FOCAL)], FRAME));
    expect(near.touchesEdge).toBe(true);
  });

  it("선명도 영역은 얼굴 박스를 화면 안으로 자른 것", () => {
    const face = ok(readFaces([syntheticFace({ R: I3, t: [12, 0, -50] }, FRAME, FOCAL)], FRAME));
    expect(face.box.x + face.box.width).toBeGreaterThan(FRAME.width);
    expect(face.sharpnessRect.x + face.sharpnessRect.width).toBeLessThanOrEqual(FRAME.width);
    expect(face.sharpnessRect.width).toBeLessThan(face.box.width);
  });
});

describe("피부 패치", () => {
  it("눈 밑에서 코끝 높이까지, 두 눈꼬리 사이의 안쪽에 놓인다", () => {
    const f = front();
    const face = ok(readFaces([f], FRAME));
    const patch = face.skinPatch!;
    const corners = skinPatchCorners(patch);
    const lidY = pxOf(f, SKIN_INDICES.rightLowerLid).y;
    const tipY = pxOf(f, SKIN_INDICES.noseTip).y;
    for (const c of corners) {
      expect(c.y).toBeGreaterThan(lidY); // 눈 아래
      expect(c.y).toBeLessThanOrEqual(tipY + 1e-6); // 코끝 위
      expect(c.x).toBeGreaterThan(pxOf(f, 33).x);
      expect(c.x).toBeLessThan(pxOf(f, 263).x);
    }
    // 이마(눈 위)로는 올라가지 않는다.
    expect(Math.min(...corners.map((c) => c.y))).toBeGreaterThan(pxOf(f, 33).y);
  });

  it("고개가 기울면 패치도 같이 돈다", () => {
    const tilted = syntheticFace({ R: Rz(20), t: [0, 0, -50] }, FRAME, FOCAL);
    const patch = ok(readFaces([tilted], FRAME)).skinPatch!;
    const angle = (Math.atan2(patch.uy, patch.ux) * 180) / Math.PI;
    // 이미지 좌표는 y 가 아래라서 부호가 뒤집힌다. 크기만 본다.
    expect(Math.abs(angle)).toBeGreaterThan(15);
    expect(Math.abs(angle)).toBeLessThan(25);
    // 두 축은 수직인 단위 벡터다.
    expect(Math.hypot(patch.ux, patch.uy)).toBeCloseTo(1, 12);
    expect(patch.ux * patch.vx + patch.uy * patch.vy).toBeCloseTo(0, 12);
  });

  it("skinPatchToCanvas: 패치의 네 꼭짓점이 캔버스의 네 귀퉁이로 간다", () => {
    const patch = ok(readFaces([syntheticFace({ R: Rz(15), t: [1, 0, -50] }, FRAME, FOCAL)], FRAME)).skinPatch!;
    const m = skinPatchToCanvas(patch, 128);
    const mapped = skinPatchCorners(patch).map((p) => ({
      x: m[0] * p.x + m[2] * p.y + m[4],
      y: m[1] * p.x + m[3] * p.y + m[5],
    }));
    const want = [
      [0, 0],
      [128, 0],
      [128, 128],
      [0, 128],
    ];
    mapped.forEach((p, i) => {
      expect(p.x).toBeCloseTo(want[i][0], 8);
      expect(p.y).toBeCloseTo(want[i][1], 8);
    });
  });

  it("화면 밖으로 나가는 패치는 재지 않는다(null) — 바깥의 검은 칸이 클리핑으로 세어지지 않게", () => {
    const off = syntheticFace({ R: I3, t: [16, 0, -50] }, FRAME, FOCAL);
    expect(ok(readFaces([off], FRAME)).skinPatch).toBeNull();
  });

  it("많이 돌아간 얼굴에서도 패치를 지어내지 않는다: 잡히면 화면 안이다", () => {
    for (const yaw of [-45, -20, 20, 45]) {
      const face = ok(readFaces([syntheticFace({ R: Ry(yaw), t: [0, 0, -50] }, FRAME, FOCAL)], FRAME));
      if (face.skinPatch === null) continue;
      for (const c of skinPatchCorners(face.skinPatch)) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThanOrEqual(FRAME.width);
      }
    }
  });
});

describe("toMeasured · toFrameMeasurement", () => {
  it("얼굴을 읽지 못했으면 픽셀 지표도 null 이다", () => {
    const m = toMeasured({ ok: false, faceCount: 0, failure: "noFace" }, { sharpness: 50, skin: { meanLuma: 1, clipRatio: 0 } });
    expect(m).toEqual({ faceCount: 0, face: null, faceFailure: "noFace", sharpness: null, skin: null });
  });

  it("유한하지 않은 픽셀 지표는 0 이 아니라 null 로 적는다", () => {
    const reading = readFaces([front()], FRAME);
    const m = toMeasured(reading, { sharpness: Number.NaN, skin: { meanLuma: Number.NaN, clipRatio: 0 } });
    expect(m.face).not.toBeNull();
    expect(m.sharpness).toBeNull();
    expect(m.skin).toBeNull();
    const good = toMeasured(reading, { sharpness: 42, skin: { meanLuma: 120, clipRatio: 0.01 } });
    expect(good.sharpness).toBe(42);
    expect(good.skin).toEqual({ meanLuma: 120, clipRatio: 0.01 });
  });

  it("브라우저가 실제 장면 시각을 알려 주면 그 값을, 아니면 요청한 시각을 적고 어느 쪽인지 남긴다", () => {
    const m = toMeasured({ ok: false, faceCount: 0, failure: "noFace" }, { sharpness: null, skin: null });
    expect(toFrameMeasurement(m, 2.5, 2.4667)).toMatchObject({ timeSec: 2.4667, requestedTimeSec: 2.5, timeIsReported: true });
    expect(toFrameMeasurement(m, 2.5, null)).toMatchObject({ timeSec: 2.5, requestedTimeSec: 2.5, timeIsReported: false });
    expect(toFrameMeasurement(m, 2.5, Number.NaN)).toMatchObject({ timeSec: 2.5, timeIsReported: false });
  });
});
