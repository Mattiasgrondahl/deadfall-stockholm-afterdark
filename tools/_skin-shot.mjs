// Visual confirmation: spawn a walker directly in front of the player, force a
// render, screenshot the frame, and report face/head/eye world positions + draw
// calls so we can tell whether the skinned body + face actually render.
import { chromium } from 'playwright-core'

const URL = process.env.DEADFALL_URL || 'http://127.0.0.1:5173/'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e)))

await page.goto(URL, { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(1000)
await page.evaluate(() => {
  window.__game.startGame()
  window.__game.debug.spawnZombie('walker', 0, 3)
  const z = window.__game.zombies[0]
  if (z) z.position.set(0, 0, 3)
})
await page.waitForTimeout(3000)

const diag = await page.evaluate(() => {
  const g = window.__game
  const z = g.zombies[0]
  if (!z || !z._skin) return { reason: 'no skin' }
  const sk = z._skin.skinned
  const r3 = (v) => v ? [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100] : null
  const hb = z._headBone, face = z._face, eye0 = (z._eyes || [])[0]
  g.renderer.info.reset()
  g.renderer.render(g.scene, g.camera)
  const info = g.renderer.info.render
  return {
    drawCalls: info.calls, triangles: info.triangles,
    headBonePos: r3(hb && hb.getWorldPosition(hb.position.clone())),
    facePos: r3(face && face.getWorldPosition(face.position.clone())),
    faceVis: face ? face.visible : null,
    eyeVis: eye0 ? eye0.visible : null,
    eyePos: r3(eye0 && eye0.getWorldPosition(eye0.position.clone())),
    matColor: sk.material && sk.material.color ? sk.material.color.getHexString() : null,
    matEmissive: sk.material && sk.material.emissive ? sk.material.emissive.getHexString() : null,
    matEmissiveInt: sk.material ? sk.material.emissiveIntensity : null,
    matMap: sk.material ? !!sk.material.map : null,
    skinnedVisible: sk.visible,
    rootPos: r3(z._skin.root.position),
    zombiePos: r3(z.position),
    camPos: r3(g.camera.position),
    camRot: [Math.round(g.camera.rotation.x * 100) / 100, Math.round(g.camera.rotation.y * 100) / 100, Math.round(g.camera.rotation.z * 100) / 100]
  }
})
console.log('diag:', JSON.stringify(diag))
await page.screenshot({ path: 'tools/_skin-shot.png' })
console.log('saved tools/_skin-shot.png')
await browser.close().catch(() => {})