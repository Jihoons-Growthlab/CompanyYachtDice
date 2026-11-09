// 개인 환경 설정(본인 화면에만 적용). 방장이 정하는 턴 제한시간·서버 봇 진행 속도와 무관하다.
//
// 저장 위치·우선순위
//  - 로그인: 서버(GET/PATCH /api/v1/me/preferences)가 원본. 변경 즉시 반영 후 300ms 모아서 저장.
//  - 비로그인: localStorage 'oy.prefs.guest'.
//  - 로그인 시: 서버에 저장된 설정이 있으면 서버 우선. 없으면(첫 로그인) 이 브라우저의 게스트 설정을 계정으로 올린다.
//  - 'oy.prefs.applied' 는 첫 화면 깜빡임 방지용으로 마지막 적용값만 캐시한다(index.html 인라인 스크립트가 사용).
import { reactive, ref } from 'vue'
import { api } from './api.js'

export const DEFAULTS = Object.freeze({
  uiMode: 'EXCEL',
  uiScale: 'NORMAL',
  effectSpeed: 'NORMAL',
  reducedMotion: false,
  diceAnimation: true,
  turnNotification: true,
  soundEnabled: false,
  soundVolume: 60,
  ribbonCollapsed: false,
})
const KEYS = Object.keys(DEFAULTS)
const GUEST_KEY = 'oy.prefs.guest'
const APPLIED_KEY = 'oy.prefs.applied'
const DICE_MS = { FAST: 450, NORMAL: 800, SLOW: 1200 }
const TOAST_MS = { FAST: 2000, NORMAL: 3200, SLOW: 4800 }

export const prefs = reactive({ ...DEFAULTS })
/** 'local'(비로그인) | 'saving' | 'saved' | 'error' */
export const saveState = ref('local')
export const saveError = ref('')
let owner = null
let pending = {}
let timer

const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null } }
const write = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* 저장소 차단 시 무시 */ } }
const pick = src => Object.fromEntries(KEYS.filter(k => src && k in src).map(k => [k, src[k]]))

export function applyToDom() {
  const d = document.documentElement
  d.dataset.uiMode = prefs.uiMode === 'CMD' ? 'cmd' : 'excel'
  d.dataset.uiScale = prefs.uiScale.toLowerCase()
  d.dataset.reducedMotion = prefs.reducedMotion ? 'on' : 'off'
  d.style.setProperty('--fx-dice-ms', `${DICE_MS[prefs.effectSpeed]}ms`)
  write(APPLIED_KEY, { uiMode: prefs.uiMode, uiScale: prefs.uiScale, reducedMotion: prefs.reducedMotion })
}

/** 주사위 연출 시간(ms). 0 이면 연출 없음 */
export const diceMs = () => (prefs.reducedMotion || !prefs.diceAnimation ? 0 : DICE_MS[prefs.effectSpeed])
export const toastMs = () => TOAST_MS[prefs.effectSpeed]

/**
 * 비로그인(또는 로그아웃) 상태: 이 브라우저의 게스트 설정.
 * apply=false: 앱 시작 시 세션 확인 전에는 화면에 적용하지 않는다(index.html 이 붙인 마지막 테마 유지 → 깜빡임 방지).
 */
export function useGuest(apply = true) {
  owner = null
  clearTimeout(timer)
  pending = {}
  Object.assign(prefs, DEFAULTS, pick(read(GUEST_KEY)))
  saveState.value = 'local'
  saveError.value = ''
  if (apply) applyToDom()
}

/** 로그인 직후: 서버 설정 로드(없으면 게스트 설정을 계정으로 올림) */
export async function useAccount(userId) {
  owner = userId
  pending = {}
  try {
    const server = await api('GET', '/me/preferences')
    if (owner !== userId) return
    const guest = pick(read(GUEST_KEY))
    if (server.saved || !Object.keys(guest).length) {
      Object.assign(prefs, DEFAULTS, pick(server))
      saveState.value = 'saved'
    } else {
      Object.assign(prefs, DEFAULTS, pick(server), guest)
      await flush(guest)
    }
  } catch (err) {
    saveState.value = 'error'
    saveError.value = `설정을 불러오지 못했습니다: ${err.message}`
  }
  applyToDom()
}

/** 설정 변경: 즉시 화면 반영 → (로그인) 서버 저장 / (비로그인) 로컬 저장 */
export function update(patch) {
  Object.assign(prefs, pick(patch))
  applyToDom()
  if (!owner) {
    write(GUEST_KEY, pick(prefs))
    saveState.value = 'local'
    return
  }
  Object.assign(pending, pick(patch))
  saveState.value = 'saving'
  clearTimeout(timer)
  timer = setTimeout(() => flush(), 300)
}

async function flush(body = pending) {
  if (!owner || !Object.keys(body).length) return
  const sending = { ...body }
  if (body === pending) pending = {}
  saveState.value = 'saving'
  saveError.value = ''
  try {
    await api('PATCH', '/me/preferences', sending)
    if (!Object.keys(pending).length) saveState.value = 'saved'
  } catch (err) {
    pending = { ...sending, ...pending } // 실패분 보존 → 다시 시도
    saveState.value = 'error'
    saveError.value = err.message
  }
}

export const retrySave = () => flush()
