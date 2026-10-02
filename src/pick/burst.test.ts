import { describe, expect, it } from "vitest";
import {
  analyzePhotos,
  comparePhotoNames,
  photoNumberOf,
  planPhotoSet,
  sizeSummary,
  type AnalyzePhotosOptions,
  type PhotoReading,
} from "./burst";
import { judge, photoJudgeContext, judgeCandidate } from "./judge";
import type { FrameSize } from "./measure";
import { photoSetNotices, stopMessage, warningMessage } from "./messages";
import { outputSize } from "./output";
import { analyze, type AnalysisResult, type Progress } from "./pipeline";
import { RULES } from "./rules";
import { rng, synthFace, synthFrame, uniform, type SynthFrameOptions } from "./testkit";

/*
 * 사진 여러 장(연사)에서 고르기(PRD v0.3.1). **전부 합성 데이터다** — 사진이 아니라 "그 사진을 재면
 * 나오는 숫자"를 넣는다. 얼굴 모델도 실제 카메라의 사진도 거치지 않으므로, 확인하는 것은 순서·제외·
 * 고르기·다시 재기의 계산뿐이다. 실제 연사 사진에서 쓸 만한지는 말해 주지 않는다.
 */

const SIZE: FrameSize = { width: 6000, height: 4000 };

type Spec = (Partial<Omit<SynthFrameOptions, "timeSec">> & { photoSize?: FrameSize }) | null;

/** 순번마다의 "재면 나오는 값"으로 묶음을 만든다. null 은 읽지 못하는 파일이다. */
function burst(specs: readonly Spec[], over: Partial<AnalyzePhotosOptions> = {}) {
  const calls: { n: number; phase: "coarse" | "remeasure" }[] = [];
  const progress: Progress[] = [];
  const run = () =>
    analyzePhotos({
      reference: synthFace(),
      count: specs.length,
      measurePhoto: async (n, phase): Promise<PhotoReading | null> => {
        calls.push({ n, phase });
        const spec = specs[n - 1];
        if (spec === null) return null;
        const { photoSize, ...frame } = spec;
        return { measured: synthFrame({ timeSec: n, ...frame }), size: photoSize ?? SIZE };
      },
      onProgress: (p) => progress.push({ ...p }),
      ...over,
    });
  return { run, calls, progress };
}

const picked = (r: AnalysisResult) => {
  if (r.kind !== "picked") throw new Error(`고르지 못함: ${r.kind}${r.kind === "stopped" ? ` ${r.stop}` : ""}`);
  return r;
};
const numberOf = (c: { measurement: { timeSec: number } }) => photoNumberOf(c.measurement.timeSec);

describe("comparePhotoNames — 파일 이름 순(숫자는 수로)", () => {
  it("IMG_2 가 IMG_10 보다 앞이다", () => {
    const names = ["IMG_10.JPG", "IMG_2.JPG", "IMG_1.JPG", "IMG_100.JPG"];
    expect([...names].sort(comparePhotoNames)).toEqual(["IMG_1.JPG", "IMG_2.JPG", "IMG_10.JPG", "IMG_100.JPG"]);
  });

  it("앞에 0 을 채운 번호도 값으로 견준다. 값이 같으면 글자 그대로 견줘 순서가 정해진다", () => {
    expect(comparePhotoNames("IMG_0009.JPG", "IMG_0010.JPG")).toBeLessThan(0);
    expect(comparePhotoNames("a007.jpg", "a7.jpg")).not.toBe(0);
    expect(comparePhotoNames("a7.jpg", "a7.jpg")).toBe(0);
  });

  it("대문자·소문자를 가리지 않고, 기기 설정(로케일)에 기대지 않는다", () => {
    expect(comparePhotoNames("img_3.jpg", "IMG_12.JPG")).toBeLessThan(0);
    expect(comparePhotoNames("B.jpg", "a.jpg")).toBeGreaterThan(0);
    // 20자리가 넘는 번호도 자릿수와 글자 순서로 견준다(수로 바꾸다 넘치지 않는다).
    expect(comparePhotoNames("x99999999999999999999998", "x99999999999999999999999")).toBeLessThan(0);
  });

  it("반대칭이다: 어떤 두 이름이든 뒤집으면 부호가 뒤집힌다", () => {
    const names = ["IMG_1.JPG", "img_01.jpg", "DSC00012.JPG", "DSC0012.JPG", "", "12", "a", "A1b2", "A1b10"];
    for (const a of names) {
      for (const b of names) expect(Math.sign(comparePhotoNames(a, b)) + Math.sign(comparePhotoNames(b, a))).toBe(0);
    }
  });
});

