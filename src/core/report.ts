/**
 * D1 실기기 점검 결과(JSON) 스키마: 빌더와 검증기.
 *
 * 오너가 아이폰에서 점검 페이지를 돌리고 이 JSON 을 개발 대화창에 붙여 넣는다.
 * 그래서 두 가지를 스키마 수준에서 막는다.
 *
 *  1. **얼굴이 담긴 것은 들어가지 않는다.** 이미지·랜드마크 좌표는 필드가 없고, 자유 형식인
 *     섹션 데이터에도 `landmarks`·`image` 같은 키, `data:` URL, 긴 문자열·긴 배열, base64 로
 *     보이는 긴 연속 문자를 거부한다. 노드 하나의 길이만 보면 여러 노드로 쪼개 빠져나갈 수
 *     있으므로(랜드마크를 239점씩 두 배열로, base64 를 2000자씩 300조각으로) 섹션마다
 *     수 개수·글자 수 총량도 센다.
 *     픽스처는 행렬 16개 숫자와 이름(그리고 그때 분해한 각)뿐이다(TECH-NOTES 5절 실측 픽스처).
 *     한계: 총량 한도는 "통째로"를 막는다. 몇 점, 작은 조각까지 막는다는 증명은 아니고,
 *     그 나머지는 "섹션 데이터에는 이름 붙인 요약 숫자만 넣는다"는 점검 페이지 코드가 맡는다.
 *  2. **빠진 값을 채우지 않는다.** 필드 누락·모르는 필드·비유한 수·버전 불일치는 거부한다.
 *     기본값으로 채우면 "재지 않음"과 "0으로 잼"이 구별되지 않는다(PRD F1 과 같은 원칙).
 *     재지 않은 값은 호출하는 쪽이 명시적으로 null 을 넣는다.
 *
 * 순수 함수다. 시계를 부르지 않는다(createdAt 은 호출하는 쪽이 넣는다).
 */

export const REPORT_KIND = "same-angle-d1-report";
/** 스키마를 바꾸면 올린다. 다른 버전은 읽지 않는다. */
export const REPORT_VERSION = 1;

/** TECH-NOTES 6절 체크리스트를 점검 페이지의 0~11번 섹션으로 나눈 키. 12번(내보내기)이 이 보고서다. */
export const SECTION_KEYS = [
  "env",
  "camera",
  "face",
  "jitter",
  "fixtures",
  "sameFrame",
  "takePhoto",
  "exif",
  "motion",
  "pixelCost",
  "share",
  "network",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_STATUSES = ["idle", "running", "done", "failed"] as const;
export type SectionStatus = (typeof SECTION_STATUSES)[number];

/** 자세 픽스처 6개(TECH-NOTES 5절: 정면, 자기 왼쪽·오른쪽 약 20°, 숙임, 젖힘, 기울임). */
export const FIXTURE_NAMES = ["front", "selfLeft20", "selfRight20", "chinDown", "chinUp", "tilt"] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface SectionResult {
  status: SectionStatus;
  /** 실패·보류 이유. 없으면 null. */
  reason: string | null;
  /** 섹션별 측정값. 자유 형식이지만 아래 검사(금지 키·길이·유한성)를 통과해야 한다. */
  data: JsonValue;
}

export interface FixtureRecord {
  name: FixtureName;
  /** MediaPipe Matrix.data 순서 그대로 16개. */
  matrix: number[];
  /** 그때 판별한 배치. 판별 못 했으면 null. */
  layout: "col" | "row" | null;
  /** 그때 분해한 각(도). 분해 못 했으면 null. */
  angles: { yaw: number; pitch: number; roll: number } | null;
  /** 원소별 중앙값에 들어간 프레임 수. */
  frames: number;
}

export interface DeviceInfo {
  userAgent: string;
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
}

export interface ManualChecks {
  /** 공유 시트로 보낸 파일이 파일 앱에 이름 그대로 저장됐는가. 안 해 봤으면 null. */
  filesAppNamesKept: boolean | null;
  /** <img> 길게 눌러 저장이 됐는가. 안 해 봤으면 null. */
  longPressSaved: boolean | null;
}

export interface Report {
  kind: typeof REPORT_KIND;
  version: typeof REPORT_VERSION;
  /** ISO 8601 (Date.toISOString()). */
  createdAt: string;
  device: DeviceInfo;
  sections: Record<SectionKey, SectionResult>;
  fixtures: FixtureRecord[];
  manualChecks: ManualChecks;
}

/** 섹션 데이터에 올 수 없는 키(대소문자 무시). 얼굴 좌표·이미지가 섞여 들어오는 길을 막는다. */
export const FORBIDDEN_KEYS = [
  "landmarks",
  "facelandmarks",
  "image",
  "imagedata",
  "photo",
  "pixels",
  "dataurl",
  "blob",
  "bitmap",
] as const;

/** 섹션 데이터의 노드 하나 한계. 이미지 base64(수십 KB)·랜드마크 478점을 한 노드에 못 넣게 하는 크기. */
export const MAX_STRING_LENGTH = 2000;
export const MAX_ARRAY_LENGTH = 300;
export const MAX_DEPTH = 8;

/**
 * 섹션 하나(reason + data)의 총량 한계. 노드 한계는 쪼개면 빠져나가므로 합계로 다시 막는다.
 *
 *  - 수 900개: 얼굴 랜드마크 478점은 x·y 만 넣어도 956개라 들어가지 않는다. 점검 페이지에서
 *    수가 가장 많은 섹션(흔들림 기록 10회 ≈ 760개)은 들어간다. 섹션의 보관 개수를 늘리면
 *    이 한도를 먼저 확인한다(내보내기가 통째로 막힌다).
 *  - 글자 24,000자(키 이름 포함): 수백 KB 짜리 사진 base64 는 들어가지 않는다. 가장 긴
 *    섹션(카메라 시도 기록 20건 × 오류 문장 400자 + 설정)은 들어간다.
 */
export const MAX_SECTION_NUMBERS = 900;
export const MAX_SECTION_CHARS = 24_000;

/**
 * base64 알파벳(영숫자 + / - _ =)이 이만큼 이어지면 거부한다. 사람이 읽는 문자열(오류 문장·
 * userAgent·URL)은 공백이나 점·쌍점에서 끊기므로 이 길이가 나오지 않는다.
 */
export const MAX_BASE64_RUN = 256;

/** 픽스처 개수 한계. 이름은 6개지만 같은 이름을 여러 번 남길 여지를 둔다. */
export const MAX_FIXTURES = 60;
const BASE64_RUN = new RegExp(`[A-Za-z0-9+/=_-]{${MAX_BASE64_RUN},}`);

export class ReportValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`보고서 검증 실패: ${errors.join(" / ")}`);
    this.name = "ReportValidationError";
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------

