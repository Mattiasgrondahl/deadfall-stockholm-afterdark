// tools/perf-skin-stress.mjs — V5 zombie skinned-mesh perf gate (S8 stress).
//
// The stock perf probe (tools/perf-measure.mjs) tops out at ~5 real gameplay
// zombies. The v5 skinned-mesh gate needs the worst case: 24 SKINNED walkers
// in frame at once. The LOD swap shows the SkinnedMesh only within LOD_DIST
// (25 m) of the player and swaps to primitives beyond, so a stress test that
// leaves zombies at their far spawn points would measure primitives, not
// skins. This probe therefore:
//   1. clears the wave queue (no interference),
//   2. force-spawns 24 walkers in a ring within ~14 m of the pinned player,
//   3. waits until every zombie has actually attached its skinned body
//      (z._skin != null) and is LOD-near (z._lodSkinned === true),
//   4. samples render wall-time + renderer.info + scene inventory the same way
//      perf-measure does, and reports skinned-mesh counts explicitly.
//
// Usage (dev server must be running on :5173):
//   PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers node tools/perf-skin-stress.mjs
//
// No Math.random anywhere — fixed ring, fixed pin, fixed frame counts.

import { chromium } from 'playwright-core'
import { performance } from 'perf_hooks'

const URL = process.env.PERF_URL || 'http://127.0.0.1:5173'
const HARD_TIMEOUT_MS = Number(process.env.PERF_TIMEOUT_MS || 420_000)
const WARMUP = 20
const SAMPLES = 80
const PIN = { x: 12, y: 1.6, z: 0 } // same open-street pin as perf-measure/shadow-cost
const COUNT = Number(process.env.SKIN_COUNT || 24)
// Default ring is 12 m (inside LOD_DIST so skins render). SKIN_RING overrides
    // it — a wide ring spreads zombies out (no AI pile-up) to test whether the
    // SwiftShader crash is clustering-induced.
    const RING_R = Number(process.env.SKIN_RING || 12) // m
const BUDGETS = { meshes: 600, lights: 40, zombies: 24, snowPoints: 2500 }

// ---------------------------------------------------------------- in-page ---

// Count SkinnedMesh nodes actually present in the live scene (the stress target).
const SKIN_INV = `
  (function () {
    const g = window.__game
    const scene = g.scene || (g.renderer && g.renderer.scene)
    if (!scene) return { error: 'no scene' }
    let skinned = 0, skinnedVisible = 0, mesh = 0, instanced = 0, sprite = 0, points = 0, light = 0, snowVerts = 0, total = 0
    scene.traverse((o) => {
      total++
      if (o.isMesh) {
        mesh++
        if (o.isInstancedMesh) instanced++
        if (o.isSkinnedMesh) { skinned++; if (o.visible) skinnedVisible++ }
      } else if (o.isSprite) sprite++
      else if (o.isPoints) {
        points++
        const n = o.geometry.attributes.position.count
        snowVerts += Math.min(o.geometry.drawRange.count, n)
      } else if (o.isLight) light++
    })
    return { skinned, skinnedVisible, mesh, instanced, sprite, points, light, snowVerts, total }
  })()
`

// Force-spawn COUNT walkers in a ring around the pin and block the wave queue.
const FORCE_SPAWN = `
  (function () {
    const g = window.__game
    const gm = g.waveManager
    if (gm) { gm.spawned = gm.total; gm.intermission = 3600; gm.killed = gm.total }
    for (const z of g.zombies) z.dispose()
    g.zombies.length = 0
    const N = ${COUNT}, R = ${RING_R}
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      const x = ${PIN.x} + R * Math.cos(a)
      const z = ${PIN.z} + R * Math.sin(a)
      g.spawnZombie('walker', x, z)
    }
    return g.zombies.length
  })()
`

