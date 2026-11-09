# OfficeYacht · 컴퍼니 요트 다이스 — 기능 명세서

작성일 2026-11-09 · 대상: 현재 저장소에 실제 구현된 기능(목업·미구현은 구분 표기)

> 이 문서는 전체를 한눈에 보는 **요약 명세**다. 세부 규칙·계약은 링크된 문서가 기준이다.
> 구현 상태와 테스트 결과는 [development-status.md](development-status.md), 파일 위치는 [codemap.md](codemap.md)에 있다.

---

## 1. 제품 개요

엑셀 업무 문서처럼 보이는 화면에서 2–6명이 실시간으로 즐기는 **요트 다이스** 게임이다. 회사원 콘셉트로, 게임방은 "평가실", 방장은 "PL", 주사위 굴리기는 "표본 산출", 점수 기록은 "평가 확정"이라고 부른다. 모든 판정(주사위·점수·턴·권한)은 서버가 내린다.

| 구분 | 내용 |
|---|---|
| 플레이 | 2–6인(테스트 모드는 1인 가능), 12라운드, 주사위 5개, 턴당 최대 3회 굴림 |
| 화면 | 엑셀 모드(기본) / CMD 모드, 데스크톱·태블릿·모바일 반응형 |
| 실시간 | Socket.IO: 방 상태·게임 상태·채팅·로비 갱신·초대 알림 |
| 인증 | 이메일·비밀번호, Google·카카오·네이버(실제 연동은 자격 증명 필요), JWT |

## 2. 시스템 구성

```
브라우저(Vue 3 + Vite) ──/api, /socket.io (Vite 프록시, 같은 출처)──▶ NestJS API(:3000)
                                                                     ├─ PostgreSQL 18 (Prisma 7) 영속 상태
                                                                     └─ Redis 8 요청 제한·OAuth state
packages/shared: 점수·턴 엔진·오토 전략(순수 함수, 웹·서버 공유)
```

| 계층 | 기술 | 비고 |
|---|---|---|
| Web | Vue 3.5, Vite 8, socket.io-client | `apps/web` |
| API | NestJS 12(ESM), TypeScript 6, zod 4, jose, Socket.IO 4 | `apps/server` |
| DB | PostgreSQL 18.6 + Prisma 7.10 | 마이그레이션 `apps/server/prisma/migrations` |
| Cache | Redis 8.10(ioredis) | 장애 시 인증·채팅 쓰기는 거부(503) |
| 인프라 | Docker Compose(`infra/`) | EC2 이전 가이드: `infra/README.md` |
| 문서 | Swagger UI `/docs` (OpenAPI 3, zod 스키마에서 생성) | 운영 기본 비활성 |

## 3. 기능 명세

### 3.1 인증·회원 — [features/auth.md](features/auth.md)
- 이메일 가입·로그인(argon2id), 로그아웃(현재 기기/전체 기기), 인사 등록(사원명·부서)
- 토큰: access JWT 10분(메모리 보관) + refresh 토큰 HttpOnly 쿠키(14일, 회전, 재사용 시 해당 로그인 세션 전체 폐기, 절대 만료 30일)
- 보안: 쿠키를 쓰는 경로는 Origin 검사, 요청 제한(로그인 실패 이메일당 5회/15분 등), 계정 존재를 드러내지 않는 오류
- 소셜 로그인: Google(OIDC: 서명·iss·aud·nonce 검증, PKCE), 카카오(PKCE), 네이버. state는 1회용이며 브라우저 쿠키에 묶인다. 이메일만 같다는 이유로 계정을 합치지 않는다 → 설정 방법: [social-login-setup.md](social-login-setup.md)

### 3.2 로비·게임방 — [features/lobby.md](features/lobby.md)
- 방 만들기: 제목, 정원 2–6, 공개/비공개(6자리 입장 코드), 턴 제한시간 **1·2·3·4·5분(기본 3분)**, 봇 허용
- 목록: 방장·인원·대기/평가 중·비공개·제한시간·입장. 방이 바뀌면 실시간으로 갱신
- 초대: 사원 검색(접속 여부 표시) → 참석 요청 → 실시간 알림 → 수락/거절, 10분 만료, 같은 대상 중복 방지
- 대기실: 준비/준비 취소, PL만 시작, 시작 못 하는 이유 표시, 봇 추가·제외, 방장이 나가면 위임, 빈 방은 닫힘
- 새로고침·재접속하면 참여 중인 방·게임·채팅을 복원한다

