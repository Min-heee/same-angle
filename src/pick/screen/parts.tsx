"use client";

/**
 * 고르기 화면의 조각들. 전부 **받은 값만 그린다** — 판정·계산은 `view.ts`(엔진의 결과를 꺼낸 것)에서
 * 끝났고, 여기에는 화면 안에서만 쓰는 보기 상태(나란히/겹쳐, 보정본/원본, 투명도)만 있다.
 *
 * 문구 규칙(PRD F18·F20): 라벨은 "기준 사진 / 이번 사진"뿐, 전후 표현·화살표·판정 배지 장식 없음,
 * 방향을 말하는 문장 없음. 통과 기준을 넘는 장면에는 "가까운 장면"이라는 말을 붙이지 않는다.
 */

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { SourceKind } from "../pipeline";
import { RULES, RULES_VERSION } from "../rules";
import { SHOT_KINDS, type ShotKind } from "../record";
import { failureText, type Failure } from "./failure";
import { MEMO_MAX, RETAKE_REASONS, stepNumber, type CandidateImages, type ExportState, type Step } from "./flow";
import {
  BURST_HOW,
  BURST_NAMES_STAY,
  BURST_TIPS,
  BURST_WHEN,
  CAMERA_SETTINGS,
  MOVE_RANGE,
  MOVE_STEPS,
  NOT_FOR,
  PHONE_TIPS,
  PRECHECK,
  SAY,
  SHOT_CAVEAT,
  SHOT_LABEL,
  VIDEO_LENGTH,
  VIDEO_STAYS,
} from "./guide";
import s from "./pick.module.css";
import {
  LABEL_CORRECTED,
  LABEL_CURRENT,
  LABEL_ORIGINAL,
  LABEL_REFERENCE,
  type HoldBackView,
  type ProgressView,
  type ResultView,
  type SaveGate,
  type TracePlot,
} from "./view";

const STEP_NAMES: [Step, string][] = [
  ["reference", "기준 사진"],
  // 동영상 1개 또는 연사로 찍은 사진 여러 장(PRD v0.3.1).
  ["video", "동영상·사진"],
  ["analyzing", "분석"],
  // 저장은 결과 화면 맨 아래에 있다. 단계 표시줄에 없는 "⑤"를 따로 두지 않는다.
  ["result", "결과·저장"],
];

export function Stepper({ step }: { step: Step }) {
  const now = stepNumber(step);
  return (
    <ol className={s.steps} aria-label="진행 단계">
      {STEP_NAMES.map(([key, name], i) => {
        const n = i + 1;
        const cls = n === now ? s.stepNow : n < now ? s.stepDone : "";
        return (
          <li key={key} className={`${s.stepItem} ${cls}`} aria-current={n === now ? "step" : undefined}>
            {n}. {name}
          </li>
        );
      })}
    </ol>
  );
}

/** 멈춘 이유와 다음에 할 일. 개발자용 원문은 접어 둔다. */
export function FailureBox({ failure, children }: { failure: Failure; children?: ReactNode }) {
  const t = failureText(failure);
  return (
    <div className={s.bad} role="alert">
      <p className={s.boxTitle}>{t.message}</p>
      {t.note ? <p className={s.boxNote}>{t.note}</p> : null}
      {children}
      {t.detail ? (
        <details className={s.details}>
          <summary>자세히(개발자용)</summary>
          <p className={s.raw}>{t.detail}</p>
        </details>
      ) : null}
    </div>
  );
}

/** 파일 고르기 버튼. 고른 뒤 값을 비워 같은 파일을 다시 고를 수 있게 한다. */
export function FilePick(props: {
  label: string;
  accept: string;
  /** 있으면 폰에서 카메라를 바로 연다. */
  capture?: "environment" | "user";
  secondary?: boolean;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) props.onFile(file);
  };
  const cls = `${props.secondary ? s.btnSecondary : s.btn} ${s.filePick} ${props.disabled ? s.btnDisabled : ""}`;
  return (
    <label className={cls}>
      {props.label}
      <input
        className={s.fileInput}
        type="file"
        accept={props.accept}
        capture={props.capture}
        disabled={props.disabled}
        onChange={onChange}
      />
    </label>
  );
}

