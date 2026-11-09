import type { Card, CategoryKey } from './scoring.mjs'
export declare const RULESET: 'yacht-v1'
export declare const MAX_ROLLS: 3
export declare const DICE_COUNT: 5
export declare const CATEGORY_KEYS: CategoryKey[]
export type PlayerState = { id: string; card: Card }
export type Result = { id: string; total: number; rank: number }
export type GameState = {
  ruleset: 'yacht-v1'
  status: 'ACTIVE' | 'FINISHED'
  players: PlayerState[]
  turn: number
  round: number
  dice: number[]
  held: boolean[]
  rollCount: number
  results: Result[] | null
}
export type Command = { type: 'ROLL' } | { type: 'HOLD'; held: boolean[] } | { type: 'SCORE'; category: CategoryKey }
export type ErrorCode = 'MATCH_FINISHED' | 'NOT_YOUR_TURN' | 'ROLL_LIMIT' | 'ALL_HELD' | 'NO_ROLL_YET' | 'INVALID_HOLD' | 'INVALID_CATEGORY' | 'CATEGORY_FILLED' | 'INVALID_COMMAND'
export type ApplyResult = { ok: true; state: GameState } | { ok: false; code: ErrorCode }
export declare function createGame(playerIds: string[]): GameState
export declare function currentPlayerId(state: GameState): string | null
export declare function previews(state: GameState): Partial<Record<CategoryKey, number>>
export declare function applyCommand(state: GameState, playerId: string, command: Command, rollDie: () => number): ApplyResult
export declare function rank(players: PlayerState[]): Result[]
