/**
 * 내보낸 out/ 을 그대로 열어 보는 정적 서버.
 *
 * 저장소 루트에서:  npm run build && npm run preview
 *
 * 의존성 없이 node 표준 모듈만 쓴다
 * (오프라인에서도 돌고, 버전이 떠 있는 npx 한 줄보다 결정적이다).
 *
 * 일반 정적 서버와 다른 점: vercel.json 의 headers 를 읽어 **같은 헤더를 붙인다.**
 * 같은각도는 CSP(지금은 Report-Only 관찰 모드)가 네트워크 약속의 일부다.
 * 로컬 미리보기에 헤더가 없으면 "로컬에서는 되는데 배포하면 다르게 동작하는" 일이
 * 생기고, 미리 보는 의미가 없어진다. 헤더 정의는 vercel.json 한 곳에만 둔다.
 *
 * source 패턴은 Vercel 이 쓰는 path-to-regexp 문법 중 이 저장소가 쓰는 부분만 옮긴다:
 * 정규식 그룹 "(.*)", 이름 붙은 ":name"·":name*". 그 밖의 문법이 vercel.json 에
 * 들어오면 조용히 무시하지 않고 시작할 때 멈춘다.
 */

import { createServer } from "node:http";
import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(process.argv[2] ?? "out");
const PORT = Number(process.env.PORT ?? 3100);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

/** vercel.json 의 source 를 정규식으로. 모르는 문법이면 예외. */
function sourceToRegExp(source) {
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

function loadHeaderRules() {
  const config = JSON.parse(readFileSync(join(REPO, "vercel.json"), "utf8"));
  return (config.headers ?? []).map((rule) => ({
    re: sourceToRegExp(rule.source),
    headers: rule.headers,
  }));
}

const HEADER_RULES = loadHeaderRules();

/** Vercel 처럼 요청 경로(쿼리 제외)에 맞는 규칙의 헤더를 모두 붙인다. */
function headersFor(urlPath) {
  const path = urlPath.split("?")[0];
  const out = {};
  for (const rule of HEADER_RULES) {
    if (!rule.re.test(path)) continue;
    for (const { key, value } of rule.headers) out[key.toLowerCase()] = value;
  }
  return out;
}

/** ROOT 밖으로 나가는 경로를 막는다. */
function safeJoin(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const full = join(ROOT, rel);
  return full.startsWith(ROOT) ? full : null;
}

async function resolveFile(urlPath) {
  const base = safeJoin(urlPath);
  if (base === null) return null;

  const candidates = base.endsWith("/")
    ? [join(base, "index.html")]
    : [base, join(base, "index.html"), `${base}.html`];

  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  const extra = headersFor(url);
  const file = await resolveFile(url);
  if (file === null) {
    const notFound = await resolveFile("/404.html");
    if (notFound !== null) {
      res.writeHead(404, { ...extra, "content-type": MIME[".html"] });
      createReadStream(notFound).pipe(res);
      return;
    }
    res.writeHead(404, { ...extra, "content-type": MIME[".txt"] });
    res.end(`찾을 수 없습니다: ${url}\n`);
    return;
  }

  res.writeHead(200, {
    ...extra,
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
  createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`${ROOT} → http://localhost:${PORT}`);
  console.log(`vercel.json 헤더 규칙 ${HEADER_RULES.length}개를 붙입니다.`);
});
