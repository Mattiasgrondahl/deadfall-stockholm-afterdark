// TEMP probe 2: does the game's mouse-look pipeline respond at all?
// (a) CDP synthetic mouse moves (what probe 1 did) vs
// (b) a mousemove dispatched inside the page with explicit movementX.
import { chromium } from 'playwright-core'

const URL = process.env.E2E_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push(String(e)))
await page.goto(URL, { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(1500)
const startBtn = await page.$('.screen.visible button.btn')
await startBtn.click()
await page.waitForTimeout(2500)

const read = () => page.evaluate(() => ({
  locked: !!document.pointerLockElement,
  yaw: +(window.__game?.player?.yaw ?? 0).toFixed(4),
  pitch: +(window.__game?.player?.pitch ?? 0).toFixed(4)
}))

const base = await read()

// (a) CDP synthetic moves
await page.mouse.move(640, 360)
await page.waitForTimeout(150)
await page.mouse.move(860, 360)
await page.waitForTimeout(600)
const afterCDP = await read()

// (b) in-page dispatched event with explicit movementX
const afterSynthetic = await page.evaluate(async () => {
  const g = window.__game
  const doc = document
  const fire = (mx, my) =>
    doc.dispatchEvent(new MouseEvent('mousemove', { movementX: mx, movementY: my, clientX: 860, clientY: 360, bubbles: true }))
  const before = g.player.yaw
  fire(100, 0)
  await new Promise(r => setTimeout(r, 300)) // let a game frame consume turnX
  const after = g.player.yaw
  return { before, after, delta: +(after - before).toFixed(4) }
})

const out = {
  base, afterCDP, afterSynthetic,
  cdpDelta: +(afterCDP.yaw - base.yaw).toFixed(4),
  consoleErrors
}
console.log('MOUSELOOK PROBE 2:', JSON.stringify(out, null, 1))
const pipelineWorks = Math.abs(afterSynthetic.delta) > 0.001
const headlessCDPWorks = Math.abs(out.cdpDelta) > 0.001
console.log('PIPELINE (synthetic event):', pipelineWorks ? 'PASS' : 'FAIL')
console.log('HEADLESS CDP MOVEMENT:', headlessCDPWorks ? 'PASS' : 'FAIL (headless artifact candidate)')
await browser.close()
process.exitCode = pipelineWorks && consoleErrors.length === 0 ? 0 : 1
