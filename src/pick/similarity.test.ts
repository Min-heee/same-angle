import { describe, expect, it } from "vitest";
import { percentile } from "@/core/stats";
import {
  IDENTITY,
  applySimilarity,
  compose,
  fitSimilarity,
  fromParams,
  invert,
  isSimilarityMatrix,
  residualRms,
  rotationDegOf,
  scaleOf,
  spreadOf,
  toCanvasTransform,
  uniformScale,
  type Point,
  type Similarity,
} from "./similarity";
import { baseAnchors, eyeDistanceOf, gauss, rng, uniform } from "./testkit";

/*
 * 기준점 맞춤의 시험은 "추정값과 심어 둔 참값의 차"를 본다. 맞춘 뒤 같은 점으로 남는 오차를 다시
 * 재는 것은 잡음이 없으면 늘 0 이 되는 순환 시험이라 쓰지 않는다(PRD 8절).
 *
 * 단위는 눈 사이 거리다. 시드는 시험마다 1,000개.
 */

const SEEDS = 1000;
const anchors = baseAnchors();
const eye = eyeDistanceOf(anchors);
const centroid = (ps: readonly Point[]): Point => ({
  x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
  y: ps.reduce((s, p) => s + p.y, 0) / ps.length,
});

/** 캔버스 정의대로 6개 숫자를 점에 적용한다(구현의 applySimilarity 를 쓰지 않는다). */
const applyCanvas = (m: readonly number[], p: Point): Point => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});

describe("닮음 변환의 기본", () => {
  it("fromParams: 90° 회전은 (1, 0)을 (0, 1)로(이미지 좌표에서 시계 방향), 배율과 이동이 그 뒤에 붙는다", () => {
    const t = fromParams(90, 2, 10, 20);
    const p = applySimilarity(t, { x: 1, y: 0 });
    expect(p.x).toBeCloseTo(10, 12);
    expect(p.y).toBeCloseTo(22, 12);
    expect(scaleOf(t)).toBeCloseTo(2, 12);
    expect(rotationDegOf(t)).toBeCloseTo(90, 12);
  });

  it("compose 는 안쪽을 먼저, 바깥쪽을 나중에 적용한다", () => {
    const inner = fromParams(30, 1.2, 5, -3);
    const outer = fromParams(-10, 0.8, -7, 11);
    const p = { x: 13, y: -4 };
    const a = applySimilarity(compose(outer, inner), p);
    const b = applySimilarity(outer, applySimilarity(inner, p));
    expect(a.x).toBeCloseTo(b.x, 10);
    expect(a.y).toBeCloseTo(b.y, 10);
    // 순서를 바꾸면 다르다.
    const c = applySimilarity(compose(inner, outer), p);
    expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeGreaterThan(1);
  });

  it("invert 는 되돌린다. 배율 0 은 null", () => {
    const t = fromParams(37, 1.7, 100, -40);
    const back = compose(invert(t)!, t);
    expect(back.a).toBeCloseTo(1, 12);
    expect(back.b).toBeCloseTo(0, 12);
    expect(back.tx).toBeCloseTo(0, 9);
    expect(back.ty).toBeCloseTo(0, 9);
    expect(invert({ a: 0, b: 0, tx: 1, ty: 1 })).toBeNull();
  });

  it("uniformScale 은 원점 기준 확대이고 IDENTITY 는 아무것도 바꾸지 않는다", () => {
    expect(applySimilarity(uniformScale(2.5), { x: 4, y: -2 })).toEqual({ x: 10, y: -5 });
    expect(applySimilarity(IDENTITY, { x: 4, y: -2 })).toEqual({ x: 4, y: -2 });
  });

  it("toCanvasTransform: 캔버스 정의(x′ = a·x + c·y + e, y′ = b·x + d·y + f)로 적용해도 같은 점이 나온다", () => {
    const t = fromParams(-23, 1.4, 31, 7);
    const m = toCanvasTransform(t);
    for (const p of [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
      { x: -40, y: 65 },
    ]) {
      const want = applySimilarity(t, p);
      const got = applyCanvas(m, p);
      expect(got.x).toBeCloseTo(want.x, 10);
      expect(got.y).toBeCloseTo(want.y, 10);
    }
  });
});

