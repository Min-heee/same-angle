import { describe, expect, it } from "vitest";
import { explainFailure } from "./explain";

describe("explainFailure", () => {
  it("카메라 권한 거부 → aA 웹사이트 설정 안내", () => {
    const t = explainFailure(
      "NotAllowedError: The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.",
    );
    expect(t).toMatch(/카메라 권한이 꺼져/);
    expect(t).toMatch(/aA → 웹사이트 설정 → 카메라/);
    expect(t).toMatch(/\[카메라 켜기\]/);
  });

  it("후면 카메라 없음·열 수 없음", () => {
    expect(explainFailure("OverconstrainedError: Invalid constraint")).toMatch(/후면 카메라를 찾지/);
    expect(explainFailure("NotFoundError: Requested device not found")).toMatch(/후면 카메라를 찾지/);
    expect(explainFailure("NotReadableError: Could not start video source")).toMatch(/다른 앱·탭/);
  });

  it("HTTPS 가 아니라 mediaDevices 가 없을 때", () => {
    expect(explainFailure("TypeError: undefined is not an object (evaluating 'navigator.mediaDevices.getUserMedia')")).toMatch(
      /HTTPS/,
    );
  });

  it("모델 초기화 시간 초과는 통신 일반보다 먼저, 크기와 함께", () => {
    const t = explainFailure("Error: 모델 초기화: 60초 안에 끝나지 않음");
    expect(t).toMatch(/모델 파일\(약 3\.6MB\)과 WASM\(약 12MB\)/);
    expect(t).toMatch(/\[모델 불러오기\]/);
    expect(explainFailure("Error: 모듈 import: 30초 안에 끝나지 않음")).toMatch(/제시간에 끝나지/);
  });

  it("통신 실패(사파리 'Load failed', 크롬 'Failed to fetch')", () => {
    expect(explainFailure("TypeError: Load failed")).toMatch(/통신/);
    expect(explainFailure("TypeError: Failed to fetch")).toMatch(/통신/);
  });

  it("GPU 실패는 결과로 남는다고 알린다", () => {
    expect(explainFailure("IMAGE_GPU: Error: WebGL context lost")).toMatch(/GPU 경로가 실패/);
  });

  it("동작 센서 권한 거부는 카메라 문구가 아니라 센서 문구", () => {
    const t = explainFailure("권한: 동작 실패 NotAllowedError: denied / 방향 denied");
    expect(t).toMatch(/동작 센서 권한/);
    expect(t).not.toMatch(/카메라/);
  });

  it("모르는 오류·빈 값은 null(아는 척하지 않는다)", () => {
    expect(explainFailure("RangeError: 표본 3번이 유한한 수가 아닙니다.")).toBeNull();
    expect(explainFailure(null)).toBeNull();
    expect(explainFailure("")).toBeNull();
  });
});
