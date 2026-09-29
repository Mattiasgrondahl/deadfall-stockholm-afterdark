// tools/perf-measure.mjs — V6P-1: Version 2 performance baseline (measurement only).
//
// Self-contained probe: Node + playwright-core (repo devDependency), headless
// Chromium. One fresh page per condition, hard 240 s timeout per page (on
// timeout: page is killed, the hang is recorded, the remaining conditions
// continue). No Math.random anywhere — fixed frame counts, fixed pin.
//
// Usage (dev server must be running on :5173):
//   PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers node tools/perf-measure.mjs
//
// Conditions (fresh page each, ~20 warmup + 80 sampled frames):
//   A  high idle  — PLAYING state, player pinned, all zombies cleared, no spawns
//   B  low idle   — same, with lighting.setQuality('low') (no shadows, 6 lamps, 750 snow)
//   C  high active— real gameplay, wait until >= 5 zombies alive, player pinned
//
// Reported per condition: render-call wall time (mean/max/p95/stddev),
// renderer.info (draw calls, triangles, geometries, textures) after warmup
// and after sampling, scene inventory (Mesh/Sprite/Points/Light, drawn snow
// vertices), heap delta (performance.memory, if present), boot -> first render.
// Exits 0 when all conditions produce stats; 1 otherwise.

import { chromium } from 'playwright-core'
import { performance } from 'perf_hooks'

const URL = process.env.PERF_URL || 'http://127.0.0.1:5173'
const HARD_TIMEOUT_MS = 240_000
const WARMUP = 20
const SAMPLES = 80
const PIN = { x: 12, y: 1.6, z: 0 } // open street, same pin as tools/shadow-cost.mjs
const BUDGETS = {
  meshes: 600,
  lights: 40,
  zombies: 24,
  snowPoints: 2500,
  groanVoices: 4, // hard cap in AudioBank.js (GROAN_MAX_VOICES), not directly observable
  bloodInstances: 300, // pool cap in Blood.js (MAX), not directly observable
}

// ---------------------------------------------------------------- in-page ---

// Runs before page scripts (Playwright init script). Wraps renderer.render
// once, immediately, to timestamp the first real render after boot.
const BOOT_HOOK = `
  window.__perfT0 = performance.now();
  (function poll() {
    const g = window.__game;
    if (g && g.renderer && g.renderer.render && !window.__perfWrapped) {
      window.__perfWrapped = true;
      const orig = g.renderer.render.bind(g.renderer);
      g.renderer.render = function (s, c) {
        if (window.__firstRenderT === undefined) window.__firstRenderT = performance.now();
        return orig(s, c);
      };
      return;
    }
    setTimeout(poll, 4);
  })();
`

// Scene inventory: traverses the live scene, counts node types, sums drawn
// Points vertices (respects setDrawRange used by the snow quality toggle).
const INVENTORY = `
  (function () {
    const g = window.__game
    const scene = g.scene || (g.renderer && g.renderer.scene)
    if (!scene) return { error: 'no scene' }
    let mesh = 0, instanced = 0, sprite = 0, points = 0, light = 0, snowVerts = 0, total = 0
    scene.traverse((o) => {
      total++
      if (o.isMesh) {
        mesh++
        if (o.isInstancedMesh) instanced++
      } else if (o.isSprite) {
        sprite++
      } else if (o.isPoints) {
        points++
        const n = o.geometry.attributes.position.count
        snowVerts += Math.min(o.geometry.drawRange.count, n)
      } else if (o.isLight) {
        light++
      }
    })
    return { mesh, instanced, sprite, points, light, snowVerts, total }
  })()
`

// Wraps renderer.render again for the measurement window. Pins player
// position + health every frame (before the real render), records wall time
// of each render call, snapshots renderer.info after warmup and after
// sampling, samples heap every 5 frames over 60 frames, tracks live-zombie count.
function sampleScript() {
  return `
  (function () {
    const g = window.__game
    if (!g || !g.renderer) return 'no game'
    const orig = g.renderer.render.bind(g.renderer)
    const samples = []
    const heap = []
    const info = { warmup: null, final: null }
    let n = 0
    let maxAlive = 0
    const snap = () => {
      const r = g.renderer.info
      return {
        calls: r.render.calls,
        triangles: r.render.triangles,
        geometries: r.memory.geometries,
        textures: r.memory.textures
      }
    }
    g.renderer.render = function (s, c) {
      g.player.position.set(${PIN.x}, ${PIN.y}, ${PIN.z})
      g.player.health = 100
      const t0 = performance.now()
      const r = orig(s, c)
      const dt = performance.now() - t0
      n++
      if (n >= ${WARMUP} && !window.__perfDone) {
        if (n < ${WARMUP + SAMPLES}) samples.push(dt)
        if (n === ${WARMUP}) info.warmup = snap()
        if (n % 5 === 0 && n <= ${WARMUP + 60} && performance.memory) {
          heap.push(performance.memory.usedJSHeapSize)
        }
        if (n % 5 === 0 && n < ${WARMUP + SAMPLES}) {
          const a = g.zombies.filter((z) => !z.isDead).length
          if (a > maxAlive) maxAlive = a
        }
        if (n === ${WARMUP + SAMPLES}) {
          info.final = snap()
          window.__perfOut = { samples, heap, info, maxAlive }
          window.__perfDone = true
        }
      }
      return r
    }
    return 'ok'
  })()
`
}

