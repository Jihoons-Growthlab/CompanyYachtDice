<script setup>
import { computed, ref } from 'vue'
const props = defineProps({ employee: String, department: String })
const search = ref('')
const view = ref('directory')
const notice = ref('')
const companyName = ref('')
const invitee = ref('me')
const actor = ref('me')
const leaving = ref(false)
const successor = ref('')
const stages = [
  { name: '스타트업', revenue: 0, cost: 0 },
  { name: '중소기업', revenue: 1000, cost: 300 },
  { name: '중견기업', revenue: 5000, cost: 1000 },
  { name: '대기업', revenue: 15000, cost: 3000 },
]
const nextStage = computed(() => mine.value ? stages[mine.value.level + 1] : null)
const exitLoss = computed(() => Math.min(100, mine.value?.capital ?? 0))
function upgrade() {
  const company = managed.value
  const stage = nextStage.value
  if (!company || !stage || company.revenue < stage.revenue || company.capital < stage.cost) return
  company.capital -= stage.cost
  company.expenses += stage.cost
  company.level++
  company.history.unshift('기업 승격 · ' + stage.name + ' · -' + stage.cost + 'P')
  notice.value = stage.name + '으로 승격했습니다.'
}
function simulateRevenue() {
  if (!mine.value) return
  mine.value.revenue += 500
  mine.value.capital += 500
  mine.value.history.unshift('모의 프로젝트 정산 · 매출 +500P')
}
function transfer() {
  if (!managed.value || !managed.value.members.includes(successor.value) || successor.value === actor.value) return
  managed.value.owner = successor.value
  successor.value = ''
  notice.value = '대표 권한을 이관했습니다.'
}
function resign() {
  const company = mine.value
  if (!company || company.owner === actor.value) return
  const loss = exitLoss.value
  company.capital -= loss
  company.expenses += loss
  company.members = company.members.filter(id => id !== actor.value)
  company.history.unshift(personLabel(actor.value) + ' 퇴사 · 회사 손실 -' + loss + 'P')
  leaving.value = false
  notice.value = '퇴사 처리 완료 · 회사 자본금 ' + loss + 'P 차감'
  view.value = 'directory'
}
const companies = ref([
  { id: 1, name: '오피스요트', owner: 'owner1', score: 2840, members: ['owner1'] },
  { id: 2, name: '주식회사 칼퇴', owner: 'owner2', score: 2190, members: ['owner2'] },
  { id: 3, name: '월요일 연구소', owner: 'owner3', score: 1750, members: ['owner3'] },
].map((company, index) => ({ ...company, level: 2 - index, capital: 2000 - index * 500, revenue: 6000 - index * 2000, expenses: 0, history: ['기초 재무 잔액 등록'] })))
const people = computed(() => [
  { id: 'me', name: props.employee },
  { id: 'guest', name: '신입사원 이지우' },
  { id: 'owner1', name: '오피스요트 대표' },
])
const requests = ref([])
const invitations = ref([])
const membership = id => companies.value.find(company => company.members.includes(id))
const mine = computed(() => membership(actor.value))
const managed = computed(() => companies.value.find(company => company.owner === actor.value))
const ranking = computed(() => [...companies.value].sort((a, b) => b.score - a.score))
const visible = computed(() => ranking.value.filter(company => company.name.toLowerCase().includes(search.value.trim().toLowerCase())))
const inbox = computed(() => invitations.value.filter(invite => invite.to === actor.value && invite.status === 'pending'))
const applicants = computed(() => requests.value.filter(request => request.company === managed.value?.id && request.status === 'pending'))
const companyLabel = id => companies.value.find(company => company.id === id)?.name
const personLabel = id => people.value.find(person => person.id === id)?.name ?? id
function apply(company) {
  if (membership(actor.value)) { notice.value = '이미 회사에 소속되어 있습니다.'; return }
  if (requests.value.some(request => request.from === actor.value && request.company === company.id && request.status === 'pending')) return
  requests.value.push({ from: actor.value, company: company.id, status: 'pending' })
  notice.value = company.name + '에 가입 신청을 보냈습니다.'
}
function join(company, person) {
  if (membership(person)) { notice.value = '이미 소속된 회사가 있어 처리할 수 없습니다.'; return false }
  company.members.push(person)
  company.history.unshift(personLabel(person) + ' 입사')
  for (const request of requests.value.filter(item => item.from === person && item.status === 'pending')) request.status = 'closed'
  for (const invitation of invitations.value.filter(item => item.to === person && item.status === 'pending')) invitation.status = 'closed'
  notice.value = personLabel(person) + ' 님의 회사 가입이 완료되었습니다.'
  return true
}
function approve(request, accept) {
  if (!managed.value || request.company !== managed.value.id || request.status !== 'pending') return
  if (!accept) { request.status = 'rejected'; notice.value = '가입 신청을 반려했습니다.'; return }
  if (join(managed.value, request.from)) request.status = 'accepted'
}
function invite() {
  if (!managed.value) return
  if (membership(invitee.value)) { notice.value = '이미 회사에 소속된 사원입니다.'; return }
  if (invitations.value.some(item => item.company === managed.value.id && item.to === invitee.value && item.status === 'pending')) { notice.value = '이미 초대를 보냈습니다.'; return }
  invitations.value.push({ company: managed.value.id, to: invitee.value, status: 'pending' })
  notice.value = personLabel(invitee.value) + ' 님에게 초대를 보냈습니다.'
}
function acceptInvite(invitation, accept) {
  if (invitation.to !== actor.value || invitation.status !== 'pending') return
  if (!accept) { invitation.status = 'declined'; notice.value = '초대를 거절했습니다.'; return }
  const company = companies.value.find(item => item.id === invitation.company)
  if (join(company, actor.value)) invitation.status = 'accepted'
}
function establish() {
  const name = companyName.value.trim()
  if (!name || membership(actor.value)) return
  if (companies.value.some(company => company.name === name)) { notice.value = '이미 등록된 회사명입니다.'; return }
  companies.value.push({ id: Math.max(...companies.value.map(company => company.id)) + 1, name, owner: actor.value, score: 0, members: [actor.value], level: 0, capital: 500, revenue: 0, expenses: 0, history: ['설립 지원금 +500P'] })
  companyName.value = ''
  notice.value = '회사를 설립했습니다. 대표 관리에서 사원을 초대할 수 있습니다.'
}
</script>

