/**
 * 점검 결과 임시 저장(localStorage). 순수 부분만 여기 두고 node 테스트로 고정한다(draft.test.ts).
 *
 * 왜: 결과는 React 상태에만 있고 내보내기는 마지막 12번뿐이었다. 아이폰에서는 점검 중에 탭이
 * 다시 열리기 쉽다(10번은 파일 앱으로, 7번은 사진 선택기로 사파리를 떠나고, 메모리 압박도 크다).
 * 사파리가 백그라운드 탭을 버렸다 다시 열면 30분 치 측정이 사라진다.
 *
 * 저장하는 것은 보고서와 같은 모양(섹션 결과·픽스처·수동 확인)뿐이고 이미지·랜드마크는 없다.
 * 읽을 때도 보고서 검사기를 그대로 통과해야 복원한다 — 검사에 걸리는 초안은 버린다.
 */

import {
  SECTION_KEYS,
  validateReport,
  type FixtureRecord,
  type ManualChecks,
  type SectionKey,
  type SectionResult,
} from "@/core/report";

export const DRAFT_KEY = "same-angle-d1-draft";
export const DRAFT_VERSION = 1;

export interface Draft {
  savedAt: string;
  sections: Record<SectionKey, SectionResult>;
  fixtures: FixtureRecord[];
  manualChecks: ManualChecks;
}

export function serializeDraft(d: Draft): string {
  return JSON.stringify({ draftVersion: DRAFT_VERSION, ...d });
}

/** 다시 열렸을 때 '진행' 중이던 섹션은 끝나지 않은 것이므로 실패로 바꾸고 이유를 적는다. */
export const INTERRUPTED_REASON = "페이지가 다시 열려 진행 중이던 기록이 끊겼습니다 — 이 섹션을 다시 하세요.";

/**
 * 저장된 문자열을 읽는다. 형식이 틀리거나 보고서 검사를 통과하지 못하면 null(채워서 살리지 않는다).
 * 'running' 섹션은 'failed' 로 바꾼다.
 */
export function parseDraft(text: string | null): Draft | null {
  if (!text) return null;
  let x: unknown;
  try {
    x = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (o.draftVersion !== DRAFT_VERSION || typeof o.savedAt !== "string" || Number.isNaN(Date.parse(o.savedAt))) return null;
  const v = validateReport({
    kind: "same-angle-d1-report",
    version: 1,
    createdAt: new Date(0).toISOString(),
    device: { userAgent: "", screenWidth: 0, screenHeight: 0, devicePixelRatio: 1 },
    sections: o.sections,
    fixtures: o.fixtures,
    manualChecks: o.manualChecks,
  });
  if (!v.ok) return null;
  const sections = { ...v.report.sections };
  for (const k of SECTION_KEYS) {
    if (sections[k].status === "running") sections[k] = { ...sections[k], status: "failed", reason: INTERRUPTED_REASON };
  }
  return { savedAt: o.savedAt, sections, fixtures: v.report.fixtures, manualChecks: v.report.manualChecks };
}

/** 섹션 데이터에서 배열 필드 하나를 꺼낸다(복원한 목록으로 화면 상태를 시작할 때). 없으면 빈 배열. */
export function restoredList<T>(data: unknown, field: string): T[] {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return [];
  const v = (data as Record<string, unknown>)[field];
  return Array.isArray(v) ? (v as T[]) : [];
}
