// 점수 항목 설명과 "왜 이 점수인지" 계산 근거. 점수 자체는 shared scoring.mjs(서버와 같은 규칙)로 계산한다.
import { scoresFor } from '../../../packages/shared/scoring.mjs'

export const CATEGORY_INFO = {
  ones: { en: 'Aces', rule: '1이 나온 주사위의 눈 합계', example: '[1,1,3,5,6] → 1×2 = 2점' },
  twos: { en: 'Deuces', rule: '2가 나온 주사위의 눈 합계', example: '[2,2,2,4,5] → 2×3 = 6점' },
  threes: { en: 'Threes', rule: '3이 나온 주사위의 눈 합계', example: '[3,3,1,2,6] → 3×2 = 6점' },
  fours: { en: 'Fours', rule: '4가 나온 주사위의 눈 합계', example: '[4,4,4,4,1] → 4×4 = 16점' },
  fives: { en: 'Fives', rule: '5가 나온 주사위의 눈 합계', example: '[5,5,2,3,1] → 5×2 = 10점' },
  sixes: { en: 'Sixes', rule: '6이 나온 주사위의 눈 합계', example: '[6,6,6,2,1] → 6×3 = 18점' },
  choice: { en: 'Choice', rule: '조건 없이 다섯 눈의 합', example: '[6,5,5,4,3] → 23점' },
  fourKind: { en: '4 of a Kind', rule: '같은 눈이 4개 이상이면 다섯 눈의 합, 아니면 0점', example: '[3,3,3,3,6] → 18점' },
  fullHouse: { en: 'Full House', rule: '같은 눈 3개 + 같은 눈 2개면 다섯 눈의 합, 아니면 0점', example: '[2,2,2,5,5] → 16점' },
  smallStraight: { en: 'Small Straight', rule: '연속된 눈 4개(1-2-3-4, 2-3-4-5, 3-4-5-6)가 있으면 15점', example: '[1,2,3,4,6] → 15점' },
  largeStraight: { en: 'Large Straight', rule: '연속된 눈 5개(1-2-3-4-5 또는 2-3-4-5-6)면 30점', example: '[2,3,4,5,6] → 30점' },
  yacht: { en: 'Yacht', rule: '다섯 주사위가 모두 같은 눈이면 50점', example: '[4,4,4,4,4] → 50점' },
}
const UPPER = { ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 }

/** 현재 주사위로 이 항목에 기록될 점수와 계산 근거 */
export function explain(key, dice) {
  if (!dice?.length) return { points: null, reason: '주사위를 먼저 굴려야 예상 점수를 볼 수 있습니다.' }
  const points = scoresFor(dice)[key]
  const sum = dice.reduce((a, b) => a + b, 0)
  const counts = [0, 1, 2, 3, 4, 5, 6].map(v => dice.filter(d => d === v).length)
  const n = UPPER[key]
  if (n) return { points, reason: counts[n] ? `${n}이(가) ${counts[n]}개 → ${n}×${counts[n]} = ${points}점` : `${n}이(가) 없어서 0점` }
  switch (key) {
    case 'choice': return { points, reason: `다섯 눈의 합 ${dice.join('+')} = ${points}점` }
    case 'fourKind': return { points, reason: points ? `같은 눈 4개 이상 → 다섯 눈의 합 ${sum}점` : '같은 눈이 4개 이상이 아니어서 0점' }
    case 'fullHouse': return { points, reason: points ? `3개 + 2개 조합 → 다섯 눈의 합 ${sum}점` : '같은 눈 3개 + 2개 조합이 아니어서 0점' }
    case 'smallStraight': return { points, reason: points ? '연속된 눈 4개 → 15점' : '연속된 눈 4개가 없어서 0점' }
    case 'largeStraight': return { points, reason: points ? '연속된 눈 5개 → 30점' : '연속된 눈 5개가 아니어서 0점' }
    case 'yacht': return { points, reason: points ? '다섯 눈이 모두 같음 → 50점' : '다섯 눈이 모두 같지 않아서 0점' }
    default: return { points, reason: '' }
  }
}

export const formatClock = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
export const formatLimit = sec => (sec % 60 === 0 ? `${sec / 60}분` : `${sec}초`)

// "다시 보지 않기" 로컬 설정(브라우저별). 저장소가 막혀 있어도 동작해야 한다.
const GUIDE_KEY = 'oy.guide.skip'
export const guideSkipped = () => { try { return localStorage.getItem(GUIDE_KEY) === '1' } catch { return false } }
export const setGuideSkipped = v => { try { v ? localStorage.setItem(GUIDE_KEY, '1') : localStorage.removeItem(GUIDE_KEY) } catch { /* 무시 */ } }
