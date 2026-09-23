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
  if (!z) return { err: 'no zombie' }
  z.group.updateMatrixWorld(true)
  const r3 = (v) => [Math.round(v.x*100)/100, Math.round(v.y*100)/100, Math.round(v.z*100)/100]
  // Effective visibility: a node renders only if it and all ancestors are visible.
  const effVis = (o) => { let n = o; while (n) { if (!n.visible) return false; n = n.parent } return true }
  const rigEff = z._skin && z._skin.skinned ? effVis(z._skin.skinned) : null
  const torsoEff = effVis(z._parts[0])
  const headEff = effVis(z._parts[1])
  const faceEff = z._face ? effVis(z._face) : null
  const faceWorldY = z._face ? Math.round(z._face.matrixWorld.elements[13]*100)/100 : null
  const faceParent = z._face && z._face.parent ? z._face.parent.name || (z._face.parent.isBone ? 'bone' : 'mesh') : null
  return {
    rigEffVisible: rigEff,
    torsoEffVisible: torsoEff,
    headEffVisible: headEff,
    faceEffVisible: faceEff,
    faceWorldY,
    faceParent,
    rootVisible: z._skin ? z._skin.root.visible : null,
    drawCalls: window.__game.renderer.info.render.calls,
    triangles: window.__game.renderer.info.render.triangles
  }
})
console.log('DIAG:', JSON.stringify(diag))
await browser.close().catch(() => {})