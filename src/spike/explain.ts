/**
 * 실패 이유(원문 예외 문자열)를 점검하는 사람이 바로 따라 할 수 있는 한국어 한 줄로 바꾼다.
 *
 * 첫 실행에서 가장 흔할 실패는 카메라 권한 거부와 모델 파일 받기 실패인데, 화면에는
 * "NotAllowedError: The request is not allowed by the user agent…" 같은 영어 원문만 떴다.
 * 원문은 그대로 보고서(reason)와 화면의 '자세히'에 남기고, 여기서는 **무엇을 누르면 되는지**만
 * 덧붙인다. 모르는 오류는 null — 아는 척하지 않는다.
 *
 * 순수 함수(explain.test.ts). 섹션 번호와 버튼 이름은 점검 페이지의 실제 문구와 같아야 한다.
 */

interface Rule {
  test: RegExp;
  text: string;
}

/** 위에서부터 처음 맞는 규칙 하나. 구체적인 것(시간 초과·통신)을 GPU 같은 넓은 것보다 먼저 둔다. */
const RULES: Rule[] = [
  {
    // 8번 동작 센서: "권한: 동작 denied / 방향 …" (거부·예외 모두 이 머리말로 온다)
    test: /^권한: /,
    text:
      "동작 센서 권한이 거부됐습니다. 사파리를 앱 전환기에서 완전히 닫았다가 다시 열고 [동작 센서 허용]을 누르세요.",
  },
  {
    test: /NotAllowedError/,
    text:
      "카메라 권한이 꺼져 있습니다. 주소창의 aA → 웹사이트 설정 → 카메라를 '허용'으로 바꾸고(설정 앱 → Safari → 카메라도 확인), 이 페이지를 새로 고친 뒤 [카메라 켜기]를 다시 누르세요.",
  },
  {
    test: /NotFoundError|OverconstrainedError/,
    text: "후면 카메라를 찾지 못했습니다. 다른 앱이 카메라를 쓰고 있으면 닫고 [카메라 다시 켜기]를 누르세요.",
  },
  {
    test: /NotReadableError|TrackStartError/,
    text: "카메라를 열 수 없습니다. 카메라를 쓰는 다른 앱·탭(영상 통화 등)을 닫고 [카메라 다시 켜기]를 누르세요.",
  },
  {
    test: /SecurityError|mediaDevices|isSecureContext|보안 컨텍스트/,
    text: "HTTPS 주소가 아니라 카메라를 열 수 없습니다. HTTPS 로 배포한 주소의 /spike/ 로 여세요.",
  },
  {
    test: /모델 초기화: \d+초 안에 끝나지 않음/,
    text:
      "모델 파일(약 3.6MB)과 WASM(약 12MB)을 제시간에 받지 못했습니다. 와이파이를 확인하고 [모델 불러오기]를 다시 누르세요. 두 번째부터는 캐시로 빨라집니다.",
  },
  {
    test: /\d+초 안에 끝나지 않음/,
    text: "제시간에 끝나지 않았습니다. 와이파이를 확인하고 같은 버튼을 다시 누르세요.",
  },
  {
    test: /Load failed|Failed to fetch|NetworkError|network connection/i,
    text: "파일을 받지 못했습니다(통신). 와이파이를 확인하고 같은 버튼을 다시 누르세요.",
  },
  {
    test: /\bGPU\b|WebGL/i,
    text: "GPU 경로가 실패했습니다. 이것도 결과로 남습니다 — 2번은 CPU 로 바꿔 다시 불러오면 이어서 볼 수 있습니다.",
  },
];

export function explainFailure(reason: string | null | undefined): string | null {
  if (!reason) return null;
  for (const r of RULES) if (r.test.test(reason)) return r.text;
  return null;
}
