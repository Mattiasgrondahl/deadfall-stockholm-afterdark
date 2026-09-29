// Visual confirmation of per-type silhouette variety: spawn a screamer (lanky)
// and a brute (broad) side by side in front of the player, screenshot, and
// report each type's root scale so we can confirm the crowd reads as varied.
import { chromium } from 'playwright-core'

const URL = process.env.DEADFALL_URL || 'http://127.0.0.1:5173/'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e)))

await page.goto(URL, { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(1000)
await page.evaluate(() => {
  window.__game.startGame()
  window.__game.debug.spawnZombie('screamer', -1.2, 3)
  window.__game.debug.spawnZombie('brute', 1.2, 3)
  const zs = window.__game.zombies
  if (zs[0]) zs[0].position.set(-1.2, 0, 3)
  if (zs[1]) zs[1].position.set(1.2, 0, 3)
})
await page.waitForTimeout(3000)

const diag = await page.evaluate(() => {
  const g = window.__game
  return g.zombies.map((z) => ({
    type: z.type,
    rootScale: z._skin ? [Math.round(z._skin.root.scale.x * 100) / 100, Math.round(z._skin.root.scale.y * 100) / 100] : null,
    color: z._skin && z._skin.skinned.material ? z._skin.skinned.material.color.getHexString() : null,
    visible: z._skin ? z._skin.skinned.visible : null
  }))
})
console.log('types:', JSON.stringify(diag))
await page.screenshot({ path: 'tools/_variety-shot.png' })
console.log('saved tools/_variety-shot.png')
await browser.close().catch(() => {})