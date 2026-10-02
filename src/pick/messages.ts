/**
 * 멈춤·경고·빠른 답의 문장(PRD 5절 표). 사유마다 문장이 하나씩이고, 한 곳에서 관리한다(F20).
 *
 * 화면에는 코드 없이 문장만 보인다. 코드는 기록과 규칙표에만 쓴다.
 *
 * **방향을 말하는 문장("고개를 더 왼쪽으로")은 없다.** 각도 부호를 실기기로 확정하기 전에는
 * 어느 쪽으로 빗나갔는지 말할 수 없다. 시험이 문장에 방향 낱말이 없는지 확인한다.
 *
 * 순수 함수다.
 */

import type { ExclusionCounts } from "./exclude";
import type { JudgeNumbers, Orientation, StopCode, WarningCode } from "./judge";
import type { FrameSize } from "./measure";
import type { PhotoSetSummary, SourceKind } from "./pipeline";
import type { QuickAnswer } from "./plan";
import { RULES, type Rules } from "./rules";

/** 결과 옆에 늘 보이는 문장 세 줄(PRD 5절). */
export const ALWAYS_SHOWN = [
  "각도·크기·위치가 가까워도 머리 젖음·빗질·조명이 다르면 비교가 어렵습니다. 이 도구는 그것을 보지 않습니다.",
  "크기는 맞췄지만 촬영 거리가 같았다는 뜻은 아닙니다.",
  "각도 값의 측정 오차는 아직 재지 않았습니다. '가까운 장면'은 비교해도 된다는 보증이 아닙니다.",
] as const;

/**
 * 각도 표기: 소수 첫째 자리까지. 기준값 근처(±0.05°)에서는 둘째 자리까지 보인다(F18).
 *
 * 3.04° 를 "3.0°" 로 적으면 "3.0° 인데 왜 가까운 장면이 아니냐"가 된다. 판정은 반올림 전 값으로
 * 하므로, 반올림해서 기준값과 같아 보이는 구간에서는 한 자리를 더 보여 준다. 둘째 자리에서도
 * 기준값과 같아 보이면(3.004°) 자리를 더 늘린다(최대 여섯째 자리).
 */
export function formatAngle(deg: number, thresholdDeg: number = RULES.select.passDeg): string {
  if (!Number.isFinite(deg)) return "—";
  if (Math.abs(deg - thresholdDeg) > 0.05) return `${deg.toFixed(1)}°`;
  for (let digits = 2; digits <= 6; digits++) {
    const s = deg.toFixed(digits);
    if (deg === thresholdDeg || Number(s) !== thresholdDeg) return `${s}°`;
  }
  return `${deg.toFixed(6)}°`;
}

/** 배율 표기: 소수 둘째 자리까지. */
export function formatRatio(v: number): string {
  return Number.isFinite(v) ? v.toFixed(2) : "—";
}

/** 비율(0~1)을 % 로. 소수 첫째 자리까지. */
export function formatPercent(fraction: number): string {
  return Number.isFinite(fraction) ? `${(fraction * 100).toFixed(1)}%` : "—";
}

/**
 * 뺀 장면 수를 사유별로 적은 한 줄. **0장인 사유는 적지 않는다.** 하나도 없으면 빈 문자열.
 *
 * X1 은 "얼굴 없음"과 "얼굴이 둘 이상"으로 나눠 적는다 — 뒤에 선 사람이나 거울 때문에 빠진 장면을
 * "얼굴 없음"이라고 하면 원인을 알 수 없다. `multipleFaces` 는 X1 에 이미 들어 있는 수다.
 */
