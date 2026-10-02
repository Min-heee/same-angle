/**
 * 접착부: 기준 사진 파일을 연다.
 *
 * 브라우저에서만 불린다. **아이폰 사파리에서 아직 돌려 보지 못했다.**
 * 미확인: 사파리가 `imageOrientation: "from-image"` 를 받는지, HEIC 를 여는지.
 *
 * 회전 정보(EXIF)를 반영해 읽는다. 파일은 File API 로만 읽고 `fetch` 로 읽지 않는다(F14).
 */

/** 기준 사진 파일을 읽을 수 없음(S5). */
export class ReferenceUnreadableError extends Error {
  constructor(detail: string) {
    super(`기준 사진을 읽을 수 없습니다: ${detail}`);
    this.name = "ReferenceUnreadableError";
  }
}

export interface OpenedReference {
  bitmap: ImageBitmap;
  /** 회전 정보를 반영한 원본 크기. */
  width: number;
  height: number;
  close(): void;
}

export async function openReference(file: Blob): Promise<OpenedReference> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (e) {
    throw new ReferenceUnreadableError(e instanceof Error ? e.message : String(e));
  }
  if (!(bitmap.width > 0) || !(bitmap.height > 0)) {
    bitmap.close();
    throw new ReferenceUnreadableError("크기를 알 수 없음");
  }
  return { bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
}
