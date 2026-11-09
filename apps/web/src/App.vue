<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import EvaluationRoom from './components/EvaluationRoom.vue'
import CompanyDirectory from './components/CompanyDirectory.vue'
import RoomChat from './components/RoomChat.vue'
import GameGuide from './components/GameGuide.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import { applyToDom, diceMs, prefs, toastMs, useAccount, useGuest } from './prefs.js'
import { playSound } from './sound.js'
import { CATEGORY_INFO, explain, formatClock, formatLimit, guideSkipped } from './rules.js'

const TURN_OPTIONS = [60, 120, 180, 240, 300] // 서버 RoomPolicy 와 같은 값(검증은 서버)
import { categories, upper, bonus, total } from '../../../packages/shared/scoring.mjs'
import { api, connectRealtime, devStatus, emit as wsEmit, login, logout as apiLogout, newCommandId, refresh, wsConnected } from './api.js'

// 개발 빌드에서만 로드(운영 빌드에서는 import.meta.env.DEV=false 로 코드 자체가 제거됨)
const DevPanel = import.meta.env.DEV ? defineAsyncComponent(() => import('./components/DevPanel.vue')) : null
const dev = ref(null)
const settingsOpen = ref(false) // 환경 설정 패널(게임 상태와 무관)

// ───────── 인증·인사 등록 (서버) ─────────
const me = ref(null)
const booting = ref(true)
const userName = computed(() => me.value?.nickname ?? '')
const team = computed(() => me.value?.departmentLabel ?? '')
const employeeName = ref('')
const departmentChoice = ref('기획')
const customDepartment = ref('')
const departments = ['기획', '인사', '총무', '재무·회계', '영업', '마케팅', '개발', '디자인', '고객지원', '생산·품질', '직접 입력']
const authMessage = ref('')
const authBusy = ref(false)
const providers = ref([
  { id: 'kakao', name: '카카오', enabled: false },
  { id: 'google', name: 'Google', enabled: false },
  { id: 'naver', name: '네이버', enabled: false },
])
const emailMode = ref('login')
const email = ref('')
const password = ref('')
const AUTH_ERRORS = {
  CANCELLED: '인증을 취소했습니다.',
  STATE_INVALID: '인증 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요.',
  PROVIDER_ERROR: '인증 제공자와 통신하지 못했습니다. 다시 시도해 주세요.',
  NOT_CONFIGURED: '이 로그인 수단은 아직 서버에 설정되지 않았습니다.',
  RATE_LIMITED: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  SERVICE_UNAVAILABLE: '일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.',
}

function beginAuth(provider) {
  if (!provider.enabled) {
    authMessage.value = `${provider.name} 로그인은 서버 설정(Client ID)이 필요합니다. docs/social-login-setup.md 참고`
    return
  }
  window.location.href = `/api/v1/auth/${provider.id}/start`
}
async function submitEmail() {
  if (authBusy.value) return
  authBusy.value = true
  authMessage.value = ''
  try {
    await afterLogin(await login(emailMode.value, { email: email.value.trim(), password: password.value }))
    password.value = ''
  } catch (err) {
    authMessage.value = err.details?.[0]?.message ?? err.message
  } finally {
    authBusy.value = false
  }
}
async function saveProfile() {
  const department = departmentChoice.value === '직접 입력' ? customDepartment.value.trim() : departmentChoice.value
  if (!employeeName.value.trim() || !department) return
  try {
    me.value = await api('PUT', '/me/profile', { nickname: employeeName.value.trim(), departmentLabel: department })
    sheet.value = '로비'
    await restoreSession()
  } catch (err) {
    authMessage.value = err.message
  }
}
async function afterLogin(user) {
  me.value = user
  await useAccount(user.id) // 계정 설정 로드(없으면 이 브라우저 설정을 계정으로)
  authMessage.value = ''
  connection.value = 'connecting'
  connectRealtime(
    {
      status: s => {
        connection.value = s
        if (s === 'auth-required') { me.value = null; authMessage.value = '로그인이 만료되었습니다. 다시 접속해 주세요.' }
      },
      room: applyRoom,
      match: applyMatch,
      messages: (roomId, list) => roomId === roomState.value?.id && mergeMessages(list, true),
      chat: m => {
        if (m.roomId !== roomState.value?.id) return
        mergeMessages([m])
        if (m.kind === 'TEXT' && m.userId !== me.value?.id) playSound('chat')
      },
      lobby: () => (sheet.value === '로비' ? scheduleLobbyReload() : (lobbyStale = true)),
      invite: onInvite,
    },
    () => (roomState.value ? [roomState.value.id] : []),
  )
  if (import.meta.env.DEV) dev.value = await devStatus()
  if (user.profileCompleted) await restoreSession()
}
/** 새로고침·재로그인 시: 참여 중인 방(게임 포함)과 받은 초대 복원 */
async function restoreSession() {
  await loadRooms()
  try {
    invites.value = (await api('GET', '/me/room-invites')).items
    const current = await api('GET', '/rooms/current')
    if (current) enterRoom(current)
  } catch {
    /* 복원 실패 시 로비에서 계속 */
  }
}
async function logout() {
  await apiLogout().catch(() => {})
  me.value = null
  useGuest() // 계정 설정 대신 이 브라우저의 게스트 설정
  roomState.value = null
  match.value = null
  chatMessages.value = []
  invites.value = []
  sheet.value = '로비'
  showFunctions.value = false
  formulaInput.value = ''
  formulaMessage.value = ''
  purchase.value = null
  authMessage.value = '업무 접속을 종료했습니다.'
}

// ───────── 워크북 UI (기존) ─────────
const sheetHelp = { 로비: '게임방을 만들거나 참가합니다.', 게임: '요트 다이스 게임과 점수표를 확인합니다.', 조직: '회사 클랜 검색, 가입과 초대를 관리합니다.', 상점: '가상 포인트로 장식을 구매합니다.', '내 사무실': '구매한 장식을 배치합니다.' }
const sheets = ['로비', '게임', '조직', '상점', '내 사무실']
const sheet = ref('로비')
const sheetNames = { 로비: '평가운영대장', 게임: '개인성과평가', 조직: '인사기록부', 상점: '복리후생정산', '내 사무실': '지급자산대장' }
const formulaInput = ref('')
const formulaMessage = ref('')
const showFunctions = ref(false)
const workbookFunctions = [
  { formula: '=LOBBY()', description: '게임 로비로 이동합니다. 방을 만들거나 진행 중인 게임에 참여할 수 있습니다.' },
  { formula: '=GAME()', description: '요트 다이스 게임 화면으로 이동합니다. 로비에서 먼저 게임방에 입장해 주세요.' },
  { formula: '=ROLL()', description: '보관한 주사위를 유지하고 나머지를 굴립니다. 한 턴에 최대 3회 굴릴 수 있습니다.' },
]
const menu = ref('홈')
const purchase = ref(null)
function runFormula() {
  const value = formulaInput.value.trim().toUpperCase()
  if (value === '=LOBBY()') sheet.value = '로비'
  else if (value === '=GAME()') sheet.value = '게임'
  else if (value === '=ROLL()') {
    if (!canRoll.value) {
      formulaMessage.value = '현재 상태에서는 표본을 산출할 수 없습니다.'
      return
    }
    sheet.value = '게임'
    roll()
  } else {
    formulaMessage.value = '지원 함수: =LOBBY(), =GAME(), =ROLL()'
    return
  }
  formulaMessage.value = value + ' 실행 완료'
}
function pay() {
  if (!purchase.value) return
  buy(purchase.value)
  purchase.value = null
}

