/**
 * 점검 페이지 섹션 목록: 번호·보고서 키·제목과, 상태를 색 말고 글자로도 읽히게 하는 표시.
 *
 * 하단 섹션 바와 섹션 끝의 "다음" 링크가 이 목록을 쓴다. 제목은 각 섹션 컴포넌트의
 * title 과 같아야 한다(nav.test.ts 가 소스에서 대조한다).
 *
 * 순수 모듈(브라우저 API 없음).
 */

import { SECTION_KEYS, type SectionKey, type SectionStatus } from "@/core/report";

export interface NavItem {
  no: number;
  /** 보고서 섹션 키. 12번(내보내기)은 보고서 섹션이 아니라 null. */
  key: SectionKey | null;
  title: string;
}

const TITLES: Record<SectionKey, string> = {
  env: "환경",
  camera: "카메라",
  face: "얼굴 인식",
  jitter: "흔들림(실험 1)",
  fixtures: "자세 픽스처",
  sameFrame: "같은 프레임 비교",
  takePhoto: "takePhoto 대 비디오 프레임",
  exif: "옛 사진(EXIF 회전)",
  motion: "폰 기울기",
  pixelCost: "픽셀 지표 비용",
  share: "공유 테스트",
  network: "네트워크",
};

export const EXPORT_NO = SECTION_KEYS.length;

export const SECTION_NAV: readonly NavItem[] = [
  ...SECTION_KEYS.map((key, no) => ({ no, key, title: TITLES[key] })),
  { no: EXPORT_NO, key: null, title: "결과 내보내기" },
];

/** 색에만 기대지 않게(WCAG 1.4.1) 칩에 붙이는 기호. 대기는 비워 둔다. */
export const STATUS_MARK: Record<SectionStatus, string> = {
  idle: "",
  running: "…",
  done: "✓",
  failed: "✕",
};

export const STATUS_WORD: Record<SectionStatus, string> = {
  idle: "대기",
  running: "진행 중",
  done: "완료",
  failed: "실패",
};

/** 화면 낭독기용 이름: "4번 자세 픽스처, 완료". 내보내기는 상태 없이. */
export function navLabel(item: NavItem, status: SectionStatus | null): string {
  return status === null ? `${item.no}번 ${item.title}` : `${item.no}번 ${item.title}, ${STATUS_WORD[status]}`;
}

/** 다음 섹션. 마지막이면 null. */
export function nextNav(no: number): NavItem | null {
  return SECTION_NAV.find((x) => x.no === no + 1) ?? null;
}
