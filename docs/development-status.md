# 개발 현황 (2026-11-09, UX 개선 반영)

기능 명세는 `docs/features/*.md`, 파일 위치는 `docs/codemap.md`, API 상세는 실행 중 서버의 Swagger `/docs`가 기준이다. 이 문서는 **구현 상태·흐름·구조·실행·테스트**를 한곳에 모은다.

## 1. 기능별 상태

| 영역 | 상태 | 비고 |
|---|---|---|
| 인증: 이메일·JWT·refresh 회전 | 완료 | features/auth.md "보안 정책" |
| 소셜 로그인 Google·카카오·네이버 | 부분 | 서버·화면 구현, 가짜 공급자 테스트만 했다. 실제 자격 증명 연동은 미검증(social-login-setup.md) |
| 방 생성(제목·정원 2–6·공개/비공개·턴 1–5분(기본 3분)·봇 허용) | 완료 | 비공개는 6자리 입장 코드. 옛 10/15/30초 대기방은 마이그레이션에서 3분으로 변경 |
| 방 목록(방장·인원·상태·공개 여부·제한시간·입장) + 실시간 갱신 | 완료 | `lobby:changed` → GET /rooms |
| 초대(사원 검색·초대·수락/거절·만료 10분·중복 방지·알림) | 완료 | 수락하면 비공개 코드 생략 |
| 대기실(준비/취소·PL 시작·조건 표시·위임·봇 추가/제외·나가기) | 완료 | 시작 조건은 서버가 방 행 잠금 아래에서 검증 |
| 게임 진행(턴·굴림 3회·보관·미리보기·기록·종료·순위) | 완료 | 엔진 packages/shared, 서버 검증 |
| 주사위 굴림 애니메이션 | 완료 | 표시 전용, 0.8초, 애니메이션 축소 설정(prefers-reduced-motion) 지원 |
| 시작 안내(규칙 매뉴얼)·안내 확인 대기 | 완료 | 전원 확인 전 타이머 정지, 건너뛰기, 다시 보지 않기(로컬), [? 게임 방법] 상시, 무응답 120초 후 시작 |
| 조작 UX(선택→확정 분리, 계산 근거, 다음 행동 안내, 고정 표시, 분:초 타이머, 모바일 터치) | 완료 | yacht.md "시작 안내 단계와 조작 UX" |
| 환경 설정(⚙)·UI 모드 Excel/CMD·크기·애니메이션·연출 속도·턴 알림·효과음·리본 접기 + 계정별 저장 | 완료 | features/settings.md. 명령어 직접 입력(CMD)은 미구현 |
| 레이아웃 v2(폭 활용·채팅 약 2배·[조작|점수표] 2열·반응형 5구간·명칭 "평가 양식 안내") | 완료 | 1440 기준 채팅 220→399px, 점수표 시작 y726→347, 페이지 높이 1405→975 |
| 턴 타이머·시간 초과·AWAY·오토·재접속 복구 | 완료 | 정책 값은 초안(GAME-ROOM-001 §7.1) |
| 실시간 채팅(전송·수신·시스템 메시지·최근 50개 복원·중복 방지·속도 제한) | 완료 | PostgreSQL 저장, 30일 후 삭제 |
| 결과 화면(순위·총점·항목별·승자 강조·다시 하기·로비) | 완료 | 다시 하기 = 같은 방에서 새 매치 생성(이전 결과 보존) |
| 새로고침 복원(방·게임·채팅) | 완료 | GET /rooms/current |
| DEV 테스트 모드(간편 로그인·봇·강제 시작·종료 시뮬레이션·초기화) | 완료 | 재화 지급·회사 승인·직급 지정은 해당 서버 기능 없음 |
| 조직(회사)·상점·내 사무실·칭호 | 미구현(서버) | 화면은 로컬 목업 |
| 직급 마스터·직급별 이모지·회사 능력·랭킹·보상 | 미구현 | 설계: tasks/GAME-ROOM-001.md |

## 2. 게임 진행 흐름

