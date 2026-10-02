import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RULES } from "../rules";
import { SHOT_KINDS } from "../record";
import {
  CAMERA_SETTINGS,
  MOVE_RANGE,
  MOVE_STEPS,
  NOT_FOR,
  PRECHECK,
  SAY,
  SHOT_CAVEAT,
  SHOT_LABEL,
  VIDEO_LENGTH,
} from "./guide";

/*
 * 찍는 방법 안내는 PRD 3절·6절의 문장과 같아야 한다(F21). PRD 원문을 읽어 같은 문장이 있는지 본다.
 * PRD 를 고치고 화면을 안 고치면(또는 그 반대) 여기서 걸린다.
 */

const PRD = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/PRD.md"), "utf8");

/** PRD 에 그 문장이 있는가. 실패했을 때 PRD 전문이 쏟아지지 않게 참/거짓으로만 견준다. */
const inPrd = (text: string) => ({ text, found: PRD.includes(text) });
const found = (text: string) => ({ text, found: true });

describe("찍는 방법 안내 — PRD 와 같은 문장", () => {
  it.each(SHOT_KINDS)("%s: 읽어 줄 문장이 PRD 에 있다", (kind) => {
    expect(inPrd(SAY[kind].line)).toEqual(found(SAY[kind].line));
    expect(SHOT_LABEL[kind].length).toBeGreaterThan(0);
  });

  it("움직이는 순서 세 가지와 범위·속도가 PRD 에 있다", () => {
    expect(MOVE_STEPS).toHaveLength(3);
    for (const step of MOVE_STEPS) expect(inPrd(step)).toEqual(found(step));
    expect(inPrd(MOVE_RANGE)).toEqual(found(MOVE_RANGE));
    expect(inPrd(VIDEO_LENGTH)).toEqual(found(VIDEO_LENGTH));
  });

  it("찍기 전 확인 세 가지가 PRD 에 있다", () => {
    for (const line of PRECHECK) expect(inPrd(line)).toEqual(found(line));
  });

  it("이 방법을 쓰지 않는 경우(수술 직후 등)가 PRD 문장 그대로다", () => {
    // PRD 에서는 표의 칸이라 마침표가 없다.
    const cell = NOT_FOR.replace(/\.$/, "");
    expect(inPrd(cell)).toEqual(found(cell));
  });

  it("카메라 설정표의 다섯 줄이 PRD 6절 표와 같다", () => {
    expect(CAMERA_SETTINGS).toHaveLength(5);
    for (const row of CAMERA_SETTINGS) {
      const cell = `| ${row.setting} | ${row.recommend}`;
      expect(inPrd(cell)).toEqual(found(cell));
    }
  });

  it("정면만 조건 없이 다루고, 숙임·사선에는 '아직 확인하지 못했다'가 붙는다", () => {
    expect(SHOT_CAVEAT.front).toBeNull();
    for (const kind of ["frontDown", "leftOblique", "rightOblique"] as const) {
      expect(SHOT_CAVEAT[kind]).toContain("확인하지 못했습니다");
    }
  });

  it("안내의 3초 정지는 후보 간격보다 길다(정지 구간에서 후보가 나온다)", () => {
    expect(MOVE_STEPS[0]).toContain("3초");
    expect(3).toBeGreaterThan(RULES.select.runnerUpMinGapSec * RULES.select.maxRunnerUps);
  });
});