describe("planPhotoSet — 순번과 장수 상한", () => {
  it("고른 순서가 섞여 있어도 이름 순으로 세운다. 순번 1 이 맨 앞 이름이다", () => {
    const names = ["IMG_0012.JPG", "IMG_0003.JPG", "IMG_0007.JPG"];
    const p = planPhotoSet(names);
    expect(p.order.map((i) => names[i])).toEqual(["IMG_0003.JPG", "IMG_0007.JPG", "IMG_0012.JPG"]);
    expect(p).toMatchObject({ selected: 3, used: 3, overLimit: 0 });
  });

  it("이름이 같으면 고른 순서 그대로다(이름 없는 파일들도 순서가 정해진다)", () => {
    expect(planPhotoSet(["", "", ""]).order).toEqual([0, 1, 2]);
    expect(planPhotoSet(["b", "a", "a"]).order).toEqual([1, 2, 0]);
  });

  it("상한은 60장 [가정]. 61장이면 이름 순으로 앞 60장만 보고 1장을 넘긴다", () => {
    expect(RULES.photos.maxCount).toBe(60);
    const names = Array.from({ length: 61 }, (_, i) => `IMG_${61 - i}.JPG`);
    const p = planPhotoSet(names);
    expect(p).toMatchObject({ selected: 61, used: 60, overLimit: 1 });
    expect(p.order.map((i) => names[i])[0]).toBe("IMG_1.JPG");
    expect(p.order.map((i) => names[i])).not.toContain("IMG_61.JPG");
  });

  it("빈 묶음은 볼 것이 없다", () => {
    expect(planPhotoSet([])).toEqual({ order: [], selected: 0, used: 0, overLimit: 0 });
  });
});

describe("sizeSummary — 크기가 섞였는가", () => {
  it("모두 같으면 다른 사진 0장", () => {
    expect(sizeSummary([SIZE, SIZE, SIZE])).toEqual({ commonSize: SIZE, sizeMismatch: 0 });
  });

  it("가장 많은 크기와 다른 사진을 센다. 읽지 못한 사진(null)은 세지 않는다", () => {
    const other = { width: 4000, height: 6000 };
    expect(sizeSummary([SIZE, other, SIZE, null, SIZE])).toEqual({ commonSize: SIZE, sizeMismatch: 1 });
  });

  it("가로·세로만 바뀐 사진도 다른 크기다(세로로 돌려 찍은 사진)", () => {
    expect(sizeSummary([SIZE, { width: 4000, height: 6000 }]).sizeMismatch).toBe(1);
  });

  it("가장 많은 크기가 둘이면 순번이 앞인 쪽이 대표다. 읽은 사진이 없으면 null", () => {
    const a = { width: 100, height: 200 };
    const b = { width: 300, height: 400 };
    expect(sizeSummary([b, a, a, b]).commonSize).toEqual(b);
    expect(sizeSummary([null, null])).toEqual({ commonSize: null, sizeMismatch: 0 });
  });
});

