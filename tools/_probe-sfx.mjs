// tools/_probe-sfx.mjs — verify the generated SFX samples load + play in-browser.
// Enters the game, unlocks audio with a click (gesture), waits for the SFX
// buffers to decode, then reports how many loaded and whether shoot() routes a
// decoded buffer (vs the procedural fallback).
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', e => console.log('PAGE ERR:', String(e)))
page.on('console', m => { if (/\[sfx\]/.test(m.text())) console.log('CONSOLE:', m.text()) })
await page.goto('http://localhost:5173', { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(1500)
await page.keyboard.press('Enter')
await page.waitForTimeout(800)
await page.mouse.click(640, 360)
await page.waitForTimeout(600)
// Poll up to ~6s for the SFX buffers to finish decoding.
const result = await page.evaluate(async () => {
  const g = window.__game
  if (!g || !g.audio) return { error: 'no game/audio' }
  const sfx = g.audio._sfx
  if (!sfx) return { error: 'no _sfx bank (loadSfx did not run)' }
  const deadline = Date.now() + 6000
  let count = sfx.buffers.size
  while (Date.now() < deadline && count < 11) {
    await new Promise(r => setTimeout(r, 200))
    count = sfx.buffers.size
  }
  // Trigger a real shot and check the fx bus got a buffer-source voice.
  const before = (g.audio.ctx._created ? g.audio.ctx._created.length : 0)
  const played = g.audio._playSfx('shotgun', { gain: 0.9 })
  return {
    loaded: count,
    total: Object.keys(g.audio._sfx.buffers ? {} : {}).length,
    names: [...sfx.buffers.keys()],
    ctxState: g.audio.ctx ? g.audio.ctx.state : 'none',
    playSfxReturned: played
  }
})
console.log('SFX PROBE:', JSON.stringify(result))
await browser.close()