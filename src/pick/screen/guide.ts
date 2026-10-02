/**
 * 찍는 방법 안내(PRD F21). 문장과 표를 **한 곳에서** 관리한다 — 화면은 여기 값만 그린다.
 *
 * 문장은 PRD 3절 "찍는 방법"과 6절 "카메라 설정"에서 옮겼고, 시험(guide.test.ts)이 PRD 원문에
 * 같은 문장이 있는지 확인한다. PRD 를 고치면 여기도 같이 고쳐야 시험이 통과한다.
 *
 * 전부 초안 [가정]이고 실제 동영상으로 다듬기 전이다. 아이폰 메뉴 이름은 실기기 확인 전이다.
 *
 * 순수 값이다.
 */

import type { ShotKind } from "../record";

export const SHOT_LABEL: Record<ShotKind, string> = {
  front: "정면",
  frontDown: "정면 숙임",
  leftOblique: "왼쪽 사선",
  rightOblique: "오른쪽 사선",
};

/** 조건부로만 다루는 사진(PRD 5절 "다루는 사진"). 정면은 null. */
export const SHOT_CAVEAT: Record<ShotKind, string | null> = {
  front: null,
  frontDown: "숙인 자세에서 얼굴 모델이 안정적으로 재는지는 아직 확인하지 못했습니다.",
  leftOblique: "사선에서는 먼 쪽 눈이 가려져 맞춤이 흔들릴 수 있습니다. 아직 확인하지 못했습니다.",
  rightOblique: "사선에서는 먼 쪽 눈이 가려져 맞춤이 흔들릴 수 있습니다. 아직 확인하지 못했습니다.",
};

/** 동영상에서 움직이는 순서(PRD 3절 표 "순서"). */
export const MOVE_STEPS = [
  "기준 자세로 3초 가만히",
  "그 자세 둘레에서 천천히 오른쪽·가운데·왼쪽·가운데",
  "턱을 살짝 들었다 가운데, 살짝 당겼다 가운데",
] as const;

/**
 * 범위와 속도(PRD 3절 표 "범위와 속도"). PRD 문장의 앞부분이다 — 뒤의 "(초당 10° 이하)"는 설계 쪽
 * 숫자라 화면에는 싣지 않는다. 촬영 담당에게는 "셋을 세는 동안 한쪽 끝까지"가 같은 말이다.
 */
export const MOVE_RANGE = "기준 자세에서 10° 안팎까지, 셋을 세는 동안 한쪽 끝까지";

/** 권장 길이(PRD 5절 "길이"). */
export const VIDEO_LENGTH = "10~15초";

const AROUND = "이어서 그 자세 둘레에서 같은 움직임.";

/** 찍히는 사람에게 읽어 줄 문장(PRD 3절 표의 정면·숙임·사선 행). */
export const SAY: Record<ShotKind, { line: string; then: string | null; note: string | null }> = {
  front: {
    line: "편하게 정면을 보고 그대로 계세요. (셋) 제가 셋 세는 동안 고개를 오른쪽으로 조금만, 다시 가운데. 왼쪽으로 조금만, 다시 가운데. 턱을 살짝 들었다 가운데, 살짝 당겼다 가운데.",
    then: null,
    note: null,
  },
  frontDown: {
    line: "턱을 당겨 고개를 숙이고, 눈은 편하게 아래를 보세요. 그대로 셋.",
    then: AROUND,
    note: "앞머리는 헤어밴드나 집게로 고정합니다(한 손으로 잡고 찍지 않기).",
  },
  leftOblique: {
    line: "몸은 그대로 두고 고개만 돌린 자세에서 그대로 셋.",
    then: AROUND,
    note: "왼쪽·오른쪽은 따로 찍습니다.",
  },
  rightOblique: {
    line: "몸은 그대로 두고 고개만 돌린 자세에서 그대로 셋.",
    then: AROUND,
    note: "왼쪽·오른쪽은 따로 찍습니다.",
  },
};

/** 폰과 화면(PRD 3절 표 "폰"·"화면"). */
export const PHONE_TIPS = [
  "거치대를 권합니다. 손으로 들면 두 손으로.",
  "지난번과 같은 자리(바닥 표시), 같은 렌즈(1×), 기준 사진과 같은 세로·가로 방향",
  "얼굴이 화면에서 차지하는 자리와 크기를 지난 사진과 비슷하게.",
] as const;

/** 찍기 전 확인(PRD 3절 표 "찍기 전 확인"). */
export const PRECHECK = [
  "마스크·손·머리카락이 얼굴을 가리지 않는가",
  "화면에 다른 얼굴(뒤에 선 사람, 거울, 포스터)이 없는가",
  "머리 상태(마른 머리, 같은 가르마)는 지난번과 같은가",
] as const;

/** 이 방법을 쓰지 않는 경우(PRD 3절 표). */
export const NOT_FOR =
  "수술 직후(부기·딱지·봉합), 목이 불편하거나 어지러운 환자는 고개를 움직이게 하지 않고 기존 방식으로 찍습니다.";

/** 카메라 설정(PRD 6절 표). 한 번만 하면 된다. */
export const CAMERA_SETTINGS: readonly { setting: string; recommend: string }[] = [
  { setting: "동영상 해상도", recommend: "1080p 30fps부터" },
  { setting: "HDR 비디오", recommend: "끔" },
  { setting: "형식", recommend: 'PC에서 분석하려면 "높은 호환성"' },
  { setting: "렌즈·방향", recommend: "1×, 기준 사진과 같은 세로·가로" },
  { setting: "노출·초점", recommend: "화면을 길게 눌러 고정" },
];

/** 찍은 동영상이 폰에 남는다는 고지(PRD 9절, F13). */
export const VIDEO_STAYS =
  "찍은 동영상은 소리와 함께 폰에 남습니다. 이 화면은 그 파일을 지울 수 없으니, 병원이 정한 대로 지우거나 보관해 주세요.";

// ---------------------------------------------------------------------------
// 연사로 찍을 때(PRD v0.3.1 3절 "연사로 찍을 때"). 실제 카메라로 찍어 보기 전의 초안 [가정]이다.

/** 권장 장수(PRD 3절 표 "무엇으로"). */
export const BURST_COUNT = "20~30장";

/** 무엇으로 어떻게(PRD 3절 표 "무엇으로"). */
export const BURST_HOW = "전용 카메라나 폰의 연사로, 고개를 천천히 움직이는 동안 20~30장을 찍습니다";

/** 언제 이쪽을 고르나(PRD 3절 표 "언제 이쪽을"). */
export const BURST_WHEN = "화질이 중요하면 이쪽을 고릅니다. 동영상의 한 장면은 사진보다 화소가 훨씬 적습니다";

/** 연사로 찍는 요령(PRD 3절 표 "움직임"·"설정"·"형식"). */
export const BURST_TIPS = [
  "기준 자세에서 두세 장 찍고, 그 자세 둘레에서 천천히 움직이는 동안 계속 찍습니다",
  "사진은 모두 같은 설정(같은 렌즈·같은 크기·같은 세로·가로)으로 찍습니다",
  "JPEG로 저장합니다. RAW는 열 수 없고, HEIC는 브라우저에 따라 열리지 않을 수 있습니다",
] as const;

/** 사진 파일 이름을 어디에 쓰는지(PRD F22, 5절 "기록에 남는 것"). */
export const BURST_NAMES_STAY =
  "파일 이름은 순서를 정하고 이 화면에 보이는 데만 씁니다. 저장하는 기록에는 넣지 않습니다.";