// Clear all zombies and block further spawning, so the idle conditions run
// with zero zombies while every per-frame update path still executes.
const CLEAR_ZOMBIES = `
  (function () {
    const g = window.__game
    const gm = g.waveManager
    if (gm) {
      gm.spawned = gm.total
      gm.intermission = 3600
      gm.killed = gm.total
    }
    for (const z of g.zombies) z.dispose()
    g.zombies.length = 0
    return g.zombies.length
  })()
`

// ------------------------------------------------------------- per-page run --

async function runPage(browser, name, opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => pageErrors.push(String(e)))

  const result = { name, hung: false, note: '', out: null }
  let mode = 'ok'
  const body = async () => {
    await page.addInitScript(BOOT_HOOK)
    const t0 = performance.now()
    await page.goto(URL, { waitUntil: 'load', timeout: 30_000 })
    const t1 = performance.now()
    await page.waitForFunction(
      'window.__game && window.__game.renderer && window.__game.scene',
      null, { timeout: 30_000 },
    )
    await page.waitForTimeout(1500) // settle: shader compile, texture/shadow-map upload
    if (opts.inventoryBefore) result.inventory = await page.evaluate(INVENTORY)

    // Start the game the same way the E2E does (button click; Enter fallback),
    // so the state transitions through the real startGame() path.
    const btn = await page.$('.screen.visible button.btn')
    if (btn) await btn.click()
    else await page.keyboard.press('Enter')
    await page.waitForFunction(
      "window.__game && window.__game.state === 'playing'",
      null, { timeout: 30_000 },
    )

    if (opts.clearZombies) {
      await page.evaluate(CLEAR_ZOMBIES)
      await page.waitForTimeout(300) // any stragglers spawn -> clear again
      await page.evaluate(CLEAR_ZOMBIES)
    }
    if (opts.quality === 'low') await page.evaluate('window.__game.lighting.setQuality("low")')
    if (opts.waitAlive !== undefined) {
      await page.waitForFunction(
        `window.__game && window.__game.zombies.filter(z => !z.isDead).length >= ${opts.waitAlive}`,
        null, { timeout: 90_000 },
      )
    }
    await page.evaluate(`window.__game.player.position.set(${PIN.x}, ${PIN.y}, ${PIN.z}); window.__game.player.health = 100`)
    if (opts.inventoryAfter) result.inventory = await page.evaluate(INVENTORY)

    const s = await page.evaluate(sampleScript())
    if (s !== 'ok') throw new Error('sample setup failed: ' + s)
    await page.waitForFunction('window.__perfDone === true', null, { timeout: 120_000 })
    result.out = await page.evaluate('window.__perfOut')
    result.startupMs = await page.evaluate(
      'window.__firstRenderT !== undefined ? window.__firstRenderT - window.__perfT0 : null',
    )
    result.gotoWallMs = Math.round(t1 - t0)
    result.quality = await page.evaluate('window.__game.lighting.quality')
    result.zombies = await page.evaluate(
      '({ total: window.__game.zombies.length, alive: window.__game.zombies.filter(z => !z.isDead).length })',
    )
    result.blood = await page.evaluate('window.__game.blood ? window.__game.blood.activeCount : null')
  }
  await Promise.race([
    body().catch((e) => { mode = 'error'; result.note = String(e.message || e) }),
    new Promise((res) => setTimeout(() => { mode = 'timeout'; res() }, HARD_TIMEOUT_MS)),
  ])
  if (mode === 'timeout') result.note = 'exceeded 240 s per-page hard timeout (page killed)'
  await page.close().catch(() => {})
  result.consoleErrors = consoleErrors
  result.pageErrors = pageErrors
  return result
}

// ----------------------------------------------------------------- reporting --

