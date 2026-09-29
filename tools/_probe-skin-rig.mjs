// Browser probe: with USE_SKINNED_RIG enabled + walker-fixed.glb, confirm a
// spawned zombie renders the repaired skinned mesh (a THREE.SkinnedMesh with a
// skeleton) at ~1.8 m, not the primitive box body. Headless can't load GLBs, so
// this runs in a real page.
import { chromium } from 'playwright-core'

const URL = process.env.DEADFALL_URL || 'http://127.0.0.1:5173/'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('[err] ' + m.text()) })

await page.goto(URL, { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(1000)
await page.evaluate(() => { window.__game.startGame(); window.__game.debug.spawnZombie('walker', 2, 2) })
// Give the GLTFLoader time to fetch + parse walker-fixed.glb.
await page.waitForTimeout(2500)

const report = await page.evaluate(() => {
  const g = window.__game
  const z = g.zombies[0]
  if (!z || !z._skin) return { zombie: !!z, hasSkin: !!(z && z._skin) }
  const sk = z._skin.skinned
  // World-space bounds of the skinned body after bind + animation.
  sk.updateMatrixWorld(true)
  const bb = new (window.__THREE_Box3 || Object)()
  // Use three's Box3 via the geometry boundingBox transformed by matrixWorld.
  const geo = sk.geometry
  if (!geo.boundingBox) geo.computeBoundingBox()
  const mn = geo.boundingBox.min, mx = geo.boundingBox.max
  const m = sk.matrixWorld
  // Approximate world height by transforming min/max y through matrixWorld.
  const y0 = m.elements[5] * mn.y + m.elements[13]
  const y1 = m.elements[5] * mx.y + m.elements[13]
  return {
    zombie: true, hasSkin: true,
    bones: sk.skeleton ? sk.skeleton.bones.length : 0,
    visible: sk.visible,
    matVisible: sk.material ? sk.material.visible !== false : false,
    castShadow: sk.castShadow,
    worldHeight: Math.round((y1 - y0) * 100) / 100,
    localHeight: Math.round((mx.y - mn.y) * 100) / 100
  }
})
console.log('skinned walker:', JSON.stringify(report))
console.log('page errors:', errors.length)
errors.forEach((e) => console.log('  ' + e))

const ok = report.zombie && report.hasSkin && report.bones > 10 && report.visible && report.matVisible && report.worldHeight > 1.0
console.log(ok ? 'SKIN-RIG: PASS — repaired skinned walker renders' : 'SKIN-RIG: FAIL')
await browser.close().catch(() => {})
process.exit(ok ? 0 : 1)