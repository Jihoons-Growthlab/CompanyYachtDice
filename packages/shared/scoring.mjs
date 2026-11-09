export const categories = [
  ['ones', '에이스'], ['twos', '듀스'], ['threes', '트리플'],
  ['fours', '포'], ['fives', '파이브'], ['sixes', '식스'],
  ['choice', '초이스'], ['fourKind', '포카드'], ['fullHouse', '풀하우스'],
  ['smallStraight', '작은 스트레이트'], ['largeStraight', '큰 스트레이트'], ['yacht', '요트'],
]

export function scoresFor(dice) {
  const counts = Array.from({ length: 6 }, (_, i) => dice.filter(value => value === i + 1).length)
  const sum = dice.reduce((total, value) => total + value, 0)
  const present = counts.map(count => Number(count > 0)).join('')
  return {
    ...Object.fromEntries(categories.slice(0, 6).map(([key], i) => [key, counts[i] * (i + 1)])),
    choice: sum,
    fourKind: Math.max(...counts) >= 4 ? sum : 0,
    fullHouse: counts.includes(3) && counts.includes(2) ? sum : 0,
    smallStraight: present.includes('1111') ? 15 : 0,
    largeStraight: present.includes('11111') ? 30 : 0,
    yacht: counts.includes(5) ? 50 : 0,
  }
}

export const upper = card => categories.slice(0, 6).reduce((sum, [key]) => sum + (card[key] ?? 0), 0)
export const bonus = card => upper(card) >= 63 ? 35 : 0
export const total = card => categories.reduce((sum, [key]) => sum + (card[key] ?? 0), bonus(card))
