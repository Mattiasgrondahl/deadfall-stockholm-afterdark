// Focused tests for Blood.js. Headless-safe: the pool simulates with
// scene = null; with a scene it adds one InstancedMesh to the graph.
import assert from 'node:assert'
import * as THREE from 'three'
import { Blood } from '../src/game/Blood.js'

const DT = 1 / 60

// Plain-object snapshot of live droplet positions (Vector3 has internals).
function snap(b) {
  const out = []
  for (let i = 0; i < b.count; i++) out.push([b._pos[i].x, b._pos[i].y, b._pos[i].z])
  return out
}
function stepN(b, n) { for (let i = 0; i < n; i++) b.update(DT) }

// ---- headless safety + lifecycle -------------------------------------------
{
  const b = new Blood(null) // no scene, no throw
  assert.strictEqual(b.activeCount, 0)
  assert.strictEqual(b.burst(0, 1.5, 0, 8, false), 2)
  stepN(b, 120) // 2 s > max life (0.8 * 1.3)
  assert.strictEqual(b.activeCount, 0)
  assert.strictEqual(b.burst(0, 1, 0, 8, false), 2) // pool reusable
  b.clear()
  assert.strictEqual(b.activeCount, 0)
  b.dispose() // safe with null scene
}
// ---- burst size scales with damage; headshot doubles ------------------------
{
  const b = new Blood(null)
  assert.strictEqual(b.burst(0, 1, 0, 8, false), 2)   // 8/4
  b.clear()
  assert.strictEqual(b.burst(0, 1, 0, 24, false), 6)   // 24/4
  b.clear()
  assert.strictEqual(b.burst(0, 1, 0, 24, true), 12)   // headshot doubles
  b.clear()
  assert.strictEqual(b.burst(0, 1, 0, 60, true), 20)   // clamped at 20
  b.clear()
  assert.strictEqual(b.burst(0, 1, 0, 0, false), 2)    // min 2 even at 0 dmg
  b.clear()
  b.dispose()
}
// ---- pool cap: 300 max, then bursts refuse ----------------------------------
{
  const b = new Blood(null)
  for (let i = 0; i < 15; i++) assert.strictEqual(b.burst(0, 1, 0, 60, true), 20) // 300
  assert.strictEqual(b.burst(0, 1, 0, 60, true), 0)   // pool exhausted
  assert.strictEqual(b.activeCount, 300)
  stepN(b, 120)
  assert.strictEqual(b.activeCount, 0)
  assert.strictEqual(b.burst(0, 1, 0, 60, true), 20)  // reusable after drain
  b.dispose()
}
// ---- determinism: identical burst sequences -> identical trajectories -------
{
  const a = new Blood(null), c = new Blood(null)
  const bursts = [[1, 1.5, 2, 8, false], [5, 1.2, 0, 24, true], [-3, 1.8, 4, 12, false]]
  const ta = [], tc = []
  for (const [x, y, z, d, h] of bursts) { a.burst(x, y, z, d, h); c.burst(x, y, z, d, h) }
  for (let i = 0; i < 900; i++) {
    a.update(DT); c.update(DT)
    ta.push(JSON.stringify([a.activeCount, snap(a)]))
    tc.push(JSON.stringify([c.activeCount, snap(c)]))
  }
  assert.deepStrictEqual(ta, tc)
  a.dispose(); c.dispose()
}
// ---- gravity + ground settle --------------------------------------------------
{
  const b = new Blood(null)
  b.burst(0, 2, 0, 24, false) // 6 droplets, launched above ground
  assert.ok(b.activeCount > 0)
  // Mid-flight: at least one droplet is above the ground.
  stepN(b, 15)
  assert.ok(b._pos.some(p => p.y > 0.1), 'droplets should be airborne early')
  stepN(b, 240) // 4 s total: all landed and faded
  assert.strictEqual(b.activeCount, 0)
  b.dispose()
}
{
  // Landed droplets rest at y = 0 (never below ground)
  const b = new Blood(null)
  b.burst(0, 2, 0, 24, false)
  stepN(b, 90)
  for (let i = 0; i < b.count; i++) assert.ok(b._pos[i].y >= -1e-9)
  b.dispose()
}
// ---- scene graph: one InstancedMesh, visible toggles, dispose removes --------
{
  const scene = new THREE.Scene()
  const b = new Blood(scene)
  assert.ok(scene.children.includes(b._mesh))
  assert.strictEqual(b._mesh.count, 0)
  assert.strictEqual(b._mesh.visible, false)
  b.burst(0, 1, 0, 24, false)
  assert.strictEqual(b._mesh.count, b.activeCount)
  assert.strictEqual(b._mesh.visible, true)
  stepN(b, 120)
  assert.strictEqual(b._mesh.count, 0)
  assert.strictEqual(b._mesh.visible, false)
  b.dispose()
  assert.ok(!scene.children.includes(b._mesh))
}
// ---- clear() restores every slot ---------------------------------------------
{
  const b = new Blood(null)
  b.burst(0, 1, 0, 60, true) // 20 droplets
  b.clear()
  assert.strictEqual(b.activeCount, 0)
  assert.strictEqual(b.burst(0, 1, 0, 60, true), 20) // full pool back
  b.dispose()
}

