"use client";

/**
 * D1 실기기 점검 페이지(TECH-NOTES 6절). 개발자가 아이폰 사파리에서 혼자, 한 손으로 돌리고
 * 결과 JSON 을 내보내 분석하는 도구다. 제품 화면이 아니다.
 *
 * 모든 브라우저 API 는 이펙트·클릭 핸들러 안에서만 부른다. 모듈 최상단에서 window·navigator 를
 * 건드리면 정적 내보내기의 프리렌더가 깨진다.
 */

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { unlockAudio } from "./beep";
import { SpikeProvider, useLive, useSpike } from "./context";
import { SECTION_NAV, STATUS_MARK, navLabel } from "./nav";
import { installFetchGuard } from "./netguard";
import { CameraSection } from "./sections/Camera";
import { EnvSection } from "./sections/Env";
import { ExifSection } from "./sections/Exif";
import { ExportSection } from "./sections/Export";
import { FaceSection } from "./sections/Face";
import { FixturesSection } from "./sections/Fixtures";
import { JitterSection } from "./sections/Jitter";
import { MotionSection } from "./sections/Motion";
import { NetworkSection } from "./sections/Network";
import { PixelCostSection } from "./sections/PixelCost";
import { SameFrameSection } from "./sections/SameFrame";
import { ShareSection } from "./sections/Share";
import { TakePhotoSection } from "./sections/TakePhoto";
import s from "./spike.module.css";
import { fmt } from "./util";

const STATUS_COLOR = {
  idle: "var(--muted)",
  running: "var(--run)",
  done: "var(--ok)",
  failed: "var(--bad)",
} as const;

function Preview({ big, setBig }: { big: boolean; setBig: (f: (b: boolean) => boolean) => void }) {
  const { videoRef, overlayRef, stream, loopRunning, camState } = useSpike();
  const live = useLive();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // 붙어 있는 미리보기 높이를 CSS 변수로. 섹션의 scroll-margin-top 이 이 값을 써서, 링크로
  // 건너뛴 섹션 제목·버튼이 미리보기 밑에 숨지 않는다(크게·작게·회전 모두).
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty("--preview-h", `${Math.round(el.offsetHeight)}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--preview-h");
    };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const update = () => setSize(v.videoWidth > 0 ? { w: v.videoWidth, h: v.videoHeight } : null);
    v.addEventListener("loadedmetadata", update);
    v.addEventListener("resize", update);
    return () => {
      v.removeEventListener("loadedmetadata", update);
      v.removeEventListener("resize", update);
    };
  }, [videoRef]);

  // 비디오 비율 그대로의 상자에 비디오와 오버레이를 겹친다(object-fit: fill 이어도 찌그러지지 않게).
  const ratio = size ? size.w / size.h : 3 / 4;
  const vh = big ? 52 : 28;
  const d = live?.last?.dec;

  return (
    <div className={s.preview} ref={boxRef}>
      <div className={s.stage} style={{ width: `min(100%, calc(${vh}vh * ${ratio}))`, aspectRatio: `${ratio}` }}>
        <video ref={videoRef} playsInline muted autoPlay />
        <canvas ref={overlayRef} />
        {!stream ? <div className={s.stageEmpty}>카메라 꺼짐 — 1번에서 켜세요</div> : null}
      </div>
      <div className={s.liveLine}>
        <span>{size ? `${size.w}×${size.h}` : "—"}</span>
        <span>{loopRunning ? (live?.stale ? "프레임 안 옴" : `${fmt(live?.fps, 1)}fps`) : "추론 멈춤"}</span>
        {camState === "muted" || camState === "ended" ? (
          <span className={s.alert} role="status">
            카메라 중단됨
          </span>
        ) : null}
        <span>얼굴 {live?.last?.faces ?? "—"}</span>
        <span>{d ? `y ${fmt(d.yaw)} p ${fmt(d.pitch)} r ${fmt(d.roll)}` : ""}</span>
        <button className={s.small} onClick={() => setBig((b) => !b)} style={{ marginLeft: "auto" }}>
          {big ? "작게" : "크게"}
        </button>
      </div>
    </div>
  );
}

/**
 * 하단 섹션 바. 엄지가 닿는 화면 아래에 두고, 칩마다 44px 이상·번호와 상태 기호(✓ ✕ …)를
 * 글자로 붙인다(색만으로 구별하지 않게). 누르면 미리보기를 작게 돌린 뒤 그 섹션으로 간다.
 */
function BottomNav({ setBig }: { setBig: (f: (b: boolean) => boolean) => void }) {
  const { sections } = useSpike();

  const go = (e: MouseEvent<HTMLAnchorElement>, no: number) => {
    e.preventDefault();
    setBig(() => false);
    // 미리보기 높이가 줄어든 뒤(두 프레임 뒤) 스크롤해야 scroll-margin 이 새 높이를 쓴다.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => document.getElementById(`s${no}`)?.scrollIntoView({ block: "start" })),
    );
  };

  return (
    <nav className={s.bottomNav} aria-label="섹션 이동">
      {SECTION_NAV.map((item) => {
        const status = item.key ? sections[item.key].status : null;
        return (
          <a
            key={item.no}
            href={`#s${item.no}`}
            className={s.navChip}
            onClick={(e) => go(e, item.no)}
            aria-label={navLabel(item, status)}
            style={status ? { color: STATUS_COLOR[status], borderColor: STATUS_COLOR[status] } : undefined}
          >
            {item.key ? `${item.no}${status ? STATUS_MARK[status] : ""}` : `${item.no} 내보내기`}
          </a>
        );
      })}
    </nav>
  );
}

