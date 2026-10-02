import { describe, expect, it } from "vitest";
import { anchorQuality, compareToReference, scoreOf } from "./compare";
import { readFaces, type FaceReading } from "./measure";
import { RULES } from "./rules";
import { rotationDegOf, scaleOf } from "./similarity";
import { BASE_FRAME, Rx, Ry, Rz, mul, mulVec, synthFace, syntheticFace, type M3 } from "./testkit";

const ref = synthFace();

describe("scoreOf — 점수식", () => {
  it("각도차 + 0.1·|θ| + 5·|ln f| + 10·p (손 계산값)", () => {
    // 2 + 0.1·10 + 5·ln(1.22) + 10·0.1 = 2 + 1 + 0.99426 + 1
    expect(scoreOf({ angleDeg: 2, rotationDeg: -10, frameScale: 1.22, position: 0.1 })).toBeCloseTo(
      2 + 1 + 5 * Math.log(1.22) + 1,
      12,
    );
  });

  it("가중치의 뜻: 기울기 10°, 크기 1.22배, 위치 0.1 이 각각 각도차 약 1° 만큼", () => {
    expect(scoreOf({ angleDeg: 0, rotationDeg: 10, frameScale: 1, position: 0 })).toBeCloseTo(1, 12);
    expect(scoreOf({ angleDeg: 0, rotationDeg: 0, frameScale: 1.22, position: 0 })).toBeCloseTo(0.994, 3);
    expect(scoreOf({ angleDeg: 0, rotationDeg: 0, frameScale: 1, position: 0.1 })).toBeCloseTo(1, 12);
  });

  it("크기 차는 크든 작든 같은 감점이다(f 와 1/f)", () => {
    const a = scoreOf({ angleDeg: 0, rotationDeg: 0, frameScale: 1.3, position: 0 });
    const b = scoreOf({ angleDeg: 0, rotationDeg: 0, frameScale: 1 / 1.3, position: 0 });
    expect(a).toBeCloseTo(b, 12);
  });
});

describe("compareToReference", () => {
  it("같은 얼굴이면 전부 0(틀 배율 1)", () => {
    const c = compareToReference(ref, synthFace())!;
    expect(c.angleDeg).toBeCloseTo(0, 9);
    expect(c.rotationDeg).toBeCloseTo(0, 9);
    expect(c.fitScale).toBeCloseTo(1, 12);
    expect(c.frameScale).toBeCloseTo(1, 12);
    expect(c.position).toBeCloseTo(0, 12);
    expect(c.residual).toBeCloseTo(0, 9);
    expect(c.score).toBeCloseTo(0, 9);
  });

  it("각도차는 보는 방향의 차이고, 기울기·크기·자리와는 따로다", () => {
    const c = compareToReference(ref, synthFace({ dir: { h: 4, v: 0 } }))!;
    expect(c.angleDeg).toBeCloseTo(4, 9);
    expect(c.rotationDeg).toBeCloseTo(0, 9);
    const d = compareToReference(ref, synthFace({ rollDeg: 12, size: 0.8, shift: { x: 30, y: -20 } }))!;
    expect(d.angleDeg).toBeCloseTo(0, 9);
  });

  it("기울기 12° 인 장면: 맞추는 데 필요한 회전은 −12°(크기 12)", () => {
    const c = compareToReference(ref, synthFace({ rollDeg: 12 }))!;
    expect(Math.abs(c.rotationDeg)).toBeCloseTo(12, 9);
    expect(c.rotationDeg).toBeCloseTo(-12, 9);
    expect(c.residual).toBeLessThan(1e-9);
  });

  it("얼굴이 0.8배로 찍힌 장면: 맞춤 배율은 1.25, 틀 배율 f 도 1.25(기준 ÷ 장면)", () => {
    const c = compareToReference(ref, synthFace({ size: 0.8 }))!;
    expect(c.fitScale).toBeCloseTo(1.25, 9);
    expect(c.frameScale).toBeCloseTo(1.25, 9);
    expect(scaleOf(c.fit)).toBe(c.fitScale);
    expect(rotationDegOf(c.fit)).toBe(c.rotationDeg);
  });

  it("틀 배율은 화면 짧은 변 대비 비율의 비다: 같은 픽셀 크기라도 화면이 크면 f 가 달라진다", () => {
    // 720×960(짧은 변 720)의 기준과, 1080×1920(짧은 변 1080)에 같은 픽셀 크기로 찍힌 장면.
    const c = compareToReference(ref, synthFace({ frame: { width: 1080, height: 1920 } }))!;
    expect(c.frameScale).toBeCloseTo(1080 / 720, 9);
    // 픽셀 크기는 같으므로 기준점 맞춤의 배율은 1 이다 — 둘은 다른 값이다.
    expect(c.fitScale).toBeCloseTo(1, 9);
  });

  it("위치 차 p: 각자 자기 화면의 짧은 변으로 나눈 벡터의 차의 크기", () => {
    // 짧은 변 720. (36, −48)px 이동 → (0.05, −0.0667) → 크기 0.08333.
    const c = compareToReference(ref, synthFace({ shift: { x: 36, y: -48 } }))!;
    expect(c.position).toBeCloseTo(Math.hypot(36, 48) / 720, 9);
    // 기준 사진과 장면의 화면비가 달라도, 둘 다 가운데에 있으면 0 이다.
    const wide = compareToReference(ref, synthFace({ frame: { width: 1280, height: 720 } }))!;
    expect(wide.position).toBeCloseTo(0, 9);
  });

  it("남는 오차: 닮음 변환으로 맞지 않는 어긋남이 눈 사이 거리 단위로 남는다", () => {
    // 한 점만 눈 사이 거리의 20% 만큼 옮긴다.
    const moved = synthFace({ jitter: (i) => (i === 9 ? { x: 0, y: 0.2 * ref.eyeDistancePx } : { x: 0, y: 0 }) });
    const c = compareToReference(ref, moved)!;
    expect(c.residual).toBeGreaterThan(0.03);
    expect(c.residual).toBeLessThan(0.2 / Math.sqrt(ref.anchors.length) + 1e-9);
  });

  it("좌우를 뒤집은 기준 방향과의 각도차를 함께 돌려준다(W10 의 재료)", () => {
    const leftRef = synthFace({ dir: { h: 40, v: 0 } });
    const right = synthFace({ dir: { h: -40, v: 0 } });
    const c = compareToReference(leftRef, right)!;
    expect(c.angleDeg).toBeCloseTo(80, 6);
    expect(c.mirroredAngleDeg).toBeCloseTo(0, 6);
  });

  it("점수는 scoreOf 와 같은 식이다", () => {
    const c = compareToReference(ref, synthFace({ dir: { h: 2, v: 1 }, rollDeg: 6, size: 0.9, shift: { x: 20, y: 10 } }))!;
    expect(c.score).toBeCloseTo(scoreOf(c), 12);
    expect(c.score).toBeGreaterThan(c.angleDeg);
  });

  it("견줄 수 없으면 null — 0 으로 채워 견주지 않는다", () => {
    const collapsed = synthFace();
    collapsed.anchors = collapsed.anchors.map(() => ({ x: 1, y: 1 }));
    expect(compareToReference(ref, collapsed)).toBeNull();
    const zeroSize = synthFace();
    zeroSize.faceShortRatio = 0;
    expect(compareToReference(ref, zeroSize)).toBeNull();
    const nanView = synthFace();
    nanView.view = [Number.NaN, 0, 1];
    expect(compareToReference(ref, nanView)).toBeNull();
  });
});

