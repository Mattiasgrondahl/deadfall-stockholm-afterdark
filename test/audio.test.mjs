// Focused tests for AudioBank.js. Node has no AudioContext, so the primary
// tests verify the disabled/no-op path (constructor + every public method must
// never throw). A small fake AudioContext also exercises the real graph-
// building code paths — the only CI check of the procedural voices, since the
// sandbox has no browser.
import assert from 'node:assert'
import { AudioBank } from '../src/game/AudioBank.js'

// Minimal zombie stand-in: the groan scheduler only reads type, position.x/z,
// isDead — no real Zombie instance needed.
function fakeZombie(type, x, z, isDead = false) {
  return { type, position: { x, z }, isDead }
}

// ---- no-op / headless path ------------------------------------------------
{
  const bank = new AudioBank()
  assert.strictEqual(bank.ctx, null)            // no AudioContext in Node
  // all 7 public methods callable as no-ops
  bank.shoot(); bank.hitZombie(); bank.reload(); bank.playWave(3)
  bank.playDeath(); bank.startAmbient(); bank.stopAmbient()
  assert.strictEqual(bank.muted, false)
  assert.strictEqual(bank._ambientOn, false)    // ambient never started without ctx
  bank.dispose()
  // double calls are safe, and everything is still safe after dispose
  bank.startAmbient(); bank.startAmbient()
  bank.stopAmbient(); bank.stopAmbient()
  bank.dispose(); bank.dispose()
  bank.shoot(); bank.hitZombie(); bank.reload(); bank.playWave(1); bank.playDeath()
  bank.toggleMuted(); bank.setMuted(true)
  assert.strictEqual(bank.ctx, null)
}
{
  // playWave accepts any numeric wave value (no throw, no NaN pitch)
  const bank = new AudioBank()
  for (const n of [0, 1, 3, 8, 42, -5]) bank.playWave(n)
  bank.dispose()
}
// ---- V8: one-shot voices are headless no-ops ------------------------------
{
  const bank = new AudioBank()
  bank.axeSwing(); bank.pickup(); bank.drop()
  bank.flashlightClick(); bank.weaponSwitch()
  bank.groan('walker', 5); bank.groan('shambler', 8); bank.groan('screamer', 12)
  bank.updateGroans(1 / 60, [fakeZombie('walker', 3, 0)], { x: 0, z: 0 })
  assert.ok(bank.activeGroans() >= 0 && bank.activeGroans() <= 4)
  bank.dispose()
  bank.axeSwing(); bank.pickup(); bank.updateGroans(1 / 60, [], { x: 0, z: 0 })
}

// ---- fake AudioContext: exercise the real graph code ---------------------
// Minimal WebAudio stand-in: nodes with connect/start/stop, AudioParams with
// the scheduling methods, and a createBuffer that returns a writable buffer.
function makeFakeAudioContext() {
  const param = (value = 0) => ({
    value,
    setValueAtTime(v) { this.value = v },
    linearRampToValueAtTime(v) { this.value = v },
    exponentialRampToValueAtTime(v) { this.value = Math.max(0.0001, v) },
    cancelScheduledValues() {}
  })
  const node = (name) => ({
    name,
    _children: [],
    type: 'sine',
    frequency: param(440),
    gain: param(1),
    connect(target) { this._children.push(target) },
    start() { this.started = true },
    stop() { this.stopped = true }
  })
  const ctx = {
    sampleRate: 44100,
    currentTime: 0,
    state: 'running',
    destination: node('destination'),
    _created: [],
    _make(n) { ctx._created.push(n); return n },
    createGain() { return ctx._make(node('gain')) },
    createOscillator() { return ctx._make(node('osc')) },
    createBiquadFilter() { return ctx._make(node('filter')) },
    createBufferSource() { return ctx._make(node('src')) },
    createBuffer(ch, len, rate) { return { getChannelData: () => new Float32Array(len) } },
    resume() { this.state = 'running'; return Promise.resolve() },
    close() { this.state = 'closed'; return Promise.resolve() }
  }
  return ctx
}

