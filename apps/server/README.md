# apps/server · NestJS API

NestJS·Socket.IO 구현 위치. 설계는 docs/architecture.md, 인프라 실행은 infra/README.md.

- Nest 12 는 **ESM 전용** → `"type": "module"`, TS `nodenext`, 상대 import 에 `.js` 확장자 필수.
- Prisma 7: 연결 URL 은 `prisma.config.ts`(스키마에 url 없음), 클라이언트는 `@prisma/adapter-pg` 필수, 생성물은 `src/generated/prisma`(git 제외, `postinstall` 에서 생성).
- 환경변수는 `src/config/env.ts`(zod) 에서 검증. 새 변수는 여기와 `.env.example` 에 함께 추가.

| 명령 | 내용 |
|---|---|
| `npm run dev` / `build` / `start` / `typecheck` | 개발(watch) / 빌드 / dist 실행 / 타입 검사 |
| `npm run db:migrate:create -- --name <이름>` | 마이그레이션 SQL 만 생성(검토용, 적용 안 함) |
| `npm run db:migrate:dev` | 개발 DB 에 생성+적용 (shadow DB 사용) |
| `npm run db:migrate:deploy` | 기존 마이그레이션만 적용(운영·CI·새 DB) |
| `npm run db:migrate:status` | 적용 상태 |
| `npm run check:infra [-- health\|redis\|pg:write\|pg:read\|pg:clean]` | 연결 점검 |
| `npm test` | 빌드 → 테스트 DB(`<db>_test`) 준비 → 단위·E2E (PG·Redis 실행 필요) |

| 경로 | 책임 |
|---|---|
| `src/main.ts` | 부트스트랩, requestId 로그, CORS, SIGTERM/SIGINT 종료 절차 |
| `src/config/` | env 검증·전역 주입(`@Inject(ENV)`) |
| `src/prisma/`, `src/redis/` | 클라이언트 초기화·timeout·종료 |
| `src/health/` | `/health/live`, `/health/ready`, draining 상태 |
| `src/auth/`, `src/users/` | P1 인증·사용자 (정책: docs/features/auth.md "보안 정책") |
| `src/common/util.ts` | `withTimeout`, `redact`, `errorCode` |

## API 문서(Swagger) 사용

- 주소: 서버 실행 후 **http://localhost:3000/docs** (OpenAPI JSON: `/docs/json`). `API_DOCS_ENABLED`로 제어하며, production 기본값은 꺼짐.
- 순서: `인증 › POST /api/v1/auth/signup`(또는 login) 실행 → 응답의 `accessToken` 복사 → 오른쪽 위 **Authorize**의 `access`에 붙여넣기 → `GET /api/v1/me`.
- refresh token은 HttpOnly 쿠키라 같은 주소의 Swagger UI에서는 `POST /auth/refresh`를 그냥 실행하면 된다.
- 문서는 실제 등록된 라우트에서 생성되므로 미구현 API는 나타나지 않는다. 요청·응답 스키마는 검증에 쓰는 zod 스키마에서 만든다.

## 개발자 테스트 모드 (TEST_MODE)

`.env`에 `TEST_MODE=true`를 둔다. 실제로 켜지는 조건은 NODE_ENV ≠ production이고, DATABASE_URL이 localhost·127.0.0.1·compose `postgres`를 가리킬 때뿐이다.

| 기능 | 경로 / 웹 |
|---|---|
| 테스트 계정 1–6 생성·간편 로그인 | `POST /dev/accounts`, `POST /dev/login {slot}` / DEV 패널 "접속" |
| 테스트 방 + 봇 채우기 + 바로 시작 | `POST /dev/rooms {capacity,bots,turnTimeLimitSec 3–60,start}` |
| 봇 추가(자동 준비·자동 진행) | `POST /dev/rooms/:id/bots` |
| 다른 테스트 계정 입장(초대 우회) | `POST /dev/rooms/:id/members {slot,ready}` |
| 전체 준비 / 강제 시작(혼자 가능) | `/dev/rooms/:id/ready-all`, `/force-start` |
| 종료 시뮬레이션(엔진·오토 전략) | `POST /dev/matches/:id/finish` |
| 초기화(테스트 방·게임, 선택적으로 테스트 계정) | `POST /dev/reset {accounts}` |

미구현: 재화·아이템 지급, 회사 가입 자동 승인(해당 서버 기능 없음), 직급 지정(직급 마스터 미정).
운영 차단: production에서는 `/dev/*`가 등록되지 않고(404), 웹 운영 빌드에는 DEV 패널 코드가 들어가지 않는다.