// ---- ground stains: one per burst, two per headshot ---------------------------
{
  const scene = new THREE.Scene()
  const b = new Blood(scene)
  assert.strictEqual(b._stainMesh.count, 0)
  assert.strictEqual(b._stainMesh.visible, false)
  b.burst(0, 1.5, 0, 24, false) // body hit -> 1 stain
  assert.strictEqual(b._stainMesh.count, 1)
  assert.strictEqual(b._stainMesh.visible, true)
  assert.ok(scene.children.includes(b._stainMesh))
  b.burst(5, 1.5, 5, 24, true)  // headshot -> 2 more stains
  assert.strictEqual(b._stainMesh.count, 3)
  // Stains rest just above the ground, near their impact point.
  for (let i = 0; i < b._stainCount; i++) {
    const p = b._stainPos[i]
    assert.strictEqual(p.y, 0.01) // clears street-dressing layers (pools 0.02, drifts 0.04)
    assert.ok(Math.abs(p.y) < 0.05, 'no z-fight with the ground plane')
  }
  assert.ok(Math.hypot(b._stainPos[0].x, b._stainPos[0].z) < 0.25) // near the origin hit
  // Dark-red per-instance colors (linear color space).
  for (let i = 0; i < b._stainCount; i++) {
    const c = b._stainColor[i]
    assert.ok(c.r > 0.1 && c.r < 0.3, 'red channel in dark-red range')
    assert.ok(c.g < 0.02 && c.b < 0.02, 'low green/blue channels')
  }
  b.clear()
  assert.strictEqual(b._stainMesh.count, 0)
  assert.strictEqual(b._stainMesh.visible, false)
  b.dispose()
  assert.ok(!scene.children.includes(b._stainMesh))
}

// ---- stain eviction: oldest first at MAX_STAINS --------------------------------
{
  const b = new Blood(null)
  // Distinct x positions so the shift is observable (2 droplets per burst
  // here stay far under the 300 droplet cap).
  for (let i = 0; i < 120; i++) b.burst(i, 1, 0, 8, false)
  assert.strictEqual(b._stainCount, 120)
  const xSecond = b._stainPos[1].x // second stain, ~1
  b.burst(999, 1, 0, 8, false)
  assert.strictEqual(b._stainCount, 120) // capped
  assert.ok(Math.abs(b._stainPos[0].x - xSecond) < 0.2, 'oldest evicted, slots shifted down')
  assert.ok(Math.abs(b._stainPos[119].x - 999) < 0.2, 'newest takes the tail slot')
  b.dispose()
}

// ---- headless safety for stains ---------------------------------------------------
{
  const b = new Blood(null) // no scene: stains still tracked, no throw
  b.burst(0, 1, 0, 8, true) // headshot -> 2 stains
  assert.strictEqual(b._stainCount, 2)
  b.update(1 / 60) // stains persist through updates (no decay)
  assert.strictEqual(b._stainCount, 2)
  b.dispose() // safe with null scene
}

console.log('blood OK')
