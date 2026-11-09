// 레이아웃 점검용 캡처: 여러 화면 폭에서 대기실·게임·결과 화면을 찍고 주요 영역 크기를 출력한다.
//   WEB_URL=http://localhost:5173 node e2e/layout-capture.mjs before|after
// 선행: API(TEST_MODE=true) + 웹 dev 서버. 결과: e2e/screenshots/<label>/*.png, layout.json
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const WEB = process.env.WEB_URL ?? 'http://localhost:5173'
const label = process.argv[2] ?? 'after'
const dir = new URL(`./screenshots/${label}/`, import.meta.url).pathname
mkdirSync(dir, { recursive: true })
const WIDTHS = [1440, 1280, 1024, 768, 390]
const browser = await chromium.launch({ channel: 'chrome' })
const metrics = {}

const box = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox().catch(() => null)
  return b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
}

for (const width of WIDTHS) {
  const mobile = width < 768
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, locale: 'ko-KR', hasTouch: mobile, isMobile: mobile })
  await ctx.addInitScript(() => { try { localStorage.setItem('oy.guide.skip', '1') } catch {} })
  const page = await ctx.newPage()
  await page.goto(WEB)
  const panel = page.locator('.dev-panel')
  if ((await panel.getAttribute('open')) === null) await panel.locator('summary').click()
  await panel.locator('select').first().selectOption(String(1 + WIDTHS.indexOf(width)))
  await panel.getByRole('button', { name: '접속' }).click()
  await page.getByRole('button', { name: '업무 종료' }).waitFor()
  await panel.getByRole('button', { name: '테스트 데이터 초기화' }).click()
  await panel.locator('[role=status]', { hasText: '초기화 완료' }).waitFor()
  await panel.locator('label:has-text("봇") select').selectOption('2')
  await panel.locator('label:has-text("바로 시작") input').uncheck()
  await panel.getByRole('button', { name: '테스트 방 생성' }).click()
  await page.getByText('평가 개시 전 참석 확인').waitFor()
  for (const t of ['안녕하세요, 이번 평가 잘 부탁드립니다.', '네 반갑습니다! 오늘은 요트 꼭 노려볼게요 🙂', '긴 메시지 확인용: 엑셀 평가표 형식으로 진행되는 요트 다이스 게임에서 채팅 메시지가 길어지면 자동으로 줄바꿈되어야 합니다.']) {
    await page.locator('textarea[aria-label="채팅 메시지"]').fill(t)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
  }
  if (await panel.getAttribute('open') !== null) await panel.locator('summary').click()
  await page.screenshot({ path: `${dir}/${width}-waiting.png` })
  await page.getByRole('button', { name: '평가 개시' }).click()
  await page.locator('.turn-status strong.mine', { hasText: '내 차례' }).waitFor({ timeout: 30_000 })
  await page.locator('.roll-btn').click()
  await page.locator('.roll-count b', { hasText: '1' }).waitFor()
  await page.waitForTimeout(900)
  await page.locator('.die').nth(1).click()
  await page.waitForTimeout(300)
  await page.locator('.cell.pick').nth(5).click()
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${dir}/${width}-game.png` })
  await page.screenshot({ path: `${dir}/${width}-game-full.png`, fullPage: true })
  metrics[width] = {
    match: await box(page, '.match'),
    gamePanel: await box(page, '.match > section.panel'),
    chat: await box(page, '.room-chat'),
    chatList: await box(page, '.chat-list'),
    chatInput: await box(page, '.chat-form textarea'),
    dice: await box(page, '.dice'),
    die: await box(page, '.die'),
    rollBtn: await box(page, '.roll-btn'),
    scoreGrid: await box(page, '.score-grid'),
    confirm: await box(page, '.confirm-panel'),
    pageScrollW: await page.evaluate(() => document.documentElement.scrollWidth),
    pageScrollH: await page.evaluate(() => document.documentElement.scrollHeight),
  }
  if (await panel.getAttribute('open') === null) await panel.locator('summary').click()
  await panel.getByRole('button', { name: '종료 시뮬레이션' }).click()
  await page.getByText('최종 평가 결과').waitFor()
  await panel.locator('summary').click()
  await page.screenshot({ path: `${dir}/${width}-result.png` })
  await ctx.close()
}
await browser.close()
writeFileSync(`${dir}/layout.json`, JSON.stringify(metrics, null, 2))
for (const [w, m] of Object.entries(metrics)) {
  console.log(w, `match ${m.match?.w} | game ${m.gamePanel?.w}x${m.gamePanel?.h} | chat ${m.chat?.w}x${m.chat?.h} list ${m.chatList?.w}x${m.chatList?.h} @y${m.chat?.y} | dice y${m.dice?.y} w${m.dice?.w} | grid y${m.scoreGrid?.y} w${m.scoreGrid?.w} | scrollW ${m.pageScrollW} scrollH ${m.pageScrollH}`)
}
