/**
 * DeviceMotion 중력 벡터에서 폰 롤(화면 평면 안의 회전)을 구한다.
 *
 * 정의(TECH-NOTES 2.3): 폰 기울기 = atan2(gx, gy). gx·gy 는
 * `DeviceMotionEvent.accelerationIncludingGravity` 의 x·y 다.
 *
 * [추론] 부호와 0점: 세로로 곧게 든 폰에서 gy 가 +g 인지 −g 인지는 플랫폼마다 다르다는
 * 보고가 있고 아이폰 사파리에서 아직 재지 않았다. −g 라면 곧게 든 상태가 ±180° 근처라
 * 값이 경계에서 뒤집힌다. 그래서 (1) 부호는 PHONE_ROLL_SIGN 한 곳에 두고,
 * (2) 기준 대비 차는 반드시 `angleDiffDeg` 로 감아서(−180~180) 비교한다.
 *
 * 순수 함수다.
 */

/** [추론] 폰 롤 부호. D1 실측(오른쪽으로 기울였을 때 값이 느는지) 전. */
export const PHONE_ROLL_SIGN = 1;

const RAD2DEG = 180 / Math.PI;

/** 폰 롤(도). 입력이 유한하지 않거나 둘 다 0이면(방향 없음) null. */
export function phoneRollDeg(gx: number | null | undefined, gy: number | null | undefined): number | null {
  if (typeof gx !== "number" || typeof gy !== "number") return null;
  if (!Number.isFinite(gx) || !Number.isFinite(gy)) return null;
  if (gx === 0 && gy === 0) return null;
  return PHONE_ROLL_SIGN * Math.atan2(gx, gy) * RAD2DEG;
}

/** 각을 (−180, 180] 로 감는다. */
export function wrapDeg(d: number): number {
  if (!Number.isFinite(d)) return Number.NaN;
  let r = d % 360;
  if (r <= -180) r += 360;
  if (r > 180) r -= 360;
  return r;
}

/** a − b 를 (−180, 180] 로 감은 값. 179° 와 −179° 의 차는 −2°(358° 가 아님). */
export function angleDiffDeg(a: number, b: number): number {
  return wrapDeg(a - b);
}

/**
 * 각도의 원형 평균(도). atan2(Σsin, Σcos).
 *
 * 곧게 든 폰이 ±180° 근처로 나오는 기기에서는 표본이 179°·−179° 로 갈라져 산술 평균이 0°
 * ("완벽하게 곧음")가 된다. 원형 평균은 180° 를 준다. 비유한 값이 섞이면 예외(stats 와 같은 원칙),
 * 빈 배열이나 방향이 상쇄돼 정할 수 없으면(합 벡터 길이 ≈ 0) null.
 */
export function circularMeanDeg(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  let s = 0;
  let c = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (typeof x !== "number" || !Number.isFinite(x)) throw new RangeError(`표본 ${i}번이 유한한 수가 아닙니다.`);
    s += Math.sin(x / RAD2DEG);
    c += Math.cos(x / RAD2DEG);
  }
  if (Math.hypot(s, c) / xs.length < 1e-9) return null;
  return wrapDeg(Math.atan2(s, c) * RAD2DEG);
}

/**
 * 각 표본을 원형 평균 대비 감은 차(−180, 180] 로 바꾼다. 평균을 정할 수 없으면 null.
 *
 * 폰 롤의 흔들림(σ·p95)은 이 값으로 요약한다. 원값을 그대로 요약하면 179°·−179° 가 섞여
 * 실제 퍼짐 1° 가 σ 200° 로 나온다(점검 페이지 8번 보고서).
 */
export function relToCircularMeanDeg(xs: readonly number[]): number[] | null {
  const m = circularMeanDeg(xs);
  return m === null ? null : xs.map((x) => angleDiffDeg(x, m));
}