describe("isSimilarityMatrix — 닮음 변환인지 독립적으로 확인", () => {
  it("회전·균등 확대·이동은 통과", () => {
    expect(isSimilarityMatrix(toCanvasTransform(fromParams(33, 0.7, 5, 6)))).toBe(true);
    expect(isSimilarityMatrix([1, 0, 0, 1, 0, 0])).toBe(true);
  });

  it("좌우 뒤집기·세로 뒤집기·찌그러뜨리기·기울이기는 거부", () => {
    expect(isSimilarityMatrix([-1, 0, 0, 1, 0, 0])).toBe(false);
    expect(isSimilarityMatrix([1, 0, 0, -1, 0, 0])).toBe(false);
    expect(isSimilarityMatrix([1.2, 0, 0, 1, 0, 0])).toBe(false);
    expect(isSimilarityMatrix([1, 0, 0.3, 1, 0, 0])).toBe(false);
  });

  it("0 배율·유한하지 않은 값·길이가 다른 배열은 거부", () => {
    expect(isSimilarityMatrix([0, 0, 0, 0, 0, 0])).toBe(false);
    expect(isSimilarityMatrix([1, 0, 0, Number.NaN, 0, 0])).toBe(false);
    expect(isSimilarityMatrix([1, 0, 0, 1])).toBe(false);
  });
});

describe("fitSimilarity — 기준점 맞춤(잡음 없음)", () => {
  it(`심어 둔 회전(±15°)·배율(0.7~1.4)·이동을 되찾는다 — 시드 ${SEEDS}개 전부`, () => {
    let worstRot = 0;
    let worstScale = 0;
    let worstMove = 0;
    let worstOverlap = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = rng(seed);
      const truth = fromParams(uniform(r, -15, 15), uniform(r, 0.7, 1.4), uniform(r, -200, 200), uniform(r, -200, 200));
      // 장면의 점 = 참 변환의 역을 기준점에 건 것. 맞춤은 장면 → 기준 이므로 참값은 truth 다.
      const inv = invert(truth)!;
      const scene = anchors.map((p) => applySimilarity(inv, p));
      const fit = fitSimilarity(scene, anchors)!;

      worstRot = Math.max(worstRot, Math.abs(rotationDegOf(fit) - rotationDegOf(truth)));
      worstScale = Math.max(worstScale, Math.abs(scaleOf(fit) / scaleOf(truth) - 1));
      const c = centroid(scene);
      const a = applySimilarity(fit, c);
      const b = applySimilarity(truth, c);
      worstMove = Math.max(worstMove, Math.hypot(a.x - b.x, a.y - b.y) / eye);
      // 변환을 적용하면 기준점이 겹친다.
      worstOverlap = Math.max(worstOverlap, residualRms(fit, scene, anchors) / eye);
    }
    expect(worstRot).toBeLessThanOrEqual(0.001); // °
    expect(worstScale).toBeLessThanOrEqual(0.00001); // 0.001%
    expect(worstMove).toBeLessThanOrEqual(0.00001); // 눈 사이 거리의 0.001%
    expect(worstOverlap).toBeLessThanOrEqual(0.00001);
  });

  it("방향: 장면 → 기준. 거꾸로(기준 → 장면) 맞추면 역변환이 나온다", () => {
    const truth = fromParams(12, 1.25, 40, -30);
    const scene = anchors.map((p) => applySimilarity(invert(truth)!, p));
    const forward = fitSimilarity(scene, anchors)!;
    const backward = fitSimilarity(anchors, scene)!;
    expect(rotationDegOf(forward)).toBeCloseTo(12, 9);
    expect(scaleOf(forward)).toBeCloseTo(1.25, 9);
    expect(rotationDegOf(backward)).toBeCloseTo(-12, 9);
    expect(scaleOf(backward)).toBeCloseTo(1 / 1.25, 9);
  });

  it("점 두 개로도 정확히 맞는다(두 눈만 쓴 경우)", () => {
    const truth = fromParams(-8, 0.9, 3, 4);
    const from = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const to = from.map((p) => applySimilarity(truth, p));
    const fit = fitSimilarity(from, to)!;
    expect(rotationDegOf(fit)).toBeCloseTo(-8, 9);
    expect(scaleOf(fit)).toBeCloseTo(0.9, 9);
  });

  it("맞출 수 없는 입력은 null", () => {
    expect(fitSimilarity([], [])).toBeNull();
    expect(fitSimilarity([{ x: 1, y: 1 }], [{ x: 2, y: 2 }])).toBeNull();
    expect(fitSimilarity(anchors, anchors.slice(1))).toBeNull();
    // 한 점에 몰린 장면.
    const same = anchors.map(() => ({ x: 5, y: 5 }));
    expect(fitSimilarity(same, anchors)).toBeNull();
    // 기준 쪽이 한 점에 몰리면 배율이 0.
    expect(fitSimilarity(anchors, same)).toBeNull();
    const bad = anchors.map((p, i) => (i === 3 ? { x: Number.NaN, y: p.y } : p));
    expect(fitSimilarity(bad, anchors)).toBeNull();
  });
});

