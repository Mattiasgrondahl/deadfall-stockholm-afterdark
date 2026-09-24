import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { AmmoDrops, DROP_CHANCE, SHELLS_PER_DROP, BULLETS_PER_DROP, BULLET_CHANCE, BATTERY_CHANCE, PICKUP_RADIUS, LIFETIME, BLINK_AFTER, MAX_DROPS } from '../src/game/AmmoDrops.js'

const fakeAudio = () => ({ pickup: () => {} })
const fakePlayer = (x, z, isDead = false) => ({ position: new THREE.Vector3(x, 1.7, z), isDead })

function makeManager() {
  const scene = new THREE.Scene()
  const drops = new AmmoDrops(scene, fakeAudio())
  return { scene, drops }
}

test('constants match the contract', () => {
  assert.equal(DROP_CHANCE, 0.55)
  assert.equal(SHELLS_PER_DROP, 8)
  assert.equal(BULLETS_PER_DROP, 18)
  assert.equal(BULLET_CHANCE, 0.5)
  assert.equal(PICKUP_RADIUS, 1.2)
  assert.equal(LIFETIME, 30)
  assert.equal(BLINK_AFTER, 25)
  assert.equal(MAX_DROPS, 20)
})

test('10-wave ammo economy: pistol survives to the wave-10 boss', () => {
  // Deterministic expected-value check (no LCG needed). A 10-wave run is 217
  // kills needing ~1015 pistol body shots. Expected bullet income per kill =
  // DROP_CHANCE (drop spawns) x (1 - BATTERY_CHANCE) (not a battery) x
  // BULLET_CHANCE (bullets, not shells) x BULLETS_PER_DROP.
  const KILLS = 217
  // 1015 pistol body shots: per-zombie ceil(hp*1.12^(w-1)/26) over waves 1-10
  // (all-body bound 1115, pooled-HP bound ~1007) — 1015 models a ~10% headshot
  // mix, between the two bounds. The wave-10 boss + a ~92-shot shortfall at
  // the finale are covered by shotgun/axe/sword damage, not the pistol alone.
  const PISTOL_NEED = 1015
  const PISTOL_START = 36
  const SHELL_NEED = 350
  const SHELL_START = 30
  const bulletIncome = PISTOL_START + KILLS * DROP_CHANCE * (1 - BATTERY_CHANCE) * BULLET_CHANCE * BULLETS_PER_DROP
  const shellIncome = SHELL_START + KILLS * DROP_CHANCE * (1 - BATTERY_CHANCE) * (1 - BULLET_CHANCE) * SHELLS_PER_DROP
  // ~917 bullets vs 1015 needed: scarce (~90%) but the pistol survives to the
  // wave-10 boss instead of running dry around wave 7-8 (old 12/drop = ~623).
  // 0.9 pins the shipped 18/drop: 17 would give 868 (85.5%) and fail here.
  assert.ok(bulletIncome >= 0.9 * PISTOL_NEED, `pistol income ${bulletIncome.toFixed(0)} >= 90% of ${PISTOL_NEED}`)
  assert.ok(bulletIncome < PISTOL_NEED, 'pistol income stays scarce (below full need)')
  // Shotgun was already fine at 8 shells/drop and is untouched: ~421 vs 350.
  assert.ok(shellIncome >= SHELL_NEED, `shotgun income ${shellIncome.toFixed(0)} >= ${SHELL_NEED}`)
})

test('drop roll is a seeded LCG: identical sequences across instances', () => {
  const a = makeManager(), b = makeManager()
  const ra = [], rb = []
  for (let i = 0; i < 10; i++) { ra.push(a.drops._rand()); rb.push(b.drops._rand()) }
  assert.deepEqual(ra, rb)
  const sa = [], sb = []
  for (let i = 0; i < 30; i++) { sa.push(a.drops.maybeSpawn(i, 0)); sb.push(b.drops.maybeSpawn(i, 0)) }
  assert.deepEqual(sa, sb)
  assert.equal(a.drops.count, b.drops.count)
  assert.ok(a.drops.count < 30)
  a.drops.dispose(); b.drops.dispose()
})