// ───────── 방 (서버) ─────────
const rooms = ref([])
const roomState = ref(null)
const roomName = ref('')
const roomError = ref('')
const newRoom = ref({ capacity: 4, visibility: 'PUBLIC', turnTimeLimitSec: 180, botsAllowed: true })
const codeFor = ref(null)
const joinCode = ref('')
let lobbyStale = false
let lobbyTimer
function scheduleLobbyReload() {
  clearTimeout(lobbyTimer)
  lobbyTimer = setTimeout(loadRooms, 250)
}
watch(() => sheet.value, s => {
  if (s === '로비' && lobbyStale) {
    lobbyStale = false
    loadRooms()
  }
})
const connection = ref('idle')
const room = computed(() => roomState.value?.name ?? '')
const myRank = computed(() => roomState.value?.members.find(m => m.userId === me.value?.id)?.rankLabel ?? '사원')

async function loadRooms() {
  try {
    rooms.value = (await api('GET', '/rooms')).items
  } catch (err) {
    roomError.value = err.message
  }
}
async function subscribe(roomId) {
  const ack = await wsEmit('room:subscribe', { roomId })
  if (ack.ok) {
    applyRoom(ack.data.room)
    if (ack.data.match) applyMatch(ack.data.match)
    if (roomId === roomState.value?.id) mergeMessages(ack.data.messages ?? [], true)
    return
  }
  // 소켓 연결 전(새로고침 직후 등): 최근 채팅을 REST 로 복원하고, 연결되면 connect 핸들러가 다시 구독한다
  try {
    const { items } = await api('GET', `/rooms/${roomId}/messages`)
    if (roomId === roomState.value?.id) mergeMessages(items, true)
  } catch {
    /* 무시 */
  }
}
async function openRoom(item, code) {
  roomError.value = ''
  if (roomState.value?.id === item.id) return void (sheet.value = '게임')
  if (item.isPrivate && code === undefined) {
    codeFor.value = item.id
    joinCode.value = ''
    return
  }
  try {
    enterRoom(await api('POST', `/rooms/${item.id}/join`, code ? { code } : {}))
    codeFor.value = null
  } catch (err) {
    roomError.value = err.message
    await loadRooms()
  }
}
function enterRoom(snap) {
  if (roomState.value && roomState.value.id !== snap.id) wsEmit('room:unsubscribe', { roomId: roomState.value.id })
  if (roomState.value?.id !== snap.id) {
    match.value = null
    chatMessages.value = []
  }
  roomState.value = snap
  sheet.value = '게임'
  subscribe(snap.id)
  if (snap.status === 'PLAYING' && snap.matchId) api('GET', `/matches/${snap.matchId}`).then(applyMatch).catch(() => {})
}
async function createRoom() {
  const name = roomName.value.trim()
  if (!name) return
  try {
    enterRoom(await api('POST', '/rooms', { name, ...newRoom.value }))
    roomName.value = ''
    roomError.value = ''
  } catch (err) {
    roomError.value = err.message
  }
}
function applyRoom(snap) {
  if (!roomState.value || snap.id !== roomState.value.id) return
  roomState.value = snap
  if (snap.status === 'PLAYING' && snap.matchId && match.value?.id !== snap.matchId) api('GET', `/matches/${snap.matchId}`).then(applyMatch).catch(() => {})
}
function onLeft() {
  wsEmit('room:unsubscribe', { roomId: roomState.value.id })
  roomState.value = null
  match.value = null
  chatMessages.value = []
  sheet.value = '로비'
  loadRooms()
}

// ───────── 게임 (서버 상태) ─────────
const match = ref(null)
const clockOffset = ref(0)
const now = ref(Date.now())
const gameMessage = ref('')
const pending = ref(false)
const activeCell = ref('B2')
let tick
function applyMatch(s) {
  if (!roomState.value || s.roomId !== roomState.value.id) return
  const prev = match.value
  if (prev && prev.id === s.id && s.version <= prev.version) return // 오래된·중복 이벤트 무시
  match.value = s
  clockOffset.value = Date.parse(s.serverTime) - Date.now()
  // 새 굴림이 반영되면 굴림 연출(결과는 이미 서버 값으로 확정됨 — 애니메이션은 표시만)
  const prevRolls = prev && prev.id === s.id && prev.turnUserId === s.turnUserId ? prev.rollCount : 0
  if (s.status === 'ACTIVE' && s.rollCount > prevRolls) {
    animateRoll(s)
    if (s.turnUserId === me.value?.id) playSound('roll')
  }
  if (heldOverride.value && s.version > heldOverrideVersion) heldOverride.value = null
  const turnChanged = !prev || prev.id !== s.id || prev.turnUserId !== s.turnUserId || prev.phase !== s.phase
  if (turnChanged) {
    selectedKey.value = null
    if (s.phase === 'PLAYING' && s.turnUserId === me.value?.id) {
      if (prefs.turnNotification) showToast('내 차례입니다! [표본 산출]을 눌러 주사위를 굴리세요.')
      playSound('turn')
    }
    else if (s.phase === 'PLAYING' && prev?.phase === 'BRIEFING') showToast('안내 확인 완료 — 게임을 시작합니다.')
  }
  // 시작 안내 단계: 아직 확인하지 않았으면 안내를 띄운다("다시 보지 않기"면 바로 확인 전송)
  const mine = s.players.find(p => p.userId === me.value?.id)
  if (s.phase === 'BRIEFING' && mine && !mine.briefed && !briefingSent.value) {
    if (guideSkipped()) sendBriefed(true)
    else guideMode.value = 'briefing'
  }
  if (s.phase !== 'BRIEFING') {
    briefingSent.value = false
    if (guideMode.value === 'briefing') guideMode.value = null
  }
}

// ───────── 주사위 굴림 애니메이션(DICE-001): 시각 효과 전용 ─────────
const rolling = ref(false)
const rollingMask = ref([])
const animFaces = ref([])
const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
let faceTimer
let rollTimer
function animateRoll(s) {
  const ms = diceMs()
  if (reduceMotion || !ms) return
  clearInterval(faceTimer)
  clearTimeout(rollTimer)
  rollingMask.value = s.held.map(h => !h)
  rolling.value = true
  const shuffle = () => (animFaces.value = s.dice.map((d, i) => (rollingMask.value[i] ? 1 + Math.floor(Math.random() * 6) : d)))
  shuffle()
  faceTimer = setInterval(shuffle, 70)
  rollTimer = setTimeout(() => {
    clearInterval(faceTimer)
    rolling.value = false
  }, ms)
}
const displayDice = computed(() => (rolling.value ? animFaces.value : dice.value))
const FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅']

// ───────── 시작 안내·도움말 ─────────
const guideMode = ref(null) // 'briefing' | 'help' | null
const briefingSent = ref(false)
const briefing = computed(() => match.value?.phase === 'BRIEFING')
const briefedCount = computed(() => match.value?.players.filter(p => p.briefed).length ?? 0)
const briefingRemaining = computed(() => {
  const d = match.value?.briefingDeadlineAt
  return d ? Math.max(0, Math.ceil((Date.parse(d) - (now.value + clockOffset.value)) / 1000)) : null
})
async function sendBriefed(skipped) {
  if (!match.value || briefingSent.value) return
  briefingSent.value = true
  try {
    applyMatch(await api('POST', `/matches/${match.value.id}/briefing`))
    if (skipped && guideMode.value !== 'briefing') showToast('안내를 건너뛰었습니다. [평가 양식 안내]에서 언제든 다시 볼 수 있습니다.')
  } catch (err) {
    briefingSent.value = false
    gameMessage.value = err.message
  }
}
function onGuideDone({ skipped }) {
  sendBriefed(skipped)
}