### 3.3 게임 진행 — [features/yacht.md](features/yacht.md)
- 엔진(`packages/shared/engine.mjs`): 굴림 ≤3, 보관, 12개 항목 기록, 턴 순환, 공동 순위(1,1,3), 상단 63점 이상이면 보너스 35점
- 서버 검증: 매치 행 잠금 → 명령 ID 중복 방지 → 버전 확인 → 엔진 → 커밋 → 전체 방송. 주사위는 서버 난수(CSPRNG)
- **시작 안내 단계**: 시작하면 규칙 안내("📋 평가 양식 안내")를 띄우고, 사람 참여자 모두가 확인하거나 건너뛸 때까지 턴 타이머를 멈춘다(봇은 자동 확인, 무응답이면 120초 후 시작)
- 턴 타이머는 서버 기준이다. 시간이 지나면 1회 굴리고 최고점 칸에 기록하고, 연속 2회면 자리 비움(서버 자동 진행). 직접 조작하면 수동으로 돌아온다. 오토 모드를 직접 켤 수도 있다
- 조작: ① 표본 산출(굴리기) → ② 표본 고정(보관)/재산출 → ③ 점수표 `+점수`로 **항목 선택**(계산 근거 표시) → ④ **[항목 N점 확정]**으로 기록. 0점 기록도 가능(경고 표시)
- 결과: 순위·총점·항목별 점수, 승자 강조, 다시 하기(같은 방에서 새 매치), 로비로

### 3.4 채팅 — [features/chat.md](features/chat.md)
- 방별 실시간 채팅(대기실·게임 공용), 시스템 메시지(입장·퇴장·준비·시작·종료·위임·초대)
- 작성자는 서버가 지정하고, 1–300자·10줄, 사용자별 10초 5건, 같은 메시지 재전송은 1건만 저장, 텍스트로만 렌더링
- 최근 50개 복원, 30일 지나면 삭제. 메신저 UI: 이전 메시지를 읽는 중이면 강제로 스크롤하지 않고 "새 메시지" 알림, 모바일에서 접기

### 3.5 화면·UX
- 레이아웃: ≥1024px이면 게임 70 : 채팅 30이고, 게임 패널 안은 [조작 | 점수표] 2열(1280·1440에서 주사위·점수표 16행·채팅이 한 화면). ≤1023px이면 1열에 채팅은 접기 가능
- 행동 안내 상자(다음 할 일·선택 확정·항목 설명)는 높이가 고정이라 항목을 골라도 점수표가 움직이지 않는다
- 주사위 굴림 애니메이션은 표시 전용이다. 분:초 타이머(30초 미만에서만 강조), 턴 알림·기록 완료 알림

### 3.6 환경 설정 · Excel/CMD 모드 — [features/settings.md](features/settings.md)
- 모든 헤더 오른쪽의 ⚙ 버튼: UI 모드(엑셀/CMD), UI 크기, 애니메이션 축소, 게임 중 리본 접기, 진행 연출 속도, 주사위 애니메이션, 턴 시작 알림, 효과음(Web Audio)·음량
- 계정별로 DB에 저장하고(다른 PC에서도 복원), 비로그인 상태는 브라우저에 저장. 첫 렌더 전에 테마를 적용해 깜빡이지 않는다
- 개인 연출 설정일 뿐이며 방장의 턴 제한시간·서버 봇 속도와는 별개다

### 3.7 개발자 테스트 모드 (`TEST_MODE=true`, 로컬 DB·비운영에서만)
- DEV 패널: 테스트 계정 1–6개 간편 로그인, 테스트 방 + 봇 채우기, 전체 준비, 강제 시작(혼자 가능), 종료 시뮬레이션(엔진 규칙), 테스트 데이터 초기화
- 운영에서는 `/dev/*` 경로가 아예 없고(404), 웹 운영 빌드에도 DEV 코드가 포함되지 않는다

