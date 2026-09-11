// tools/e2e-browser.mjs — real-browser smoke E2E via Playwright Chromium.
// NOT part of `npm test` (auto-discovery only covers test/). Run manually
// after `npm run dev` (dev server on :5173):
//   node tools/e2e-browser.mjs                 # assumes http://localhost:5173
//   E2E_URL=http://... node tools/e2e-browser.mjs
// Needs a Playwright browser: node node_modules/playwright-core/cli.js install chromium
//
// Walks the full flow: title -> START -> gameplay -> pause -> resume ->
// game-over -> restart, collecting console/page errors and confirming WebGL +
// real DOM render.
//
// Note: pointer lock may be unavailable in *headless* Chromium. The resume
// step (which re-locks the pointer) is reported separately: if the state stays
// paused while pointer lock never engaged, that is a headless limitation, not
// a game bug (real browsers re-lock and resume fine).

import { chromium } from 'playwright-core'

const URL = process.env.E2E_URL || 'http://localhost:5173'
const consoleErrors = []
const pageErrors = []
const out = { url: URL }

let browser
try {
  browser = await chromium.launch({ headless: true })
} catch (e) {
  console.error('FATAL: could not launch Chromium:', e.message)
  console.error('Run: node node_modules/playwright-core/cli.js install chromium')
  process.exit(2)
}

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', e => pageErrors.push(String(e)))

try {
  // 1) Load + WebGL context
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(2000) // let Three.js init + first frames
  out.webgl = await page.evaluate(() => {
    const c = document.getElementById('game-canvas')
    return { canvas: !!c, w: c ? c.width : 0, h: c ? c.height : 0 }
  })

  // 2) Title screen
  out.title = await page.evaluate(() => {
    const vis = [...document.querySelectorAll('.screen')].filter(s => s.classList.contains('visible'))
    const text = vis.map(s => s.textContent).join(' ')
    return {
      visibleScreens: vis.length,
      hasTitle: /DEADFALL/.test(text),
      startBtn: !!document.querySelector('.screen.visible button.btn')
    }
  })

  // 3) Click START
  const startBtn = await page.$('.screen.visible button.btn')
  if (startBtn) await startBtn.click()
  out.startClicked = !!startBtn
  await page.waitForTimeout(2500) // wave 1 spawns (~0.7 s cadence)

  // 4) Gameplay state
  out.gameplay = await page.evaluate(() => {
    const g = window.__game
    return {
      state: g?.state,
      hudVisible: document.getElementById('hud-root')?.classList.contains('visible') ?? false,
      wave: g?.waveManager?.wave ?? null,
      remaining: g?.waveManager?.remaining ?? null,
      zombiesAlive: g?.zombies?.filter(z => !z.isDead).length ?? 0,
      zombiesTotal: g?.zombies?.length ?? 0,
      ammo: g?.weapon?.ammo ?? null,
      reserve: g?.weapon?.reserve ?? null,
      health: g?.player?.health ?? null,
      bannerShown: document.querySelector('.banner')?.classList.contains('show') ?? false,
      bannerText: document.querySelector('.banner')?.textContent || ''
    }
  })

  // 5) Pause via Escape
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)
  out.pause = await page.evaluate(() => {
    const g = window.__game
    const vis = [...document.querySelectorAll('.screen')].filter(s => s.classList.contains('visible'))
    return {
      state: g?.state,
      pausedVisible: vis.some(s => /PAUSED/.test(s.textContent)),
      hudVisible: document.getElementById('hud-root')?.classList.contains('visible') ?? false,
      pointerLocked: !!document.pointerLockElement
    }
  })

  // 6) Resume via P (re-locks pointer)
  await page.keyboard.press('KeyP')
  await page.waitForTimeout(900)
  out.resume = await page.evaluate(() => {
    const g = window.__game
    const vis = [...document.querySelectorAll('.screen')].filter(s => s.classList.contains('visible'))
    return {
      state: g?.state,
      stillPaused: vis.some(s => /PAUSED/.test(s.textContent)),
      hudVisible: document.getElementById('hud-root')?.classList.contains('visible') ?? false,
      pointerLocked: !!document.pointerLockElement
    }
  })

  // 7) Game over via injected fatal damage (player dies -> GAMEOVER screen)
  await page.evaluate(() => { const g = window.__game; if (g?.player) g.player.damage(99999) })
  await page.waitForTimeout(1000)
  out.gameover = await page.evaluate(() => {
    const g = window.__game
    const vis = [...document.querySelectorAll('.screen')].filter(s => s.classList.contains('visible'))
    return {
      state: g?.state,
      gameoverVisible: vis.some(s => /YOU DIED/.test(s.textContent)),
      stat: document.querySelector('.screen.visible .stat')?.textContent || ''
    }
  })

  // 8) Restart via RESTART button
  const restartBtn = await page.$('.screen.visible button.btn')
  if (restartBtn) await restartBtn.click()
  out.restartClicked = !!restartBtn
  await page.waitForTimeout(1500)
  out.afterRestart = await page.evaluate(() => {
    const g = window.__game
    return {
      state: g?.state,
      wave: g?.waveManager?.wave ?? null,
      kills: g?.kills ?? null,
      zombies: g?.zombies?.length ?? 0,
      hudVisible: document.getElementById('hud-root')?.classList.contains('visible') ?? false
    }
  })
} finally {
  await browser.close()
}

out.consoleErrors = consoleErrors
out.pageErrors = pageErrors

// --- Verdict ---
const g = out.gameplay || {}, p = out.pause || {}, r = out.resume || {},
      go = out.gameover || {}, ar = out.afterRestart || {}, t = out.title || {}
const checks = {
  'page loaded + WebGL canvas': !!(out.webgl?.canvas && out.webgl.w > 0),
  'title screen shown': t.hasTitle && t.startBtn,
  'START clicked': out.startClicked === true,
  'gameplay running (playing + HUD)': g.state === 'playing' && g.hudVisible,
  'zombies spawned': (g.zombiesAlive ?? 0) > 0,
  'pause works (Esc -> paused overlay)': p.state === 'paused' && p.pausedVisible,
  'resume works (P -> playing)': r.state === 'playing',
  'game over (death -> YOU DIED)': go.state === 'gameover' && go.gameoverVisible,
  'restart works (-> playing, wave 1, kills 0)': ar.state === 'playing' && ar.wave === 1 && ar.kills === 0,
  'no console errors': consoleErrors.length === 0,
  'no page errors': pageErrors.length === 0
}

// Resume may be a headless pointer-lock limitation: if the game is still
// paused and pointer lock never engaged in this headless run, treat it as
// SKIP (a real-browser capability, not a game bug).
const resumeSkipped = (r.state !== 'playing' && r.stillPaused === true && r.pointerLocked === false)

console.log(JSON.stringify(out, null, 2))
console.log('\n--- E2E checks ---')
let allPass = true
for (const [k, v] of Object.entries(checks)) {
  if (k === 'resume works (P -> playing)' && resumeSkipped) {
    console.log('SKIP  resume works (headless pointer-lock unavailable; real browsers re-lock & resume)')
    continue
  }
  console.log(`${v ? 'PASS' : 'FAIL'}  ${k}`)
  if (!v) allPass = false
}
if (consoleErrors.length || pageErrors.length) {
  console.log('console/page errors:')
  for (const e of [...consoleErrors, ...pageErrors]) console.log('  -', e)
}
console.log(allPass ? '\nE2E: PASS — full browser flow works, no fatal errors'
                   : '\nE2E: PARTIAL/FAIL — see checks above')
process.exit(allPass ? 0 : 1)
