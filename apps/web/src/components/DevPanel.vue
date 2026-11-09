<script setup>
// DEV 테스트 패널: 개발 빌드(import.meta.env.DEV) + 서버 TEST_MODE 일 때만 App 이 렌더링한다.
// 모든 동작은 서버 /api/v1/dev/* (테스트 모드에서만 존재)를 호출하며, 점수·주사위를 화면에서 정하지 않는다.
import { ref } from 'vue'
import { api, devLogin } from '../api.js'

const props = defineProps({ status: Object, user: Object, room: Object, match: Object })
const emit = defineEmits(['login', 'open', 'reset'])
const slot = ref(1)
const nickname = ref('')
const department = ref('')
const capacity = ref(4)
const bots = ref(3)
const turnSec = ref(180)
const autoStart = ref(true)
const memberSlot = ref(2)
const note = ref('')
const busy = ref(false)
// 좁은 화면에서는 접힌 상태로 시작(게임 화면·안내를 가리지 않도록)
const startOpen = typeof window === 'undefined' || !window.matchMedia('(max-width: 900px)').matches

async function run(label, fn) {
  if (busy.value) return
  busy.value = true
  note.value = ''
  try {
    await fn()
    note.value = label + ' 완료'
  } catch (err) {
    note.value = `${label} 실패: ${err.message}`
  } finally {
    busy.value = false
  }
}
const signIn = () => run('테스트 계정 접속', async () => {
  if (nickname.value.trim() || department.value.trim()) {
    const profiles = Array.from({ length: slot.value }, (_, i) => (i === slot.value - 1 ? { nickname: nickname.value.trim() || undefined, departmentLabel: department.value.trim() || undefined } : {}))
    await api('POST', '/dev/accounts', { count: slot.value, profiles })
  }
  emit('login', await devLogin(slot.value))
})
const createRoom = () => run('테스트 방 생성', async () => emit('open', await api('POST', '/dev/rooms', { capacity: capacity.value, bots: bots.value, turnTimeLimitSec: turnSec.value, start: autoStart.value })))
const addBots = () => run('봇 추가', async () => emit('open', { room: await api('POST', `/dev/rooms/${props.room.id}/bots`, { count: 1 }) }))
const addMember = () => run('테스트 계정 입장', async () => emit('open', { room: await api('POST', `/dev/rooms/${props.room.id}/members`, { slot: memberSlot.value, ready: false }) }))
const readyAll = () => run('전체 준비', async () => emit('open', { room: await api('POST', `/dev/rooms/${props.room.id}/ready-all`) }))
const forceStart = () => run('강제 시작', async () => emit('open', await api('POST', `/dev/rooms/${props.room.id}/force-start`)))
const finish = () => run('종료 시뮬레이션', async () => emit('open', { match: await api('POST', `/dev/matches/${props.match.id}/finish`) }))
const reset = () => run('테스트 데이터 초기화', async () => {
  await api('POST', '/dev/reset', { accounts: false })
  emit('reset')
})
</script>
<template>
  <details class="dev-panel" :open="startOpen">
    <summary>DEV 테스트 패널 <small>TEST_MODE · 개발 빌드 전용</small></summary>
    <fieldset>
      <legend>테스트 계정 간편 접속</legend>
      <label>계정 <select v-model.number="slot"><option v-for="n in 6" :key="n" :value="n">#{{ n }} {{ status?.accounts?.find(a => a.slot === n)?.nickname ?? '(새 계정)' }}</option></select></label>
      <input v-model="nickname" maxlength="24" placeholder="사원명(선택)" aria-label="테스트 사원명">
      <input v-model="department" maxlength="30" placeholder="부서(선택)" aria-label="테스트 부서">
      <button class="primary" :disabled="busy" @click="signIn">접속</button>
      <small>다른 계정은 다른 브라우저 프로필/시크릿 창에서 접속해 동시에 조작할 수 있습니다.</small>
    </fieldset>
    <fieldset v-if="user">
      <legend>테스트 방</legend>
      <label>정원 <select v-model.number="capacity"><option v-for="n in [2,3,4,5,6]" :key="n" :value="n">{{ n }}</option></select></label>
      <label>봇 <select v-model.number="bots"><option v-for="n in 6" :key="n - 1" :value="n - 1">{{ n - 1 }}</option></select></label>
      <label>턴 <select v-model.number="turnSec"><option v-for="n in [5,10,30,60,180,300]" :key="n" :value="n">{{ n < 60 ? n + '초' : n / 60 + '분' }}</option></select></label>
      <label><input v-model="autoStart" type="checkbox"> 바로 시작</label>
      <button :disabled="busy" @click="createRoom">테스트 방 생성</button>
    </fieldset>
    <fieldset v-if="user && room">
      <legend>현재 방 · {{ room.name }}</legend>
      <button :disabled="busy || room.status !== 'WAITING'" @click="addBots">가상 인원 +1</button>
      <label>계정 <select v-model.number="memberSlot"><option v-for="n in 6" :key="n" :value="n">#{{ n }}</option></select></label>
      <button :disabled="busy || room.status !== 'WAITING'" @click="addMember">테스트 계정 입장</button>
      <button :disabled="busy || room.status !== 'WAITING'" @click="readyAll">전체 준비</button>
      <button :disabled="busy || room.status !== 'WAITING'" @click="forceStart">게임 강제 시작</button>
      <button :disabled="busy || match?.status !== 'ACTIVE'" @click="finish">종료 시뮬레이션</button>
    </fieldset>
    <fieldset v-if="user">
      <legend>데이터</legend>
      <button :disabled="busy" @click="reset">테스트 데이터 초기화</button>
      <small>테스트 방·게임만 삭제(실제 사용자 데이터 유지). 재화·아이템 지급, 회사 승인 자동화는 서버 기능 미구현.</small>
    </fieldset>
    <p role="status">{{ note }}</p>
  </details>
</template>
