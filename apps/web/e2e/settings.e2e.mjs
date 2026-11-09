// 환경 설정·UI 모드(Excel/CMD) 검증(실제 Chrome). 선행: API(TEST_MODE=true) + 웹 dev 서버.
//   WEB_URL=http://localhost:5173 npm run test:settings
// 스크린샷: e2e/screenshots/settings/*.png
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const WEB = process.env.WEB_URL ?? 'http://localhost:5173'
const SHOTS = new URL('./screenshots/settings/', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })
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
const newPage = async (width = 1440) => {
  const mobile = width < 768
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, locale: 'ko-KR', hasTouch: mobile, isMobile: mobile })
  await ctx.addInitScript(() => { try { localStorage.setItem('oy.guide.skip', '1') } catch {} })
  const page = await ctx.newPage()
  page.on('pageerror', e => console.error('[pageerror]', e.message))
  await page.goto(WEB)
  return { ctx, page }
}
async function devLogin(page, slot) {
  const panel = page.locator('.dev-panel')
  if ((await panel.getAttribute('open')) === null) await panel.locator('summary').click()
  await panel.locator('select').first().selectOption(String(slot))
  await panel.getByRole('button', { name: '접속' }).click()
  await page.getByRole('button', { name: '업무 종료' }).waitFor()
}
const openSettings = async page => {
  if (!(await page.locator('.settings-panel').count())) await page.locator('.settings-btn').first().click()
  await page.locator('.settings-panel').waitFor()
}
const setPref = async (page, key, value) => {
  await openSettings(page)
  await page.locator(`.settings-panel [data-pref="${key}:${value}"]`).click()
}
const waitSaved = page => page.locator('.settings-state.is-saved').waitFor({ timeout: 5000 })
const mode = page => page.evaluate(() => document.documentElement.dataset.uiMode)
/** 실제로 보이는 바탕(문서 패널)의 밝기와 본문 글꼴 */
const bodyStyle = page => page.evaluate(() => {
  const panel = getComputedStyle(document.querySelector('.panel'))
  const rgb = panel.backgroundColor.match(/\d+/g).map(Number)
  const body = getComputedStyle(document.body)
  return { lum: (rgb[0] + rgb[1] + rgb[2]) / 3, font: body.fontFamily, color: body.color }
})
const serverPrefs = page => page.evaluate(async () => {
  const r = await fetch('/api/v1/auth/refresh', { method: 'POST' })
  const { data } = await r.json()
  return (await (await fetch('/api/v1/me/preferences', { headers: { authorization: `Bearer ${data.accessToken}` } })).json()).data
})

