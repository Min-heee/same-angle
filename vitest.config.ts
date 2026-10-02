import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 코어(src/core)는 DOM도 카메라도 시계도 쓰지 않는 순수 함수다.
 * 그래서 테스트 환경은 node 하나로 충분하고, jsdom 의존성을 두지 않는다.
 * 브라우저에서만 확인할 수 있는 것은 /spike/ 점검 페이지가 맡는다.
 */
export default defineConfig({
  // 화면 조각(.tsx)을 노드에서 문자열로 그려 보는 시험이 있다. tsconfig 의 jsx 는 Next 용
  // "preserve" 라서, 시험에서는 여기서 따로 바꿔 준다.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
