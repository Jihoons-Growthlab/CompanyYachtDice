<script setup>
// 환경 설정(개인). 열고 닫아도 게임 상태와 무관하며, 변경은 즉시 화면에 반영된다(저장은 prefs.js).
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { prefs, retrySave, saveError, saveState, update } from '../prefs.js'
import { playSound } from '../sound.js'

const props = defineProps({ loggedIn: Boolean })
const emit = defineEmits(['close'])
const root = ref(null)
const onKey = e => e.key === 'Escape' && emit('close')
onMounted(() => {
  window.addEventListener('keydown', onKey)
  root.value?.querySelector('button, input')?.focus()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const groups = [
  { title: '화면', items: [
    { key: 'uiMode', label: 'UI 모드', options: [['EXCEL', '엑셀'], ['CMD', 'CMD']], help: '엑셀 업무 문서 / 명령 프롬프트 화면' },
    { key: 'uiScale', label: 'UI 크기', options: [['SMALL', '작게'], ['NORMAL', '보통'], ['LARGE', '크게']] },
    { key: 'reducedMotion', label: '애니메이션 축소', options: [[true, 'ON'], [false, 'OFF']], help: '화면 움직임을 최소화합니다' },
    { key: 'ribbonCollapsed', label: '게임 중 리본 접기', options: [[true, 'ON'], [false, 'OFF']], help: '게임 화면에서 상단 메뉴·도구 모음을 숨겨 공간을 확보합니다' },
  ] },
  { title: '게임 연출', note: '내 화면에만 적용됩니다. 턴 제한시간(방장 설정)이나 봇 진행 속도(서버)는 바뀌지 않습니다.', items: [
    { key: 'effectSpeed', label: '진행 연출 속도', options: [['FAST', '빠르게'], ['NORMAL', '보통'], ['SLOW', '느리게']], help: '주사위 애니메이션·알림 표시 시간' },
    { key: 'diceAnimation', label: '주사위 애니메이션', options: [[true, 'ON'], [false, 'OFF']] },
    { key: 'turnNotification', label: '턴 시작 알림', options: [[true, 'ON'], [false, 'OFF']] },
  ] },
  { title: '사운드', items: [
    { key: 'soundEnabled', label: '효과음', options: [[true, 'ON'], [false, 'OFF']], help: '내 턴 시작·굴림·평가 확정·새 채팅' },
  ] },
]
const STATE_TEXT = { local: '이 브라우저에 저장됨 (로그인하면 계정에 저장)', saving: '저장 중…', saved: '계정에 저장됨', error: '저장 실패' }
</script>
<template>
  <aside ref="root" class="settings-panel" role="dialog" aria-modal="false" aria-labelledby="settings-title">
    <header class="settings-head">
      <h2 id="settings-title"><span aria-hidden="true">⚙</span> 환경 설정</h2>
      <button class="settings-close" aria-label="환경 설정 닫기" @click="emit('close')">✕</button>
    </header>
    <p class="settings-state" :class="'is-' + saveState" role="status" aria-live="polite">
      {{ STATE_TEXT[saveState] }}<template v-if="saveState === 'error'"> · {{ saveError }} <button @click="retrySave">다시 시도</button></template>
    </p>
    <section v-for="g in groups" :key="g.title" class="settings-group">
      <h3>{{ g.title }}</h3>
      <p v-if="g.note" class="settings-note">{{ g.note }}</p>
      <div v-for="item in g.items" :key="item.key" class="settings-row">
        <span :id="'pref-' + item.key" class="settings-label">{{ item.label }}<small v-if="item.help">{{ item.help }}</small></span>
        <div class="segmented" role="radiogroup" :aria-labelledby="'pref-' + item.key">
          <button v-for="[value, text] in item.options" :key="String(value)" role="radio" :aria-checked="prefs[item.key] === value" :data-pref="item.key + ':' + value" @click="update({ [item.key]: value })">{{ text }}</button>
        </div>
      </div>
      <div v-if="g.title === '사운드'" class="settings-row">
        <label for="pref-volume" class="settings-label">효과음 음량<small>{{ prefs.soundVolume }}%</small></label>
        <div class="volume-row">
          <input id="pref-volume" type="range" min="0" max="100" step="5" :value="prefs.soundVolume" :disabled="!prefs.soundEnabled" :aria-valuetext="prefs.soundVolume + '%'" @change="update({ soundVolume: Number($event.target.value) })">
          <button :disabled="!prefs.soundEnabled" @click="playSound('turn')">미리 듣기</button>
        </div>
      </div>
    </section>
    <p class="settings-foot">{{ props.loggedIn ? '로그인한 계정에 저장되어 다른 PC·브라우저에서도 같은 설정이 적용됩니다.' : '로그인하면 계정에 저장됩니다. 계정에 저장된 설정이 있으면 그 설정이 우선합니다.' }}</p>
  </aside>
</template>
