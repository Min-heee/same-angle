/**
 * detectForVideo 타임스탬프를 단조 증가시키는 순수 함수.
 *
 * MediaPipe VIDEO 모드는 같은 값이나 줄어든 타임스탬프를 받으면 예외를 낸다.
 * performance.now() 는 보통 증가하지만,
 * 같은 엔진에 루프와 "같은 프레임 비교" 버튼이 번갈아 프레임을 넣으면 같은 ms 안에
 * 두 번 들어갈 수 있다. 그래서 직전 값보다 최소 1ms 크게 만든다.
 * (내부에서 µs 정수로 바꾸므로 1ms 간격이면 충분히 구별된다[추론].)
 */
export const MIN_STEP_MS = 1;

export function nextTimestamp(last: number | null, now: number): number {
  if (!Number.isFinite(now)) throw new RangeError(`now 가 유한하지 않습니다: ${now}`);
  if (last === null || !Number.isFinite(last)) return now;
  return now >= last + MIN_STEP_MS ? now : last + MIN_STEP_MS;
}