describe("analyzePhotos — 심어 둔 정답을 고른다", () => {
  it("기준과 가장 가까운 사진을 고르고, 결과의 순번이 그 사진의 순번이다", async () => {
    const specs: Spec[] = Array.from({ length: 24 }, (_, i) => ({ dir: { h: -11.5 + i, v: 0 } }));
    specs[16] = { dir: { h: 0.2, v: 0.1 } };
    const r = picked(await burst(specs).run());
    expect(numberOf(r.winner)).toBe(17);
    expect(r.winner.verdict).toBe("close");
    expect(r.winner.measurement.timeIsReported).toBe(false);
    expect(r.photos).toMatchObject({ count: 24, unreadable: 0, sizeMismatch: 0, commonSize: SIZE });
    expect(r.measured).toEqual({ coarse: 24, fine: 0, remeasure: 1 + r.runnerUps.length });
    expect(r.quickAnswer).toBeNull();
    expect(r.truncated).toBe(false);
  });

  it("시드 200개: 20~30장 묶음 어디에 심어도 그 사진을 고른다(나머지는 1° 넘게 떨어뜨림)", async () => {
    let wrong = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rand = rng(seed);
      const count = 20 + Math.floor(rand() * 11);
      const planted = 1 + Math.floor(rand() * count);
      const specs: Spec[] = Array.from({ length: count }, () => {
        // 기준에서 1.2°~12° 떨어진 방향.
        const r = uniform(rand, 1.2, 12);
        const a = uniform(rand, 0, 2 * Math.PI);
        return { dir: { h: r * Math.cos(a), v: r * Math.sin(a) } };
      });
      specs[planted - 1] = { dir: { h: uniform(rand, -0.3, 0.3), v: uniform(rand, -0.3, 0.3) } };
      const res = await burst(specs).run();
      if (res.kind !== "picked" || numberOf(res.winner) !== planted || res.winner.verdict !== "close") wrong++;
    }
    expect(wrong).toBe(0);
  });

  it("모든 사진을 한 번씩 재고(훑기를 나누지 않는다), 고른 사진과 후보만 다시 잰다", async () => {
    const specs: Spec[] = Array.from({ length: 10 }, (_, i) => ({ dir: { h: i * 0.5, v: 0 } }));
    const b = burst(specs);
    const r = picked(await b.run());
    expect(b.calls.filter((c) => c.phase === "coarse").map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const again = b.calls.filter((c) => c.phase === "remeasure").map((c) => c.n);
    expect(again).toHaveLength(RULES.sampling.remeasureCount);
    expect(again[0]).toBe(1);
    expect(new Set(again).size).toBe(again.length);
    expect([r.winner, ...r.runnerUps].map(numberOf).sort((x, y) => x - y)).toEqual([...again].sort((x, y) => x - y));
  });

  it("진행률은 'N장 중 M장'을 만들 수 있게 본 수와 전체 수를 준다(읽지 못한 사진도 본 것으로 센다)", async () => {
    const b = burst([{ dir: { h: 0, v: 0 } }, null, { dir: { h: 5, v: 0 } }]);
    await b.run();
    expect(b.progress.filter((p) => p.phase === "coarse")).toEqual([
      { phase: "coarse", done: 1, total: 3 },
      { phase: "coarse", done: 2, total: 3 },
      { phase: "coarse", done: 3, total: 3 },
    ]);
    expect(b.progress.some((p) => p.phase === "fine")).toBe(false);
  });
});

