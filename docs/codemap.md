# 코드 지도 (codemap)

2026-11-09 기준. 파일을 전부 열기 전에 이 표로 대상을 좁힌다. 구조가 바뀌면 이 문서만 갱신한다.

## 저장소 트리

```
CLAUDE.md                     공통 지침 (자동 로드)
.claude/rules/*.md            경로별 규칙: backend·frontend·game-engine·unity·infra
.claude/skills/*              수동 호출 스킬: handoff·implement-feature·mockup·verify-feature
package.json                  루트 명령 모음(의존성 없음): infra:*, server:*, db:*
infra/                        Compose(PG 18·Redis 8), env 생성·백업 스크립트 → infra/README.md
apps/web/                     Vue 3.5 + Vite 8. 인증·로비·초대·대기실·게임·채팅은 서버 연동, 조직·상점·사무실은 로컬 목업
apps/server/                  NestJS 12(ESM) + Prisma 7 + ioredis + jose. health + P1 인증 구현
packages/shared/              순수 규칙(I/O 없음): 점수·엔진·오토 전략. 웹·서버 모두 상대경로로 import(*.d.mts 타입)
unity/OfficeWorld/            3D 사무실 (미구현)
docs/                         명세 (아래 표)
```

## apps/web (목업)

| 파일 | 줄 수 | 내용 · 찾을 함수/블록 |
|---|---|---|
| `src/App.vue` | ~400 | 단일 거대 컴포넌트. 인증 목업(`beginAuth`,`completeMockAuth`), 프로필 등록(`saveProfile`), 수식줄(`runFormula`), 로비(`createRoom`,`start`), **게임**(`roll`,`record`,`resetDice`, 템플릿 `class="match"`), **봇 상대**(`record` 안 `opponents` 루프), **채팅**(`send`, `chat` Map, 템플릿 `<aside>` "검토 의견"), 상점(`buy`), 내 사무실 |
| `src/components/EvaluationRoom.vue` | ~60 | 게임 시작 전 대기실: 정원 2–4 select, 초대·수락, 준비, PL 시작(`begin` → emit `start`) |
| `src/components/CompanyDirectory.vue` | ~170 | 회사 클랜: 목록·검색·랭킹·설립·신청·승인·초대·퇴사, **기업 단계 `stages`**(스타트업→중소→중견→대기업, `upgrade`) |
| `src/help.js` | 45 | `v-help` 툴팁 디렉티브 |
| `src/style.css` | ~480 | 엑셀 테마 전역 스타일. **맨 끝 "레이아웃 v2" 블록이 게임·채팅 배치의 최종 기준**(폭 구간·컨테이너 쿼리·정렬). 앞쪽 `.match`/`.dice` 규칙은 이 블록이 덮어쓴다 |
| `src/main.js` | 6 | 앱 마운트 |

| `src/api.js` | fetch 래퍼(access 메모리 보관, 401 → refresh 1회 재시도, 탭 간 `navigator.locks`), `connectRealtime`(Socket.IO, 재연결 시 재구독), `devLogin`(개발 빌드 전용) |
| `src/prefs.js` | 개인 설정 상태·적용(`applyToDom`)·저장(`useGuest`/`useAccount`/`update`/`retrySave`), `diceMs`·`toastMs` |
| `src/sound.js` | Web Audio 효과음 `playSound(kind)` (turn·roll·confirm·chat) |
| `src/components/SettingsPanel.vue` | ⚙ 환경 설정 패널(서랍/모바일 하단 시트, ESC 닫기, 저장 상태) |
| `index.html` | 첫 렌더 전 테마 적용 인라인 스크립트(`oy.prefs.applied`) |
| `src/rules.js` | 항목 설명(`CATEGORY_INFO`)·계산 근거(`explain`)·`formatClock`(분:초)·"다시 보지 않기" 로컬 설정 |
| `src/components/GameGuide.vue` | 게임 매뉴얼: 시작 안내(briefing, 확인/건너뛰기) · 도움말(help) |
| `src/components/RoomChat.vue` | 메신저형 채팅(대기실·게임 공용): 내부 스크롤, 읽는 중 강제 스크롤 안 함, Enter/Shift+Enter, 전송 중·실패·재전송, 좁은 화면 접기 |
| `e2e/multiplayer.e2e.mjs` | 실제 Chrome 2컨텍스트 통합 테스트(`npm run test:e2e`) |
| `e2e/settings.e2e.mjs` | 설정·Excel/CMD·계정별 저장·새로고침 깜빡임·모바일(`npm run test:settings`) |
| `e2e/layout.e2e.mjs` | 1440/1280/1024/768/390 레이아웃 측정 검증(`npm run test:layout`) |
| `e2e/layout-capture.mjs` | 화면 캡처 + 영역 크기 기록 → `e2e/screenshots/<label>/`(git 제외, `npm run capture:layout -- after`) |
| `src/components/DevPanel.vue` | DEV 테스트 패널(개발 빌드 + 서버 TEST_MODE일 때만, `/api/v1/dev/*` 호출) |

