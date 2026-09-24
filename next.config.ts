import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 정적 내보내기: 서버 런타임 없이 out/ 만으로 배포된다.
  // 서버가 없으면 사진이 갈 곳도 없다(PRD F10). 이 한 줄이 그 약속의 바닥이다.
  output: "export",

  // false면 out/spike.html 이 나와 /spike/ 경로가 정적 호스트마다 다르게 풀린다.
  // true로 두면 out/spike/index.html 하나로 정해진다.
  trailingSlash: true,

  // basePath는 두지 않는다. Vercel 루트 도메인에만 배포한다.
  // (GitHub Pages처럼 하위 경로에 배포할 일이 생기면 그때 환경변수로 연다.)

  // 정적 내보내기에는 이미지 최적화 서버가 없다.
  images: { unoptimized: true },
};

export default nextConfig;