describe("analyzePhotos — 후보와 동률", () => {
  it("후보 사이 간격은 '서로 다른 파일'이면 된다: 이웃한 순번도 후보가 된다", async () => {
    // 동영상이라면 0.3초 안이라 후보가 못 됐을 이웃 장면들.
    const specs: Spec[] = [{ dir: { h: 0.1, v: 0 } }, { dir: { h: 0.4, v: 0 } }, { dir: { h: 0.8, v: 0 } }, { dir: { h: 1.2, v: 0 } }];
    const r = picked(await burst(specs).run());
    expect(numberOf(r.winner)).toBe(1);
    expect(r.runnerUps.map(numberOf)).toEqual([2, 3, 4]);
    expect(r.runnerUps.every((c) => c.verdict === "close")).toBe(true);
  });

  it("후보는 최대 3장이고, 후보마다 가까움 판정이 따로 붙는다", async () => {
    const specs: Spec[] = [0.1, 1, 2.5, 4, 6, 8].map((h) => ({ dir: { h, v: 0 } }));
    const r = picked(await burst(specs).run());
    expect(r.runnerUps).toHaveLength(RULES.select.maxRunnerUps);
    expect(r.runnerUps.map((c) => c.verdict)).toEqual(["close", "close", "notClose"]);
  });

  it("똑같이 잰 사진이 둘이면 앞 순번을 고른다(동률의 '이른 시각'이 '앞 순번')", async () => {
    const same = { dir: { h: 0.5, v: 0 } };
    const r = picked(await burst([{ dir: { h: 6, v: 0 } }, same, same, same]).run());
    expect(numberOf(r.winner)).toBe(2);
    expect(r.runnerUps.map(numberOf).slice(0, 2)).toEqual([3, 4]);
  });

  it("점수 차 0.5 안에서는 더 선명한 사진을 고른다(동영상과 같은 규칙)", async () => {
    const r = picked(
      await burst([
        { dir: { h: 0.2, v: 0 }, sharpness: 100 },
        { dir: { h: 0.5, v: 0 }, sharpness: 160 },
        { dir: { h: 5, v: 0 }, sharpness: 100 },
      ]).run(),
    );
    expect(numberOf(r.winner)).toBe(2);
  });

  it("같은 측정값을 동영상 엔진에 시각으로 넣은 것과 1등·판정이 같다(같은 고르기 함수를 쓴다)", async () => {
    const dirs = [7, 3.2, 0.4, 2.1, 9, 1.4].map((h) => ({ h, v: 0.3 }));
    const photos = picked(await burst(dirs.map((dir) => ({ dir }))).run());
    // 초당 2장으로 훑는 3초 동영상: 시각 0, 0.5, …, 2.5 가 순번 1~6 과 같은 방향을 본다.
    const video = await analyze({
      reference: synthFace(),
      durationSec: 3,
      measureAt: async (t) => {
        const i = Math.round(t * 2);
        // 촘촘히 훑는 시각은 가장 가까운 거친 장면과 같은 방향으로 둔다(새 정보가 없게).
        return synthFrame({ timeSec: t, dir: dirs[Math.min(dirs.length - 1, Math.max(0, i))] });
      },
    });
    if (video.kind !== "picked") throw new Error("동영상 쪽이 고르지 못함");
    expect(photos.winner.comparison.angleDeg).toBeCloseTo(video.winner.comparison.angleDeg, 12);
    expect(photos.winner.verdict).toBe(video.winner.verdict);
    expect(numberOf(photos.winner)).toBe(3);
  });
});

