// tools/shadow-cost.mjs — V2P-6a cost probe (measurement only; no src/ edits).
// Per-frame cost of the moon shadow map in a real headless browser against the
// running dev server: 3 conditions x 3 runs x FRAMES frames; the first WARMUP
// samples per run are discarded (warm-up after a state switch). Render cost is
// timed inside renderer.render via a one-time wrapper; rAF deltas are also
// collected per run. Measured headless pacing is ~97 ms/frame (SwiftShader
// CPU rasterization), so FRAMES is 80 rather than 200: 3 runs x 60 effective
// samples per condition (same effective total as the 200-frame design) and
// 9 runs stay under the 120 s hard cap.
//   PLAYWRIGHT_BROWSERS_PATH=/home/mgr/Workspace/Zombie/.browsers node tools/shadow-cost.mjs
// Exit 0 on success; exit 1 on failure or the hard 120 s timeout.

import { chromium } from 'playwright-core'

const URL = process.env.E2E_URL || 'http://127.0.0.1:5173/'
const FRAMES = 80, WARMUP = 20, RUNS = 3, HARD_TIMEOUT_MS = 120000
const consoleErrors = [], pageErrors = []

// In-page probe: wraps renderer.render exactly once, pins the player to the
// open-street point (12, y, 0), holds health at 100, drives frames via rAF,
// and returns raw samples plus renderer.info of each run's last render
// (info.autoReset = true, so those values are per-frame).
const INPAGE = `
(async () => {
  const game = window.__game
  if (!game || !game.renderer || !game.player) return { error: 'window.__game missing renderer/player' }
  const px = 12, py = game.player.position.y, pz = 0
  const cost = new Array(${FRAMES}), deltas = new Array(${FRAMES})
  let ci = 0
  const orig = game.renderer.render.bind(game.renderer)
  game.renderer.render = function (s, c) {           // wrapped exactly once
    const t0 = performance.now()
    orig(s, c)
    if (ci < ${FRAMES}) cost[ci++] = performance.now() - t0
  }
  let restarts = 0
  const nextFrame = () => new Promise(r => requestAnimationFrame(r))
  async function measureRun(reapply) {
    cost.fill(NaN); ci = 0
    let prev = performance.now()
    for (let f = 0; f < ${FRAMES}; f++) {
      await nextFrame()
      const now = performance.now()
      deltas[f] = now - prev
      prev = now
      game.player.position.set(px, py, pz)   // pin to fixed street point
      game.player.health = 100                // prevents death over ~8 s
      if (game.player.isDead) {               // safety net: restart and re-pin
        try { game.startGame() } catch (e) { console.error('startGame failed:', e) }
        game.player.isDead = false
        game.player.position.set(px, py, pz)
        game.player.health = 100
        reapply()                             // restore condition state if reset
        restarts++
      }
    }
    return {
      cost: cost.filter(v => Number.isFinite(v)),
      deltas: deltas.filter(v => Number.isFinite(v)),
      calls: game.renderer.info.render.calls,
      tris: game.renderer.info.render.triangles,
      state: game.state
    }
  }
  const runs = []
  for (let r = 0; r < ${RUNS}; r++) runs.push(await measureRun(() => {}))              // A: high, untouched
  game.renderer.shadowMap.enabled = false                                               // B: shadow off only
  for (let r = 0; r < ${RUNS}; r++) runs.push(await measureRun(() => { game.renderer.shadowMap.enabled = false }))
  game.lighting.setQuality('low')                                                       // C: full fallback
  for (let r = 0; r < ${RUNS}; r++) runs.push(await measureRun(() => { game.lighting.setQuality('low') }))
  return { runs, restarts, playerY: py }
})()
`

function stats(samples) {
  const n = samples.length
  if (n === 0) return { mean: NaN, median: NaN, p95: NaN, n: 0 }
  const s = samples.slice().sort((a, b) => a - b)
  const mean = s.reduce((a, b) => a + b, 0) / n
  const median = n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2
  const p95 = s[Math.ceil(0.95 * n) - 1]
  return { mean, median, p95, n }
}
const r3 = v => Math.round(v * 1000) / 1000

