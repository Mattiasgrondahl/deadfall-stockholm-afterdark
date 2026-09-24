// Focused tests for the shootable-lamp + bullet-hole + glass-shard systems.
// Headless-safe: every pool runs with scene = null (no THREE scene needed).
import assert from 'node:assert'
import * as THREE from 'three'
import { Lamps } from '../src/game/Lamps.js'
import { BulletHoles } from '../src/game/BulletHoles.js'
import { GlassShards } from '../src/game/GlassShards.js'

const DT = 1 / 60

function fakeLamp(x, z) {
  return { x, z, broken: false, timer: 0, halo: { visible: true }, shaft: { visible: true },
    material: new THREE.MeshStandardMaterial({ emissive: new THREE.Color(0xffb066), emissiveIntensity: 2.2 }) }
}

// ---- Lamps: break, dark, relight after 60 s --------------------------------
{
  const a = fakeLamp(0, 10), b = fakeLamp(5, 10)
  const lamps = new Lamps([a, b])
  assert.strictEqual(lamps.brokenCount(), 0)
  // A hit near lamp A breaks it; it goes dark + halo/shaft hidden.
  const hit = lamps.hitAt(0.1, 5.2, 10)
  assert.strictEqual(hit, a, 'hitAt returns the broken lamp')
  assert.strictEqual(a.broken, true)
  assert.strictEqual(a.material.emissiveIntensity, 0, 'broken lamp head goes dark')
  assert.strictEqual(a.halo.visible, false, 'halo hidden when broken')
  assert.strictEqual(a.shaft.visible, false, 'shaft hidden when broken')
  assert.strictEqual(b.broken, false, 'the other lamp stays lit')
  assert.strictEqual(lamps.brokenCount(), 1)
  // Re-hitting a broken lamp does nothing (glass already gone).
  assert.strictEqual(lamps.hitAt(0, 5.2, 10), null, 'already-broken lamp not re-broken')
  // A hit far from any lamp breaks nothing.
  assert.strictEqual(lamps.hitAt(40, 5.2, 40), null, 'no lamp at that point')
  // 59 s of updates: still dark.
  for (let i = 0; i < Math.floor(59 / DT); i++) lamps.update(DT)
  assert.strictEqual(a.broken, true, 'still dark before 60 s')
  // Cross the 60 s mark: relights automatically.
  for (let i = 0; i < Math.ceil(2 / DT); i++) lamps.update(DT)
  assert.strictEqual(a.broken, false, 'relit after 60 s')
  assert.strictEqual(a.material.emissiveIntensity, 2.2, "emissive restored to the restrained v6 value")
  assert.strictEqual(a.halo.visible, true, 'halo restored')
  assert.strictEqual(a.shaft.visible, true, 'shaft restored')
  assert.strictEqual(lamps.brokenCount(), 0)
  lamps.dispose()
}

// ---- Lamps: audio + shard hooks fire on break ------------------------------
{
  let glass = 0, shards = 0
  const a = fakeLamp(0, 0)
  const lamps = new Lamps([a])
  lamps.audio = { glassBreak: () => { glass++ } }
  lamps.shards = { burst: (x, y, z) => { shards++ } }
  lamps.hitAt(0, 5.2, 0)
  assert.strictEqual(glass, 1, 'glassBreak voice fired once')
  assert.strictEqual(shards, 1, 'shard burst fired once')
  lamps.reset()
  assert.strictEqual(a.broken, false, 'reset restores every lamp')
}

// ---- BulletHoles: pool fills, orients to normal, evicts oldest -------------
{
  const bh = new BulletHoles(null)
  assert.strictEqual(bh.activeCount, 0)
  for (let i = 0; i < 160; i++) bh.spawn(i * 0.01, 1.2, 5, { x: 0, y: 0, z: 1 })
  assert.strictEqual(bh.activeCount, 160, 'pool fills to capacity')
  // One more evicts the oldest (prefix invariant: slot 0 stays the newest window).
  bh.spawn(99, 1.2, 5, { x: 0, y: 0, z: 1 })
  assert.strictEqual(bh.activeCount, 160, 'still capped at 160 after eviction')
  // The newest hole occupies the last slot.
  assert.ok(Math.abs(bh._pos[159].x - 99) < 1e-6, 'newest hole is in the last slot')
  bh.clear()
  assert.strictEqual(bh.activeCount, 0)
  bh.dispose()
}

// ---- GlassShards: burst pops, then fades out -------------------------------
{
  const gs = new GlassShards(null)
  assert.strictEqual(gs.activeCount, 0)
  const n = gs.burst(0, 5.2, 0)
  assert.ok(n > 0 && n <= 12, `burst spawns 1..12 shards (${n})`)
  assert.strictEqual(gs.activeCount, n)
  // Run past the max lifetime: every shard expires.
  for (let i = 0; i < Math.ceil(1.0 / DT); i++) gs.update(DT)
  assert.strictEqual(gs.activeCount, 0, 'all shards expired')
  gs.dispose()
}

console.log('lamps + bullet-holes + glass-shards OK')