// ───────── 알림(토스트): 표시 전용, 게임 진행과 무관 ─────────
const toast = ref('')
let toastTimer
function showToast(text) {
  toast.value = text
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), toastMs())
}
const matchStarted = computed(() => !!match.value)
const ribbonHidden = computed(() => prefs.ribbonCollapsed && sheet.value === '게임' && !!match.value)
const done = computed(() => match.value?.status === 'FINISHED')
const dice = computed(() => match.value?.dice ?? [])
const held = computed(() => match.value?.held ?? Array(5).fill(false))
const rolls = computed(() => match.value?.rollCount ?? 0)
const round = computed(() => match.value?.round ?? 1)
const myTurn = computed(() => match.value?.phase === 'PLAYING' && match.value.turnUserId === me.value?.id)
const previews = computed(() => (myTurn.value ? match.value.previews : {}))
const canRoll = computed(() => myTurn.value && !pending.value && !rolling.value && rolls.value < 3 && !(rolls.value > 0 && held.value.every(Boolean)))
const canHold = computed(() => myTurn.value && !pending.value && !rolling.value && rolls.value > 0 && rolls.value < 3)
const canSelect = computed(() => myTurn.value && rolls.value > 0 && !rolling.value)
// 표본 고정: 누르는 즉시 표시(서버 응답 전 낙관적 표시) → 서버 상태가 오면 그 값으로 교체
const heldOverride = ref(null)
let heldOverrideVersion = -1
const heldView = computed(() => heldOverride.value ?? held.value)
// 점수 선택(미리보기)과 확정 분리
const selectedKey = ref(null)
const infoKey = ref(null)
const labelOf = key => categories.find(([k]) => k === key)?.[1] ?? key
const selected = computed(() => {
  if (!selectedKey.value || !canSelect.value || selectedKey.value in player.value) return null
  const e = explain(selectedKey.value, dice.value)
  return { key: selectedKey.value, label: labelOf(selectedKey.value), en: CATEGORY_INFO[selectedKey.value].en, points: previews.value[selectedKey.value] ?? e.points, reason: e.reason }
})
const info = computed(() => {
  if (!infoKey.value) return null
  const e = explain(infoKey.value, dice.value)
  return { label: labelOf(infoKey.value), en: CATEGORY_INFO[infoKey.value].en, rule: CATEGORY_INFO[infoKey.value].rule, reason: dice.value.length ? e.reason : '' }
})
const nextAction = computed(() => {
  const m = match.value
  if (!m || m.status !== 'ACTIVE') return ''
  if (m.phase === 'BRIEFING') return `참여자들이 게임 안내를 확인하는 중입니다 (${briefedCount.value}/${m.players.length}). 모두 확인하면 첫 턴이 시작되고 그때부터 시간이 흐릅니다.`
  if (!myTurn.value) {
    const p = m.players.find(x => x.userId === m.turnUserId)
    return `${turnName.value} 님 차례입니다${p?.isBot ? ' (봇이 진행 중)' : p && p.playMode !== 'MANUAL' ? ' (자동 진행 중)' : ''}. 내 차례가 오면 알려 드립니다.`
  }
  if (pending.value) return '서버에서 처리하고 있습니다…'
  if (!rolls.value) return '① [표본 산출]을 눌러 주사위 5개를 굴리세요.'
  if (selected.value) return `④ 선택한 항목을 확인하고 [${selected.value.label} ${selected.value.points}점 확정]을 누르면 기록되고 턴이 끝납니다.`
  if (rolls.value < 3) return `② 남길 주사위를 눌러 고정한 뒤 [재산출](남은 ${3 - rolls.value}회)하거나, 점수표의 +점수 칸에서 기록할 항목을 고르세요.`
  return '③ 굴림을 모두 사용했습니다. 점수표의 +점수 칸에서 기록할 항목을 고르세요(0점도 가능).'
})
const standings = computed(() => [...(match.value?.players ?? [])].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.seat - b.seat))
const mySeat = computed(() => match.value?.players.find(p => p.userId === me.value?.id))
const player = computed(() => scoreCard(mySeat.value))
const opponents = computed(() => (match.value?.players ?? []).filter(p => p.userId !== me.value?.id))
const turnName = computed(() => match.value?.players.find(p => p.userId === match.value.turnUserId)?.nickname ?? '')
const remaining = computed(() => {
  const d = match.value?.turnDeadlineAt
  if (!d) return null
  const sec = Math.ceil((Date.parse(d) - (now.value + clockOffset.value)) / 1000)
  return Math.min(match.value.turnTimeLimitSec, Math.max(0, sec)) // 시계 오차로 제한시간보다 크게 보이지 않게
})
const outcome = computed(() => '평가 결과 · ' + (mySeat.value?.rank ?? '-') + '위 / ' + (match.value?.players.length ?? 0) + '명')
const modeLabel = { AUTO: '오토', AWAY: '자리 비움' }
function scoreCard(p) {
  return p ? Object.fromEntries(Object.entries(p.scores).filter(([, v]) => v !== null)) : {}
}
async function command(body) {
  if (!match.value || pending.value) return
  pending.value = true
  gameMessage.value = ''
  const payload = { commandId: newCommandId(), expectedVersion: match.value.version, ...body }
  try {
    try {
      applyMatch(await api('POST', `/matches/${match.value.id}/commands`, payload))
    } catch (err) {
      if (err.code !== 'NETWORK_ERROR') throw err
      applyMatch(await api('POST', `/matches/${match.value.id}/commands`, payload)) // 같은 commandId 로 1회 재전송(중복 처리 없음)
    }
  } catch (err) {
    gameMessage.value = err.message
    if (err.code === 'STALE_VERSION') api('GET', `/matches/${match.value.id}`).then(applyMatch).catch(() => {})
  } finally {
    pending.value = false
  }
}
const roll = () => {
  if (!canRoll.value) return
  toast.value = '' // 사용자가 행동하면 안내 토스트를 닫는다
  return command({ type: 'ROLL' })
}
function toggleHold(i) {
  if (!canHold.value) return
  const next = [...heldView.value]
  next[i] = !next[i]
  heldOverride.value = next
  heldOverrideVersion = match.value.version
  command({ type: 'HOLD', held: next }).then(() => {
    if (gameMessage.value) heldOverride.value = null // 실패 시 서버 상태로 되돌림
  })
}
/** 점수표 칸 누르기 = 선택만(기록 아님). 확정은 confirmScore */
function selectScore(key, row) {
  if (!canSelect.value || key in player.value) return
  selectedKey.value = selectedKey.value === key ? null : key
  infoKey.value = null
  activeCell.value = 'B' + row
}
async function confirmScore() {
  const s = selected.value
  if (!s || pending.value) return
  const nextName = (() => {
    const ps = [...match.value.players].sort((a, b) => a.seat - b.seat)
    const i = ps.findIndex(p => p.userId === me.value.id)
    return ps[(i + 1) % ps.length]?.nickname
  })()
  await command({ type: 'SCORE', category: s.key })
  if (!gameMessage.value) {
    playSound('confirm')
    showToast(`${s.label}에 ${s.points}점 기록 완료 · 다음: ${nextName} 님 차례`)
  }
}
async function toggleAuto() {
  try {
    applyMatch(await api('POST', `/matches/${match.value.id}/mode`, { mode: mySeat.value.playMode === 'MANUAL' ? 'AUTO' : 'MANUAL' }))
  } catch (err) {
    gameMessage.value = err.message
  }
}
function backToRoom() {
  match.value = null
  if (roomState.value) subscribe(roomState.value.id)
}
/** 다시 게임하기: 같은 방 대기실로 돌아가 참여자는 바로 준비(새 매치는 PL 시작 시 생성 — 이전 결과는 보존) */
async function rematch() {
  const roomId = roomState.value?.id
  backToRoom()
  if (roomId && roomState.value?.ownerId !== me.value?.id) {
    try {
      applyRoom(await api('POST', `/rooms/${roomId}/ready`, { ready: true }))
    } catch (err) {
      gameMessage.value = err.message
    }
  }
}

