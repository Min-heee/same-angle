import { afterAll, describe, expect, it, vi } from "vitest";
import {
  ALLOWED_REMOTE_ORIGINS,
  ALLOWED_REMOTE_PREFIXES,
  MAX_BLOCKED_KINDS,
  addBlocked,
  blockedRequests,
  installFetchGuard,
  isAllowedUrl,
  originOf,
} from "./netguard";

const SELF = "https://same-angle.example";
const ODML = "https://odml.pa.googleapis.com/v1/log";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

describe("isAllowedUrl", () => {
  it("자기 출처(상대 경로 포함)와 모델 서버만 허용", () => {
    expect(isAllowedUrl("/mediapipe/wasm/vision_wasm_internal.wasm", SELF)).toBe(true);
    expect(isAllowedUrl(`${SELF}/spike/`, SELF)).toBe(true);
    expect(isAllowedUrl(MODEL, SELF)).toBe(true);
    expect(ALLOWED_REMOTE_PREFIXES).toEqual(["https://storage.googleapis.com/mediapipe-models/"]);
    expect(ALLOWED_REMOTE_ORIGINS).toEqual(["https://storage.googleapis.com"]);
  });

  it("모델 서버라도 모델 버킷 밖 경로는 막는다(그 호스트는 아무 버킷에나 업로드를 받는다)", () => {
    expect(isAllowedUrl("https://storage.googleapis.com/upload/storage/v1/b/any/o", SELF)).toBe(false);
    expect(isAllowedUrl("https://storage.googleapis.com/some-bucket/x.jpg", SELF)).toBe(false);
    expect(isAllowedUrl("https://storage.googleapis.com/mediapipe-models", SELF)).toBe(false);
    expect(isAllowedUrl("https://storage.googleapis.com/mediapipe-models-evil/x", SELF)).toBe(false);
    // 정규화하면 버킷 밖이다.
    expect(isAllowedUrl("https://storage.googleapis.com/mediapipe-models/../evil/x", SELF)).toBe(false);
    expect(isAllowedUrl("https://storage.googleapis.com/mediapipe-models/%2e%2e/evil/x", SELF)).toBe(false);
  });

  it("MediaPipe 사용 통계 주소와 그 밖의 출처는 막는다", () => {
    expect(isAllowedUrl(ODML, SELF)).toBe(false);
    expect(isAllowedUrl("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm", SELF)).toBe(false);
    expect(isAllowedUrl("http://storage.googleapis.com/x", SELF)).toBe(false); // 스킴이 다르면 다른 출처
    expect(isAllowedUrl("https://same-angle.example.evil.com/", SELF)).toBe(false);
  });

  it("http(s) 가 아닌 스킴은 막는다(CSP connect-src 'self' 와 같게)", () => {
    expect(isAllowedUrl("data:text/plain,hi", SELF)).toBe(false);
    expect(isAllowedUrl(`blob:${SELF}/1234`, SELF)).toBe(false);
  });
});

describe("addBlocked · originOf", () => {
  it("같은 출처·메서드는 횟수만 올린다(경로는 남기지 않는다)", () => {
    let list = addBlocked([], originOf(ODML, SELF), "post");
    list = addBlocked(list, originOf(`${ODML}?x=1`, SELF), "POST");
    list = addBlocked(list, originOf(ODML, SELF), "OPTIONS");
    expect(list).toEqual([
      { origin: "https://odml.pa.googleapis.com", method: "POST", count: 2 },
      { origin: "https://odml.pa.googleapis.com", method: "OPTIONS", count: 1 },
    ]);
  });

  it(`종류는 ${MAX_BLOCKED_KINDS}개까지`, () => {
    let list = addBlocked([], "https://a0.example", "GET");
    for (let i = 1; i < MAX_BLOCKED_KINDS + 5; i++) list = addBlocked(list, `https://a${i}.example`, "GET");
    expect(list).toHaveLength(MAX_BLOCKED_KINDS);
  });

  it("http(s) 가 아니면 스킴까지만", () => {
    expect(originOf("data:image/png;base64,AAAA", SELF)).toBe("data:");
  });
});

describe("installFetchGuard", () => {
  const g = globalThis as unknown as { window?: unknown };
  const had = "window" in g;
  const prev = g.window;
  afterAll(() => {
    if (had) g.window = prev;
    else delete g.window;
  });

  it("허용 목록 밖 fetch 는 보내기 전에 거부하고 횟수만 센다. 허용된 요청은 그대로 보낸다", async () => {
    const real = vi.fn(async () => new Response("ok"));
    const win = { fetch: real, location: { origin: SELF } } as unknown as Window & typeof globalThis;
    g.window = win;
    installFetchGuard();
    installFetchGuard(); // 두 번 불러도 한 번만 감싼다

    await expect(win.fetch(ODML, { method: "POST", body: new Uint8Array(120) })).rejects.toThrow(TypeError);
    await expect(win.fetch(ODML, { method: "POST" })).rejects.toThrow(/네트워크 가드/);
    expect(real).not.toHaveBeenCalled();
    expect(blockedRequests()).toEqual([{ origin: "https://odml.pa.googleapis.com", method: "POST", count: 2 }]);

    await win.fetch(MODEL);
    await win.fetch("/mediapipe/wasm/x.wasm");
    expect(real).toHaveBeenCalledTimes(2);
  });
});
