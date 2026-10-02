/**
 * 내보내기의 이름과 표기(PRD F19): 파일 이름, 저장 이미지 아래 띠의 글자, 띠의 크기.
 *
 *  - 파일 이름에 사진 종류·날짜·사용자가 넣은 짧은 메모가 붙는다.
 *  - 저장 이미지 **아래에 덧붙인 띠**에 "내부 기록용 · 광고·홍보 사용 금지"와 보정 여부를 새기고,
 *    통과 기준을 넘은 장면이면 그 표시도 새긴다. 띠는 사진 밑에 따로 붙어 사진 영역을 가리지 않는다.
 *  - 띠는 잘라내면 사라지는 신호일 뿐이다(PRD 9절 "광고 오용"). 그래서 같은 사실이 기록에도 남는다.
 *
 * 순수 함수다. 캔버스에 그리는 일은 `browser.ts` 가 여기 숫자와 글자를 받아서 한다.
 */

import type { ShotKind } from "../record";
import { formatAngle } from "../messages";
import { RULES, type Rules } from "../rules";
import type { Verdict } from "../select";
import { SHOT_LABEL } from "./guide";

/** 띠의 첫 줄. 저장 이미지마다 늘 들어간다(PRD F19). */
export const BAND_NOTICE = "내부 기록용 · 광고·홍보 사용 금지";

/** 파일 이름에 붙는 메모의 최대 길이(글자). */
export const MEMO_IN_NAME_MAX = 24;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** YYYYMMDD-HHmm (기기 현지 시각). */
export function dateStamp(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
}

/** YYYY-MM-DD (기기 현지 시각). 띠에 적는다. */
export function dateLabel(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * 메모를 파일 이름에 붙일 수 있는 꼴로. 경로·예약 문자·제어 문자·점을 빼고 공백은 `-` 로 바꾼다.
 * 비면 빈 문자열(이름에 붙이지 않는다).
 */
export function memoForName(memo: string): string {
  const cleaned = memo
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/:*?"<>|.#%&{}$!'`@+=^~]/g, " ")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return [...cleaned].slice(0, MEMO_IN_NAME_MAX).join("").replace(/-+$/g, "");
}

export interface ExportNames {
  corrected: string;
  original: string;
  record: string;
}

/** 같은각도_정면_20261002-1430[_메모]_보정본.png … */
export function exportNames(input: { shotKind: ShotKind; date: Date; memo: string }): ExportNames {
  const memo = memoForName(input.memo);
  const base = ["같은각도", SHOT_LABEL[input.shotKind].replace(/\s+/g, ""), dateStamp(input.date), memo]
    .filter((p) => p !== "")
    .join("_");
  return { corrected: `${base}_보정본.png`, original: `${base}_원본장면.png`, record: `${base}_기록.json` };
}

export interface BandInput {
  kind: "corrected" | "original";
  /** 저장하는 장면의 판정. */
  verdict: Verdict;
  /** 1등조차 통과 기준을 넘었는가(동영상 전체에 가까운 장면이 없는가). */
  noCloseScene: boolean;
  angleDeg: number;
  shotKind: ShotKind;
  date: Date;
  rules?: Rules;
}

/** 통과 기준을 넘은 장면에 새기는 표시. 가까운 장면이면 null. */
export function notCloseMark(verdict: Verdict, noCloseScene: boolean, angleDeg: number, rules: Rules = RULES): string | null {
  if (verdict === "close") return null;
  const pass = rules.select.passDeg;
  const head = noCloseScene ? "가까운 장면 없음" : "가까운 장면 아님";
  return `${head} · 각도 차 ${formatAngle(angleDeg, pass)}(통과 기준 ${pass}° 넘음)`;
}

/** 띠에 새길 줄들. 위에서 아래로. */
export function bandLines(input: BandInput): string[] {
  const lines = [BAND_NOTICE];
  lines.push(
    input.kind === "corrected"
      ? "보정본: 기울기·크기·위치 맞춤(회전·확대·이동만)"
      : "원본 장면: 동영상의 한 장면 그대로(보정 없음)",
  );
  const mark = notCloseMark(input.verdict, input.noCloseScene, input.angleDeg, input.rules);
  if (mark !== null) lines.push(mark);
  lines.push(`같은각도 · ${SHOT_LABEL[input.shotKind]} · ${dateLabel(input.date)}`);
  return lines;
}

export interface BandLayout {
  /** 띠의 높이(px). 사진 높이에 더해진다. */
  height: number;
  fontPx: number;
  lineHeight: number;
  paddingX: number;
  paddingY: number;
}

/** 이미지 폭과 줄 수에서 띠의 크기를 정한다. 작은 이미지에서도 글자가 읽히게 아래 한도를 둔다. */
export function bandLayout(imageWidth: number, lineCount: number): BandLayout {
  const fontPx = Math.max(14, Math.round(imageWidth / 40));
  const lineHeight = Math.round(fontPx * 1.45);
  const paddingY = Math.round(fontPx * 0.7);
  const paddingX = Math.round(fontPx * 0.9);
  return { height: paddingY * 2 + lineHeight * Math.max(1, lineCount), fontPx, lineHeight, paddingX, paddingY };
}

/** 기록의 메모 칸에 넣을 값. 앞뒤 공백을 떼고, 비면 null(빈 문자열로 채우지 않는다). */
export function memoForRecord(memo: string): string | null {
  const t = memo.trim();
  return t === "" ? null : t;
}
