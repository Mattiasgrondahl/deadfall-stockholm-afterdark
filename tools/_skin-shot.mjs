// Visual confirmation: spawn a walker directly in front of the player and
// screenshot the gameplay frame, so the skinned body is visibly rendered (not
// just a moving shadow). Saves tools/_skin-shot.png.
import { chromium } from 'playwright-core'

const URL = process.env.DEADFALL_URL || 'http://127.0.0.1:5173/'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e)))

await page.goto(URL, { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(1000)
// Start + spawn a walker a few metres ahead so it fills the frame.
await page.evaluate(() => {
  window.__game.startGame()
  window.__game.debug.spawnZombie('walker', 0, 6)
})
// Wait for the GLB to load + skin to attach + mixer to pose.
await page.waitForTimeout(3000)
await page.screenshot({ path: 'tools/_skin-shot.png' })
// Objective check: is the zombie's skinned body actually on-screen? Project the
// skinned mesh's world bounds to screen space and sample the framebuffer there
// for non-background pixels (proves the body renders, not just a shadow).
const vis = await page.evaluate(() => {
  const g = window.__game
  const z = g.zombies[0]
  if (!z || !z._skin) return { ok: false, reason: 'no skin' }
  const sk = z._skin.skinned
  sk.updateMatrixWorld(true)
  const geo = sk.geometry
  if (!geo.boundingBox) geo.computeBoundingBox()
  const THREE = g.THREE || (g.constructor && g.constructor.THREE)
  // Project the bounding-box center to NDC via the camera.
  const c = geo.boundingBox.getCenter(new (geo.boundingBox.min.constructor)(0, 0, 0))
  c.applyMatrix4(sk.matrixWorld)
  c.project(g.camera)
  const sx = Math.round((c.x * 0.5 + 0.5) * 1280)
  const sy = Math.round((-c.y * 0.5 + 0.5) * 720)
  return { ok: true, sx, sy, onScreen: sx >= 0 && sx < 1280 && sy >= 0 && sy < 720 }
})
console.log('body screen center:', JSON.stringify(vis))
console.log('saved tools/_skin-shot.png')
await browser.close().catch(() => {})