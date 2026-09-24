import { describe, expect, it } from "vitest";
import { FIXTURE_LABELS } from "./fixture";
import { faceProgress, fixturesProgress, jitterProgress, motionProgress, shareProgress } from "./progress";

describe("섹션 완료 조건", () => {
  it("얼굴 인식: 서로 다른 엔진 2개, 각 30프레임 이상이어야 완료", () => {
    expect(faceProgress([]).done).toBe(false);
    expect(faceProgress([{ delegate: "CPU", numFaces: 2, frames: 40 }]).done).toBe(false);
    expect(
      faceProgress([
        { delegate: "CPU", numFaces: 2, frames: 40 },
        { delegate: "CPU", numFaces: 2, frames: 80 },
      ]).done,
    ).toBe(false); // 같은 엔진 두 번
    expect(
      faceProgress([
        { delegate: "CPU", numFaces: 2, frames: 40 },
        { delegate: "GPU", numFaces: 2, frames: 12 },
      ]).done,
    ).toBe(false); // 한쪽 프레임 부족
    expect(
      faceProgress([
        { delegate: "CPU", numFaces: 2, frames: 40 },
        { delegate: "CPU", numFaces: 1, frames: 30 },
      ]).done,
    ).toBe(true);
  });

  it("픽스처: 6/6 이어야 완료, 남은 자세 이름을 알려 준다", () => {
    const p = fixturesProgress(["front", "selfLeft20", "selfRight20", "chinDown"], FIXTURE_LABELS);
    expect(p.done).toBe(false);
    expect(p.note).toContain("4/6");
    expect(p.note).toContain(FIXTURE_LABELS.chinUp);
    expect(p.note).toContain(FIXTURE_LABELS.tilt);
    expect(
      fixturesProgress(["front", "selfLeft20", "selfRight20", "chinDown", "chinUp", "tilt"], FIXTURE_LABELS).done,
    ).toBe(true);
  });

  it("흔들림: 한 손 × 정면·숙임·사선이 모두 성공해야 완료(실패 기록은 세지 않는다)", () => {
    const ok = (view: string) => ({ hold: "oneHand", view, ok: true });
    expect(jitterProgress([ok("front"), ok("down30")]).done).toBe(false);
    expect(jitterProgress([ok("front"), ok("down30"), { hold: "oneHand", view: "oblique45", ok: false }]).done).toBe(false);
    expect(jitterProgress([ok("front"), ok("down30"), { hold: "fixed", view: "oblique45", ok: true }]).done).toBe(false);
    expect(jitterProgress([ok("front"), ok("down30"), ok("oblique45")]).done).toBe(true);
  });

  it("공유: 두 수동 확인에 모두 답해야 완료", () => {
    expect(shareProgress({ filesAppNamesKept: null, longPressSaved: null }).done).toBe(false);
    expect(shareProgress({ filesAppNamesKept: true, longPressSaved: null }).note).toContain("길게 눌러");
    expect(shareProgress({ filesAppNamesKept: false, longPressSaved: true }).done).toBe(true);
  });

  it("폰 기울기: 두 조건을 각각 한 번 이상", () => {
    expect(motionProgress(["upright"]).done).toBe(false);
    expect(motionProgress(["upright", "tiltRight15"]).done).toBe(true);
  });
});