// ───────── 채팅(서버) ─────────
const chatMessages = ref([])
/** id·clientMessageId 기준 병합(재접속·재전송 중복 제거), seq 순 정렬, 대기 중 메시지는 뒤에 */
function mergeMessages(list, replaceConfirmed = false) {
  const pendingOnly = chatMessages.value.filter(m => m.pending)
  const byKey = new Map((replaceConfirmed ? [] : chatMessages.value.filter(m => !m.pending)).map(m => [m.id, m]))
  for (const m of list) byKey.set(m.id, m)
  const confirmedCids = new Set([...byKey.values()].map(m => m.clientMessageId).filter(Boolean))
  chatMessages.value = [...[...byKey.values()].sort((a, b) => a.seq - b.seq), ...pendingOnly.filter(m => !confirmedCids.has(m.clientMessageId))]
}
async function deliver(entry) {
  const roomId = roomState.value?.id
  if (!roomId) return
  let ack = await wsEmit('chat:send', { roomId, clientMessageId: entry.clientMessageId, text: entry.text })
  if (!ack.ok && ack.error.code === 'NOT_CONNECTED') {
    try {
      ack = { ok: true, data: await api('POST', `/rooms/${roomId}/messages`, { clientMessageId: entry.clientMessageId, text: entry.text }) }
    } catch (err) {
      ack = { ok: false, error: { message: err.message } }
    }
  }
  if (ack.ok) mergeMessages([ack.data])
  else chatMessages.value = chatMessages.value.map(m => (m.clientMessageId === entry.clientMessageId ? { ...m, failed: true, error: ack.error.message } : m))
}
function sendChat(text) {
  const entry = { clientMessageId: newCommandId(), text, kind: 'TEXT', userId: me.value.id, pending: true, createdAt: new Date().toISOString() }
  chatMessages.value = [...chatMessages.value, entry]
  deliver(entry)
}
function retryChat(entry) {
  chatMessages.value = chatMessages.value.map(m => (m.clientMessageId === entry.clientMessageId ? { ...m, failed: false, error: null } : m))
  deliver(entry) // 같은 clientMessageId → 서버에서 한 번만 저장
}

// ───────── 초대 ─────────
const invites = ref([])
function onInvite(inv) {
  if (inv.targetUserId !== me.value?.id) return // 내가 보낸 초대의 상태 변화(수락·거절)는 대기실 시스템 메시지로 확인
  invites.value = [inv, ...invites.value.filter(i => i.id !== inv.id)].filter(i => i.status === 'PENDING')
}
async function respondInvite(inv, accept) {
  try {
    const r = await api('POST', `/room-invites/${inv.id}/${accept ? 'accept' : 'decline'}`)
    invites.value = invites.value.filter(i => i.id !== inv.id)
    if (r.room) enterRoom(r.room)
  } catch (err) {
    formulaMessage.value = err.message
    invites.value = invites.value.filter(i => i.id !== inv.id || !['INVITE_EXPIRED', 'INVITE_NOT_PENDING'].includes(err.code))
  }
}

// ───────── DEV 패널 이벤트 ─────────
async function onDevOpen({ room: snap, match: m } = {}) {
  if (snap) enterRoom(snap)
  if (m) applyMatch(m)
  dev.value = await devStatus()
}
function onDevReset() {
  roomState.value = null
  match.value = null
  sheet.value = '로비'
  loadRooms()
}

// ───────── 상점·사무실 (로컬 목업, 서버 미구현) ─────────
const coin = ref(120)
const catalog = [
  { sku: 'plant-01', name: '탁상 화분', price: 40, icon: '🪴' },
  { sku: 'lamp-01', name: '업무용 스탠드', price: 70, icon: '💡' },
]
const owned = ref([])
const decor = ref(null)
const note = ref('')
function buy(item) {
  if (owned.value.includes(item.sku)) return
  if (coin.value < item.price) {
    note.value = '코인이 부족합니다.'
    return
  }
  coin.value -= item.price
  owned.value.push(item.sku)
  note.value = item.name + ' 구매 완료'
}

// ───────── 시작 ─────────
/** 브라우저 네트워크 상태: 끊김을 즉시 표시하고, 복구되면 현재 방 스냅샷·채팅을 다시 받아 놓친 변경을 보충 */
function onOffline() {
  if (me.value) connection.value = 'disconnected'
}
function onOnline() {
  if (!me.value) return
  connection.value = 'reconnecting'
  setTimeout(() => {
    if (roomState.value) subscribe(roomState.value.id).then(() => connection.value === 'reconnecting' && wsConnected() && (connection.value = 'connected'))
  }, 300)
}

onMounted(async () => {
  useGuest(false) // 세션 확인 전에는 화면 테마를 바꾸지 않음
  window.addEventListener('offline', onOffline)
  window.addEventListener('online', onOnline)
  tick = setInterval(() => (now.value = Date.now()), 250)
  const params = new URLSearchParams(location.search)
  if (params.get('auth')) {
    if (params.get('auth') === 'error') authMessage.value = AUTH_ERRORS[params.get('reason')] ?? '인증을 완료하지 못했습니다. 다시 시도해 주세요.'
    history.replaceState(null, '', location.pathname) // 결과 표시 후 주소 정리
  }
  try {
    providers.value = await api('GET', '/auth/providers')
  } catch {
    /* 서버 미기동 시 버튼 비활성 */
  }
  if (import.meta.env.DEV) dev.value = await devStatus()
  const user = await refresh()
  if (user) await afterLogin(user)
  else applyToDom() // 비로그인 확정 → 이 브라우저 설정 적용
  booting.value = false
})
onBeforeUnmount(() => {
  clearTimeout(toastTimer)
  window.removeEventListener('offline', onOffline)
  window.removeEventListener('online', onOnline)
  clearInterval(tick)
  clearInterval(faceTimer)
  clearTimeout(rollTimer)
  clearTimeout(lobbyTimer)
})
</script>

