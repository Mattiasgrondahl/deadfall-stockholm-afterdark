// TEMP probe 3: WASD movement, sprint speed, and reload in the browser.
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

const pos = () => page.evaluate(() => {
  const p = window.__game?.player?.position
  return p ? { x: +p.x.toFixed(3), z: +p.z.toFixed(3) } : null
})

// 1) Walk forward (W) for 1.2 s
const p0 = await pos()
await page.keyboard.down('KeyW')
await page.waitForTimeout(1200)
await page.keyboard.up('KeyW')
const p1 = await pos()
const walkDist = Math.hypot(p1.x - p0.x, p1.z - p0.z)

// 2) Sprint (Shift+W) for 1.2 s
await page.keyboard.down('ShiftLeft')
await page.keyboard.down('KeyW')
await page.waitForTimeout(1200)
await page.keyboard.up('KeyW')
await page.keyboard.up('ShiftLeft')
const p2 = await pos()
const sprintDist = Math.hypot(p2.x - p1.x, p2.z - p1.z)

// 3) Reload: fire to burn mag, press R, poll until mag refilled
const fireState = await page.evaluate(async () => {
  const g = window.__game
  const sg = g.weapon.shotgun
  const magBefore = sg.ammo
  sg.shoot() // one 6-pellet blast consumes 1 round
  await new Promise(r => setTimeout(r, 300))
  const magAfterShot = sg.ammo
  g.inputState.reload = true // the exact flag Input.js sets on KeyR
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 200))
    if (!sg.isReloading && sg.ammo === sg.magSize) break
  }
  return { magBefore, magAfterShot, magFinal: sg.ammo, reserve: sg.reserve, isReloading: sg.isReloading }
})

const out = {
  p0, p1, p2,
  walkDist: +walkDist.toFixed(3),
  sprintDist: +sprintDist.toFixed(3),
  sprintFaster: sprintDist > walkDist * 1.2,
  moved: walkDist > 0.05,
  fireState,
  reloaded: fireState.magFinal > fireState.magAfterShot,
  consoleErrors
}
console.log('WASD/SPRINT/RELOAD PROBE:', JSON.stringify(out, null, 1))
const pass = out.moved && out.sprintFaster && out.reloaded && fireState.magAfterShot < fireState.magBefore && consoleErrors.length === 0
console.log('PROBE3:', pass ? 'PASS' : 'FAIL')
await browser.close()
process.exitCode = pass ? 0 : 1
