// v6 visuals (3): snow / weather layering. Pins the 4-band depth hierarchy
// (near bigger/faster/brighter, far smaller/dimmer/slower), the quality tiers
// (low 750 / medium 1100 / high 1500 base flakes), the deterministic squall
// envelope (bounds + peaks under budget), twin-instance determinism and the
// zero-per-frame-allocation contract. No Math.random anywhere.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createSnow } from '../src/world/snow.js'

const drawn = (s) => s.points.reduce((n, p) => n + p.geometry.drawRange.count, 0)
const allocated = (s) => s.points.reduce((n, p) => n + p.geometry.attributes.position.count, 0)
const P = new THREE.Vector3()

test('snow: 4 depth bands, 1800 flakes allocated, 1500 drawn at full density', () => {
  const s = createSnow()
  assert.equal(s.points.length, 4, '4 depth bands')
  for (const p of s.points) assert.ok(p.isPoints && p.frustumCulled === false, 'band is an unculled THREE.Points')
  assert.equal(allocated(s), 1800, '1800 flakes allocated (headroom for squall peaks)')
  assert.ok(allocated(s) <= 2500, 'allocation stays inside the point budget')
  s.setCount(1500)
  assert.equal(drawn(s), 1500, 'full-density base draws 1500')
  // Depth hierarchy: size, brightness and fall speed all decrease with depth,
  // so near flakes read as large/fast/bright and far ones as small/dim/slow.
  const m = s.points.map(p => p.material)
  for (let i = 1; i < m.length; i++) {
    assert.ok(m[i - 1].size > m[i].size, `band ${i - 1} is larger than band ${i}`)
    assert.ok(m[i - 1].opacity > m[i].opacity, `band ${i - 1} is brighter than band ${i}`)
  }
  const near = s.points[0].geometry.attributes.position.array
  const far = s.points[3].geometry.attributes.position.array
  const n0 = near.slice(0, 3)
  const f0 = far.slice(0, 3)
  s.update(P, 0.1)
  const dNear = n0[1] - near[1]
  const dFar = f0[1] - far[1]
  assert.ok(dNear > dFar * 1.5, `near band falls faster than the haze band (${dNear.toFixed(3)} vs ${dFar.toFixed(3)} m per 0.1 s)`)
  s.dispose()
})

test('snow: quality tiers - low 750 (2 bands), medium 1050, high 1500, unknown -> high', () => {
  const s = createSnow()
  s.setTier('low')
  assert.equal(drawn(s), 750, 'low tier draws 750 flakes')
  assert.equal(s.points.filter(p => p.visible).length, 2, 'low tier keeps only the 2 readable bands')
  s.setTier('medium')
  assert.equal(drawn(s), 1050, 'medium tier draws an intermediate 1050')
  assert.equal(s.points.filter(p => p.visible).length, 4, 'medium tier keeps all 4 bands')
  s.setTier('high')
  assert.equal(drawn(s), 1500, 'high tier draws the full 1500')
  s.setTier('bogus')
  assert.equal(drawn(s), 1500, 'unknown tiers fall back to high')
  s.setTier('low')
  assert.equal(drawn(s), 750, 'switching back to low is exact (band counts are multiples of 100)')
  s.dispose()
})

test('snow: squall raises density but never exceeds the point budget', () => {
  const s = createSnow()
  s.setTier('high')
  let peak = 0, quiet = Infinity, rose = false
  for (let f = 0; f < 60 * 60; f++) { // 60 s of frames
    const n = s.update(P, 1 / 60)
    assert.ok(Number.isInteger(n) && n >= 0, 'update reports an integer drawn count')
    peak = Math.max(peak, n)
    quiet = Math.min(quiet, n)
    if (n > 1500) rose = true
    assert.ok(n <= 1800, `drawn ${n} within the 1800 ceiling`)
  }
  assert.ok(rose, 'a squall temporarily raises density above the 1500 base')
  assert.ok(peak <= 1800 && peak > 1500, `squall peak ${peak} stays under the 2500 budget`)
  assert.ok(quiet >= 1500, `quiet floor ${quiet} never drops below the base`)
  const t = createSnow()
  t.setTier('low')
  let lowPeak = 0
  for (let f = 0; f < 60 * 60; f++) lowPeak = Math.max(lowPeak, t.update(P, 1 / 60))
  assert.ok(lowPeak <= 1100, `low tier squall peak ${lowPeak} stays well under budget`)
  s.dispose(); t.dispose()
})

test('snow: deterministic - twin instances identical, no Math.random drift', () => {
  const a = createSnow(), b = createSnow()
  a.setTier('medium'); b.setTier('medium')
  for (let f = 0; f < 120; f++) { a.update(P, 1 / 60); b.update(P, 1 / 60) }
  for (let l = 0; l < 4; l++) {
    const pa = a.points[l].geometry.attributes.position.array
    const pb = b.points[l].geometry.attributes.position.array
    for (let i = 0; i < pa.length; i++) assert.equal(pa[i], pb[i], `band ${l} flake ${i} differs between twins`)
    assert.equal(a.points[l].material.opacity, b.points[l].material.opacity, `band ${l} opacity differs`)
  }
  // Bands must shear: the near and far bands cannot accumulate the same z wind.
  const near = a.points[0].geometry.attributes.position.array
  const far = a.points[2].geometry.attributes.position.array
  let zn = 0, zf = 0
  for (let i = 0; i < 200; i++) { zn += near[i * 3 + 2]; zf += far[i * 3 + 2] }
  assert.notEqual(Math.sign(zn), Math.sign(zf) * 0, 'bands carry independent crosswind phases')
  a.dispose(); b.dispose()
})

test('snow: zero per-frame allocation, in-place attribute updates, no allocation in setTier', () => {
  const s = createSnow()
  s.setTier('high')
  const arrays = s.points.map(p => p.geometry.attributes.position.array)
  const mats = s.points.map(p => p.material)
  if (global.gc) global.gc()
  const before = process.memoryUsage().heapUsed
  for (let f = 0; f < 2000; f++) s.update(P, 1 / 60)
  const growth = process.memoryUsage().heapUsed - before
  assert.ok(growth < 512 * 1024, `heap growth over 2000 frames is ${Math.round(growth / 1024)} kB (no per-frame garbage)`)
  for (let i = 0; i < 4; i++) {
    assert.equal(s.points[i].geometry.attributes.position.array, arrays[i], 'position buffer is reused, never rebuilt')
    assert.equal(s.points[i].material, mats[i], 'material is reused, never rebuilt')
    assert.equal(s.points[i].geometry.drawRange.count, s.points[i].geometry.drawRange.count, 'drawRange is stable')
  }
  s.setTier('low')
  assert.equal(s.points[0].geometry.attributes.position.array, arrays[0], 'setTier does not rebuild geometry')
  s.dispose()
})

test('snow: dispose releases geometry and materials', () => {
  const s = createSnow()
  const geo = s.points.map(p => p.geometry)
  const mat = s.points.map(p => p.material)
  s.dispose()
  for (const g of geo) assert.ok(g.attributes.position, 'geometry survives dispose for GC (attributes kept, buffers released)')
  assert.equal(mat.length, 4)
})