/** 사진 여러 장을 한꺼번에 고르는 버튼(연사). 카메라를 열지 않고 파일만 받는다. */
export function MultiFilePick(props: {
  label: string;
  accept: string;
  secondary?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length > 0) props.onFiles(files);
  };
  const cls = `${props.secondary ? s.btnSecondary : s.btn} ${s.filePick} ${props.disabled ? s.btnDisabled : ""}`;
  return (
    <label className={cls}>
      {props.label}
      <input
        className={s.fileInput}
        type="file"
        accept={props.accept}
        multiple
        disabled={props.disabled}
        onChange={onChange}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// ① 기준 사진

export function ReferenceStep(props: {
  shotKind: ShotKind;
  status: "empty" | "reading" | "ready" | "failed";
  failure: Failure | null;
  modelMessage: string | null;
  info: { width: number; height: number; previewUrl: string | null } | null;
  onShotKind: (kind: ShotKind) => void;
  onFile: (file: File) => void;
  onRetry: () => void;
  onNext: () => void;
}) {
  const busy = props.status === "reading";
  const caveat = SHOT_CAVEAT[props.shotKind];
  // 얼굴을 찾으면 미리보기부터 "다음" 버튼까지가 한 화면에 들어오게 그 자리로 내린다
  // (390px 폭에서 버튼이 화면 밖 아래에 있어 다음에 할 일이 보이지 않았다).
  // 이미 준비된 채로 이 단계에 돌아온 경우에는 옮기지 않는다(단계가 바뀌면 맨 위에서 시작한다).
  const readyRef = useRef<HTMLDivElement>(null);
  const ready = props.status === "ready";
  const wasReady = useRef(ready);
  const pendingScroll = useRef(false);
  const scrollToReady = () => readyRef.current?.scrollIntoView({ block: "start" });
  useEffect(() => {
    if (ready && !wasReady.current) {
      pendingScroll.current = true;
      scrollToReady();
    }
    wasReady.current = ready;
  }, [ready]);
  // 미리보기 그림이 뜨기 전에는 화면이 짧아 끝까지 내려가지 못한다. 그림이 뜬 뒤 한 번 더 맞춘다.
  const onPreviewLoad = () => {
    if (!pendingScroll.current) return;
    pendingScroll.current = false;
    scrollToReady();
  };
  return (
    <section className={s.card} aria-labelledby="pick-ref">
      <h2 id="pick-ref">① 지난번 사진 고르기</h2>
      <p className={s.p}>
        이번 사진과 견줄 지난 회차 사진(기준 사진) 한 장을 고릅니다. <strong>얼굴이 보이는 사진만</strong> 됩니다.
      </p>

      <span className={s.fieldLabel} id="pick-kind">
        어떤 사진인가요
      </span>
      <div className={`${s.seg} ${s.seg4}`} role="group" aria-labelledby="pick-kind">
        {SHOT_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={kind === props.shotKind}
            disabled={busy}
            onClick={() => props.onShotKind(kind)}
          >
            {SHOT_LABEL[kind]}
          </button>
        ))}
      </div>
      {caveat ? <p className={s.muted}>{caveat}</p> : null}

      <div className={s.actions}>
        <FilePick
          label={props.status === "ready" ? "다른 사진으로 바꾸기" : "기준 사진 고르기"}
          accept="image/*"
          secondary={props.status === "ready"}
          disabled={busy}
          onFile={props.onFile}
        />
      </div>

      <div aria-live="polite">
        {busy ? (
          <div className={s.info}>
            <p className={s.boxTitle}>사진에서 얼굴을 찾는 중입니다…</p>
            <p className={s.boxNote}>
              처음 한 번은 얼굴을 찾는 프로그램(약 16MB)을 받느라 시간이 걸립니다. 사진은 이 기기 안에서만 봅니다.
            </p>
            {props.modelMessage ? (
              // 얼굴 모델 라이브러리가 내는 진행 원문이다(용량·실행 방식). 촬영 담당이 읽을 말이 아니라 접어 둔다.
              <details className={s.details}>
                <summary>자세히(개발자용)</summary>
                <p className={s.raw}>{props.modelMessage}</p>
              </details>
            ) : null}
          </div>
        ) : null}

        {props.status === "failed" && props.failure ? (
          <FailureBox failure={props.failure}>
            {props.failure.kind !== "stop" ? (
              <div className={s.actions}>
                <button type="button" className={s.btnQuiet} onClick={props.onRetry}>
                  같은 사진으로 다시 해 보기
                </button>
              </div>
            ) : null}
          </FailureBox>
        ) : null}

        {props.status === "ready" && props.info ? (
          <div ref={readyRef} className={s.anchor}>
            {props.info.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- 기기 안의 blob 그림이다. 이미지 최적화 서버가 없다.
              <img className={s.preview} src={props.info.previewUrl} alt="고른 기준 사진" onLoad={onPreviewLoad} />
            ) : null}
            <div className={s.ok}>
              <p className={s.boxTitle}>얼굴을 찾았습니다.</p>
              <p className={s.boxNote}>
                사진 크기 {props.info.width}×{props.info.height}
              </p>
            </div>
            <p className={s.muted}>
              이 환자의 사진이 맞는지 확인해 주세요. 이 도구는 사람을 확인하지 않습니다.
            </p>
            <div className={s.actions}>
              <button type="button" className={s.btn} onClick={props.onNext}>
                다음: 동영상 고르기(또는 연사 사진)
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// ② 동영상

export function ShootGuide({ shotKind }: { shotKind: ShotKind }) {
  const say = SAY[shotKind];
  return (
    <div>
      <h3>찍는 방법({SHOT_LABEL[shotKind]})</h3>
      <p className={s.muted}>폰 기본 카메라로 {VIDEO_LENGTH}. 각도는 맞추려 하지 않아도 되지만 거리와 자리는 사람이 잡아야 합니다.</p>
      <ol className={s.list}>
        {MOVE_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className={s.muted}>{MOVE_RANGE}</p>
      <p className={s.say}>
        “{say.line}” {say.then}
      </p>
      {say.note ? <p className={s.muted}>{say.note}</p> : null}
      <p className={s.warn}>{NOT_FOR}</p>

      <details className={s.details}>
        <summary>찍기 전 확인 · 폰 놓는 법 · 카메라 설정</summary>
        <p className={s.fieldLabel}>찍기 전 확인</p>
        <ul className={s.list}>
          {PRECHECK.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className={s.fieldLabel}>폰과 화면</p>
        <ul className={s.list}>
          {PHONE_TIPS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className={s.fieldLabel}>카메라 설정(한 번만)</p>
        <table className={s.table}>
          <tbody>
            {CAMERA_SETTINGS.map((row) => (
              <tr key={row.setting}>
                <th scope="row">{row.setting}</th>
                <td>{row.recommend}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={s.small}>초안입니다. 아이폰 메뉴 이름은 실제 기기에서 확인하기 전입니다.</p>
      </details>
    </div>
  );
}

export function VideoStep(props: {
  shotKind: ShotKind;
  failure: Failure | null;
  cancelled: boolean;
  retakeCount: number;
  onFile: (file: File) => void;
  /** 연사로 찍은 사진 여러 장을 골랐을 때. */
  onPhotos?: (files: File[]) => void;
  onBack: () => void;
}) {
  return (
    <section className={s.card} aria-labelledby="pick-video">
      <h2 id="pick-video">② 동영상 또는 사진 여러 장 고르기</h2>
      <p className={s.p}>
        고개를 천천히 움직이며 찍은 동영상을 고르면, 기준 사진과 가장 가까운 장면을 찾아 줍니다. 동영상 대신 연사로 찍은 사진
        여러 장을 골라도 됩니다.
      </p>

      <div aria-live="polite">
        {props.cancelled ? <p className={s.info}>분석을 취소했습니다. 동영상을 다시 골라 주세요.</p> : null}
        {props.failure ? <FailureBox failure={props.failure} /> : null}
      </div>

      <div className={s.actions}>
        <FilePick label="동영상 고르기" accept="video/*" onFile={props.onFile} />
        <FilePick label="지금 바로 찍기" accept="video/*" capture="environment" secondary onFile={props.onFile} />
      </div>
      <p className={s.muted}>
        “지금 바로 찍기”는 폰에서만 카메라를 엽니다. 노트북에서는 파일 고르기 창이 뜹니다.
        {props.retakeCount > 0 ? ` 지금까지 다시 찍은 횟수: ${props.retakeCount}번.` : ""}
      </p>
      <p className={s.muted}>{VIDEO_STAYS}</p>

      <h3 id="pick-burst">또는 사진 여러 장(연사)</h3>
      <p className={s.p}>
        {BURST_HOW}. {BURST_WHEN}.
      </p>
      <div className={s.actions}>
        <MultiFilePick
          label="사진 여러 장 고르기(연사)"
          accept="image/*"
          secondary
          onFiles={props.onPhotos ?? (() => {})}
        />
      </div>
      <p className={s.muted}>
        한 번에 {RULES.photos.maxCount}장까지 봅니다. 더 고르면 파일 이름 순으로 앞 {RULES.photos.maxCount}장만 봅니다.{" "}
        {BURST_NAMES_STAY}
      </p>
      <details className={s.details}>
        <summary>연사로 찍는 요령</summary>
        <ul className={s.list}>
          {BURST_TIPS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className={s.small}>
          초안입니다. 실제 카메라로 찍은 사진으로는 아직 돌려 보지 못했습니다. 움직이는 범위와 찍기 전 확인은 아래 “찍는
          방법”과 같습니다.
        </p>
      </details>

      <ShootGuide shotKind={props.shotKind} />

      <div className={s.actions}>
        <button type="button" className={s.btnQuiet} onClick={props.onBack}>
          기준 사진 다시 고르기
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// ③ 분석

export function AnalyzingStep(props: {
  video: { width: number; height: number; durationSec: number } | null;
  /** 입력이 사진 여러 장이면 고른 수와 실제로 보는 수. */
  photos?: { selected: number; used: number } | null;
  progress: ProgressView;
  cancelling: boolean;
  truncatedSec: number | null;
  onCancel: () => void;
}) {
  const percent = Math.round(props.progress.fraction * 100);
  return (
    <section className={s.card} aria-labelledby="pick-run">
      <h2 id="pick-run">③ 분석하는 중</h2>
      {props.video ? (
        <p className={s.muted}>
          받은 동영상: {props.video.width}×{props.video.height}, {props.video.durationSec.toFixed(1)}초
          {props.truncatedSec !== null ? ` (앞 ${props.truncatedSec}초만 봅니다)` : ""}
        </p>
      ) : null}
      {props.photos ? (
        <p className={s.muted}>
          받은 사진: {props.photos.selected}장
          {props.photos.selected > props.photos.used ? ` (파일 이름 순으로 앞 ${props.photos.used}장만 봅니다)` : ""}. 한 장씩
          풀어 잽니다.
        </p>
      ) : null}

      <div
        className={s.progressTrack}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="분석 진행"
      >
        <div className={s.progressFill} style={{ width: `${percent}%` }} />
      </div>
      <p className={s.progressLabel}>{props.progress.label}</p>
      {props.progress.count ? <p className={s.count}>{props.progress.count}</p> : null}
      <div aria-live="polite">{props.progress.quick ? <p className={s.info}>{props.progress.quick}</p> : null}</div>

      <p className={s.warn}>
        끝날 때까지 이 화면을 켜 두세요. 화면이 꺼지거나 다른 앱으로 가면 분석이 멈출 수 있습니다.
      </p>
      <p className={s.muted}>사진과 동영상은 이 기기 안에서만 처리하고 어디로도 보내지 않습니다.</p>

      <div className={s.actions}>
        <button type="button" className={s.btnSecondary} onClick={props.onCancel} disabled={props.cancelling}>
          {props.cancelling ? "취소하는 중…" : "취소"}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// ④ 결과

/** 자취 그림. 가운데 원이 통과 기준, 점이 동영상이 지나간 방향이다. 축에 왼쪽·오른쪽을 적지 않는다. */
export function TraceFigure({ plot, passDeg, source }: { plot: TracePlot; passDeg: number; source?: SourceKind }) {
  const c = plot.center;
  const photos = source === "photos";
  return (
    <figure className={s.figure}>
      <svg
        className={s.trace}
        viewBox={`0 0 ${plot.size} ${plot.size}`}
        role="img"
        aria-label={
          photos
            ? `사진 ${plot.points.length}장의 방향과 기준 방향. 가운데 원은 통과 기준 ${passDeg}도입니다.`
            : `동영상이 지나간 방향 ${plot.points.length}곳과 기준 방향. 가운데 원은 통과 기준 ${passDeg}도입니다.`
        }
      >
        {plot.rings.map((ring) => (
          <g key={ring.deg}>
            <circle className={s.traceRing} cx={c.x} cy={c.y} r={ring.r} />
            <text className={s.traceText} x={c.x + 3} y={c.y - ring.r + 11}>
              {ring.deg}°
            </text>
          </g>
        ))}
        <line className={s.traceAxis} x1={0} y1={c.y} x2={plot.size} y2={c.y} />
        <line className={s.traceAxis} x1={c.x} y1={0} x2={c.x} y2={plot.size} />
        <circle className={s.tracePass} cx={c.x} cy={c.y} r={plot.passRadius} />
        {plot.points.map((p) => (
          <circle
            key={p.timeSec}
            className={p.usable ? s.traceDot : s.traceDotOff}
            cx={p.x}
            cy={p.y}
            r={p.usable ? 2.5 : 3}
          />
        ))}
        {plot.chosen ? <circle className={s.traceChosen} cx={plot.chosen.x} cy={plot.chosen.y} r={7} /> : null}
      </svg>
      <figcaption className={s.legend}>
        가운데 색칠한 원이 기준 사진의 방향(통과 기준 {passDeg}°)이고, 점은{" "}
        {photos ? "사진 한 장 한 장의 방향" : "동영상이 지나간 방향"}입니다. 빈 점은 흔들림 등으로 뺀 장면, 굵은 원은 지금 보는
        장면입니다. 가로는 좌우, 세로는 위아래로 벗어난 정도이며 어림 그림입니다.
      </figcaption>
    </figure>
  );
}

/** 견주어 보는 방법. 후보를 바꿔도 그대로 남게 결과 화면(`ResultStep`)이 들고 있는다. */
export interface CompareState {
  mode: "side" | "overlay";
  variant: "corrected" | "original";
  /** 겹쳐 볼 때 이번 사진의 진하기(%). */
  opacity: number;
}

export const COMPARE_INITIAL: CompareState = { mode: "side", variant: "corrected", opacity: 50 };

/** 그림 한 장의 높이 상한(화면 높이의 %). 넓은 화면에서 그림과 진하기 조절이 한 화면에 들어오게 한다. */
const FRAME_MAX_VH = 62;

/** 기준 사진과 이번 사진을 나란히 또는 겹쳐 본다. 보정본/원본을 바꿔 볼 수 있다. */
export function CompareView(props: {
  referenceUrl: string | null;
  /** 기준 사진의 가로÷세로. 두 틀이 같은 모양이어야 겹쳐 볼 수 있다. */
  aspect: number;
  images: CandidateImages | null;
  imageStatus: "idle" | "rendering" | "ready" | "failed";
  correctionAvailable: boolean;
  timeText: string;
  /** 지금 보는 장면의 자리. 없으면 "동영상의 {timeText}". 사진 여러 장이면 "N번째 사진(파일 이름)". */
  whereText?: string;
  source?: SourceKind;
  state: CompareState;
  onState: (next: CompareState) => void;
}) {
  const { mode, variant, opacity } = props.state;
  const photos = props.source === "photos";
  const where = props.whereText ?? `동영상의 ${props.timeText}`;
  const set = (patch: Partial<CompareState>) => props.onState({ ...props.state, ...patch });

  const shown: CompareState["variant"] = props.correctionAvailable ? variant : "original";
  const url = shown === "corrected" ? props.images?.correctedUrl : props.images?.originalUrl;
  const variantLabel = shown === "corrected" ? LABEL_CORRECTED : LABEL_ORIGINAL;
  const aspect = props.aspect > 0 ? props.aspect : 0.75;
  const frameStyle = { aspectRatio: String(aspect) };
  // 틀의 폭을 "높이 상한 × 가로÷세로"로 묶어 높이를 누른다(폭 100%인 틀은 높이만으로 누를 수 없다).
  const oneFrame = `calc(${FRAME_MAX_VH}vh * ${aspect.toFixed(4)})`;
  const overlayStyle = { maxWidth: oneFrame };
  const sideStyle = { maxWidth: `calc(${oneFrame} * 2 + 8px)` };
  const waiting =
    props.imageStatus === "failed" ? "이 장면의 그림을 만들지 못했습니다. 숫자는 아래에 있습니다." : "그림을 만드는 중…";

  const current = (style?: { opacity: number }) =>
    url ? (
      // eslint-disable-next-line @next/next/no-img-element -- 기기 안의 blob 그림이다.
      <img src={url} alt={`${LABEL_CURRENT}: ${where}${photos ? "" : " 장면"}, ${variantLabel}`} style={style} />
    ) : (
      <span className={s.framePlaceholder}>{waiting}</span>
    );
  const reference = props.referenceUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- 기기 안의 blob 그림이다.
    <img src={props.referenceUrl} alt={LABEL_REFERENCE} />
  ) : (
    <span className={s.framePlaceholder}>기준 사진 그림을 만들지 못했습니다.</span>
  );

  return (
    <div>
      <div className={s.seg} role="group" aria-label="보는 방법">
        <button type="button" aria-pressed={mode === "side"} onClick={() => set({ mode: "side" })}>
          나란히
        </button>
        <button type="button" aria-pressed={mode === "overlay"} onClick={() => set({ mode: "overlay" })}>
          겹쳐 보기
        </button>
      </div>
      <div className={s.seg} role="group" aria-label="이번 사진의 종류">
        <button
          type="button"
          aria-pressed={shown === "corrected"}
          disabled={!props.correctionAvailable}
          onClick={() => set({ variant: "corrected" })}
        >
          맞춘 것
        </button>
        <button type="button" aria-pressed={shown === "original"} onClick={() => set({ variant: "original" })}>
          {photos ? "원본 사진" : "원본 장면"}
        </button>
      </div>

      {mode === "side" ? (
        <div className={s.side} style={sideStyle}>
          <figure className={s.figure}>
            <div className={s.frame} style={frameStyle}>
              {reference}
            </div>
            <figcaption className={s.caption}>{LABEL_REFERENCE}</figcaption>
          </figure>
          <figure className={s.figure}>
            <div className={s.frame} style={frameStyle}>
              {current()}
            </div>
            <figcaption className={s.caption}>
              {LABEL_CURRENT}
              <span className={s.captionSub}>
                {variantLabel} · {where}
              </span>
            </figcaption>
          </figure>
        </div>
      ) : (
        <div className={s.overlay} style={overlayStyle}>
          {/* 조절을 그림 위에 둔다: 그림 전체와 조절을 한 화면에서 함께 볼 수 있게. */}
          <label className={s.slider}>
            {LABEL_CURRENT} 진하기 {opacity}%
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={opacity}
              onChange={(e) => set({ opacity: Number(e.target.value) })}
            />
          </label>
          <figure className={s.figure}>
            <div className={s.frame} style={frameStyle}>
              {reference}
              {current({ opacity: opacity / 100 })}
            </div>
            <figcaption className={s.caption}>
              {LABEL_REFERENCE} 위에 {LABEL_CURRENT}
              <span className={s.captionSub}>
                {variantLabel} · {where}
              </span>
            </figcaption>
          </figure>
        </div>
      )}
      <p className={s.small}>
        맞춘 것은 회전·확대·이동만 했습니다. 좌우·위아래 각도와 원근은 바꾸지 않았고, {photos ? "사진" : "동영상"}에 찍히지 않은
        곳은 회색으로 비워 둡니다.{" "}
        {photos ? "“몇 번째 사진”은 고른 파일을 이름 순으로 세운 차례입니다." : "“동영상의 몇 초”는 근삿값입니다."}
      </p>
    </div>
  );
}

export function CandidateStrip(props: {
  candidates: ResultView["candidates"];
  images: Record<number, CandidateImages>;
  /** 기준 사진의 가로÷세로. 작은 그림의 틀을 같은 모양으로 잡아 가로 사진이 잘리지 않게 한다. */
  aspect: number;
  source?: SourceKind;
  onChoose: (rank: number) => void;
}) {
  const thumbStyle = { aspectRatio: String(props.aspect > 0 ? props.aspect : 0.75) };
  if (props.candidates.length <= 1) {
    return (
      <p className={s.muted}>
        {props.source === "photos"
          ? "바꿔 볼 다른 후보가 없습니다. 쓸 수 있는 사진이 한 장뿐입니다."
          : "바꿔 볼 다른 후보가 없습니다. 기준 자세에서 잠깐 멈춘 구간이 있어야 후보가 생깁니다."}
      </p>
    );
  }
  return (
    <div className={s.candidates} role="group" aria-label="후보 장면">
      {props.candidates.map((c) => {
        const thumb = props.images[c.rank]?.thumbUrl ?? null;
        return (
          <button
            key={c.rank}
            type="button"
            className={s.candidate}
            aria-pressed={c.chosen}
            aria-label={c.label}
            onClick={() => props.onChoose(c.rank)}
          >
            <span className={s.thumb} style={thumbStyle}>
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element -- 기기 안의 blob 그림이다.
                <img src={thumb} alt="" />
              ) : null}
            </span>
            {/* 이름은 누가 골랐는지(도구/후보), 아래 표시는 지금 무엇을 보고 있는지. 둘을 섞지 않는다. */}
            <span className={s.candidateName}>{c.name}</span>
            <span className={s.candidateLine}>{c.timeText}</span>
            <span className={s.candidateLine}>
              {c.angleText}
              {c.verdict === "close" ? " · 가까움" : ""}
            </span>
            {c.chosen ? <span className={s.candidateNow}>지금 보는 장면</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function NumberTable({ rows }: { rows: ResultView["rows"] }) {
  return (
    <dl className={s.kv}>
      {rows.map((row) => (
        <div key={row.label} style={{ display: "contents" }}>
          <dt>{row.label}</dt>
          <dd>
            {row.value}
            {row.hint ? <span className={s.kvHint}>{row.hint}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** 규칙 값(초깃값). 엔진의 `RULES` 를 그대로 읽는다 — 화면에 따로 적어 둔 숫자가 없다(F9). */
export function RulesTable() {
  return (
    <details className={s.details}>
      <summary>판정에 쓴 규칙 값 보기({RULES_VERSION})</summary>
      <p className={s.small}>전부 초깃값입니다. 실제 얼굴 동영상으로 재 본 뒤 확정합니다.</p>
      <dl className={s.kv}>
        {Object.entries(RULES).flatMap(([group, values]) =>
          Object.entries(values).map(([key, value]) => (
            <div key={`${group}.${key}`} style={{ display: "contents" }}>
              <dt>
                {group}.{key}
              </dt>
              <dd>{Number.isInteger(value) ? value : Number(value).toFixed(3)}</dd>
            </div>
          )),
        )}
      </dl>
    </details>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** 저장: 메모·사유를 적고 파일을 만든 뒤, 파일마다 눌러서 받는다. 결과 화면 맨 아래에 있다. */
export function SavePanel(props: {
  gate: SaveGate;
  memo: string;
  retakeReason: string | null;
  exportState: ExportState;
  imageReady: boolean;
  onMemo: (memo: string) => void;
  onReason: (reason: string) => void;
  onPrepare: () => void;
}) {
  const needReason = props.gate.needsReason && props.retakeReason === null;
  const preparing = props.exportState.status === "preparing";
  return (
    <div>
      <h3 id="pick-save" className={s.anchor}>
        저장
      </h3>
      {props.gate.notice ? <p className={s.warn}>{props.gate.notice}</p> : null}

      {props.gate.needsReason ? (
        <>
          <span className={s.fieldLabel} id="pick-reason">
            가까운 장면 없이 저장하는 사유
          </span>
          <div className={s.seg} role="group" aria-labelledby="pick-reason">
            {RETAKE_REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                aria-pressed={props.retakeReason === reason}
                onClick={() => props.onReason(reason)}
              >
                {reason}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <label className={s.fieldLabel}>
        메모(선택)
        <input
          className={s.input}
          type="text"
          value={props.memo}
          maxLength={MEMO_MAX}
          placeholder="예: 3회차"
          autoComplete="off"
          onChange={(e) => props.onMemo(e.target.value)}
        />
      </label>
      <p className={s.small}>
        메모는 파일 이름과 기록에 그대로 들어갑니다. 환자 이름 대신 병원에서 쓰는 번호를 적어 주세요.
      </p>

      {props.exportState.status !== "ready" ? (
        <div className={s.actions}>
          <button
            type="button"
            className={s.btn}
            onClick={props.onPrepare}
            disabled={preparing || needReason || !props.imageReady}
          >
            {preparing ? "저장할 파일을 만드는 중…" : "저장할 파일 만들기"}
          </button>
        </div>
      ) : null}
      {needReason ? <p className={s.small}>사유를 먼저 골라 주세요.</p> : null}

      <div aria-live="polite">
        {props.exportState.status === "failed" ? (
          <div className={s.bad} role="alert">
            <p className={s.boxTitle}>저장할 파일을 만들지 못했습니다. 다시 눌러 주세요.</p>
            {props.exportState.detail ? <p className={s.raw}>{props.exportState.detail}</p> : null}
          </div>
        ) : null}

        {props.exportState.status === "ready" ? (
          <>
            <p className={s.ok}>파일을 만들었습니다. 하나씩 눌러 저장해 주세요.</p>
            <div className={s.actions}>
              {props.exportState.files.map((file) => (
                <a key={file.kind} className={`${s.btn} ${s.fileLink}`} href={file.url} download={file.name}>
                  <span>{file.label} 저장</span>
                  <span className={s.fileSize}>{formatBytes(file.bytes)}</span>
                </a>
              ))}
            </div>
            <p className={s.small}>
              원본 장면이 기준이 되는 사진이고, 맞춘 것(보정본)은 견주어 보려고 만든 파생본입니다. 사진 아래 띠에 “내부 기록용 ·
              광고·홍보 사용 금지”가 들어갑니다. 저장한 뒤의 파일(사진 앱, 클라우드, 메신저)은 이 도구가 통제하지 못합니다.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function ResultStep(props: {
  view: ResultView;
  passDeg: number;
  referenceUrl: string | null;
  aspect: number;
  images: Record<number, CandidateImages>;
  chosenRank: number;
  imageStatus: "idle" | "rendering" | "ready" | "failed";
  showAnyway: boolean;
  hiddenDuringAnalysis: boolean;
  plot: TracePlot;
  gate: SaveGate;
  /** 가까운 장면이 없을 때 사진보다 먼저 보이는 안내(다시 찍기 상한을 채웠는지에 따라 달라진다). */
  holdBack: HoldBackView;
  memo: string;
  retakeReason: string | null;
  exportState: ExportState;
  onShowAnyway: () => void;
  onRetake: () => void;
  onReset: () => void;
  onChoose: (rank: number) => void;
  onMemo: (memo: string) => void;
  onReason: (reason: string) => void;
  onPrepare: () => void;
}) {
  const v = props.view;
  const photos = v.source === "photos";
  // 보는 방법(나란히/겹쳐, 맞춘 것/원본, 진하기)은 후보를 바꿔도 그대로 둔다.
  const [compare, setCompare] = useState<CompareState>(COMPARE_INITIAL);
  // 1등조차 통과 기준을 넘으면, 사진을 보여 주기 전에 다시 찍기를 먼저 권한다.
  const holdBack = v.noCloseScene && !props.showAnyway;
  const hb = props.holdBack;
  const act = (action: "retake" | "show") => (action === "retake" ? props.onRetake : props.onShowAnyway);
  // 다시 찍기 상한을 채운 뒤에는 "다시 찍기를 권합니다"를 되풀이하지 않는다. 그 자리에 같은 사실
  // (가장 가까운 장면은 N° 차이)과 지금 할 일을 적는다. 기록의 경고 코드(W1)는 그대로 남는다.
  const shownWarnings =
    v.noCloseScene && hb.exhausted && v.retakeAdvice !== null
      ? v.warnings.shown.map((w) => (w === v.retakeAdvice ? hb.message : w))
      : v.warnings.shown;
  const trace = (
    <>
      <h3>{photos ? "사진들이 본 방향" : "동영상이 지나간 방향"}</h3>
      <TraceFigure plot={props.plot} passDeg={props.passDeg} source={v.source} />
    </>
  );
  // 사진 묶음에 대한 알림(읽지 못한 사진, 상한, 크기가 섞임). 조용히 넘기지 않고 판정 바로 아래에 둔다.
  const inputNotices =
    v.inputNotices.length > 0 ? (
      <ul className={`${s.list} ${s.warn}`} aria-label="고른 사진 묶음에 대한 알림">
        {v.inputNotices.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    ) : null;

  return (
    <section className={s.card} aria-labelledby="pick-result">
      <h2 id="pick-result">④ 결과</h2>

      <div className={s.verdict} aria-live="polite">
        <p className={s.verdictTitle}>{v.title}</p>
        <p className={s.verdictSummary}>{v.summary}</p>
      </div>
      {props.hiddenDuringAnalysis ? (
        <p className={s.warn}>
          분석하는 동안 화면이 꺼졌거나 다른 앱으로 갔습니다. 결과가 이상해 보이면 같은 {photos ? "사진들" : "동영상"}으로 다시 해
          주세요.
        </p>
      ) : null}
      {inputNotices}

      {holdBack ? (
        <>
          <p className={s.warn}>{hb.message}</p>
          <div className={s.actions}>
            <button type="button" className={s.btn} onClick={act(hb.primary.action)}>
              {hb.primary.label}
            </button>
            <button type="button" className={s.btnSecondary} onClick={act(hb.secondary.action)}>
              {hb.secondary.label}
            </button>
          </div>
          {trace}
        </>
      ) : (
        <>
          {/* 경고는 사진보다 먼저 보인다. 사진 절반이 비었거나 많이 늘려 그린 결과를 "가까운 장면을
              골랐습니다"만 보고 넘기지 않게, 판정 상자 바로 아래에 둔다. */}
          {shownWarnings.length > 0 ? (
            <>
              <h3>알아 둘 것</h3>
              <ul className={`${s.list} ${s.warn}`}>
                {shownWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              {v.warnings.folded.length > 0 ? (
                <details className={s.details}>
                  <summary>알아 둘 것 {v.warnings.folded.length}개 더 보기</summary>
                  <ul className={s.list}>
                    {v.warnings.folded.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : null}
          {v.notes.length > 0 ? (
            <ul className={`${s.list} ${s.muted}`}>
              {v.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}

          <CompareView
            referenceUrl={props.referenceUrl}
            aspect={props.aspect}
            images={props.images[props.chosenRank] ?? null}
            imageStatus={props.imageStatus}
            correctionAvailable={v.correctionAvailable}
            timeText={v.timeText}
            whereText={v.whereText}
            source={v.source}
            state={compare}
            onState={setCompare}
          />

          <h3>차이 숫자</h3>
          <NumberTable rows={v.keyRows} />
          <p className={s.jump}>
            <a href="#pick-save">저장은 이 화면 맨 아래에 있습니다. 저장으로 가기</a>
          </p>

          <h3>다른 후보로 바꾸기</h3>
          <p className={s.muted}>눈을 감았거나 표정이 다르면 다른 후보를 눌러 바꿉니다. 후보마다 따로 판정합니다.</p>
          <CandidateStrip
            candidates={v.candidates}
            images={props.images}
            aspect={props.aspect}
            source={v.source}
            onChoose={props.onChoose}
          />

          <ul className={`${s.list} ${s.info}`}>
            {v.always.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <details className={s.details}>
            <summary>숫자 더 보기</summary>
            <NumberTable rows={v.moreRows} />
            <RulesTable />
          </details>

          {trace}

          <SavePanel
            gate={props.gate}
            memo={props.memo}
            retakeReason={props.retakeReason}
            exportState={props.exportState}
            imageReady={props.imageStatus === "ready"}
            onMemo={props.onMemo}
            onReason={props.onReason}
            onPrepare={props.onPrepare}
          />

          <div className={s.actions}>
            <button type="button" className={s.btnSecondary} onClick={props.onRetake}>
              {photos ? "다른 사진들이나 동영상으로 다시 하기" : "다른 동영상으로 다시 하기"}
            </button>
          </div>
        </>
      )}

      <div className={s.actions}>
        <button type="button" className={s.btnQuiet} onClick={props.onReset}>
          처음부터(다른 기준 사진)
        </button>
      </div>
    </section>
  );
}

/** 결과를 내지 못하고 멈춘 경우(쓸 수 있는 장면 없음 등). */
export function StoppedStep(props: {
  failure: Failure;
  plot: TracePlot | null;
  passDeg: number;
  /** 사진 묶음에 대한 알림(읽지 못한 사진 수 등). 동영상이면 없다. */
  notices?: readonly string[];
  onRetake: () => void;
  onReset: () => void;
}) {
  const photos = props.failure.kind === "stop" && props.failure.source === "photos";
  return (
    <section className={s.card} aria-labelledby="pick-stopped">
      <h2 id="pick-stopped">④ 결과</h2>
      <FailureBox failure={props.failure} />
      {props.notices && props.notices.length > 0 ? (
        <ul className={`${s.list} ${s.warn}`} aria-label="고른 사진 묶음에 대한 알림">
          {props.notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      <div className={s.actions}>
        <button type="button" className={s.btn} onClick={props.onRetake}>
          {failureText(props.failure).action}
        </button>
        <button type="button" className={s.btnQuiet} onClick={props.onReset}>
          처음부터(다른 기준 사진)
        </button>
      </div>
      {props.plot && props.plot.points.length > 0 ? (
        <>
          <h3>{photos ? "사진들이 본 방향" : "동영상이 지나간 방향"}</h3>
          <TraceFigure plot={props.plot} passDeg={props.passDeg} source={photos ? "photos" : "video"} />
        </>
      ) : null}
    </section>
  );
}
