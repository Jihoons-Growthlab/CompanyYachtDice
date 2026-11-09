---
paths:
  - "apps/web/**"
---

# frontend

- 수정하는 화면의 기능 명세만 읽는다. 방 입장과 점수표의 화면 흐름은 `docs/features/lobby.md`를 참고한다.
- 실제 서버 상태와 목업 상태를 분리하고 주사위·점수 선택을 키보드로 지원한다.

- 서버 연동 화면은 `src/api.js`만 통해 호출한다(토큰 메모리 보관 규칙 유지). 게임 판정·주사위를 화면에서 정하지 않는다.
- 개발 전용 코드는 `import.meta.env.DEV` 분기 안에 둔다. 운영 빌드에서 `/dev/` 문자열이 0건인지 확인한다(`grep -c /dev/ dist/assets/*.js`).
- 화면 흐름 변경 후 `WEB_URL=<웹주소> npm run test:e2e`(실제 Chrome, API TEST_MODE 필요)로 회귀를 확인한다. 결과 요약: docs/development-status.md.
- 레이아웃은 `style.css` 맨 끝 "레이아웃 v2" 블록에서만 조정한다. 폭 구간: ≥1440 게임 7:채팅 3, 1024–1439 7:3(채팅 ≥320px), ≤1023 1열(채팅 아래·접기). 게임 패널은 컨테이너 폭 ≥720px이면 [조작 | 점수표] 2열이다.
- 레이아웃 변경 후 `npm run test:layout`, 시각 비교는 `npm run capture:layout -- after`(e2e/screenshots).
- 사용자 표시 명칭: 규칙 안내 = "📋 평가 양식 안내"(보조: 평가 규정 및 점수 산정 기준). "게임 방법" 문구는 쓰지 않는다.
- 테마는 `html[data-ui-mode=excel|cmd]` 토큰으로만 바꾼다(CMD 블록은 style.css 맨 끝). 새 화면 요소를 추가하면 CMD에서 배경·글자·테두리가 맞는지 `npm run test:settings` 스크린샷(e2e/screenshots/settings)으로 확인한다.
- 개인 연출(`prefs.js`: diceMs·toastMs·turnNotification·sound)과 서버 정책(턴 제한·봇 속도)을 섞지 않는다.
