import type { Metadata } from "next";
import SpikeApp from "@/spike/SpikeApp";

export const metadata: Metadata = {
  title: "D1 실기기 점검 · 같은각도",
  description: "아이폰 사파리에서 카메라·얼굴 모델·센서·공유 동작을 재는 개발용 점검 페이지.",
  robots: { index: false },
};

export default function SpikePage() {
  return <SpikeApp />;
}
