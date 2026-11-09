# 개발 인프라 명세 · PostgreSQL / Redis

2026-11-09 기준 구현 지시안. INFRA-001 로 구현·실행 검증 완료(하단 결과 참조).

## 구성

| 구성 요소 | 역할 | 개발 기본값 |
|---|---|---|
| Vue / Vite | 사용자와 함께 검토 중인 로컬 목업 | 기존 실행 포트 유지 |
| NestJS / TypeScript | REST·Socket.IO 및 서버 권한 검증 | 127.0.0.1:3000 |
| PostgreSQL / Prisma | 사용자, 소속, 초대, 게임, 재화의 영속 원장 | 127.0.0.1:5432 |
| Redis | 일회성 인증 상태, 만료 데이터, 요청 제한, 접속 상태 | 127.0.0.1:6379 |

초기 API는 호스트에서 실행하고 PG·Redis는 Compose에서 실행한다. 컨테이너 내부 연결용 서비스 주소와 호스트 접속용 주소를 명확히 구분한다. 포트 충돌 시 기존 서비스를 종료하지 말고 환경변수로 이 프로젝트 포트를 바꾼다.

버전은 구현자가 공식 호환성을 확인해 선택하고 고정한다. latest 태그를 사용하지 않는다. PG 이미지의 실제 PGDATA 및 볼륨 마운트 경로는 선택한 메이저 버전 문서에 맞춘다.

## 산출물과 명령

- infra/compose.yml, infra/.env.example, infra/README.md
- apps/server/.env.example 및 서버 package.json의 dev/build/start/typecheck 명령
- DB 마이그레이션 생성·개발 적용·배포 적용 명령을 구분
- 전체 인프라 시작, 상태 확인, 로그 확인, 데이터 보존 종료, 백업·복원 안내
- 실제 비밀값을 제외한 DATABASE_URL, REDIS_URL, PORT, WEB_ORIGIN, NODE_ENV 예제

Compose의 env 파일 위치가 실행 디렉터리에 따라 달라지지 않도록 --env-file 및 -f를 명령에 명시한다. .env.example에는 플레이스홀더만 넣고 로컬 비밀값 생성 절차를 제공한다. 필수값이 없으면 조용히 기본 비밀번호로 시작하지 않고 오류를 반환한다.

## PostgreSQL

이 프로젝트 전용 사용자·DB·named volume을 만든다. pg_isready healthcheck를 구성한다. 영속 데이터는 PostgreSQL이 기준이다. UNIQUE, FK, CHECK와 트랜잭션으로 중복 가입·초대 수락·정원 초과·중복 정산을 차단한다.

개발 초기 사용자와 운영 최소 권한 계정의 차이를 문서화한다. 공개 네트워크에 DB 포트를 노출하지 않는다. 백업은 pg_dump, 복원은 별도 테스트 DB에서 검증한다. 테스트는 실제 개발 데이터를 지우지 않는 고유 DB/레코드를 사용한다.

## Redis

프로젝트 전용 named volume과 인증을 사용하고 개발 포트는 loopback에 바인딩한다. 비밀번호를 로그에 노출하지 않는 연결 설정과 healthcheck를 적용한다. AOF 활성화를 개발 기본 제안으로 두되 Redis 데이터는 만료·유실될 수 있음을 전제로 설계한다.

| 키 용도 | 정책 |
|---|---|
| OAuth state / PKCE verifier / nonce | 짧은 TTL, 서버 측 바인딩, 성공 시 원자적 1회 소비 |
| 요청 제한 | 계정·IP·동작별 제한, TTL, 원자적 증가 |
| 접속 상태 | 사용자·연결별 TTL 및 heartbeat |
| 조회 캐시 | 재생성 가능한 데이터, 명시적 TTL와 무효화 |
| 다중 API 소켓 전달 | 추후 필요 시 Socket.IO adapter 도입 |

실제 TTL·제한 수치는 후속 인증 및 부하 검토에서 확정한다. 이번 연결 검증에는 별도 테스트 키로 SET/GET/만료/삭제를 수행한다. FLUSHALL을 사용하지 않는다.

