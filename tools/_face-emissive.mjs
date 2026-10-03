// tools/_face-emissive.mjs — v37 R8: zombie FACE emissive 0.5 -> 0.8, measured.
//
// The open item says 0.8 is "a subtle lift, not a glow-up" (measured Sep 25:
// face-crop mean-abs-diff 4.9/255, mean 44.8 -> 45.5). That number came from a
// probe that patched the value in and out. This probe measures the same thing
// with the R7 probe lessons applied:
//   1. start the run (the title screen is a DOM overlay; the 3D scene does not
//      render until START),
//   2. place camera.position explicitly + updateMatrixWorld(true) before
//      projecting, and print the camera position (debug.setPlayerPos does not
//      move the camera when the sim is paused),
//   3. prove the material state per frame (which mesh is the face, its
//      emissiveIntensity, and a canvas fingerprint of its emissiveMap) so a
//      silent no-op swap cannot produce two identical frames.
//
// Face material identity: loadFaceTextures (Zombie.js:576-579) sets
// map + emissiveMap + emissive 0xffffff + emissiveIntensity 0.5, so the face
// plane is the only mesh with a non-null emissiveMap. MAT2:38 (the screamer
// BODY, emissiveIntensity 0.5) is a different material and is asserted by the
// silhouette-contrast test — this probe never touches it.
//
// Run: node tools/_face-emissive.mjs   (needs the dev server on :5173)
import { chromium } from 'playwright-core'
import path from 'node:path'

const WS = path.resolve(import.meta.dirname, '..')
const CHROME = path.join(WS, '.browsers', 'chromium_headless_shell-1243',
  'chrome-headless-shell-linux64', 'chrome-headless-shell')
const URL_BASE = process.env.E2E_URL || 'http://127.0.0.1:5173/'
const OUT = path.join(WS, '.research', 'look')
const LEVELS = [0.5, 0.8]

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(URL_BASE, { waitUntil: 'load' })
await page.waitForTimeout(1200)
await page.click('.screen .btn.primary')
await page.waitForFunction(() => window.__game.debug && window.__game.debug.zombiesAlive() > 0, { timeout: 60000 })
await page.waitForTimeout(2000)

for (const level of LEVELS) {
  const info = await page.evaluate((emissive) => {
    const g = window.__game
    // The face plane is the mesh whose material carries an emissiveMap.
    let face = null
    g.scene.traverse((o) => {
      if (!face && o.isMesh && o.material && o.material.emissiveMap
          && o.material.emissive && o.material.emissive.getHex() === 0xffffff) face = o
    })
    if (!face) return { missing: true }
    face.material.emissiveIntensity = emissive
    face.material.needsUpdate = true

    // Aim at the nearest live zombie's head, then PLACE the camera. The sim is
    // about to be paused, and the camera only syncs inside update() while
    // PLAYING — so the position we set here is the position that renders.
    const zs = (g.zombies || []).filter((z) => !z.isDead && z.group)
    let best = null, bd = 1e9
    for (const z of zs) {
      const d = g.player.camera.position.distanceTo(z.group.position)
      if (d < bd) { bd = d; best = z }
    }
    const head = best.group.position.clone()
    head.y += 1.45
    const c = g.player.camera
    // Stand 2.0 m in front of the head. At the nearest zombie's natural range
    // (measured 11.96 m) the face plane projects to ~10 px and the emissive
    // difference is unmeasurable; at 2 m it is ~70 px.
    c.position.set(head.x + 0.35, head.y + 0.12, head.z + 2.0)
    c.rotation.order = 'YXZ'
    c.lookAt(head)
    c.updateMatrixWorld(true)
    const f = g.flashlight
    if (f) { f.battery = 1; f.on = false; f.spot.intensity = 0 }
    g.state = 'paused'
    c.updateMatrixWorld(true)

    // Fingerprint the emissiveMap so the two frames are provably different
    // textures at provably different intensities.
    const img = face.material.emissiveMap.image
    const cv = document.createElement('canvas')
    cv.width = 64; cv.height = 64
    const ctx = cv.getContext('2d')
    ctx.drawImage(img, 0, 0, 64, 64)
    const d = ctx.getImageData(0, 0, 64, 64).data
    let sum = 0, chk = 0
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      sum += l; chk = (chk * 31 + l) >>> 0
    }
    const pv = head.clone().project(c)
    return {
      emissive: face.material.emissiveIntensity,
      faceGeo: face.geometry.type,
      tex: img ? img.width + 'x' + img.height : 'none',
      fp: { mean: +(sum / (d.length / 4)).toFixed(1), chk },
      dist: +c.position.distanceTo(head).toFixed(2),
      cam: [+c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2)],
      head: [+head.x.toFixed(2), +head.y.toFixed(2), +head.z.toFixed(2)],
      screen: [+((pv.x * 0.5 + 0.5) * 1280).toFixed(0), +((-pv.y * 0.5 + 0.5) * 720).toFixed(0)],
      menuOpen: !!document.querySelector('.screen .btn.primary'),
    }
  }, level)
  await page.waitForTimeout(700)
  const file = path.join(OUT, `v37r8-face-e${level}.png`)
  await page.screenshot({ path: file })
  console.log(`emissive ${info.emissive} dist ${info.dist} m camera ${JSON.stringify(info.cam)} head ${JSON.stringify(info.head)} screen ${JSON.stringify(info.screen)} menuOpen=${info.menuOpen} tex ${info.tex} fp ${JSON.stringify(info.fp)} -> ${path.basename(file)}`)
}
console.log(errors.length ? 'PAGE ERRORS: ' + errors.join(' | ') : 'no page errors')
await browser.close()