## 4. API·실시간 계약

- REST `/api/v1`: 인증(`auth/*`), 회원(`me`, `me/profile`, `me/preferences`, `users/search`, `me/room-invites`), 게임방(`rooms/*`), 초대(`room-invites/*`), 게임(`matches/*`), 개발(`dev/*`) → 요약 [contracts/rest.md](contracts/rest.md), 전체 스키마는 실행 중 서버의 **`/docs`**
- Socket.IO: `room:subscribe|unsubscribe|ready|start`, `match:roll|hold|score|mode|briefed`, `chat:send` / 서버 → `room:state`, `match:state`, `chat:message`, `lobby:changed`, `invite:received|updated` → [contracts/socket.md](contracts/socket.md), [development-status.md §3](development-status.md)
- 공통 오류 형식 `{ error: { code, message, requestId, details? } }`

## 5. 데이터 모델 — [db.md](db.md)

| 테이블 | 용도 |
|---|---|
| users · local_credentials · external_identities · sessions | 계정·비밀번호·소셜 식별자·refresh 세션 |
| rooms · room_members · room_invites | 게임방(정원·제한시간·공개·봇 허용·채팅 순번)·참여자·초대 |
| matches · match_players · match_commands | 게임 상태(JSONB, 버전)·플레이어(모드·안내 확인·결과)·명령 영수증 |
| chat_messages | 방 채팅(방별 순번, 30일 보관) |
| user_preferences | 개인 화면 설정 |

Redis에는 요청 제한 카운터와 OAuth state(10분, 1회 소비)만 둔다. 게임·채팅의 원본은 PostgreSQL이다.

## 6. 정책 값(확정 전 초안 포함)

| 항목 | 값 | 위치 |
|---|---|---|
| 정원 / 시작 최소 인원 | 2–6 / 2 | `game.policy.ts` |
| 턴 제한시간 | 60–300초(기본 180) | 〃 |
| 자리 비움 전환 | 연속 시간 초과 2회 | 〃 |
| 안내 대기 최대 | 120초 | `BRIEFING_TIMEOUT_SEC` |
| 봇 진행 템포 | 턴 첫 동작 1.8초, 이후 1.1초 | `AUTO_TURN_START_DELAY_MS`, `AUTO_STEP_DELAY_MS` |
| 초대 만료 | 10분 | `InvitePolicy` |
| 채팅 | 300자·10초 5건·50개 복원·30일 보관 | `ChatPolicy` |

## 7. 품질 검증

| 범위 | 명령 | 결과(2026-11-09) |
|---|---|---|
| 서버 단위·E2E | `npm --prefix apps/server test` | 68/68 |
| 게임 엔진 | `cd packages/shared && node --test` | 9/9 |
| 브라우저: 게임·멀티플레이 | `npm --prefix apps/web run test:e2e` | 18/18 |
| 브라우저: 반응형 레이아웃 | `npm --prefix apps/web run test:layout` | 23/23 |
| 브라우저: 설정·테마 | `npm --prefix apps/web run test:settings` | 18/18 |

브라우저 테스트는 시스템에 설치된 Google Chrome(`playwright-core`)을 쓰며, API(`TEST_MODE=true`)와 웹 dev 서버가 실행 중이어야 한다(`WEB_URL` 지정).

## 8. 미구현·제한

- 소셜 로그인 실제 공급자 연동(자격 증명 필요), 비밀번호 재설정·이메일 인증
- 회사(조직)·상점·재화·칭호·직급 마스터·직급별 이모지·회사 능력 — 서버 미구현(화면은 로컬 목업) → 설계: [tasks/GAME-ROOM-001.md](tasks/GAME-ROOM-001.md)
- 채팅 신고·차단, CMD 명령어 직접 입력, 같은 계정 다른 브라우저 간 설정 실시간 동기화
- 다중 API 인스턴스(Socket.IO Redis adapter·presence 이전 필요)
