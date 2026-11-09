<script setup>
// 게임 안내(매뉴얼). mode='briefing': 게임 시작 직후 안내 단계(확인·건너뛰기 → 서버에 확인 전송)
//                   mode='help': 언제든 여는 도움말(서버 상태에 영향 없음)
import { computed, ref } from 'vue'
import { categories } from '../../../../packages/shared/scoring.mjs'
import { CATEGORY_INFO, formatClock, formatLimit, guideSkipped, setGuideSkipped } from '../rules.js'

const props = defineProps({
  mode: { type: String, default: 'help' },
  turnTimeLimitSec: { type: Number, default: 180 },
  players: { type: Array, default: () => [] },
  meId: { type: String, default: '' },
  remainingSec: { type: Number, default: null },
  sent: { type: Boolean, default: false },
})
const emit = defineEmits(['done', 'close'])
const dontShow = ref(guideSkipped())
const briefedCount = computed(() => props.players.filter(p => p.briefed).length)
function finish(skipped) {
  setGuideSkipped(dontShow.value)
  emit('done', { skipped })
}
</script>
<template>
  <div class="modal-backdrop guide-backdrop" @click.self="mode === 'help' && emit('close')">
    <section class="payment-dialog game-guide" role="dialog" aria-modal="true" aria-labelledby="guide-title" @keydown.esc="mode === 'help' && emit('close')">
      <p class="eyebrow"><span aria-hidden="true">📋</span> 업무 매뉴얼　｜　평가 규정 및 점수 산정 기준</p>
      <h2 id="guide-title">평가 양식 안내</h2>
      <p class="guide-sub">{{ mode === 'briefing' ? '평가를 시작하기 전에 진행 절차와 점수 산정 기준을 확인해 주세요.' : '평가 진행 절차 · 표본 고정 · 평가 점수 등록 방법' }}</p>
      <p v-if="mode === 'briefing'" class="guide-wait" role="status">
        모든 참여자가 안내를 확인하면 첫 턴이 시작됩니다. 지금은 <strong>턴 타이머가 멈춰 있습니다.</strong>
        <span>확인 {{ briefedCount }} / {{ players.length }}명<template v-if="remainingSec !== null"> · {{ formatClock(remainingSec) }} 후 자동 시작</template></span>
      </p>
      <ol class="guide-steps">
        <li><strong>목적</strong> 주사위 5개로 12개 평가 항목을 한 번씩 채워 <strong>총점이 가장 높은 사원</strong>이 이깁니다. 동점은 공동 순위입니다.</li>
        <li><strong>표본 산출 (주사위 굴리기)</strong> 내 차례에 주사위 5개를 굴립니다. 한 턴에 <strong>최대 3번</strong>까지 굴릴 수 있습니다.</li>
        <li><strong>표본 고정 (주사위 보관)</strong> 남기고 싶은 주사위를 누르면 고정됩니다(다시 누르면 해제). <strong>재산출</strong>하면 고정하지 않은 주사위만 다시 굴러갑니다.</li>
        <li><strong>평가 항목 선택</strong> 점수표의 <em>+점수</em> 칸에서 기록할 항목을 고르면 예상 점수와 계산 근거가 표시됩니다. 0점도 기록할 수 있습니다.</li>
        <li><strong>평가 확정</strong> [○○ N점 확정]을 눌러야 기록되고 턴이 끝납니다. 기록한 항목은 수정할 수 없습니다.</li>
        <li><strong>종료</strong> 모두 12개 항목을 기록하면 끝나고 순위가 발표됩니다. 상단 6개 항목 합이 63점 이상이면 <strong>보너스 35점</strong>.</li>
        <li><strong>시간</strong> 턴 제한시간은 <strong>{{ formatLimit(turnTimeLimitSec) }}</strong>입니다. 시간이 지나면 서버가 한 번 굴리고 가장 높은 칸에 기록하며, 연속 2번이면 자리 비움(자동 진행)으로 바뀝니다. 직접 조작하면 다시 수동이 됩니다.</li>
      </ol>
      <details class="guide-table">
        <summary>점수 항목별 계산 방법 보기</summary>
        <table><thead><tr><th>항목</th><th>계산</th><th>예시</th></tr></thead><tbody>
          <tr v-for="[key, label] in categories" :key="key"><th scope="row">{{ label }} <small>{{ CATEGORY_INFO[key].en }}</small></th><td>{{ CATEGORY_INFO[key].rule }}</td><td>{{ CATEGORY_INFO[key].example }}</td></tr>
        </tbody></table>
      </details>
      <div v-if="mode === 'briefing'" class="guide-actions">
        <label><input v-model="dontShow" type="checkbox"> 다음부터 안내 다시 보지 않기 (이 브라우저)</label>
        <button :disabled="sent" @click="finish(true)">설명 건너뛰기</button>
        <button class="primary" :disabled="sent" @click="finish(false)">{{ sent ? '다른 참여자 기다리는 중…' : '설명 확인 완료 · 준비됨' }}</button>
      </div>
      <div v-else class="guide-actions"><button class="primary" @click="emit('close')">닫기</button></div>
    </section>
  </div>
</template>
