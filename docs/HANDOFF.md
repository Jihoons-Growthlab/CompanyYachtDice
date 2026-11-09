# 중간 인수인계 · 2026-11-09

## 현재 분담

Codex와 사용자는 Vue 목업을 계속 검토한다. Claude는 PostgreSQL·Redis 개발 인프라를 먼저 구성한다. 시작 문서는 docs/tasks/INFRA-001.md다. 이번 문서 갱신 시점에 서버·DB·Redis 구현은 아직 없다.

## 구현된 목업

- 엑셀 편집기 및 인사·평가 문서 컨셉, 업무 명칭과 실제 기능 툴팁
- 카카오·Google·네이버 모의 인증, 동의·취소·실패·종료
- 첫 인증 후 사원명·일반 부서 선택·직접 입력
- 회사 클랜 목록·검색·랭킹·설립·신청·대표 승인·초대 수락
- 게임방 PL, 2~4인 정원, 사원 초대·준비·PL 시작 권한
- 다인 점수표, 로컬 봇 대전, 가상 포인트 구매 및 장식 배치

apps/web/src/components/CompanyDirectory.vue와 EvaluationRoom.vue는 시연용이다. 상태는 메모리이며 새로고침 및 일부 화면 수명에 따라 초기화된다. 제공자별 실제 계정 구분·실제 사용자 간 초대·서버 권한 검증·영속 저장은 후속 구현이다.

## 확인된 검증

Vue 빌드 및 공통 점수 함수 3건 테스트를 실행했다. 로컬 Chrome 1280px·390px에서 인사 등록, 회사 신청·승인·초대 수락, 게임방 정원·준비·PL 권한과 4인 12라운드 결과를 확인했다. 브라우저 검증 스크립트는 임시 실행 자료이며 저장소의 지속적인 E2E 테스트 스위트는 아직 없다.

## 문서 읽기 순서

- 인프라 작업은 tasks/INFRA-001.md → infrastructure.md → architecture.md
- 인증 작업은 features/auth.md
- 도메인 구현은 해당 features 문서와 contracts, db.md
- 규칙 점수는 packages/shared/scoring.mjs를 재사용

게임 시간 제한·코인 보상·승진 수치·랭킹 집계는 초안이 포함되어 있으므로 제품 확정 여부를 확인한다. 이번 인프라 구성에서 웹 목업이나 제품 정책을 재작성하지 않는다.

## 인프라 결과 (Claude · INFRA-001 · 2026-11-09)

PG 18.6·Redis 8.10.3 Compose, NestJS 12 + Prisma 7 API(health·종료 처리), users/external_identities 첫 마이그레이션 완료. 버전·검증표는 docs/infrastructure.md 하단, 실행은 infra/README.md, Claude 요약 규칙은 .claude/rules/infra.md.

