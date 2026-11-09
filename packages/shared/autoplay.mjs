// 자동 플레이 전략(순수). 수동·오토·봇·시간 초과가 같은 engine.applyCommand 를 거치므로 규칙을 공유한다.
import { scoresFor } from './scoring.mjs'
import { CATEGORY_KEYS, MAX_ROLLS, previews } from './engine.mjs'

// 0점으로 버려야 할 때 덜 아까운 순서
const SACRIFICE_ORDER = ['ones', 'yacht', 'twos', 'largeStraight', 'fourKind', 'threes', 'smallStraight', 'fullHouse', 'fours', 'fives', 'sixes', 'choice']
const UPPER = { ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 }

/** 미기록 칸 중 점수 최대(동률은 표 순서). 전부 0이면 SACRIFICE_ORDER. 상단 칸은 보너스 기여(3개 이상)를 가산. */
export function bestCategory(card, dice) {
  const all = scoresFor(dice)
  const open = CATEGORY_KEYS.filter(k => !(k in card))
  if (!open.length) return null
  const value = k => all[k] + (UPPER[k] && all[k] >= UPPER[k] * 3 ? 5 : 0) - (k === 'choice' ? 8 : 0)
  const scored = open.filter(k => all[k] > 0)
  if (!scored.length) return SACRIFICE_ORDER.find(k => open.includes(k))
  return scored.reduce((best, k) => (value(k) > value(best) ? k : best), scored[0])
}

/** 다음 보관 목표(boolean[5]) */
export function chooseHold(card, dice) {
  const counts = [0, 0, 0, 0, 0, 0, 0]
  dice.forEach(v => counts[v]++)
  const open = k => !(k in card)
  // 스트레이트: 서로 다른 연속 눈 3개 이상이면 그 눈을 하나씩 보관
  if (open('smallStraight') || open('largeStraight')) {
    let best = []
    for (let start = 1; start <= 4; start++) {
      const run = []
      for (let v = start; v <= 6 && counts[v] > 0; v++) run.push(v)
      if (run.length > best.length) best = run
    }
    if (best.length >= 3 && best.length >= Math.max(...counts)) {
      const used = new Set()
      return dice.map(v => (best.includes(v) && !used.has(v) ? (used.add(v), true) : false))
    }
  }
  // 같은 눈 모으기: 가장 많은(동률이면 큰) 눈
  let face = 0
  for (let v = 6; v >= 1; v--) if (counts[v] > counts[face]) face = v
  if (counts[face] >= 2) return dice.map(v => v === face)
  // 전부 다르면 큰 눈 하나만
  const max = Math.max(...dice)
  let kept = false
  return dice.map(v => (v === max && !kept ? (kept = true) : false))
}

/** 현재 플레이어의 다음 한 걸음 명령. 상태가 ACTIVE 이고 현재 차례라고 가정한다. */
export function nextAutoCommand(state) {
  const card = state.players[state.turn].card
  if (state.rollCount === 0) return { type: 'ROLL' }
  const best = bestCategory(card, state.dice)
  const pv = previews(state)
  const strong = pv.yacht === 50 || pv.largeStraight === 30 || (pv.fullHouse > 0 && !('fullHouse' in card) && best === 'fullHouse')
  if (state.rollCount >= MAX_ROLLS || strong) return { type: 'SCORE', category: best }
  const target = chooseHold(card, state.dice)
  if (target.every(Boolean)) return { type: 'SCORE', category: best }
  if (target.some((h, i) => h !== state.held[i])) return { type: 'HOLD', held: target }
  return { type: 'ROLL' }
}

/** 수동 모드 시간 초과 기본 처리(yacht.md 초안): 굴림이 없었다면 1회 굴리고 최고점 칸 확정 */
export function timeoutCommands(state) {
  return state.rollCount === 0 ? [{ type: 'ROLL' }, { type: 'SCORE_BEST' }] : [{ type: 'SCORE_BEST' }]
}