type Errors = string[];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function checkKeys(obj: Record<string, unknown>, allowed: readonly string[], path: string, errors: Errors) {
  for (const k of allowed) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) errors.push(`${path}.${k}: 없음`);
  }
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) errors.push(`${path}.${k}: 모르는 필드`);
  }
}

function checkFiniteNumber(v: unknown, path: string, errors: Errors): v is number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    errors.push(`${path}: 유한한 수가 아님`);
    return false;
  }
  return true;
}

function checkString(v: unknown, path: string, errors: Errors): v is string {
  if (typeof v !== "string") {
    errors.push(`${path}: 문자열이 아님`);
    return false;
  }
  return true;
}

function checkNullableBoolean(v: unknown, path: string, errors: Errors) {
  if (v !== null && typeof v !== "boolean") errors.push(`${path}: true/false/null 이 아님`);
}

/** 섹션 하나를 검사하는 동안 쌓는 총량. */
interface Budget {
  numbers: number;
  chars: number;
}

const newBudget = (): Budget => ({ numbers: 0, chars: 0 });

/** 자유 형식 JSON 값 검사: 유한 수·금지 키·data URL·base64 연속·길이·깊이, 그리고 총량 누적. */
function checkJson(v: unknown, path: string, depth: number, errors: Errors, budget: Budget): void {
  if (depth > MAX_DEPTH) {
    errors.push(`${path}: 너무 깊음(>${MAX_DEPTH})`);
    return;
  }
  if (v === null || typeof v === "boolean") return;
  if (typeof v === "number") {
    budget.numbers++;
    if (!Number.isFinite(v)) errors.push(`${path}: 유한한 수가 아님`);
    return;
  }
  if (typeof v === "string") {
    budget.chars += v.length;
    if (v.length > MAX_STRING_LENGTH) errors.push(`${path}: 문자열이 너무 김(${v.length})`);
    if (/^\s*data:/i.test(v)) errors.push(`${path}: data: URL 은 넣을 수 없음`);
    if (BASE64_RUN.test(v)) errors.push(`${path}: base64 로 보이는 연속 문자(${MAX_BASE64_RUN}자 이상)`);
    return;
  }
  if (Array.isArray(v)) {
    if (v.length > MAX_ARRAY_LENGTH) errors.push(`${path}: 배열이 너무 김(${v.length})`);
    v.forEach((x, i) => checkJson(x, `${path}[${i}]`, depth + 1, errors, budget));
    return;
  }
  if (isPlainObject(v)) {
    for (const [k, x] of Object.entries(v)) {
      budget.chars += k.length;
      if ((FORBIDDEN_KEYS as readonly string[]).includes(k.toLowerCase())) {
        errors.push(`${path}.${k}: 이미지·랜드마크 키는 넣을 수 없음`);
        continue;
      }
      checkJson(x, `${path}.${k}`, depth + 1, errors, budget);
    }
    return;
  }
  // undefined·함수·Date·Map 등은 JSON 으로 왕복하지 않는다.
  errors.push(`${path}: JSON 값이 아님(${v === undefined ? "undefined" : typeof v})`);
}

