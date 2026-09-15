// E2E probe: per-type zombie face portraits render in the browser.
// Loads the game, starts it (Enter, button fallback), waits for wave-1
// zombies, then uses the existing debug helpers to place the player ~3.4 m
// from the nearest zombie and face it, and screenshots the first-person view.
// Modeled on tools/e2e-movement.mjs.
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const URL = process.env.E2E_URL || 'http://127.0.0.1:5173'
const OUT_DIR = '.research'
fs.mkdirSync(OUT_DIR, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push(String(e)))

await page.goto(URL, { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(1500)
await page.keyboard.press('Enter') // title -> start
await page.waitForTimeout(600)
if ((await page.evaluate(() => window.__game.state)) !== 'playing') {
  await page.click('.screen.visible button.btn')
}
await page.waitForTimeout(1500)

for (let i = 0; i < 60; i++) { // wait for at least one wave-1 zombie
  if (await page.evaluate(() => window.__game.zombies.length) > 0) break
  await page.waitForTimeout(500)
}
const zcount = await page.evaluate(() => window.__game.zombies.length)

// Place the player 3.4 m from the closest live zombie, facing it (yaw 0 = -Z;
// facing a target at (tx,tz) is atan2(P.x-Z.x, P.z-Z.z) here). Heal so melee
// range never kills the player during the capture.
const aim = async () => page.evaluate(() => {
  const g = window.__game
  const p = g.player
  const zs = g.zombies.filter((z) => !z.isDead)
  if (!zs.length || !p) return null
  let best = zs[0], bd = Infinity
  for (const z of zs) {
    const d = Math.hypot(z.position.x - p.position.x, z.position.z - p.position.z)
    if (d < bd) { bd = d; best = z }
  }
  const dx = p.position.x - best.position.x, dz = p.position.z - best.position.z
  const d = Math.max(bd, 1e-6)
  g.debug.setPlayerPos(best.position.x + (dx / d) * 3.4, best.position.z + (dz / d) * 3.4)
  p.yaw = Math.atan2(p.position.x - best.position.x, p.position.z - best.position.z)
  p.pitch = 0
  g.debug.setPlayerHealth(100)
  const fd = Math.hypot(p.position.x - best.position.x, p.position.z - best.position.z)
  return { type: best.type, dist: +fd.toFixed(2) }
})

let aimInfo = await aim()
let tries = 0
while (aimInfo && aimInfo.dist > 5 && tries < 30) { // teleport landed blocked; let it chase in
  await page.waitForTimeout(500)
  aimInfo = await aim()
  tries++
}

// Face textures start loading when the first zombie is constructed (wave 1
// spawn); poll until at least one live zombie's face material has a map.
let faceLoaded = false
for (let i = 0; i < 30; i++) {
  faceLoaded = await page.evaluate(() => {
    const z = window.__game.zombies.find((z) => !z.isDead && z._face)
    return !!(z && z._face.material.map)
  })
  if (faceLoaded) break
  await page.waitForTimeout(200)
}
await page.waitForTimeout(4000) // let the portrait settle in the view

const shot1 = `${OUT_DIR}/e2e-faces.png`
await page.screenshot({ path: shot1 })
await page.waitForTimeout(10000) // ~20 s mark: second capture if convenient
await aim() // re-place in case the zombie closed in
await page.waitForTimeout(500)
const shot2 = `${OUT_DIR}/e2e-faces-2.png`
await page.screenshot({ path: shot2 })

fs.writeFileSync(`${OUT_DIR}/e2e-faces-console.txt`,
  consoleErrors.length ? consoleErrors.join('\n') + '\n' : '(no console errors)\n')
console.log('FACES PROBE:', JSON.stringify({ zcount, aimInfo, faceLoaded, shot1, shot2, consoleErrors }, null, 1))
const pass = zcount > 0 && faceLoaded && !consoleErrors.some((e) => /404|faces\/.*jpg|Failed to load/i.test(e))
console.log('PROBE-FACES:', pass ? 'PASS' : 'FAIL')
await browser.close()
process.exitCode = pass ? 0 : 1