export function exclusionSummary(c: ExclusionCounts, multipleFaces = 0): string {
  const multi = Math.min(Math.max(0, multipleFaces), c.X1);
  const parts: [string, number][] = [
    ["얼굴 없음", c.X1 - multi],
    ["얼굴이 둘 이상", multi],
    ["잘림·작음", c.X2],
    ["흔들림", c.X3],
    ["노출", c.X4],
  ];
  return parts
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${label} ${n}장`)
    .join(", ");
}

const ORIENTATION_LABEL: Record<Orientation, string> = { portrait: "세로", landscape: "가로", square: "정사각형" };

/**
 * 멈춤 문장. S4 는 뺀 장면 수가 있어야 완성된다(`multipleFaces` 는 그 가운데 얼굴이 둘 이상이던 수).
 * `source` 가 "photos" 면 S4 의 "장면"을 "사진"으로 말한다(사진 여러 장에서 고를 때, PRD v0.3.1).
 */
export function stopMessage(
  code: StopCode,
  excluded?: ExclusionCounts,
  multipleFaces = 0,
  source: SourceKind = "video",
): string {
  switch (code) {
    case "S1":
      return "이 사진에서는 얼굴이 보이지 않아 각도를 잴 수 없습니다. 얼굴이 보이는 사진을 골라 주세요.";
    case "S2":
      return "한 사람만 나온 사진을 골라 주세요.";
    case "S3":
      return "이 동영상은 이 브라우저에서 열 수 없습니다. 찍은 폰에서 열거나 다른 형식으로 찍어 주세요.";
    case "S4": {
      // PRD 문장의 세 사유(얼굴 없음·흔들림·노출)에 X2(잘림·작음)와 "얼굴이 둘 이상"을 더했다.
      // 빼면 합이 맞지 않고, 다른 얼굴이 함께 찍혀 멈춘 것을 알 수 없다.
      const summary = excluded ? exclusionSummary(excluded, multipleFaces) : "";
      const what = source === "photos" ? "사진" : "장면";
      return `쓸 수 있는 ${what}이 없습니다${summary ? `(${summary})` : ""}. 다시 찍어 주세요.`;
    }
    case "S5":
      return "이 사진은 이 브라우저에서 열 수 없습니다. 찍은 폰에서 열거나 JPEG로 저장해 주세요.";
    case "S6":
      return "고른 사진 가운데 이 브라우저에서 열 수 있는 것이 없습니다. JPEG로 저장한 사진을 골라 주세요.";
  }
}

export interface WarningContext {
  numbers: JudgeNumbers;
  /** 동영상의 원본 해상도. W2 문장에 들어간다. 사진 여러 장에서는 고른 사진의 원본 크기. */
  videoNative: FrameSize;
  /** 입력의 종류. 없으면 동영상. "photos" 면 문장의 "동영상"을 "사진"으로 말한다(조건은 같다). */
  source?: SourceKind;
}

/** 경고 문장. */
export function warningMessage(code: WarningCode, ctx: WarningContext, rules: Rules = RULES): string {
  const n = ctx.numbers;
  const photos = ctx.source === "photos";
  switch (code) {
    case "W1":
      return `가장 가까운 장면은 ${formatAngle(n.angleDeg, rules.select.passDeg)} 차이입니다. 다시 찍기를 권합니다.`;
    case "W10":
      return "반대쪽을 찍었거나 좌우가 뒤집힌 사진 같습니다.";
    case "W12":
      return `기준 사진은 ${ORIENTATION_LABEL[n.referenceOrientation]}, ${photos ? "고른 사진" : "동영상"}은 ${ORIENTATION_LABEL[n.videoOrientation]}입니다. 같은 방향으로 찍어 주세요.`;
    case "W3":
      return `머리 둘레 ${formatPercent(n.roiEmptyFraction ?? Number.NaN)}가 ${photos ? "사진" : "동영상"}에 찍히지 않아 비었습니다.`;
    case "W11":
      // f 는 기준 사진 ÷ 장면이다. 문장은 "장면이 기준 사진의 몇 배"라서 역수를 적는다.
      return `얼굴이 화면에서 차지하는 크기가 기준 사진의 ${formatRatio(1 / n.frameScale)}배입니다. 찍은 거리가 달랐을 수 있고, 그 차이(원근)는 맞추지 못합니다.`;
    case "W2":
      return photos
        ? `고른 사진을 ${formatRatio(n.qualityScale ?? Number.NaN)}배 늘려 그렸습니다(사진 ${ctx.videoNative.width}×${ctx.videoNative.height}). 흐려 보일 수 있습니다.`
        : `동영상 장면을 ${formatRatio(n.qualityScale ?? Number.NaN)}배 늘려 그렸습니다(동영상 ${ctx.videoNative.width}×${ctx.videoNative.height}). 흐려 보일 수 있습니다.`;
    case "W8":
      return photos
        ? "고른 사진이 기준 사진보다 흐립니다. 사진 묶음 전체가 흐리거나 화질이 낮을 수 있습니다. 흐린 사진은 숱이 달라 보일 수 있습니다."
        : "고른 장면이 기준 사진보다 흐립니다. 동영상 전체가 흐리거나 화질이 낮을 수 있습니다. 흐린 사진은 숱이 달라 보일 수 있습니다.";
    case "W9":
      return "기준 사진과 밝기가 다릅니다.";
    case "W13":
      return "맞춘 뒤에도 얼굴 점들이 어긋납니다. 각도나 표정이 다를 수 있습니다.";
    case "W4":
      return "얼굴이 화면에서 기준 사진과 다른 자리에 있습니다.";
    case "W5":
      return photos
        ? "고른 사진을 다시 풀어 쟀더니 값이 달라졌습니다. 다시 잰 값으로 판정했습니다."
        : "고른 장면을 다시 뽑았더니 값이 달라졌습니다. 다시 잰 값으로 판정했습니다.";
    case "W6":
      return `앞 ${rules.sampling.maxDurationSec}초만 봤습니다.`;
    case "W7":
      return "기준 사진이 너무 밝거나 어두워 비교가 어려울 수 있습니다.";
  }
}

/**
 * 사진 묶음에 대한 알림(PRD v0.3.1 5절). 경고 코드는 없고, 기록에는 장수로 남는다.
 *
 *  - 읽지 못해 뺀 사진이 있으면: "N장은 읽지 못해 뺐습니다."
 *  - 상한을 넘겨 보지 않은 사진이 있으면: "사진이 N장이라 파일 이름 순으로 앞 60장만 봤습니다."
 *  - 크기가 다른 사진이 섞였으면: "크기가 다른 사진이 N장 섞여 있습니다. …"
 *
 * 해당하지 않는 알림은 내지 않는다(0장이라고 적지 않는다).
 */
export function photoSetNotices(
  set: Pick<PhotoSetSummary, "unreadable" | "sizeMismatch">,
  selected: number,
  used: number,
  rules: Rules = RULES,
): string[] {
  const out: string[] = [];
  if (set.unreadable > 0) {
    out.push(`${set.unreadable}장은 읽지 못해 뺐습니다. 이 브라우저가 열지 못하는 형식(RAW, HEIC 등)일 수 있습니다.`);
  }
  if (selected > used) out.push(`사진이 ${selected}장이라 파일 이름 순으로 앞 ${used}장만 봤습니다.`);
  if (set.sizeMismatch > rules.photos.maxSizeMismatch) {
    out.push(`크기가 다른 사진이 ${set.sizeMismatch}장 섞여 있습니다. 같은 설정으로 찍은 사진만 넣어 주세요.`);
  }
  return out;
}

/** 빠른 답 문장. 최종 판정이 아니다. */
export function quickAnswerMessage(answer: QuickAnswer): string {
  return answer === "passedNear"
    ? "기준 자세 근처를 지나갔습니다. 자세히 보는 중입니다."
    : "기준 자세 근처를 지나가지 않은 것 같습니다. 끝까지 살펴봅니다.";
}

/** 경고를 펼쳐 보일 것과 접을 것으로 나눈다(표의 순서로 3개까지). */
export function splitWarnings(
  warnings: readonly WarningCode[],
  rules: Rules = RULES,
): { shown: WarningCode[]; folded: WarningCode[] } {
  return { shown: warnings.slice(0, rules.warn.maxShown), folded: warnings.slice(rules.warn.maxShown) };
}