function checkBudget(budget: Budget, path: string, errors: Errors) {
  if (budget.numbers > MAX_SECTION_NUMBERS) {
    errors.push(`${path}: 수가 너무 많음(${budget.numbers} > ${MAX_SECTION_NUMBERS})`);
  }
  if (budget.chars > MAX_SECTION_CHARS) {
    errors.push(`${path}: 글자가 너무 많음(${budget.chars} > ${MAX_SECTION_CHARS})`);
  }
}

function checkSection(v: unknown, path: string, errors: Errors) {
  if (!isPlainObject(v)) {
    errors.push(`${path}: 객체가 아님`);
    return;
  }
  checkKeys(v, ["status", "reason", "data"], path, errors);
  if (!(SECTION_STATUSES as readonly unknown[]).includes(v.status)) {
    errors.push(`${path}.status: ${SECTION_STATUSES.join("/")} 중 하나가 아님`);
  }
  if (v.reason !== null && typeof v.reason !== "string") errors.push(`${path}.reason: 문자열/null 이 아님`);
  const budget = newBudget();
  if (typeof v.reason === "string") checkJson(v.reason, `${path}.reason`, 1, errors, budget);
  if ("data" in v) checkJson(v.data, `${path}.data`, 1, errors, budget);
  checkBudget(budget, path, errors);
}

function checkFixture(v: unknown, path: string, errors: Errors) {
  if (!isPlainObject(v)) {
    errors.push(`${path}: 객체가 아님`);
    return;
  }
  checkKeys(v, ["name", "matrix", "layout", "angles", "frames"], path, errors);
  if (!(FIXTURE_NAMES as readonly unknown[]).includes(v.name)) {
    errors.push(`${path}.name: ${FIXTURE_NAMES.join("/")} 중 하나가 아님`);
  }
  if (!Array.isArray(v.matrix) || v.matrix.length !== 16) {
    errors.push(`${path}.matrix: 16개 숫자가 아님`);
  } else {
    v.matrix.forEach((x, i) => checkFiniteNumber(x, `${path}.matrix[${i}]`, errors));
  }
  if (v.layout !== null && v.layout !== "col" && v.layout !== "row") {
    errors.push(`${path}.layout: col/row/null 이 아님`);
  }
  if (v.angles !== null) {
    if (!isPlainObject(v.angles)) {
      errors.push(`${path}.angles: 객체/null 이 아님`);
    } else {
      checkKeys(v.angles, ["yaw", "pitch", "roll"], `${path}.angles`, errors);
      for (const k of ["yaw", "pitch", "roll"]) {
        if (k in v.angles) checkFiniteNumber(v.angles[k], `${path}.angles.${k}`, errors);
      }
    }
  }
  if (checkFiniteNumber(v.frames, `${path}.frames`, errors)) {
    if (!Number.isInteger(v.frames) || v.frames < 1) errors.push(`${path}.frames: 1 이상의 정수가 아님`);
  }
}

