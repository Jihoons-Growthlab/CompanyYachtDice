#!/usr/bin/env bash
# 로컬 비밀값을 생성해 infra/.env 와 apps/server/.env 를 만든다.
# - 이미 있는 파일은 덮어쓰지 않는다 (--force 없이는).
# - 비밀값을 화면에 출력하지 않는다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INFRA_ENV="$ROOT/infra/.env"
SERVER_ENV="$ROOT/apps/server/.env"

# 이미 만든 apps/server/.env 에 이후 추가된 비밀값이 없으면 보충한다(기존 값은 유지).
if [[ -f "$SERVER_ENV" ]] && ! grep -qE '^JWT_ACCESS_SECRET=.{32,}' "$SERVER_ENV"; then
  command -v openssl >/dev/null || { echo "openssl 필요" >&2; exit 1; }
  sed -i.bak '/^JWT_ACCESS_SECRET=/d' "$SERVER_ENV" && rm -f "$SERVER_ENV.bak"
  printf '\n# 추가됨(P1 인증)\nJWT_ACCESS_SECRET=%s\n' "$(openssl rand -base64 48 | tr -d '\n')" >> "$SERVER_ENV"
  echo "apps/server/.env 에 JWT_ACCESS_SECRET 추가(값 미출력)"
fi

if [[ -f "$INFRA_ENV" || -f "$SERVER_ENV" ]]; then
  echo "이미 존재: $( [[ -f $INFRA_ENV ]] && echo infra/.env ) $( [[ -f $SERVER_ENV ]] && echo apps/server/.env )"
  echo "기존 값을 유지한다. 새로 만들려면 파일을 직접 백업·삭제 후 다시 실행한다."
  echo "(주의) PG 볼륨이 이미 초기화된 뒤 POSTGRES_PASSWORD 를 바꾸면 기존 DB 비밀번호와 달라진다."
  exit 0
fi

command -v openssl >/dev/null || { echo "openssl 필요" >&2; exit 1; }
PG_PW="$(openssl rand -hex 24)"   # hex: URL 인코딩 불필요
RD_PW="$(openssl rand -hex 24)"
PG_USER=officeyacht
PG_DB=officeyacht_dev
PG_PORT="${PG_HOST_PORT:-5432}"
RD_PORT="${REDIS_HOST_PORT:-6379}"

umask 077
sed -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$PG_PW/" \
    -e "s/^REDIS_PASSWORD=.*/REDIS_PASSWORD=$RD_PW/" \
    -e "s/^PG_HOST_PORT=.*/PG_HOST_PORT=$PG_PORT/" \
    -e "s/^REDIS_HOST_PORT=.*/REDIS_HOST_PORT=$RD_PORT/" \
    "$ROOT/infra/.env.example" > "$INFRA_ENV"

sed -e "s#^DATABASE_URL=.*#DATABASE_URL=postgresql://$PG_USER:$PG_PW@127.0.0.1:$PG_PORT/$PG_DB?schema=public#" \
    -e "s#^REDIS_URL=.*#REDIS_URL=redis://:$RD_PW@127.0.0.1:$RD_PORT/0#" \
    -e "s#^JWT_ACCESS_SECRET=.*#JWT_ACCESS_SECRET=$(openssl rand -base64 48 | tr -d '\n' | tr '/+' '_-')#" \
    "$ROOT/apps/server/.env.example" > "$SERVER_ENV"

echo "생성 완료: infra/.env, apps/server/.env (권한 600, 값은 출력하지 않음)"
