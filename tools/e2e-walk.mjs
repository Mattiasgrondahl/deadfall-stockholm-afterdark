// E2E probe: procedural walk cycle. Loads the game, starts it (Enter, button
// fallback), waits for wave-1 zombies, uses the debug helpers to place the
// player ~3.4 m in front of a live zombie so it walks toward them, captures
// limb rotations + a screenshot, waits ~1.2 s, captures again. The two frames
// must differ in limb pose; console/page errors must be zero.
// Modeled on tools/e2e-faces.mjs.
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

// Place the player 3.4 m ahead of the closest live zombie (along the current
// relative direction) so it chases — and therefore walks. Heal so melee hits
// during the capture never kill the player.
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
await page.waitForTimeout(300) // settle into the chase

// Snapshot limb rotations of the nearest live zombie (probe for pose change).
const pose = async () => page.evaluate(() => {
  const g = window.__game
  const zs = g.zombies.filter((z) => !z.isDead && z._armL)
  if (!zs.length) return null
  let best = zs[0], bd = Infinity
  const p = g.player
  for (const z of zs) {
    const d = Math.hypot(z.position.x - p.position.x, z.position.z - p.position.z)
    if (d < bd) { bd = d; best = z }
  }
  return {
    armL: +best._armL.rotation.x.toFixed(4),
    armR: +best._armR.rotation.x.toFixed(4),
    legL: +best._legL.rotation.x.toFixed(4),
    legR: +best._legR.rotation.x.toFixed(4)
  }
})

const shot1 = `${OUT_DIR}/e2e-walk-a.png`
const poseA = await pose()
await page.screenshot({ path: shot1 })
await page.waitForTimeout(1200) // ~1.2 s later — well past one swing half-cycle
const poseB = await pose()
const shot2 = `${OUT_DIR}/e2e-walk-b.png`
await page.screenshot({ path: shot2 })

fs.writeFileSync(`${OUT_DIR}/e2e-walk-console.txt`,
  consoleErrors.length ? consoleErrors.join('\n') + '\n' : '(no console errors)\n')

const poseDiff = poseA && poseB &&
  (Math.abs(poseA.armL - poseB.armL) > 1e-4 || Math.abs(poseA.legL - poseB.legL) > 1e-4)
console.log('WALK PROBE:', JSON.stringify({ zcount, aimInfo, poseA, poseB, poseDiff, shot1, shot2, consoleErrors }, null, 1))
const pass = zcount > 0 && poseDiff && consoleErrors.length === 0
console.log('PROBE-WALK:', pass ? 'PASS' : 'FAIL')
await browser.close()
process.exitCode = pass ? 0 : 1