function collectErrors(x: unknown): Errors {
  const errors: Errors = [];
  if (!isPlainObject(x)) return ["보고서가 객체가 아님"];

  checkKeys(x, ["kind", "version", "createdAt", "device", "sections", "fixtures", "manualChecks"], "report", errors);

  if (x.kind !== REPORT_KIND) errors.push(`report.kind: "${REPORT_KIND}" 가 아님`);
  if (x.version !== REPORT_VERSION) errors.push(`report.version: ${REPORT_VERSION} 이 아님(받은 값 ${String(x.version)})`);

  if (checkString(x.createdAt, "report.createdAt", errors)) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(x.createdAt) || Number.isNaN(Date.parse(x.createdAt))) {
      errors.push("report.createdAt: ISO 8601(UTC) 형식이 아님");
    }
  }

  if (!isPlainObject(x.device)) {
    if ("device" in x) errors.push("report.device: 객체가 아님");
  } else {
    const d = x.device;
    checkKeys(d, ["userAgent", "screenWidth", "screenHeight", "devicePixelRatio"], "report.device", errors);
    if ("userAgent" in d && checkString(d.userAgent, "report.device.userAgent", errors)) {
      checkJson(d.userAgent, "report.device.userAgent", 1, errors, newBudget());
    }
    for (const k of ["screenWidth", "screenHeight", "devicePixelRatio"]) {
      if (k in d) checkFiniteNumber(d[k], `report.device.${k}`, errors);
    }
  }

  if (!isPlainObject(x.sections)) {
    if ("sections" in x) errors.push("report.sections: 객체가 아님");
  } else {
    checkKeys(x.sections, SECTION_KEYS, "report.sections", errors);
    for (const k of SECTION_KEYS) {
      if (k in x.sections) checkSection(x.sections[k], `report.sections.${k}`, errors);
    }
  }

  if (!Array.isArray(x.fixtures)) {
    if ("fixtures" in x) errors.push("report.fixtures: 배열이 아님");
  } else {
    if (x.fixtures.length > MAX_FIXTURES) errors.push(`report.fixtures: 너무 많음(${x.fixtures.length})`);
    x.fixtures.forEach((f, i) => checkFixture(f, `report.fixtures[${i}]`, errors));
  }

  if (!isPlainObject(x.manualChecks)) {
    if ("manualChecks" in x) errors.push("report.manualChecks: 객체가 아님");
  } else {
    checkKeys(x.manualChecks, ["filesAppNamesKept", "longPressSaved"], "report.manualChecks", errors);
    checkNullableBoolean(x.manualChecks.filesAppNamesKept, "report.manualChecks.filesAppNamesKept", errors);
    checkNullableBoolean(x.manualChecks.longPressSaved, "report.manualChecks.longPressSaved", errors);
  }

  return errors;
}

export type ValidationResult = { ok: true; report: Report } | { ok: false; errors: string[] };

/** 파싱한 JSON(또는 무엇이든)을 검사한다. 고치거나 채우지 않고, 틀린 곳을 전부 모아 돌려준다. */
export function validateReport(x: unknown): ValidationResult {
  const errors = collectErrors(x);
  return errors.length === 0 ? { ok: true, report: x as Report } : { ok: false, errors };
}

export type ReportInput = Omit<Report, "kind" | "version">;

/**
 * 보고서를 만든다. kind·version 을 앞에 붙이고 받은 필드를 **펼쳐** 쓴 뒤 검사한다.
 * 키를 하나씩 옮겨 적지 않는 이유: 그러면 입력에서 빠진 필드가 "값이 undefined 인 필드"로
 * 바뀌어, 같은 누락을 validateReport 는 "없음"으로, buildReport 는 형 오류로 보고한다.
 * 펼치면 누락이 누락으로 남는다. 입력에 kind·version 이 섞여 들어오면 그 값이 검사를 받는다.
 * 검사에 걸리면 ReportValidationError. 통과한 보고서는 JSON 문자열로 왕복해도 같다.
 */
export function buildReport(input: ReportInput): Report {
  const report = { kind: REPORT_KIND, version: REPORT_VERSION, ...input };
  const result = validateReport(report);
  if (!result.ok) throw new ReportValidationError(result.errors);
  return result.report;
}

/**
 * 검사 오류 문구에서 문제가 난 섹션 키를 뽑는다(점검 페이지의 "문제 섹션만 비우고 내보내기"용).
 * 섹션 밖(기기 정보·픽스처·수동 확인)의 오류는 여기에 나오지 않는다 — 비워서 고칠 수 없기 때문이다.
 */
export function failingSectionKeys(errors: readonly string[]): SectionKey[] {
  const out = new Set<SectionKey>();
  for (const e of errors) {
    const m = /^report\.sections\.([A-Za-z]+)/.exec(e);
    if (m && (SECTION_KEYS as readonly string[]).includes(m[1])) out.add(m[1] as SectionKey);
  }
  return SECTION_KEYS.filter((k) => out.has(k));
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** same-angle-d1-report-YYYYMMDD-HHmm.json (기기 현지 시각). */
export function reportFileName(date: Date): string {
  const y = date.getFullYear();
  const ymd = `${y}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  const hm = `${pad2(date.getHours())}${pad2(date.getMinutes())}`;
  return `same-angle-d1-report-${ymd}-${hm}.json`;
}

/**
 * 섹션 데이터를 만들 때 쓰는 도우미: 유한한 수면 그대로, 아니면 null.
 * 검증기는 비유한 수를 거부하므로, "재지 못함"은 호출하는 쪽이 이것으로 명시적으로 null 로 적는다.
 */
export function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
