// Live co-op drift probe: two browsers join a room; measure the gap between the
// client's local player position and the server-authoritative selfPos over time.
// Before the fix these drifted (zombies chased the server point, not the client).
// After the fix the reconciliation keeps them within a small tolerance.
import { chromium } from 'playwright-core'
const EXE = '/home/mgr/Workspace/Zombie/.browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'
const URL = 'http://127.0.0.1:5173/'
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
async function joiner(name) {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } })
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(1000)
  await page.evaluate((n) => {
    const ins = document.querySelectorAll('.mp-input')
    ins[0].value = 'arena'; ins[1].value = n
    const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent === 'JOIN CO-OP')
    b.click()
  }, name)
  await page.waitForTimeout(1500)
  return page
}
const p1 = await joiner('Ada')
const p2 = await joiner('Bob')
// Turn Ada gradually with the mouse (realistic look) while driving forward, the
// way a real player does. Before the yaw fix the server kept facing the spawn
// direction, so W slid the player sideways and the reconciliation held them back
// ("invisible wall"). The client now sends its authoritative yaw each frame, so
// the server moves the player along the SAME heading the client sees.
await p1.evaluate(() => {
  const g = window.__game
  g.debug.setInput({ forward: true })
  // Accumulate a gentle yaw turn over the run (mouselook feeds turnX each frame).
  g._probeTurn = setInterval(() => { g.player.inputState.turnX -= 0.02 }, 33)
})
await p1.waitForTimeout(4000)
await p1.evaluate(() => { clearInterval(window.__game._probeTurn) })
const snap = await p1.evaluate(() => {
  const g = window.__game
  const mp = g && g.multiplayer
  const pp = g && g.player && g.player.position
  const sp = mp && mp.selfPos
  return {
    yaw: g && g.player ? +g.player.yaw.toFixed(2) : null,
    client: pp ? { x: +pp.x.toFixed(2), z: +pp.z.toFixed(2) } : null,
    server: sp ? { x: +sp.x.toFixed(2), z: +sp.z.toFixed(2) } : null,
    drift: (pp && sp) ? +Math.hypot(pp.x - sp.x, pp.z - sp.z).toFixed(2) : null,
    travelled: pp ? +Math.hypot(pp.x, pp.z).toFixed(2) : null,
    remoteZombies: mp ? mp.zombies.size : 0
  }
})
console.log('Ada movement check:', JSON.stringify(snap))
// The player must travel freely along their heading (no invisible wall): ~3 m/s
// forward for 4 s ≈ 12 m, and stay in sync with the server.
const moved = snap.travelled != null && snap.travelled > 8
const inSync = snap.drift != null && snap.drift < 2
console.log(moved && inSync ? 'COOP-MOVE: PASS (player walks freely along their heading, in sync with server)' : 'COOP-MOVE: FAIL (player blocked or out of sync)')
await browser.close().catch(() => {})
process.exit(moved && inSync ? 0 : 1)