# 같은각도

새 사진을 찍을 때 기준 사진과 고개 각도·거리·화면 내 위치가 같은지 숫자로 확인하는 촬영 보조 웹앱입니다(설계: [`docs/PRD.md`](docs/PRD.md)).

## 지금 상태

**구현 초기, D1 실기기 점검 단계입니다.** 촬영 게이트·판정·비교 화면은 아직 없습니다. 무엇을 점검하는지는 [`docs/TECH-NOTES.md`](docs/TECH-NOTES.md) 6절에 있습니다. 문서의 수치와 규약은 **아직 실기기에서 한 번도 재지 않은 조사 기반 값**입니다. 공개 배포 주소는 아직 없습니다(로컬 실행은 아래).

## D1 실기기 점검 페이지(`/spike/`)

아이폰 사파리에서 카메라·얼굴 모델·센서·공유가 실제로 어떻게 동작하는지 재는 개발용 페이지입니다. TECH-NOTES 6절 체크리스트를 섹션 0~11로 나눴고, 각 섹션에 해당 항목 번호가 적혀 있습니다.

1. **HTTPS 에서 엽니다.** 아이폰 카메라는 보안 컨텍스트에서만 열리므로 LAN 의 http 개발 서버로는 안 됩니다(HTTPS 로 배포한 주소의 `/spike/`).
2. 시작 전: 자동 잠금 '안 함', 저전력 모드 끔, 무음 모드 해제·볼륨 올림(기록·카운트다운의 시작과 끝을 **삐 소리**로 알립니다). 0번 [소리 시험]으로 소리가 나는지 먼저 봅니다. 사파리 16.4+ 는 오디오 세션을 playback 으로 두어 무음 스위치와 상관없이 나게 하고, 그 상태를 0번에 적습니다.
3. 위에서부터 차례로: 환경·소리 시험 → [카메라 켜기] → [모델 불러오기]·[추론 시작]·[지금 성능 저장] → 흔들림 30초 기록 → 자세 6개 → 같은 프레임 비교 → takePhoto 비교 → **12번에서 중간 내보내기 한 번**(7·10번은 사파리를 떠납니다) → 옛 사진 1장 → 동작 센서 → 픽셀 비용 → 공유 시험 → 네트워크 출처.
4. 결과는 이 기기에 임시 저장되어 탭이 다시 열려도 복원됩니다. 마지막 12번에서 [복사](가장 빠름)·[파일로 저장]·[공유] 중 하나로 `same-angle-d1-report-YYYYMMDD-HHmm.json` 을 내보내 개발자에게 보냅니다(개발자는 이 JSON 을 Claude Code 대화에 붙여 넣어 함께 읽습니다).

자세한 순서·완료 조건·내보내기는 [`docs/TECH-NOTES.md`](docs/TECH-NOTES.md) 10절에 있습니다.

결과 JSON 에는 **이미지와 얼굴 랜드마크 좌표가 들어가지 않습니다.** 기기 정보(userAgent·화면 크기·DPR), 측정 숫자, 자세 픽스처의 행렬 16개 숫자뿐이고, 내보내기 전에 검사기(`src/core/report.ts`)가 이미지·랜드마크 키, `data:` URL, base64 로 보이는 긴 연속 문자, 긴 문자열·배열, 비유한 수, 그리고 섹션마다 수 900개·글자 24,000자를 넘는 총량을 거부합니다(여러 조각으로 쪼개 넣어도 걸리게). 총량 한도는 통째로 넣는 것을 막을 뿐 몇 점까지 막는다는 증명은 아니고, 나머지는 "섹션 데이터에는 이름 붙인 요약 숫자만" 넣는 점검 페이지 코드가 맡습니다.

## 아직 검증하지 않은 것

- 이 점검 페이지 자체를 **아이폰에서 아직 한 번도 돌려 보지 않았습니다.** 카메라 없는 맥의 크로미움 계열 브라우저에서 모델 불러오기(CPU·GPU), 얼굴이 없는 합성 캔버스 스트림으로 추론 루프, 실패 이유 표시, 보고서 내보내기까지만 확인했습니다. **실제 얼굴 입력이 한 번도 들어가지 않았으므로 행렬 분해·박스·픽스처 경로는 실기기에서 처음 돕니다.**
- 행렬 배치(열/행 우선)는 가정하지 않고 판별하지만, yaw·pitch·roll 부호(`src/core/matrix.ts` 의 `*_SIGN`)와 폰 롤 부호는 [추론]입니다. D1 자세 픽스처로 확정합니다.
- CSP 는 `connect-src` 만 강제하고 나머지 지시어는 관찰 모드입니다(아래). 사파리가 강제 헤더를 실제로 지키는지는 실기기에서 아직 확인하지 않았습니다.

## 로컬 실행

node `^20.19.0 || ^22.13.0 || >=24`, npm 10 이상.

```sh
npm install
npm run dev          # http://localhost:3000 — predev 가 MediaPipe WASM 을 public/ 으로 복사
npm run verify       # test → typecheck → lint → build
npm run preview      # 빌드한 out/ 을 vercel.json 과 같은 헤더로 띄움(http://localhost:3100)
```

## 네트워크 경계

**약속: 카메라 영상과 사진은 기기 밖으로 나가지 않습니다.** 앱 코드는 사진·영상·측정값을 네트워크로 보내지 않습니다. 다만 앱이 쓰는 라이브러리는 스스로 요청을 만들 수 있어서, 약속은 "앱 코드가 보내지 않는다"가 아니라 "허용 목록 밖 요청을 막는다"로 지킵니다. 범위와 한계는 다음과 같습니다.

