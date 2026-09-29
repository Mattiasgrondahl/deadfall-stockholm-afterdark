// v3 T12 Achievements: per-run counters cross threshold ladders once, the
// unlocked set persists across restarts (localStorage), and per-run counters
// reset on restart. A fake storage keeps this headless and offline; a captured
// onUnlock callback stands in for the Screens banner toast.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Achievements, CATEGORIES, STORAGE_KEY } from '../src/game/Achievements.js'

function makeStorage(initial = null) {
  const m = new Map()
  if (initial !== null) m.set(STORAGE_KEY, initial)
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }
}

test('crossing a threshold unlocks its tier once and fires the toast', () => {
  const toasts = []
  const a = new Achievements({ localStorage: makeStorage() }, (label) => toasts.push(label))
  // Kills ladder: 10, 20, 50, 100.
  for (let i = 0; i < 9; i++) assert.deepEqual(a.onKill(), [], 'no tier below 10')
  assert.deepEqual(a.onKill(), ['SLAYER 10'], '10th kill unlocks SLAYER 10')
  assert.equal(toasts.length, 1)
  // Further kills up to 20 unlock the next tier only at 20.
  for (let i = 0; i < 9; i++) assert.deepEqual(a.onKill(), [])
  assert.deepEqual(a.onKill(), ['SLAYER 20'], '20th kill unlocks SLAYER 20')
  assert.equal(a.counters.kills, 20)
  assert.ok(a.isUnlocked('kills', 10) && a.isUnlocked('kills', 20))
  assert.equal(a.unlockedCount, 2)
})

test('a tier never re-fires once unlocked (no duplicate toast)', () => {
  const toasts = []
  const a = new Achievements({ localStorage: makeStorage() }, (l) => toasts.push(l))
  for (let i = 0; i < 10; i++) a.onKill()
  assert.equal(toasts.length, 1, 'SLAYER 10 fired once')
  // Restart resets the counter; re-crossing 10 must NOT re-toast (already earned).
  a.resetRun()
  assert.equal(a.counters.kills, 0, 'per-run counter reset')
  for (let i = 0; i < 10; i++) a.onKill()
  assert.equal(toasts.length, 1, 'no duplicate toast for an earned tier')
  assert.ok(a.isUnlocked('kills', 10), 'still unlocked')
})

test('unlocked set persists across a fresh instance; per-run counters do not', () => {
  const st = makeStorage()
  const a = new Achievements({ localStorage: st }, () => {})
  for (let i = 0; i < 5; i++) a.onBoss()   // bosses ladder starts at 1 and 5
  assert.ok(a.isUnlocked('bosses', 1) && a.isUnlocked('bosses', 5))
  // A fresh instance reading the same storage inherits the unlocks.
  const b = new Achievements({ localStorage: st }, () => {})
  assert.ok(b.isUnlocked('bosses', 1), 'bosses 1 survived the restart')
  assert.ok(b.isUnlocked('bosses', 5), 'bosses 5 survived the restart')
  assert.equal(b.counters.bosses, 0, 'per-run counter starts fresh')
  assert.equal(b.unlockedCount, 2)
})

test('headshots, lamps and waves each drive their own ladder', () => {
  const a = new Achievements({ localStorage: makeStorage() }, () => {})
  for (let i = 0; i < 25; i++) a.onHeadshot()
  assert.ok(a.isUnlocked('headshots', 25), 'BULLSEYE 25')
  for (let i = 0; i < 10; i++) a.onLamp()
  assert.ok(a.isUnlocked('lamps', 10), 'LAMP LIGHTER 10')
  for (let i = 0; i < 5; i++) a.onWaveCleared()
  assert.ok(a.isUnlocked('waves', 5), 'SURVIVOR 5')
  assert.equal(a.counters.headshots, 25)
  assert.equal(a.counters.lamps, 10)
  assert.equal(a.counters.waves, 5)
})

test('add() clamps to the ladder and ignores unknown ids', () => {
  const a = new Achievements({ localStorage: makeStorage() }, () => {})
  assert.deepEqual(a.add('nope', 100), [], 'unknown id is a no-op')
  assert.equal(a.counters.nope, undefined)
  // A big jump unlocks every tier it crosses in one bump.
  const made = a.add('kills', 100)
  assert.deepEqual(made, ['SLAYER 10', 'SLAYER 20', 'SLAYER 50', 'SLAYER 100'], 'all crossed tiers unlock')
})

test('corrupt / missing storage degrades to an empty set without throwing', () => {
  const a = new Achievements({ localStorage: makeStorage('not json') }, () => {})
  assert.equal(a.unlockedCount, 0)
  const noEnv = new Achievements(null, () => {})
  assert.equal(noEnv.unlockedCount, 0)
  noEnv.onKill() // still tracks in memory
  assert.equal(noEnv.counters.kills, 1)
})

test('dispose drops the unlock callback; totalTiers matches the ladders', () => {
  const toasts = []
  const a = new Achievements({ localStorage: makeStorage() }, (l) => toasts.push(l))
  let total = 0
  for (const c of CATEGORIES) total += c.thresholds.length
  assert.equal(a.totalTiers, total)
  a.dispose()
  a.onKill() // callback gone, no throw
  assert.equal(toasts.length, 0)
})