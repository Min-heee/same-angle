import { describe, expect, it } from "vitest";
import type { StopCode } from "../judge";
import { stopMessage } from "../messages";
import { OTHER_FACE_NOTE, failureOf, failureText, type Failure } from "./failure";
import { namedError } from "./fakes";

/*
 * 멈춘 이유마다 문장과 다음 행동이 하나씩 있다(F20). 멈춤 코드의 문장은 엔진의 것과 같아야 한다.
 */

const CODES: StopCode[] = ["S1", "S2", "S3", "S4", "S5"];
const DIRECTION_WORDS = /왼쪽|오른쪽|위로|아래로|좌측|우측/;

describe("failureText", () => {
  it.each(CODES)("%s: 엔진의 문장 그대로이고, 다음 행동이 있다", (code) => {
    const t = failureText({ kind: "stop", code });
    expect(t.message).toBe(stopMessage(code));
    expect(t.action.length).toBeGreaterThan(0);
  });

  it("S4 는 뺀 장면 수를 사유별로 적는다", () => {
    const t = failureText({ kind: "stop", code: "S4", excluded: { X1: 20, X2: 1, X3: 2, X4: 0, total: 23 } });
    expect(t.message).toContain("얼굴 없음 20장");
    expect(t.message).toContain("흔들림 2장");
    expect(t.action).toBe("다시 찍은 동영상 고르기");
  });

  it("S4: 다른 얼굴이 함께 찍혀 빠진 장면이 있으면 따로 세고, 할 일을 덧붙인다", () => {
    const excluded = { X1: 20, X2: 0, X3: 0, X4: 0, total: 20 };
    const t = failureText({ kind: "stop", code: "S4", excluded, multipleFaces: 12 });
    expect(t.message).toBe(stopMessage("S4", excluded, 12));
    expect(t.message).toContain("얼굴 없음 8장, 얼굴이 둘 이상 12장");
    expect(t.note).toBe(OTHER_FACE_NOTE);
    expect(t.note).not.toMatch(DIRECTION_WORDS);
    // 그런 장면이 없으면 덧붙이지 않는다. 다른 멈춤에는 붙지 않는다.
    expect(failureText({ kind: "stop", code: "S4", excluded, multipleFaces: 0 }).note).toBeNull();
    expect(failureText({ kind: "stop", code: "S4", excluded }).note).toBeNull();
    expect(failureText({ kind: "stop", code: "S3", multipleFaces: 3 }).note).not.toBe(OTHER_FACE_NOTE);
  });

  it("사유가 다르면 문장이 다르다(다섯 멈춤 + 모델 + 알 수 없음)", () => {
    const all: Failure[] = [
      ...CODES.map((code): Failure => ({ kind: "stop", code })),
      { kind: "model", detail: "x" },
      { kind: "unknown", detail: "x" },
    ];
    const messages = all.map((f) => failureText(f).message);
    expect(new Set(messages).size).toBe(all.length);
  });

  it("얼굴은 찾았지만 방향을 읽지 못한 기준 사진은 그 사실을 덧붙인다", () => {
    expect(failureText({ kind: "stop", code: "S1", reason: "matrixUnreadable" }).note).toContain("방향을 읽지 못했습니다");
    expect(failureText({ kind: "stop", code: "S1", reason: "noFace" }).note).toContain("정수리");
  });

  it("모델을 받지 못했을 때: 인터넷을 확인하라고 하고, 사진을 보내지 않았다고 말한다", () => {
    const t = failureText({ kind: "model", detail: "TypeError: Failed to fetch" });
    expect(t.message).toContain("인터넷");
    expect(t.note).toContain("어디로도 보내지 않았습니다");
    expect(t.detail).toBe("TypeError: Failed to fetch");
  });

  it("어느 문장에도 방향을 말하는 낱말이 없다(각도 부호 확정 전)", () => {
    const all: Failure[] = [
      ...CODES.map((code): Failure => ({ kind: "stop", code, reason: "landmarksUnreadable" })),
      { kind: "model", detail: "" },
      { kind: "unknown", detail: "" },
    ];
    for (const f of all) {
      const t = failureText(f);
      expect(`${t.message} ${t.action} ${t.note ?? ""}`).not.toMatch(DIRECTION_WORDS);
    }
  });
});

describe("failureOf — 예외를 멈춘 이유로", () => {
  it("접착부의 두 예외는 이름으로 알아본다", () => {
    expect(failureOf(namedError("ReferenceUnreadableError", "x"), "reference")).toMatchObject({ kind: "stop", code: "S5" });
    expect(failureOf(namedError("VideoUnreadableError", "x"), "video")).toMatchObject({ kind: "stop", code: "S3" });
    // 분석 도중 장면을 읽지 못한 것도 "동영상을 열 수 없음"이다.
    expect(failureOf(namedError("VideoUnreadableError", "x"), "analysis")).toMatchObject({ kind: "stop", code: "S3" });
  });

  it("모델 단계의 예외는 '모델을 받지 못함'이다", () => {
    expect(failureOf(new TypeError("Failed to fetch"), "model")).toEqual({
      kind: "model",
      detail: "TypeError: Failed to fetch",
    });
  });

  it("파일을 여는 단계의 다른 예외도 '열 수 없음'이고 원문이 남는다", () => {
    expect(failureOf(new Error("boom"), "reference")).toEqual({ kind: "stop", code: "S5", detail: "Error: boom" });
    expect(failureOf("문자열", "video")).toEqual({ kind: "stop", code: "S3", detail: "문자열" });
  });

  it("그 밖은 '알 수 없음'이고, 원문은 300자에서 자른다", () => {
    const f = failureOf(new Error("가".repeat(1000)), "analysis");
    expect(f.kind).toBe("unknown");
    expect(f.kind === "unknown" && f.detail.length).toBe(300);
  });
});