function stats(arr) {
  if (!arr || !arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const mean = s.reduce((a, b) => a + b, 0) / s.length
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) * (b - mean), 0) / s.length)
  return {
    n: s.length,
    mean: round2(mean),
    max: round2(s[s.length - 1]),
    p95: round2(s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]),
    stddev: round2(sd),
  }
}
function round2(x) { return Math.round(x * 100) / 100 }
function heapDeltaMB(heap) {
  if (!heap || heap.length < 2) return null
  return round2((heap[heap.length - 1] - heap[0]) / 1e6)
}
function budgetRow(label, value, budget, note = '') {
  const over = value > budget
  return `  ${label.padEnd(22)} ${String(value).padStart(8)} / ${budget}   ${over ? 'OVER' : 'ok'}${note ? '  (' + note + ')' : ''}`
}

async function main() {
  console.log('V6P-1 perf baseline probe — ' + URL)
  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (e) {
    console.error('FATAL: could not launch Chromium:', e.message)
    console.error('Run: node node_modules/playwright-core/cli.js install chromium')
    process.exit(2)
  }

  const results = [
    await runPage(browser, 'A high idle', { inventoryBefore: true, clearZombies: true }),
    await runPage(browser, 'B low idle', { clearZombies: true, quality: 'low', inventoryAfter: true }),
    await runPage(browser, 'C high active', { waitAlive: 5, inventoryAfter: true }),
  ]
  await browser.close()

  console.log('\n=== Per-condition render table (20 warmup + 80 sampled frames) ===')
  console.log(
    ['cond', 'startup ms', 'mean ms', 'max ms', 'p95 ms', 'stddev ms', 'draw calls', 'triangles', 'geoms', 'textures', 'heap ΔMB']
      .join(' | '),
  )
  for (const r of results) {
    if (!r.out) {
      console.log(`${r.name.padEnd(13)} HUNG/FAILED — ${r.note}`)
      continue
    }
    const st = stats(r.out.samples)
    const f = r.out.info.final
    const inv = r.inventory || {}
    console.log(
      [
        r.name,
        r.startupMs !== null ? round2(r.startupMs) : 'n/a',
        st.mean, st.max, st.p95, st.stddev,
        f.calls, f.triangles, f.geometries, f.textures,
        heapDeltaMB(r.out.heap) ?? 'n/a',
      ].join(' | '),
    )
    const w = r.out.info.warmup
    console.log(
      `  ${r.name} warmup info: calls=${w.calls} tris=${w.triangles} geoms=${w.geometries} textures=${w.textures}; ` +
      `state=${r.quality} quality; zombies alive=${r.zombies ? r.zombies.alive : 'n/a'} (max ${r.out.maxAlive}); ` +
      `blood=${r.blood}`,
    )
    const errs = r.consoleErrors.length + r.pageErrors.length
    if (errs) console.log(`  ${r.name} console/page errors (${errs}): ${[...r.consoleErrors, ...r.pageErrors].join(' | ').slice(0, 400)}`)
  }

  console.log('\n=== Scene inventory (traversal of live scene) ===')
  for (const r of results) {
    if (!r.inventory) continue
    const i = r.inventory
    console.log(
      `${r.name.padEnd(13)} meshes=${i.mesh} (instanced=${i.instanced}) sprites=${i.sprite} points=${i.points} lights=${i.light} ` +
      `snowVertsDrawn=${i.snowVerts} totalNodes=${i.total}`,
    )
  }

  console.log('\n=== Budget headroom ===')
  const a = results[0], c = results[2]
  const ai = a.inventory, ci = c.inventory
  if (ai) {
    console.log(budgetRow('meshes (clean boot)', ai.mesh, BUDGETS.meshes))
    console.log(budgetRow('lights (clean boot)', ai.light, BUDGETS.lights))
    console.log(budgetRow('snow points drawn (high)', ai.snowVerts, BUDGETS.snowPoints))
  }
  const bi = results[1].inventory
  if (bi) console.log(budgetRow('snow points drawn (low)', bi.snowVerts, BUDGETS.snowPoints))
  if (ci) {
    console.log(budgetRow('meshes (active, 5+ z)', ci.mesh, BUDGETS.meshes, `+${ci.mesh - (ai ? ai.mesh : 0)} vs clean boot`))
    console.log(budgetRow('lights (active)', ci.light, BUDGETS.lights))
  }
  if (c.zombies) console.log(budgetRow('concurrent zombies', c.out ? c.out.maxAlive : c.zombies.alive, BUDGETS.zombies, 'observed max in C; wave cap 18'))
  console.log(budgetRow('groan voices', '4 (cap)', BUDGETS.groanVoices, 'hard cap in AudioBank.js, not directly observable'))
  console.log(budgetRow('blood instances', '300 (pool)', BUDGETS.bloodInstances, 'pool cap in Blood.js; live count measured'))

  console.log('\n=== Full results JSON ===')
  console.log(JSON.stringify(results, null, 2))

  const ok = results.every((r) => r.out)
  console.log(ok ? '\nprobe complete: all conditions measured' : '\nprobe completed with missing conditions (see notes)')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
