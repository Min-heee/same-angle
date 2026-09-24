import Link from "next/link";

/**
 * 홈. 지금은 제품 화면이 없다는 사실을 먼저 말하고, 점검 페이지로 보낸다.
 * 고지 문장은 PRD F13 수준으로 두되, 아직 판정 기능이 없다는 점을 함께 적는다
 * — 만들지 않은 기능을 만든 것처럼 읽히게 하지 않는다.
 */
export default function Home() {
  return (
    <main style={{ maxWidth: 600, margin: "0 auto", padding: "32px 16px 64px" }}>
      <h1 style={{ fontSize: "1.6rem" }}>같은각도</h1>
      <p style={{ marginTop: 8 }}>
        새 사진을 찍을 때 기준 사진과 고개 각도·거리·화면 내 위치가 같은지 숫자로 확인하는 촬영 보조 웹앱입니다.
      </p>

      <section style={card}>
        <h2 style={h2}>지금 상태</h2>
        <p style={{ marginTop: 6 }}>
          <strong>구현 초기 — D1 실기기 점검 단계입니다.</strong> 촬영 게이트·판정·비교 화면은 아직 없고, 카메라 없이 보는 시연 모드도
          아직 없습니다. 지금 있는 것은 아이폰 사파리에서 카메라·얼굴 모델·센서가 실제로 어떻게 동작하는지 재는 점검 페이지뿐입니다.
        </p>
        <p style={{ marginTop: 12 }}>
          <Link href="/spike/" style={{ fontWeight: 700 }}>
            D1 실기기 점검 페이지 열기 →
          </Link>
        </p>
      </section>

      <section style={card}>
        <h2 style={h2}>사용목적과 고지</h2>
        <ul style={{ marginTop: 6, paddingLeft: 18, display: "grid", gap: 6 }}>
          <li>
            같은각도는 촬영자가 새 사진을 찍을 때 앞서 찍어 둔 기준 사진과 촬영 조건이 같은지 확인하도록 돕는 촬영 보조 소프트웨어로
            설계되었습니다. 질병의 진단·치료·예후 관찰이나 치료 효과 모니터링을 목적으로 하지 않습니다.
          </li>
          <li>의료기기로 허가·인증·신고를 받은 제품이 아닙니다.</li>
          <li>모발·두피·피부 상태를 측정하거나 판단하지 않습니다. 사진 속 변화를 판단하는 일은 의료진의 몫입니다.</li>
          <li>
            고개 각도는 기기 안에서 MediaPipe 얼굴 랜드마크 모델(Google 이 사전학습한 AI 모델)로 추정합니다. 판정은 공개된 규칙으로
            하며 생성형 AI 를 쓰지 않습니다. (판정 기능은 아직 구현 전입니다.)
          </li>
          <li>
            카메라 영상과 사진은 기기 밖으로 보내지 않습니다. 다만 얼굴 모델 파일은 Google 서버(storage.googleapis.com)에서 받으며, 이때
            기기의 IP 주소가 Google 에 전달됩니다.
          </li>
          <li>
            MediaPipe 라이브러리는 사용 통계(기기 종류, 라이브러리 버전, 초기화·추론 시간)를 Google(odml.pa.googleapis.com)로 보내려
            합니다. 이 앱은 CSP 와 fetch 가드로 그 요청을 막습니다. 실기기 네트워크 기록으로 확인하기 전입니다.
          </li>
        </ul>
      </section>

      <p style={{ marginTop: 24, color: "var(--muted)", fontSize: "0.85rem" }}>
        설계 문서: 저장소의 <code>docs/PRD.md</code>, <code>docs/TECH-NOTES.md</code>. 병원 현장 검증은 하지 않았습니다.
      </p>
    </main>
  );
}

const card = {
  marginTop: 20,
  padding: 16,
  border: "1px solid var(--line)",
  borderRadius: 12,
  background: "var(--surface)",
} as const;

const h2 = { fontSize: "1.05rem" } as const;
