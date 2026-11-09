import type { Card, CategoryKey } from './scoring.mjs'
import type { Command, GameState } from './engine.mjs'
export declare function bestCategory(card: Card, dice: number[]): CategoryKey | null
export declare function chooseHold(card: Card, dice: number[]): boolean[]
export declare function nextAutoCommand(state: GameState): Command
export declare function timeoutCommands(state: GameState): ({ type: 'ROLL' } | { type: 'SCORE_BEST' })[]
