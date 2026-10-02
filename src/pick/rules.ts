/**
 * 동영상에서 고르기(PRD v0.3 5절)의 규칙 상수. **한 곳에만 둔다**(F9).
 *
 * 여기 숫자는 전부 초깃값 [가정]이다. 실제 얼굴 동영상으로 잰 적이 없고, 확정은 PRD 7절의
 * 검증 뒤에 한다. 화면의 규칙표와 기록(JSON)의 `rules` 는 이 객체를 그대로 읽는다.
 *
 * 값을 바꾸면 RULES_VERSION 을 올린다. 기록에는 버전과 값이 함께 들어가므로, 예전 기록은
 * 그때의 경계값으로 다시 판정된다(record.ts).
 */

export const RULES_VERSION = "pick-0.3.0";

export const RULES = {
  /** 재는 방식. 기준 사진·모든 장면·다시 재기에 똑같이 쓴다. */
  measure: {
    /** 재는 캔버스의 긴 변(px). */
    longSidePx: 960,
    /** 얼굴 모델에 요청하는 얼굴 수. 둘 이상이면 X1/S2. */
    numFaces: 2,
    /** 선명도를 재려고 얼굴 박스를 다시 뽑는 긴 변(px). */
    sharpnessLongSidePx: 256,
    /** 노출·밝기를 재려고 피부 패치를 다시 뽑는 크기(px, 정사각형). */
    skinPatchPx: 128,
  },
  /** 장면 뽑기. */
  sampling: {
    /** 거친 훑기: 초당 장면 수. */
    coarsePerSec: 2,
    /** 빠른 답: 거친 훑기 최소 각도차가 이 값 이하면 "근처를 지나감". 최종 판정이 아니다. */
    quickAnswerDeg: 8,
    /** 촘촘히 훑을 곳의 최대 수. */
    fineWindows: 3,
    /** 촘촘히 훑을 곳 사이의 최소 간격(초). */
    fineWindowMinGapSec: 0.75,
    /** 촘촘히 훑기: 가운데에서 앞뒤로 보는 폭(초). */
    fineHalfWidthSec: 0.5,
    /** 촘촘히 훑기: 장면 간격(초). */
    fineStepSec: 1 / 15,
    /** 다시 재는 장면 수(1등 + 후보). */
    remeasureCount: 4,
    /** 이 길이를 넘으면 앞부분만 본다(초). */
    maxDurationSec: 60,
  },
  /** 후보에서 빼는 조건(X1~X4). */
  exclude: {
    /** X1: R/s 가 직교에서 이보다 많이 벗어나면 행렬을 읽을 수 없는 것으로 본다. */
    maxOrthoError: 0.01,
    /** X2: 얼굴 박스 짧은 변 ÷ 화면 짧은 변이 이 값 미만이면 너무 작다. */
    minFaceShortRatio: 0.2,
    /** X2: 가장자리 여백(화면 짧은 변에 대한 비율). */
    edgeMarginRatio: 0.02,
    /** X3: 선명도가 (거친 훑기 통과 장면 중앙값 × 이 값) 미만이면 흔들린 장면. */
    sharpnessMedianFactor: 0.5,
    /** X4: 피부 패치의 클리핑 비율이 이 값을 넘으면 노출 사고. */
    maxClipRatio: 0.05,
  },
  /** 점수 = 각도차 + rollPerDeg·|θ| + lnFrameScale·|ln f| + position·p. 작을수록 가깝다. */
  score: {
    rollPerDeg: 0.1,
    lnFrameScale: 5,
    position: 10,
  },
  /** 고르기. */
  select: {
    /** 가까움 판정: 각도차가 이 값 이하(반올림 전)면 "가까운 장면". */
    passDeg: 3,
    /** 1등 동률 폭: 통과 장면 가운데 (최소 점수 + 이 값) 이하에서는 가장 선명한 장면. */
    tieScoreBand: 0.5,
    /** 차점 후보끼리, 그리고 1등과의 최소 간격(초). */
    runnerUpMinGapSec: 0.3,
    /** 차점 후보 최대 수. */
    maxRunnerUps: 3,
  },
  /** 기준점 맞춤(닮음 변환)이 믿을 만하다고 보는 조건. */
  anchors: {
    minCount: 12,
    /** 퍼짐 Σr²(눈 사이 거리 단위)의 최솟값. */
    minSpread: 8,
  },
  /** 출력 틀과 관심 영역. */
  output: {
    /** 출력 긴 변의 상한(px). 기준 사진의 긴 변과 이 값 가운데 작은 쪽. */
    maxLongSidePx: 1920,
    /** 관심 영역: 기준 사진의 얼굴 박스를 위로 박스 높이의 이 배수만큼 넓힌다. */
    roiUp: 0.6,
    /** 좌우로 박스 폭의 이 배수만큼씩. */
    roiSide: 0.3,
    /** 아래로 박스 높이의 이 배수만큼. */
    roiDown: 0.1,
  },
  /** 경고 경계. */
  warn: {
    /** W2: 화질 배율 k 가 이 값을 넘으면. */
    maxQualityScale: 1.3,
    /** W11: 틀 배율 f 가 이 값을 넘거나 역수 미만이면. */
    maxFrameScale: 1.3,
    /** W3: 관심 영역의 빈 비율이 이 값을 넘으면. */
    maxRoiEmpty: 0.02,
    /** W4: 위치 차 p 가 이 값을 넘으면. */
    maxPosition: 0.05,
    /** W5: 다시 잰 보는 방향이 분석 때와 이 각(°)을 넘게 다르면. */
    maxRemeasureShiftDeg: 1,
    /** W8: 고른 장면의 선명도가 (기준 사진 × 이 값) 미만이면. */
    minSharpnessVsReference: 0.5,
    /** W9: 피부 패치 평균 휘도 차(0~255)가 이 값을 넘으면. */
    maxLumaDiff: 30,
    /** W13: 남는 오차(눈 사이 거리 대비)가 이 값을 넘으면. */
    maxResidual: 0.04,
    /** 한 번에 펼쳐 보이는 경고 수. 나머지는 접는다. */
    maxShown: 3,
  },
} as const;

/** 규칙 값의 모양. 기록을 다시 읽을 때는 그 기록에 적힌 값을 이 모양으로 넘긴다. */
export type Rules = {
  readonly [G in keyof typeof RULES]: { readonly [K in keyof (typeof RULES)[G]]: number };
};