- 서버가 없습니다. Next.js 정적 내보내기(`out/`)만 배포합니다.
- MediaPipe WASM 은 `@mediapipe/tasks-vision` 1.0.1 패키지에서 `public/mediapipe/wasm/` 으로 빌드 때 복사해 **같은 출처에서** 내려보냅니다(`scripts/copy-wasm.mjs`, 생성물이라 커밋하지 않음).
- 얼굴 랜드마크 모델 파일(`face_landmarker.task`)은 재배포 조건이 불명확해 커밋하지 않고 **Google 서버**(`storage.googleapis.com`)에서 받습니다. 이때 기기의 IP 가 Google 로 전달됩니다.
- **MediaPipe 사용 통계.** `@mediapipe/tasks-vision` 1.0.1 은 얼굴 모델 엔진을 만들 때마다 사용 통계 로거를 만들고, 60초마다·엔진을 닫을 때 `https://odml.pa.googleapis.com/v1/log` 로 POST 합니다(플랫폼·라이브러리 버전·과제 종류·실행 모드·초기화/추론 시간. 끄는 옵션 없음). 패키지 README 의 Privacy Notice 는 이 전송을 알리고 동의를 받을 책임을 앱 개발자에게 둡니다. 이 앱은 그 요청을 **보내기 전에 막습니다**: 배포본은 강제 CSP `connect-src 'self' https://storage.googleapis.com/mediapipe-models/` 가, 모든 환경(헤더 없는 `npm run dev` 포함)은 `src/spike/netguard.ts` 의 fetch 가드가 막습니다. 막힌 횟수는 점검 페이지 11번에 남습니다. 사진·영상은 이 통계에 들어가지 않습니다(패키지 README).
- 사진이 기기를 떠나는 길은 사용자가 누르는 공유·다운로드뿐이고, 그 뒤(사진 앱, 클라우드 동기화, 메신저)는 앱이 통제하지 못합니다.
- 이 약속은 아직 **실기기 네트워크 기록으로 확인하지 않았습니다.** 확인은 아이폰을 맥에 연결한 사파리 웹 인스펙터의 네트워크 기록(허용 목록 밖 요청·`odml.pa.googleapis.com` 요청·POST/PUT 0건)으로 합니다. 점검 페이지 11번의 출처 목록(Resource Timing)과 가드 기록은 보조 자료이지 증명이 아닙니다.

### CSP: connect-src 만 강제, 나머지는 관찰(Report-Only)

`vercel.json` 은 모든 경로에 헤더 두 개를 붙입니다.

- `Content-Security-Policy`(강제): `connect-src 'self' https://storage.googleapis.com/mediapipe-models/; form-action 'none'; base-uri 'self'; frame-ancestors 'none'`. MediaPipe 사용 통계처럼 허용 목록 밖으로 가는 fetch 를 브라우저가 보내기 전에 막습니다. 원격은 호스트 전체가 아니라 **모델 버킷 경로**까지만 엽니다. `storage.googleapis.com` 은 누구의 버킷에든 업로드를 받는 호스트라, 호스트를 통째로 열면 경계가 되지 않습니다. 이 지시어들은 점검 대상(WASM·GPU 위임·카메라 스트림·공유 시트)을 막지 않습니다(크로미움에서 모델·WASM 로드 확인, 아이폰 사파리는 D1 에서 확인).
- `Referrer-Policy: no-referrer`: 모델 파일을 받을 때 배포 주소를 Google 에 넘기지 않습니다(IP 는 여전히 전달됩니다).
- `Content-Security-Policy-Report-Only`(관찰): TECH-NOTES 1절 F10 이 요구하는 `connect-src`·`img-src`·`form-action` 에 `default-src`·`script-src 'wasm-unsafe-eval'`·`worker-src`·`media-src`·`base-uri`·`frame-ancestors` 를 더한 초안입니다. 더한 지시어의 근거는 문서가 아니라 구현 중 판단입니다.

나머지를 관찰로 둔 이유: 아이폰 사파리에서 MediaPipe WASM·GPU 위임·카메라 스트림·공유 시트가 이 정책 아래에서 무엇을 요구하는지 **아직 한 번도 확인하지 못했습니다.** 처음부터 전부 강제하면 점검 자체가 막혀 무엇이 모자랐는지 알 수 없습니다. Report-Only 에서도 브라우저는 위반마다 `securitypolicyviolation` 이벤트를 내므로, 점검 단계에서는 위반 목록을 모으고 정책을 고친 뒤 강제로 바꿉니다(조건은 TECH-NOTES 10절). CSP 문자열은 `src/csp.test.ts` 가 고정합니다.

`vercel.json` 의 빌드 명령은 `npm run verify` 입니다(TECH-NOTES 5절: CI 가 돌지 않으므로 배포가 곧 검증 실행이 되게 함).

`npm run preview` 는 `vercel.json` 의 헤더를 읽어 같은 헤더를 붙이므로, 로컬 미리보기와 배포의 CSP 동작이 같습니다. `npm run dev` 에는 헤더가 없습니다.

## 병원·실사용

병원 현장 검증은 하지 않았습니다. 이 저장소에는 환자·지인 사진, 공개 얼굴 데이터셋, 특정 기관의 이름이나 상표가 들어가지 않습니다.
