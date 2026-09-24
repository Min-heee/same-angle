/**
 * 얼굴 랜드마크(정규화 좌표)에서 픽셀 박스·중심·크기 비율·경계 접촉을 구한다.
 *
 * 정규화 좌표의 x 는 폭으로, y 는 높이로 나눈 값이라 두 축의 단위가 다르다. 그래서
 * 먼저 픽셀로 되돌린 뒤 계산한다(틀려도 오류 없이 각도만 어긋나는 조용한 버그다).
 *
 * H2(PRD 5절): "랜드마크 박스 짧은 변이 영상 짧은 변의 20% 미만, 또는 박스가 화면 경계에 걸침".
 * 여기서는 그 재료(shortSideRatio, touchesEdge)만 계산하고 20% 같은 문턱은 두지 않는다.
 * 문턱은 D1 실측 뒤 규칙 상수로 따로 정한다.
 *
 * 순수 함수다.
 */

export interface NormPoint {
  x: number;
  y: number;
}

export interface FaceBox {
  /** 픽셀 좌표. 랜드마크가 화면 밖으로 조금 나가면 음수나 프레임보다 큰 값도 그대로 둔다. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  /** 박스 중심(픽셀). */
  cx: number;
  cy: number;
  /** 박스 짧은 변 ÷ 프레임 짧은 변. H2 의 "20% 미만" 판단 재료. */
  shortSideRatio: number;
  /**
   * 중심을 프레임 짧은 변으로 나눈 값. 위치 지표(TECH-NOTES 2.3: 중심 차 ÷ 짧은 변)를
   * 두 축에 같은 눈금으로 비교하려고 폭·높이가 아니라 짧은 변 하나로 나눈다.
   */
  centerShort: { x: number; y: number };
  /** 박스가 프레임 가장자리에서 여백(px) 안으로 들어오거나 밖으로 나갔는가. */
  touchesEdge: boolean;
}

/**
 * @param edgeMarginPx 이 픽셀 수 이내로 가장자리에 붙으면 "걸침"으로 본다. 0 이면 딱 닿거나 넘을 때만.
 * @returns 점이 없거나, 좌표·크기가 유한하지 않거나, 크기가 0 이하면 null.
 */
export function faceBox(
  landmarks: readonly NormPoint[],
  frameWidth: number,
  frameHeight: number,
  edgeMarginPx: number,
): FaceBox | null {
  if (!(frameWidth > 0) || !(frameHeight > 0)) return null;
  if (!Number.isFinite(frameWidth) || !Number.isFinite(frameHeight)) return null;
  if (!Number.isFinite(edgeMarginPx) || edgeMarginPx < 0) return null;
  if (landmarks.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of landmarks) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    const x = p.x * frameWidth;
    const y = p.y * frameHeight;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const frameShort = Math.min(frameWidth, frameHeight);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const touchesEdge =
    minX <= edgeMarginPx ||
    minY <= edgeMarginPx ||
    maxX >= frameWidth - edgeMarginPx ||
    maxY >= frameHeight - edgeMarginPx;

  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    cx,
    cy,
    shortSideRatio: Math.min(width, height) / frameShort,
    centerShort: { x: cx / frameShort, y: cy / frameShort },
    touchesEdge,
  };
}