describe("analyzePhotos — 나쁜 사진 빼기", () => {
  const others: Spec[] = Array.from({ length: 19 }, (_, i) => ({ dir: { h: 2 + i * 0.5, v: 0 } }));

  it("가장 가깝지만 흐린 사진은 고르지 않는다(X3: 그 묶음의 중앙값의 0.5배 미만)", async () => {
    const r = picked(await burst([{ dir: { h: 0.1, v: 0 }, sharpness: 30 }, ...others]).run());
    expect([r.winner, ...r.runnerUps].map(numberOf)).not.toContain(1);
    expect(numberOf(r.winner)).toBe(2);
    expect(r.excluded).toMatchObject({ X3: 1, total: 1 });
    expect(r.sharpnessBaseline).toBe(100);
  });

  it("가장 가깝지만 노출이 날아간 사진은 고르지 않는다(X4)", async () => {
    const r = picked(await burst([{ dir: { h: 0.1, v: 0 }, clipRatio: 0.2 }, ...others]).run());
    expect(numberOf(r.winner)).toBe(2);
    expect(r.excluded).toMatchObject({ X4: 1, total: 1 });
  });

  it("시드 200개: 가장 가까운 사진을 흐리게 또는 노출이 날아가게 심으면 고른 수 0", async () => {
    let chosen = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rand = rng(1000 + seed);
      const count = 20 + Math.floor(rand() * 11);
      const bad = 1 + Math.floor(rand() * count);
      const specs: Spec[] = Array.from({ length: count }, () => ({ dir: { h: uniform(rand, 1, 9), v: uniform(rand, -3, 3) } }));
      specs[bad - 1] = rand() < 0.5 ? { dir: { h: 0, v: 0 }, sharpness: 20 } : { dir: { h: 0, v: 0 }, clipRatio: 0.3 };
      const res = await burst(specs).run();
      if (res.kind !== "picked") continue;
      if ([res.winner, ...res.runnerUps].some((c) => numberOf(c) === bad)) chosen++;
    }
    expect(chosen).toBe(0);
  });

  it("X3 의 기준은 묶음 전체의 중앙값이다: 흐린 사진이 뒤쪽에만 있어도 걸린다", async () => {
    const specs: Spec[] = [...others.slice(0, 10), { dir: { h: 0.1, v: 0 }, sharpness: 40 }];
    const r = picked(await burst(specs).run());
    expect(numberOf(r.winner)).not.toBe(11);
    expect(r.excluded.X3).toBe(1);
  });

  it("얼굴이 없는 사진, 얼굴이 둘인 사진은 빼고 사유별로 센다", async () => {
    const r = picked(
      await burst([{ failure: "noFace" }, { failure: "multipleFaces" }, { dir: { h: 1, v: 0 } }, { dir: { h: 4, v: 0 } }]).run(),
    );
    expect(r.excluded).toMatchObject({ X1: 2, total: 2 });
    expect(r.multipleFaces).toBe(1);
    expect(numberOf(r.winner)).toBe(3);
    // 자취에는 얼굴을 읽은 사진만 들어간다.
    expect(r.trace.map((t) => t.timeSec)).toEqual([3, 4]);
  });

  it("쓸 수 있는 사진이 하나도 없으면 S4 로 멈추고 사유별 수가 남는다", async () => {
    const r = await burst([{ failure: "noFace" }, { dir: { h: 0, v: 0 }, clipRatio: 0.5 }]).run();
    expect(r).toMatchObject({ kind: "stopped", stop: "S4", excluded: { X1: 1, X4: 1, total: 2 } });
  });

  it("가까운 사진이 없으면 가장 가까운 사진을 고르되 판정은 '가까운 장면 없음'이다", async () => {
    const r = picked(await burst([{ dir: { h: 5, v: 0 } }, { dir: { h: 3.5, v: 0 } }, { dir: { h: 8, v: 0 } }]).run());
    expect(numberOf(r.winner)).toBe(2);
    expect(r.winner.verdict).toBe("notClose");
    expect([r.winner, ...r.runnerUps].some((c) => c.verdict === "close")).toBe(false);
  });
});

