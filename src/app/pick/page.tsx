import type { Metadata } from "next";
import PickApp from "@/pick/screen/PickApp";

export const metadata: Metadata = {
  title: "동영상에서 고르기 · 같은각도",
  description:
    "지난번(기준) 사진과 가장 가까운 장면을 동영상에서 골라 기울기·크기·위치를 맞춰 주는 화면. 사진과 동영상은 기기 안에서만 처리합니다.",
};

export default function PickPage() {
  return <PickApp />;
}
