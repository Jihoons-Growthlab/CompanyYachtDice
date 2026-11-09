# infra · 로컬 개발 인프라 실행 안내

PostgreSQL 18 + Redis 8 을 Docker Compose(프로젝트명 `officeyacht`)로 띄우고, API(NestJS)는 호스트에서 실행한다.
모든 명령은 **저장소 루트**에서 실행한다. 루트 `package.json` 은 명령 모음일 뿐 의존성이 없다.

## 0. 요구 사항

- Node `^22.18` 또는 `^24.11` (Prisma 7 요구), npm 10+
- Docker Desktop (Compose v2). Apple Silicon/arm64 및 amd64 모두 지원 이미지 사용
- 포트 127.0.0.1:5432 / 6379 / 3000 (충돌 시 3번 참고)

## 1. 처음 한 번

```sh
npm run env:init          # infra/.env + apps/server/.env 생성(랜덤 비밀번호, 권한 600, 값 미출력, 기존 파일 보존)
npm run infra:up          # PG·Redis 기동 후 healthy 될 때까지 대기(--wait)
npm run server:install    # apps/server npm ci (+ prisma generate)
npm run server:migrate    # prisma migrate deploy (빈 DB에 마이그레이션 적용)
npm run server:dev        # http://127.0.0.1:3000 (watch)
npm run server:check      # health·Redis TTL·PG 쓰기/읽기 점검 (전용 마커 데이터만 사용)
```

확인: `curl -s localhost:3000/health/live` → 200, `curl -s localhost:3000/health/ready` → 200 (PG·Redis 중 하나라도 불가하면 503).

## 2. 일상 명령

| 목적 | 명령 |
|---|---|
| 시작 / 상태 / 로그 | `npm run infra:up` / `npm run infra:ps` / `npm run infra:logs` |
| 데이터 보존 정지 | `npm run infra:stop` (컨테이너 유지) 또는 `npm run infra:down` (컨테이너·네트워크 제거, **볼륨 유지**) |
| 설정 검증 | `npm run infra:config` (필수 비밀값 누락 시 실패) |
| 백업 | `npm run db:backup` → `infra/backups/<db>-<UTC>.dump` (git 제외) |
| 복원 검증 | `npm run db:restore:check -- infra/backups/<파일>.dump` → 별도 DB `<db>_restore_check` 에 복원·행 수 출력 후 삭제(`--keep` 로 유지) |
| psql | `docker compose -f infra/compose.yml --env-file infra/.env exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'` |
| redis-cli | `docker compose -f infra/compose.yml --env-file infra/.env exec redis sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli'` |
| API 컨테이너 리허설 | `npm run infra:up:app` → 127.0.0.1:3001, 내부 주소 `postgres:5432`/`redis:6379`, 시작 시 migrate deploy |

데이터 완전 삭제(`down -v`, 볼륨 rm)는 자동화하지 않는다. 필요하면 백업 후 직접 실행한다:
`docker compose -f infra/compose.yml --env-file infra/.env down -v`

## 3. 포트 충돌

기존 서비스를 끄지 말고 `infra/.env` 의 `PG_HOST_PORT`/`REDIS_HOST_PORT` 를 바꾼 뒤,
`apps/server/.env` 의 `DATABASE_URL`/`REDIS_URL` 포트도 같은 값으로 맞춘다. (처음이면 `PG_HOST_PORT=5433 npm run env:init` 처럼 생성 시 지정 가능)

## 4. 주소 구분

| 실행 위치 | PostgreSQL | Redis |
|---|---|---|
| 호스트(Mac)의 API·CLI | `127.0.0.1:${PG_HOST_PORT}` | `127.0.0.1:${REDIS_HOST_PORT}` |
| Compose 네트워크 안의 컨테이너 | `postgres:5432` | `redis:6379` |

## 5. 비밀값 규칙

- `.env.example` 의 비밀값은 비워 둔다. 비어 있으면 `${VAR:?}` 로 compose 가 즉시 실패한다(기본 비밀번호로 조용히 시작하지 않음).
- Redis 비밀번호는 tmpfs 의 설정 파일로 전달해 프로세스 인자·로그에 남지 않는다. healthcheck 는 `REDISCLI_AUTH` 사용.
- 개발용 한계: `docker inspect` 로 컨테이너 환경변수가 보인다. 운영에서는 Secrets Manager/SSM 등으로 주입한다.
- PG 볼륨이 이미 초기화된 뒤 `POSTGRES_PASSWORD` 를 바꿔도 기존 DB 비밀번호는 바뀌지 않는다(초기화 시 1회 적용). `ALTER ROLE` 로 변경하거나 백업 후 볼륨을 재생성한다.

## 6. 개발 계정 vs 운영 계정

개발 `POSTGRES_USER` 는 이미지가 만든 **superuser** 다(`prisma migrate dev` 의 shadow DB 생성에 필요).
운영은 최소 2개 역할로 분리한다:

```sql
-- 마이그레이션 전용(배포 파이프라인에서만 사용): 스키마 소유자
CREATE ROLE oy_migrator LOGIN PASSWORD '...';
GRANT CREATE, USAGE ON SCHEMA public TO oy_migrator;
-- 앱 런타임: DML 만
CREATE ROLE oy_app LOGIN PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oy_app;
ALTER DEFAULT PRIVILEGES FOR ROLE oy_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO oy_app;
ALTER DEFAULT PRIVILEGES FOR ROLE oy_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO oy_app;
```

## 7. EC2 이전 가이드(요약)

코드는 환경변수만으로 대상이 바뀌도록 되어 있다(호스트·포트·TLS 가 URL 에 포함).

| 단계 | 권장 |
|---|---|
| A. 단일 EC2 + Compose | 이 compose 를 그대로 사용 가능. `--profile app` 으로 API 컨테이너 포함. API 포트는 Nginx/ALB 뒤에 두고 PG·Redis 포트는 외부에 열지 않는다(이미 127.0.0.1 바인딩). 볼륨은 EBS, 백업은 `db:backup` 을 cron + S3 업로드 |
| B. 관리형 전환(권장) | PG → RDS for PostgreSQL 18 (`DATABASE_URL=...?sslmode=require`), Redis → ElastiCache/Valkey(`REDIS_URL=rediss://...`). EC2 에는 API 컨테이너만 |
| 이미지 | `apps/server/Dockerfile` (multi-arch, non-root, HEALTHCHECK). Graviton(arm64) 에서 그대로 빌드 가능. ECR 에 push |
| 마이그레이션 | 단일 인스턴스는 `RUN_MIGRATIONS=true`, 다중 인스턴스는 배포 단계에서 `npm run db:migrate:deploy` 1회 + `RUN_MIGRATIONS=false` |
| 로드밸런서 | ALB 대상 헬스체크 `/health/ready`, `TRUST_PROXY=true`, `SHUTDOWN_DRAIN_MS` ≥ ALB deregistration 지연(예: 15000), `SHUTDOWN_TIMEOUT_MS` 는 그보다 크게 |
| 비밀값 | `.env` 파일 대신 SSM Parameter Store/Secrets Manager → 컨테이너 env. 앱은 이미 설정된 env 를 `.env` 로 덮어쓰지 않는다 |
| 다중 인스턴스 | Socket.IO Redis adapter, 기한 워커 단일화 등은 별도 검증 (docs/architecture.md) |
