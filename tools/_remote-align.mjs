// Single remote-zombie alignment probe: inject one zombie, wait for the skinned
// body to build, and report the head-bone world Y vs the server hitbox head
// (world y 1.8) + whether the body is visible + drawn. Confirms the skinned
// remote body lines up with the authoritative hitbox (fixes "too tall" +
// "headshot misses" + "missing body").
import { chromium } from 'playwright-core'

const URL = process.env.DEADFALL_URL || 'http://127.0.0.1:8080/'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e)))
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(800)
await page.evaluate(() => { window.__game.startMultiplayer({ room: 'default', name: 'solo' }) })
await page.waitForTimeout(2000)
await page.evaluate(() => {
  const mp = window.__game.multiplayer
  if (mp && mp._sync) mp._sync({ wave: 1, remaining: 1, players: [{ id: mp.pid, dead: false }], zombies: [
    { id: 'zSolo', type: 'walker', x: 0, z: 3, health: 90, state: 'walk', facing: 0 }
  ], events: [], score: {}, kills: {} })
})
await page.waitForTimeout(1500)
const diag = await page.evaluate(() => {
  const mp = window.__game.multiplayer
  const e = mp && mp.zombies.get('zSolo')
  if (!e) return { err: 'no entry' }
  const out = { skinned: !!e.root, rootPos: e.root ? [Math.round(e.root.position.x*100)/100, Math.round(e.root.position.y*100)/100, Math.round(e.root.position.z*100)/100] : null, rootScale: e.root ? Math.round(e.root.scale.y*100)/100 : null }
  if (e.root) {
    let head = null
    e.root.traverse((o) => { if (o.isBone && /head/i.test(o.name) && !head) head = o })
    e.root.updateMatrixWorld(true)
    // Head world Y from the bone's matrixWorld translation (column 3 = y).
    out.headBoneWorldY = head ? Math.round(head.matrixWorld.elements[13] * 100) / 100 : null
    // Visible crown = max child world Y (bone/mesh translations).
    let top = -Infinity, bottom = Infinity
    e.root.traverse((o) => { const y = o.matrixWorld.elements[13]; if (y > top) top = y; if (y < bottom) bottom = y })
    out.meshTopY = Math.round(top * 100) / 100
    out.meshBottomY = Math.round(bottom * 100) / 100
    out.feetOnGround = Math.abs(e.root.position.y - (e._liftY || 0)) < 0.01 && Math.abs(bottom) < 0.3
    out.hasFace = !!e._face
    out.faceWorldY = e._face ? Math.round(e._face.matrixWorld.elements[13] * 100) / 100 : null
    out.eyeCount = (e._eyes || []).length
    out.color = e.mesh && e.mesh.material ? e.mesh.material.color.getHexString() : null
    out.visible = e.root.visible
  }
  // draw calls + triangles from renderer info
  out.drawCalls = window.__game.renderer.info.render.calls
  out.tris = window.__game.renderer.info.render.triangles
  return out
})
console.log('DIAG:', JSON.stringify(diag))
await page.screenshot({ path: 'tools/_remote-align.png' })
console.log('saved tools/_remote-align.png')
await browser.close().catch(() => {})