export type CategoryKey = 'ones' | 'twos' | 'threes' | 'fours' | 'fives' | 'sixes' | 'choice' | 'fourKind' | 'fullHouse' | 'smallStraight' | 'largeStraight' | 'yacht'
export type Card = Partial<Record<CategoryKey, number>>
export declare const categories: [CategoryKey, string][]
export declare function scoresFor(dice: number[]): Record<CategoryKey, number>
export declare const upper: (card: Card) => number
export declare const bonus: (card: Card) => number
export declare const total: (card: Card) => number
