/**
 * 자세 픽스처 한 개를 만드는 순수 함수(점검 페이지 4번에서 부른다).
 *
 * 1초 동안 모은 행렬의 원소별 중앙값 → 배치 판별 → 분해. 이 픽스처가 D2 에서 부호·안내 방향
 * 테스트의 실제 데이터가 되므로, 배치를 "col" 로 고정하는 식의 결함은 여기서 테스트로 막는다
 * (fixture.test.ts).
 */

import { decompose, detectLayout, elementwiseMedian } from "@/core/matrix";
import type { FixtureName, FixtureRecord } from "@/core/report";
import { num } from "./util";

/**
 * 화면 라벨. 방향이 두 가지로 읽힐 수 있는 자세는 문장에 방향을 박는다(TECH-NOTES 5절 실측 픽스처).
 * '자기 왼쪽'·'오른쪽 귀'는 찍히는 사람 기준이다.
 */
export const FIXTURE_LABELS: Record<FixtureName, string> = {
  front: "정면",
  selfLeft20: "자기 왼쪽으로 약 20° 돌림",
  selfRight20: "자기 오른쪽으로 약 20° 돌림",
  chinDown: "숙임(턱을 가슴 쪽으로)",
  chinUp: "젖힘(턱을 들어)",
  tilt: "기울임(오른쪽 귀를 오른쪽 어깨 쪽으로)",
};

/** 1초에 이보다 적게 모이면 중앙값을 믿기 어렵다. [추론] 초깃값. */
export const MIN_FIXTURE_FRAMES = 5;

/**
 * 행렬 목록에서 픽스처를 만든다. 프레임이 모자라거나 비유한 값이 섞이면 예외(채워서 만들지 않는다).
 * 배치를 판별하지 못하면 layout·angles 는 null 로 명시한다.
 */
export function fixtureFromMatrices(
  name: FixtureName,
  mats: readonly (readonly number[])[],
  minFrames = MIN_FIXTURE_FRAMES,
): FixtureRecord {
  if (mats.length < minFrames) {
    throw new Error(`1초 동안 얼굴 1개 프레임이 ${mats.length}개뿐입니다(최소 ${minFrames}).`);
  }
  const med = elementwiseMedian(mats);
  if (!med) throw new Error("행렬 중앙값을 만들 수 없습니다(길이·비유한 값).");
  const layout = detectLayout(med);
  const dec = layout ? decompose(med, layout) : null;
  return {
    name,
    matrix: med,
    layout,
    angles: dec ? { yaw: num(dec.yaw, 3)!, pitch: num(dec.pitch, 3)!, roll: num(dec.roll, 3)! } : null,
    frames: mats.length,
  };
}