test('cap: at most 20 concurrent drops', () => {
  const { drops } = makeManager()
  drops._rand = () => 0 // force every roll to hit
  for (let i = 0; i < 25; i++) drops.maybeSpawn(i, 0)
  assert.equal(drops.count, MAX_DROPS)
  assert.equal(drops.maybeSpawn(99, 0), null)
  drops.dispose()
})

test('drops carry a kind: handgun bullets and shotgun shells both appear', () => {
  const { drops } = makeManager()
  // Default LCG: over many kills both kinds must appear (the kind roll is a
  // second LCG draw), and each drop must carry 'bullets' or 'shells'.
  const kinds = new Set()
  for (let i = 0; i < 60; i++) {
    const k = drops.maybeSpawn(i, 0)
    if (k) kinds.add(k)
  }
  assert.ok(kinds.has('bullets'), 'handgun-bullet drops appear')
  assert.ok(kinds.has('shells'), 'shotgun-shell drops appear')
  for (const d of drops._drops) assert.ok(d.kind === 'bullets' || d.kind === 'shells' || d.kind === 'battery')
  drops.dispose()
})

test('bullet drops use the bullet material, shell drops the shell material', () => {
  const { drops } = makeManager()
  let seq = [0, 0, 0.9] // drop roll 0 (<0.55 hits), kind roll 0 (<0.5 -> bullets), battery roll 0.9 (>=0.18 -> stays bullets)
  drops._rand = () => seq.shift() ?? 0
  drops.maybeSpawn(1, 1)
  assert.equal(drops._drops[0].kind, 'bullets')
  assert.equal(drops._drops[0].mesh.material, drops._bulletMat)
  seq = [0, 0.9, 0.9] // drop roll 0 hits, kind roll 0.9 (>=0.5 -> shells), battery roll 0.9 (stays shells)
  drops.maybeSpawn(2, 2)
  assert.equal(drops._drops[1].kind, 'shells')
  assert.equal(drops._drops[1].mesh.material, drops._shellMat)
  seq = [0, 0, 0.1] // drop hits, kind bullets, battery roll 0.1 (<0.18 -> battery)
  drops.maybeSpawn(3, 3)
  assert.equal(drops._drops[2].kind, 'battery')
  assert.equal(drops._drops[2].mesh.material, drops._batteryMat)
  drops.dispose()
})

test('lifetime: expires at 30 s; blinks after 25 s', () => {
  const { drops } = makeManager()
  drops._rand = () => 0
  drops.maybeSpawn(5, 5)
  const d = drops._drops[0]
  drops.update(20, null, null)
  assert.equal(d.mesh.visible, true)
  assert.equal(drops.count, 1)
  drops.update(5.1, null, null) // t = 25.1
  assert.equal(d.mesh.visible, false) // floor(25.1 * 3) = 75, odd
  drops.update(0.4, null, null) // t = 25.5
  assert.equal(d.mesh.visible, true)  // floor(76.5) = 76, even
  drops.update(4.5, null, null) // t = 30
  assert.equal(drops.count, 0)
  drops.dispose()
})

test('pickup within 1.2 m fires onPickup once and removes the drop', () => {
  const { drops } = makeManager()
  drops._rand = () => 0
  drops.maybeSpawn(5, 5)
  let pickups = 0
  drops.update(0.1, fakePlayer(5.5, 5), () => pickups++) // 0.5 m away
  assert.equal(pickups, 1)
  assert.equal(drops.count, 0)
  drops.maybeSpawn(5, 5)
  drops.update(0.1, fakePlayer(7, 5), () => pickups++) // 2 m away: no pickup
  assert.equal(pickups, 1)
  assert.equal(drops.count, 1)
  drops.update(0.1, fakePlayer(5, 5, true), () => pickups++) // dead player never picks up
  assert.equal(pickups, 1)
  drops.dispose()
})

test('clear + dispose remove everything and are double-safe', () => {
  const { scene, drops } = makeManager()
  drops._rand = () => 0
  drops.maybeSpawn(0, 0); drops.maybeSpawn(3, 3)
  assert.equal(drops.count, 2)
  assert.equal(scene.children.length, 2)
  drops.clear()
  assert.equal(drops.count, 0)
  assert.equal(scene.children.length, 0)
  drops.dispose()
  drops.dispose() // second call must not throw
})
