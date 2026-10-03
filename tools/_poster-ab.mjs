// tools/_poster-ab.mjs — v37 R7: is poster_v3 more readable on the placard than poster_v2?
//
// The placard is lit by one 2.4-intensity spot at 6 m and the renderer tone
// maps ACESFilmic at exposure 1.2, so a bright source image can arrive on
// screen crushed. The VLM looked at the v3 placard frame and said "no visible
// wanted poster", so the shipping decision needs a like-for-like comparison:
// identical camera, identical world, identical lighting, only the texture
// swapped. The route interceptor serves poster_v2.jpg bytes at the
// poster_v3.jpg URL, so the shipped code path is unchanged in both frames.
//
// The swap is PROVEN per frame by decoding the loaded texture to a canvas and
// hashing its pixels — the two sources are 768x1024, so dimensions cannot tell
// them apart (a first run of this probe reported "768x1024" for both and
// produced identical photometrics, i.e. an unproven swap is invisible).
import { chromium } from 'playwright-core'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const WS = path.resolve(import.meta.dirname, '..')
const CHROME = path.join(WS, '.browsers', 'chromium_headless_shell-1243',
  'chrome-headless-shell-linux64', 'chrome-headless-shell')
const URL_BASE = process.env.E2E_URL || 'http://127.0.0.1:5173/'
const OUT = path.join(WS, '.research', 'look')
const V2 = path.join(WS, 'public', 'assets', 'posters', 'poster_v2.jpg')

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

for (const [tag, swap, lit] of [['v3', false, false], ['v2', true, false], ['v3-lit', false, true]]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  let hits = 0
  if (swap) {
    await page.route('**/poster_v3.jpg', (route) => {
      hits++
      return route.fulfill({
        status: 200, contentType: 'image/jpeg', body: readFileSync(V2),
      })
    })
  }
  await page.goto(URL_BASE, { waitUntil: 'load' })
  await page.waitForTimeout(1200)
  // The title screen is a DOM overlay over the attract video; the 3D scene is
  // not rendered until the run starts. A probe that screenshots before START
  // measures the menu, not the placard (measured: all three "poster" frames
  // came back photometrically identical, and the VLM read difficulty text).
  await page.click('.screen .btn.primary')
  await page.waitForFunction(() => window.__game.debug && window.__game.debug.zombiesAlive() > 0, { timeout: 60000 })
  await page.waitForTimeout(1500)
  const info = await page.evaluate((lit) => {
    const g = window.__game
    let poster = null
    g.scene.traverse((o) => {
      if (!poster && o.isMesh && o.geometry && o.geometry.type === 'PlaneGeometry'
          && o.material && o.material.emissive && o.material.emissive.getHex() === 0x2a2016) poster = o
    })
    poster.updateMatrixWorld(true)
    const m = poster.matrixWorld.elements
    const c = g.player.camera
    c.rotation.order = 'YXZ'
    c.rotation.set(0, 0, 0)
    c.position.set(m[12], m[13], m[14] + 2.4)
    c.updateMatrixWorld(true)
    // The flashlight is parented to the camera, so aiming = placing the camera.
    // Pin it (paused update() would otherwise drain/reset it): battery full,
    // on, intensity at the module BASE_INTENSITY of 55 cd.
    const f = g.flashlight
    if (f) { f.battery = 1; f.on = lit; f.spot.intensity = lit ? 55 : 0 }
    g.state = 'paused'
    c.updateMatrixWorld(true)
    // Fingerprint the loaded texture: 64x64 downsample, mean luma + checksum.
    const img = poster.material.map && poster.material.map.image
    let fp = null
    if (img && typeof document !== 'undefined') {
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64
      const cx = cv.getContext('2d')
      cx.drawImage(img, 0, 0, 64, 64)
      const d = cx.getImageData(0, 0, 64, 64).data
      let sum = 0, chk = 0
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
        sum += l; chk = (chk * 31 + Math.round(l)) >>> 0
      }
      fp = { mean: +(sum / (d.length / 4)).toFixed(1), chk }
    }
    return { cam: [+c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2)], fp, lit: !!(f && f.on),
      menuOpen: !!document.querySelector('.screen .btn.primary') }
  }, lit)
  await page.waitForTimeout(900)
  const file = path.join(OUT, `v37r7-poster-${tag}.png`)
  await page.screenshot({ path: file })
  console.log(`${tag}: camera ${JSON.stringify(info.cam)} lit=${info.lit} menuOpen=${info.menuOpen} texture ${JSON.stringify(info.fp)} routeHits=${hits} -> ${path.basename(file)}`)
  await page.close()
}
await browser.close()