function bankWithFakeCtx() {
  const bank = new AudioBank()
  bank.ctx = makeFakeAudioContext()
  bank.master = bank.ctx.createGain()
  bank.master.connect(bank.ctx.destination)
  bank._noiseBuffer = bank.ctx.createBuffer(1, bank.ctx.sampleRate, bank.ctx.sampleRate)
  const d = bank._noiseBuffer.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = 0.5
  return bank
}
{
  // shoot(): noise burst (src+filter+gain) + sine thud (osc+gain) = 5 nodes
  const bank = bankWithFakeCtx()
  const before = bank.ctx._created.length
  bank.shoot()
  assert.ok(bank.ctx._created.length - before >= 5)
  bank.dispose()
}
{
  // reload(): two scheduled noise clicks = 6 nodes
  const bank = bankWithFakeCtx()
  const before = bank.ctx._created.length
  bank.reload()
  assert.ok(bank.ctx._created.length - before >= 6)
  bank.dispose()
}
{
  // startAmbient() builds 6 nodes and toggles the flag; stopAmbient() clears it
  const bank = bankWithFakeCtx()
  assert.strictEqual(bank._ambientOn, false)
  const before = bank.ctx._created.length
  bank.startAmbient()
  assert.strictEqual(bank._ambientOn, true)
  assert.ok(bank.ctx._created.length - before >= 6)
  bank.startAmbient()               // idempotent: no second bed
  assert.strictEqual(bank.ctx._created.length - before, 6)
  bank.stopAmbient()
  assert.strictEqual(bank._ambientOn, false)
  bank.stopAmbient()                // safe to repeat
  bank.dispose()
}
{
  // muted routing: setMuted drives the master gain; toggle flips it
  const bank = bankWithFakeCtx()
  assert.strictEqual(bank.master.gain.value, 1)   // fake default
  bank.setMuted(true)
  assert.strictEqual(bank.master.gain.value, 0)
  bank.toggleMuted()
  assert.strictEqual(bank.master.gain.value, 0.6)
  bank.dispose()
}
{
  // dispose() closes the context and leaves every method safe
  const bank = bankWithFakeCtx()
  bank.startAmbient()
  bank.dispose()
  assert.strictEqual(bank.ctx, null)
  bank.shoot(); bank.hitZombie(); bank.reload(); bank.playWave(2); bank.playDeath()
  bank.startAmbient(); bank.stopAmbient()
  assert.strictEqual(bank._ambientOn, false)
}

