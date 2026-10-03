// tools/_poster-emissive.mjs — v37 R7: can the placard's own emissive carry
// poster_v3 in the dark?
//
// Measured in gameplay at 2.4 m (tools/_poster-ab.mjs): poster_v3 lands at
// 20.4 rect luma / 11.9 text-band luma unlit, poster_v2 at 28.5 / 21.9. v3 is
// a darker source (mean 90.7 vs 164.8), so shipping it is a readability
// regression in the unlit case. The placard material is self-lit
// (emissive 0x2a2016, emissiveIntensity 0.25 when a texture is mapped —
// cityDressing.js), which is the one knob that brightens the poster without
// touching the 40-light budget. Sweep it and find the value where v3 matches
// v2's unlit text band.
//
// Run: node tools/_poster-emissive.mjs   (needs the dev server on :5173)
import { chromium } from 'playwright-core'
import path from 'node:path'

const WS = path.resolve(import.meta.dirname, '..')
const CHROME = path.join(WS, '.browsers', 'chromium_headless_shell-1243',
  'chrome-headless-shell-linux64', 'chrome-headless-shell')
const URL_BASE = process.env.E2E_URL || 'http://127.0.0.1:5173/'
const OUT = path.join(WS, '.research', 'look')
const LEVELS = [0.8]

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(URL_BASE, { waitUntil: 'load' })
await page.waitForTimeout(1200)
await page.click('.screen .btn.primary')
await page.waitForFunction(() => window.__game.debug && window.__game.debug.zombiesAlive() > 0, { timeout: 60000 })
await page.waitForTimeout(1500)

for (const e of LEVELS) {
  const info = await page.evaluate((emissive) => {
    const g = window.__game
    let poster = null
    g.scene.traverse((o) => {
      if (!poster && o.isMesh && o.geometry && o.geometry.type === 'PlaneGeometry'
          && o.material && o.material.emissive && o.material.emissive.getHex() === 0x2a2016) poster = o
    })
    poster.material.emissiveIntensity = emissive
    poster.material.needsUpdate = true
    poster.updateMatrixWorld(true)
    const m = poster.matrixWorld.elements
    const c = g.player.camera
    c.rotation.order = 'YXZ'
    c.rotation.set(0, 0, 0)
    c.position.set(m[12], m[13], m[14] + 2.4)
    c.updateMatrixWorld(true)
    const f = g.flashlight
    if (f) { f.battery = 1; f.on = true; f.spot.intensity = 55 }
    g.state = 'paused'
    c.updateMatrixWorld(true)
    const img = poster.material.map && poster.material.map.image
    return { emissive: poster.material.emissiveIntensity, tex: img ? img.width + 'x' + img.height : 'none' }
  }, e)
  await page.waitForTimeout(700)
  const file = path.join(OUT, `v37r7-poster-e${e}-lit.png`)
  await page.screenshot({ path: file })
  console.log(`emissive ${info.emissive} texture ${info.tex} -> ${path.basename(file)}`)
}
await browser.close()