/** 임시 저장본을 복원했으면 알리고, 버릴 수 있게 한다. */
function RestoredChip() {
  const { restored, discardDraft } = useSpike();
  if (!restored) return null;
  const at = new Date(restored.savedAt);
  const hm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  return (
    <p className={s.note} role="status">
      이전 결과를 복원했습니다({hm} 저장). 이어서 하면 됩니다.{" "}
      <button
        className={s.small}
        onClick={() => {
          if (window.confirm("복원한 결과를 버리고 처음부터 할까요? 내보내지 않은 결과는 사라집니다.")) discardDraft();
        }}
      >
        버리기
      </button>
    </p>
  );
}

export default function SpikeApp() {
  const [big, setBig] = useState(false);
  // 점검 상태(임시 저장 복원 포함)는 브라우저에서만 시작한다. 정적 내보내기 프리렌더에는 머리말만.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    // MediaPipe 사용 통계(odml.pa.googleapis.com)가 기기를 떠나지 않게, 무엇이든 불러오기 전에.
    installFetchGuard();
  }, []);

  useEffect(() => {
    // iOS 는 활성화 이벤트(touchend·click·keydown) 안에서만 오디오를 연다. 터치의 pointerdown 은
    // 활성화가 아니고, 긴 페이지의 첫 터치는 대개 스크롤이다. 그래서 한 번(once)이 아니라 매번
    // 부른다(이미 켜져 있으면 상태만 확인하고 끝난다). 캡처 단계라 버튼 핸들러의 beep 보다 먼저 돈다.
    const events = ["touchend", "click", "keydown"] as const;
    const onGesture = () => unlockAudio();
    for (const e of events) document.addEventListener(e, onGesture, { capture: true, passive: true });
    return () => {
      for (const e of events) document.removeEventListener(e, onGesture, { capture: true });
    };
  }, []);

  if (!mounted) {
    return (
      <main className={s.page}>
        <header className={s.header}>
          <h1>D1 실기기 점검</h1>
          <p className={s.lede}>불러오는 중…</p>
        </header>
      </main>
    );
  }

  return (
    <SpikeProvider>
      <main className={s.page}>
        <header className={s.header}>
          <h1>D1 실기기 점검</h1>
          <p className={s.lede}>
            같은각도를 만들기 전에 아이폰 사파리에서 카메라·얼굴 모델·센서·공유가 실제로 어떻게 동작하는지 잽니다. 위에서부터 차례로
            돌리고, 마지막 12번에서 결과 JSON 을 내보내세요. 각 섹션의 번호는 <code>docs/TECH-NOTES.md</code> 6절 체크리스트와
            이어집니다.
          </p>
          <p className={s.lede}>
            <strong>시작 전에 설정 &gt; 디스플레이 및 밝기 &gt; 자동 잠금을 &lsquo;안 함&rsquo;으로.</strong> 흔들림 기록(30초)이 자동 잠금과
            겹치고, 화면이 꺼지면 그 기록은 버려집니다. 결과는 이 기기에 임시 저장되지만, 사파리를 떠나는 7번(사진 선택)·10번(파일
            앱) 전에 12번에서 <strong>한 번 중간 내보내기</strong>를 해 두세요.
          </p>
          <p className={s.lede}>
            <strong>무음 모드(옆면 스위치)를 끄고 소리를 켜 두세요.</strong> 후면 카메라로 찍는 동안에는 화면을 볼 수 없어
            카운트다운과 기록 시작·끝을 소리로 알립니다. 0번 [소리 시험]으로 먼저 확인하세요.
          </p>
          <p className={s.promise}>
            카메라 영상과 고른 사진은 <strong>이 기기 안에서만</strong> 처리하고 어디로도 보내지 않습니다. 이 페이지가 네트워크로
            보내도 되는 요청은 얼굴 모델 파일을 Google 서버(storage.googleapis.com)에서 받는 것뿐입니다. MediaPipe 라이브러리는
            사용 통계를 Google(odml.pa.googleapis.com)로 보내려 하는데, 이 페이지는 그 요청을 보내기 전에 막습니다(fetch 가드 +
            CSP). 막힌 횟수는 11번에 적힙니다. 실기기 네트워크 기록으로 확인하기 전입니다. 결과 JSON 에는 이미지·랜드마크가
            들어가지 않습니다.
          </p>
          <RestoredChip />
        </header>
        <Preview big={big} setBig={setBig} />
        <EnvSection />
        <CameraSection />
        <FaceSection />
        <JitterSection />
        <FixturesSection />
        <SameFrameSection />
        <TakePhotoSection />
        <ExifSection />
        <MotionSection />
        <PixelCostSection />
        <ShareSection />
        <NetworkSection />
        <ExportSection />
      </main>
      <BottomNav setBig={setBig} />
    </SpikeProvider>
  );
}
