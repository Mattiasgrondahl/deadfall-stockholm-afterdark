// Two real browsers join the same room through the vite /ws proxy and must see
// each other in snapshots (Phase 1 exit criterion, browser-side).
import { chromium } from 'playwright-core'
const EXE = '/home/mgr/Workspace/Zombie/.browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'
const URL = 'http://127.0.0.1:5173/'
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const errors = []
async function joiner(name) {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } })
  page.on('pageerror', (e) => errors.push(name + ': ' + String(e)))
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
await new Promise(r => setTimeout(r, 2500))
const st = await Promise.all([p1, p2].map(async (p, i) => p.evaluate(() => {
  const g = window.__game
  const mp = g && g.multiplayer
  return {
    state: g && g.state,
    pid: mp && mp.pid,
    connected: mp && mp.connected,
    remoteIds: mp ? Array.from(mp.players.keys()) : [],
    snapRoster: mp && mp.lastSnap ? (mp.lastSnap.roster || []).map(r => r.name || r.id) : []
  }
})))
console.log('p1:', JSON.stringify(st[0]))
console.log('p2:', JSON.stringify(st[1]))
const ok = st[0].connected && st[1].connected &&
  st[0].remoteIds.includes(st[1].pid) && st[1].remoteIds.includes(st[0].pid)
console.log('page errors:', errors.length); errors.forEach(e => console.log('  ' + e))
console.log(ok ? 'CO-OP-LIVE: PASS (each client renders the other)' : 'CO-OP-LIVE: FAIL')
await browser.close().catch(() => {})
process.exit(ok ? 0 : 1)