describe("analyzePhotos — 읽지 못한 파일", () => {
  it("읽지 못한 사진은 빼고 세며, 순번은 밀리지 않는다", async () => {
    const specs: Spec[] = [null, { dir: { h: 5, v: 0 } }, null, { dir: { h: 0.2, v: 0 } }, { dir: { h: 3, v: 0 } }];
    const r = picked(await burst(specs).run());
    expect(numberOf(r.winner)).toBe(4);
    expect(r.photos).toMatchObject({ count: 5, unreadable: 2 });
    expect(r.photos?.sizes).toEqual([null, SIZE, null, SIZE, SIZE]);
    expect(r.measured.coarse).toBe(3);
    // 읽지 못한 것은 "뺀 장면"(X1~X4)이 아니다. 따로 센다.
    expect(r.excluded.total).toBe(0);
  });

  it("한 장도 읽지 못하면 S6 으로 멈춘다(쓸 수 있는 사진 없음 S4 와 다르다)", async () => {
    const r = await burst([null, null, null]).run();
    expect(r).toMatchObject({ kind: "stopped", stop: "S6", photos: { count: 3, unreadable: 3, commonSize: null } });
  });

  it("볼 사진이 0장이어도 S6 이다", async () => {
    expect(await burst([]).run()).toMatchObject({ kind: "stopped", stop: "S6", photos: { count: 0, unreadable: 0 } });
  });

  it("다시 풀 때 읽지 못한 사진은 버리고 남은 후보에서 1등을 다시 정한다", async () => {
    const specs: Spec[] = [{ dir: { h: 0.1, v: 0 } }, { dir: { h: 1, v: 0 } }, { dir: { h: 6, v: 0 } }];
    let phase2 = false;
    const r = picked(
      await analyzePhotos({
        reference: synthFace(),
        count: 3,
        measurePhoto: async (n, phase) => {
          if (phase === "remeasure") phase2 = true;
          if (phase === "remeasure" && n === 1) return null;
          return { measured: synthFrame({ timeSec: n, ...specs[n - 1]! }), size: SIZE };
        },
      }),
    );
    expect(phase2).toBe(true);
    expect(numberOf(r.winner)).toBe(2);
    expect(r.remeasureDropped).toBe(1);
  });

  it("다시 잰 사진이 모두 버려지면 그다음 순위를 찾지 않고 S4 로 멈춘다", async () => {
    const r = await analyzePhotos({
      reference: synthFace(),
      count: 2,
      measurePhoto: async (n, phase) =>
        phase === "remeasure" ? null : { measured: synthFrame({ timeSec: n, dir: { h: n, v: 0 } }), size: SIZE },
    });
    expect(r).toMatchObject({ kind: "stopped", stop: "S4", remeasureDropped: 2 });
  });
});

describe("analyzePhotos — 장수 상한·크기·취소", () => {
  it("상한보다 많은 수를 넘겨도 60장까지만 잰다", async () => {
    const specs: Spec[] = Array.from({ length: 75 }, (_, i) => ({ dir: { h: 3 + i * 0.01, v: 0 } }));
    const b = burst(specs);
    const r = picked(await b.run());
    expect(b.calls.filter((c) => c.phase === "coarse")).toHaveLength(60);
    expect(r.photos?.count).toBe(60);
    expect(Math.max(...b.calls.map((c) => c.n))).toBe(60);
  });

  it("크기가 다른 사진이 섞이면 그 수와, 사진마다의 크기가 결과에 남는다", async () => {
    const small = { width: 3000, height: 2000 };
    const r = picked(await burst([{ dir: { h: 0, v: 0 } }, { dir: { h: 2, v: 0 }, photoSize: small }, { dir: { h: 4, v: 0 } }]).run());
    expect(r.photos).toMatchObject({ sizeMismatch: 1, commonSize: SIZE });
    expect(r.photos?.sizes[1]).toEqual(small);
  });

  it("취소하면 다음 사진을 풀기 전에 그만둔다", async () => {
    let seen = 0;
    const specs: Spec[] = Array.from({ length: 10 }, () => ({ dir: { h: 1, v: 0 } }));
    const b = burst(specs, { isCancelled: () => seen >= 3, onProgress: () => void seen++ });
    expect(await b.run()).toEqual({ kind: "cancelled" });
    expect(b.calls).toHaveLength(3);
  });

  it("사진을 풀다 난 예외(읽지 못함이 아닌 것)는 삼키지 않는다", async () => {
    await expect(
      analyzePhotos({
        reference: synthFace(),
        count: 2,
        measurePhoto: async () => {
          throw new Error("캔버스를 만들 수 없음");
        },
      }),
    ).rejects.toThrow("캔버스를 만들 수 없음");
  });

  it("장면 사이마다 화면에 차례를 넘긴다", async () => {
    let yields = 0;
    const b = burst([{ dir: { h: 0, v: 0 } }, { dir: { h: 1, v: 0 } }], { yieldToUi: async () => void yields++ });
    const r = picked(await b.run());
    expect(yields).toBe(2 + 1 + r.runnerUps.length);
  });
});