async function main() {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
    page.on('pageerror', e => pageErrors.push(String(e)))
    await page.goto(URL, { waitUntil: 'load', timeout: 30000 })
    await page.waitForFunction('window.__game && window.__game.renderer && window.__game.player', { timeout: 30000 })
    await page.waitForTimeout(1500) // let init frames settle
    const pre = await page.evaluate(() => {
      const g = window.__game; g.startGame()
      return { state: g.state, quality: g.lighting.quality, shadow: g.renderer.shadowMap.enabled }
    })
    if (pre.state !== 'playing') throw new Error('game not playing after startGame: ' + JSON.stringify(pre))
    if (pre.quality !== 'high' || pre.shadow !== true) throw new Error('default not high/shadow-on: ' + JSON.stringify(pre))
    const result = await page.evaluate(INPAGE)
    if (result.error) throw new Error(result.error)
    const names = ['A high (shadow ON, 12 pt lights, snow 1500)', 'B no-shadow (shadow OFF, 12 pt lights, snow 1500)', 'C low (shadow OFF, 6 pt lights, snow 750)']
    const conds = names.map((name, i) => {
      const runs = result.runs.slice(i * RUNS, (i + 1) * RUNS)
      const perRun = runs.map(rn => { const s = stats(rn.cost.slice(WARMUP)); return { mean: r3(s.mean), median: r3(s.median), p95: r3(s.p95), n: s.n } })
      const agg = stats(runs.flatMap(rn => rn.cost.slice(WARMUP)))
      const dstat = stats(runs.flatMap(rn => rn.deltas))
      return { name, runs: perRun, mean: r3(agg.mean), median: r3(agg.median), p95: r3(agg.p95), n: agg.n,
        deltaMean: r3(dstat.mean), deltaP95: r3(dstat.p95),
        calls: runs.map(rn => rn.calls), tris: runs.map(rn => rn.tris), states: runs.map(rn => rn.state) }
    })
    const allDeltas = result.runs.flatMap(rn => rn.deltas)
    const dMin = Math.min(...allDeltas), dMax = Math.max(...allDeltas)
    const dMean = allDeltas.reduce((a, b) => a + b, 0) / allDeltas.length
    const masked = dMax < 24 // no delta spans more than one refresh period
    const vsyncNote = masked
      ? `all rAF deltas within one refresh period (min ${r3(dMin)} / max ${r3(dMax)} ms) -> vsync-masked; render-call cost is the authoritative metric`
      : `rAF deltas exceed one refresh period (min ${r3(dMin)} / max ${r3(dMax)} ms, mean ${r3(dMean)}) -> headless pacing, not vsync; render-call cost is the authoritative metric, per-run deltas approximate full-frame cost`
    const summary = {
      url: URL, viewport: '1280x720', frames: FRAMES, warmup: WARMUP, runsPerCondition: RUNS,
      restartsDuringProbe: result.restarts, conditions: conds,
      shadowOnlyMs: r3(conds[0].mean - conds[1].mean),
      fullFallbackMs: r3(conds[0].mean - conds[2].mean),
      vsync: { minMs: r3(dMin), maxMs: r3(dMax), meanMs: r3(dMean), masked },
      note: vsyncNote, consoleErrors, pageErrors
    }
    console.log('=== V2P-6a moon shadow map cost probe ===')
    for (const c of conds) {
      console.log(`\n${c.name}`)
      c.runs.forEach((s, i) => console.log(`  run ${i + 1}: mean ${s.mean} | median ${s.median} | p95 ${s.p95} ms  (n=${s.n})`))
      console.log(`  aggregate: mean ${c.mean} | median ${c.median} | p95 ${c.p95} ms  (n=${c.n})   rAF delta mean ${c.deltaMean} / p95 ${c.deltaP95} ms`)
      console.log(`  render.calls (last frame): [${c.calls}]  render.triangles: [${c.tris}]  states: [${c.states}]`)
    }
    console.log(`shadow-only cost (mean A - mean B): ${summary.shadowOnlyMs} ms/frame; full-fallback saving (mean A - mean C): ${summary.fullFallbackMs} ms/frame`)
    console.log(`vsync: ${summary.note}  restarts during probe: ${summary.restartsDuringProbe}`)
    console.log(JSON.stringify(summary, null, 2))
  } finally {
    await browser.close()
  }
  return 0
}
const timer = setTimeout(() => {
  console.error('FATAL: hard 120 s timeout reached; probe aborted')
  process.exit(1)
}, HARD_TIMEOUT_MS)
main()
  .then(code => { clearTimeout(timer); process.exit(code) })
  .catch(e => { clearTimeout(timer); console.error('FATAL:', (e && e.message) || e); process.exit(1) })
