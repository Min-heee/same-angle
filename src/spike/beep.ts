/**
 * 짧은 확인음. 후면 카메라로 자기 얼굴을 찍으면 화면을 볼 수 없으므로(한 손·혼자 점검)
 * 카운트다운·기록 시작·끝을 소리로 알린다.
 *
 * iOS 는 사용자 제스처 안에서 AudioContext 를 만들거나 resume 해야 소리가 난다.
 * 그래서 첫 탭에서 unlock() 을 부른다. 소리가 안 나도 점검은 계속된다(실패를 삼킨다 —
 * 소리는 측정값이 아니다).
 */

let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* 소리 없이 진행 */
  }
}

export type BeepKind = "tick" | "start" | "end" | "error";

const TONES: Record<BeepKind, { freq: number; ms: number; times: number }> = {
  tick: { freq: 660, ms: 90, times: 1 },
  start: { freq: 990, ms: 180, times: 1 },
  end: { freq: 880, ms: 120, times: 2 },
  error: { freq: 220, ms: 350, times: 1 },
};

export function beep(kind: BeepKind): void {
  try {
    if (!ctx) return;
    const { freq, ms, times } = TONES[kind];
    for (let i = 0; i < times; i++) {
      const start = ctx.currentTime + i * ((ms + 80) / 1000);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + ms / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + ms / 1000 + 0.02);
    }
  } catch {
    /* 소리 없이 진행 */
  }
}