describe("사진 여러 장의 판정 맥락과 보정본 크기", () => {
  const reference = { faceCount: 1, face: synthFace(), faceFailure: null, sharpness: 100, skin: { meanLuma: 128, clipRatio: 0 } };
  const base = { reference, referenceOriginal: { width: 4000, height: 6000 } };

  it("보정본의 긴 변 상한은 4096px [가정]. 동영상의 1920px 은 그대로다", () => {
    expect(RULES.photos.outputMaxLongSidePx).toBe(4096);
    expect(RULES.output.maxLongSidePx).toBe(1920);
    expect(outputSize(base.referenceOriginal)).toEqual({ width: 1280, height: 1920 });
    expect(outputSize(base.referenceOriginal, RULES, RULES.photos.outputMaxLongSidePx)).toEqual({ width: 2731, height: 4096 });
    // 기준 사진이 상한보다 작으면 키우지 않는다.
    expect(outputSize({ width: 1500, height: 2000 }, RULES, 4096)).toEqual({ width: 1500, height: 2000 });
  });

  it("4096px 이면 어떤 화면비에서도 캔버스 한도(약 1,677만 화소) 안이다", () => {
    for (const ref of [
      { width: 6000, height: 4000 },
      { width: 6000, height: 6000 },
      { width: 4000, height: 6000 },
      { width: 8000, height: 4500 },
    ]) {
      const out = outputSize(ref, RULES, RULES.photos.outputMaxLongSidePx)!;
      expect(out.width * out.height).toBeLessThanOrEqual(16_777_216);
    }
  });

  it("맥락: 길이는 null 이라 60초 경고(W6)가 뜨지 않고, 크기는 그 후보 사진의 것이다", async () => {
    const r = picked(await burst([{ dir: { h: 0.5, v: 0 } }]).run());
    const ctx = photoJudgeContext(base, { width: 4000, height: 6000 });
    expect(ctx).toMatchObject({ videoDurationSec: null, outputMaxLongSidePx: 4096, videoNative: { width: 4000, height: 6000 } });
    const j = judgeCandidate(
      {
        face: r.winner.measurement.face,
        sharpness: r.winner.measurement.sharpness,
        meanLuma: 128,
        comparison: r.winner.comparison,
        remeasureShiftDeg: r.winner.remeasureShiftDeg,
      },
      ctx,
    );
    expect(j.numbers.videoDurationSec).toBeNull();
    expect(j.warnings).not.toContain("W6");
    expect(j.output?.size).toEqual({ width: 2731, height: 4096 });
    // 같은 파일을 다시 풀어 쟀으니 값이 같다: W5 가 없다.
    expect(r.winner.remeasureShiftDeg).toBe(0);
    expect(j.warnings).not.toContain("W5");
    // 기록에서 다시 판정해도 같다.
    expect(judge(j.numbers)).toEqual({ verdict: j.verdict, warnings: j.warnings });
  });

  it("가로 사진을 세로 기준 사진에 넣으면 방향이 다르다는 경고(W12)가 고른 사진 기준으로 뜬다", async () => {
    const r = picked(await burst([{ dir: { h: 0.5, v: 0 } }]).run());
    const input = {
      face: r.winner.measurement.face,
      sharpness: 100,
      meanLuma: 128,
      comparison: r.winner.comparison,
      remeasureShiftDeg: 0,
    };
    expect(judgeCandidate(input, photoJudgeContext(base, { width: 6000, height: 4000 })).warnings).toContain("W12");
    expect(judgeCandidate(input, photoJudgeContext(base, { width: 4000, height: 6000 })).warnings).not.toContain("W12");
  });
});

