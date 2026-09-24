/**
 * 네트워크 가드: 허용 목록 밖으로 가는 fetch 를 기기 안에서 막고, 시도한 횟수만 센다.
 *
 * 왜 필요한가: `@mediapipe/tasks-vision` 1.0.1 은 createFromOptions 마다 사용 통계 로거를
 * 만들고, 60초마다·엔진을 닫을 때 https://odml.pa.googleapis.com/v1/log 로 POST 한다
 * (플랫폼·버전·과제 종류·실행 모드·초기화/추론 지연. 끄는 옵션 없음. 패키지 README
 * "Privacy Notice"). 같은각도의 약속은 "모델 파일 받기 말고는 네트워크로 나가지 않는다"이다.
 *
 * 두 겹으로 막는다.
 *  1. 배포본: vercel.json 의 강제 CSP `connect-src 'self' https://storage.googleapis.com/mediapipe-models/`.
 *  2. 이 가드: `npm run dev` 에는 헤더가 없고, CSP 가 사파리에서 실제로 강제되는지는 D1 전까지
 *     미확인이다. 그래서 window.fetch 를 감싸 허용 목록 밖 요청을 보내기 전에 거부한다.
 *     로거는 fetch 예외를 잡으면 오류 상태로 바꾸고 주기 전송을 스스로 멈춘다(vision_bundle.mjs).
 *
 * 한계: fetch 만 감싼다. XMLHttpRequest·sendBeacon·이미지 요청은 CSP(connect-src·img-src)와
 * 웹 인스펙터 기록이 맡는다. MediaPipe 1.0.1 의 네트워크 호출은 fetch 뿐이다(번들 확인).
 *
 * 순수 함수(isAllowedUrl·addBlocked)는 node 테스트로 고정하고(netguard.test.ts), 허용 목록은
 * vercel.json 의 connect-src 와 같은지 csp.test.ts 가 확인한다.
 */

/**
 * 자기 출처 말고 허용하는 원격 주소(경로 앞부분까지). vercel.json connect-src 와 같아야 한다(csp.test.ts).
 *
 * 출처(https://storage.googleapis.com) 전체가 아니라 모델 버킷 경로까지 좁힌다. 그 호스트는
 * 누구의 버킷에든 업로드를 받으므로, 출처만 허용하면 "모델 받기만 허용"이 아니라
 * "Google 저장소 어디로든 보내기 허용"이 된다. CSP 도 같은 경로 출처 식을 쓴다(CSP 2 경로 매칭).
 */
export const ALLOWED_REMOTE_PREFIXES = ["https://storage.googleapis.com/mediapipe-models/"] as const;

/** 원격 허용 주소들의 출처(출처 목록 표시용). */
export const ALLOWED_REMOTE_ORIGINS = ALLOWED_REMOTE_PREFIXES.map((p) => new URL(p).origin);

/**
 * 이 URL 로 fetch 해도 되는가. 상대 경로는 selfOrigin 기준으로 푼다.
 * http(s) 가 아닌 스킴(data:·blob: 등)은 CSP connect-src 'self' 와 같게 막는다.
 * 원격은 출처가 같고 **정규화한 경로**가 허용 경로로 시작해야 한다(`..` 로 버킷을 빠져나가지 못하게).
 */
export function isAllowedUrl(url: string, selfOrigin: string): boolean {
  let u: URL;
  try {
    u = new URL(url, selfOrigin);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.origin === selfOrigin) return true;
  return ALLOWED_REMOTE_PREFIXES.some((p) => {
    const allowed = new URL(p);
    return u.origin === allowed.origin && u.pathname.startsWith(allowed.pathname);
  });
}

/** 보고서에 남기는 차단 기록: 출처·메서드·횟수만(경로·본문·헤더는 남기지 않는다). */
export interface BlockedRecord {
  origin: string;
  method: string;
  count: number;
}

export const MAX_BLOCKED_KINDS = 20;

