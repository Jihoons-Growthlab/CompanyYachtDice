// 요트 다이스 턴 상태 전이 (ruleset yacht-v1, docs/features/yacht.md). 순수 함수: I/O·시간·난수 없음.
// 난수는 rollDie() 로 주입한다(서버: crypto, 테스트: 결정적 수열). 상태는 JSON 직렬화 가능하며 입력을 변경하지 않는다.
import { categories, scoresFor, total } from './scoring.mjs'

export const RULESET = 'yacht-v1'
export const MAX_ROLLS = 3
export const DICE_COUNT = 5
export const CATEGORY_KEYS = categories.map(([key]) => key)

/** @param {string[]} playerIds 좌석 순서(서버가 섞어서 전달) */
export function createGame(playerIds) {
  if (!Array.isArray(playerIds) || playerIds.length < 1) throw new Error('playerIds required')
  if (new Set(playerIds).size !== playerIds.length) throw new Error('duplicate player')
  return {
    ruleset: RULESET,
    status: 'ACTIVE',
    players: playerIds.map(id => ({ id, card: {} })),
    turn: 0,
    round: 1,
    dice: [],
    held: Array(DICE_COUNT).fill(false),
    rollCount: 0,
    results: null,
  }
}

export const currentPlayerId = state => (state.status === 'ACTIVE' ? state.players[state.turn].id : null)

/** 현재 주사위 기준 미기록 칸의 미리보기 점수 */
export function previews(state) {
  if (!state.dice.length) return {}
  const card = state.players[state.turn].card
  const all = scoresFor(state.dice)
  return Object.fromEntries(CATEGORY_KEYS.filter(k => !(k in card)).map(k => [k, all[k]]))
}

const fail = code => ({ ok: false, code })

/**
 * 명령 적용. command: {type:'ROLL'} | {type:'HOLD', held:boolean[5]} | {type:'SCORE', category}
 * @returns {{ok:true, state:object} | {ok:false, code:string}}
 */
export function applyCommand(state, playerId, command, rollDie) {
  if (state.status !== 'ACTIVE') return fail('MATCH_FINISHED')
  if (currentPlayerId(state) !== playerId) return fail('NOT_YOUR_TURN')
  switch (command?.type) {
    case 'ROLL': {
      if (state.rollCount >= MAX_ROLLS) return fail('ROLL_LIMIT')
      if (state.rollCount > 0 && state.held.every(Boolean)) return fail('ALL_HELD')
      const dice = state.held.map((keep, i) => (keep && state.dice.length ? state.dice[i] : checkDie(rollDie())))
      return { ok: true, state: { ...state, dice, rollCount: state.rollCount + 1 } }
    }
    case 'HOLD': {
      if (state.rollCount === 0) return fail('NO_ROLL_YET')
      if (state.rollCount >= MAX_ROLLS) return fail('ROLL_LIMIT')
      const held = command.held
      if (!Array.isArray(held) || held.length !== DICE_COUNT || held.some(v => typeof v !== 'boolean')) return fail('INVALID_HOLD')
      return { ok: true, state: { ...state, held: [...held] } }
    }
    case 'SCORE': {
      if (state.rollCount === 0) return fail('NO_ROLL_YET')
      const key = command.category
      if (!CATEGORY_KEYS.includes(key)) return fail('INVALID_CATEGORY')
      const player = state.players[state.turn]
      if (key in player.card) return fail('CATEGORY_FILLED')
      const points = scoresFor(state.dice)[key]
      const players = state.players.map((p, i) => (i === state.turn ? { ...p, card: { ...p.card, [key]: points } } : p))
      return { ok: true, state: advance({ ...state, players }) }
    }
    default:
      return fail('INVALID_COMMAND')
  }
}

function checkDie(v) {
  if (!Number.isInteger(v) || v < 1 || v > 6) throw new Error(`rollDie returned ${v}`)
  return v
}

function advance(state) {
  const fresh = { dice: [], held: Array(DICE_COUNT).fill(false), rollCount: 0 }
  const done = state.players.every(p => CATEGORY_KEYS.every(k => k in p.card))
  if (done) return { ...state, ...fresh, status: 'FINISHED', results: rank(state.players) }
  const nextTurn = (state.turn + 1) % state.players.length
  return { ...state, ...fresh, turn: nextTurn, round: nextTurn === 0 ? state.round + 1 : state.round }
}

/** 공동 순위(1,1,3). 동점은 좌석 순서로 정렬만 하고 순위는 같다. */
export function rank(players) {
  const totals = players.map(p => ({ id: p.id, total: total(p.card) }))
  return totals
    .map(t => ({ ...t, rank: 1 + totals.filter(o => o.total > t.total).length }))
    .sort((a, b) => a.rank - b.rank)
}
