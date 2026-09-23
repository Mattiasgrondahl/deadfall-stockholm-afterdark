// Reproduce the JOIN CO-OP hang: click join, wait, and report whether the page
// is responsive (evaluate a trivial expr with a timeout) + any console errors.
import { chromium } from 'playwright-core'

const URL = process.env.DEADFALL_URL || 'http://127.0.0.1:8080/'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e)))
page.on('console', (m) => { if (/error|Error|fail|warn/i.test(m.text())) console.log('[console]', m.text().slice(0, 160)) })
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(800)
console.log('clicking JOIN CO-OP...')
const t0 = Date.now()
await page.evaluate(() => { window.__game.startMultiplayer({ room: 'default', name: 'probe' }) })
console.log('startMultiplayer returned in', Date.now() - t0, 'ms')
// Check responsiveness after a beat.
await page.waitForTimeout(1500)
let resp = 'ok'
try {
  await Promise.race([
    page.evaluate(() => 1 + 1),
    new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 4000))
  ])
} catch (e) { resp = 'HUNG: ' + e.message }
console.log('responsiveness:', resp)
// Re-check after more gameplay frames to ensure it doesn't hang later.
await page.waitForTimeout(3000)
let resp2 = 'ok'
try {
  await Promise.race([
    page.evaluate(() => 1 + 1),
    new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 4000))
  ])
} catch (e) { resp2 = 'HUNG: ' + e.message }
console.log('responsiveness-later:', resp2)
const state = await page.evaluate(() => {
  const mp = window.__game.multiplayer
  const out = { state: window.__game.state, mp: !!mp, connected: mp && mp.net.connected, zombies: mp ? mp.zombies.size : -1 }
  if (mp && mp.zombies.size) {
    const e = mp.zombies.values().next().value
    if (e.root) {
      e.root.updateMatrixWorld(true)
      const mesh = e.mesh
      let vertexTopY = null, vertexBottomY = null
      if (mesh && mesh.geometry) {
        mesh.geometry.computeBoundingBox()
        const gb = mesh.geometry.boundingBox, mw = mesh.matrixWorld.elements
        const toWorldY = (ly) => mw[1]*ly + mw[5]*ly + mw[9]*ly + mw[13]
        vertexTopY = Math.round(toWorldY(gb.max.y)*100)/100
        vertexBottomY = Math.round(toWorldY(gb.min.y)*100)/100
      }
      let hb = null; e.root.traverse((o) => { if (o.isBone && /head/i.test(o.name) && !hb) hb = o })
      out.rootPos = [Math.round(e.root.position.x*100)/100, Math.round(e.root.position.y*100)/100, Math.round(e.root.position.z*100)/100]
      out.rootScaleY = Math.round(e.root.scale.y*100)/100
      out.liftY = e._liftY != null ? Math.round(e._liftY*100)/100 : null
      out.vertexTopY = vertexTopY
      out.vertexBottomY = vertexBottomY
      out.headBoneWorldY = hb ? Math.round(hb.matrixWorld.elements[13]*100)/100 : null
      out.faceWorldY = e._face ? Math.round(e._face.matrixWorld.elements[13]*100)/100 : null
      out.faceOnBoneY = e._face ? Math.round(e._face.position.y*100)/100 : null
    } else out.noRoot = true
  }
  return out
})
console.log('state:', JSON.stringify(state))
await page.screenshot({ path: new URL('./_coop-shot.png', import.meta.url).pathname })
await browser.close().catch(() => {})