// Wait condition: every zombie has a skinned body attached AND is LOD-near.
const ALL_SKINNED = `
  window.__game && window.__game.zombies.length === ${COUNT} &&
  window.__game.zombies.every(z => z._skin && z._lodSkinned === true)
`

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
    let maxSkinned = 0
    const snap = () => {
      const r = g.renderer.info
      return { calls: r.render.calls, triangles: r.render.triangles, geometries: r.memory.geometries, textures: r.memory.textures }
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
        if (n % 5 === 0 && n <= ${WARMUP + 60} && performance.memory) heap.push(performance.memory.usedJSHeapSize)
        if (n % 5 === 0 && n < ${WARMUP + SAMPLES}) {
          let sk = 0
          for (const z of g.zombies) if (z._skin && z._lodSkinned) sk++
          if (sk > maxSkinned) maxSkinned = sk
        }
        if (n === ${WARMUP + SAMPLES}) {
          info.final = snap()
          window.__perfOut = { samples, heap, info, maxSkinned }
          window.__perfDone = true
        }
      }
      return r
    }
    return 'ok'
  })()
`
}

// ------------------------------------------------------------- per-page run --

async function runPage(browser, name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  page.on('crash', () => pageErrors.push('PAGE CRASHED (renderer/GPU process died)'))

  const result = { name, hung: false, note: '', out: null }
  let mode = 'ok'
  const body = async () => {
    await page.goto(URL, { waitUntil: 'load', timeout: 30_000 })
    await page.waitForFunction('window.__game && window.__game.renderer && window.__game.scene', null, { timeout: 30_000 })
    await page.waitForTimeout(1500) // shader/texture/shadow upload

    const btn = await page.$('.screen.visible button.btn')
    if (btn) await btn.click()
    else await page.keyboard.press('Enter')
    await page.waitForFunction("window.__game && window.__game.state === 'playing'", null, { timeout: 30_000 })

    // Isolate the skinned-mesh vertex/skinning cost from the shadow pass: the
    // 2048 PCFSoft shadow map re-renders every skinned body per frame and
    // stalls SwiftShader under load. Turn shadows off so the gate measures the
    // skinning itself (the stock probe measures the shadow pass separately).
    if (process.env.SKIN_SHADOWS !== '1') await page.evaluate('window.__game.renderer.shadowMap.enabled = false')

    // SKIN_PRIMITIVE=1 stubs the GLTFLoader import so no skinned mesh ever
    // attaches — the forced zombies render as primitives. Isolates whether the
    // crash is the skinned draws or the spawn/scene setup itself.
    if (process.env.SKIN_PRIMITIVE === '1') await page.evaluate(`
      (function () {
        const orig = window.__game.spawnZombie.bind(window.__game)
        window.__game.spawnZombie = function (type, x, z) {
          const zz = orig(type, x, z)
          zz._attachSkin = function () {}
          return zz
        }
      })()
    `)

    await page.evaluate(FORCE_SPAWN)
    await page.evaluate(`window.__game.player.position.set(${PIN.x}, ${PIN.y}, ${PIN.z}); window.__game.player.health = 100`)
    // Diagnostic: how many attached / are near after a settle window.
    await page.waitForTimeout(4000)
    result.attach = await page.evaluate(`
      (function () {
        const g = window.__game
        let attached = 0, near = 0
        for (const z of g.zombies) { if (z._skin) attached++; if (z._lodSkinned) near++ }
        return { total: g.zombies.length, attached, near }
      })()
    `)
    // Wait for the GLB to load + every zombie to attach its skinned body and be LOD-near.
    await page.waitForFunction(ALL_SKINNED, null, { timeout: 120_000 })
    result.inventory = await page.evaluate(SKIN_INV)

    const s = await page.evaluate(sampleScript())
    if (s !== 'ok') throw new Error('sample setup failed: ' + s)
    await page.waitForFunction('window.__perfDone === true', null, { timeout: 120_000 })
    result.out = await page.evaluate('window.__perfOut')
    result.quality = await page.evaluate('window.__game.lighting.quality')
    result.zombies = await page.evaluate('({ total: window.__game.zombies.length, alive: window.__game.zombies.filter(z => !z.isDead).length })')
  }
  await Promise.race([
    body().catch((e) => { mode = 'error'; result.note = String(e.message || e) }),
    new Promise((res) => setTimeout(() => { mode = 'timeout'; res() }, HARD_TIMEOUT_MS)),
  ])
  if (mode === 'timeout') result.note = `exceeded ${HARD_TIMEOUT_MS} ms hard timeout (page killed)`
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
  return { n: s.length, mean: r2(mean), max: r2(s[s.length - 1]), p95: r2(s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]), stddev: r2(sd) }
}
function r2(x) { return Math.round(x * 100) / 100 }
function heapDeltaMB(heap) { if (!heap || heap.length < 2) return null; return r2((heap[heap.length - 1] - heap[0]) / 1e6) }
function budgetRow(label, value, budget, note = '') {
  const over = value > budget
  return `  ${label.padEnd(22)} ${String(value).padStart(8)} / ${budget}   ${over ? 'OVER' : 'ok'}${note ? '  (' + note + ')' : ''}`
}

async function main() {
  console.log(`V5 skinned-mesh stress gate — ${COUNT} walkers @ r=${RING_R} — ${URL}`)
  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (e) {
    console.error('FATAL: could not launch Chromium:', e.message)
    console.error('Run: node node_modules/playwright-core/cli.js install chromium')
    process.exit(2)
  }

  const r = await runPage(browser, `S8 ${COUNT} skinned walkers`)
  await browser.close()

  if (!r.out) {
    console.log(`\n${r.name}: HUNG/FAILED — ${r.note}`)
    if (r.consoleErrors.length + r.pageErrors.length) console.log('errors: ' + [...r.consoleErrors, ...r.pageErrors].join(' | ').slice(0, 400))
    process.exit(1)
  }
  const st = stats(r.out.samples)
  const f = r.out.info.final
  const w = r.out.info.warmup
  const inv = r.inventory || {}
  console.log('\n=== Render table (20 warmup + 80 sampled frames) ===')
  console.log(`mean=${st.mean} max=${st.max} p95=${st.p95} stddev=${st.stddev} ms | calls=${f.calls} tris=${f.triangles} geoms=${f.geometries} textures=${f.textures} heapΔMB=${heapDeltaMB(r.out.heap) ?? 'n/a'}`)
  console.log(`warmup info: calls=${w.calls} tris=${w.triangles} geoms=${w.geometries} textures=${w.textures}`)
  console.log(`state=${r.quality} quality; zombies alive=${r.zombies ? r.zombies.alive : 'n/a'}; max skinned-in-frame=${r.out.maxSkinned}`)
  if (r.attach) console.log(`attach diagnostic: total=${r.attach.total} attached=${r.attach.attached} near=${r.attach.near}`)
  console.log('\n=== Scene inventory (live traversal) ===')
  console.log(`skinnedMeshes=${inv.skinned} (visible=${inv.skinnedVisible}) meshes=${inv.mesh} (instanced=${inv.instanced}) sprites=${inv.sprite} points=${inv.points} lights=${inv.light} snowVertsDrawn=${inv.snowVerts} totalNodes=${inv.total}`)
  const errs = r.consoleErrors.length + r.pageErrors.length
  if (errs) console.log(`console/page errors (${errs}): ${[...r.consoleErrors, ...r.pageErrors].join(' | ').slice(0, 400)}`)

  console.log('\n=== Budget headroom ===')
  console.log(budgetRow('skinned in frame', r.out.maxSkinned, COUNT, 'must equal target to be a valid skin stress'))
  console.log(budgetRow('meshes', inv.mesh, BUDGETS.meshes))
  console.log(budgetRow('lights', inv.light, BUDGETS.lights))
  console.log(budgetRow('snow points drawn', inv.snowVerts, BUDGETS.snowPoints))
  console.log(budgetRow('concurrent zombies', r.zombies ? r.zombies.alive : 0, BUDGETS.zombies))

  const valid = r.out.maxSkinned >= COUNT
  const overBudget = inv.mesh > BUDGETS.meshes || inv.light > BUDGETS.lights || inv.snowVerts > BUDGETS.snowPoints
  console.log('\n=== Full results JSON ===')
  console.log(JSON.stringify(r, null, 2))
  console.log(`\nverdict: ${valid ? 'skin stress VALID' : 'INVALID — skins did not all attach/near'}; budgets ${overBudget ? 'OVER' : 'ok'}`)
  process.exit(valid && !overBudget ? 0 : 1)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })