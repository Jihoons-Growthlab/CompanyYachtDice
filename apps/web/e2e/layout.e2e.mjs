// 레이아웃·반응형 검증(실제 Chrome). 선행: API(TEST_MODE=true) + 웹 dev 서버.
//   WEB_URL=http://localhost:5173 npm run test:layout
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
/** 화면 기준 상자(가로 배치 판단용) */
const box = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox()
  return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.x + b.width, b: b.y + b.height }
}
/** 문서 기준 y(스크롤 영향 제거) — 레이아웃 이동 측정용 */
const docY = (page, sel) => page.locator(sel).first().evaluate(el => el.getBoundingClientRect().top + window.scrollY)
async function login(slot, width, { reset = false } = {}) {
  const mobile = width < 768
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, locale: 'ko-KR', hasTouch: mobile, isMobile: mobile })
  await ctx.addInitScript(() => { try { localStorage.setItem('oy.guide.skip', '1') } catch {} })
  const page = await ctx.newPage()
  await page.goto(WEB)
  const panel = page.locator('.dev-panel')
  if ((await panel.getAttribute('open')) === null) await panel.locator('summary').click()
  await panel.locator('select').first().selectOption(String(slot))
  await panel.getByRole('button', { name: '접속' }).click()
  await page.getByRole('button', { name: '업무 종료' }).waitFor()
  if (reset) {
    await panel.getByRole('button', { name: '테스트 데이터 초기화' }).click()
    await panel.locator('[role=status]', { hasText: '초기화 완료' }).waitFor()
  }
  return { ctx, page, panel }
}
const say = async (page, text) => {
  await page.locator('textarea[aria-label="채팅 메시지"]').fill(text)
  await page.keyboard.press('Enter')
  await page.locator('.chat-item.mine .chat-bubble', { hasText: text.slice(0, 12) }).last().waitFor()
}

const WIDTHS = [1440, 1280, 1024, 768, 390]
try {
  for (const [i, width] of WIDTHS.entries()) {
    const { ctx, page, panel } = await login(i + 1, width, { reset: i === 0 })
    await step(`${width}px: 대기실 → 게임(내 차례·굴림)`, async () => {
      await panel.locator('label:has-text("봇") select').selectOption('2')
      await panel.locator('label:has-text("바로 시작") input').uncheck()
      await panel.getByRole('button', { name: '테스트 방 생성' }).click()
      await page.getByText('평가 개시 전 참석 확인').waitFor()
      await panel.locator('summary').click() // 패널 접기(화면 가림 방지)
      await say(page, '레이아웃 점검용 메시지입니다. 길게 써서 줄바꿈이 자연스러운지 확인합니다. 닉네임과 시간 정보가 겹치지 않아야 합니다.')
      await page.getByRole('button', { name: '평가 개시' }).click()
      await page.locator('.turn-status strong.mine', { hasText: '내 차례' }).waitFor({ timeout: 30_000 })
      await page.locator('.roll-btn').click()
      await page.locator('.roll-count b', { hasText: '1' }).waitFor()
      await page.locator('.die.rolling').first().waitFor({ state: 'detached' }).catch(() => {})
    })
    await step(`${width}px: 가로 스크롤 없음 · 영역 배치 · 채팅 크기`, async () => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= width, '페이지 가로 스크롤 없음')
      const game = await box(page, '.match > section.panel')
      const chat = await box(page, '.room-chat')
      if (width >= 1024) {
        assert.ok(chat.x >= game.r, '데스크톱·노트북: 채팅은 게임 오른쪽')
        assert.ok(chat.w >= 320, `채팅 최소 너비 320 (${Math.round(chat.w)})`)
        const ratio = chat.w / (game.w + chat.w)
        if (width >= 1440) assert.ok(chat.w >= 380 && ratio >= 0.28 && ratio <= 0.35, `1440 채팅 ${Math.round(chat.w)}px · ${(ratio * 100).toFixed(1)}%`)
        const input = await box(page, '.chat-form textarea')
        assert.ok(input.b <= chat.b + 1 && input.b <= 900, '입력창이 패널 안·화면 안')
        const list = await box(page, '.chat-list')
        assert.ok(list.h >= 360, `메시지 목록 높이 ${Math.round(list.h)}`)
      } else {
        assert.ok(chat.y >= game.b - 1, '태블릿·모바일: 채팅은 게임 아래')
        assert.ok(chat.r <= width, '채팅 화면 안')
      }
    })
    await step(`${width}px: 주사위 균등·화면 안·터치 크기`, async () => {
      const ws = []
      for (let k = 0; k < 5; k++) ws.push((await box(page, `.die >> nth=${k}`)).w)
      assert.ok(Math.max(...ws) - Math.min(...ws) <= 1, `주사위 폭 ${ws.map(Math.round)}`)
      const dice = await box(page, '.dice')
      assert.ok(dice.x >= 0 && dice.r <= width, '주사위 줄이 화면 안')
      const d0 = await box(page, '.die')
      assert.ok(d0.h >= 44 && d0.w >= 44, '터치 대상 44px 이상')
      assert.ok((await box(page, '.roll-btn')).h >= 44)
    })
    await step(`${width}px: 항목 선택 시 점수표 위치 고정 · 확정 버튼 · 숫자 우측 정렬`, async () => {
      const before = await docY(page, '.score-grid')
      await page.locator('.cell.pick').nth(6).click()
      await page.locator('.confirm-btn').waitFor()
      const after = await docY(page, '.score-grid')
      assert.ok(Math.abs(after - before) <= 2, `점수표 이동 ${Math.round(after - before)}px`)
      assert.equal(await page.locator('.score-grid tbody td:nth-child(3)').first().evaluate(el => getComputedStyle(el).textAlign), 'right')
      assert.match(await page.locator('.help-btn').innerText(), /평가 양식 안내/)
      await page.locator('.confirm-btn').click()
      await page.locator('.confirm-panel').waitFor({ state: 'detached' })
    })
    if (width <= 1023) {
      await step(`${width}px: 채팅 접기·펼치기`, async () => {
        await page.getByRole('button', { name: '접기' }).click()
        await page.locator('.chat-list').waitFor({ state: 'detached' })
        await page.getByRole('button', { name: /메신저 열기/ }).click()
        await page.locator('.chat-list').waitFor()
      })
    }
    if (width === 1440) {
      await step('1440px: 채팅 내부 스크롤 · 읽는 중 강제 스크롤 안 함 · 새 메시지 알림', async () => {
        const roomName = (await page.locator('.game-head h1').innerText()).trim()
        // 다른 참여자(B)가 같은 방에서 메시지를 보낸다
        const B = await login(6, 1440)
        void roomName
        await page.locator('.dev-panel summary').click()
        await page.locator('.dev-panel').getByRole('button', { name: '종료 시뮬레이션' }).click()
        await page.getByText('최종 평가 결과').waitFor()
        await page.locator('.dev-panel summary').click()
        await page.getByRole('button', { name: '다시 게임하기' }).click()
        await page.locator('.dev-panel summary').click()
        await page.locator('.dev-panel label:has-text("계정") select').last().selectOption('6')
        await page.locator('.dev-panel').getByRole('button', { name: '테스트 계정 입장' }).click()
        await page.locator('.dev-panel summary').click()
        await B.page.reload()
        await B.page.locator('textarea[aria-label="채팅 메시지"]').waitFor()
        for (let k = 0; k < 3; k++) await say(page, `내 메시지 ${k + 1}: 스크롤 확인을 위해 여러 줄이 되도록 조금 길게 작성한 메시지입니다.`)
        const list = page.locator('.chat-list')
        const overflow = await list.evaluate(el => el.scrollHeight > el.clientHeight)
        assert.ok(overflow, '메시지가 많으면 목록 내부 스크롤')
        assert.ok(await page.evaluate(() => document.documentElement.scrollHeight) < 1100, '목록이 늘어나도 페이지는 늘지 않음')
        await list.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) })
        await B.page.locator('textarea[aria-label="채팅 메시지"]').fill('B가 보낸 새 메시지')
        await B.page.keyboard.press('Enter')
        await page.locator('.chat-jump', { hasText: '새 메시지' }).waitFor()
        assert.equal(await list.evaluate(el => el.scrollTop), 0, '이전 메시지를 읽는 중에는 위치 유지')
        await page.locator('.chat-jump').click()
        assert.ok(await list.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 30), '버튼으로 맨 아래 이동')
        await B.ctx.close()
      })
    }
    await ctx.close()
  }
} finally {
  await browser.close()
  console.table(results.map(([s, n, ms, e]) => ({ 결과: s, 단계: n, ms, ...(e ? { 오류: e } : {}) })))
  if (results.some(r => r[0] === 'FAIL')) process.exitCode = 1
}