describe("사진 여러 장의 문장", () => {
  const numbers = {
    angleDeg: 4,
    mirroredAngleDeg: null,
    referenceOrientation: "portrait" as const,
    videoOrientation: "landscape" as const,
    roiEmptyFraction: 0.1,
    frameScale: 1,
    qualityScale: 1.5,
    sharpness: 10,
    referenceSharpness: 100,
    meanLuma: 100,
    referenceMeanLuma: 100,
    residual: 0,
    position: 0,
    remeasureShiftDeg: 2,
    videoDurationSec: null,
    referenceClipRatio: 0,
  };
  const ctx = { numbers, videoNative: SIZE, source: "photos" as const };

  it("경고 문장에 '동영상'이 나오지 않는다(W6 은 사진 묶음에서 뜨지 않으므로 뺀다)", () => {
    for (const code of ["W1", "W10", "W12", "W3", "W11", "W2", "W8", "W9", "W13", "W4", "W5", "W7"] as const) {
      expect(warningMessage(code, ctx)).not.toContain("동영상");
    }
    expect(warningMessage("W12", ctx)).toBe("기준 사진은 세로, 고른 사진은 가로입니다. 같은 방향으로 찍어 주세요.");
    expect(warningMessage("W2", ctx)).toContain("사진 6000×4000");
  });

  it("source 를 주지 않으면 동영상의 문장 그대로다", () => {
    const video = { numbers, videoNative: { width: 1080, height: 1920 } };
    expect(warningMessage("W12", video)).toContain("동영상은 가로입니다");
    expect(warningMessage("W2", video)).toContain("동영상 장면을 1.50배 늘려 그렸습니다(동영상 1080×1920)");
    expect(warningMessage("W3", video)).toContain("동영상에 찍히지 않아");
  });

  it("멈춤: 한 장도 읽지 못함(S6), 쓸 수 있는 사진 없음(S4)", () => {
    expect(stopMessage("S6")).toBe("고른 사진 가운데 이 브라우저에서 열 수 있는 것이 없습니다. JPEG로 저장한 사진을 골라 주세요.");
    const counts = { X1: 2, X2: 0, X3: 1, X4: 0, total: 3 };
    expect(stopMessage("S4", counts, 0, "photos")).toBe("쓸 수 있는 사진이 없습니다(얼굴 없음 2장, 흔들림 1장). 다시 찍어 주세요.");
    expect(stopMessage("S4", counts)).toBe("쓸 수 있는 장면이 없습니다(얼굴 없음 2장, 흔들림 1장). 다시 찍어 주세요.");
  });

  it("묶음 알림: 읽지 못한 사진은 'N장은 읽지 못해 뺐습니다'로 세어 보인다", () => {
    expect(photoSetNotices({ unreadable: 3, sizeMismatch: 0 }, 25, 25)).toEqual([
      "3장은 읽지 못해 뺐습니다. 이 브라우저가 열지 못하는 형식(RAW, HEIC 등)일 수 있습니다.",
    ]);
  });

  it("묶음 알림: 상한을 넘겨 보지 않은 사진, 크기가 다른 사진. 해당 없는 것은 적지 않는다", () => {
    expect(photoSetNotices({ unreadable: 0, sizeMismatch: 0 }, 25, 25)).toEqual([]);
    expect(photoSetNotices({ unreadable: 0, sizeMismatch: 0 }, 72, 60)).toEqual([
      "사진이 72장이라 파일 이름 순으로 앞 60장만 봤습니다.",
    ]);
    expect(photoSetNotices({ unreadable: 0, sizeMismatch: 2 }, 25, 25)).toEqual([
      "크기가 다른 사진이 2장 섞여 있습니다. 같은 설정으로 찍은 사진만 넣어 주세요.",
    ]);
    expect(photoSetNotices({ unreadable: 1, sizeMismatch: 1 }, 61, 60)).toHaveLength(3);
  });

  it("문장에 방향을 말하는 낱말과 코드가 없다", () => {
    const all = [
      stopMessage("S6"),
      stopMessage("S4", { X1: 1, X2: 1, X3: 1, X4: 1, total: 4 }, 1, "photos"),
      ...photoSetNotices({ unreadable: 1, sizeMismatch: 1 }, 61, 60),
    ].join(" ");
    expect(all).not.toMatch(/더 왼쪽|더 오른쪽|왼쪽으로|오른쪽으로/);
    expect(all).not.toMatch(/\b[WSX]\d+\b/);
  });
});
