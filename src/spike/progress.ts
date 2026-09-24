/**
 * 섹션별 "완료" 조건. 버튼 한 번 눌렀다고 초록이 되지 않게, 체크리스트 판정에 필요한 만큼
 * 모였을 때만 done 을 준다. 모자라면 무엇이 남았는지 한 줄로 알려 준다.
 *
 * 순수 함수(progress.test.ts).
 */

import { FIXTURE_NAMES, type FixtureName, type ManualChecks } from "@/core/report";

export interface Progress {
  done: boolean;
  /** 화면에 칩 옆으로 보이는 한 줄. 끝났으면 무엇을 채웠는지. */
  note: string;
}

/** 얼굴 인식: 서로 다른 엔진(방식·인원) 두 개 이상의 스냅샷, 각 MIN_SNAPSHOT_FRAMES 프레임 이상. */
export const MIN_SNAPSHOT_FRAMES = 30;
export const MIN_ENGINES = 2;

export function faceProgress(snaps: readonly { delegate: string; numFaces: number; frames: number }[]): Progress {
  const keys = new Set(snaps.filter((x) => x.frames >= MIN_SNAPSHOT_FRAMES).map((x) => `${x.delegate}/${x.numFaces}`));
  const n = keys.size;
  if (n >= MIN_ENGINES) return { done: true, note: `엔진 ${n}개 스냅샷(${[...keys].join(", ")})` };
  return {
    done: false,
    note: `스냅샷 엔진 ${n}/${MIN_ENGINES} — 방식·인원을 바꿔 [지금 성능 저장](각 ${MIN_SNAPSHOT_FRAMES}프레임 이상)`,
  };
}

export function fixturesProgress(names: readonly FixtureName[], labels: Record<FixtureName, string>): Progress {
  const have = new Set(names);
  const left = FIXTURE_NAMES.filter((n) => !have.has(n));
  if (left.length === 0) return { done: true, note: `픽스처 ${FIXTURE_NAMES.length}/${FIXTURE_NAMES.length}` };
  return {
    done: false,
    note: `픽스처 ${FIXTURE_NAMES.length - left.length}/${FIXTURE_NAMES.length} — ${left.map((n) => labels[n]).join(", ")} 남음`,
  };
}

/** 흔들림: 최소 조합은 한 손 × 정면·숙임·사선(실험 1, TECH-NOTES 6절 항목 6). */
export const JITTER_REQUIRED = [
  { hold: "oneHand", view: "front", label: "한 손·정면" },
  { hold: "oneHand", view: "down30", label: "한 손·숙임" },
  { hold: "oneHand", view: "oblique45", label: "한 손·사선" },
] as const;

export function jitterProgress(results: readonly { hold: string; view: string; ok: boolean }[]): Progress {
  const left = JITTER_REQUIRED.filter((r) => !results.some((x) => x.ok && x.hold === r.hold && x.view === r.view));
  if (left.length === 0) return { done: true, note: `최소 조합 ${JITTER_REQUIRED.length}/${JITTER_REQUIRED.length}` };
  return {
    done: false,
    note: `최소 조합 ${JITTER_REQUIRED.length - left.length}/${JITTER_REQUIRED.length} — ${left.map((r) => r.label).join(", ")} 남음`,
  };
}

export function shareProgress(m: ManualChecks): Progress {
  const left = [
    m.filesAppNamesKept === null ? "파일 앱 이름 보존" : null,
    m.longPressSaved === null ? "길게 눌러 저장" : null,
  ].filter((x): x is string => x !== null);
  if (left.length === 0) return { done: true, note: "수동 확인 2/2" };
  return { done: false, note: `수동 확인 ${2 - left.length}/2 — ${left.join(", ")} 결과를 고르세요` };
}

/** 폰 기울기: 두 조건(곧게, 오른쪽으로 약 15°)을 각각 한 번 이상. */
export const MOTION_CONDITIONS = [
  { id: "upright", label: "세로 곧게" },
  { id: "tiltRight15", label: "화면 위쪽을 오른쪽으로 약 15°(화면을 보는 사람 기준 시계 방향)" },
] as const;

export function motionProgress(conditions: readonly string[]): Progress {
  const left = MOTION_CONDITIONS.filter((c) => !conditions.includes(c.id));
  if (left.length === 0) return { done: true, note: `조건 ${MOTION_CONDITIONS.length}/${MOTION_CONDITIONS.length}` };
  return {
    done: false,
    note: `조건 ${MOTION_CONDITIONS.length - left.length}/${MOTION_CONDITIONS.length} — ${left.map((c) => c.label).join(", ")} 남음`,
  };
}
