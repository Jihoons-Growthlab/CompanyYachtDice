// 실제 브라우저(시스템 Google Chrome) 통합 검증. 선행: API(TEST_MODE=true) + 웹 dev 서버 실행.
//   WEB_URL=http://localhost:5173 npm run test:e2e        (HEADED=1 이면 창 표시)
// 컨텍스트 = 독립 브라우저 세션(일반 창·시크릿 창처럼 쿠키·저장소 분리).
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const WEB = process.env.WEB_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED })
const results = []
const step = async (name, fn) => {
  const t = Date.now()
  try {
    await fn()
    results.push(['PASS', name, Date.now() - t])
  } catch (err) {
    results.push(['FAIL', name, Date.now() - t, err.message.split('\n')[0]])
    throw err
  }
}

async function devLogin(slot, ctxOpts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'ko-KR', ...ctxOpts })
  const page = await ctx.newPage()
  page.on('pageerror', e => console.error(`[slot ${slot} pageerror]`, e.message))
  await page.goto(WEB)
  const panel = page.locator('.dev-panel')
  if ((await panel.getAttribute('open')) === null) await panel.locator('summary').click()
  await panel.locator('select').first().selectOption(String(slot))
  await panel.getByRole('button', { name: '접속' }).click()
  await page.getByRole('button', { name: '업무 종료' }).waitFor()
  await page.getByRole('button', { name: '평가운영대장' }).click() // 복원된 방이 있어도 로비에서 시작
  await page.getByText('성과평가 운영대장').waitFor()
  return { ctx, page }
}
const dieValues = async page => (await page.locator('.die .pip-num').allInnerTexts()).map(t => t.trim()).join('')
const myTurn = page => page.locator('.turn-status strong.mine', { hasText: '내 차례' })
const waitMyTurn = page => myTurn(page).waitFor({ timeout: 30_000 })
const settle = page => page.locator('.die.rolling').first().waitFor({ state: 'detached', timeout: 4000 })
async function rollOnce(page, tap = false) {
  const before = Number(await page.locator('.roll-count b').innerText())
  await (tap ? page.locator('.roll-btn').tap() : page.locator('.roll-btn').click())
  await page.locator('.roll-count b', { hasText: String(before + 1) }).waitFor() // 서버 반영 확인
  await settle(page)
}
/** 첫 번째 선택 가능한 항목을 고르고 확정 */
async function scoreFirst(page) {
  await page.locator('.cell.pick').first().click()
  await page.locator('.confirm-btn').click()
  await page.locator('.confirm-panel').waitFor({ state: 'detached' })
}

