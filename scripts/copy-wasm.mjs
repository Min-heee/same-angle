/**
 * MediaPipe WASM 을 node_modules 에서 public/mediapipe/wasm/ 으로 복사한다.
 *
 * 왜 자체 호스팅인가(PRD F10): jsDelivr 같은 CDN 에서 받을 수도 있지만, 같은각도는
 * "사진이 기기 밖으로 나가지 않는다"를 CSP 허용 목록으로 고정하려 한다. 외부 출처가
 * 하나 줄면 허용 목록도 하나 준다. 남는 외부 출처는 모델 파일(storage.googleapis.com)
 * 하나뿐이다 — 모델은 재배포 조건이 불명확해 커밋하지 않는다(TECH-NOTES 9절).
 *
 * 왜 커밋하지 않고 복사하는가: WASM 은 package-lock.json 으로 이미 버전이 고정된
 * 패키지 안에 있다. 저장소에 사본을 두면 패키지를 올릴 때 사본만 옛 버전으로 남는
 * 사고가 생긴다. predev·prebuild 에서 매번 복사하면 둘이 어긋날 수 없다.
 *
 * 버전 확인: 설치된 패키지 버전이 package.json 에 정확 고정한 값과 다르면 멈춘다.
 * 로더(JS)와 WASM 이 서로 다른 버전이면 초기화가 알 수 없는 방식으로 깨진다.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_DIR = join(ROOT, "node_modules", "@mediapipe", "tasks-vision");
const SRC = join(PKG_DIR, "wasm");
const DEST = join(ROOT, "public", "mediapipe", "wasm");

const pinned = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).dependencies[
  "@mediapipe/tasks-vision"
];

if (!existsSync(SRC)) {
  console.error(`[copy-wasm] ${SRC} 가 없습니다. npm install 을 먼저 실행하세요.`);
  process.exit(1);
}

const installed = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8")).version;
if (installed !== pinned) {
  console.error(
    `[copy-wasm] 설치된 @mediapipe/tasks-vision ${installed} 가 package.json 고정값 ${pinned} 와 다릅니다.`,
  );
  process.exit(1);
}

// 옛 파일이 섞여 남지 않게 통째로 지우고 다시 복사한다.
rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

const files = readdirSync(SRC);
for (const name of files) {
  cpSync(join(SRC, name), join(DEST, name));
}

console.log(`[copy-wasm] @mediapipe/tasks-vision ${installed} WASM ${files.length}개 → public/mediapipe/wasm/`);
