/**
 * vercel.json 의 headers 규칙을 읽고 요청 경로에 맞는 헤더를 고르는 작은 모듈.
 *
 * serve-out.mjs(로컬 미리보기)와 src/csp.test.ts(CSP 문자열 고정 테스트)가 같이 쓴다.
 * 헤더 정의는 vercel.json 한 곳에만 두고, 로컬 미리보기·테스트·배포가 같은 규칙을 본다.
 *
 * source 패턴은 Vercel 이 쓰는 path-to-regexp 문법 중 이 저장소가 쓰는 부분만 옮긴다:
 * 정규식 그룹 "(.*)", 이름 붙은 ":name"·":name*". 그 밖의 문법이 vercel.json 에
 * 들어오면 조용히 무시하지 않고 예외를 던진다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * vercel.json 의 source 를 정규식으로. 모르는 문법이면 예외.
 * @param {string} source
 * @returns {RegExp}
 */
export function sourceToRegExp(source) {
  if (!source.startsWith("/")) throw new Error(`source 는 / 로 시작해야 합니다: ${source}`);
  let out = "";
  for (let i = 0; i < source.length; ) {
    const rest = source.slice(i);
    if (rest.startsWith("(.*)")) {
      out += "(.*)";
      i += 4;
      continue;
    }
    const named = /^:([A-Za-z_]\w*)(\*)?/.exec(rest);
    if (named) {
      out += named[2] ? "(.*)" : "([^/]+)";
      i += named[0].length;
      continue;
    }
    const ch = source[i];
    if ("()[]{}?+*|^$\\".includes(ch)) {
      throw new Error(`serve-out 이 모르는 source 문법입니다: ${source}`);
    }
    out += ch === "." ? "\\." : ch;
    i += 1;
  }
  return new RegExp(`^${out}$`);
}

/**
 * @typedef {{ key: string, value: string }} Header
 * @typedef {{ source: string, re: RegExp, headers: Header[] }} HeaderRule
 */

/**
 * @param {string} repoDir vercel.json 이 있는 디렉터리
 * @returns {HeaderRule[]}
 */
export function loadHeaderRules(repoDir) {
  const config = JSON.parse(readFileSync(join(repoDir, "vercel.json"), "utf8"));
  return (config.headers ?? []).map((/** @type {{ source: string, headers: Header[] }} */ rule) => ({
    source: rule.source,
    re: sourceToRegExp(rule.source),
    headers: rule.headers,
  }));
}

/**
 * Vercel 처럼 요청 경로(쿼리 제외)에 맞는 규칙의 헤더를 모두 붙인다. 키는 소문자.
 * @param {HeaderRule[]} rules
 * @param {string} urlPath
 * @returns {Record<string, string>}
 */
export function headersFor(rules, urlPath) {
  const path = urlPath.split("?")[0];
  /** @type {Record<string, string>} */
  const out = {};
  for (const rule of rules) {
    if (!rule.re.test(path)) continue;
    for (const { key, value } of rule.headers) out[key.toLowerCase()] = value;
  }
  return out;
}
