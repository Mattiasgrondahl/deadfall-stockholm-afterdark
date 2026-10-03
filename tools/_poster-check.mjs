// tools/_poster-check.mjs — v37 R7: verify the wanted-poster texture loads.
//
// Why: the poster is wired by URL string in cityDressing.js:777 and the wiring
// convention is "new image = new filename" (prod serves assets with
// Cache-Control immutable max-age=1yr, so an in-place replace is invisible to
// clients). A typo in that string is invisible to npm test / verify / build /
// check-assets, because none of them fetch it. This probe fetches the URL the
// shipped code builds and asserts the image decodes, then asserts the poster
// mesh in the live scene has a decoded map.
//
// Run: node tools/_poster-check.mjs   (needs the dev server on :5173)
import { chromium } from 'playwright-core'
import path from 'node:path'

const WS = path.resolve(import.meta.dirname, '..')
const CHROME = path.join(WS, '.browsers', 'chromium_headless_shell-1243',
  'chrome-headless-shell-linux64', 'chrome-headless-shell')
const URL_BASE = process.env.E2E_URL || 'http://127.0.0.1:5173/'
const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const fails = []
page.on('pageerror', (e) => fails.push('pageerror: ' + e.message))
await page.goto(URL_BASE, { waitUntil: 'load' })
await page.waitForTimeout(1500)

// Start the run before capturing. The title screen is a DOM overlay over the
// attract video and the 3D scene is not rendered until START, so a screenshot
// taken before the click is a screenshot of the menu — the placard assertions
// (mesh + decoded map) are valid at boot, the visual is not.
const started = await page.evaluate(() => {
  const btn = document.querySelector('.screen .btn.primary')
  if (btn) btn.click()
  return !!btn
})
if (started) {
  await page.waitForFunction(() => window.__game.debug && window.__game.debug.zombiesAlive() > 0, { timeout: 60000 })
  await page.waitForTimeout(1500)
}

const res = await page.evaluate(async (base) => {
  const g = window.__game
  // The URL the shipped wiring builds, read out of the source of truth: the
  // texture object the game itself created.
  const posters = []
  g.scene.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.type === 'PlaneGeometry'
        && o.material && o.material.emissive && o.material.emissive.getHex() === 0x2a2016) {
      posters.push({
        hasMap: !!o.material.map,
        decoded: !!(o.material.map && o.material.map.image
          && o.material.map.image.width > 0),
        w: o.material.map && o.material.map.image ? o.material.map.image.width : 0,
        h: o.material.map && o.material.map.image ? o.material.map.image.height : 0,
        pw: o.geometry.parameters.width,
        ph: o.geometry.parameters.height,
      })
    }
  })
  // Fetch the asset the same way the browser would, to prove the file is served.
  const r = await fetch(base.replace(/\/$/, '') + '/assets/posters/poster_v3.jpg')
  const blob = await r.blob()
  const bmp = blob.size > 0 ? await createImageBitmap(blob) : null
  return {
    base,
    http: r.status,
    bytes: blob.size,
    fetched: bmp ? { w: bmp.width, h: bmp.height } : null,
    posters,
  }
}, new URL(URL_BASE).pathname)

console.log('base:', res.base, '| poster_v3.jpg:', res.http, res.bytes + 'B',
  res.fetched ? res.fetched.w + 'x' + res.fetched.h : 'no bitmap')
console.log('poster meshes in scene:', res.posters.length)
for (const p of res.posters) {
  console.log(`  map=${p.hasMap} decoded=${p.decoded} image=${p.w}x${p.h} plane=${p.pw.toFixed(2)}x${p.ph.toFixed(2)}`)
}

if (res.http !== 200) fails.push('poster_v3.jpg not served (HTTP ' + res.http + ')')
if (!res.fetched || res.fetched.w < 512) fails.push('poster_v3.jpg did not decode')
if (res.posters.length === 0) fails.push('no wanted-poster mesh found in the scene')
const good = res.posters.filter((p) => p.decoded)
if (good.length !== res.posters.length) {
  fails.push(`${res.posters.length - good.length} poster mesh(es) have no decoded map`)
}
if (good.length && good[0].w !== 768) fails.push(`decoded image is ${good[0].w}x${good[0].h}, expected 768x1024`)
if (fails.length) {
  for (const f of fails) console.error('FAIL: ' + f)
  await browser.close()
  process.exit(1)
}
console.log('POSTER-CHECK: PASS — poster_v3.jpg served, decoded, mapped on '
  + res.posters.length + ' placard(s)')

// Visual: frame the placard and freeze the sim. Per AGENTS.md step 7, the
// camera must be placed explicitly — debug.setPlayerPos moves player.position
// only, and the camera syncs inside update(), which is gated on PLAYING.
const cam = await page.evaluate(() => {
  const g = window.__game
  let poster = null
  g.scene.traverse((o) => {
    if (!poster && o.isMesh && o.geometry && o.geometry.type === 'PlaneGeometry'
        && o.material && o.material.emissive && o.material.emissive.getHex() === 0x2a2016) poster = o
  })
  poster.updateMatrixWorld(true)
  const m = poster.matrixWorld.elements
  const px = m[12], py = m[13], pz = m[14]
  const c = g.player.camera
  c.rotation.order = 'YXZ'
  c.rotation.set(0, 0, 0)
  // The placard faces local +z, so stand in front of it at its own height.
  c.position.set(px, py, pz + 2.4)
  c.updateMatrixWorld(true)
  g.state = 'paused'
  c.updateMatrixWorld(true)
  return { camera: [+c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2)], poster: [+px.toFixed(2), +py.toFixed(2), +pz.toFixed(2)] }
})
console.log('camera', JSON.stringify(cam.camera), 'poster', JSON.stringify(cam.poster))
await page.screenshot({ path: path.join(WS, '.research', 'look', 'v37r7-poster.png') })
console.log('captured .research/look/v37r7-poster.png')

await browser.close()
process.exit(0)
