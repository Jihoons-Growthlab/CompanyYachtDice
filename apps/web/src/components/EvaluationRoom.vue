<script setup>
// 평가실(게임 대기실). 서버 방 스냅샷을 그대로 표시하고 변경은 모두 서버 API 로 요청한다.
// 실시간 변경(다른 참여자의 준비·입장·퇴장)은 상위(App)가 소켓 room:state 로 room prop 을 갱신한다.
import { computed, ref } from 'vue'
import { api } from '../api.js'
import { formatLimit } from '../rules.js'

const props = defineProps({ room: { type: Object, required: true }, meId: { type: String, required: true } })
const emit = defineEmits(['update', 'started', 'left', 'help'])
const TURN_OPTIONS = [60, 120, 180, 240, 300] // 1–5분(서버 정책과 동일, 검증은 서버)
const notice = ref('')
const busy = ref(false)

const me = computed(() => props.room.members.find(member => member.userId === props.meId))
const leader = computed(() => props.room.ownerId === props.meId)
const waiting = computed(() => props.room.status === 'WAITING')
const notReady = computed(() => props.room.members.filter(member => !member.isOwner && !member.ready))
const reasons = computed(() => props.room.start.blockers.map(code => ({
  NOT_ENOUGH_PLAYERS: `최소 ${props.room.start.minPlayers}명의 참석자가 필요합니다.`,
  NOT_ALL_READY: `준비 대기: ${notReady.value.map(member => member.nickname).join(', ')}`,
  OVER_CAPACITY: '참석 인원이 정원을 초과했습니다.',
  NOT_WAITING: '이미 평가가 진행 중입니다.',
}[code] ?? code)))

async function act(fn, done) {
  if (busy.value) return
  busy.value = true
  notice.value = ''
  try {
    const result = await fn()
    done?.(result)
  } catch (err) {
    notice.value = err.message
  } finally {
    busy.value = false
  }
}
const canBots = computed(() => leader.value && waiting.value && props.room.botsAllowed && props.room.members.length < props.room.capacity)
const addBot = () => act(() => api('POST', `/rooms/${props.room.id}/bots`), room => emit('update', room))
const removeBot = id => act(() => api('DELETE', `/rooms/${props.room.id}/bots/${id}`), room => emit('update', room))

// 사원 검색·참석 요청(초대). 대상은 실시간 알림을 받고 수락하면 서버가 정원·상태를 다시 검사해 입장시킨다.
const query = ref('')
const found = ref([])
let searchTimer
function search() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => {
    const q = query.value.trim()
    if (!q) return void (found.value = [])
    try {
      found.value = (await api('GET', `/users/search?q=${encodeURIComponent(q)}`)).items.filter(u => !props.room.members.some(m => m.userId === u.userId))
    } catch (err) {
      notice.value = err.message
    }
  }, 250)
}
const invite = user => act(() => api('POST', `/rooms/${props.room.id}/invites`, { targetUserId: user.userId }), () => {
  notice.value = `${user.nickname} 님에게 참석 요청을 보냈습니다. 수락하면 자동으로 입장합니다.`
  found.value = found.value.filter(u => u.userId !== user.userId)
})

