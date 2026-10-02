import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// 로컬 미리보기(serve-out)와 같은 규칙 해석기를 쓴다.
import { headersFor, loadHeaderRules } from "../scripts/headers.mjs";
import { MODEL_URL } from "./spike/engine";
import { ALLOWED_REMOTE_PREFIXES, isAllowedUrl } from "./spike/netguard";

/*
 * 네트워크 약속의 바닥인 CSP 문자열을 고정한다(TECH-NOTES 1절 F10: "CSP … 가 산출물에 있다는 테스트").
 * `npm run verify` 가 Vercel 빌드 명령이므로, 누가 connect-src 에 출처를 더하거나 강제 헤더를
 * 지우면 배포가 막힌다.
 */

/** 강제·관찰 헤더가 같이 쓰는 connect-src. 호스트 전체가 아니라 모델 버킷 경로까지만. */
const CONNECT_SRC = ["'self'", "https://storage.googleapis.com/mediapipe-models/"];

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
    expect(ro.get("connect-src")).toEqual(CONNECT_SRC);
    expect(ro.get("img-src")).toEqual(["'self'", "blob:", "data:"]);
    expect(ro.get("form-action")).toEqual(["'none'"]);
  });

  it("강제 헤더: connect-src 는 자기 출처와 모델 버킷 경로뿐, 폼 전송·base 바꾸기·프레임 삽입 금지", () => {
    const value = all!.headers.find((h) => h.key === "Content-Security-Policy")!.value;
    const en = directives(value);
    expect(en.get("connect-src")).toEqual(CONNECT_SRC);
    expect(en.get("form-action")).toEqual(["'none'"]);
    expect(en.get("base-uri")).toEqual(["'self'"]);
    expect(en.get("frame-ancestors")).toEqual(["'none'"]);
    expect([...en.keys()].sort()).toEqual(["base-uri", "connect-src", "form-action", "frame-ancestors"]);
    expect(value).not.toMatch(/odml|googleapis\.com\/v1|jsdelivr|\*/);
    // 호스트 전체(https://storage.googleapis.com)를 허용하면 아무 버킷으로나 업로드할 수 있다.
    expect(en.get("connect-src")).not.toContain("https://storage.googleapis.com");
  });

  it("fetch 가드의 허용 목록은 강제 connect-src 의 원격 소스와 같다", () => {
    const en = directives(all!.headers.find((h) => h.key === "Content-Security-Policy")!.value);
    expect(en.get("connect-src")!.filter((x) => x !== "'self'")).toEqual([...ALLOWED_REMOTE_PREFIXES]);
  });

  it("모델 주소는 허용 경로 안이다(경로를 좁혀도 모델은 받는다)", () => {
    expect(MODEL_URL.startsWith(ALLOWED_REMOTE_PREFIXES[0])).toBe(true);
    expect(isAllowedUrl(MODEL_URL, "https://same-angle.example")).toBe(true);
  });

  it("Referrer-Policy: no-referrer — 모델을 받을 때 배포 주소를 Google 에 넘기지 않는다", () => {
    expect(all!.headers.find((h) => h.key === "Referrer-Policy")?.value).toBe("no-referrer");
  });

  it("고르기 화면이 쓰는 주소(blob:)는 관찰 정책 안이다: 동영상은 media-src, 그림은 img-src", () => {
    // 고르기 화면(/pick/)은 고른 파일을 <video src=blob:> 로 읽고, 결과 그림을 <img src=blob:> 로 보인다.
    // 강제 헤더는 이 둘을 다루지 않으므로(connect-src 등 네 지시어뿐) 헤더를 바꿀 것이 없다.
    const ro = directives(all!.headers.find((h) => h.key === "Content-Security-Policy-Report-Only")!.value);
    expect(ro.get("media-src")).toContain("blob:");
    expect(ro.get("img-src")).toContain("blob:");
    // blob: 을 connect-src 에 넣지 않는다 — 파일을 fetch 로 읽지 않는다(F14).
    const en = directives(all!.headers.find((h) => h.key === "Content-Security-Policy")!.value);
    expect(en.get("connect-src")).not.toContain("blob:");
    expect(ro.get("connect-src")).not.toContain("blob:");
    expect(isAllowedUrl("blob:https://same-angle.example/1234", "https://same-angle.example")).toBe(false);
  });

  it.each(["/", "/pick/", "/spike/", "/mediapipe/wasm/vision_wasm_internal.wasm", "/_next/static/chunks/x.js?v=1"])(
    "%s 에 두 헤더가 붙는다(serve-out 과 같은 매칭)",
    (path) => {
      const h = headersFor(rules, path);
      expect(h["content-security-policy"]).toContain("connect-src 'self' https://storage.googleapis.com/mediapipe-models/;");
      expect(h["referrer-policy"]).toBe("no-referrer");
      expect(h["content-security-policy-report-only"]).toContain("form-action 'none'");
    },
  );
});
