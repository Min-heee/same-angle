/**
 * 멈춘 이유를 쉬운 말로(PRD F20). 사유마다 문장과 다음 행동이 하나씩이다.
 *
 * 멈춤 코드(S1~S5)의 문장은 엔진(`messages.ts`)의 것을 그대로 쓴다 — 문장을 두 곳에 두지 않는다.
 * 여기서 더하는 것은 엔진이 모르는 두 가지다: 얼굴 모델을 받지 못함, 그 밖의 알 수 없는 오류.
 *
 * 방향을 말하는 문장("고개를 더 왼쪽으로")은 없다. 각도 부호를 실기기로 확정하기 전이다.
 *
 * 순수 함수다.
 */

import type { ExclusionCounts } from "../exclude";
import type { StopCode } from "../judge";
import type { FaceFailure } from "../measure";
import { stopMessage } from "../messages";
import type { SourceKind } from "../pipeline";

export type Failure =
  | {
      kind: "stop";
      code: StopCode;
      reason?: FaceFailure;
      excluded?: ExclusionCounts;
      /** `excluded.X1` 가운데 얼굴이 둘 이상이어서 뺀 장면 수. */
      multipleFaces?: number;
      detail?: string;
      /** 사진 여러 장에서 고르다 멈춘 것이면 "photos". 없으면 동영상. 문장과 다음 행동의 낱말이 달라진다. */
      source?: SourceKind;
    }
  /** 얼굴 모델(실행 파일·모델 파일)을 받거나 켜지 못함. */
  | { kind: "model"; detail: string }
  | { kind: "unknown"; detail: string };

/** 어느 단계에서 난 오류인가. 같은 예외라도 단계에 따라 뜻이 다르다. */
export type Stage = "reference" | "model" | "video" | "analysis" | "render" | "export";

export interface FailureText {
  /** 무슨 일이 있었는지 한 문장. */
  message: string;
  /** 다음에 할 일. 버튼 이름으로도 쓴다. */
  action: string;
  /** 덧붙이는 설명(없을 수 있음). */
  note: string | null;
  /** 개발자용 원문. 화면에서는 접어 둔다. */
  detail: string | null;
}

function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`.slice(0, 300);
  return String(e).slice(0, 300);
}

function errorName(e: unknown): string {
  return typeof e === "object" && e !== null && "name" in e ? String((e as { name: unknown }).name) : "";
}

/**
 * 던져진 예외를 멈춘 이유로 바꾼다.
 *
 * 접착부가 던지는 두 예외는 이름으로 알아본다(브라우저 모듈을 여기로 끌어오지 않으려는 것이다):
 * `ReferenceUnreadableError` → S5, `VideoUnreadableError` → S3.
 */
export function failureOf(e: unknown, stage: Stage): Failure {
  const name = errorName(e);
  const detail = errorText(e);
  if (name === "ReferenceUnreadableError") return { kind: "stop", code: "S5", detail };
  if (name === "VideoUnreadableError") return { kind: "stop", code: "S3", detail };
  if (stage === "model") return { kind: "model", detail };
  // 파일을 여는 단계에서 난 다른 예외도 "열 수 없음"이다. 지어낸 사유를 붙이지 않고 원문을 남긴다.
  if (stage === "reference") return { kind: "stop", code: "S5", detail };
  if (stage === "video") return { kind: "stop", code: "S3", detail };
  return { kind: "unknown", detail };
}

const ACTION: Record<StopCode, string> = {
  S1: "다른 사진 고르기",
  S2: "다른 사진 고르기",
  S3: "다른 동영상 고르기",
  S4: "다시 찍은 동영상 고르기",
  S5: "다른 사진 고르기",
  S6: "다른 사진들 고르기",
};

/** 사진 여러 장에서 고르다 "쓸 수 있는 사진 없음"으로 멈췄을 때의 다음 행동. */
const ACTION_S4_PHOTOS = "다시 찍은 사진들 고르기";

const REASON_NOTE: Partial<Record<FaceFailure, string>> = {
  matrixUnreadable: "얼굴은 찾았지만 얼굴의 방향을 읽지 못했습니다.",
  landmarksUnreadable: "얼굴은 찾았지만 얼굴의 점들을 읽지 못했습니다.",
};

const STOP_NOTE: Partial<Record<StopCode, string>> = {
  S1: "정수리·뒤통수처럼 얼굴이 보이지 않는 사진은 이 도구로 맞출 수 없습니다.",
  S3: "아이폰 기본 형식(HEVC)은 노트북 브라우저에서 열리지 않을 수 있습니다.",
  S5: "아이폰 기본 형식(HEIC)은 노트북 브라우저에서 열리지 않을 수 있습니다.",
  S6: "RAW 파일은 브라우저가 열지 못하고, HEIC 는 브라우저에 따라 열리지 않을 수 있습니다.",
};

/** 다른 얼굴이 함께 찍혀 빠진 장면이 있을 때 덧붙이는 설명(찍기 전 확인의 둘째 줄과 같은 내용). */
export const OTHER_FACE_NOTE =
  "다른 얼굴이 함께 찍힌 장면이 있습니다. 뒤에 선 사람, 거울, 포스터가 화면에 들어오지 않게 찍어 주세요.";

export function failureText(f: Failure): FailureText {
  switch (f.kind) {
    case "stop": {
      const multi = f.code === "S4" && (f.multipleFaces ?? 0) > 0 ? OTHER_FACE_NOTE : undefined;
      const note = (f.reason ? REASON_NOTE[f.reason] : undefined) ?? multi ?? STOP_NOTE[f.code] ?? null;
      return {
        message: stopMessage(f.code, f.excluded, f.multipleFaces, f.source),
        action: f.code === "S4" && f.source === "photos" ? ACTION_S4_PHOTOS : ACTION[f.code],
        note,
        detail: f.detail ?? null,
      };
    }
    case "model":
      return {
        message: "얼굴을 찾는 프로그램을 받지 못했습니다. 인터넷 연결을 확인하고 다시 해 주세요.",
        action: "다시 해 보기",
        note: "처음 한 번 약 16MB 를 받습니다. 사진과 동영상은 어디로도 보내지 않았습니다.",
        detail: f.detail,
      };
    case "unknown":
      return {
        message: "알 수 없는 문제로 멈췄습니다. 처음부터 다시 해 주세요.",
        action: "다시 해 보기",
        note: "사진과 동영상은 어디로도 보내지 않았습니다.",
        detail: f.detail,
      };
  }
}
