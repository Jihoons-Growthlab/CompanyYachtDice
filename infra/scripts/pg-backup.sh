#!/usr/bin/env bash
# pg_dump (custom format) → infra/backups/<db>-<UTC시각>.dump
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DC=(docker compose -f "$ROOT/infra/compose.yml" --env-file "$ROOT/infra/.env")
mkdir -p "$ROOT/infra/backups"
DB="$("${DC[@]}" exec -T postgres sh -c 'printf %s "$POSTGRES_DB"')"
OUT="$ROOT/infra/backups/${DB}-$(date -u +%Y%m%dT%H%M%SZ).dump"
"${DC[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner' > "$OUT"
echo "백업: ${OUT#$ROOT/} ($(wc -c < "$OUT" | tr -d ' ') bytes)"