현재 사실(2026-11-09):
- App.vue 상단 스크립트는 인증(`submitEmail`·`beginAuth`·`afterLogin`)·방(`openRoom`·`enterRoom`·`applyRoom`)·게임(`applyMatch`·`command`·`roll`·`toggleHold`·`record`·`toggleAuto`)으로 나뉜다. 게임 상태는 서버 MatchSnapshot에서 계산한다.
- EvaluationRoom.vue는 서버 RoomSnapshot을 표시한다(준비·정원·턴 제한시간·시작·나가기).
- `vite.config.js`의 `/api`·`/socket.io` 프록시가 3000번으로 연결한다(같은 출처 유지).
- 게임 화면 구조(App.vue): `.game-panel` > `.game-head`(제목·📋 평가 양식 안내) + `.game-body` > `.game-controls`(턴 상태·`.action-box`·주사위·결과) | `.game-sheet`(점수표). `.action-box`는 다음 행동·선택 확정·항목 설명을 같은 자리에 둔다(높이 고정).
- App.vue 게임 UX: `selectScore`(선택만) → `confirmScore`(SCORE 명령), `heldView`(고정 낙관 표시), `nextAction`(다음 행동 문구), `sendBriefed`/`guideMode`(안내), `showToast`.
- App.vue 추가 함수: `restoreSession`(새로고침 복원), `animateRoll`/`displayDice`(굴림 연출), `rematch`, `mergeMessages`/`sendChat`/`retryChat`(채팅), `onInvite`/`respondInvite`(초대), `onOffline`/`onOnline`(네트워크 상태).
- 로컬 목업으로 남은 것: 상점·코인, 내 사무실, CompanyDirectory.

## packages/shared

| 파일 | 내용 |
|---|---|
| `scoring.mjs` | `categories`(12칸 키·라벨), `scoresFor(dice)`, `upper`, `bonus`(63→35), `total` |
| `scoring.test.mjs` | `node --test` 3건 |

| `engine.mjs` (+`.d.mts`) | `createGame`, `applyCommand(state, playerId, cmd, rollDie)`, `previews`, `rank`. 1–6인, 불변 |
| `autoplay.mjs` (+`.d.mts`) | `nextAutoCommand`, `bestCategory`, `chooseHold`: 봇·오토·시간 초과 공용 |
| `engine.test.mjs` | `node --test`(packages/shared) |

## apps/server