/** 같은 (출처, 메서드)는 횟수만 올린다. 종류는 MAX_BLOCKED_KINDS 개까지. */
export function addBlocked(list: readonly BlockedRecord[], origin: string, method: string): BlockedRecord[] {
  const m = method.toUpperCase();
  const i = list.findIndex((r) => r.origin === origin && r.method === m);
  if (i >= 0) return list.map((r, j) => (j === i ? { ...r, count: r.count + 1 } : r));
  if (list.length >= MAX_BLOCKED_KINDS) return [...list];
  return [...list, { origin, method: m, count: 1 }];
}

/** 경로를 남기지 않도록 출처만. 해석할 수 없으면 스킴까지만. */
export function originOf(url: string, selfOrigin: string): string {
  try {
    const u = new URL(url, selfOrigin);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : u.protocol;
  } catch {
    return "(해석 불가)";
  }
}

// --------------------------------------------------------------------------
// 브라우저 쪽. 모듈 최상단에서는 아무것도 하지 않는다(정적 내보내기 프리렌더).

let blocked: BlockedRecord[] = [];
let originalFetch: typeof fetch | null = null;

/** 지금까지 막은 요청 기록(복사본). */
export function blockedRequests(): BlockedRecord[] {
  return blocked.map((r) => ({ ...r }));
}

/** 가드가 설치됐는가. */
export function fetchGuardInstalled(): boolean {
  return originalFetch !== null;
}

/**
 * window.fetch 를 감싼다. 여러 번 불러도 한 번만 감싼다. MediaPipe 를 import 하기 전에 부른다.
 */
export function installFetchGuard(): void {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  if (originalFetch) return;
  const orig = window.fetch.bind(window);
  originalFetch = orig;
  const guarded: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
    const self = window.location.origin;
    if (!isAllowedUrl(url, self)) {
      blocked = addBlocked(blocked, originOf(url, self), method);
      return Promise.reject(new TypeError(`same-angle 네트워크 가드: 허용 목록 밖 요청을 막았습니다(${originOf(url, self)})`));
    }
    return orig(input, init);
  };
  window.fetch = guarded;
}

export interface CspProbeResult {
  /** 탐침을 보냈는가(fetch 가 없으면 false). 가드가 있으면 가드를 거치지 않은 원래 fetch 로 보낸다. */
  ran: boolean;
  rejected: boolean;
  error: string | null;
  /** 이 탐침에 대해 disposition 'enforce' 인 connect-src 위반 이벤트가 왔는가. */
  enforceViolation: boolean;
  /** Report-Only 위반 이벤트가 왔는가. */
  reportOnlyViolation: boolean;
}

/** 탐침 주소: 루프백이라 CSP 가 막지 못해도 기기 밖으로 나가지 않는다(연결 거부로 끝난다). */
export const CSP_PROBE_URL = "https://127.0.0.1:9/same-angle-csp-probe";

type Violation = { directive: string; blocked: string; disposition: string };

/**
 * 강제 CSP 가 실제로 connect-src 를 막는지 본다. 가드를 우회해 원래 fetch 로 루프백 주소를
 * 부르고, layout.tsx 의 수집기가 쌓은 위반 이벤트에서 이 주소의 'enforce' 기록을 찾는다.
 * dev 서버(헤더 없음)에서는 enforceViolation 이 false 인 것이 정상이다.
 */
export async function probeCsp(): Promise<CspProbeResult> {
  const f = originalFetch ?? (typeof window !== "undefined" ? window.fetch.bind(window) : null);
  if (!f) return { ran: false, rejected: false, error: "fetch 없음", enforceViolation: false, reportOnlyViolation: false };
  let rejected = false;
  let error: string | null = null;
  try {
    await f(CSP_PROBE_URL, { method: "GET", cache: "no-store" });
  } catch (e) {
    rejected = true;
    error = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : String(e).slice(0, 200);
  }
  // 위반 이벤트는 비동기로 온다.
  await new Promise((r) => setTimeout(r, 300));
  const list = (window as unknown as { __cspViolations?: Violation[] }).__cspViolations ?? [];
  const mine = list.filter((v) => v.blocked.includes("127.0.0.1") && v.directive.startsWith("connect-src"));
  return {
    ran: true,
    rejected,
    error,
    enforceViolation: mine.some((v) => v.disposition === "enforce"),
    reportOnlyViolation: mine.some((v) => v.disposition === "report"),
  };
}
