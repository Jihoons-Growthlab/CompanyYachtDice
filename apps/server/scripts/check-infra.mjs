#!/usr/bin/env node
// 인프라 연결 점검. 실제 개발 데이터를 지우지 않도록 전용 마커 레코드·전용 키만 사용한다(FLUSHALL 금지).
// 사용: npm run check:infra [-- <cmd>]
//   all (기본)  health + redis + pg:write + pg:read
//   health      GET /health/live, /health/ready
//   redis       SET/GET/TTL 만료/DEL
//   pg:write    마커 사용자 1건 생성(이미 있으면 유지)
//   pg:read     마커 사용자 존재 확인(재시작 후 영속성 검증)
//   pg:clean    마커 사용자 삭제
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { Redis } from 'ioredis';

if (existsSync('.env')) process.loadEnvFile('.env');
const { DATABASE_URL, REDIS_URL, REDIS_KEY_PREFIX = 'oy:', HOST = '127.0.0.1', PORT = '3000' } = process.env;
const API = process.env.API_BASE_URL ?? `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;
const MARKER = '__infra_check__';
const MARKER_ID = '00000000-0000-7000-8000-00000000c0de';

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

async function health() {
  for (const path of ['/health/live', '/health/ready']) {
    try {
      const res = await fetch(API + path, { signal: AbortSignal.timeout(5000) });
      const body = await res.json();
      record(`GET ${path}`, res.status === 200, `${res.status} ${JSON.stringify(body)}`);
    } catch (err) {
      record(`GET ${path}`, false, `${err.cause?.code ?? err.name}`);
    }
  }
}

async function redis() {
  const r = new Redis(REDIS_URL, { keyPrefix: REDIS_KEY_PREFIX, connectTimeout: 3000, maxRetriesPerRequest: 1 });
  const key = `infra-check:${process.pid}:${Date.now()}`;
  try {
    record('redis SET PX', (await r.set(key, 'v1', 'PX', 1500)) === 'OK');
    record('redis GET', (await r.get(key)) === 'v1');
    const pttl = await r.pttl(key);
    record('redis PTTL > 0', pttl > 0 && pttl <= 1500, `${pttl}ms`);
    await sleep(1800);
    record('redis 만료 후 GET = null', (await r.get(key)) === null);
    await r.set(key, 'v2', 'EX', 60);
    record('redis DEL', (await r.del(key)) === 1 && (await r.exists(key)) === 0);
  } catch (err) {
    record('redis', false, err.code ?? err.message);
  } finally {
    r.disconnect();
  }
}

async function withPg(fn) {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await fn(client);
  } catch (err) {
    record('postgres', false, err.code ?? err.message);
  } finally {
    await client.end().catch(() => {});
  }
}

const pgWrite = () =>
  withPg(async (c) => {
    const res = await c.query(
      `INSERT INTO users (id, nickname, department_label, updated_at)
       VALUES ($1, $2, $2, now()) ON CONFLICT (id) DO NOTHING`,
      [MARKER_ID, MARKER],
    );
    record('pg 마커 사용자 쓰기', true, res.rowCount === 1 ? '새로 생성' : '이미 존재');
  });

const pgRead = () =>
  withPg(async (c) => {
    const res = await c.query(`SELECT created_at FROM users WHERE id = $1 AND nickname = $2`, [MARKER_ID, MARKER]);
    record('pg 마커 사용자 존재(영속성)', res.rowCount === 1, res.rows[0]?.created_at?.toISOString() ?? '없음');
  });

const pgClean = () =>
  withPg(async (c) => {
    const res = await c.query(`DELETE FROM users WHERE id = $1 AND nickname = $2`, [MARKER_ID, MARKER]);
    record('pg 마커 사용자 삭제', true, `${res.rowCount}건`);
  });

const cmds = { health, redis, 'pg:write': pgWrite, 'pg:read': pgRead, 'pg:clean': pgClean };
const cmd = process.argv[2] ?? 'all';
if (cmd === 'all') {
  for (const f of [health, redis, pgWrite, pgRead]) await f();
} else if (cmds[cmd]) {
  await cmds[cmd]();
} else {
  console.error(`unknown command: ${cmd} (all|${Object.keys(cmds).join('|')})`);
  process.exit(2);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
