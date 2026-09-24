import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "같은각도",
  description:
    "기준 사진과 고개 각도·거리·화면 내 위치가 같은지 숫자로 확인하는 촬영 보조 웹앱(구현 초기).",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * CSP 위반 이벤트를 페이지 로드 첫 순간부터 모은다.
 *
 * Report-Only 헤더도 브라우저가 securitypolicyviolation 이벤트를 쏜다. 그런데
 * React 가 붙이는 리스너는 하이드레이션 뒤에야 붙어서, 그 전에 난 위반(초기 스크립트·
 * 스타일)은 놓친다. 그래서 가장 앞에서 전역 배열에 쌓아 두고 점검 페이지가 읽어 간다.
 * 넣는 값은 지시어와 차단된 출처의 문자열뿐이고, 50개에서 멈춘다.
 */
const CSP_COLLECTOR = `(function(){var a=[];window.__cspViolations=a;document.addEventListener("securitypolicyviolation",function(e){if(a.length>=50)return;var u=String(e.blockedURI||"");try{if(/^https?:/.test(u))u=new URL(u).origin}catch(_){}a.push({t:Math.round(performance.now()),directive:String(e.effectiveDirective||e.violatedDirective||""),blocked:u,disposition:String(e.disposition||"")})})})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <script dangerouslySetInnerHTML={{ __html: CSP_COLLECTOR }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