게임 상태·점수·지갑·소유권·회사 소속·초대 수락 결과는 Redis에만 저장하지 않는다. 게임 잠금과 중복 처리의 정확성은 PG 트랜잭션과 제약으로 확보한다. 큐와 다중 인스턴스는 이번 범위에 필수로 추가하지 않는다.

## 장애와 관측

- /health/live는 프로세스 생존 여부, /health/ready는 PG 및 Redis 연결 가능 여부를 검사한다.
- 연결 실패는 제한 시간 안에 실패하고 비밀 연결 문자열 없이 오류 원인을 남긴다.
- 인증 상태·요청 제한 저장소인 Redis 장애 시 인증·보호된 쓰기를 우회 허용하지 않는다. 읽기 전용 캐시만 PG fallback을 허용한다.
- SIGTERM/SIGINT 시 신규 요청을 종료 절차에 맞춰 처리하고 Prisma·Redis 연결을 닫는다.
- 로그는 requestId와 오류 코드 중심으로 작성한다. 토큰, 쿠키, OAuth code, 비밀번호는 마스킹한다.

## 검증 기준

| 확인 항목 | 기대 결과 |
|---|---|
| 첫 실행 | 빈 볼륨에서 서비스 health 통과 |
| 마이그레이션 | 새 개발 DB에서 재현 가능 |
| API 준비 상태 | 정상 200, PG 또는 Redis 중단 시 503 |
| 장애 복구 | 서비스 복원 뒤 준비 상태 정상화 |
| 재시작 | PG 테스트 레코드 유지 |
| Redis | 키 저장·조회·TTL 만료 확인 |
| 종료 | 연결 정리 후 정상 종료 |
| 비밀정보 | 추적 파일과 로그에 실제 자격증명 없음 |

선택한 버전과 검증 실행 결과는 Claude가 완료 후 이 문서 하단에 추가한다.

## 구현 결과 (INFRA-001, 2026-11-09, Claude)

실행 안내는 `infra/README.md`. 검증 환경: macOS arm64, Node 24.16.0, npm 11.13.0, Docker 29.1.3, Compose v2.40.3.

### 선택 버전

| 구성 | 버전 | 근거 |
|---|---|---|
| PostgreSQL | `postgres:18.6-alpine` | 18 최신 패치, arm64 이미지 확인. PG18 은 PGDATA=`/var/lib/postgresql/18/docker` → 볼륨을 `/var/lib/postgresql` 에 마운트 |
| Redis | `redis:8.10.3-alpine` | 8.x 최신 패치, arm64 확인. AOF(everysec) |
| Node (이미지) | `node:24.22.2-alpine` | Active LTS |
| NestJS | `@nestjs/*` 12.2.0, CLI 12.0.10 | 12.x 중 2주 이상 경과 릴리스(12.3+ 는 최근 배포). Nest 12 는 ESM 전용, Node ≥20 |
| TypeScript | 6.0.3 | Nest CLI 12 의존 범위 `~6.0.2`. TS 7(네이티브)은 미채택 |
| Prisma | `prisma`·`@prisma/client`·`@prisma/adapter-pg` 7.10.1, `pg` 8.23.1 | npm latest 태그는 8.0.0-rc 이므로 안정판 7.x 고정. Node `^20.19 \|\| ^22.12 \|\| >=24` |
| Redis 클라이언트 | `ioredis` 6.0.0 | |
| 검증 | `zod` 4.6.7 | |

### 동작 요약

