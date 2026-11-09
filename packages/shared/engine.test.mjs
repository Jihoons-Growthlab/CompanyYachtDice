import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createGame, currentPlayerId, rank, CATEGORY_KEYS } from './engine.mjs'
import { bestCategory, chooseHold, nextAutoCommand } from './autoplay.mjs'
import { total } from './scoring.mjs'

const seq = values => { let i = 0; return () => values[i++ % values.length] }
const ok = r => { assert.equal(r.ok, true, r.code); return r.state }

test('굴림·보관·최대 3회·기록·턴 이동', () => {
  let s = createGame(['a', 'b'])
  assert.equal(applyCommand(s, 'b', { type: 'ROLL' }, seq([1])).code, 'NOT_YOUR_TURN')
  assert.equal(applyCommand(s, 'a', { type: 'SCORE', category: 'ones' }, seq([1])).code, 'NO_ROLL_YET')
  assert.equal(applyCommand(s, 'a', { type: 'HOLD', held: [true, false, false, false, false] }, seq([1])).code, 'NO_ROLL_YET')
  s = ok(applyCommand(s, 'a', { type: 'ROLL' }, seq([2, 2, 2, 3, 3])))
  assert.deepEqual(s.dice, [2, 2, 2, 3, 3])
  s = ok(applyCommand(s, 'a', { type: 'HOLD', held: [true, true, true, false, false] }, seq([1])))
  s = ok(applyCommand(s, 'a', { type: 'ROLL' }, seq([6, 6])))
  assert.deepEqual(s.dice, [2, 2, 2, 6, 6], '보관한 눈 유지')
  s = ok(applyCommand(s, 'a', { type: 'ROLL' }, seq([5, 4])))
  assert.equal(s.rollCount, 3)
  assert.equal(applyCommand(s, 'a', { type: 'ROLL' }, seq([1])).code, 'ROLL_LIMIT')
  assert.equal(applyCommand(s, 'a', { type: 'HOLD', held: [true, true, true, true, true] }, seq([1])).code, 'ROLL_LIMIT')
  assert.equal(applyCommand(s, 'a', { type: 'SCORE', category: 'nope' }, seq([1])).code, 'INVALID_CATEGORY')
  s = ok(applyCommand(s, 'a', { type: 'SCORE', category: 'twos' }, seq([1])))
  assert.equal(s.players[0].card.twos, 6)
  assert.equal(currentPlayerId(s), 'b')
  assert.deepEqual([s.dice, s.rollCount, s.held.some(Boolean)], [[], 0, false], '새 턴 초기화')
})

test('전부 보관 시 재굴림 불가, 같은 칸 중복 기록 불가', () => {
  let s = ok(applyCommand(createGame(['a']), 'a', { type: 'ROLL' }, seq([1, 1, 1, 1, 1])))
  s = ok(applyCommand(s, 'a', { type: 'HOLD', held: Array(5).fill(true) }, seq([1])))
  assert.equal(applyCommand(s, 'a', { type: 'ROLL' }, seq([1])).code, 'ALL_HELD')
  s = ok(applyCommand(s, 'a', { type: 'SCORE', category: 'yacht' }, seq([1])))
  s = ok(applyCommand(s, 'a', { type: 'ROLL' }, seq([1, 1, 1, 1, 1])))
  assert.equal(applyCommand(s, 'a', { type: 'SCORE', category: 'yacht' }, seq([1])).code, 'CATEGORY_FILLED')
  assert.equal(applyCommand(s, 'a', { type: 'HOLD', held: [1, 0, 0, 0, 0] }, seq([1])).code, 'INVALID_HOLD')
})

test('입력 상태를 변경하지 않는다', () => {
  const s = createGame(['a'])
  const snap = JSON.stringify(s)
  applyCommand(s, 'a', { type: 'ROLL' }, seq([3]))
  assert.equal(JSON.stringify(s), snap)
})

test('공동 순위 1,1,3', () => {
  const r = rank([{ id: 'a', card: { choice: 20 } }, { id: 'b', card: { choice: 20 } }, { id: 'c', card: { choice: 10 } }])
  assert.deepEqual(r.map(x => [x.id, x.rank]), [['a', 1], ['b', 1], ['c', 3]])
})

test('2~6인 오토 플레이로 12라운드 완주, 결과 총점이 점수표와 일치', () => {
  for (const n of [1, 2, 6]) {
    const ids = Array.from({ length: n }, (_, i) => 'p' + i)
    let s = createGame(ids)
    let x = 7
    const rng = () => (x = (x * 1103515245 + 12345) % 2147483648) % 6 + 1
    let steps = 0
    while (s.status === 'ACTIVE') {
      s = ok(applyCommand(s, currentPlayerId(s), nextAutoCommand(s), rng))
      assert.ok(++steps < 10_000)
    }
    assert.equal(s.round, 12)
    assert.equal(s.results.length, n)
    for (const p of s.players) {
      assert.equal(Object.keys(p.card).length, CATEGORY_KEYS.length)
      assert.equal(s.results.find(r => r.id === p.id).total, total(p.card))
    }
  }
})

test('오토 전략: 요트 즉시 기록, 스트레이트 보관, 많은 눈 보관', () => {
  assert.equal(bestCategory({}, [5, 5, 5, 5, 5]), 'yacht')
  assert.deepEqual(chooseHold({}, [1, 2, 3, 6, 6]), [true, true, true, false, false])
  assert.deepEqual(chooseHold({ smallStraight: 15, largeStraight: 30 }, [4, 4, 4, 1, 2]), [true, true, true, false, false])
  assert.equal(bestCategory({ yacht: 50 }, [1, 1, 1, 1, 1]), 'ones')
})
