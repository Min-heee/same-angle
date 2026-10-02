import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * 네트워크 약속: 고르기 엔진·화면(src/pick, src/app/pick)의 코드는 스스로 네트워크로 나가지 않는다.
 * 밖으로 나가는 요청은 얼굴 모델 받기 하나뿐이고, 그 코드는 src/spike/engine.ts 에 있다
 * (fetch 가드를 먼저 깔고 부른다).
 *
 * 여기서는 소스에 네트워크 호출이 **적혀 있지 않은지**만 본다. 실제로 요청이 나가지 않는지는
 * 브라우저의 네트워크 기록과 CSP(csp.test.ts)가 맡는다.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

/** 주석과 문자열 속 글자를 빼고 코드만 남긴다(주석에는 "fetch 로 읽지 않는다" 같은 말이 있다). */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''");
}

const NETWORK =
  /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|navigator\.share|importScripts|new\s+Worker|serviceWorker/;

const files = [...sources(join(SRC, "pick")), ...sources(join(SRC, "app", "pick"))];

describe("고르기 엔진·화면의 소스에는 네트워크 호출이 없다", () => {
  it("살펴볼 파일이 있다(화면·접착부·엔진)", () => {
    const names = files.map((f) => f.slice(SRC.length + 1));
    for (const must of ["pick/screen/browser.ts", "pick/screen/session.ts", "pick/screen/PickApp.tsx", "pick/glue/video.ts", "app/pick/page.tsx"]) {
      expect(names).toContain(must);
    }
  });

  it.each(files.map((f) => [f.slice(SRC.length + 1), f]))("%s", (_name, path) => {
    const hit = codeOnly(readFileSync(path, "utf8")).match(NETWORK);
    expect(hit?.[0] ?? null).toBeNull();
  });

  it("걸러내는 식이 실제로 네트워크 호출을 잡는다", () => {
    expect(codeOnly('const r = await fetch("/x"); // 주석')).toMatch(NETWORK);
    expect(codeOnly("navigator.sendBeacon(url, data)")).toMatch(NETWORK);
    expect(codeOnly("// fetch(blob:) 는 막힌다")).not.toMatch(NETWORK);
    expect(codeOnly('const s = "fetch(x)";')).not.toMatch(NETWORK);
  });

  it("고른 파일은 http(s) 주소로 바뀌지 않는다: 주소를 만드는 곳은 createObjectURL 뿐이다", () => {
    for (const path of files) {
      const code = codeOnly(readFileSync(path, "utf8"));
      expect(code).not.toMatch(/\.src\s*=\s*["'`]\s*https?:/);
      expect(code).not.toMatch(/FormData|\.submit\(/);
    }
  });
});
