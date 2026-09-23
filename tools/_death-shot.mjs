// Visual confirmation of the zombie DEATH collapse: spawn a walker in front of
// the player, kill it, let the collapse play, screenshot, and report the head/
// arm bone rotations so we can confirm the corpse pose actually deforms the
// visible skinned body.
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
await page.waitForTimeout(2500)
// Kill it via the debug hook (or direct hp) and let the collapse play.
await page.evaluate(() => {
  const z = window.__game.zombies[0]
  if (z) { z.hp = 0; z.isDead = true; z.deathTimer = 0 }
})
await page.waitForTimeout(1800) // let flop progress

const diag = await page.evaluate(() => {
  const g = window.__game
  const z = g.zombies[0]
  if (!z) return { reason: 'no zombie' }
  const hb = z._headBone
  const arms = (z._armBones || []).map((a) => ({ x: Math.round(a.bone.rotation.x * 100) / 100, z: Math.round(a.bone.rotation.z * 100) / 100 }))
  g.renderer.info.reset()
  g.renderer.render(g.scene, g.camera)
  return {
    isDead: z.isDead,
    deathTimer: Math.round(z.deathTimer * 100) / 100,
    groupRotX: Math.round(z.group.rotation.x * 100) / 100,
    headBoneRotX: hb ? Math.round(hb.rotation.x * 100) / 100 : null,
    armBones: arms,
    deathPosed: !!z._deathPosed,
    drawCalls: g.renderer.info.render.calls,
    triangles: g.renderer.info.render.triangles
  }
})
console.log('death diag:', JSON.stringify(diag))
await page.screenshot({ path: 'tools/_death-shot.png' })
console.log('saved tools/_death-shot.png')
await browser.close().catch(() => {})