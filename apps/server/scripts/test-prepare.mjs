#!/usr/bin/env node
// 테스트 전용 DB(<개발DB>_test)를 없으면 만들고 마이그레이션을 적용한다. 개발 DB 는 건드리지 않는다.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import pg from 'pg';

if (existsSync('.env')) process.loadEnvFile('.env');
if (process.env.NODE_ENV === 'production') throw new Error('production 에서 실행 금지');
const url = new URL(process.env.DATABASE_URL);
const devDb = url.pathname.slice(1);
const testDb = devDb.endsWith('_test') ? devDb : `${devDb}_test`;
if (!/^[a-z0-9_]+_test$/.test(testDb)) throw new Error(`unsafe test db name: ${testDb}`);

const admin = new URL(url); admin.pathname = '/postgres'; admin.search = '';
const c = new pg.Client({ connectionString: admin.toString(), connectionTimeoutMillis: 3000 });
await c.connect();
const exists = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [testDb]);
if (!exists.rowCount) await c.query(`CREATE DATABASE "${testDb}"`);
await c.end();

const testUrl = new URL(url); testUrl.pathname = `/${testDb}`;
execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
  stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, DATABASE_URL: testUrl.toString(), PRISMA_HIDE_UPDATE_MESSAGE: '1' },
});
console.log(`test db ready: ${testDb}${exists.rowCount ? '' : ' (created)'}`);
