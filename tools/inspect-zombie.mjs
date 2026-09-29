// tools/inspect-zombie.mjs — headless visual inspector for the v5 skinned zombie.
//
// The live browser in this sandbox dies ~3-5 s after gameplay starts, so a
// normal gameplay screenshot is unreliable. This tool captures the zombie
// BEFORE gameplay begins: it waits for the renderer + scene to exist, spawns a
// single walker at the origin, attaches its loaded rig, poses it (idle/walk),
// frames a debug camera on it, renders one frame, and writes a PNG. That PNG is
// a real visual artifact (not just headless bbox math) so the body/head
// alignment and body size can be eyeballed.
//
// Usage:
//   PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers node tools/inspect-zombie.mjs [type] [state] [out.png]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const URL = process.env.INSPECT_URL || 'http://127.0.0.1:5173'
const TYPE = process.argv[2] || 'walker'
const STATE = process.argv[3] || 'idle'
const OUT = process.argv[4] || path.join('.research', `zombie-${TYPE}-${STATE}.png`)
mkdirSync(path.dirname(OUT), { recursive: true })

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 640, height: 720 } })
const errs = []
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })

await page.goto(URL, { waitUntil: 'load', timeout: 30000 })
await page.waitForFunction('window.__game && window.__game.renderer && window.__game.scene', null, { timeout: 30000 })
await page.waitForTimeout(1200)

// Spawn one zombie at origin, wait for its skin to attach (browser-only load),
// pose it, and frame a camera on it. All before state==='playing'.
const info = await page.evaluate(async ({ type, state }) => {
  const g = window.__game
  
  // Spawn a single zombie near the player spawn so the rig loads + attaches.
  const z = g.spawnZombie ? g.spawnZombie(type, 0, 0) : (g.zombies && g.zombies[0])
  if (!z) return { error: 'no zombie handle' }
  // Wait up to 3 s for the skinned body to attach.
  for (let i = 0; i < 60 && !(z._skin && z._skin.skinned); i++) await new Promise((r) => setTimeout(r, 50))
  if (z._skin && z._skin.skinned) {
    if (z._setSkinState) z._setSkinState(state)
    if (z._skin.mixer) z._skin.mixer.update(0.001)
    z.group.updateMatrixWorld(true)
    z._skin.root.updateMatrixWorld(true)
  }
  // Measure the body bounds vs the head so the report carries numbers too.
  let bounds = null
  if (z._skin && z._skin.skinned) {
    // Use the skinned mesh's own bounding box via three's Box3 reached through
    // the mesh constructor's module (no global THREE needed).
    const box = z._skin.skinned.geometry.boundingBox
    const wm = z._skin.skinned.matrixWorld
    const applyY = (y) => wm.elements[5] * y + wm.elements[13]
    const headY = z._parts[1].matrixWorld.elements[13]
    bounds = {
      feetY: box ? applyY(box.min.y) : null,
      topY: box ? applyY(box.max.y) : null,
      headY,
      scale: z._skin.root.scale.x,
      rootY: z._skin.root.position.y,
    }
  } else if (z.group) {
    // Primitive body: measure the whole group's world bounds via each part's
    // cached geometry (each part is a box; compute min/max y across parts).
    let minY = Infinity, maxY = -Infinity
    for (const p of z._parts) {
      const wm = p.matrixWorld
      if (!p.geometry.boundingBox) p.geometry.computeBoundingBox()
      const gb = p.geometry.boundingBox
      if (!gb) continue
      const y0 = wm.elements[5] * gb.min.y + wm.elements[13]
      const y1 = wm.elements[5] * gb.max.y + wm.elements[13]
      if (y0 < minY) minY = y0
      if (y1 > maxY) maxY = y1
    }
    const headY = z._parts[1].matrixWorld.elements[13]
    bounds = { feetY: minY, topY: maxY, headY, primitive: true }
  }
  // Frame a debug camera on the zombie.
  const cam = g.camera || (g.renderer && g.renderer.xr && g.renderer.xr.getCamera && g.renderer.xr.getCamera())
  if (cam) {
    cam.position.set(0, 1.2, 3.2)
    cam.lookAt(0, 1.0, 0)
    cam.updateProjectionMatrix && cam.updateProjectionMatrix()
  }
  g.renderer.render(g.scene, cam || g.camera)
  return { hasSkin: !!(z._skin && z._skin.skinned), bounds, lodSkinned: z._lodSkinned }
}, { type: TYPE, state: STATE })

console.log('inspect:', JSON.stringify(info))
console.log('errors:', JSON.stringify(errs.slice(0, 4)))
await page.screenshot({ path: OUT })
console.log('wrote', OUT)
await browser.close().catch(() => {})