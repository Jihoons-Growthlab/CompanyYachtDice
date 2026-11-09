#!/usr/bin/env bash
# 백업 파일을 별도 검증 DB(<db>_restore_check)에 복원해 테이블·행 수를 확인한다.
# 개발 DB 는 건드리지 않는다. 사용: infra/scripts/pg-restore-test.sh infra/backups/xxx.dump [--keep]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DUMP="${1:?백업 파일 경로 필요}"; KEEP="${2:-}"
DC=(docker compose -f "$ROOT/infra/compose.yml" --env-file "$ROOT/infra/.env")
DB="$("${DC[@]}" exec -T postgres sh -c 'printf %s "$POSTGRES_DB"')"
TARGET="${DB}_restore_check"
psqlc() { "${DC[@]}" exec -T postgres sh -c "psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d $1 -Atc \"$2\""; }

psqlc postgres "DROP DATABASE IF EXISTS \\\"$TARGET\\\"" >/dev/null
psqlc postgres "CREATE DATABASE \\\"$TARGET\\\"" >/dev/null
"${DC[@]}" exec -T postgres sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $TARGET --no-owner --exit-on-error" < "$DUMP"
echo "복원 대상: $TARGET"
psqlc "$TARGET" "SELECT relname || '=' || n_live_tup FROM pg_stat_user_tables ORDER BY relname" || true
psqlc "$TARGET" "SELECT 'migrations=' || count(*) FROM _prisma_migrations" || true
if [[ "$KEEP" != "--keep" ]]; then psqlc postgres "DROP DATABASE \\\"$TARGET\\\"" >/dev/null; echo "검증 DB 삭제 완료"; fi
