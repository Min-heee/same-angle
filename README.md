# 같은각도

새 사진을 찍을 때 기준 사진과 고개 각도·거리·화면 내 위치가 같은지 숫자로 확인하는 촬영 보조 웹앱입니다(설계: [`docs/PRD.md`](docs/PRD.md)).

## 지금 상태

**구현 초기, D1 실기기 점검 단계입니다.** 촬영 게이트·판정·비교 화면은 아직 없습니다. 무엇을 점검하는지는 [`docs/TECH-NOTES.md`](docs/TECH-NOTES.md) 6절에 있습니다. 문서의 수치와 규약은 **아직 실기기에서 한 번도 재지 않은 조사 기반 값**입니다.

## 로컬 실행

node `^20.19.0 || ^22.13.0 || >=24`, npm 10 이상.

```sh
npm install
npm run dev          # http://localhost:3000 — predev 가 MediaPipe WASM 을 public/ 으로 복사
npm run verify       # test → typecheck → lint → build
npm run preview      # 빌드한 out/ 을 vercel.json 과 같은 헤더로 띄움(http://localhost:3100)
```

## 네트워크 경계

- 서버가 없습니다. Next.js 정적 내보내기(`out/`)만 배포합니다.
- MediaPipe WASM 은 `@mediapipe/tasks-vision` 1.0.1 패키지에서 `public/mediapipe/wasm/` 으로 빌드 때 복사해 **같은 출처에서** 내려보냅니다(`scripts/copy-wasm.mjs`, 생성물이라 커밋하지 않음).
- 얼굴 랜드마크 모델 파일(`face_landmarker.task`)은 재배포 조건이 불명확해 커밋하지 않고 **Google 서버**(`storage.googleapis.com`)에서 받습니다. 이때 기기의 IP 가 Google 로 전달됩니다.

### CSP 는 지금 관찰 모드(Report-Only)입니다

`vercel.json` 은 모든 경로에 `Content-Security-Policy-Report-Only` 헤더를 붙입니다. 정책(허용 출처는 자기 출처와 `storage.googleapis.com` 뿐, `form-action 'none'` 등)은 PRD F10 의 초안 그대로입니다.

차단(`Content-Security-Policy`)이 아니라 관찰로 둔 이유: 아이폰 사파리에서 MediaPipe WASM·GPU 위임·카메라 스트림·공유 시트가 이 정책 아래에서 무엇을 요구하는지 **아직 한 번도 확인하지 못했습니다.** 처음부터 차단하면 점검 자체가 막혀 무엇이 모자랐는지 알 수 없습니다. Report-Only 에서도 브라우저는 위반마다 `securitypolicyviolation` 이벤트를 내므로, 점검 단계에서는 위반 목록을 모으고 정책을 고친 뒤 차단 모드로 바꿉니다. **즉, 지금 배포본에서 CSP 는 아무것도 막지 않습니다.**

`npm run preview` 는 `vercel.json` 의 헤더를 읽어 같은 헤더를 붙이므로, 로컬 미리보기와 배포의 CSP 동작이 같습니다. `npm run dev` 에는 헤더가 없습니다.

## 병원·실사용

병원 현장 검증은 하지 않았습니다. 이 저장소에는 환자·지인 사진, 공개 얼굴 데이터셋, 특정 기관의 이름이나 상표가 들어가지 않습니다.