```
로비 ─ 방 생성(PL) / 목록에서 입장(비공개: 코드) / 초대 수락
  └ 대기실: 참여자 준비 ↔ 취소 · PL 봇 추가/제외 · 초대
      └ PL 시작 → 서버 검증(WAITING·2명 이상·정원 이하·PL 외 전원 준비) → 좌석 순서 무작위 → match ACTIVE(phase BRIEFING, 타이머 정지)
          └ 안내 확인/건너뛰기(사람 전원, 봇 자동, 퇴장=확인, 120초 무응답=시작) → phase PLAYING, 첫 턴 기한
          └ 턴: ROLL(≤3) · HOLD · SCORE → 다음 플레이어(기한 갱신)
              · 시간 초과: 1회 굴림+최고점 칸, 연속 2회면 AWAY(서버 오토), 직접 조작하면 MANUAL 복귀
              · 봇/AUTO/AWAY: 서버가 턴 첫 동작 1.8초, 이후 1.1초 간격으로 한 걸음씩 진행
          └ 전원 12칸 → FINISHED, 순위(공동 순위 1,1,3) 기록 → 방 WAITING 복귀(사람 준비 해제)
              └ 결과 화면 → 다시 하기(같은 방 대기실, 참여자 자동 준비 → PL 시작 = 새 매치) / 로비
```

## 3. WebSocket(Socket.IO `/socket.io`) 이벤트

인증: handshake `auth.token` = access JWT(실패 시 `connect_error` 메시지가 오류 코드). Origin 검사는 HTTP와 같다. ACK는 `{ok:true,data}` 또는 `{ok:false,error:{code,message,details?}}`.

| 클라이언트 → 서버 | 본문 | ACK data |
|---|---|---|
| room:subscribe | {roomId} | {room, match\|null, messages[최근 50]} |
| room:unsubscribe | {roomId} | {roomId} |
| room:ready | {roomId, ready} | RoomSnapshot |
| room:start | {roomId} | MatchSnapshot |
| match:roll / match:hold / match:score | {matchId, commandId, expectedVersion, held?, category?} | MatchSnapshot |
| match:mode | {matchId, mode: AUTO\|MANUAL} | MatchSnapshot |
| match:briefed | {matchId} | MatchSnapshot (시작 안내 확인) |
| chat:send | {roomId, clientMessageId, text} | ChatMessage |

| 서버 → 클라이언트 | 대상 | 내용 |
|---|---|---|
| room:state | 방 구독자 | RoomSnapshot(전체) |
| match:state | 방 구독자 | MatchSnapshot(전체, version 증가) |
| chat:message | 방 구독자 | ChatMessage(TEXT·SYSTEM) |
| lobby:changed | 모든 연결 | 페이로드 없음 → 클라이언트가 GET /rooms |
| invite:received / invite:updated | 대상·초대자 개인 채널 | Invite |

서버 heartbeat는 10초 간격, 5초 무응답이면 끊김으로 본다. 재연결 시 클라이언트가 구독 중인 방을 다시 구독해 스냅샷과 최근 채팅을 받는다.

## 4. 주요 REST API (`/api/v1`, 전체는 `/docs`)

| 분류 | 경로 |
|---|---|
| 인증 | POST auth/signup·login·refresh·logout·logout-all, GET auth/providers, GET auth/:provider/start·callback |
| 회원 | GET me, PUT me/profile, GET users/search?q=, GET me/room-invites |
| 게임방 | GET rooms, POST rooms, GET rooms/current, GET·PATCH rooms/:id, POST rooms/:id/join {code?}·leave·ready·start, POST·DELETE rooms/:id/bots, POST rooms/:id/invites, GET·POST rooms/:id/messages |
| 초대 | POST room-invites/:id/accept·decline |
| 게임 | GET matches/:id, POST matches/:id/commands·mode·briefing |
| 개발(TEST_MODE) | /dev/status·accounts·login·rooms·rooms/:id/bots·members·ready-all·force-start·matches/:id/finish·reset |

## 5. 상태·메시지 구조

**RoomSnapshot**: `{id, name, status: WAITING|PLAYING|CLOSED, capacity, turnTimeLimitSec, ownerId, isTest, isPrivate, joinCode(참여자에게만), botsAllowed, matchId, members:[{userId, nickname, departmentLabel, rankLabel, ready, isOwner, isBot, online, joinedAt}], start:{canStart, blockers:[NOT_ENOUGH_PLAYERS|NOT_ALL_READY|OVER_CAPACITY|NOT_WAITING], minPlayers}}`

**MatchSnapshot**: `{id, roomId, ruleset:'yacht-v1', status: ACTIVE|FINISHED|ABORTED, phase: BRIEFING|PLAYING|FINISHED, briefingDeadlineAt, version, round, totalRounds:12, turnUserId, turnDeadlineAt, turnTimeLimitSec, serverTime, dice[5], held[5], rollCount, maxRolls:3, previews{카테고리:점수}(현재 차례), players:[{userId, nickname, isBot, seat, playMode: MANUAL|AUTO|AWAY, briefed, scores{12칸: 정수|null}, upper, bonus, total, rank|null}]}`
- 서버 원본은 엔진 상태 `matches.state` JSONB: `{ruleset, status, players:[{id, card}], turn, round, dice, held, rollCount, results}`이다. 클라이언트는 표시만 하고 점수와 주사위를 정하지 않는다.

