import Link from "next/link";

/**
 * 홈. 가장 먼저 보이는 것은 "동영상에서 고르기"로 가는 큰 버튼이다. 그 아래에 지금 무엇이 되고
 * 무엇이 아직인지(실제 얼굴 동영상 검증 전)와 고지(PRD F13)를 둔다 — 검증하지 않은 것을 한 것처럼
 * 읽히게 하지 않는다. 아이폰 점검 페이지(/spike/)는 '기술 점검'으로 작게 둔다.
 */
export default function Home() {
  return (
    <main style={{ maxWidth: 600, margin: "0 auto", padding: "28px 16px 64px" }}>
      <h1 style={{ fontSize: "1.6rem" }}>같은각도</h1>
      <p style={{ marginTop: 8 }}>
        고개를 천천히 움직이며 찍은 짧은 동영상에서, 지난번 사진과 얼굴 각도가 가장 가까운 장면을 골라 주고 기울기·크기·위치를
        맞춰 줍니다.
      </p>

      <Link href="/pick/" style={primary}>
        동영상에서 같은 각도 사진 고르기
      </Link>
      <p style={{ marginTop: 8, color: "var(--muted)", fontSize: "0.9rem" }}>
        지난번 사진 1장과 동영상 1개를 고르면 됩니다. 카메라 권한을 묻지 않고, 사진과 동영상은 이 기기 안에서만 처리합니다.
      </p>

      <section style={card}>
        <h2 style={h2}>쓰는 순서</h2>
        <ol style={list}>
          <li>지난번 사진(기준 사진)을 고릅니다. 얼굴이 보이는 사진만 됩니다.</li>
          <li>
            폰 기본 카메라로 10~15초 동영상을 찍어 고릅니다. 기준 자세에서 3초 멈춘 뒤 고개를 천천히 조금씩 움직입니다. 또는 연사로
            찍은 사진 여러 장을 고릅니다(화질이 중요할 때).
          </li>
          <li>가장 가까운 장면과 각도 차이를 봅니다. 가까운 장면이 없으면 없다고 말하고 다시 찍기를 권합니다.</li>
          <li>맞춘 사진·원본 장면·기록을 저장합니다.</li>
        </ol>
      </section>

      <section style={card}>
        <h2 style={h2}>지금 상태</h2>
        <p style={{ marginTop: 6 }}>
          <strong>실제 얼굴 동영상으로 검증하기 전입니다.</strong> 고르기와 맞추기의 계산은 지어낸 숫자(합성 데이터)로만
          시험했고, 얼굴 사진·동영상으로는 한 번도 돌려 보지 못했습니다. 아이폰에서도 아직 확인하지 못했습니다. 통과 기준 3°를
          비롯한 숫자는 전부 초깃값입니다.
        </p>
      </section>

      <section style={card}>
        <h2 style={h2}>사용목적과 고지</h2>
        <ul style={list}>
          <li>
            같은각도는 촬영자가 찍어 둔 동영상에서 앞서 찍은 기준 사진과 촬영 조건이 가까운 장면을 고르고, 기울기·크기·위치를
            맞추도록 돕는 촬영 보조 소프트웨어입니다. 질병의 진단·치료·예후 관찰이나 치료 효과 모니터링을 목적으로 하지 않습니다.
          </li>
          <li>의료기기로 허가·인증·신고를 받은 제품이 아닙니다.</li>
          <li>모발·두피·피부 상태를 측정하거나 판단하지 않습니다. 사진 속 변화를 판단하는 일은 의료진의 몫입니다.</li>
          <li>얼굴이 보이는 사진만 돕습니다. 정수리·뒤통수처럼 얼굴이 보이지 않는 사진은 각도를 잴 수 없어 멈춥니다.</li>
          <li>
            동영상에서 장면을 고르고 회전·확대·이동만 합니다. 좌우·위아래 각도나 원근을 바꾸거나, 찍히지 않은 곳을 채워 넣지
            않습니다.
          </li>
          <li>“가까운 장면”은 두 사진을 비교해도 된다는 보증이 아닙니다. 각도 값의 측정 오차는 아직 재지 않았습니다.</li>
          <li>
            찍은 동영상은 소리와 함께 폰에 남습니다. 이 앱은 그 파일을 지울 수 없으니 병원이 정한 대로 지우거나 보관해야 합니다.
          </li>
          <li>
            고개 각도는 기기 안에서 MediaPipe 얼굴 랜드마크 모델(Google 이 사전학습한 AI 모델)로 추정합니다. 고르기와 판정은
            공개된 규칙으로 하며 생성형 AI 를 쓰지 않습니다.
          </li>
          <li>
            사진과 동영상은 기기 밖으로 보내지 않습니다. 다만 얼굴 모델 파일은 Google 서버(storage.googleapis.com)에서 받으며, 이때
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
      <p style={{ marginTop: 2, color: "var(--muted)", fontSize: "0.85rem" }}>
        {/* 작게 두되 누르는 곳의 높이는 44px 을 지킨다. */}
        <Link href="/spike/" style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
          기술 점검(아이폰 카메라·얼굴 모델 점검 페이지)
        </Link>
      </p>
    </main>
  );
}

const primary = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 64,
  marginTop: 18,
  padding: "14px 18px",
  borderRadius: 16,
  background: "var(--brand)",
  color: "var(--brand-fg)",
  fontSize: "1.15rem",
  fontWeight: 800,
  textAlign: "center",
  textDecoration: "none",
} as const;

const card = {
  marginTop: 20,
  padding: 16,
  border: "1px solid var(--line)",
  borderRadius: 12,
  background: "var(--surface)",
} as const;

const h2 = { fontSize: "1.05rem" } as const;

const list = { marginTop: 6, paddingLeft: 20, display: "grid", gap: 6 } as const;