describe("compareToReference — 행렬과 랜드마크에서 읽은 얼굴로(끝에서 끝까지)", () => {
  const FRAME = { width: 720, height: 960 };
  const read = (R: M3, t: [number, number, number]): FaceReading => {
    const r = readFaces([syntheticFace({ R, t }, FRAME, 1000)], FRAME);
    if (!r.ok) throw new Error(r.failure);
    return r.face;
  };
  const R0 = mul(Ry(8), Rx(-5));
  const t0: [number, number, number] = [0, 0, -50];

  it("카메라만 돌려 얼굴이 화면에서 옮겨 간 쌍: 각도차는 0.001° 이내인데 축별 각은 6° 넘게 다르다", () => {
    const Q = Ry(7);
    const a = read(R0, t0);
    const b = read(mul(Q, R0), mulVec(Q, t0));
    const c = compareToReference(a, b)!;
    expect(c.angleDeg).toBeLessThan(0.001);
    expect(Math.abs(a.axes.yaw - b.axes.yaw)).toBeGreaterThan(6);
    // 얼굴은 화면에서 옮겨 갔다 — 위치 차로는 잡히고, 각도차에는 들어가지 않는다.
    expect(c.position).toBeGreaterThan(0.05);
  });

  it("화면 안에서 기울기만 바꾼 쌍: 각도차는 0.001° 이내, 맞추는 회전은 그 기울기만큼", () => {
    const Q = Rz(14);
    const a = read(R0, t0);
    const b = read(mul(Q, R0), mulVec(Q, t0));
    const c = compareToReference(a, b)!;
    expect(c.angleDeg).toBeLessThan(0.001);
    expect(Math.abs(c.rotationDeg)).toBeCloseTo(14, 6);
    expect(c.residual).toBeLessThan(1e-6);
  });

  it("얼굴은 그대로 두고 카메라가 옆으로 옮겨 가면(축별 각은 같다) 그만큼이 각도차로 잡힌다", () => {
    const a = read(R0, t0);
    const b = read(R0, [4, 0, -50]);
    const c = compareToReference(a, b)!;
    expect(b.axes.yaw).toBeCloseTo(a.axes.yaw, 9);
    expect(c.angleDeg).toBeCloseTo((Math.atan(4 / 50) * 180) / Math.PI, 6);
  });

  it("고개를 실제로 4° 더 돌린 장면: 각도차 4°", () => {
    const a = read(Ry(10), t0);
    const b = read(Ry(14), t0);
    expect(compareToReference(a, b)!.angleDeg).toBeCloseTo(4, 6);
  });
});

describe("anchorQuality", () => {
  it("합성 배치: 16점, 퍼짐 8 이상 → 충분", () => {
    const q = anchorQuality(ref);
    expect(q.count).toBe(16);
    expect(q.spread).toBeGreaterThanOrEqual(RULES.anchors.minSpread);
    expect(q.sufficient).toBe(true);
  });

  it("퍼짐은 크기·자리·기울기에 변하지 않는다(눈 사이 거리 단위)", () => {
    const q = anchorQuality(synthFace({ size: 0.6, rollDeg: 20, shift: { x: 50, y: 50 }, frame: BASE_FRAME }));
    expect(q.spread).toBeCloseTo(anchorQuality(ref).spread, 9);
  });

  it("조건을 올리면 충분하지 않다고 답한다", () => {
    const strict = { ...RULES, anchors: { minCount: 12, minSpread: 1000 } };
    expect(anchorQuality(ref, strict).sufficient).toBe(false);
    const many = { ...RULES, anchors: { minCount: 99, minSpread: 8 } };
    expect(anchorQuality(ref, many).sufficient).toBe(false);
  });
});
