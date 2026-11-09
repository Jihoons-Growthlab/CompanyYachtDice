import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 은 .env 를 자동 로드하지 않는다. 이미 설정된 환경변수(EC2·CI)를 덮어쓰지 않는다.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // generate 는 DB 접속이 필요 없으므로 URL 이 없어도(도커 빌드 등) 실패하지 않게 둔다.
  ...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {}),
});
