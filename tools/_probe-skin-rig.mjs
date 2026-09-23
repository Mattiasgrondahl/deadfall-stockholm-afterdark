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
  if (!z) return { zombie: false }
  // Walk the zombie's object tree for a SkinnedMesh.
  let skinned = null, height = 0
  z.group.traverse((o) => {
    if (o.isSkinnedMesh && !skinned) {
      skinned = { bones: o.skeleton ? o.skeleton.bones.length : 0 }
      const bb = o.geometry.boundingBox || (o.geometry.computeBoundingBox(), o.geometry.boundingBox)
      if (bb) height = bb.max.y - bb.min.y
    }
  })
  return {
    zombie: true,
    hasSkinned: !!skinned,
    bones: skinned ? skinned.bones : 0,
    meshHeight: Math.round(height * 100) / 100,
    skinnedCount: (() => { let n = 0; z.group.traverse(o => { if (o.isSkinnedMesh) n++ }); return n })()
  }
})
console.log('skinned walker:', JSON.stringify(report))
console.log('page errors:', errors.length)
errors.forEach((e) => console.log('  ' + e))

const ok = report.zombie && report.hasSkinned && report.bones > 10 && report.meshHeight > 1.0
console.log(ok ? 'SKIN-RIG: PASS — repaired skinned walker renders' : 'SKIN-RIG: FAIL')
await browser.close().catch(() => {})
process.exit(ok ? 0 : 1)