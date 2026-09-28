// Live co-op HP probe: two browsers join a room; confirm the local player's
// health actually drops from server-side zombie damage (the user's complaint:
// "zombies don't do damage like single-player"). Reads window.__game over time.
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
// Let waves spawn + zombies close in.
await p1.waitForTimeout(9000)
const snap = await p1.evaluate(() => {
  const g = window.__game
  const mp = g && g.multiplayer
  return {
    state: g && g.state,
    health: g && g.player && g.player.health,
    mpSelfHealth: mp && mp.selfHealth,
    remoteZombies: mp ? mp.zombies.size : 0,
    dead: g && g.player && g.player.isDead
  }
})
console.log('Ada after 9s:', JSON.stringify(snap))
const ok = snap.mpSelfHealth != null && (snap.health < 100 || snap.mpSelfHealth < 100)
console.log(ok ? 'COOP-HP: PASS (server damage reached the local player)' : 'COOP-HP: INCONCLUSIVE (no damage yet — may need more time/positioning)')
await browser.close().catch(() => {})
process.exit(ok ? 0 : 1)