try {
  const A = await newPage()
  const p = A.page
  await devLogin(p, 1)
  await step('준비: 계정 1을 엑셀·보통으로 초기화', async () => {
    const panel = p.locator('.dev-panel')
    await panel.getByRole('button', { name: '테스트 데이터 초기화' }).click()
    await panel.locator('[role=status]', { hasText: '초기화 완료' }).waitFor()
    await setPref(p, 'uiMode', 'EXCEL')
    await setPref(p, 'effectSpeed', 'NORMAL')
    await setPref(p, 'uiScale', 'NORMAL')
    await waitSaved(p)
    await p.keyboard.press('Escape')
  })
  await step('2. 설정 버튼: 헤더 오른쪽 상단, 툴팁 "환경 설정"', async () => {
    const b = await p.locator('.settings-btn').boundingBox()
    assert.ok(b.y < 46 && b.x + b.width >= 1440 - 24, `위치 ${Math.round(b.x)},${Math.round(b.y)}`)
    assert.equal(await p.locator('.settings-btn').getAttribute('title'), '환경 설정')
  })
  await step('3. 설정 패널 열기 → ESC 닫기 → 버튼으로 열기/닫기', async () => {
    await p.locator('.settings-btn').click()
    await p.locator('.settings-panel').waitFor()
    for (const t of ['화면', '게임 연출', '사운드']) await p.locator('.settings-group h3', { hasText: t }).waitFor()
    await p.keyboard.press('Escape')
    await p.locator('.settings-panel').waitFor({ state: 'detached' })
    await p.locator('.settings-btn').click()
    await p.locator('.settings-close').click()
    await p.locator('.settings-panel').waitFor({ state: 'detached' })
  })
  await step('게임 준비: 테스트 방(봇 2) 시작·내 차례·굴림', async () => {
    const panel = p.locator('.dev-panel')
    await panel.locator('label:has-text("봇") select').selectOption('2')
    await panel.getByRole('button', { name: '테스트 방 생성' }).click()
    await panel.locator('summary').click()
    await p.locator('.turn-status strong.mine', { hasText: '내 차례' }).waitFor({ timeout: 30_000 })
    await p.locator('.roll-btn').click()
    await p.locator('.roll-count b', { hasText: '1' }).waitFor()
    await p.locator('.die.rolling').first().waitFor({ state: 'detached' }).catch(() => {})
  })
  await step('1. "#" 열 가운데 정렬(머리글·행 번호), 점수 열은 우측 정렬 유지', async () => {
    const align = sel => p.locator(sel).first().evaluate(el => getComputedStyle(el).textAlign)
    assert.equal(await align('.score-grid thead th:first-child'), 'center')
    assert.equal(await align('.score-grid tbody th[scope=row]'), 'center')
    assert.equal(await align('.score-grid tbody td:nth-child(3)'), 'right')
    assert.match(await align('.score-grid tbody td:nth-child(2)'), /^(left|start)$/, '항목명 열은 그대로(왼쪽)')
  })
  await step('4. Excel 모드: 밝은 배경·리본·행열 머리글·시트 탭', async () => {
    assert.equal(await mode(p), 'excel')
    const s = await bodyStyle(p)
    assert.ok(s.lum > 200, `배경 밝기 ${s.lum}`)
    for (const sel of ['.toolbar', '.column-headers', '.row-headers', 'footer nav']) assert.ok(await p.locator(sel).first().isVisible(), sel)
    await p.screenshot({ path: `${SHOTS}/excel-game-1440.png` })
  })
  let snap
  await step('5·6. 게임 중 CMD 전환: 어두운 배경·고정폭·프롬프트, 게임 상태 유지', async () => {
    snap = { dice: await p.locator('.die .pip-num').allInnerTexts(), roll: await p.locator('.roll-count b').innerText(), round: await p.locator('.progress').first().innerText(), held: await p.locator('.die.held').count() }
    await setPref(p, 'uiMode', 'CMD')
    assert.equal(await mode(p), 'cmd')
    const s = await bodyStyle(p)
    assert.ok(s.lum < 30, `배경 밝기 ${s.lum}`)
    assert.match(s.font, /Consolas|Cascadia|monospace|Menlo|D2Coding/i)
    assert.equal(await p.locator('.toolbar').isVisible(), false, '리본 숨김')
    const before = await p.locator('.roll-btn span').evaluate(el => getComputedStyle(el, '::before').content)
    assert.match(before, /C:\\\\COMPANY> (REROLL|ROLL)/)
    assert.match(await p.locator('.turn-status').evaluate(el => getComputedStyle(el, '::before').content), /\[STATUS\]/)
    assert.deepEqual(await p.locator('.die .pip-num').allInnerTexts(), snap.dice, '주사위 유지')
    assert.equal(await p.locator('.roll-count b').innerText(), snap.roll, '굴림 횟수 유지')
    assert.equal(await p.locator('.die.held').count(), snap.held)
    await p.keyboard.press('Escape')
    await p.screenshot({ path: `${SHOTS}/cmd-game-1440.png` })
  })
  await step('14. CMD 모드에서 게임·채팅 정상: 보관·재굴림·선택·확정·채팅', async () => {
    await p.locator('.die').first().click()
    await p.locator('.die.held').first().waitFor()
    await p.locator('.roll-btn').click()
    await p.locator('.roll-count b', { hasText: '2' }).waitFor()
    await p.locator('.die.rolling').first().waitFor({ state: 'detached' }).catch(() => {})
    await p.locator('.cell.pick').first().click()
    assert.match(await p.locator('.confirm-btn').evaluate(el => getComputedStyle(el, '::before').content), /CONFIRM/)
    await p.locator('.confirm-btn').click()
    await p.locator('.confirm-panel').waitFor({ state: 'detached' })
    await p.locator('textarea[aria-label="채팅 메시지"]').fill('CMD 모드 채팅 테스트')
    await p.keyboard.press('Enter')
    await p.locator('.chat-item.mine .chat-bubble', { hasText: 'CMD 모드 채팅 테스트' }).waitFor()
    assert.match(await p.locator('.chat-system').first().evaluate(el => getComputedStyle(el, '::before').content), /\[SYSTEM\]/)
  })
  await step('7. 진행 연출 속도: 느리게 1200ms / 빠르게 450ms (CSS 변수·애니메이션 시간)', async () => {
    await setPref(p, 'effectSpeed', 'SLOW')
    assert.equal(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fx-dice-ms').trim()), '1200ms')
    await setPref(p, 'effectSpeed', 'FAST')
    assert.equal(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fx-dice-ms').trim()), '450ms')
    await p.keyboard.press('Escape')
    await p.locator('.turn-status strong.mine', { hasText: '내 차례' }).waitFor({ timeout: 30_000 })
    await p.locator('.roll-btn').click()
    const dur = await p.locator('.die.rolling').first().evaluate(el => getComputedStyle(el).animationDuration)
    assert.equal(dur, '0.45s')
  })
  await step('리본 접기·UI 크기·효과음(설정이 실제로 동작)', async () => {
    await setPref(p, 'uiMode', 'EXCEL')
    await setPref(p, 'ribbonCollapsed', true)
    assert.equal(await p.locator('.toolbar').isVisible(), false, '게임 중 리본 숨김')
    await setPref(p, 'ribbonCollapsed', false)
    assert.ok(await p.locator('.toolbar').isVisible())
    await setPref(p, 'uiScale', 'LARGE')
    assert.equal(await p.evaluate(() => getComputedStyle(document.body).zoom), '1.12')
    await setPref(p, 'uiScale', 'NORMAL')
    assert.ok(await p.locator('#pref-volume').isDisabled(), '효과음 OFF 면 음량 비활성')
    await setPref(p, 'soundEnabled', true)
    await p.locator('.settings-panel').getByRole('button', { name: '미리 듣기' }).click()
    assert.ok((await p.evaluate(() => window.__oySoundLog ?? [])).includes('turn'), '효과음 재생 호출')
    await setPref(p, 'soundEnabled', false)
    await setPref(p, 'uiMode', 'CMD')
    await waitSaved(p)
    await p.keyboard.press('Escape')
  })
  await step('8. 계정에 저장(서버 값 확인)', async () => {
    const s = await serverPrefs(p)
    assert.deepEqual([s.uiMode, s.effectSpeed, s.saved], ['CMD', 'FAST', true])
  })
  await step('9. 새로고침 → 첫 렌더 전에 CMD 적용·설정 복원', async () => {
    await p.addInitScript(() => {
      window.__modeLog = []
      // documentElement 생성 전에도 붙도록 document 전체를 관찰
      new MutationObserver(() => window.__modeLog.push(document.documentElement?.dataset.uiMode)).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-ui-mode'] })
    })
    await p.reload()
    assert.equal(await mode(p), 'cmd', '초기 렌더 직후 CMD')
    await p.getByRole('button', { name: '업무 종료' }).waitFor()
    await p.waitForTimeout(300)
    assert.equal(await mode(p), 'cmd')
    const log = await p.evaluate(() => window.__modeLog)
    assert.ok(log.length >= 1 && log[0] === 'cmd', `관찰 기록 있음 (${log.join(',')})`)
    assert.ok(!log.includes('excel'), `새로고침 중 엑셀로 깜빡이지 않음 (${log.join(',')})`)
  })
  await step('10. 로그아웃(게스트 설정=엑셀) → 재로그인 → CMD 복원', async () => {
    await p.getByRole('button', { name: '업무 종료' }).click()
    await p.locator('.provider-list').waitFor()
    assert.equal(await mode(p), 'excel', '로그아웃하면 이 브라우저 게스트 설정')
    await devLogin(p, 1)
    await p.waitForFunction(() => document.documentElement.dataset.uiMode === 'cmd')
  })
  await step('11. 다른 계정은 별도 설정(계정 2=엑셀), 서로 영향 없음', async () => {
    const B = await newPage()
    await devLogin(B.page, 2)
    await setPref(B.page, 'uiMode', 'EXCEL')
    await waitSaved(B.page)
    assert.equal(await mode(B.page), 'excel')
    assert.equal((await serverPrefs(p)).uiMode, 'CMD', '계정 1 은 그대로 CMD')
    await B.ctx.close()
  })
  await step('12. 다른 브라우저(새 컨텍스트)에서 같은 계정 → CMD 복원', async () => {
    const C = await newPage()
    assert.equal(await mode(C.page), 'excel', '새 브라우저 첫 화면은 기본값')
    await devLogin(C.page, 1)
    await C.page.waitForFunction(() => document.documentElement.dataset.uiMode === 'cmd')
    await C.ctx.close()
  })
  await step('로그인 우선순위: 첫 로그인 계정은 이 브라우저(게스트) 설정을 계정으로 올림', async () => {
    const G = await newPage()
    await G.page.locator('.settings-btn').click()
    await G.page.locator('[data-pref="uiScale:LARGE"]').click()
    await G.page.locator('.settings-state.is-local').waitFor()
    await G.page.keyboard.press('Escape')
    const email = `pref.${Date.now()}@example.com`
    await G.page.getByRole('tab', { name: '회원가입' }).click()
    await G.page.locator('#login-email').fill(email)
    await G.page.locator('#login-password').fill('pref-password-123')
    await G.page.getByRole('button', { name: '가입하고 접속' }).click()
    await G.page.getByText('신규 인사기록카드').waitFor()
    const s = await serverPrefs(G.page)
    assert.deepEqual([s.uiScale, s.saved], ['LARGE', true])
    await G.ctx.close()
  })
  await A.ctx.close()

  await step('13. 모바일 390px: 설정 버튼·하단 시트·CMD 화면, 가로 스크롤 없음', async () => {
    const M = await newPage(390)
    const mp = M.page
    await devLogin(mp, 1)
    await mp.waitForFunction(() => document.documentElement.dataset.uiMode === 'cmd')
    const b = await mp.locator('.settings-btn').boundingBox()
    assert.ok(b.x + b.width <= 390 && b.height >= 44, '설정 버튼 화면 안·44px')
    await mp.locator('.settings-btn').tap()
    const sheet = await mp.locator('.settings-panel').boundingBox()
    assert.ok(Math.round(sheet.width) === 390 && sheet.y + sheet.height <= 845, '하단 시트')
    await mp.screenshot({ path: `${SHOTS}/cmd-settings-390.png` })
    await mp.locator('.settings-close').tap()
    assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth) <= 390)
    await mp.screenshot({ path: `${SHOTS}/cmd-lobby-390.png` })
    await M.ctx.close()
  })
  await step('정리: 계정 1을 엑셀로 되돌림', async () => {
    const R = await newPage()
    await devLogin(R.page, 1)
    await setPref(R.page, 'uiMode', 'EXCEL')
    await waitSaved(R.page)
    await R.page.keyboard.press('Escape')
    await R.page.screenshot({ path: `${SHOTS}/excel-lobby-1440.png` })
    await R.ctx.close()
  })
} finally {
  await browser.close()
  console.table(results.map(([s, n, ms, e]) => ({ 결과: s, 단계: n, ms, ...(e ? { 오류: e } : {}) })))
  if (results.some(r => r[0] === 'FAIL')) process.exitCode = 1
}
