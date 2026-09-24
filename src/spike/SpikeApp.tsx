"use client";

/**
 * D1 실기기 점검 페이지(TECH-NOTES 6절). 오너가 아이폰 사파리에서 혼자, 한 손으로 돌리고
 * 결과 JSON 을 내보내 개발 대화창에 붙여 넣는 도구다. 제품 화면이 아니다.
 *
 * 모든 브라우저 API 는 이펙트·클릭 핸들러 안에서만 부른다. 모듈 최상단에서 window·navigator 를
 * 건드리면 정적 내보내기의 프리렌더가 깨진다.
 */

import { useEffect, useState } from "react";
import { SECTION_KEYS } from "@/core/report";
import { unlockAudio } from "./beep";
import { SpikeProvider, useSpike } from "./context";
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

function Preview() {
  const { videoRef, overlayRef, stream, live, loopRunning, sections } = useSpike();
  const [big, setBig] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

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
    <div className={s.preview}>
      <div className={s.stage} style={{ width: `min(100%, calc(${vh}vh * ${ratio}))`, aspectRatio: `${ratio}` }}>
        <video ref={videoRef} playsInline muted autoPlay />
        <canvas ref={overlayRef} />
        {!stream ? <div className={s.stageEmpty}>카메라 꺼짐 — 1번에서 켜세요</div> : null}
      </div>
      <div className={s.liveLine}>
        <span>{size ? `${size.w}×${size.h}` : "—"}</span>
        <span>{loopRunning ? `${fmt(live?.fps, 1)}fps` : "추론 멈춤"}</span>
        <span>얼굴 {live?.last?.faces ?? "—"}</span>
        <span>{d ? `y ${fmt(d.yaw)} p ${fmt(d.pitch)} r ${fmt(d.roll)}` : ""}</span>
        <button className={s.small} onClick={() => setBig((b) => !b)} style={{ marginLeft: "auto" }}>
          {big ? "작게" : "크게"}
        </button>
      </div>
      <div className={s.liveLine} aria-label="섹션 상태">
        {SECTION_KEYS.map((k, i) => (
          <a key={k} href={`#s${i}`} style={{ color: STATUS_COLOR[sections[k].status], textDecoration: "none", fontWeight: 700 }}>
            {i}
          </a>
        ))}
        <a href="#s12" style={{ textDecoration: "none", fontWeight: 700 }}>
          12 내보내기
        </a>
      </div>
    </div>
  );
}

export default function SpikeApp() {
  useEffect(() => {
    // iOS 는 사용자 제스처 안에서만 오디오를 연다. 첫 탭에서 한 번.
    const onFirst = () => unlockAudio();
    document.addEventListener("pointerdown", onFirst, { once: true });
    return () => document.removeEventListener("pointerdown", onFirst);
  }, []);

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
          <p className={s.promise}>
            카메라 영상과 고른 사진은 <strong>이 기기 안에서만</strong> 처리하고 어디로도 보내지 않습니다. 네트워크로 나가는 것은
            얼굴 모델 파일을 Google 서버(storage.googleapis.com)에서 받는 요청뿐입니다. 결과 JSON 에는 이미지·랜드마크가 들어가지
            않습니다.
          </p>
        </header>
        <Preview />
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
    </SpikeProvider>
  );
}
