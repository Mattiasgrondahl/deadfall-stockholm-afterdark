// Reproduce the JOIN CO-OP hang: click join, wait, and report whether the page
// is responsive (evaluate a trivial expr with a timeout) + any console errors.
import { chromium } from 'playwright-core'

const URL = process.env.DEADFALL_URL || 'http://127.0.0.1:8080/'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e)))
page.on('console', (m) => { if (/error|Error|fail|warn/i.test(m.text())) console.log('[console]', m.text().slice(0, 160)) })
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(800)
console.log('clicking JOIN CO-OP...')
const t0 = Date.now()
await page.evaluate(() => { window.__game.startMultiplayer({ room: 'default', name: 'probe' }) })
console.log('startMultiplayer returned in', Date.now() - t0, 'ms')
// Check responsiveness after a beat.
await page.waitForTimeout(1500)
let resp = 'ok'
try {
  await Promise.race([
    page.evaluate(() => 1 + 1),
    new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 4000))
  ])
} catch (e) { resp = 'HUNG: ' + e.message }
console.log('responsiveness:', resp)
// Re-check after more gameplay frames to ensure it doesn't hang later.
await page.waitForTimeout(3000)
let resp2 = 'ok'
try {
  await Promise.race([
    page.evaluate(() => 1 + 1),
    new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 4000))
  ])
} catch (e) { resp2 = 'HUNG: ' + e.message }
console.log('responsiveness-later:', resp2)
const state = await page.evaluate(() => {
  const mp = window.__game.multiplayer
  const out = { state: window.__game.state, mp: !!mp, connected: mp && mp.net.connected, zombies: mp ? mp.zombies.size : -1 }
  if (mp) {
    out.targets = mp.getTargets().length
    const e = mp.zombies.values().next().value
    if (e) {
      out.hasFace = !!e._face
      out.bodyColor = e.mesh && e.mesh.material ? e.mesh.material.color.getHexString() : null
      out.emissiveInt = e.mesh && e.mesh.material ? Math.round(e.mesh.material.emissiveIntensity*100)/100 : null
    }
  }
  return out
})
console.log('state:', JSON.stringify(state))
await page.screenshot({ path: new URL('./_coop-shot.png', import.meta.url).pathname })
await browser.close().catch(() => {})