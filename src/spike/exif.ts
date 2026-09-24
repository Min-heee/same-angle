/**
 * JPEG 앞부분에서 EXIF Orientation(0x0112)과 원본 픽셀 크기(SOF)를 읽고, 옛 사진 경로(7번)가
 * 회전을 반영했는지 판정한다. 순수 함수(exif.test.ts).
 *
 * 왜: 세 경로의 크기·roll 이 같다는 것만으로는 "EXIF 가 반영됐다"와 "원래 회전이 없는 사진이다"를
 * 구별할 수 없다. 파일 자체의 Orientation 과 눕혀 저장된 원본 크기를 알아야 판정할 수 있다.
 * 아이폰 사진 선택기는 트랜스코딩한 JPEG 을 넘길 수 있어 Orientation 이 1 이거나 없을 수 있다
 * — 그때는 판정 불가로 적는다.
 */

export interface JpegInfo {
  isJpeg: boolean;
  /** 1~8. 태그가 없거나 범위 밖이면 null. */
  orientation: number | null;
  /** SOF 에 적힌 원본 픽셀 크기(회전 전). 못 찾으면 null. */
  width: number | null;
  height: number | null;
}

/** 앞에서 읽을 바이트 수. APP1(최대 64KB) 뒤의 SOF 까지 대개 들어온다. */
export const EXIF_READ_BYTES = 131072;

function readOrientation(view: DataView, start: number, end: number): number | null {
  // start = TIFF 헤더 시작.
  if (start + 8 > end) return null;
  const bo = view.getUint16(start);
  const little = bo === 0x4949 ? true : bo === 0x4d4d ? false : null;
  if (little === null) return null;
  if (view.getUint16(start + 2, little) !== 42) return null;
  const ifd = start + view.getUint32(start + 4, little);
  if (ifd + 2 > end) return null;
  const n = view.getUint16(ifd, little);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) return null;
    if (view.getUint16(e, little) !== 0x0112) continue;
    const type = view.getUint16(e + 2, little);
    if (type !== 3) return null; // SHORT 만
    const v = view.getUint16(e + 8, little);
    return v >= 1 && v <= 8 ? v : null;
  }
  return null;
}

/** SOF 마커: C0~CF 중 DHT(C4)·JPG(C8)·DAC(CC)를 뺀 것. */
function isSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

export function readJpegInfo(buf: ArrayBuffer): JpegInfo {
  const view = new DataView(buf);
  const end = buf.byteLength;
  const out: JpegInfo = { isJpeg: false, orientation: null, width: null, height: null };
  if (end < 4 || view.getUint16(0) !== 0xffd8) return out;
  out.isJpeg = true;
  let p = 2;
  while (p + 4 <= end) {
    if (view.getUint8(p) !== 0xff) return out; // 세그먼트 경계가 깨졌다
    const marker = view.getUint8(p + 1);
    if (marker === 0xff) {
      p += 1; // 채움 바이트
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return out; // EOI·SOS: 헤더 끝
    const len = view.getUint16(p + 2);
    if (len < 2) return out;
    const segStart = p + 4;
    const segEnd = Math.min(end, p + 2 + len);
    if (marker === 0xe1 && out.orientation === null && segStart + 6 <= segEnd) {
      const isExif =
        view.getUint32(segStart) === 0x45786966 /* "Exif" */ && view.getUint16(segStart + 4) === 0x0000;
      if (isExif) out.orientation = readOrientation(view, segStart + 6, segEnd);
    } else if (isSof(marker) && segStart + 5 <= segEnd) {
      out.height = view.getUint16(segStart + 1);
      out.width = view.getUint16(segStart + 3);
      return out;
    }
    p += 2 + len;
  }
  return out;
}

export interface PathLook {
  width: number;
  height: number;
  faces: number;
  roll: number | null;
}

export type ExifVerdictStatus = "applied" | "notApplied" | "undecidable";

export interface ExifVerdict {
  status: ExifVerdictStatus;
  note: string;
}

/** 회전이 반영된 얼굴은 roll 이 이 안이다(무시되면 ±90° 또는 180° 근처). */
export const ROLL_UPRIGHT_DEG = 30;

/**
 * 판정. A = createImageBitmap(from-image), C = <img>. B(스펙 옛 값 'none')는 동작 기록만이라 넣지 않는다.
 * orientation 5~8: A·C 의 폭·높이가 원본과 뒤바뀌고 roll 이 0 근처면 반영됨.
 * orientation 3: 크기는 같고 roll 이 0 근처면 반영됨. 1·없음·2·4 는 판정 불가.
 */
export function exifVerdict(info: JpegInfo, a: PathLook | null, c: PathLook | null): ExifVerdict {
  const o = info.orientation;
  if (!info.isJpeg) return { status: "undecidable", note: "JPEG 이 아님(HEIC 등) — 회전 태그를 읽지 못해 판정 불가" };
  if (o === null || o === 1) {
    return { status: "undecidable", note: `판정 불가(orientation=${o ?? "없음"}) — 회전 정보가 있는 다른 사진으로 한 번 더` };
  }
  if (o === 2 || o === 4) return { status: "undecidable", note: `판정 불가(orientation=${o}, 반전만 있는 사진)` };
  if (info.width === null || info.height === null) return { status: "undecidable", note: "원본 픽셀 크기(SOF)를 읽지 못함" };
  const swap = o >= 5;
  const expW = swap ? info.height : info.width;
  const expH = swap ? info.width : info.height;
  const paths: [string, PathLook | null][] = [
    ["A", a],
    ["C", c],
  ];
  const wrong: string[] = [];
  const unsure: string[] = [];
  for (const [name, p] of paths) {
    if (!p) {
      unsure.push(`${name} 결과 없음`);
      continue;
    }
    if (swap && (p.width !== expW || p.height !== expH)) {
      wrong.push(`${name} 크기 ${p.width}x${p.height}(원본 ${info.width}x${info.height} 그대로)`);
      continue;
    }
    if (p.faces !== 1 || p.roll === null) {
      unsure.push(`${name} 얼굴 ${p.faces}개`);
      continue;
    }
    if (Math.abs(p.roll) >= ROLL_UPRIGHT_DEG) wrong.push(`${name} roll ${p.roll.toFixed(1)}°`);
  }
  if (wrong.length) return { status: "notApplied", note: `orientation=${o} 인데 회전이 반영되지 않음: ${wrong.join(", ")}` };
  if (unsure.length) return { status: "undecidable", note: `orientation=${o}, ${unsure.join(", ")} — 얼굴이 보이는 사진으로 다시` };
  return {
    status: "applied",
    note: swap
      ? `orientation=${o}: A·C 의 폭·높이가 원본과 뒤바뀌고 roll 이 ${ROLL_UPRIGHT_DEG}° 안 — 반영됨`
      : `orientation=${o}: A·C 의 roll 이 ${ROLL_UPRIGHT_DEG}° 안 — 반영됨`,
  };
}