const setReady = ready => act(() => api('POST', `/rooms/${props.room.id}/ready`, { ready }), room => emit('update', room))
const setOption = body => act(() => api('PATCH', `/rooms/${props.room.id}`, body), room => emit('update', room))
const begin = () => act(() => api('POST', `/rooms/${props.room.id}/start`), result => { emit('update', result.room); emit('started', result.match) })
const leave = () => act(() => api('POST', `/rooms/${props.room.id}/leave`), () => emit('left'))
</script>
<template>
  <section class="panel">
    <p class="eyebrow">프로젝트 운영　｜　평가 개시 전 참석 확인</p><h1>{{ room.name }}</h1>
    <p>프로젝트 리더 <strong>{{ room.members.find(member => member.isOwner)?.nickname }} · PL</strong>　　참석 {{ room.members.length }} / {{ room.capacity }}명<span v-if="room.isTest" class="badge">테스트</span><span v-if="room.isPrivate" class="badge">비공개 · 입장 코드 <strong class="join-code">{{ room.joinCode }}</strong></span></p>
    <div class="room-options">
      <label>평가실 정원 <select :value="room.capacity" :disabled="!leader || !waiting || busy" aria-label="평가실 정원" @change="setOption({ capacity: Number($event.target.value) })"><option v-for="size in [2,3,4,5,6]" :key="size" :value="size" :disabled="size < room.members.length">{{ size }}명</option></select></label>
      <span class="segment-label" id="turn-limit-label">턴 제한시간</span>
      <div class="segmented" role="radiogroup" aria-labelledby="turn-limit-label">
        <button v-for="sec in TURN_OPTIONS" :key="sec" role="radio" :aria-checked="room.turnTimeLimitSec === sec" :disabled="!leader || !waiting || busy" v-help="leader ? '모든 참여자에게 같은 턴 제한시간을 적용합니다.' : 'PL만 변경할 수 있습니다.'" @click="setOption({ turnTimeLimitSec: sec })">{{ formatLimit(sec) }}</button>
        <span v-if="!TURN_OPTIONS.includes(room.turnTimeLimitSec)" class="badge">테스트 {{ formatLimit(room.turnTimeLimitSec) }}</span>
      </div>
    </div>
    <div class="grid"><table><thead><tr><th>좌석</th><th>사원명</th><th>직급</th><th>담당 부서</th><th>역할</th><th>참여 상태</th></tr></thead><tbody>
      <tr v-for="(member, index) in room.members" :key="member.userId" :class="{ selected: member.userId === meId }">
        <td>{{ index + 1 }}</td>
        <td>{{ member.nickname }}<small v-if="member.userId === meId"> (나)</small><small v-if="!member.online" class="offline"> · 미접속</small></td>
        <td>{{ member.rankLabel }}</td>
        <td>{{ member.departmentLabel }}</td>
        <td>{{ member.isOwner ? '프로젝트 리더 · PL' : member.isBot ? '가상 참여자 · 봇' : '프로젝트 참여자' }}</td>
        <td>{{ member.isOwner ? '개시 권한 보유' : member.ready ? '준비 완료' : '준비 대기' }}<button v-if="member.isBot && leader && waiting" class="row-action" :disabled="busy" @click="removeBot(member.userId)" v-help="'이 봇을 평가실에서 제외합니다.'">제외</button></td>
      </tr>
      <tr v-for="slot in Math.max(0, room.capacity - room.members.length)" :key="'empty-' + slot"><td>{{ room.members.length + slot }}</td><td colspan="5">참석자 미배정</td></tr>
    </tbody></table></div>
    <div v-if="leader && waiting" class="invite-tools">
      <label>사원 초대 <input v-model="query" maxlength="24" placeholder="사원명 검색" aria-label="초대할 사원 검색" @input="search"></label>
      <button v-if="canBots" :disabled="busy" @click="addBot" v-help="'가상 참여자(봇)를 추가합니다. 봇은 자동으로 준비하고 자기 차례를 진행합니다.'">봇 추가</button>
      <span v-else-if="!room.botsAllowed" class="document-note">봇 비허용 평가실</span>
      <ul v-if="found.length" class="search-results"><li v-for="u in found" :key="u.userId"><span :class="['dot', { on: u.online }]" :aria-label="u.online ? '접속 중' : '미접속'"></span>{{ u.nickname }} · {{ u.departmentLabel }}<button :disabled="busy || room.members.length >= room.capacity" @click="invite(u)">참석 요청</button></li></ul>
      <p v-else-if="query.trim()" class="document-note">검색 결과가 없습니다.</p>
    </div>
    <p class="document-note">참여 방법: 평가운영대장에서 이 문서 열기{{ room.isPrivate ? '(입장 코드 필요)' : '' }} 또는 PL의 참석 요청 수락.</p>
    <p role="status">{{ notice }}</p>
    <div class="room-actions">
      <button v-if="!leader && me && waiting" :disabled="busy" @click="setReady(!me.ready)" v-help="'게임 준비 상태를 변경합니다. 준비를 해제하면 방장이 시작할 수 없습니다.'">{{ me.ready ? '준비 철회' : '참여 준비 완료' }}</button>
      <button v-if="leader" class="primary" :disabled="!room.start.canStart || busy" @click="begin" v-help="'최소 2명, PL 외 전원 준비 완료일 때 게임을 시작합니다.'">평가 개시</button>
      <button :disabled="busy" @click="leave" v-help="'평가실에서 나갑니다. PL이 나가면 다음 참여자에게 권한이 넘어갑니다.'">평가실 나가기</button>
      <button class="guide-btn" @click="emit('help')" v-help="'평가 규정과 점수 산정 기준을 미리 봅니다.'"><span class="guide-title"><span aria-hidden="true">📋</span> 평가 양식 안내</span></button>
      <p v-if="room.start.canStart">참석자 준비 완료 · PL이 평가를 개시할 수 있습니다.</p>
      <ul v-else class="start-reasons" aria-label="시작할 수 없는 이유"><li v-for="reason in reasons" :key="reason">{{ reason }}</li></ul>
    </div>
  </section>
</template>
