// 공유 엔진(packages/shared, 웹과 동일 코드)을 서버에서 사용한다. 타입은 *.d.mts.
import { randomInt } from 'node:crypto';
export * from '../../../../packages/shared/engine.mjs';
export { bestCategory, nextAutoCommand } from '../../../../packages/shared/autoplay.mjs';
export { upper, bonus, total } from '../../../../packages/shared/scoring.mjs';

/** 서버 난수: CSPRNG */
export const rollDie = () => randomInt(1, 7);