| 경로 | 내용 |
|---|---|
| `src/main.ts` | 부트스트랩(`createApp` 호출), 종료 절차 |
| `src/app.factory.ts` | 앱 구성 공용(전역 prefix `/api/v1`, 필터, body 16kb, CORS) — main·테스트 공유 |
| `src/auth/` | `auth.controller`(signup/login/refresh/logout/logout-all), `auth.service`(세션 회전·재사용 탐지), `token.service`(JWT), `password`(argon2id), `auth.guard`(전역 JWT·Origin), `decorators`(`@Public` `@RequireOrigin` `@CurrentUser`), `auth.policy`(수치) |
| `src/users/` | `GET /me`, `PUT /me/profile`, `user.dto`(`toMe`, `ProfileInput`) |
| `src/preferences/` | `GET/PATCH /me/preferences`(개인 화면 설정, `user_preferences`) |
| `src/common/` | `app-error`(`Errors.*`), `http-exception.filter`, `validation`(`parseInput`), `cookies`, `request-log`, `util` |
| `src/redis/rate-limit.service.ts` | Redis 고정 윈도 제한, 장애 시 fail closed |
| `src/game/` | `game.policy.ts`(정원·제한시간·AFK 정책 값, 직급 계산), `engine.ts`(shared 엔진 + CSPRNG), `game.module.ts` |
| `src/rooms/` | `rooms.service`(방 행 잠금 `mutate`, `startBlockers`, `start`), `rooms.controller`, `room.dto`(zod = 검증 = Swagger) |
| `src/matches/` | `matches.service`(명령 파이프라인 `mutate`, 타이머 `reschedule`·`onTimeout`·`onAutoStep`, 재시작 복구), `matches.controller`, `match.dto` |
| `src/realtime/` | `game.gateway`(Socket.IO 이벤트·handshake JWT), `realtime.service`(presence), `socket-io.adapter`(Origin 검사) |
| `src/oauth/` | Google(OIDC)·카카오·네이버: `oauth.providers`(엔드포인트), `oauth.service`(state·PKCE·검증·계정 매핑), `oauth.controller` |
| `src/chat/` | `chat.service`(전송·시스템 메시지·기록·보관 삭제, 방별 seq), `chat.dto` |
| `src/invites/` | `invites.service`(검색·초대·수락/거절·만료), `invites.controller`(`/users/search`, `/me/room-invites`, `/room-invites/:id/*`) |
| `src/dev/` | TEST_MODE 전용 `/dev/*`(AppModule이 조건부 등록) |
| `src/docs.ts` · `src/common/openapi.ts` | Swagger `/docs` 설정, zod → OpenAPI 데코레이터(`ApiJsonBody`·`ApiData`·`ApiErrors`) |
| `src/config/env.ts` | zod 환경변수 검증. 새 변수는 여기 + `.env.example` |
| `src/prisma/`, `src/redis/` | 클라이언트·timeout·종료 |
| `src/health/` | `/health/live`, `/health/ready` |
| `prisma/schema.prisma` | `User`, `ExternalIdentity`, `LocalCredential`, `Session` |
| `test/` | `helpers.mjs`(startApp·call·freshIp·makeUser·waitFor), `unit`, `auth.e2e`, `game.e2e`(방·게임·소켓·테스트 모드), `oauth.e2e`(가짜 공급자), `modes.e2e`(Swagger·운영 차단) — `npm test` |
| `scripts/test-prepare.mjs` | 테스트 DB `<db>_test` 생성·마이그레이션 |
| `scripts/check-infra.mjs` | 연결 점검 |

없는 것: 회사·경제·칭호 모듈, 직급 마스터, 채팅 신고·차단.

## docs — 무엇을 어디서 읽나

| 주제 | 문서 |
|---|---|
| **전체 기능 명세(요약)** | `SPEC.md` (README 스크린샷: `docs/images/`) |
| 제품 범위 | `PRD.md`, 단계 `phases.md` |
| 구조·원칙 | `architecture.md`, 이 문서 |
| 게임 규칙 | `features/yacht.md` (ruleset yacht-v1) |
| 방·대기실 | `features/lobby.md` |
| 채팅 | `features/chat.md` |
| 회사·직급·칭호 | `features/organization.md` |
| 재화·상점 | `features/economy.md` |
| 인증 | `features/auth.md` |
| 3D | `features/office3d.md` |
| DB 초안 | `db.md` |
| API/소켓 계약 | `contracts/rest.md`, `contracts/socket.md` |
| 인프라 | `infrastructure.md`, `infra/README.md`, `.claude/rules/infra.md` |
| 소셜 로그인 설정 | `social-login-setup.md` |
| 환경 설정·UI 모드 | `features/settings.md` |
| API 문서 | 실행 중 서버 `/docs` (Swagger), 요약 `contracts/rest.md` |
| **개발 현황·이벤트·구조·테스트** | `development-status.md` |
| 진행 중 작업 지시 | `tasks/INFRA-001.md`(완료), `tasks/GAME-ROOM-001.md`(설계·승인 대기) |
| 인수인계 | `HANDOFF.md` |
