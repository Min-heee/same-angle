/**
 * 짧은 확인음. 후면 카메라로 자기 얼굴을 찍으면 화면을 볼 수 없으므로(한 손·혼자 점검)
 * 카운트다운·기록 시작·끝을 소리로 알린다. 아이폰에는 진동(navigator.vibrate)도 없어
 * 이 소리가 유일한 신호다.
 *
 * 아이폰에서 소리가 나려면 세 가지가 맞아야 한다.
 *  1. AudioContext 를 **활성화 이벤트** 안에서 만들거나 resume 해야 한다. 터치의 pointerdown·
 *     touchstart 는 활성화가 아니고(HTML 명세, WebKit 은 iOS 9 부터 touchstart 잠금 해제를 막음),
 *     touchend·click·keydown 이 활성화다. 그래서 unlockAudio 를 그 이벤트마다 부르고(한 번에
 *     실패해도 다음 탭에서 다시), 소리를 내는 버튼의 클릭 핸들러 첫 줄에서도 부른다.
 *  2. 컨텍스트가 멈춰 있으면(suspended·interrupted — 전화, 다른 앱 소리, 백그라운드) 다시
 *     resume 해야 한다. beep 이 매번 확인한다. 카메라를 쓰는 중인 페이지는 제스처 밖 resume 도
 *     허용된다(WebKit 자동 재생 정책).
 *  3. Web Audio 는 벨/무음 스위치를 따른다. 사파리 16.4+ 의 navigator.audioSession 을
 *     "playback" 으로 두면 스위치와 상관없이 난다. 없는 브라우저에서는 화면에 무음 모드를
 *     끄라고 적는다.
 *
 * 소리가 안 나도 점검은 계속된다(실패를 삼킨다 — 소리는 측정값이 아니다). 대신 상태를
 * audioState() 로 보고서(0번 환경)에 남긴다.
 */

let ctx: AudioContext | null = null;

type AudioSessionLike = { type: string };

function audioSession(): AudioSessionLike | null {
  const nav = navigator as Navigator & { audioSession?: AudioSessionLike };
  return nav.audioSession ?? null;
}

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  const AC =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

/** 멈춘 컨텍스트를 다시 돌린다. 실패는 삼킨다(다음 탭에서 다시 시도). */
function resumeIfNeeded(c: AudioContext): void {
  if (c.state === "running") return;
  c.resume().catch(() => {
    /* 다음 활성화 이벤트에서 다시 */
  });
}

/**
 * 활성화 이벤트(touchend·click·keydown) 안에서 부른다. 몇 번을 불러도 된다.
 * 처음이면 컨텍스트를 만들고, 오디오 세션을 playback 으로 두고, 무음 버퍼 한 개를 재생해
 * 구형 iOS 의 잠금도 푼다.
 */
export function unlockAudio(): void {
  try {
    const session = audioSession();
    if (session && session.type !== "playback") session.type = "playback";
  } catch {
    /* 세션 종류를 못 바꾸면 무음 스위치를 따른다 — 화면 안내로 대신한다 */
  }
  try {
    const c = ensureCtx();
    if (!c) return;
    if (c.state !== "running") {
      const buf = c.createBuffer(1, 1, 22050);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.start(0);
    }
    resumeIfNeeded(c);
  } catch {
    /* 소리 없이 진행 */
  }
}

export interface AudioState {
  /** AudioContext.state. 만들기 전이면 "none", 이 브라우저에 없으면 "unsupported". */
  context: string;
  /** navigator.audioSession.type. 없으면 null(무음 스위치를 따름). */
  session: string | null;
}

export function audioState(): AudioState {
  let session: string | null = null;
  try {
    session = audioSession()?.type ?? null;
  } catch {
    session = null;
  }
  if (ctx) return { context: ctx.state, session };
  const has =
    typeof window.AudioContext === "function" ||
    typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext === "function";
  return { context: has ? "none" : "unsupported", session };
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
    const c = ensureCtx();
    if (!c) return;
    resumeIfNeeded(c);
    const { freq, ms, times } = TONES[kind];
    for (let i = 0; i < times; i++) {
      const start = c.currentTime + i * ((ms + 80) / 1000);
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + ms / 1000);
      osc.connect(gain).connect(c.destination);
      osc.start(start);
      osc.stop(start + ms / 1000 + 0.02);
    }
  } catch {
    /* 소리 없이 진행 */
  }
}
