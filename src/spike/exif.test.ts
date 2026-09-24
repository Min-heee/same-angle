import { describe, expect, it } from "vitest";
import { exifVerdict, readJpegInfo, type JpegInfo } from "./exif";

/** 최소 JPEG: SOI, (APP1 Exif Orientation), SOF0(높이·폭), SOS. */
function jpeg(opts: { orientation?: number; little?: boolean; width: number; height: number; app0?: boolean }): ArrayBuffer {
  const bytes: number[] = [0xff, 0xd8];
  const u16 = (v: number, little = false) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number, little = false) =>
    little ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  if (opts.app0) bytes.push(0xff, 0xe0, ...u16(16), ...Array.from("JFIF\0", (c) => c.charCodeAt(0)), ...new Array(9).fill(0));
  if (opts.orientation !== undefined) {
    const le = opts.little ?? false;
    const tiff = [
      ...(le ? [0x49, 0x49] : [0x4d, 0x4d]),
      ...u16(42, le),
      ...u32(8, le),
      ...u16(2, le), // 항목 2개: 다른 태그 하나 + Orientation
      ...u16(0x010f, le), ...u16(2, le), ...u32(4, le), ...u32(0, le), // Make(내용 무관)
      ...u16(0x0112, le), ...u16(3, le), ...u32(1, le), ...u16(opts.orientation, le), 0, 0,
      ...u32(0, le),
    ];
    const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    bytes.push(0xff, 0xe1, ...u16(payload.length + 2), ...payload);
  }
  bytes.push(0xff, 0xc0, ...u16(17), 8, ...u16(opts.height), ...u16(opts.width), 3, ...new Array(9).fill(0));
  bytes.push(0xff, 0xda, ...u16(2));
  return new Uint8Array(bytes).buffer;
}

describe("readJpegInfo", () => {
  it("빅엔디언 Orientation 6 과 SOF 의 원본 크기(가로로 눕힌 4032×3024)", () => {
    expect(readJpegInfo(jpeg({ orientation: 6, width: 4032, height: 3024 }))).toEqual({
      isJpeg: true,
      orientation: 6,
      width: 4032,
      height: 3024,
    });
  });

  it("리틀엔디언·APP0 뒤에 오는 APP1 도 읽는다", () => {
    const i = readJpegInfo(jpeg({ orientation: 8, little: true, app0: true, width: 640, height: 480 }));
    expect(i.orientation).toBe(8);
    expect(i.width).toBe(640);
  });

  it("EXIF 가 없으면 orientation null, 크기는 읽는다", () => {
    expect(readJpegInfo(jpeg({ width: 100, height: 50 }))).toEqual({ isJpeg: true, orientation: null, width: 100, height: 50 });
  });

  it("범위 밖 값(9)은 null, JPEG 이 아니면 isJpeg false", () => {
    expect(readJpegInfo(jpeg({ orientation: 9, width: 10, height: 10 })).orientation).toBeNull();
    expect(readJpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer).isJpeg).toBe(false);
    expect(readJpegInfo(new ArrayBuffer(0)).isJpeg).toBe(false);
  });

  it("잘린 버퍼(SOF 전에 끝남)는 예외 없이 아는 데까지", () => {
    const full = new Uint8Array(jpeg({ orientation: 6, width: 4032, height: 3024 }));
    const cut = full.slice(0, full.length - 20).buffer;
    const i = readJpegInfo(cut);
    expect(i.orientation).toBe(6);
    expect(i.width).toBeNull();
  });
});

describe("exifVerdict", () => {
  const info6: JpegInfo = { isJpeg: true, orientation: 6, width: 4032, height: 3024 };
  const upright = { width: 3024, height: 4032, faces: 1, roll: 2 };

  it("orientation 6: A·C 가 폭·높이를 바꾸고 roll 이 0 근처면 반영됨", () => {
    expect(exifVerdict(info6, upright, upright).status).toBe("applied");
  });

  it("orientation 6 인데 크기가 원본 그대로이거나 roll 이 ±90 이면 반영 안 됨", () => {
    expect(exifVerdict(info6, { width: 4032, height: 3024, faces: 1, roll: 90 }, upright).status).toBe("notApplied");
    expect(exifVerdict(info6, upright, { ...upright, roll: -88 }).status).toBe("notApplied");
  });

  it("orientation 6 인데 roll 은 0 근처여도 크기가 원본 그대로면 반영 안 됨(크기 검사가 따로 돈다)", () => {
    const v = exifVerdict(info6, { width: 4032, height: 3024, faces: 1, roll: 0 }, upright);
    expect(v.status).toBe("notApplied");
    expect(v.note).toContain("크기 4032x3024");
  });

  it("orientation 1·없음은 셋이 같아도 판정 불가(회전 정보가 없는 사진)", () => {
    const same = { width: 3024, height: 4032, faces: 1, roll: 0 };
    expect(exifVerdict({ ...info6, orientation: 1 }, same, same).status).toBe("undecidable");
    expect(exifVerdict({ ...info6, orientation: null }, same, same).status).toBe("undecidable");
  });

  it("orientation 3: 크기는 같고 roll 로 본다", () => {
    const info3: JpegInfo = { isJpeg: true, orientation: 3, width: 4032, height: 3024 };
    const a = { width: 4032, height: 3024, faces: 1, roll: 1 };
    expect(exifVerdict(info3, a, a).status).toBe("applied");
    expect(exifVerdict(info3, { ...a, roll: 179 }, a).status).toBe("notApplied");
  });

  it("얼굴을 못 찾으면 판정 불가, JPEG 이 아니면 판정 불가", () => {
    expect(exifVerdict(info6, { ...upright, faces: 0, roll: null }, upright).status).toBe("undecidable");
    expect(exifVerdict({ isJpeg: false, orientation: null, width: null, height: null }, upright, upright).status).toBe(
      "undecidable",
    );
  });
});
