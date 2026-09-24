import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// 로컬 미리보기(serve-out)와 같은 규칙 해석기를 쓴다.
import { headersFor, loadHeaderRules } from "../scripts/headers.mjs";
import { ALLOWED_REMOTE_ORIGINS } from "./spike/netguard";

/*
 * 네트워크 약속의 바닥인 CSP 문자열을 고정한다(TECH-NOTES 1절 F10: "CSP … 가 산출물에 있다는 테스트").
 * `npm run verify` 가 Vercel 빌드 명령이므로, 누가 connect-src 에 출처를 더하거나 강제 헤더를
 * 지우면 배포가 막힌다.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rules = loadHeaderRules(REPO);

function directives(policy: string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) m.set(name, values);
  }
  return m;
}

describe("vercel.json CSP", () => {
  const all = rules.find((r) => r.source === "/(.*)");

  it("모든 경로 규칙이 있고, Report-Only 와 강제 헤더를 둘 다 붙인다", () => {
    expect(all).toBeDefined();
    const keys = all!.headers.map((h) => h.key);
    expect(keys).toContain("Content-Security-Policy-Report-Only");
    expect(keys).toContain("Content-Security-Policy");
  });

  it("Report-Only 에 F10 의 세 지시어가 정확히 들어 있다", () => {
    const ro = directives(all!.headers.find((h) => h.key === "Content-Security-Policy-Report-Only")!.value);
    expect(ro.get("connect-src")).toEqual(["'self'", "https://storage.googleapis.com"]);
    expect(ro.get("img-src")).toEqual(["'self'", "blob:", "data:"]);
    expect(ro.get("form-action")).toEqual(["'none'"]);
  });

  it("강제 헤더의 connect-src 는 자기 출처와 모델 서버뿐(사용 통계·CDN 없음)", () => {
    const value = all!.headers.find((h) => h.key === "Content-Security-Policy")!.value;
    const en = directives(value);
    expect(en.get("connect-src")).toEqual(["'self'", "https://storage.googleapis.com"]);
    expect(en.get("frame-ancestors")).toEqual(["'none'"]);
    expect(value).not.toMatch(/odml|googleapis\.com\/v1|jsdelivr|\*/);
  });

  it("fetch 가드의 허용 목록은 강제 connect-src 의 원격 출처와 같다", () => {
    const en = directives(all!.headers.find((h) => h.key === "Content-Security-Policy")!.value);
    expect(en.get("connect-src")!.filter((x) => x !== "'self'")).toEqual([...ALLOWED_REMOTE_ORIGINS]);
  });

  it.each(["/", "/spike/", "/mediapipe/wasm/vision_wasm_internal.wasm", "/_next/static/chunks/x.js?v=1"])(
    "%s 에 두 헤더가 붙는다(serve-out 과 같은 매칭)",
    (path) => {
      const h = headersFor(rules, path);
      expect(h["content-security-policy"]).toContain("connect-src 'self' https://storage.googleapis.com");
      expect(h["content-security-policy-report-only"]).toContain("form-action 'none'");
    },
  );
});
