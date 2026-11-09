<script setup>
// 방 채팅(메신저형). 메시지는 텍스트로만 렌더링한다({{ }} 보간 — HTML 해석 없음).
// 전송·재전송은 상위(App)가 같은 clientMessageId 로 처리하므로 중복 저장되지 않는다.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  messages: { type: Array, required: true },
  meId: { type: String, required: true },
  connected: { type: Boolean, default: true },
})
const emit = defineEmits(['send', 'retry'])
const draft = ref('')
const list = ref(null)
const atBottom = ref(true)
const unread = ref(0)
const collapsed = ref(false)
// 접기는 좁은 화면에서만 적용(넓은 화면에서는 토글 버튼이 없으므로 항상 펼침)
const mq = typeof window !== 'undefined' ? window.matchMedia('(max-width: 1023px)') : null
const narrow = ref(!!mq?.matches)
const onMq = e => (narrow.value = e.matches)
mq?.addEventListener('change', onMq)
onBeforeUnmount(() => mq?.removeEventListener('change', onMq))
const hidden = computed(() => collapsed.value && narrow.value)
const MAX = 300
const length = computed(() => [...draft.value.trim()].length)

const time = iso => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
function onScroll() {
  const el = list.value
  atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  if (atBottom.value) unread.value = 0
}
function toBottom() {
  const el = list.value
  if (el) el.scrollTop = el.scrollHeight
  unread.value = 0
}
// 새 메시지: 맨 아래를 보고 있거나 내가 보낸 것이면 따라 내려가고, 이전 메시지를 읽는 중이면 위치 유지 + 알림
watch(() => props.messages.length, async (n, old) => {
  const last = props.messages[props.messages.length - 1]
  const mine = last?.userId === props.meId || last?.pending
  await nextTick()
  if (atBottom.value || mine || !old) toBottom()
  else if (n > old) unread.value += n - old
})
function onKey(e) {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return // Shift+Enter 줄바꿈, 한글 조합 중 무시
  e.preventDefault()
  submit()
}
function submit() {
  const text = draft.value.trim()
  if (!text || length.value > MAX) return
  emit('send', text)
  draft.value = ''
}
</script>
<template>
  <aside class="panel room-chat" :class="{ collapsed: hidden }" aria-label="평가실 메신저">
    <header class="chat-head">
      <p class="eyebrow">사내 메신저　｜　검토 의견</p>
      <button class="chat-toggle" :aria-expanded="!collapsed" @click="collapsed = !collapsed">{{ collapsed ? '메신저 열기' : '접기' }}<span v-if="collapsed && unread" class="badge">{{ unread }}</span></button>
    </header>
    <template v-if="!hidden">
      <ol ref="list" class="chat-list" aria-live="polite" @scroll="onScroll">
        <li v-if="!messages.length" class="chat-empty">아직 대화가 없습니다. 첫 의견을 남겨 보세요.</li>
        <li v-for="m in messages" :key="m.id ?? m.clientMessageId" :class="['chat-item', m.kind === 'SYSTEM' ? 'system' : m.userId === meId || m.pending ? 'mine' : 'other', { failed: m.failed }]">
          <template v-if="m.kind === 'SYSTEM'"><span class="chat-system">{{ m.text }}</span><time>{{ time(m.createdAt) }}</time></template>
          <template v-else>
            <div v-if="m.userId !== meId && !m.pending" class="chat-meta"><strong>{{ m.nickname }}</strong><span v-if="m.rankLabel" class="chat-rank">{{ m.rankLabel }}</span></div>
            <div class="chat-bubble">{{ m.text }}</div>
            <div class="chat-foot">
              <time>{{ time(m.createdAt) }}</time>
              <span v-if="m.pending && !m.failed">전송 중…</span>
              <span v-if="m.failed" role="alert">전송 실패 · {{ m.error }} <button @click="emit('retry', m)">다시 보내기</button></span>
            </div>
          </template>
        </li>
      </ol>
      <button v-if="unread" class="chat-jump" @click="toBottom">새 메시지 {{ unread }}개 ↓</button>
      <form class="chat-form" @submit.prevent="submit">
        <textarea v-model="draft" rows="2" maxlength="600" aria-label="채팅 메시지" placeholder="메시지 입력 · Enter 전송 · Shift+Enter 줄바꿈" @keydown="onKey"></textarea>
        <div class="chat-actions"><small :class="{ over: length > MAX }">{{ length }}/{{ MAX }}</small><small v-if="!connected">연결 끊김 — 재연결 후 전송됩니다</small><button class="primary" :disabled="!draft.trim() || length > MAX" v-help="'현재 평가실 참여자 모두에게 메시지를 보냅니다.'">전송</button></div>
      </form>
    </template>
  </aside>
</template>
