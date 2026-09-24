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
