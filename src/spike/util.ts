/**
 * 점검 페이지 공용 도우미. 브라우저 API 를 부르지 않는다.
 */

import type { JsonValue } from "@/core/report";

/** 예외를 화면·보고서에 적을 한 줄로. 이름을 남겨야 NotAllowedError·NotFoundError 가 구별된다. */
export function errText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`.slice(0, 400);
  if (typeof e === "object" && e !== null && "name" in e) {
    const o = e as { name?: unknown; message?: unknown };
    return `${String(o.name)}: ${String(o.message ?? "")}`.slice(0, 400);
  }
  return String(e).slice(0, 400);
}

/** 유한하면 소수 d 자리로 반올림, 아니면 null. 보고서 크기를 줄이고 비유한 값을 명시적 null 로 적는다. */
export function num(x: unknown, d = 3): number | null {
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

/** 장치 ID 는 출처별 무작위 값이지만 통째로 남길 이유가 없다. 앞 8자만. */
export function shortId(id: string | undefined | null): string | null {
  if (!id) return null;
  return id.slice(0, 8);
}

/**
 * 브라우저가 준 객체(getSettings·getCapabilities 등)를 보고서에 넣을 수 있는 JSON 으로.
 * 수는 유한하면 반올림, 아니면 null. 함수·undefined 는 뺀다(그 키가 원래 없던 것과 같다).
 * 문자열 200자, 배열 50개, 깊이 4에서 자른다.
 */
export function toJson(x: unknown, depth = 0): JsonValue {
  if (x === null || x === undefined) return null;
  if (typeof x === "boolean") return x;
  if (typeof x === "number") return num(x, 4);
  if (typeof x === "string") return x.slice(0, 200);
  if (depth >= 4) return null;
  if (Array.isArray(x)) return x.slice(0, 50).map((v) => toJson(v, depth + 1));
  if (typeof x === "object") {
    const out: { [k: string]: JsonValue } = {};
    for (const k of Object.keys(x as object)) {
      const v = (x as Record<string, unknown>)[k];
      if (v === undefined || typeof v === "function") continue;
      out[k] = toJson(v, depth + 1);
    }
    return out;
  }
  return null;
}

/** 목록 끝에 붙이고 최근 max 개만 남긴다. */
export function pushCapped<T>(list: readonly T[], item: T, max: number): T[] {
  const next = [...list, item];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** 숫자를 화면에 보이는 짧은 문자열로. null 은 '—'. */
export function fmt(x: number | null | undefined, d = 1): string {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  return x.toFixed(d);
}
