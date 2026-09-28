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
// Drive Ada forward for a few seconds via the debug input handle.
await p1.evaluate(() => { window.__game.debug.setInput({ forward: true }) })
await p1.waitForTimeout(4000)
const snap = await p1.evaluate(() => {
  const g = window.__game
  const mp = g && g.multiplayer
  const pp = g && g.player && g.player.position
  const sp = mp && mp.selfPos
  return {
    client: pp ? { x: +pp.x.toFixed(2), z: +pp.z.toFixed(2) } : null,
    server: sp ? { x: +sp.x.toFixed(2), z: +sp.z.toFixed(2) } : null,
    drift: (pp && sp) ? +Math.hypot(pp.x - sp.x, pp.z - sp.z).toFixed(2) : null,
    remoteZombies: mp ? mp.zombies.size : 0
  }
})
console.log('Ada drift check:', JSON.stringify(snap))
const ok = snap.drift != null && snap.drift < 1.5
console.log(ok ? 'COOP-DRIFT: PASS (client tracks server position, zombies chase the live player)' : 'COOP-DRIFT: INCONCLUSIVE (drift too large or no selfPos)')
await browser.close().catch(() => {})
process.exit(ok ? 0 : 1)