- 시작: `npm run env:init && npm run infra:up && npm run server:install && npm run server:migrate && npm run server:dev` → `npm run server:check`
- 변경 경로: infra/**, apps/server/**, 루트 package.json(명령만, 의존성·잠금 파일 없음), .gitignore, docs/infrastructure.md, .claude/rules/infra.md, CLAUDE.md 안내 1줄. apps/web·packages/shared 미변경.
- 미검증: 실제 EC2/RDS/ElastiCache·TLS 연결, 운영 최소 권한 역할, 다중 인스턴스.
- 다음 작업 하나: 인증 1단계 — docs/features/auth.md 기준 OAuth state/PKCE 의 Redis 1회 소비 저장소와 sessions 테이블 마이그레이션.

## 게임 방 개선 설계 (Claude · GAME-ROOM-001 · 2026-11-09)

ROOM-001·GAME-001·CHAT-001/002·COMPANY-001·DICE-001의 분석·DB 설계·단계 계획·미확정 정책 Q1–Q17은 docs/tasks/GAME-ROOM-001.md에 있다. 코드 변경은 없다. 코드 위치 요약은 docs/codemap.md. 다음 작업: 사용자의 Q 항목 결정 → 승인된 단계부터 구현.

## P1 인증 구현 (Claude · 2026-11-09)

이메일·비밀번호 가입/로그인, argon2id, JWT access(10분, 메모리 보관 전제) + HttpOnly refresh 쿠키 회전·재사용 탐지·로그아웃(현재/전체), `/me`, `/me/profile`, 전역 JWT 가드, Origin 검사, Redis 요청 제한(fail closed), 통일 오류 형식. 정책은 docs/features/auth.md "보안 정책", 경로는 docs/contracts/rest.md "구현됨".

- 검증: `npm --prefix apps/server test` → 25/25 통과(단위 4, E2E 21). dev 서버 수동 스모크(signup→me→refresh→logout)와 로그 비밀값 0건, API 컨테이너 재빌드 후 ready 200·`/api/v1/me` 401 확인.
- 변경: apps/server(auth/, users/, common/, app.factory.ts, schema+마이그레이션 `auth_local_credentials_sessions`, test/, scripts/test-prepare.mjs, jose 6.2.13, engines Node ^24.11), infra/compose.yml(server env_file), infra/scripts/init-env.sh(JWT 비밀값 보충), docs(auth·rest·db·codemap), .claude/rules/backend.md.
- 결정·주의: auth.md의 "소셜만 제공"과 다르게 로컬 계정을 추가함(요청 반영). 서버는 이제 Node 24 이상 필요(`crypto.argon2`). 기존 `.env`가 있으면 `npm run env:init`이 `JWT_ACCESS_SECRET`만 보충한다.
- 미구현: 비밀번호 재설정·이메일 인증, 소셜 OAuth, 만료 세션 정리 작업, 프론트 연동(P4).
- 다음: P2 게임 엔진(`packages/shared`) — 시작 전 아래 "P2 확인 사항" 결정 필요.

### P2 확인 사항 (게임 엔진 착수 전)

1. 엔진 위치: `packages/shared`(웹·서버 공유, 현재 Codex 영역) vs `apps/server/src/game`(서버 전용). 권장은 shared이고 Codex와 조율이 필요하다.
2. 공유 방식: shared는 타입 없는 `.mjs`이고 Nest의 tsc `rootDir`는 `src`라 바로 import할 수 없다. 권장은 shared를 TS 패키지(`@officeyacht/shared`, 자체 build)로 바꾸고 서버는 `file:` 의존성으로 쓰는 것이다. 웹의 `../../../packages/shared/scoring.mjs` import 경로에 영향이 있다.
3. 최대 인원: 요청은 6명, 명세(lobby.md·db.md CHECK)는 2–4명이다. 엔진은 2–6명을 지원하도록 만들고 방 정원 상한은 정책 값으로 둔다.
4. 오토 전략 수준: (a) 기존 초안(1회 굴림 + 최고점 칸) 또는 (b) 보관 휴리스틱(많은 눈 유지, 스트레이트 추구, 상단 보너스 고려). 수동 시간 초과(Q3)는 정책 모듈의 기본값으로 둔다.
5. 턴 제한시간 기본값(Q1. 명세는 60초). 엔진은 시각을 모르고 서버가 기한을 관리한다.

## Swagger·소셜 로그인·테스트 모드·게임방/게임 서버 (Claude · 2026-11-09)

| 기능 | 상태 |
|---|---|
| Swagger `/docs` | 완료: 31개 실제 경로, Bearer Authorize, refresh 쿠키 설명, 오류 코드·예시. production 기본 꺼짐 |
| 게임 엔진 | 완료: `packages/shared/engine.mjs`·`autoplay.mjs`(웹·서버 공유) |
| 방·준비·시작 | 완료: REST + Socket.IO, 정원 2–6, 턴 10/15/30/60초, 위임, 중복 시작 방지 |
| 게임 진행 | 완료: 서버 검증·멱등 명령·서버 턴 타이머·시간 초과·AWAY·오토·재시작 복구·결과 순위 |
| 테스트 모드 | 부분: 간편 로그인·봇·강제 시작·종료 시뮬레이션·초기화 완료. 재화·회사 승인·직급 지정은 서버 기능 없음 |
| 소셜 로그인 | 부분: 서버·웹 구현과 가짜 공급자 테스트 완료. **실제 Google·카카오·네이버 연동은 자격 증명이 없어 미검증** |
| Vue 연동 | 부분: 로그인(이메일·소셜)·인사 등록·로비·대기실·게임·연결 상태·DEV 패널. 채팅·상점·조직은 로컬 목업, 주사위 애니메이션 미구현. 브라우저 클릭 E2E는 미실행(프록시 경유 호출 재현만) |

- 검증: 서버 `npm --prefix apps/server test` 53/53, shared `node --test` 9/9, `apps/web` `npm run build` 성공·운영 번들 `/dev/` 0건, Vite 프록시(5189) 경유 dev 로그인→소켓→테스트 방→시작→종료 재현, API 컨테이너(production)에서 `/docs`·`/dev` 404 확인.
- 실행: `npm run infra:up` → `npm run server:dev`(3000, `/docs`) → `cd apps/web && npm run dev`. 개발 테스트는 `apps/server/.env`의 `TEST_MODE=true`.
- 주의: 5173은 다른 프로젝트(휴지통의 shipyard…)가 점유 중이라 웹이 5189로 떴다. 소셜 로그인 Redirect URI를 쓰려면 5173을 비우거나 `OAUTH_REDIRECT_BASE_URL`·`WEB_APP_URL`을 실제 포트로 맞춘다.
- Docker 빌드 컨텍스트가 저장소 루트로 바뀌었다(`apps/server/Dockerfile`, 루트 `.dockerignore`). 서버가 packages/shared를 쓰기 때문이다.
- 다음 작업 하나: 브라우저에서 2개 계정(일반 창 + 시크릿 창)으로 대기실 → 게임 전체 흐름을 수동 확인한 뒤, 서버 채팅(P3, CHAT-001)을 진행한다.


## 게임 플레이·실시간 채팅 완성 (Claude · 2026-11-09)

상태·흐름·이벤트·구조·실행·테스트는 **docs/development-status.md**에 있다.
- 추가: 방 옵션(비공개 코드·봇 허용), 실시간 로비, 초대(검색·알림·수락/거절·만료), 봇 추가/제외, 서버 채팅(PG, seq, 중복 방지, 속도 제한, 시스템 메시지, 50개 복원, 30일 삭제), 굴림 애니메이션, 결과 화면·다시 하기, 새로고침 복원, 오프라인 감지·heartbeat 단축.
- 검증: 서버 62/62, shared 9/9, 웹 빌드(운영 번들 /dev 0건), **실제 Chrome 2컨텍스트 E2E 15/15(연속 2회)**, 데스크톱·390px 스크린샷 확인.
- E2E로 발견해 수정한 것: 새로고침 시 채팅 미복원, 오프라인 표시 지연(최대 45초), 넓은 화면에서 접힌 채팅을 펼 수 없음.
- 미검증·미구현: 실제 소셜 공급자 연동, 채팅 신고·차단, 조직·상점 서버, 직급 마스터·이모지·회사 능력.
- 다음 작업 하나: 실제 소셜 자격 증명을 넣어 공급자별 로그인을 확인하고(social-login-setup.md §5), 이어서 직급 마스터와 직급별 이모지(CHAT-002)를 진행한다.


## 게임 템포·UI/UX 개선 (Claude · 2026-11-09)

- 실제 브라우저 점검에서 찾은 문제: 시작 즉시 타이머 진행·규칙 안내 없음(S1), 점수 칸 한 번 클릭이 즉시 기록(S1), 용어만 있는 조작·작은 안내(S2), 약한 고정 표시(S2), 0.7초 간격 봇(S2), 61초 표시·숫자 주사위(S3). E2E 중 모바일에서 DEV 패널이 안내를 가리는 문제도 발견해 수정했다.
- 변경: 턴 1–5분(기본 3분, DB CHECK 3–300, 옛 대기방 3분 이관), 시작 안내 단계(서버 동기화·타이머 정지·120초 후 시작), 매뉴얼·도움말, 선택→확정 분리와 계산 근거, 다음 행동 안내, 주사위 면·고정 강조, 분:초 타이머(30초 미만 강조), 알림, 봇 템포 1.8초/1.1초, 모바일 터치 크기.
- 검증: 서버 65/65, shared 9/9, 웹 빌드(운영 /dev 0건), 실제 Chrome E2E 18/18(연속 2회).
- 다음 작업 하나: 첫 판 사용자 대상 "추천 항목" 표시(가장 높은 예상 점수 강조) 여부를 결정하고, 실제 사용자 1–2명 플레이 테스트로 문구를 다듬는다.


## 전체 레이아웃·채팅창 개선 (Claude · 2026-11-09)

- 실제 화면 측정 기반(`e2e/screenshots/before|after`, layout.json): 콘텐츠 최대 864px 고정 → 화면 폭 활용(최대 1480), 채팅 220→399px(1440 기준 ×1.81, 목록 174→357px), 점수표가 첫 화면 밖(y726) → 한 화면에 주사위·점수표·채팅(y347, 1280/1440에서 16행 모두 보임), 선택 시 점수표 밀림 → 행동 안내 상자 높이 고정, 결과표 총점 잘림·모바일 머리글 잘림·버튼 높이 불일치 수정.
- 명칭: "? 게임 방법" → "📋 평가 양식 안내 / 평가 규정 및 점수 산정 기준"(버튼·대기실·모달 제목·안내 문구). 내부 식별자는 유지.
- 변경 파일: apps/web/src/App.vue(게임 패널 구조), components/GameGuide.vue·EvaluationRoom.vue·RoomChat.vue(접기 기준 1023px), style.css(레이아웃 v2 블록), e2e/layout.e2e.mjs·layout-capture.mjs(신규), package.json(scripts), .gitignore(screenshots). 서버·엔진·API·DB·소켓 변경 없음.
- 검증: 레이아웃 E2E 23/23(연속 2회), 게임 E2E 18/18, 서버 65/65, shared 9/9, 빌드·운영 번들 /dev 0건.
- 다음 작업 하나: 1024px 노트북에서는 점수표가 조작 영역 아래로 내려간다(게임 패널 594px). 엑셀 리본 높이(약 230px)를 게임 화면에서 접는 옵션을 검토한다.


## 환경 설정·Excel/CMD 모드 (Claude · 2026-11-09)

- 착수 전 확인: 마지막 인수인계(21:16) 이후 프로젝트 파일을 바꾼 다른 작업이 없어 그대로 통합했다(Codex 앱은 실행 중이었으나 파일 변경 없음). "게임 속도·레이아웃·이탈 처리"는 이미 반영된 상태였다.
- 추가: ⚙ 환경 설정(모든 헤더 오른쪽 끝), UI 모드 Excel/CMD(테마 토큰, 같은 컴포넌트), UI 크기, 애니메이션 축소, 게임 중 리본 접기, 진행 연출 속도, 주사위 애니메이션, 턴 시작 알림, 효과음(Web Audio)·음량, 계정별 저장(`user_preferences`, GET/PATCH /me/preferences), 첫 렌더 전 테마 적용, 점수표 "#" 열 가운데 정렬.
- 정책: 로그인하면 서버 우선, 첫 로그인은 게스트 설정을 업로드, 로그아웃하면 게스트 설정. 자세한 내용은 features/settings.md.
- E2E로 찾은 문제(수정): 새로고침 때 CMD→엑셀→CMD 깜빡임. CMD에서 항목명 칸 테두리, 수식줄 셀 상자, 하단 흰 띠.
- 검증: 서버 68/68, shared 9/9, 빌드(운영 /dev 0건·테스트 로그 0건), E2E 게임 18/18·레이아웃 23/23·설정 18/18. 스크린샷: apps/web/e2e/screenshots/settings/.
- 미구현: CMD 명령어 직접 입력, 같은 계정 다른 브라우저 실시간 설정 동기화(로그인·새로고침 때 반영).
- 다음 작업 하나: CMD 모드 명령 입력(ROLL / HOLD 1 3 / SCORE ACES / CONFIRM)을 기존 수식 입력줄 처리(runFormula)에 연결한다.


## 명세서·README 정리 (Claude · 2026-11-09)

- 추가: `docs/SPEC.md`(오늘까지 구현 전체 요약 명세), `README.md` 전면 개편(스크린샷 10장 `docs/images/`, 게임 방법·빠른 시작·테스트·문서 안내).
- 스크린샷 촬영 중 발견해 수정: 로비 '비공개' 배지 간격, 결과표 '보너스' 머리글 줄바꿈, **CMD 모드에서 기록한 점수 글자가 안 보이던 문제**, 모바일 헤더의 ⚙ 버튼이 둘째 줄로 밀리던 문제.
- git 업로드 점검: `.env`·node_modules·dist·생성물·백업·테스트 스크린샷 제외 확인, 실제 비밀값이 추적 대상 파일에 0건, 포함 예정 172개 파일 약 2.5MB. 저장소는 아직 `git init` 전이다.
- 검증: 브라우저 E2E 18/18·23/23·18/18(수정 후 재실행).
