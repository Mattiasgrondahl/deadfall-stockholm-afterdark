// Reproduce the ~30 s co-op freeze: join co-op, then sample responsiveness +
// scene stats + zombie-map size + falling-limb totals every few seconds for
// ~45 s. Reports the first sample where the page stops responding and the
// counters at that point, to pinpoint the leak/runaway.
import { chromium } from 'playwright-core'

const URL = process.env.DEADFALL_URL || 'http://127.0.0.1:8080/'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e)))
page.on('console', (m) => { if (/error|Error|fail|warn/i.test(m.text())) console.log('[console]', m.text().slice(0, 160)) })
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(800)
await page.evaluate(() => { window.__game.startMultiplayer({ room: 'default', name: 'probe' }) })
console.log('joined co-op')
// Drive the player + fire continuously so the weapon hit path + HIT messages run.
await page.evaluate(() => {
  window.__probeFire = true
  const g = window.__game
  // Hold forward + fire every frame via the debug input hook.
  const loop = () => {
    if (!window.__probeFire) return
    g.debug.setInput({ forward: true, fire: true })
    requestAnimationFrame(loop)
  }
  loop()
})

async function sample(label) {
  let resp = 'ok'
  try {
    await Promise.race([
      page.evaluate(() => 1 + 1),
      new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 3000))
    ])
  } catch (e) { resp = 'HUNG' }
  let stats = {}
  try {
    stats = await page.evaluate(() => {
      const mp = window.__game.multiplayer
      const g = window.__game
      let meshes = 0
      g.scene.traverse((o) => { if (o.isMesh) meshes++ })
      let falling = 0, parts = 0
      if (mp) for (const e of mp.zombies.values()) {
        if (e._falling) falling += e._falling.length
        if (e._parts) parts += e._parts.length
      }
      return { state: g.state, zombies: mp ? mp.zombies.size : -1, targets: mp ? mp.getTargets().length : -1, meshes, falling, parts }
    })
  } catch (e) { stats = { evalErr: String(e).slice(0, 80) } }
  console.log(label, 'resp=' + resp, JSON.stringify(stats))
  return resp
}

let firstHang = null
for (let t = 0; t <= 45; t += 5) {
  await page.waitForTimeout(5000)
  const r = await sample('t=' + (t + 5) + 's')
  if (r === 'HUNG' && firstHang === null) { firstHang = t + 5; console.log('*** FIRST HANG at', firstHang, 's ***'); break }
}
console.log('done. firstHang=', firstHang)
await browser.close().catch(() => {})