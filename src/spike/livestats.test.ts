import { describe, expect, it } from "vitest";
import { MAX_GAP_MS, SNAPSHOT_MIN_FRAMES, checkRecording, summarizeLive } from "./livestats";

describe("summarizeLive", () => {
  it("fps 는 최근 5초 안의 프레임 수 ÷ 5초(버퍼 양 끝 사이가 아니다)", () => {
    // 8fps 로 10초: t = 0, 125, …, 9875. now = 10000.
    const ft = Array.from({ length: 80 }, (_, i) => i * 125);
    const s = summarizeLive(ft, [10, 20, 30], 80, 0, 10000);
    expect(s.fps).toBeCloseTo(8, 9); // 5000~9875 → 40개 / 5초
    expect(s.stale).toBe(false);
  });

  it("세대 시작 뒤 5초가 안 됐으면 경과 시간으로 나눈다", () => {
    const ft = [100, 200, 300, 400];
    const s = summarizeLive(ft, [], 4, 0, 500);
    expect(s.fps).toBeCloseTo(8, 9); // 4개 / 0.5초
    expect(s.snapshotReady).toBe(false);
  });

  it("마지막 프레임 뒤 1초가 넘으면 fps 는 null(프레임 안 옴)", () => {
    const s = summarizeLive([0, 100, 200], [5], 3, 0, 1300);
    expect(s.stale).toBe(true);
    expect(s.fps).toBeNull();
    expect(s.snapshotReady).toBe(false);
  });

  it("옛 엔진의 멈춘 시간이 섞이면 생기던 과소 추정이 없다(예시: 8fps)", () => {
    // 세대 교체 뒤 새 프레임 20개(2.5초)만 창에 있다.
    const ft = Array.from({ length: 20 }, (_, i) => 20000 + i * 125);
    const s = summarizeLive(ft, [], 20, 20000, 22500);
    expect(s.fps).toBeCloseTo(8, 9);
  });

  it(`스냅샷은 ${SNAPSHOT_MIN_FRAMES}프레임·5초가 모두 차야`, () => {
    const ft = Array.from({ length: 40 }, (_, i) => i * 125);
    expect(summarizeLive(ft, [], 40, 0, 5000).snapshotReady).toBe(true);
    expect(summarizeLive(ft, [], 29, 0, 5000).snapshotReady).toBe(false);
    expect(summarizeLive(ft, [], 40, 0, 4900).snapshotReady).toBe(false);
  });

  it("추론 시간은 최근 60개의 중앙값·p95", () => {
    const inf = Array.from({ length: 100 }, (_, i) => i); // 뒤 60개 = 40..99
    const s = summarizeLive([0], inf, 1, 0, 100);
    expect(s.inferN).toBe(60);
    expect(s.inferMedian).toBeCloseTo(69.5, 9);
  });
});

describe("checkRecording", () => {
  const base = { seconds: 30, fpsAtStart: 10, faceOptional: false };

  it("기대치 80% 이상·간격 500ms 이하·얼굴 50% 이상이면 통과", () => {
    const r = checkRecording({ ...base, frames: 280, valid: 270, intervals: [100, 120, 400] });
    expect(r.ok).toBe(true);
    expect(r.expectedFrames).toBe(300);
  });

  it("프레임이 기대치의 80% 미만이면 실패", () => {
    const r = checkRecording({ ...base, frames: 200, valid: 200, intervals: [100] });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("67%");
  });

  it(`최대 간격이 ${MAX_GAP_MS}ms 를 넘으면 실패(화면 꺼짐·멈춤)`, () => {
    const r = checkRecording({ ...base, frames: 290, valid: 290, intervals: [100, 8000] });
    expect(r.ok).toBe(false);
    expect(r.maxGapMs).toBe(8000);
  });

  it("얼굴 프레임이 절반 미만이면 실패, 얼굴 없는 뷰(정수리)는 메모만", () => {
    expect(checkRecording({ ...base, frames: 300, valid: 10, intervals: [100] }).ok).toBe(false);
    const crown = checkRecording({ ...base, faceOptional: true, frames: 300, valid: 0, intervals: [100] });
    expect(crown.ok).toBe(true);
    expect(crown.reason).toContain("얼굴 없는 뷰");
  });

  it("프레임 0개는 실패, 시작 fps 를 모르면 비율 검사는 건너뛰고 메모", () => {
    expect(checkRecording({ ...base, frames: 0, valid: 0, intervals: [] }).ok).toBe(false);
    const r = checkRecording({ ...base, fpsAtStart: null, frames: 50, valid: 50, intervals: [100] });
    expect(r.ok).toBe(true);
    expect(r.expectedFrames).toBeNull();
    expect(r.reason).toContain("fps");
  });
});