- `/health/live`: 의존성 무관 200. `/health/ready`: PG `SELECT 1` + Redis `PING` 병렬, 각 `HEALTH_CHECK_TIMEOUT_MS`(1500) 제한, 실패·종료 중이면 503. 응답에는 오류 코드만(`DatabaseNotReachable`, `NOT_CONNECTED`, `TIMEOUT`).
- 시작 시 PG/Redis 불가여도 프로세스는 기동하고 ready=503, 복구 시 자동 200(ioredis 재연결 최대 5s 간격, pg 풀 재연결).
- Redis: `enableOfflineQueue=false`, `commandTimeout` 2s → 장애 시 즉시 실패(인증·요청 제한 우회 금지 정책의 기반). 키 prefix `oy:`.
- 종료: SIGTERM/SIGINT → draining(ready=503) → `SHUTDOWN_DRAIN_MS` 대기 → HTTP 수신 종료·진행 중 요청 완료 → Redis quit → Prisma disconnect → exit 0. `SHUTDOWN_TIMEOUT_MS` 초과 시 exit 1.
- 마이그레이션: `20261109094141_init_users_external_identities` (users, external_identities, enum auth_provider, UNIQUE(provider,subject), FK RESTRICT).

### 명세에 없어 임의로 정한 값 (확정 필요 시 변경)

- `auth_provider` 를 PG enum(KAKAO/GOOGLE/NAVER)으로 정의. 제공자 추가 시 마이그레이션 필요.
- users.nickname VARCHAR(40), department_label VARCHAR(60), 둘 다 프로필 완료 전 NULL 허용. 닉네임 UNIQUE 없음.
- external_identities → users FK 는 ON DELETE RESTRICT(회원 탈퇴 정책 미정).
- UUID v7 은 Prisma 측 생성(DB default 없음). raw SQL 삽입 시 id 를 직접 넣어야 한다.

### 검증 결과 (모두 실제 실행)

| 항목 | 결과 |
|---|---|
| 필수 비밀값 누락 | PASS — 비밀번호 비운 env 로 `compose up`/`config` 즉시 실패(exit 1) |
| 첫 실행 | PASS — 빈 볼륨에서 `npm run infra:up` 약 19s 내 둘 다 healthy |
| 마이그레이션 | PASS — 개발 DB `migrate dev`, 새 빈 DB 에 `migrate deploy` 적용·status up to date |
| API 준비 상태 | PASS — 정상 200 (~1–3ms) |
| PG 중단 / 정지(pause) | PASS — 503 `DatabaseNotReachable` 즉시 / 503 `TIMEOUT` 1.5s, live 는 200 유지 |
| Redis 중단 / 정지(pause) | PASS — 503 `NOT_CONNECTED` 즉시 / 503 `TIMEOUT` 1.5s |
| 장애 복구 | PASS — 컨테이너 재시작 후 자동 200. Redis 없이 API 시작 → Redis 기동 후 200 |
| 재시작·PG 영속성 | PASS — 마커 사용자 기록 후 `infra:down`(볼륨 유지)+`up`, API 재시작 후 동일 레코드 존재 |
| Redis | PASS — SET PX/GET/PTTL/만료 후 null/DEL. AOF 로 재시작 후 키·TTL 유지 |
| 종료 | PASS — SIGTERM·SIGINT exit 0, 진행 중 요청 완료 후 연결 해제, idle keep-alive 클라이언트가 있어도 22ms 내 종료, drain 중 ready=503 |
| 컨테이너 경로 | PASS — `infra:up:app` 이미지 빌드, 내부 주소로 migrate deploy·ready 200, non-root(node), `docker stop` exit 0 |
| 백업·복원 | PASS — `db:backup` → 별도 DB 복원·행 수 확인 후 삭제 |
| 비밀정보 | PASS — PG/Redis/API 로그, Redis 프로세스 인자, 비무시 파일에서 실제 비밀번호 0건. `.env`·백업·생성물 gitignore 확인 |

미실행·한계: 실제 EC2/RDS/ElastiCache 연결, TLS(`sslmode=require`, `rediss://`) 실연결, 운영 최소 권한 역할 생성, 부하·다중 인스턴스, 자동화된 테스트 스위트(현재는 `check:infra` 스크립트). API 이미지 757MB 로 경량화 여지 있음. 저장소가 git 이 아니어서 `git status` 기반 추적 파일 검사는 임시 git 으로 `.gitignore` 규칙만 확인했다.
