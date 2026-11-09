# OfficeYacht API 이미지 (linux/arm64·amd64 공통). EC2(Graviton=arm64)에서도 그대로 빌드 가능.
# 빌드 컨텍스트는 저장소 루트: 서버가 packages/shared(게임 엔진)를 함께 사용한다.
#   docker build -f apps/server/Dockerfile -t officeyacht-api .
FROM node:24.22.2-alpine AS build
WORKDIR /repo/apps/server
COPY apps/server/package.json apps/server/package-lock.json ./
RUN npm ci --ignore-scripts
COPY apps/server/ ./
COPY packages/shared/ /repo/packages/shared/
RUN npx prisma generate && npm run build

# 런타임 의존성 + 마이그레이션용 prisma CLI (devDependency 이지만 migrate deploy 에 필요)
FROM node:24.22.2-alpine AS prod-deps
WORKDIR /repo/apps/server
COPY apps/server/package.json apps/server/package-lock.json apps/server/prisma.config.ts ./
COPY apps/server/prisma ./prisma
# prisma 설치 스크립트가 schema-engine 바이너리를 빌드 시점에 받도록 --ignore-scripts 를 쓰지 않는다.
RUN npm ci --omit=dev --ignore-scripts \
 && PRISMA_VERSION="$(node -p "require('./package-lock.json').packages['node_modules/prisma'].version")" \
 && npm install --no-save "prisma@${PRISMA_VERSION}" \
 && node node_modules/prisma/build/index.js --version \
 && rm -rf src && npm cache clean --force

FROM node:24.22.2-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /repo/apps/server
COPY --from=prod-deps /repo/apps/server/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/packages/shared /repo/packages/shared
COPY apps/server/package.json apps/server/prisma.config.ts apps/server/docker-entrypoint.sh ./
COPY apps/server/prisma ./prisma
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health/live >/dev/null || exit 1
ENTRYPOINT ["/bin/sh", "/repo/apps/server/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