describe("닮음 변환만 나온다 — 어떤 입력에도", () => {
  it(`아무 점이나 넣어도 결과는 직교·균등 배율·뒤집기 없음 — 시드 ${SEEDS}개 전부`, () => {
    let fits = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = rng(seed);
      const n = 2 + Math.floor(r() * 20);
      const from: Point[] = [];
      const to: Point[] = [];
      for (let i = 0; i < n; i++) {
        from.push({ x: uniform(r, -500, 500), y: uniform(r, -500, 500) });
        to.push({ x: uniform(r, -500, 500), y: uniform(r, -500, 500) });
      }
      const fit = fitSimilarity(from, to);
      if (fit === null) continue;
      fits++;
      expect(isSimilarityMatrix(toCanvasTransform(fit), 1e-9)).toBe(true);
    }
    expect(fits).toBeGreaterThan(SEEDS * 0.99);
  });

  it("좌우가 뒤집힌 점을 넣어도 뒤집어서 맞추지 않는다 — 남는 오차가 크게 남는다", () => {
    const cx = centroid(anchors).x;
    const mirrored = anchors.map((p) => ({ x: 2 * cx - p.x, y: p.y }));
    const fit = fitSimilarity(mirrored, anchors)!;
    expect(isSimilarityMatrix(toCanvasTransform(fit))).toBe(true);
    // 같은 번호의 점이 좌우로 엇갈려 있으므로 눈 사이 거리의 수십 % 가 남는다.
    expect(residualRms(fit, mirrored, anchors) / eye).toBeGreaterThan(0.3);
  });
});