<template>
  <section class="panel company-directory">
    <p class="eyebrow">조직관리　｜　회사 연합 및 인사 교류</p><h1>회사 등록 및 소속 관리</h1>
    <p>{{ employee }} · {{ department }}　|　현재 시점의 소속　<strong>{{ mine?.name ?? '미소속' }}</strong></p>
    <details class="mock-controls"><summary>목업 시점 전환 · 초대와 승인 체험</summary>
      <label>체험 인물 <select v-model="actor" @change="notice = ''; leaving = false"><option v-for="person in people" :value="person.id" :key="person.id">{{ person.name }}</option></select></label>
      <p>대표가 초대하거나 가입 신청을 승인한 뒤 사원 시점으로 돌아와 결과를 확인하세요. 모든 상태는 이 브라우저의 목업 데이터입니다.</p>
    </details>
    <nav class="auth-tabs"><button @click="view = 'directory'" v-help="'클랜 목록을 검색하고 가입할 회사를 찾습니다.'">등록회사 조회</button><button @click="view = 'ranking'" v-help="'클랜의 누적 점수와 순위를 확인합니다.'">회사 실적 순위</button><button @click="view = 'inbox'" v-help="'클랜 대표가 보낸 초대를 확인합니다.'">수신 초대 ({{ inbox.length }})</button><button v-if="managed" @click="view = 'manage'" v-help="'클랜 대표가 가입 신청과 초대를 관리합니다.'">대표 관리</button></nav>
    <p role="status">{{ notice }}</p>
    <section v-if="mine" class="company-finance">
      <h2>{{ mine.name }} · {{ stages[mine.level].name }} 경영 현황</h2>
      <div class="grid"><table><thead><tr><th>회사 자본금</th><th>누적 매출액</th><th>누적 지출</th><th>재직 인원</th></tr></thead><tbody><tr><td>{{ mine.capital.toLocaleString() }} P</td><td>{{ mine.revenue.toLocaleString() }} P</td><td>{{ mine.expenses.toLocaleString() }} P</td><td>{{ mine.members.length }}명</td></tr></tbody></table></div>
      <p class="document-note">목업 초안 · 자본금은 회사가 사용할 수 있는 가상 운영 잔액입니다. 설립 지원금 500P, 매출 정산 시 잔액 증가, 승격·퇴사 비용 차감.</p>
      <template v-if="nextStage">
        <p>다음 단계 {{ nextStage.name }} · 누적 매출 {{ mine.revenue.toLocaleString() }} / {{ nextStage.revenue.toLocaleString() }}P · 승격 비용 {{ nextStage.cost.toLocaleString() }}P</p>
        <button v-if="managed" :disabled="mine.revenue < nextStage.revenue || mine.capital < nextStage.cost" @click="upgrade" v-help="'매출 조건을 충족하고 회사 자금을 사용해 기업 등급을 올립니다.'">기업 승격 심사</button>
      </template>
      <p v-else>최고 기업 단계에 도달했습니다.</p>
      <details class="mock-controls"><summary>경영 목업 시뮬레이션</summary><button @click="simulateRevenue" v-help="'실제 경기와 별도로 회사 매출과 잔액에 500P를 더하는 시연입니다.'">프로젝트 매출 정산 +500P</button><p>게임 실적과 매출의 실제 연동·정산 기준은 추후 확정합니다.</p></details>
      <details><summary>회사 재무·인사 이력</summary><ul><li v-for="(event, index) in mine.history" :key="index">{{ event }}</li></ul></details>
      <div v-if="managed">
        <p>대표는 후임에게 권한을 이관한 뒤 퇴사할 수 있습니다.</p>
        <label>후임 대표 <select v-model="successor"><option value="">사원 선택</option><option v-for="id in mine.members.filter(id => id !== actor)" :key="id" :value="id">{{ personLabel(id) }}</option></select></label>
        <button :disabled="!successor" @click="transfer" v-help="'선택한 사원에게 회사 대표 권한을 넘깁니다.'">대표 권한 이관</button>
      </div>
      <button v-else @click="leaving = true" v-help="'퇴사 전 회사 자본금 손실을 확인합니다.'">퇴사 신청</button>
      <div v-if="leaving && !managed" class="auth-message">
        <strong>퇴사 처리 확인</strong><p>회사 자본금 {{ exitLoss }}P 손실 · 처리 후 잔액 {{ mine.capital - exitLoss }}P. 확정하면 소속에서 제외됩니다.</p>
        <button @click="leaving = false">신청 취소</button><button @click="resign">퇴사 확정</button>
      </div>
    </section>
    <template v-if="view === 'directory' || view === 'ranking'">
      <label>회사 검색 <input v-model="search" placeholder="회사명 검색"></label>
      <p v-if="view === 'ranking'" class="document-note">시즌 누적 점수 기준 · 목업 순위</p>
      <div class="grid"><table><thead><tr><th>순위</th><th>회사명</th><th>기업 규모</th><th>사원 수</th><th>누적 점수</th><th>가입 처리</th></tr></thead><tbody>
        <tr v-for="company in visible" :key="company.id"><td>{{ ranking.findIndex(item => item.id === company.id) + 1 }}</td><td>{{ company.name }}</td><td>{{ stages[company.level].name }}</td><td>{{ company.members.length }}</td><td>{{ company.score }}</td><td><button :disabled="!!mine || requests.some(item => item.from === actor && item.company === company.id && item.status === 'pending')" v-help="'이 회사 클랜에 가입을 신청합니다. 대표 승인이 필요합니다.'" @click="apply(company)">{{ mine?.id === company.id ? '소속 회사' : requests.some(item => item.from === actor && item.company === company.id && item.status === 'pending') ? '승인 대기' : '가입 신청' }}</button></td></tr>
      </tbody></table></div>
      <p v-if="!visible.length">검색 결과가 없습니다.</p>
      <form v-if="!mine" @submit.prevent="establish"><input v-model="companyName" maxlength="40" placeholder="설립할 회사명" aria-label="설립할 회사명" required><button :disabled="!companyName.trim()" v-help="'새 클랜을 만들고 대표가 됩니다.'">회사 설립</button></form>
    </template>
    <template v-else-if="view === 'inbox'">
      <h2>입사 초대 수신함</h2><p v-if="!inbox.length">수신한 초대가 없습니다.</p>
      <div v-for="invitation in inbox" :key="invitation.company" class="invite-row"><span>{{ companyLabel(invitation.company) }} 대표의 입사 초대</span><button v-help="'초대를 수락하고 해당 회사 클랜에 가입합니다.'" @click="acceptInvite(invitation, true)">초대 수락</button><button @click="acceptInvite(invitation, false)" v-help="'이 클랜의 초대를 거절합니다.'">거절</button></div>
    </template>
    <template v-else-if="managed">
      <h2>{{ managed.name }} · 대표 관리</h2>
      <form @submit.prevent="invite"><label>초대할 사원 <select v-model="invitee"><option v-for="person in people.filter(item => item.id !== actor)" :key="person.id" :value="person.id">{{ person.name }}</option></select></label><button v-help="'선택한 사원에게 클랜 가입 초대를 보냅니다.'">입사 초대 발송</button></form>
      <h2>가입 승인 대기</h2><p v-if="!applicants.length">대기 중인 신청이 없습니다.</p>
      <div v-for="request in applicants" :key="request.from" class="invite-row"><span>{{ personLabel(request.from) }}</span><button v-help="'이 사원의 클랜 가입을 승인합니다.'" @click="approve(request, true)">가입 승인</button><button @click="approve(request, false)" v-help="'이 사원의 가입 신청을 반려합니다.'">반려</button></div>
      <h2>소속 사원</h2><ul><li v-for="member in managed.members" :key="member">{{ personLabel(member) }} {{ member === managed.owner ? '· 대표' : '· 사원' }}</li></ul>
    </template>
  </section>
</template>
