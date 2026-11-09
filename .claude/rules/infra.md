---
paths:
  - "infra/**"
  - "apps/server/**"
  - "package.json"
---

# infra (INFRA-001 완료, 2026-11-09)

탐색 전에 이 요약을 먼저 믿는다. 상세: `infra/README.md`(실행), `docs/infrastructure.md` 하단(버전·검증), `apps/server/README.md`(서버 구조).

- 버전 고정: postgres:18.6-alpine · redis:8.10.3-alpine · node:24.22.2-alpine · Nest 12.2.0(CLI 12.0.10) · TS 6.0.3 · Prisma/@prisma/client/@prisma/adapter-pg 7.10.1 · pg 8.23.1 · ioredis 6.0.0 · zod 4.6.7. latest 태그 금지, 업그레이드 시 docs/infrastructure.md 표도 갱신.
- 명령은 루트에서 `npm run infra:up|ps|logs|stop|down|config`, `env:init`, `db:backup`, `db:restore:check`, `server:install|dev|migrate|check`. compose 는 항상 `-f infra/compose.yml --env-file infra/.env`.
- 함정:
  - Nest 12 = ESM 전용 → 상대 import 에 `.js` 필수. tsx/esbuild 는 decorator metadata 미지원이라 `nest start`/`tsc` 사용.
  - Prisma 7: URL 은 `prisma.config.ts`, 클라이언트는 adapter 필수, 생성물 `src/generated/prisma`(gitignore). 연결 오류 원인은 `err.meta.driverAdapterError.cause.kind`.
  - PG18 이미지: 볼륨은 `/var/lib/postgresql` 에 마운트(PGDATA=/var/lib/postgresql/18/docker).
  - Redis 비밀번호는 tmpfs conf + `exec docker-entrypoint.sh` (PID1=redis 사용자). 인자로 넘기지 말 것.
  - Nest `app.close()` 는 모듈 destroy 를 HTTP 종료보다 먼저 함 → main.ts 에서 HTTP 를 먼저 닫는다. 유지할 것.
  - Docker 이미지에서 prisma 는 `--ignore-scripts` 로 설치하면 schema-engine 이 없어 migrate 실패.
  - zsh 는 `$DC` 같은 변수를 단어 분리하지 않는다 → 스크립트는 bash 배열 사용.
- 금지: `down -v`/볼륨 삭제 자동 실행, FLUSHALL, 비밀값 출력(.env 값은 grep 해서 비교만). 테스트 데이터는 `check:infra` 의 마커 레코드·`oy:infra-check:*` 키만.
- 정책: Redis 는 만료 가능 데이터만. 인증·요청 제한에서 Redis 장애 시 우회 허용 금지(오류로 거부). 영속 진실은 PG.
- 새 env 변수: `apps/server/src/config/env.ts` + `apps/server/.env.example` (+ 필요 시 compose `server.environment`).
- 새 테이블: `prisma/schema.prisma` → `npm --prefix apps/server run db:migrate:create -- --name x` → SQL 검토 → `db:migrate:dev`. 모델 원본은 docs/db.md.