describe("fitSimilarity — 잡음이 있을 때(장면 쪽 기준점에만, 좌표마다 σ = 눈 사이 거리의 1%)", () => {
  const sigma = 0.01;

  function errors(points: readonly Point[]) {
    const unit = eyeDistanceOf(anchors);
    const rot: number[] = [];
    const scale: number[] = [];
    const move: number[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = rng(seed);
      const noisy = points.map((p) => ({ x: p.x + gauss(r) * sigma * unit, y: p.y + gauss(r) * sigma * unit }));
      const fit = fitSimilarity(noisy, points)!;
      // 참값은 항등 변환이다.
      rot.push(Math.abs(rotationDegOf(fit)));
      scale.push(Math.abs(scaleOf(fit) - 1));
      const c = centroid(points);
      const a = applySimilarity(fit, c);
      move.push(Math.hypot(a.x - c.x, a.y - c.y) / unit);
    }
    return { rot: percentile(rot, 95)!, scale: percentile(scale, 95)!, move: percentile(move, 95)! };
  }

  it("시험에 쓰는 합성 배치는 기준점 조건(12점 이상, 퍼짐 8 이상)을 만족한다", () => {
    expect(anchors.length).toBeGreaterThanOrEqual(12);
    expect(spreadOf(anchors, eye)).toBeGreaterThanOrEqual(8);
  });

  it("95번째 백분위: 회전 0.5° 이하, 배율 1% 이하, 이동 눈 사이 거리의 1% 이하", () => {
    const e = errors(anchors);
    expect(e.rot).toBeLessThanOrEqual(0.5);
    expect(e.scale).toBeLessThanOrEqual(0.01);
    expect(e.move).toBeLessThanOrEqual(0.01);
  });

  it("이론값(회전·배율 1.96σ/√Σr², 이동 2.45σ/√n)과 20% 안에서 같다", () => {
    const e = errors(anchors);
    const spread = spreadOf(anchors, eye);
    const rotTheoryDeg = ((1.96 * sigma) / Math.sqrt(spread)) * (180 / Math.PI);
    const scaleTheory = (1.96 * sigma) / Math.sqrt(spread);
    const moveTheory = (2.45 * sigma) / Math.sqrt(anchors.length);
    expect(e.rot / rotTheoryDeg).toBeGreaterThan(0.8);
    expect(e.rot / rotTheoryDeg).toBeLessThan(1.2);
    expect(e.scale / scaleTheory).toBeGreaterThan(0.8);
    expect(e.scale / scaleTheory).toBeLessThan(1.2);
    expect(e.move / moveTheory).toBeGreaterThan(0.8);
    expect(e.move / moveTheory).toBeLessThan(1.2);
  });

  it("두 눈 중심만 쓰면(퍼짐 0.5) 같은 잡음에서 회전 0.5°·배율 1% 를 넘는다 — 조건이 필요한 이유", () => {
    const twoEyes = [
      { x: 0, y: 0 },
      { x: eye, y: 0 },
    ];
    expect(spreadOf(twoEyes, eye)).toBeCloseTo(0.5, 12);
    // 이 배치의 단위는 eye 이므로 errors() 의 unit 과 같다.
    const e = errors(twoEyes);
    expect(e.rot).toBeGreaterThan(0.5);
    expect(e.scale).toBeGreaterThan(0.01);
    const theoryDeg = ((1.96 * sigma) / Math.sqrt(0.5)) * (180 / Math.PI);
    expect(e.rot / theoryDeg).toBeGreaterThan(0.8);
    expect(e.rot / theoryDeg).toBeLessThan(1.2);
  });
});

describe("residualRms · spreadOf", () => {
  it("residualRms: 손 계산값", () => {
    const from = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const to = [
      { x: 3, y: 4 },
      { x: 10, y: 0 },
    ];
    // 거리 5 와 0 → RMS = √(25/2).
    expect(residualRms(IDENTITY as Similarity, from, to)).toBeCloseTo(Math.sqrt(12.5), 12);
    expect(residualRms(IDENTITY, from, [])).toBeNaN();
  });

  it("spreadOf: 손 계산값, 단위가 올바르지 않으면 NaN", () => {
    const pts = [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 2 },
      { x: 0, y: -2 },
    ];
    // 무게중심 (0,0), 제곱합 1+1+4+4 = 10. 단위 2 → 10/4.
    expect(spreadOf(pts, 2)).toBeCloseTo(2.5, 12);
    expect(spreadOf(pts, 0)).toBeNaN();
    expect(spreadOf([], 1)).toBeNaN();
  });
});
