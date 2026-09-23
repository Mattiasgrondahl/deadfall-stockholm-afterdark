// Co-op render diagnosis: two clients join the live server; inspect client A's
// remote proxies (zombie boxes + player avatars) for material brightness,
// positions, visibility, and whether they're lit. Screenshot for VLM.
import { chromium } from 'playwright-core'

const URL = process.env.DEADFALL_URL || 'http://127.0.0.1:8080/'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })

async function mkClient(name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', (e) => console.log(`[${name} pageerror]`, String(e)))
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(800)
  await page.evaluate((n) => {
    window.__game.startMultiplayer({ room: 'default', name: n })
  }, name)
  return page
}

const a = await mkClient('alice')
const b = await mkClient('bob')
await a.waitForTimeout(2500)
await b.waitForTimeout(500)
// Move B so A should see the avatar move.
await b.evaluate(() => { window.__game.debug.setInput({ forward: true }) })
await a.waitForTimeout(1500)

const diag = await a.evaluate(() => {
  const mp = window.__game.multiplayer
  if (!mp) return { err: 'no multiplayer' }
  const out = { players: [], zombies: [], lights: 0 }
  for (const [id, rp] of mp.players) {
    out.players.push({
      id,
      pos: [Math.round(rp.group.position.x * 100) / 100, Math.round(rp.group.position.y * 100) / 100, Math.round(rp.group.position.z * 100) / 100],
      matColor: rp._mat ? rp._mat.color.getHexString() : null,
      emissive: rp._mat ? rp._mat.emissive.getHexString() : null,
      emissiveInt: rp._mat ? rp._mat.emissiveIntensity : null,
      visible: rp.group.visible,
      partCount: rp._parts ? rp._parts.length : 0
    })
  }
  for (const [id, e] of mp.zombies) {
    out.zombies.push({
      id,
      pos: [Math.round(e.mesh.position.x * 100) / 100, Math.round(e.mesh.position.y * 100) / 100, Math.round(e.mesh.position.z * 100) / 100],
      color: e.mesh.material.color.getHexString(),
      emissive: e.mesh.material.emissive.getHexString(),
      emissiveInt: e.mesh.material.emissiveIntensity,
      visible: e.mesh.visible
    })
  }
  let lights = 0
  window.__game.scene.traverse((o) => { if (o.isLight) lights++ })
  out.lights = lights
  out.snapZombieCount = mp.lastSnap ? (mp.lastSnap.zombies || []).length : 0
  out.snapPlayerCount = mp.lastSnap ? (mp.lastSnap.players || []).length : 0
  return out
})
console.log('DIAG:', JSON.stringify(diag, null, 1))
await a.screenshot({ path: 'tools/_coop-shot.png' })
console.log('saved tools/_coop-shot.png')
await browser.close().catch(() => {})