<template>
  <div v-if="booting" class="login-workbook"><main class="login-grid"><section class="login-document"><p role="status">업무 문서를 여는 중…</p></section></main></div>
  <div v-else-if="!me" class="login-workbook">
    <header class="top"><span class="app-mark">X</span><strong>임직원_인사관리시스템.xlsx</strong><span class="account">미인증 · 접근 대기</span><button class="settings-btn" aria-label="환경 설정" title="환경 설정" :aria-expanded="settingsOpen" @click="settingsOpen = !settingsOpen">⚙</button></header>
    <div class="login-menu">파일　　홈　　삽입　　페이지 레이아웃　　수식　　데이터　　검토　　보기</div>
    <div class="formula"><strong>B4</strong><span>ƒx</span><span>임직원 인증 후 인사·평가 문서를 열 수 있습니다.</span></div>
    <div class="column-headers" aria-hidden="true"><span>◢</span><span v-for="letter in 'ABCDEFGHIJKLMN'" :key="letter">{{ letter }}</span></div>
    <main class="login-grid entry-grid">
      <div class="row-headers" aria-hidden="true"><span v-for="n in 40" :key="n">{{ n }}</span></div>
      <div class="entry-layout">
        <section class="entry-cover">
          <div class="entry-wordmark"><span class="entry-monogram">CY</span><span>COMPANY YACHT DICE<br><small>PERSONNEL MANAGEMENT</small></span></div>
          <p class="entry-kicker">인사 · 평가 · 조직 관리</p>
          <h1>오늘의 업무를<br>시작합니다.</h1>
          <p class="entry-description">나의 기록을 쌓고, 동료와 함께 성장하는 곳.<br>사원 인증 후 개인 업무 문서를 열어보세요.</p>
          <div class="entry-register">
            <div class="register-heading"><span>통합 업무 문서</span><span>HR / 2026</span></div>
            <div><span>01</span><strong>인사기록부</strong><small>사원 정보 및 소속 관리</small></div>
            <div><span>02</span><strong>성과평가표</strong><small>개인 실적 및 평가 기록</small></div>
            <div><span>03</span><strong>회사 운영대장</strong><small>회사 가입 및 조직 현황</small></div>
          </div>
          <span class="entry-cover-foot">COMPANY YACHT DICE　 /　 INTERNAL WORKSPACE</span>
        </section>
      <section class="login-document entry-auth">
        <div class="entry-auth-label"><span>사원 접속</span><span>HR-SSO-001</span></div>
        <p class="eyebrow">임직원 통합 업무 시스템</p>
        <h1>업무 계정 연결</h1>
        <p>사용하시는 계정으로 간편하게 접속하세요.</p>
        <div class="provider-list">
          <button v-for="provider in providers" :key="provider.id" :class="['provider-' + provider.id, { 'provider-off': !provider.enabled }]" :aria-disabled="!provider.enabled" v-help="provider.enabled ? provider.name + ' 계정으로 로그인합니다. 처음이면 가입 후 인사 등록으로 이동합니다.' : provider.name + ' 로그인은 서버 설정 후 사용할 수 있습니다.'" @click="beginAuth(provider)"><svg v-if="provider.id === 'kakao'" class="provider-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#191919" d="M12 3C6.5 3 2 6.5 2 10.8c0 2.8 1.9 5.2 4.8 6.6L5.6 22l5.2-3.5H12c5.5 0 10-3.5 10-7.7S17.5 3 12 3Z"/></svg>
          <svg v-else-if="provider.id === 'google'" class="provider-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.3 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.41 13.92A6 6 0 0 1 6.1 12c0-.67.11-1.32.31-1.92V7.49H3.07A10 10 0 0 0 2 12c0 1.61.39 3.14 1.07 4.51l3.34-2.59Z"/><path fill="#EA4335" d="M12 5.96c1.47 0 2.79.51 3.82 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.59A5.99 5.99 0 0 1 12 5.96Z"/></svg>
          <svg v-else class="provider-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="white" d="M3 3h6l6 9V3h6v18h-6l-6-9v9H3Z"/></svg>
          <span>{{ provider.name }} 계정 인증</span><span class="provider-arrow" aria-hidden="true">{{ provider.enabled ? '→' : '설정 필요' }}</span></button>
        </div>
        <form class="login-form email-form" @submit.prevent="submitEmail">
          <div class="segmented" role="tablist" aria-label="이메일 계정"><button type="button" role="tab" :aria-selected="emailMode === 'login'" @click="emailMode = 'login'">이메일 로그인</button><button type="button" role="tab" :aria-selected="emailMode === 'signup'" @click="emailMode = 'signup'">회원가입</button></div>
          <div class="login-field"><label for="login-email">이메일</label><input id="login-email" v-model="email" type="email" autocomplete="username" required maxlength="254"></div>
          <div class="login-field"><label for="login-password">비밀번호</label><input id="login-password" v-model="password" type="password" :autocomplete="emailMode === 'signup' ? 'new-password' : 'current-password'" required minlength="10" maxlength="128" :placeholder="emailMode === 'signup' ? '10자 이상' : ''"></div>
          <button class="primary login-submit" :disabled="authBusy" v-help="emailMode === 'signup' ? '이메일 계정을 만들고 인사 등록으로 이동합니다.' : '이메일 계정으로 접속합니다.'">{{ emailMode === 'signup' ? '가입하고 접속' : '업무 접속' }}</button>
        </form>
        <p v-if="authMessage" class="auth-message" role="status">{{ authMessage }}</p>
        <div class="entry-onboarding"><strong>처음 방문하셨나요?</strong><p>계정 인증 후 사원명과 부서를 등록하면<br>나만의 인사기록부가 만들어집니다.</p></div>
        <p class="login-document-foot">공용 기기에서는 이용 후 업무를 종료해 주세요.</p>
      </section>
      </div>
    </main>
    <footer><nav aria-label="시트 탭"><span class="login-sheet">인사접속관리</span></nav><span>준비　 ·　 100%</span></footer>
  </div>
  <div v-else-if="!me.profileCompleted" class="login-workbook">
    <header class="top"><span class="app-mark">X</span><strong>신규_인사기록카드.xlsx</strong><div class="account"><button v-help="'현재 계정에서 로그아웃합니다.'" @click="logout">업무 종료</button></div><button class="settings-btn" aria-label="환경 설정" title="환경 설정" :aria-expanded="settingsOpen" @click="settingsOpen = !settingsOpen">⚙</button></header>
    <main class="login-grid"><section class="login-document">
      <p v-if="authMessage" class="auth-message" role="status">{{ authMessage }}</p><p class="eyebrow">최초 접속　｜　사원 정보 등록</p><h1>신규 인사기록카드</h1>
      <form class="login-form" @submit.prevent="saveProfile">
        <div class="login-field"><label for="employee-name">사원명</label><input id="employee-name" v-model="employeeName" maxlength="24" placeholder="게임에서 사용할 이름" required></div>
        <div class="login-field"><label for="employee-dept">담당 부서</label><select id="employee-dept" v-model="departmentChoice"><option v-for="department in departments" :key="department">{{ department }}</option></select></div>
        <div v-if="departmentChoice === '직접 입력'" class="login-field"><label for="custom-dept">부서명</label><input id="custom-dept" v-model="customDepartment" maxlength="30" placeholder="부서명 직접 입력" required></div>
        <p class="document-note">회사는 등록 후 회사 목록에서 가입 신청하거나 대표의 초대를 수락해 소속됩니다.</p>
        <button class="primary login-submit" v-help="'사원명과 부서를 저장하고 회사 가입 화면으로 이동합니다.'">인사 정보 등록</button>
      </form>
    </section></main>
  </div>
  <template v-else>
  <header class="top">
    <span class="app-mark">X</span><strong>2026_부서별_성과평가_관리대장.xlsx</strong>
    <span class="save-state" :class="'conn-' + connection">{{ { connected: '서버와 실시간 동기화 중', reconnecting: '재연결 중…', connecting: '연결 중…', disconnected: '연결 끊김' }[connection] ?? '오프라인' }}</span><div class="account"><span>{{ userName }} · {{ myRank }}</span><button v-help="'현재 계정에서 로그아웃합니다.'" @click="logout">업무 종료</button></div>
  <button class="settings-btn" aria-label="환경 설정" title="환경 설정" :aria-expanded="settingsOpen" @click="settingsOpen = !settingsOpen">⚙</button>
  </header>
  <nav v-show="!ribbonHidden" class="menu-tabs" aria-label="워크북 메뉴">
    <button v-for="item in ['파일', '홈', '삽입', '페이지 레이아웃', '수식', '데이터', '검토', '보기']" :key="item" :aria-current="menu === item ? 'page' : undefined" @click="menu = item; showFunctions = item === '수식'" v-help="'편집기 메뉴를 선택합니다. 수식 메뉴에서 게임 함수를 사용할 수 있습니다.'">{{ item }}</button>
  </nav>
  <div v-show="!ribbonHidden" class="toolbar">
    <div class="tool-group"><span>↶　↷　▣</span><small>클립보드</small></div>
    <div class="tool-group"><span class="format-preview">맑은 고딕　⌄　 11　⌄</span><span><b>가</b>　<i>가</i>　<u>가</u>　 ▦　 A̲</span><small>글꼴</small></div>
    <div class="tool-group"><span>☷　☰　☷</span><span>자동 줄 바꿈　　병합하고 가운데 맞춤</span><small>맞춤</small></div>
    <div class="tool-group"><span class="format-preview">일반　　　　　　　⌄</span><span>₩　 %　 ,　 .00</span><small>표시 형식</small></div>
    <div class="tool-group"><button v-help="'게임 화면 이동과 주사위 굴리기 함수를 선택합니다.'" @click="showFunctions = !showFunctions">ƒx 함수 삽입</button><button @click="sheet = '상점'" v-help="'포인트로 구매할 수 있는 장식 목록을 엽니다.'">복리후생 정산 양식</button><small>업무 도구</small></div>
  </div>
  <form class="formula" @submit.prevent="runFormula">
    <strong>{{ sheet === '게임' ? activeCell : 'A1' }}</strong>
    <button type="button" @click="formulaInput = ''; formulaMessage = ''" aria-label="수식 지우기" v-help="'입력한 수식과 실행 안내를 지웁니다.'">×</button>
    <button type="submit" aria-label="수식 실행" v-help="'입력한 게임 함수를 실행합니다.'">✓</button><button type="button" v-help="'게임 화면 이동과 주사위 굴리기 함수를 선택합니다.'" @click="showFunctions = !showFunctions">ƒx</button>
    <input v-model="formulaInput" aria-label="수식 입력줄" placeholder="=LOBBY() · =GAME() · =ROLL() 입력 후 Enter">
  </form>
  <div v-if="showFunctions" class="function-panel">
    <strong>함수 삽입</strong><span>함수에 마우스를 올리면 설명을 확인하고, 클릭하면 바로 실행합니다.</span>
    <span v-for="(fn, index) in workbookFunctions" :key="fn.formula" class="function-choice">
      <button :aria-describedby="'function-help-' + index" @click="formulaInput = fn.formula; runFormula()">{{ fn.formula }}</button>
      <span :id="'function-help-' + index" class="function-tooltip" role="tooltip">{{ fn.description }}</span>
    </span>
    <button @click="showFunctions = false" v-help="'함수 선택 창을 닫습니다.'">닫기</button>
  </div>
  <p v-if="formulaMessage" class="formula-feedback" role="status">{{ formulaMessage }}</p>
  <div v-if="invites.length" class="invite-banner" role="region" aria-label="받은 참석 요청">
    <div v-for="inv in invites" :key="inv.id" class="invite-row"><strong>참석 요청</strong><span>{{ inv.inviterNickname }} PL · {{ inv.roomName }}</span><small>{{ new Date(inv.expiresAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) }}까지</small><button class="primary" @click="respondInvite(inv, true)">참석 수락</button><button @click="respondInvite(inv, false)">거절</button></div>
  </div>
  <div class="column-headers" aria-hidden="true"><span>◢</span><span v-for="letter in 'ABCDEFGHIJKLMN'" :key="letter">{{ letter }}</span></div>
  <main><div class="row-headers" aria-hidden="true"><span v-for="n in 45" :key="n">{{ n }}</span></div><div class="worksheet">
    <section v-if="sheet === '로비'" class="panel">
      <p class="eyebrow">문서번호　HR-2026-001</p><h1>성과평가 운영대장</h1><p>작성부서　{{ team }}　　평가유형　정기평가　　처리구분　내부</p>
      <div class="grid"><table><thead><tr><th>행</th><th>평가 문서명</th><th>PL</th><th>인원</th><th>턴 제한</th><th>상태</th><th>문서 열기</th></tr></thead>
        <tbody>
          <tr v-for="(item, i) in rooms" :key="item.id" :class="{ selected: roomState?.id === item.id }"><th scope="row">{{ i + 1 }}</th>
            <td>{{ item.name }}<span v-if="item.isPrivate" class="badge" title="입장 코드 필요">비공개</span><span v-if="item.isTest" class="badge">테스트</span></td>
            <td>{{ item.ownerNickname }}</td><td>{{ item.count }} / {{ item.capacity }}</td><td>{{ formatLimit(item.turnTimeLimitSec) }}</td>
            <td><span class="badge">{{ roomState?.id === item.id ? '참석 중' : item.status === 'PLAYING' ? '평가 중' : item.count >= item.capacity ? '정원 마감' : '대기' }}</span></td>
            <td>
              <form v-if="codeFor === item.id" class="code-form" @submit.prevent="openRoom(item, joinCode.trim())"><input v-model="joinCode" maxlength="8" aria-label="입장 코드" placeholder="입장 코드" autofocus><button class="primary" :disabled="!joinCode.trim()">입장</button><button type="button" @click="codeFor = null">취소</button></form>
              <button v-else :disabled="roomState?.id !== item.id && (item.status !== 'WAITING' || item.count >= item.capacity)" @click="openRoom(item)">{{ roomState?.id === item.id ? '이어하기' : '열기' }}</button>
            </td></tr>
          <tr v-if="!rooms.length"><td colspan="7">개설된 평가 문서가 없습니다. 새 문서를 작성해 보세요.</td></tr>
        </tbody>
      </table></div>
      <form class="create-room" @submit.prevent="createRoom">
        <input v-model="roomName" @input="roomError = ''" maxlength="40" aria-label="새 방 이름" placeholder="신규 평가 문서명">
        <label>정원 <select v-model.number="newRoom.capacity" aria-label="정원"><option v-for="n in [2,3,4,5,6]" :key="n" :value="n">{{ n }}명</option></select></label>
        <div class="segmented" role="radiogroup" aria-label="공개 여부"><button v-for="v in [['PUBLIC','공개'],['PRIVATE','비공개']]" :key="v[0]" type="button" role="radio" :aria-checked="newRoom.visibility === v[0]" @click="newRoom.visibility = v[0]">{{ v[1] }}</button></div>
        <span class="segment-label">턴 제한</span><div class="segmented" role="radiogroup" aria-label="턴 제한시간"><button v-for="sec in TURN_OPTIONS" :key="sec" type="button" role="radio" :aria-checked="newRoom.turnTimeLimitSec === sec" @click="newRoom.turnTimeLimitSec = sec">{{ formatLimit(sec) }}</button></div>
        <label><input v-model="newRoom.botsAllowed" type="checkbox"> 봇 허용</label>
        <button class="primary" :disabled="!roomName.trim()" v-help="'설정한 조건으로 평가실을 만들고 PL로 입장합니다. 비공개면 입장 코드가 발급됩니다.'">문서 작성</button>
        <button type="button" @click="loadRooms" v-help="'평가 문서 목록을 새로 불러옵니다.'">목록 새로고침</button>
      </form>
      <p v-if="roomError" role="alert">{{ roomError }}</p>
    </section>

    <section v-else-if="sheet === '게임' && !roomState" class="panel"><h1>개인 성과평가표</h1><p>평가운영대장에서 문서를 선택해 주세요.</p><button v-help="'게임방 목록으로 돌아갑니다.'" @click="sheet = '로비'">운영대장</button></section>
    <div v-else-if="sheet === '게임'" class="match">
      <EvaluationRoom v-if="!matchStarted" :key="roomState.id" :room="roomState" :me-id="me.id" @update="applyRoom" @started="applyMatch" @left="onLeft" @help="guideMode = 'help'" />
      <section v-else class="panel game-panel">
        <header class="game-head">
          <div><p class="eyebrow">문서번호　HR-2026-002　｜　부서 성과 평가</p><h1>{{ room }}</h1></div>
          <button class="help-btn guide-btn" @click="guideMode = 'help'" v-help="'평가 규정과 점수 산정 기준을 엽니다. 게임 진행에는 영향이 없습니다.'"><span class="guide-title"><span aria-hidden="true">📋</span> 평가 양식 안내</span><small>평가 규정 및 점수 산정 기준</small></button>
        </header>
        <p v-if="connection !== 'connected'" class="connection-warning" role="alert">{{ connection === 'reconnecting' || connection === 'connecting' ? '실시간 연결 재시도 중… 화면이 최신이 아닐 수 있습니다.' : '실시간 연결이 끊겼습니다.' }}</p>
        <div class="game-body">
        <div class="game-controls">
        <p v-if="done" role="status" class="progress">{{ outcome }}</p>
        <div v-if="!done" class="turn-status" aria-live="polite">
          <span role="status" class="progress">라운드 <b>{{ round }}</b>/12</span>
          <strong :class="{ mine: myTurn }">{{ briefing ? '게임 안내 확인 중' : myTurn ? '내 차례' : turnName + ' 님 차례' }}</strong>
          <span v-if="briefing" class="timer paused">첫 턴 타이머 정지 · 확인 {{ briefedCount }}/{{ match.players.length }}명</span>
          <span v-else-if="remaining !== null" class="timer" :class="{ urgent: remaining < 30 }" :aria-label="'남은 시간 ' + formatClock(remaining)">⏱ {{ formatClock(remaining) }}</span>
          <span class="roll-count" :aria-label="'굴림 ' + rolls + '회 / 3회'">굴림 <b>{{ rolls }}</b> / 3</span>
          <button v-if="mySeat" class="auto-toggle" :aria-pressed="mySeat.playMode !== 'MANUAL'" @click="toggleAuto" v-help="'오토 모드에서는 서버가 같은 규칙으로 대신 굴리고 기록합니다.'">{{ mySeat.playMode === 'MANUAL' ? '오토 켜기' : modeLabel[mySeat.playMode] + ' 해제' }}</button>
        </div>
        <div v-if="!done" class="action-box" :class="{ mine: myTurn && !briefing, selecting: !!selected }">
          <div v-if="selected" class="confirm-panel" role="region" aria-label="평가 확정">
            <p><strong>평가 항목 선택: {{ selected.label }}</strong> <small>{{ selected.en }}</small> — 예상 <b>{{ selected.points }}점</b></p>
            <p class="reason">{{ selected.reason }}</p>
            <p v-if="selected.points === 0" class="zero-warn">0점으로 기록됩니다. 기록한 항목은 다시 쓸 수 없습니다.</p>
            <button class="primary confirm-btn" :data-cmd="'CONFIRM ' + (selected.en || '').toUpperCase()" :disabled="pending || rolling" @click="confirmScore">{{ selected.label }} {{ selected.points }}점 확정<small>평가 확정 · 턴 종료</small></button>
            <button :disabled="pending" @click="selectedKey = null">선택 취소</button>
          </div>
          <template v-else>
            <p class="next-action" :class="{ mine: myTurn && !briefing }" aria-live="polite">{{ nextAction }}</p>
            <div v-if="info" class="info-panel" role="note"><strong>{{ info.label }}</strong> <small>{{ info.en }}</small> · {{ info.rule }}<span v-if="info.reason"> · 지금 주사위: {{ info.reason }}</span><button class="link" @click="infoKey = null">닫기</button></div>
          </template>
        </div>
        <div v-if="!done" class="dice" :aria-busy="pending">
          <button v-for="(_, i) in heldView" :key="i" :class="['die', { rolling: rolling && rollingMask[i], held: heldView[i], empty: !dice.length }]" :disabled="!canHold" :aria-pressed="heldView[i]" :aria-label="'주사위 ' + (i + 1) + ' · 눈 ' + (dice[i] ?? '없음') + ' · ' + (heldView[i] ? '고정됨, 누르면 해제' : '누르면 고정')" @click="toggleHold(i)" v-help="!dice.length ? '먼저 표본 산출(주사위 굴리기)을 누르세요.' : !canHold ? (myTurn ? '이번 턴에는 더 굴릴 수 없어 고정할 필요가 없습니다.' : '내 차례에만 조작할 수 있습니다.') : heldView[i] ? '고정 해제: 다음 재산출 때 다시 굴립니다.' : '표본 고정: 다음 재산출 때 이 주사위는 그대로 둡니다.'">
            <span class="face" aria-hidden="true">{{ dice.length ? FACES[displayDice[i]] : '·' }}</span><span class="pip-num">{{ displayDice[i] ?? '' }}</span><small class="hold-tag">{{ heldView[i] ? '🔒 고정' : dice.length && canHold ? '고정하기' : '' }}</small>
          </button>
          <button class="primary roll-btn" :disabled="!canRoll" v-help="rolls ? '고정하지 않은 주사위만 다시 굴립니다. 한 턴에 최대 3회.' : '주사위 5개를 굴립니다. 한 턴에 최대 3회.'" @click="roll">
            <span :data-cmd="rolls ? 'REROLL' : 'ROLL'">{{ rolls ? '재산출' : '표본 산출' }}</span><small>{{ rolls ? '고정 안 한 주사위 다시 굴리기' : '주사위 굴리기' }}{{ myTurn && rolls < 3 ? ` · 남은 ${3 - rolls}회` : '' }}</small>
          </button>
          <span v-if="pending" class="busy" role="status">서버 처리 중…</span>
        </div>
        <div v-if="done" class="result">
          <h2>최종 평가 결과</h2>
          <div class="grid"><table class="standings"><thead><tr><th>순위</th><th>사원명</th><th title="상단 소계">상단</th><th>보너스</th><th>총점</th></tr></thead><tbody>
            <tr v-for="p in standings" :key="p.userId" :class="{ winner: p.rank === 1, selected: p.userId === me.id }"><td>{{ p.rank }}위<span v-if="p.rank === 1" class="badge">최우수</span></td><td>{{ p.nickname }}<small v-if="p.userId === me.id"> (나)</small><small v-if="p.isBot"> · 봇</small></td><td>{{ p.upper }}</td><td>{{ p.bonus }}</td><td><strong>{{ p.total }}</strong></td></tr>
          </tbody></table></div>
          <p class="document-note">항목별 상세는 아래 점수표에서 확인합니다. 결과는 서버에 기록되었습니다.</p>
          <button class="primary" v-help="'같은 평가실로 돌아가 준비합니다. PL이 시작하면 새 게임이 만들어집니다.'" @click="rematch">다시 게임하기</button>
          <button v-help="'게임방 목록으로 돌아갑니다.'" @click="backToRoom(); sheet = '로비'">로비로 돌아가기</button>
        </div>
        <p v-if="gameMessage" role="alert">{{ gameMessage }}</p>
        </div>
        <div class="game-sheet">
        <div class="grid score-grid" tabindex="0" role="region" aria-label="요트 점수표"><table>
          <thead><tr><th scope="col">#</th><th scope="col">평가 항목 <small>(눌러서 설명)</small></th><th scope="col" :class="{ selected: myTurn }">본인 평가</th><th v-for="opponent in opponents" :key="opponent.userId" scope="col" :class="{ selected: opponent.userId === match.turnUserId }">{{ opponent.nickname }}<small v-if="opponent.playMode !== 'MANUAL'"> · {{ modeLabel[opponent.playMode] }}</small><small v-if="opponent.isBot"> · 봇</small></th></tr></thead>
          <tbody>
            <tr v-for="([key, label], i) in categories" :key="key" :class="{ 'row-selected': selectedKey === key }">
              <th scope="row">{{ i + 2 }}</th>
              <td><button class="cat-name" :aria-expanded="infoKey === key" @click="infoKey = infoKey === key ? null : key" v-help="CATEGORY_INFO[key].rule">{{ label }} <small>{{ CATEGORY_INFO[key].en }}</small></button></td>
              <td :class="{ selected: selectedKey === key, filled: key in player }">
                <button v-if="canSelect && !(key in player)" :class="['cell', 'pick', { zero: previews[key] === 0, chosen: selectedKey === key }]" :disabled="pending" :aria-pressed="selectedKey === key" :aria-label="label + ' 선택 — 예상 ' + previews[key] + '점'" v-help="explain(key, dice).reason + ' · 누르면 선택(아직 기록되지 않음)'" @click="selectScore(key, i + 2)">+{{ previews[key] }}</button>
                <span v-else :class="{ locked: key in player }">{{ player[key] ?? '—' }}</span>
              </td>
              <td v-for="opponent in opponents" :key="opponent.userId">{{ opponent.scores[key] ?? '—' }}</td>
            </tr>
            <tr v-for="([label, field, calc], i) in [['상단 소계', 'upper', upper], ['상단 보너스', 'bonus', bonus], ['총점', 'total', total]]" :key="label" class="summary">
              <th scope="row">{{ 14 + i }}</th><td>{{ label }}<small v-if="field === 'upper'"> (63점 이상이면 보너스 35점)</small></td><td>{{ calc(player) }}<small v-if="field === 'upper' && calc(player) < 63"> / 63</small></td><td v-for="opponent in opponents" :key="opponent.userId">{{ opponent[field] }}</td>
            </tr>
          </tbody>
        </table></div>
        </div>
        </div>
      </section>
      <GameGuide v-if="guideMode" :mode="guideMode" :turn-time-limit-sec="match?.turnTimeLimitSec ?? roomState.turnTimeLimitSec" :players="match?.players ?? []" :me-id="me.id" :remaining-sec="briefingRemaining" :sent="briefingSent" @done="onGuideDone" @close="guideMode = null" />
      <div v-if="toast" class="game-toast" role="status" aria-live="polite">{{ toast }}</div>
      <RoomChat :messages="chatMessages" :me-id="me.id" :connected="connection === 'connected'" @send="sendChat" @retry="retryChat" />
    </div>

    <section v-else-if="sheet === '조직'" class="company-placeholder"></section>

    <section v-else-if="sheet === '상점'" class="panel payment-sheet">
      <p class="eyebrow">구매관리　｜　내부 비품 신청</p><h1>복리후생 비품 지급 신청서</h1>
      <div class="approval"><span>신청자<br><b>{{ userName }}</b></span><span>검토<br>확인</span><span>승인<br>내부 포인트</span></div>
      <table><tbody><tr><th>신청부서</th><td>{{ team }}</td><th>가용 예산</th><td>{{ coin }} P</td></tr><tr><th>결제 수단</th><td>사내 복지 포인트</td><th>처리 방식</th><td>즉시 지급</td></tr></tbody></table>
      <table><thead><tr><th>No.</th><th>품목코드</th><th>품명</th><th>수량</th><th>금액</th><th>처리</th></tr></thead>
      <tbody><tr v-for="(item, i) in catalog" :key="item.sku"><td>{{ i + 1 }}</td><td>{{ item.sku }}</td><td>{{ item.name }}</td><td>1</td><td>{{ item.price }} P</td><td><button :disabled="owned.includes(item.sku)" @click="purchase = item" v-help="'선택한 장식의 가격을 확인하고 구매를 진행합니다.'">{{ owned.includes(item.sku) ? '지급 완료' : '결제 요청' }}</button></td></tr></tbody></table>
      <p role="status">{{ note }}</p><p class="document-note">※ 본 양식은 가상 포인트를 사용하는 구매 미리보기입니다.</p>
    </section>

    <section v-else class="panel"><p class="eyebrow">비품관리　｜　개인 배정 현황</p><h1>개인 지급자산 관리대장</h1>
      <p>2D 장식 미리보기</p><div class="office" role="img" :aria-label="decor?.name ?? '빈 책상'">🖥️ {{ decor?.icon }}</div>
      <p v-if="!owned.length">상점에서 장식을 구매하면 여기에서 배치할 수 있습니다.</p>
      <button v-for="item in catalog.filter(item => owned.includes(item.sku))" :key="item.sku" @click="decor = item">{{ item.name }} 배치</button>
      <button v-if="decor" @click="decor = null" v-help="'내 사무실의 장식을 치웁니다.'">배치 해제</button>
    </section>
    <CompanyDirectory v-show="sheet === '조직'" :key="me.id" :employee="userName" :department="team" />
  </div></main>
  <div v-if="purchase" class="modal-backdrop" @click.self="purchase = null">
    <section class="payment-dialog" role="dialog" aria-modal="true" aria-labelledby="payment-title" @keydown.esc="purchase = null">
      <h2 id="payment-title">구매 결제 확인</h2><p>요청 품목과 사용 포인트를 확인해 주세요.</p>
      <dl><dt>품목</dt><dd>{{ purchase.name }}</dd><dt>결제 금액</dt><dd>{{ purchase.price }} P</dd><dt>현재 잔액</dt><dd>{{ coin }} P</dd><dt>결제 후 잔액</dt><dd>{{ coin - purchase.price }} P</dd></dl>
      <p v-if="coin < purchase.price" role="alert">사용 가능한 포인트가 부족합니다.</p>
      <div class="dialog-actions"><button @click="purchase = null" v-help="'구매를 취소하고 품목 목록으로 돌아갑니다.'">취소</button><button class="primary" :disabled="coin < purchase.price" v-help="'가상 포인트를 차감하고 선택한 장식을 구매합니다.'" @click="pay">결제 확인</button></div>
    </section>
  </div>
  <footer><nav aria-label="시트 탭"><button v-for="item in sheets" :key="item" :aria-current="sheet === item ? 'page' : undefined" v-help="sheetHelp[item]" @click="sheet = item">{{ sheetNames[item] }}</button></nav><span>{{ connection === 'connected' ? '준비' : '연결 확인 중' }}　 ·　 100%</span></footer>
  </template>
  <SettingsPanel v-if="settingsOpen" :logged-in="!!me" @close="settingsOpen = false" />
  <component :is="DevPanel" v-if="DevPanel && dev" :status="dev" :user="me" :room="roomState" :match="match" @login="afterLogin" @open="onDevOpen" @reset="onDevReset" />
</template>