**ChatMessage**: `{id, roomId, seq(방별 증가), kind: TEXT|SYSTEM, userId(서버 지정, SYSTEM=null), nickname, rankLabel(작성 시점 스냅샷), text(1–300자, 10줄), clientMessageId, createdAt}`
- 렌더링은 텍스트 보간만 한다(HTML 해석 없음). 같은 (room, user, clientMessageId)는 한 번만 저장한다. 사용자별 10초 5건(초과 시 429 RATE_LIMITED).

## 6. 저장소 사용

| 저장소 | 데이터 | 정책 |
|---|---|---|
| PostgreSQL | users·local_credentials·external_identities·sessions, rooms(옵션·chat_seq), room_members, room_invites, matches(state·version·기한), match_players(모드·결과), match_commands(멱등), chat_messages | 진행 상태·결과·채팅의 원본. 채팅은 **30일 후 삭제**(1시간 주기, `ChatPolicy.retentionDays`) |
| PostgreSQL(추가) | user_preferences(개인 화면 설정, 행이 없으면 기본값) | 본인만 조회·수정 |
| Redis | 요청 제한(로그인·가입·refresh·OAuth 시작·채팅), OAuth state(10분, 1회 소비) | 만료되는 데이터만. 장애 시 인증·채팅 쓰기는 거부(503) |
| 서버 메모리 | 턴 타이머·오토 타이머(재시작 시 DB에서 복구), 접속 상태(presence), 로비 변경 디바운스 | 단일 인스턴스 전제. 다중 인스턴스에서는 Redis adapter·presence 키로 옮긴다 |

## 7. 실행

```sh
npm run env:init && npm run infra:up            # PG·Redis
npm run server:install && npm run server:migrate
npm run server:dev                              # API http://localhost:3000 · Swagger /docs
cd apps/web && npm ci && npm run dev            # 웹 http://localhost:5173 (점유 시 다른 포트)
```
혼자 테스트하려면 `apps/server/.env`에 `TEST_MODE=true`를 둔다. 웹 오른쪽 아래 DEV 패널에서 계정 접속 → 테스트 방(봇 N) → 시작한다.

## 8. 테스트

| 명령 | 범위 | 최근 결과 |
|---|---|---|
| `npm --prefix apps/server test` | 단위 + E2E(인증·소셜(가짜 공급자)·방·초대·채팅·게임·시작 안내·턴 제한 1–5분·소켓·테스트 모드·운영 차단·환경 설정) | 68/68 통과 |
| `cd packages/shared && node --test` | 엔진·오토 전략·점수 | 9/9 통과 |
| `cd apps/web && npm run build` | 빌드 + 운영 번들 `/dev/` 0건 확인 | 통과 |
| `cd apps/web && WEB_URL=<웹주소> npm run test:e2e` | **실제 Chrome**: 1인 봇 게임(안내·타이머 정지·1–5분·굴림·보관/해제·재굴림 유지·미리보기·에이스 선택→확정·턴 이동·템포), 2인 멀티(안내 동기화·다시 보지 않기·주사위/점수표/채팅 동기화·새로고침·끊김 복구·결과 일치·도움말), 모바일 390px 터치 | 18/18 통과(연속 2회) |

| `cd apps/web && WEB_URL=<웹주소> npm run test:layout` | 1440/1280/1024/768/390: 가로 스크롤 없음, 게임·채팅 배치와 비율, 입력창 위치, 주사위 균등·44px, 항목 선택 시 점수표 고정, 숫자 우측 정렬, 채팅 내부 스크롤·읽는 중 강제 스크롤 금지·접기 | 23/23 통과(연속 2회) |

| `cd apps/web && WEB_URL=<웹주소> npm run test:settings` | # 가운데 정렬, ⚙ 위치, 패널 열기/ESC, Excel·CMD 스타일(배경 밝기·글꼴·프롬프트), 게임 중 전환 시 상태 유지, CMD에서 게임·채팅, 연출 속도, 리본·크기·효과음, 계정 저장, 새로고침 무깜빡임, 로그아웃/재로그인, 계정 분리, 다른 브라우저 복원, 첫 로그인 업로드, 모바일 | 18/18 통과(연속 2회) |

E2E 선행 조건: API(TEST_MODE=true)와 웹 dev 서버 실행, 시스템 Google Chrome(`playwright-core`, 브라우저 다운로드 없음).