// ---- V8: groan scheduler (pure bookkeeping, works headless) ---------------
{
  // Determinism: two fresh banks over identical zombie lists produce
  // identical per-frame schedules.
  const b1 = new AudioBank(), b2 = new AudioBank()
  const z1 = [fakeZombie('walker', 3, 0), fakeZombie('shambler', 8, 2), fakeZombie('screamer', 12, -4)]
  const z2 = z1.map(z => fakeZombie(z.type, z.position.x, z.position.z))
  const s1 = [], s2 = []
  for (let i = 0; i < 60 * 15; i++) {
    s1.push(JSON.stringify(b1.updateGroans(1 / 60, z1, { x: 0, z: 0 })))
    s2.push(JSON.stringify(b2.updateGroans(1 / 60, z2, { x: 0, z: 0 })))
  }
  assert.deepStrictEqual(s1, s2)
  const framesWithGroans = s1.filter(s => JSON.parse(s).length > 0).length
  assert.ok(framesWithGroans > 5, `too few groans in 15 s: ${framesWithGroans}`)
  b1.dispose(); b2.dispose()
}
{
  // 30 m cutoff: distant zombies never groan; near ones do.
  const bank = new AudioBank()
  const far = fakeZombie('walker', 40, 0)
  const near = fakeZombie('walker', 29, 0)
  let farCount = 0, nearCount = 0
  for (let i = 0; i < 60 * 20; i++) {
    const s = bank.updateGroans(1 / 60, [far, near], { x: 0, z: 0 })
    for (const g of s) { if (g.distance >= 30) farCount++; else nearCount++ }
  }
  assert.strictEqual(farCount, 0)
  assert.ok(nearCount > 0, 'near zombie never groaned')
  bank.dispose()
}
{
  // Concurrency cap: 6 nearby zombies, active voices never exceed 4.
  const bank = new AudioBank()
  const zs = []
  for (let i = 0; i < 6; i++) zs.push(fakeZombie('walker', 3 + i, 0))
  let maxActive = 0, fires = 0
  for (let i = 0; i < 60 * 30; i++) {
    fires += bank.updateGroans(1 / 60, zs, { x: 0, z: 0 }).length
    maxActive = Math.max(maxActive, bank.activeGroans())
  }
  assert.ok(maxActive <= 4, `cap breached: ${maxActive}`)
  assert.ok(fires > 4, 'no groans fired at all')
  bank.dispose()
}
{
  // Per-type cadence: both types vocalize; walkers groan more often than
  // shamblers (shorter period) over the same window.
  const bank = new AudioBank()
  const zs = [fakeZombie('walker', 4, 0), fakeZombie('shambler', 4, 6)]
  let w = 0, sh = 0
  for (let i = 0; i < 60 * 20; i++) {
    for (const g of bank.updateGroans(1 / 60, zs, { x: 0, z: 0 })) {
      if (g.type === 'walker') w++
      else if (g.type === 'shambler') sh++
    }
  }
  assert.ok(w >= 1 && sh >= 1, `walker ${w}, shambler ${sh} — both must groan`)
  assert.ok(w > sh, `walker ${w} not > shambler ${sh} over 20 s`)
  bank.dispose()
}
{
  // Distance falloff: closer groans carry higher gain.
  const bank = new AudioBank()
  const zs = [fakeZombie('walker', 5, 0), fakeZombie('walker', 25, 0)]
  let gNear = null, gFar = null
  for (let i = 0; i < 60 * 20 && (gNear === null || gFar === null); i++) {
    for (const g of bank.updateGroans(1 / 60, zs, { x: 0, z: 0 })) {
      if (g.distance < 10 && gNear === null) gNear = g.gain
      if (g.distance > 20 && gFar === null) gFar = g.gain
    }
  }
  assert.ok(gNear !== null && gFar !== null, 'one distance never groaned')
  assert.ok(gNear > gFar, `gain 5m (${gNear}) not > 25m (${gFar})`)
  bank.dispose()
}
{
  // Dead zombies stop groaning.
  const bank = new AudioBank()
  const z = fakeZombie('walker', 4, 0)
  let first = -1
  for (let i = 0; i < 60 * 10; i++) {
    if (bank.updateGroans(1 / 60, [z], { x: 0, z: 0 }).length) { first = i; break }
  }
  assert.ok(first >= 0, 'groan never started')
  z.isDead = true
  let after = 0
  for (let i = 0; i < 60 * 10; i++) after += bank.updateGroans(1 / 60, [z], { x: 0, z: 0 }).length
  assert.strictEqual(after, 0, 'dead zombie still groaning')
  bank.dispose()
}
// ---- V8: one-shot voices + groans build real graphs under the fake ctx ----
{
  const bank = bankWithFakeCtx()
  let before = bank.ctx._created.length
  bank.axeSwing() // noise burst (3 nodes) + falling thud (2)
  assert.ok(bank.ctx._created.length - before >= 5)
  before = bank.ctx._created.length
  bank.pickup() // two rising chirps (4)
  assert.ok(bank.ctx._created.length - before >= 4)
  before = bank.ctx._created.length
  bank.drop() // thud (2) + noise tick (3)
  assert.ok(bank.ctx._created.length - before >= 5)
  before = bank.ctx._created.length
  bank.flashlightClick() // click noise (3) + tick tone (2)
  assert.ok(bank.ctx._created.length - before >= 5)
  before = bank.ctx._created.length
  bank.weaponSwitch() // two clicks (6) + thud (2)
  assert.ok(bank.ctx._created.length - before >= 8)
  bank.dispose()
}
{
  // Groan timbre: walker/shambler = tone + lowpassed noise; screamer =
  // sawtooth shriek; beyond cutoff nothing is built.
  const bank = bankWithFakeCtx()
  let before = bank.ctx._created.length
  bank.groan('walker', 10)
  assert.ok(bank.ctx._created.length - before >= 5)
  before = bank.ctx._created.length
  bank.groan('screamer', 10)
  assert.ok(bank.ctx._created.length - before >= 2)
  before = bank.ctx._created.length
  bank.groan('walker', 40) // beyond cutoff: no nodes
  assert.strictEqual(bank.ctx._created.length - before, 0)
  bank.dispose()
}

console.log('audio OK')
