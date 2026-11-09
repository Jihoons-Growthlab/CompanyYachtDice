import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bonus, scoresFor, total, upper } from './scoring.mjs'

test('풀하우스와 요트는 서로 다른 조합이다', () => {
  assert.equal(scoresFor([2, 2, 2, 3, 3]).fullHouse, 12)
  const yacht = scoresFor([6, 6, 6, 6, 6])
  assert.equal(yacht.sixes, 30)
  assert.equal(yacht.choice, 30)
  assert.equal(yacht.fullHouse, 0)
  assert.equal(yacht.fourKind, 30)
  assert.equal(yacht.yacht, 50)
})

test('스트레이트는 중복을 제거한 연속 눈을 기준으로 계산한다', () => {
  const small = scoresFor([1, 2, 2, 3, 4])
  assert.equal(small.smallStraight, 15)
  assert.equal(small.largeStraight, 0)
  for (const dice of [[1, 2, 3, 4, 5], [6, 4, 2, 5, 3]]) {
    assert.equal(scoresFor(dice).smallStraight, 15)
    assert.equal(scoresFor(dice).largeStraight, 30)
  }
  assert.equal(scoresFor([1, 2, 3, 5, 6]).smallStraight, 0)
})

test('상단 소계 63점부터 35점 보너스를 포함한다', () => {
  const card = { ones: 2, fours: 20, fives: 10, sixes: 30, yacht: 0, choice: null }
  assert.equal(upper(card), 62)
  assert.equal(bonus(card), 0)
  assert.equal(total(card), 62)

  const withBonus = { ...card, ones: 3, choice: 20 }
  assert.equal(upper(withBonus), 63)
  assert.equal(bonus(withBonus), 35)
  assert.equal(total(withBonus), 118)
  assert.equal(total({}), 0)
})
