// Focused tests for Score.js. Headless-safe by design: without localStorage
// (or in Node) the high score stays 0 and nothing throws.
import assert from 'node:assert'
import { Score, STORAGE_KEY } from '../src/game/Score.js'

// Minimal Storage stand-in.
function makeStorage(initial = null) {
  const m = new Map()
  if (initial !== null) m.set(STORAGE_KEY, initial)
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) }
  }
}
function envWith(storage) { return storage ? { localStorage: storage } : {} }

// ---- kill values + wave bonus ---------------------------------------------
{
  const s = new Score(null, () => 1)
  assert.strictEqual(s.pointsFor('walker', 1), 60)     // 10 + 50
  assert.strictEqual(s.pointsFor('shambler', 1), 65)   // 15 + 50
  assert.strictEqual(s.pointsFor('screamer', 1), 75)   // 25 + 50
  assert.strictEqual(s.pointsFor('walker', 3), 160)    // 10 + 150
  assert.strictEqual(s.pointsFor('screamer', 5), 275)  // 25 + 250
  assert.strictEqual(s.pointsFor('unknown', 2), 100)   // bonus only, no crash
  s.addKill('walker', 1)
  s.reset()
  assert.strictEqual(s.value, 0)
}
{
  // accumulation across types and waves
  let wave = 1
  const s = new Score(null, () => wave)
  s.addKill('walker', wave)
  wave = 2
  s.addKill('walker', wave)
  s.addKill('shambler', wave)
  assert.strictEqual(s.value, 60 + 110 + 115)
}
// ---- high score: persistence, records, degradation ------------------------
{
  // fresh storage -> best 0; a record is saved and survives a new Score
  const storage = makeStorage()
  const s = new Score(envWith(storage), () => 1)
  assert.strictEqual(s.best, 0)
  s.addKill('walker', 1); s.addKill('walker', 1)
  assert.strictEqual(s.newRecord(), true)
  assert.strictEqual(s.best, 120)
  assert.strictEqual(storage.getItem(STORAGE_KEY), '120')
  const s2 = new Score(envWith(storage), () => 1)
  assert.strictEqual(s2.best, 120)
  // lower score: no record, storage untouched
  s2.addKill('walker', 1)
  assert.strictEqual(s2.newRecord(), false)
  assert.strictEqual(storage.getItem(STORAGE_KEY), '120')
}
{
  // reset() keeps the best; value starts at 0
  const s = new Score(envWith(makeStorage('300')), () => 1)
  assert.strictEqual(s.best, 300)
  s.addKill('screamer', 2)
  s.reset()
  assert.strictEqual(s.value, 0)
  assert.strictEqual(s.best, 300)
}
{
  // headless / storage-less envs: best stays 0, records still work in memory
  const s = new Score(null, () => 1)
  assert.strictEqual(s.best, 0)
  s.addKill('walker', 1)
  assert.strictEqual(s.newRecord(), true)
  assert.strictEqual(s.best, 60)
  s.reset()
  s.addKill('walker', 1)
  assert.strictEqual(s.newRecord(), false) // 60 is not > 60
  assert.strictEqual(s.best, 60)
}
{
  // corrupt stored values -> best 0, no throw; throwing storage -> no throw
  assert.strictEqual(new Score(envWith(makeStorage('abc')), () => 1).best, 0)
  assert.strictEqual(new Score(envWith(makeStorage('-5')), () => 1).best, 0)
  const bad = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  const s = new Score({ localStorage: bad }, () => 1)
  assert.strictEqual(s.best, 0)
  s.addKill('walker', 1)
  assert.strictEqual(s.newRecord(), true)
  assert.strictEqual(s.best, 60)
}
// ---- HUD contract: score exposes a numeric .value ---------------------------
{
  const s = new Score(null, () => 1)
  s.addKill('shambler', 1)
  assert.strictEqual(typeof s.value, 'number')
  assert.strictEqual(typeof s.best, 'number')
  assert.strictEqual(s.value, 65)
}

console.log('score OK')
