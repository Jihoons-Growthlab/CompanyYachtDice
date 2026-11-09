import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AuthPolicy } from './auth.policy.js';

const argon2Async = promisify(argon2);
type Params = { memoryKiB: number; passes: number; parallelism: number; tagLength: number };
const CURRENT: Params = AuthPolicy.argon2;

async function derive(password: string, salt: Buffer, p: Params): Promise<Buffer> {
  return argon2Async('argon2id', {
    message: password.normalize('NFC'),
    nonce: salt,
    memory: p.memoryKiB,
    passes: p.passes,
    parallelism: p.parallelism,
    tagLength: p.tagLength,
  });
}

/** PHC 형식: $argon2id$v=19$m=19456,t=2,p=1$<salt b64>$<hash b64> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(AuthPolicy.argon2.saltLength);
  const hash = await derive(password, salt, CURRENT);
  return `$argon2id$v=19$m=${CURRENT.memoryKiB},t=${CURRENT.passes},p=${CURRENT.parallelism}$${b64(salt)}$${b64(hash)}`;
}

function parse(phc: string): { params: Params; salt: Buffer; hash: Buffer } | null {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(phc);
  if (!m) return null;
  const hash = Buffer.from(m[5]!, 'base64');
  return {
    params: { memoryKiB: +m[1]!, passes: +m[2]!, parallelism: +m[3]!, tagLength: hash.length },
    salt: Buffer.from(m[4]!, 'base64'),
    hash,
  };
}

export async function verifyPassword(password: string, phc: string): Promise<boolean> {
  const parsed = parse(phc);
  if (!parsed) return false;
  const candidate = await derive(password, parsed.salt, parsed.params);
  return candidate.length === parsed.hash.length && timingSafeEqual(candidate, parsed.hash);
}

/** 저장된 해시가 현재 정책 파라미터보다 약하거나 다르면 true → 로그인 성공 시 재해시 */
export function needsRehash(phc: string): boolean {
  const parsed = parse(phc);
  if (!parsed) return true;
  const p = parsed.params;
  return p.memoryKiB !== CURRENT.memoryKiB || p.passes !== CURRENT.passes || p.parallelism !== CURRENT.parallelism || p.tagLength !== CURRENT.tagLength;
}

/** 존재하지 않는 계정에도 같은 비용의 검증을 수행해 응답 시간으로 계정 존재를 추측하지 못하게 한다. */
let dummyHash: Promise<string> | undefined;
export async function burnVerify(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, await dummyHash);
}

const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