try {
  // ───────── 1인: 봇 + 안내 + 주사위·점수 UX ─────────
  const solo = await devLogin(1)
  const p = solo.page
  const panel = p.locator('.dev-panel')
  await step('준비: 테스트 데이터 초기화', async () => {
    await panel.getByRole('button', { name: '테스트 데이터 초기화' }).click()
    await panel.locator('[role=status]', { hasText: '초기화 완료' }).waitFor()
  })
  await step('4. 제한시간 1–5분 선택지(기본 3분)', async () => {
    const opts = await p.locator('[aria-label="턴 제한시간"] button').allInnerTexts()
    assert.deepEqual(opts, ['1분', '2분', '3분', '4분', '5분'])
    assert.equal(await p.locator('[aria-label="턴 제한시간"] [aria-checked=true]').innerText(), '3분')
  })
  await step('1인: 테스트 방(봇 3) → 평가 개시', async () => {
    await panel.locator('label:has-text("봇") select').selectOption('3')
    await panel.locator('label:has-text("턴") select').selectOption('180')
    await panel.locator('label:has-text("바로 시작") input').uncheck()
    await panel.getByRole('button', { name: '테스트 방 생성' }).click()
    await p.getByRole('button', { name: '평가 개시' }).click()
  })
  await step('1. 시작 전 설명 화면 등장 · 3. 안내 중 타이머 정지', async () => {
    await p.locator('.game-guide').waitFor()
    await p.getByText('턴 타이머가 멈춰 있습니다').waitFor()
    await p.locator('.timer.paused').waitFor()
    assert.equal(await p.locator('.timer:not(.paused)').count(), 0, '턴 타이머 미표시')
    await p.waitForTimeout(1500)
    assert.equal(await p.locator('.timer:not(.paused)').count(), 0, '1.5초 뒤에도 정지')
  })
  await step('2. 설명 보기(항목별 계산표) → 확인 완료 → 첫 턴 시작', async () => {
    await p.locator('.guide-table summary').click()
    await p.locator('.guide-table td', { hasText: '1이 나온 주사위의 눈 합계' }).waitFor()
    await p.getByRole('button', { name: /설명 확인 완료/ }).click()
    await p.locator('.game-guide').waitFor({ state: 'detached' })
    await p.locator('.timer:not(.paused)', { hasText: /^⏱ [0-3]:\d\d$/ }).waitFor({ timeout: 5000 }) // 분:초
  })
  await step('6. 템포: 봇 턴 시작 시 다음 플레이어가 먼저 표시된 뒤 진행', async () => {
    if (!(await myTurn(p).count())) {
      await p.locator('.turn-status strong', { hasText: /봇 사원 \d 님 차례/ }).waitFor()
      const t0 = Date.now()
      await p.locator('.die .pip-num', { hasText: /[1-6]/ }).first().waitFor({ timeout: 10_000 })
      assert.ok(Date.now() - t0 >= 900, `봇 첫 굴림까지 ${Date.now() - t0}ms (너무 빠르지 않음)`)
    }
    await waitMyTurn(p)
    await p.locator('.next-action.mine', { hasText: '① [표본 산출]' }).waitFor()
  })
  let keep
  await step('5. 주사위 굴리기(1/3) · 6. 보관/해제 · 7. 재굴림 시 보관 유지', async () => {
    assert.ok(await p.locator('.die').first().isDisabled(), '굴리기 전 보관 불가')
    await rollOnce(p)
    assert.equal(await p.locator('.roll-count b').innerText(), '1')
    const d0 = p.locator('.die').nth(0)
    await d0.click()
    await p.locator('.die.held').first().waitFor()
    assert.equal(await d0.getAttribute('aria-pressed'), 'true')
    await d0.click()
    await p.waitForFunction(() => !document.querySelector('.die.held'))
    await d0.click()
    await p.waitForFunction(() => document.querySelectorAll('.die.held').length === 1)
    await p.waitForTimeout(300) // 서버 HOLD 반영
    keep = (await p.locator('.die .pip-num').first().innerText()).trim()
    await rollOnce(p)
    assert.equal(await p.locator('.roll-count b').innerText(), '2')
    assert.equal((await p.locator('.die .pip-num').first().innerText()).trim(), keep, '보관한 주사위 값 유지')
    assert.equal(await p.locator('.die.held').count(), 1)
  })
  await step('8. 점수 미리보기 · 9. 에이스 선택(근거 표시) → 확정 · 10. 다음 턴', async () => {
    assert.equal(await p.locator('.cell.pick').count(), 12, '미기록 12칸 모두 예상 점수')
    const dice = await dieValues(p)
    const ones = [...dice].filter(c => c === '1').length
    await p.locator('tr', { hasText: '에이스' }).locator('.cell.pick').click()
    const conf = p.locator('.confirm-panel')
    await conf.waitFor()
    assert.ok((await conf.innerText()).includes(ones ? `1이(가) ${ones}개 → 1×${ones} = ${ones}점` : '1이(가) 없어서 0점'), '계산 근거')
    assert.equal(await p.locator('tr', { hasText: '에이스' }).locator('td.filled').count(), 0, '선택만으로는 기록 안 됨')
    await p.getByRole('button', { name: `에이스 ${ones}점 확정` }).click()
    await p.locator('.turn-status strong', { hasText: /봇 사원 \d 님 차례/ }).waitFor()
    assert.equal((await p.locator('tr', { hasText: '에이스' }).locator('td.filled .locked').innerText()).trim(), String(ones))
    await p.locator('.game-toast', { hasText: '에이스에' }).waitFor()
  })
  await step('채팅 송수신(게임 중)', async () => {
    await p.locator('textarea[aria-label="채팅 메시지"]').fill('혼자 테스트 중입니다')
    await p.keyboard.press('Enter')
    await p.locator('.chat-item.mine .chat-bubble', { hasText: '혼자 테스트 중입니다' }).waitFor()
  })
  await step('12. 봇 포함 전체 게임 완료(남은 턴 서버 진행) → 순위', async () => {
    await panel.getByRole('button', { name: '종료 시뮬레이션' }).click()
    await p.getByText('최종 평가 결과').waitFor()
    const ranks = await p.locator('.standings tbody tr td:first-child').allInnerTexts()
    assert.equal(ranks.length, 4)
    assert.match(ranks[0], /^1위/)
  })
  await solo.ctx.close()

  // ───────── 2인 멀티플레이 ─────────
  const A = await devLogin(2)
  const B = await devLogin(3)
  const roomName = `멀티 평가 ${Date.now() % 100000}`
  await step('멀티: A 방 생성(2분) → B 로비에 실시간 반영', async () => {
    await A.page.locator('input[aria-label="새 방 이름"]').fill(roomName)
    await A.page.locator('select[aria-label="정원"]').selectOption('2')
    await A.page.locator('[aria-label="턴 제한시간"]').getByRole('radio', { name: '2분' }).click()
    await A.page.getByRole('button', { name: '문서 작성' }).click()
    await A.page.getByText('평가 개시 전 참석 확인').waitFor()
    assert.equal(await A.page.locator('[role=radiogroup] [aria-checked=true]', { hasText: '2분' }).count(), 1, '대기실에 2분 반영')
    await B.page.locator('tr', { hasText: roomName }).waitFor({ timeout: 5000 })
    assert.ok((await B.page.locator('tr', { hasText: roomName }).innerText()).includes('2분'))
  })
  await step('멀티: 입장 → 준비 동기화 → 시작', async () => {
    await B.page.locator('tr', { hasText: roomName }).getByRole('button', { name: '열기' }).click()
    await B.page.getByRole('button', { name: '참여 준비 완료' }).click()
    await A.page.getByRole('button', { name: '평가 개시' }).and(A.page.locator(':not([disabled])')).click()
  })
  await step('2·3. 안내: A 확인(다시 보지 않기) 후에도 B 미확인이면 타이머 정지 → B 건너뛰기 → 시작', async () => {
    await A.page.locator('.game-guide').waitFor()
    await B.page.locator('.game-guide').waitFor()
    await A.page.locator('.game-guide label', { hasText: '다시 보지 않기' }).locator('input').check()
    await A.page.getByRole('button', { name: /설명 확인 완료/ }).click()
    await A.page.getByRole('button', { name: '다른 참여자 기다리는 중…' }).waitFor()
    await B.page.getByText('확인 1 / 2명').waitFor()
    assert.equal(await A.page.locator('.timer:not(.paused)').count(), 0, 'B 확인 전 타이머 정지')
    await B.page.getByRole('button', { name: '설명 건너뛰기' }).click()
    await A.page.locator('.game-guide').waitFor({ state: 'detached' })
    await A.page.locator('.timer:not(.paused)', { hasText: /^⏱ [0-2]:\d\d$/ }).waitFor()
    await B.page.locator('.timer:not(.paused)').waitFor()
  })
  await step('11. 주사위·턴·점수표 동기화 + 채팅', async () => {
    const [me, other] = (await myTurn(A.page).count()) ? [A.page, B.page] : [B.page, A.page]
    await rollOnce(me)
    await other.waitForTimeout(400)
    const v = await dieValues(me)
    assert.match(v, /^[1-6]{5}$/)
    await settle(other).catch(() => {})
    assert.equal(await dieValues(other), v, '상대 화면에 같은 주사위')
    assert.ok(await other.locator('.roll-btn').isDisabled(), '상대는 조작 불가')
    await scoreFirst(me)
    await waitMyTurn(other)
    assert.equal(await other.locator('.score-grid tbody tr').first().locator('td').last().innerText().then(t => /^\d+$/.test(t.trim())), true, '상대 점수표에 기록 반영')
    await A.page.locator('textarea[aria-label="채팅 메시지"]').fill('안녕하세요 B님')
    await A.page.keyboard.press('Enter')
    await B.page.locator('.chat-item.other', { hasText: '안녕하세요 B님' }).waitFor()
  })
  await step('멀티: 새로고침 복원 · 연결 끊김/복구', async () => {
    const before = await B.page.locator('.progress').innerText()
    await B.page.reload()
    await B.page.locator('.progress', { hasText: before }).waitFor({ timeout: 10_000 })
    await B.page.locator('.chat-item', { hasText: '안녕하세요 B님' }).waitFor()
    assert.equal(await B.page.locator('.game-guide').count(), 0, '진행 중 새로고침에는 안내가 다시 뜨지 않음')
    await B.ctx.setOffline(true)
    await B.page.locator('.connection-warning').waitFor({ timeout: 10_000 })
    if (await myTurn(A.page).count()) {
      await rollOnce(A.page)
      await scoreFirst(A.page)
    }
    await B.ctx.setOffline(false)
    await B.page.locator('.connection-warning').waitFor({ state: 'detached', timeout: 15_000 })
    await B.page.locator('.progress', { hasText: await A.page.locator('.progress').innerText() }).waitFor({ timeout: 5000 })
  })
  await step('멀티: 종료 결과 일치 → 다시 하기(다시 보지 않기: A 안내 생략, B 안내 표시)', async () => {
    await A.page.locator('.dev-panel').getByRole('button', { name: '종료 시뮬레이션' }).click()
    await A.page.getByText('최종 평가 결과').waitFor()
    await B.page.getByText('최종 평가 결과').waitFor()
    const norm = r => r.map(x => x.replace(/\s*\(나\)/, '').replace(/\s+/g, ' '))
    assert.deepEqual(norm(await A.page.locator('.standings tbody tr').allInnerTexts()), norm(await B.page.locator('.standings tbody tr').allInnerTexts()))
    await B.page.getByRole('button', { name: '다시 게임하기' }).click()
    await A.page.getByRole('button', { name: '다시 게임하기' }).click()
    await A.page.getByRole('button', { name: '평가 개시' }).and(A.page.locator(':not([disabled])')).click()
    await B.page.locator('.game-guide').waitFor()
    await A.page.getByText('안내를 건너뛰었습니다').waitFor()
    assert.equal(await A.page.locator('.game-guide').count(), 0)
    await B.page.getByRole('button', { name: /설명 확인 완료/ }).click()
    await A.page.locator('.timer:not(.paused)').waitFor()
  })
  await step('9. [평가 양식 안내] 버튼: 게임 중 열기/닫기(진행 영향 없음)', async () => {
    await A.page.locator('.help-btn').click()
    await A.page.locator('.help-btn', { hasText: '평가 양식 안내' }).waitFor()
    await A.page.locator('.game-guide', { hasText: '평가 양식 안내' }).waitFor()
    await A.page.locator('.game-guide').getByRole('button', { name: '닫기' }).click()
    await A.page.locator('.game-guide').waitFor({ state: 'detached' })
  })
  await A.ctx.close()
  await B.ctx.close()

  // ───────── 모바일(390px, 터치) ─────────
  const M = await devLogin(6, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await step('13. 모바일: 터치로 안내·굴림·보관·선택·확정, 주사위 줄이 화면 안', async () => {
    const mp = M.page
    const mpanel = mp.locator('.dev-panel')
    await mpanel.locator('label:has-text("봇") select').selectOption('1')
    await mpanel.getByRole('button', { name: '테스트 방 생성' }).tap()
    await mp.locator('.game-guide').waitFor()
    await mp.getByRole('button', { name: '설명 건너뛰기' }).tap()
    await mpanel.locator('summary').tap()
    await waitMyTurn(mp)
    await rollOnce(mp, true)
    await mp.locator('.die').nth(2).tap()
    await mp.locator('.die.held').first().waitFor()
    const box = await mp.locator('.dice').boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= 390 + 1, `주사위 줄 폭 ${Math.round(box.x)}+${Math.round(box.width)}`)
    const dieBox = await mp.locator('.die').first().boundingBox()
    assert.ok(dieBox.height >= 44 && dieBox.width >= 44, '터치 대상 44px 이상')
    await mp.locator('.cell.pick').first().tap()
    await mp.locator('.confirm-btn').tap()
    await mp.locator('.turn-status strong', { hasText: /봇 사원 \d 님 차례/ }).waitFor()
  })
  await M.ctx.close()
} finally {
  await browser.close()
  console.table(results.map(([s, n, ms, e]) => ({ 결과: s, 단계: n, ms, ...(e ? { 오류: e } : {}) })))
  if (results.some(r => r[0] === 'FAIL')) process.exitCode = 1
}
