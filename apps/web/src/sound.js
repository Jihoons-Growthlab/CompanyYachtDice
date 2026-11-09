// 효과음(외부 파일·라이브러리 없음, Web Audio 합성). 설정이 켜져 있을 때만 재생한다.
import { prefs } from './prefs.js'

const TONES = {
  turn: [[660, 0, 0.12], [880, 0.13, 0.18]],
  roll: [[220, 0, 0.05], [262, 0.06, 0.05], [311, 0.12, 0.06]],
  confirm: [[523, 0, 0.1], [784, 0.1, 0.16]],
  chat: [[740, 0, 0.07]],
}
let ctx

export function playSound(kind, { force = false } = {}) {
  if (!force && !prefs.soundEnabled) return
  if (import.meta.env.DEV) (window.__oySoundLog ??= []).push(kind) // E2E 확인용(개발 빌드 전용)
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    const gain = ctx.createGain()
    gain.gain.value = (prefs.soundVolume / 100) * 0.25
    gain.connect(ctx.destination)
    for (const [freq, at, dur] of TONES[kind] ?? []) {
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = freq
      osc.connect(gain)
      osc.start(ctx.currentTime + at)
      osc.stop(ctx.currentTime + at + dur)
    }
  } catch {
    /* 오디오 미지원·차단 시 무음 */
  }
}
