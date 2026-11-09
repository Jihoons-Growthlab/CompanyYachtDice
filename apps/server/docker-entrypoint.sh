#!/bin/sh
# RUN_MIGRATIONS=true 이면 시작 전에 migrate deploy 를 적용한다(단일 인스턴스용).
# 다중 인스턴스에서는 배포 파이프라인에서 1회만 실행하고 이 값을 false 로 둔다.
set -e
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  node node_modules/prisma/build/index.js migrate deploy
fi
exec "$@"
