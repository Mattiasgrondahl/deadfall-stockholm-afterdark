// Measure the local skinned zombie's real geometry so the face + feet placement
// can be computed correctly: mesh bbox min/max Y, head bone world Y, face world
// Y, root position. Feeds the fix for "face in the stomach" + "body hovering".
import { chromium } from 'playwright-core'

const URL = process.env.DEADFALL_URL || 'http://127.0.0.1:8080/'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e)))
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(800)
await page.evaluate(() => {
  window.__game.startGame()
  window.__game.debug.spawnZombie('walker', 0, 3)
})
await page.waitForTimeout(2500)
const diag = await page.evaluate(() => {
  const z = window.__game.zombies[0]
  if (!z || !z._skin) return { err: 'no skin' }
  z.group.updateMatrixWorld(true)
  z._skin.root.updateMatrixWorld(true)
  const r3 = (v) => [Math.round(v.x*100)/100, Math.round(v.y*100)/100, Math.round(v.z*100)/100]
  // Actual geometry vertex bounds (rest pose) transformed to world via the
  // SkinnedMesh matrixWorld — this is the real visible top/bottom, not bone
  // origins. The SkinnedMesh object origin sits at the hips, so its matrixWorld
  // y is NOT the feet/crown.
  const mesh = z._skin.skinned
  mesh.geometry.computeBoundingBox()
  const gb = mesh.geometry.boundingBox
  const mw = mesh.matrixWorld.elements
  const toWorldY = (ly) => mw[1] * ly + mw[5] * ly + mw[9] * ly + mw[13]
  const vertexTopY = Math.round(toWorldY(gb.max.y) * 100) / 100
  const vertexBottomY = Math.round(toWorldY(gb.min.y) * 100) / 100
  const hb = z._headBone
  const face = z._face
  return {
    rootPos: r3(z._skin.root.position),
    rootScaleY: Math.round(z._skin.root.scale.y*100)/100,
    vertexTopY,
    vertexBottomY,
    headBoneWorldY: hb ? Math.round(hb.matrixWorld.elements[13]*100)/100 : null,
    faceWorldY: face ? Math.round(face.matrixWorld.elements[13]*100)/100 : null,
    faceOnBoneY: face ? Math.round(face.position.y*100)/100 : null,
    zombiePos: r3(z.position)
  }
})
console.log('DIAG:', JSON.stringify(diag))
await browser.close().catch(() => {})