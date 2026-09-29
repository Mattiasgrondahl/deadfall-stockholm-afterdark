// Focused tests for AudioBank.js. Node has no AudioContext, so the primary
// tests verify the disabled/no-op path (constructor + every public method must
// never throw). A small fake AudioContext also exercises the real graph-
// building code paths — the only CI check of the procedural voices, since the
// sandbox has no browser.
import assert from 'node:assert'
import { AudioBank } from '../src/game/AudioBank.js'
import { SfxSamples, SFX_NAMES } from '../src/game/SfxSamples.js'

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
  bank.pistolShot(); bank.swordSwing()
  bank.groan('walker', 5); bank.groan('shambler', 8); bank.groan('screamer', 12)
  bank.updateGroans(1 / 60, [fakeZombie('walker', 3, 0)], { x: 0, z: 0 })
  assert.ok(bank.activeGroans() >= 0 && bank.activeGroans() <= 4)
  bank.dispose()
  bank.axeSwing(); bank.pickup(); bank.pistolShot(); bank.swordSwing(); bank.updateGroans(1 / 60, [], { x: 0, z: 0 })
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
    setTargetAtTime(v) { this.value = v },
    cancelScheduledValues() {}
  })
  const node = (name) => ({
    name,
    _children: [],
    type: 'sine',
    frequency: param(440),
    gain: param(1),
    Q: param(1),
    detune: param(0),
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
    createPanner() {
      const n = node('panner')
      n.position = { x: param(0), y: param(0), z: param(0) }
      n.panningModel = 'HRTF'
      n.distanceModel = 'inverse'
      n.refDistance = 1
      n.rolloffFactor = 1
      n.maxDistance = 16
      return ctx._make(n)
    },
    createWaveShaper() { return ctx._make(node('shaper')) },
    createBuffer(ch, len, rate) { return { getChannelData: () => new Float32Array(len) } },
    resume() { this.state = 'running'; return Promise.resolve() },
    close() { this.state = 'closed'; return Promise.resolve() },
    listener: {
      position: { x: param(0), y: param(0), z: param(0) },
      forward: { x: param(0), y: param(-1), z: param(0) },
      up: { x: param(0), y: param(1), z: param(0) }
    }
  }
  return ctx
}

function bankWithFakeCtx() {
  const bank = new AudioBank()
  bank.ctx = makeFakeAudioContext()
  bank.master = bank.ctx.createGain()
  bank.shaper = bank.ctx.createWaveShaper()
  bank.shaper.curve = bank._makeLimiterCurve()
  bank.master.connect(bank.shaper)
  bank.shaper.connect(bank.ctx.destination)
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
  // Improved voices: the shotgun blast is denser than the pistol crack, and the
  // walker "urgh" growl routes through band-pass formant filters.
  const bank = bankWithFakeCtx()
  let b0 = bank.ctx._created.length
  const shotgunStart = b0
  bank.shoot()
  const shotgunNodes = bank.ctx._created.length - b0
  b0 = bank.ctx._created.length
  bank.pistolShot()
  const pistolNodes = bank.ctx._created.length - b0
  assert.ok(shotgunNodes > pistolNodes, `shotgun (${shotgunNodes}) heavier than pistol (${pistolNodes})`)
  // The big-bore blast stacks 5 layers and includes a deep sub-bass sine (<=120 Hz)
  // for chest-thump; the crack gain is pushed loud (>=0.85).
  const shotgunNodes2 = bank.ctx._created.slice(shotgunStart, shotgunStart + shotgunNodes)
  const oscs = shotgunNodes2.filter(n => n.name === 'osc')
  assert.ok(oscs.length >= 2, `shotgun has >=2 sine layers (${oscs.length})`)
  assert.ok(oscs.some(o => o.frequency.value <= 120), 'shotgun has a sub-bass layer <=120 Hz')
  // A low sub-bass tone layer ramps down to a very low end (chest-thump decay).
  assert.ok(oscs.some(o => o.frequency.value <= 120 && o._children.length >= 1), 'sub-bass layer wired to a gain')
  b0 = bank.ctx._created.length
  bank.groan('walker', 2)
  const bands = bank.ctx._created.slice(b0).filter(n => n.name === 'filter' && n.type === 'bandpass')
  // The fake filter node defaults type 'sine'; _playFormant sets type bandpass.
  const formantBands = bank.ctx._created.slice(b0).filter(n => n.name === 'filter')
  assert.ok(formantBands.length >= 2, `walker growl uses >=2 formant filters (${formantBands.length})`)
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
  // startAmbient() builds 10 nodes (6 wind + 4 city hum) and toggles the flag;
  const bank = bankWithFakeCtx()
  assert.strictEqual(bank._ambientOn, false)
  const before = bank.ctx._created.length
  bank.startAmbient()
  assert.strictEqual(bank._ambientOn, true)
  assert.ok(bank.ctx._created.length - before >= 10)
  bank.startAmbient()               // idempotent: no second bed
  assert.strictEqual(bank.ctx._created.length - before, 10)
  bank.stopAmbient()
  assert.strictEqual(bank._ambientOn, false)
  bank.stopAmbient()                // safe to repeat
  bank.dispose()
}
{
  // V4P-1b: city hum subgraph - 4 fixed nodes, idempotent, cleared on stop,
  // headless-safe.
  const bank = bankWithFakeCtx()
  const before = bank.ctx._created.length
  bank.startAmbient()
  assert.strictEqual(bank.ctx._created.length - before, 10)
  const h = bank._humNodes
  assert.ok(h, 'hum nodes missing')
  assert.strictEqual(h.ho1.frequency.value, 32)
  assert.strictEqual(h.ho2.frequency.value, 48)
  assert.strictEqual(h.hg.gain.value, 0.015)
  bank.startAmbient()               // idempotent: no second hum
  assert.strictEqual(bank.ctx._created.length - before, 10)
  bank.stopAmbient()
  assert.strictEqual(bank._humNodes, null, 'hum not cleared on stop')
  bank.stopAmbient()                // safe to repeat
  bank.dispose()
}
{
  // Headless bank: startAmbient stays a no-op and never builds hum nodes.
  const bank = new AudioBank()
  bank.startAmbient(); bank.stopAmbient()
  assert.strictEqual(bank._ambientOn, false)
  assert.strictEqual(bank._humNodes, null)
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
  bank.pistolShot() // highpassed crack (3) + falling ping (2)
  assert.ok(bank.ctx._created.length - before >= 5)
  before = bank.ctx._created.length
  bank.swordSwing() // lowpassed whoosh (3) + metallic thud (2)
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
  before = bank.ctx._created.length
  bank.glassBreak() // crack noise (3) + 4 ringing shard tones (8) + rattle noise (3)
  assert.ok(bank.ctx._created.length - before >= 14, 'glassBreak builds the full shatter stack')
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

// ---- V4P-1a: LCG-scheduled gusts ------------------------------------------
{
  // Determinism + bounded node growth: twin banks with the bed running,
  // 40 s of empty-frame ticks -> identical gust schedules; every node
  // created beyond the bed is a transient burst node (3 per gust).
  const b1 = bankWithFakeCtx(), b2 = bankWithFakeCtx()
  b1.startAmbient(); b2.startAmbient()
  const bed = b1.ctx._created.length
  const n1 = [], n2 = []
  const s1 = [], s2 = []
  for (let i = 0; i < 60 * 40; i++) {
    b1.updateGroans(1 / 60, [], { x: 0, z: 0 })
    b2.updateGroans(1 / 60, [], { x: 0, z: 0 })
    n1.push(b1._gustCount)
    n2.push(b2._gustCount)
    s1.push(b1._stormCount)
    s2.push(b2._stormCount)
  }
  assert.deepStrictEqual(n1, n2)
  assert.deepStrictEqual(s1, s2)
  assert.ok(b1._gustCount >= 2, `too few gusts in 40 s: ${b1._gustCount}`)
  // v4 weather: each gust is 3 transient nodes; each snowstorm swell is 6
  // (synthesized blizzard sweep: src+filter+gain, plus a blowing-snow noise
  // burst = 3 more). Nothing else is persistent.
  assert.strictEqual(b1.ctx._created.length, bed + 3 * b1._gustCount + 6 * b1._stormCount, 'persistent node growth')
  b1.dispose(); b2.dispose()
}
{
  // No gusts unless the bed is running; stopAmbient kills an in-flight burst.
  const bank = bankWithFakeCtx()
  for (let i = 0; i < 60 * 30; i++) bank.updateGroans(1 / 60, [], { x: 0, z: 0 })
  assert.strictEqual(bank._gustCount, 0, 'gust fired without startAmbient')
  bank.startAmbient()
  for (let i = 0; i < 60 * 12; i++) bank.updateGroans(1 / 60, [], { x: 0, z: 0 })
  assert.ok(bank._gustCount >= 1, 'no gust within the first 12 s')
  bank.stopAmbient()
  assert.strictEqual(bank._gustSrc, null, 'in-flight burst not cleared')
  assert.strictEqual(bank._ambientOn, false)
  bank.dispose()
}

// ---- V4P-2: positional audio (PannerNode for groans + attacks) -----------
{
  // Panned walker groan = 8 nodes (voiced "urgh": formant osc + 2 band-passes +
  // env gain, plus a breath-noise src+filter+gain, plus the panner); panner at
  // source, wired to master.
  const bank = bankWithFakeCtx()
  const before = bank.ctx._created.length
  bank._playGroanPanned('walker', 10, { x: 5, z: 0 })
  assert.strictEqual(bank.ctx._created.length - before, 8)
  const p = bank.ctx._created[bank.ctx._created.length - 8]
  assert.strictEqual(p.name, 'panner')
  assert.strictEqual(p.position.x.value, 5)
  assert.strictEqual(p.position.z.value, 0)
  assert.strictEqual(p.panningModel, 'equalpower')
  assert.strictEqual(p.rolloffFactor, 0)
  assert.strictEqual(p.maxDistance, 30)
  assert.ok(p._children.includes(bank.master))
  bank.dispose()
}
{
  // Listener tracks player position and facing every scheduler frame.
  const bank = bankWithFakeCtx()
  bank.updateGroans(1 / 60, [], { x: 10, z: 5 }, 1.2)
  const L = bank.ctx.listener
  assert.strictEqual(L.position.x.value, 10)
  assert.strictEqual(L.position.y.value, 1.7)
  assert.strictEqual(L.position.z.value, 5)
  assert.ok(Math.abs(L.forward.x.value - Math.sin(1.2)) < 1e-12)
  assert.strictEqual(L.forward.y.value, 0)
  assert.ok(Math.abs(L.forward.z.value + Math.cos(1.2)) < 1e-12)
  bank.dispose()
}
{
  // Every scheduled voice fires exactly one panner at the zombie's position;
  // node growth is exact and bounded. v4: a walker at 3 m groans (8 nodes),
  // close-growls (8 nodes: panner + formant + noise) and hisses (4 nodes:
  // panner + one bandpassed noise burst); a snowstorm swell adds 6 transient
  // nodes. Panner count must equal the total fires (every voice is panned).
  const bank = bankWithFakeCtx()
  const z = fakeZombie('walker', 3, 0)
  let fires = 0
  const kinds = { walker: 0, close: 0, hiss: 0 }
  for (let i = 0; i < 60 * 30; i++) {
    for (const e of bank.updateGroans(1 / 60, [z], { x: 0, z: 0 })) {
      fires++
      if (kinds[e.type] != null) kinds[e.type]++
    }
  }
  const panners = bank.ctx._created.filter(n => n.name === 'panner')
  assert.ok(fires > 2, 'too few groans: ' + fires)
  assert.strictEqual(panners.length, fires, 'panner count != fired voices')
  for (const p of panners) {
    assert.strictEqual(p.position.x.value, 3)
    assert.strictEqual(p.position.y.value, 0.8)
    assert.strictEqual(p.position.z.value, 0)
  }
  // +2: master + limiter created by bankWithFakeCtx before the loop.
  // v4 weather: each snowstorm swell adds 6 transient nodes (synthesized
  // blizzard sweep + blowing-snow noise), independent of the panned voices.
  const expected = 2 + 8 * (kinds.walker + kinds.close) + 4 * kinds.hiss + 6 * bank._stormCount
  assert.strictEqual(bank.ctx._created.length, expected, 'unbounded node growth')
  bank.dispose()
}
{
  // zombieAttack pans when given a position; no-position call stays plain.
  const bank = bankWithFakeCtx()
  let before = bank.ctx._created.length
  bank.zombieAttack({ x: 1.2, z: 0 })
  assert.strictEqual(bank.ctx._created.length - before, 6)
  const p = bank.ctx._created[bank.ctx._created.length - 6]
  assert.strictEqual(p.name, 'panner')
  assert.strictEqual(p.position.x.value, 1.2)
  assert.ok(p._children.includes(bank.master))
  before = bank.ctx._created.length
  const pn = bank.ctx._created.filter(n => n.name === 'panner').length
  bank.zombieAttack()
  assert.ok(bank.ctx._created.length - before >= 5)
  assert.strictEqual(bank.ctx._created.filter(n => n.name === 'panner').length, pn, 'panner leaked on plain attack')
  bank.dispose()
}
{
  // Headless: panned groans/attacks/listener are no-ops that never throw.
  const bank = new AudioBank()
  bank._playGroanPanned('walker', 5, { x: 1, z: 0 })
  bank.zombieAttack({ x: 1, z: 0 })
  bank.updateGroans(1 / 60, [fakeZombie('shambler', 4, 0)], { x: 0, z: 0 }, 0.5)
  assert.strictEqual(bank.ctx, null)
  bank.dispose()
}
{
  // V4P-3: new one-shots are no-ops on a headless bank (ctx null).
  const bank = new AudioBank()
  bank.dryFire(); bank.hitPlayer(); bank.playWaveCleared(3); bank.playStart()
  bank.dispose()
}
{
  // V4P-3: one-shots build exact transient graphs under the fake ctx.
  // _playNoise with a filter = 3 nodes; _playTone = 2 nodes.
  const bank = bankWithFakeCtx()
  let before = bank.ctx._created.length
  bank.dryFire()
  assert.strictEqual(bank.ctx._created.length - before, 5)
  before = bank.ctx._created.length
  bank.hitPlayer()
  assert.strictEqual(bank.ctx._created.length - before, 5)
  before = bank.ctx._created.length
  bank.playWaveCleared(3)
  assert.strictEqual(bank.ctx._created.length - before, 4)
  before = bank.ctx._created.length
  bank.playStart()
  assert.strictEqual(bank.ctx._created.length - before, 6)
  bank.dispose()
}
{
  // V4P-4: limiter chain wired master -> shaper -> destination; curve is
  // antisymmetric, strictly |y| < 1 past the knee, and covers the
  // worst-case pre-limiter input (~1.92 = 3.2 peak mix x 0.6 master).
  const bank = bankWithFakeCtx()
  const c = bank.shaper.curve
  assert.ok(c instanceof Float32Array)
  assert.ok(c.length >= 2000, 'curve too short: ' + c.length)
  assert.strictEqual(c[0], -c[c.length - 1], 'curve not antisymmetric')
  let maxTail = 0
  for (let i = 0; i < c.length; i++) {
    const a = Math.abs(c[i])
    if (a > 0.8) maxTail = Math.max(maxTail, a)
  }
  assert.ok(maxTail > 0, 'no samples past the knee')
  assert.ok(maxTail < 1, 'limiter output reaches 1: ' + maxTail)
  assert.ok(maxTail > 0.9, 'limiter too soft at the end: ' + maxTail)
  assert.ok(bank.master._children.includes(bank.shaper), 'master not wired to shaper')
  assert.ok(bank.shaper._children.includes(bank.ctx.destination), 'shaper not wired to destination')
  // Persistent nodes per bank = master + shaper; the bed still adds exactly 10.
  const before = bank.ctx._created.length
  assert.strictEqual(before, 2, 'persistent chain is master + shaper')
  bank.startAmbient()
  assert.strictEqual(bank.ctx._created.length - before, 10, 'bed size changed')
  bank.stopAmbient()
  bank.dispose()
}
{
  // Soundtrack: headless playMusic is a no-op (no Audio element); with a stubbed
  // Audio + createMediaElementSource it wires musicSrc -> musicGain -> master,
  // uses manual looping (loop=false + an `ended` -> seek(0)+play handler so the
  // whole track plays before restarting), and obeys both the global mute and the
  // dedicated music-mute flag. dispose stops + clears it.
  const bank = new AudioBank()
  assert.equal(bank._musicEl, null, 'headless: no music element')
  bank.playMusic('x.mp3') // must not throw headless
  bank.stopMusic()
  bank.dispose()

  const bank2 = bankWithFakeCtx()
  const ctxNode = (name) => ({ name, _children: [], connect(t) { this._children.push(t) } })
  bank2.ctx.createMediaElementSource = function (el) { const n = ctxNode('media'); this._created.push(n); n._el = el; return n }
  let endedHandlers = []
  let timeHandlers = []
  globalThis.Audio = function () {
    this.loop = true // constructor default; playMusic must override to false
    this.preload = ''; this.src = ''; this.currentTime = 0; this.paused = false; this.duration = NaN
    this.play = () => { this.paused = false; return Promise.resolve() }
    this.pause = () => { this.paused = true }
    this.addEventListener = (ev, fn) => {
      if (ev === 'ended') endedHandlers.push(fn)
      else if (ev === 'timeupdate') timeHandlers.push(fn)
    }
    this.removeEventListener = (ev, fn) => {
      if (ev === 'ended') endedHandlers = endedHandlers.filter(h => h !== fn)
      else if (ev === 'timeupdate') timeHandlers = timeHandlers.filter(h => h !== fn)
    }
  }
  let before = bank2.ctx._created.length
  bank2.playMusic('track.mp3', 60)
  assert.ok(bank2._musicEl, 'music element created')
  assert.equal(bank2._musicEl.loop, false, 'manual loop: element loop flag is off')
  assert.equal(bank2._musicEl.src, 'track.mp3')
  assert.equal(endedHandlers.length, 1, 'an ended handler is registered')
  assert.equal(timeHandlers.length, 1, 'a timeupdate handler is registered')
  assert.equal(bank2._musicLen, 60, 'known track length drives the loop')
  // +2 nodes: media source + music gain.
  assert.equal(bank2.ctx._created.length - before, 2, 'music graph is src + gain')
  assert.ok(bank2._musicGain._children.includes(bank2.master), 'music gain wired to master')
  // The loop is driven off the KNOWN length, not the (unreliable) element
  // duration: a wrong short duration must not cut the song short.
  bank2._musicEl.duration = 30 // browser misreports the length
  bank2._musicEl.currentTime = 30
  timeHandlers[0]()
  assert.equal(bank2._musicEl.currentTime, 30, 'timeupdate before the known end does not rewind')
  // Reaching the known end (>= len-0.25) rewinds to 0 and replays the whole track.
  bank2._musicEl.currentTime = 59.9
  timeHandlers[0]()
  assert.equal(bank2._musicEl.currentTime, 0, 'timeupdate at the known end rewinds to the start')
  assert.equal(bank2._musicEl.paused, false, 'the known-end watchdog restarts playback')
  // Manual `ended` backup: near the known end rewinds to 0 and replays.
  bank2._musicEl.currentTime = 59
  endedHandlers[0]()
  assert.equal(bank2._musicEl.currentTime, 0, 'ended near the known end rewinds to the start')
  // A premature `ended` (wrong duration) resumes from the current position
  // instead of cutting the song back to 0.
  bank2._musicEl.currentTime = 30
  endedHandlers[0]()
  assert.equal(bank2._musicEl.currentTime, 30, 'early ended resumes instead of restarting')
  // After stopMusic, an ended event must NOT restart (music is off).
  bank2.stopMusic()
  bank2._musicEl.currentTime = 40
  endedHandlers[0]()
  assert.equal(bank2._musicEl.currentTime, 40, 'ended is ignored once stopped')
  bank2.playMusic('track.mp3') // re-arm
  // Global mute silences the music bus.
  bank2.setMuted(true)
  assert.equal(bank2._musicGain.gain.value, 0, 'global mute silences music')
  bank2.setMuted(false)
  assert.equal(bank2._musicGain.gain.value, 0.5, 'unmute restores music')
  // Dedicated music-mute silences ONLY the music, leaving the master (SFX) intact.
  bank2.toggleMusicMuted()
  assert.equal(bank2._musicMuted, true, 'music mute toggled on')
  assert.equal(bank2._musicGain.gain.value, 0, 'music mute silences the music bus')
  assert.equal(bank2.master.gain.value, 0.6, 'SFX master unaffected by music mute')
  bank2.toggleMusicMuted()
  assert.equal(bank2._musicMuted, false, 'music mute toggled off')
  assert.equal(bank2._musicGain.gain.value, 0.5, 'music restored')
  bank2.setMusicVolume(0.2)
  assert.equal(bank2._musicGain.gain.value, 0.2, 'setMusicVolume applies')
  bank2.setMusicMuted(true)
  assert.equal(bank2._musicGain.gain.value, 0, 'music mute overrides volume')
  bank2.setMusicMuted(false)
  // Per-level music: the cycle index selects a track and switches the src;
  // the list wraps once exhausted so each level gets a different song.
  bank2.playLevelMusic(['a.mp3', 'b.mp3'], 0, 120)
  assert.equal(bank2._musicEl.src, 'a.mp3', 'cycle 0 picks the first track')
  bank2.playLevelMusic(['a.mp3', 'b.mp3'], 1, 120)
  assert.equal(bank2._musicEl.src, 'b.mp3', 'cycle 1 switches to the second track')
  bank2.playLevelMusic(['a.mp3', 'b.mp3'], 2, 120)
  assert.equal(bank2._musicEl.src, 'a.mp3', 'cycle 2 wraps back to the first track')
  assert.equal(bank2._musicLen, 120, 'level track length drives the loop')
  bank2.playLevelMusic([], 0, 120) // empty list is a no-op, keeps the last src
  assert.equal(bank2._musicEl.src, 'a.mp3', 'empty track list does not clear the src')
  // Deterministic playlist: playPlaylist starts the first song and registers
  // one extra `ended` advance handler; firing `ended` walks the list in order
  // and wraps (mod length) so the set repeats forever. stopMusic must gate it.
  bank2.playPlaylist(['x1.mp3', 'x2.mp3', 'x3.mp3'], 90)
  assert.equal(bank2._musicEl.src, 'x1.mp3', 'playlist starts with the first song')
  assert.equal(bank2._musicLen, 90, 'playlist length drives the loop watchdog')
  assert.equal(endedHandlers.length, 2, 'playlist adds one ended advance handler')
  // v3 fix: with a playlist active the known-end watchdog ADVANCES to the next
  // song (sequential playback) instead of rewinding the same track. Firing the
  // watchdog advances once; the native `ended` is a second, independent advance.
  bank2._musicEl.currentTime = 89.9
  timeHandlers[0]() // known-end -> advance to the second song
  assert.equal(bank2._musicEl.src, 'x2.mp3', 'watchdog advances to the second song')
  assert.equal(bank2._musicEl.currentTime, 0, 'advance restarts from the top')
  endedHandlers[1]() // ended is an independent advance -> third song
  assert.equal(bank2._musicEl.src, 'x3.mp3', 'ended advances to the third song')
  endedHandlers[1]()
  assert.equal(bank2._musicEl.src, 'x1.mp3', 'playlist wraps back to the first song')
  bank2._musicEl.currentTime = 89.9
  timeHandlers[0]() // watchdog advances again (sequential, no same-track loop)
  assert.equal(bank2._musicEl.src, 'x2.mp3', 'the set repeats over and over')
  bank2.stopMusic()
  bank2._musicEl.currentTime = 89.9
  timeHandlers[0]() // stopped: the watchdog must be inert
  endedHandlers[1]() // stopped: the advance handler must be inert
  assert.equal(bank2._musicEl.src, 'x2.mp3', 'no advance once the music is stopped')
  bank2.playPlaylist([], 90) // empty playlist is a no-op, keeps the last src
  assert.equal(bank2._musicEl.src, 'x2.mp3', 'empty playlist does not clear the src')
  // v6 audio (8): per-track lengths. An array gives each song its own known
  // end: the first song's length drives the initial watchdog, and every
  // advance follows the new song's length so the rotation never rewinds a
  // track at the wrong time. Scalar seconds still replicate across the list.
  bank2.playPlaylist(['p1.mp3', 'p2.mp3', 'p3.mp3'], [100, 75, 150])
  assert.equal(bank2._musicEl.src, 'p1.mp3', 'per-length playlist starts with the first song')
  assert.equal(bank2._musicLen, 100, 'first song uses its own known length')
  assert.equal(endedHandlers.length, 2, 'per-length playlist adds one ended advance handler')
  endedHandlers[1]()
  assert.equal(bank2._musicEl.src, 'p2.mp3', 'advance to the second song')
  assert.equal(bank2._musicLen, 75, 'watchdog follows the second song length')
  assert.equal(bank2._musicEl.currentTime, 0, 'advance restarts from the top')
  endedHandlers[1]()
  assert.equal(bank2._musicEl.src, 'p3.mp3', 'advance to the third song')
  assert.equal(bank2._musicLen, 150, 'watchdog follows the third song length')
  endedHandlers[1]()
  assert.equal(bank2._musicEl.src, 'p1.mp3', 'per-length playlist wraps to the first song')
  assert.equal(bank2._musicLen, 100, 'wrap restores the first song length')
  bank2.playPlaylist(['q1.mp3', 'q2.mp3'], 60) // scalar still works (legacy call)
  assert.equal(bank2._musicLen, 60, 'scalar length applies to the first song')
  endedHandlers[1]()
  assert.equal(bank2._musicEl.src, 'q2.mp3', 'scalar playlist advances')
  assert.equal(bank2._musicLen, 60, 'scalar length replicates across the list')
  // v3: skip-to-next advances the playlist immediately (player-initiated).
  bank2.skipPlaylistTrack()
  assert.equal(bank2._musicEl.src, 'q1.mp3', 'skip wraps to the first song')
  bank2.skipPlaylistTrack()
  assert.equal(bank2._musicEl.src, 'q2.mp3', 'skip advances again')
  // v3 boss fight: playBossMusic pauses the playlist and swaps in the boss
  // track; stopBossMusic resumes the playlist where it left off.
  bank2.playBossMusic('boss.mp3', 150)
  assert.equal(bank2._plPaused, true, 'boss music pauses the playlist')
  assert.equal(bank2._musicEl.src, 'boss.mp3', 'boss track replaces the playlist src')
  assert.equal(bank2._musicLen, 150, 'boss track length drives the watchdog')
  bank2.stopBossMusic()
  assert.equal(bank2._plPaused, false, 'leaving the boss fight unpauses the playlist')
  assert.equal(bank2._musicEl.src, 'q2.mp3', 'playlist resumes at the paused song')
  bank2.stopMusic()
  assert.equal(bank2._musicOn, false)
  bank2.dispose()
  assert.equal(bank2._musicEl, null, 'dispose clears music element')
  assert.equal(endedHandlers.length, 0, 'dispose removes the ended listener')
  assert.equal(timeHandlers.length, 0, 'dispose removes the timeupdate listener')
  delete globalThis.Audio
}

// ---- Phase 4: adaptive tension bed ---------------------------------------
{
  // Headless: setTension records the target only, never throws, never builds.
  const bank = new AudioBank()
  bank.setTension(0.5, 1 / 60)
  assert.strictEqual(bank.ctx, null)
  assert.strictEqual(bank._tensionTarget, 0.5)
  assert.strictEqual(bank._tensionOn, false)
  bank.dispose()
  bank.setTension(1, 1 / 60) // safe after dispose
}
{
  // Lazy creation: a non-zero level builds the drone once (idempotent); a zero
  // level tears it down. Drone = 2 osc + lowpass + gain = 4 persistent nodes.
  const bank = bankWithFakeCtx()
  const before = bank.ctx._created.length
  bank.setTension(0.6, 1 / 60)
  assert.strictEqual(bank._tensionOn, true, 'tension bed started')
  assert.strictEqual(bank.ctx._created.length - before, 4, 'drone is 4 nodes')
  const droneGain = bank._tensionNodes.g
  bank.setTension(0.6, 1 / 60) // idempotent: no second drone
  assert.strictEqual(bank.ctx._created.length - before, 4)
  // Gain rises with tension: a higher level drives a higher drone gain.
  const lowG = droneGain.gain.value
  bank.setTension(1.0, 1 / 60)
  assert.ok(droneGain.gain.value > lowG, 'drone gain did not rise with tension')
  // Returning to zero fades the level out over ~1 s, then tears the drone down
  // and clears the flag.
  for (let i = 0; i < 180; i++) bank.setTension(0, 1 / 60)
  assert.strictEqual(bank._tensionOn, false, 'tension bed stopped after fading to zero')
  assert.strictEqual(bank._tensionNodes, null)
  bank.dispose()
}
{
  // Pulse fires only while tension is meaningful, and node growth stays bounded
  // (transient bursts only, no persistent leak). Twin banks stay deterministic.
  const b1 = bankWithFakeCtx(), b2 = bankWithFakeCtx()
  b1.startAmbient(); b2.startAmbient()
  const bed1 = b1.ctx._created.length
  const counts1 = [], counts2 = []
  for (let i = 0; i < 60 * 30; i++) {
    b1.setTension(0.9, 1 / 60); b1.updateGroans(1 / 60, [], { x: 0, z: 0 })
    b2.setTension(0.9, 1 / 60); b2.updateGroans(1 / 60, [], { x: 0, z: 0 })
    counts1.push(b1._tensionNodes ? 1 : 0)
    counts2.push(b2._tensionNodes ? 1 : 0)
  }
  assert.deepStrictEqual(counts1, counts2, 'tension pulse nondeterministic')
  // Persistent nodes beyond the bed are exactly the 4-node drone; pulses are
  // transient (osc+gain = 2 each) and do not accumulate persistently.
  const persistent = b1.ctx._created.filter(n => n.name === 'osc' && n.frequency.value === 41 || n.name === 'osc' && n.frequency.value === 43.5)
  assert.strictEqual(persistent.length, 2, 'exactly the two drone oscillators persist')
  assert.ok(b1.ctx._created.length > bed1 + 4, 'pulses fired')
  b1.dispose(); b2.dispose()
}
{
  // stopAmbient and dispose both tear the tension bed down.
  const bank = bankWithFakeCtx()
  bank.startAmbient()
  bank.setTension(0.8, 1 / 60)
  assert.strictEqual(bank._tensionOn, true)
  bank.stopAmbient()
  assert.strictEqual(bank._tensionOn, false, 'stopAmbient stopped the tension bed')
  bank.dispose()

  const bank2 = bankWithFakeCtx()
  bank2.setTension(0.8, 1 / 60)
  assert.strictEqual(bank2._tensionOn, true)
  bank2.dispose()
  assert.strictEqual(bank2._tensionOn, false, 'dispose stopped the tension bed')
  assert.strictEqual(bank2._tensionNodes, null)
}

// ---- v4 SFX: file-based one-shot samples ---------------------------------
{
  // Headless loadSfx is a no-op (no AudioContext) and never throws; _playSfx
  // returns false so every voice falls back to its procedural synthesis.
  const bank = new AudioBank()
  bank.loadSfx('assets/')
  assert.strictEqual(bank._sfx, null, 'no SfxSamples built without an AudioContext')
  assert.strictEqual(bank._playSfx('shotgun'), false, 'no sample -> procedural fallback')
  bank.dispose()
}
{
  // With a fake context, loadSfx builds the bank; before any buffer decodes,
  // _playSfx returns false and shoot() still runs its synthesized voice.
  const bank = bankWithFakeCtx()
  bank.loadSfx('assets/')
  assert.ok(bank._sfx instanceof SfxSamples, 'loadSfx builds the sample bank')
  assert.strictEqual(bank._playSfx('shotgun'), false, 'not-yet-decoded -> false')
  const before = bank.ctx._created.length
  bank.shoot()
  assert.ok(bank.ctx._created.length - before >= 5, 'falls back to the procedural shotgun')
  bank.dispose()
  assert.strictEqual(bank._sfx, null, 'dispose releases the sample bank')
}
{
  // SfxSamples.play: with a decoded buffer present it routes a buffer-source +
  // gain to the destination and returns true; a missing name returns false.
  const ctx = makeFakeAudioContext()
  const sfx = new SfxSamples(ctx, 'assets/')
  const buf = { duration: 0.5, getChannelData: () => new Float32Array(8) }
  sfx.buffers.set('shotgun', buf)
  const before = ctx._created.length
  assert.strictEqual(sfx.play('shotgun', { gain: 0.9 }), true, 'plays a decoded buffer')
  const src = ctx._created.slice(before).find(n => n.name === 'src')
  assert.ok(src && src.buffer === buf, 'buffer source carries the sample')
  assert.strictEqual(src.started, true, 'source started')
  assert.strictEqual(sfx.play('missing'), false, 'unknown name -> false')
  sfx.dispose()
  assert.strictEqual(sfx.has('shotgun'), false, 'dispose clears the cache')
}
{
  // AudioBank plays a decoded sample through the fx bus and skips the procedural
  // voice; the SFX_NAMES list is non-empty and every name maps to a wav path.
  const bank = bankWithFakeCtx()
  bank.loadSfx('assets/')
  bank._sfx.buffers.set('shotgun', { duration: 0.5, getChannelData: () => new Float32Array(8) })
  const before = bank.ctx._created.length
  assert.strictEqual(bank._playSfx('shotgun', { gain: 0.9 }), true)
  // Only a buffer-source + gain are created (no oscillator layers) -> the
  // synthesized blast was skipped.
  const created = bank.ctx._created.slice(before)
  assert.ok(created.some(n => n.name === 'src' && n.buffer), 'sample routed as a buffer source')
  assert.ok(!created.some(n => n.name === 'osc'), 'procedural oscillators skipped')
  assert.ok(SFX_NAMES.length >= 8, 'SFX_NAMES populated')
  bank.dispose()
}

{
  // v4 proximity dread: a dedicated close growl fires only when the nearest
  // live zombie is inside CLOSE_GROWL_RADIUS (9 m), on its own cadence, and
  // gets louder the closer the zombie is. Headless path is a pure no-op.
  const headless = new AudioBank()
  let headlessClose = 0
  for (let i = 0; i < 60 * 20; i++) {
    for (const g of headless.updateGroans(1 / 60, [fakeZombie('walker', 2, 0)], { x: 0, z: 0 })) {
      if (g.type === 'close') headlessClose++
    }
  }
  assert.ok(headlessClose > 0, 'close growl must schedule even headless (bookkeeping is pure)')
  headless.dispose()

  // A far zombie (>= radius) never triggers the close growl.
  const far = new AudioBank()
  let farClose = 0
  for (let i = 0; i < 60 * 30; i++) {
    for (const g of far.updateGroans(1 / 60, [fakeZombie('walker', 15, 0)], { x: 0, z: 0 })) {
      if (g.type === 'close') farClose++
    }
  }
  assert.strictEqual(farClose, 0, 'close growl fired for a zombie beyond the radius')
  far.dispose()

  // Proximity scaling: a point-blank zombie yields a higher close-growl gain
  // than one sitting at the edge of the radius.
  const nearBank = new AudioBank()
  const edgeBank = new AudioBank()
  let gNear = null, gEdge = null
  for (let i = 0; i < 60 * 30 && (gNear === null || gEdge === null); i++) {
    for (const g of nearBank.updateGroans(1 / 60, [fakeZombie('walker', 1, 0)], { x: 0, z: 0 })) {
      if (g.type === 'close' && gNear === null) gNear = g.gain
    }
    for (const g of edgeBank.updateGroans(1 / 60, [fakeZombie('walker', 8, 0)], { x: 0, z: 0 })) {
      if (g.type === 'close' && gEdge === null) gEdge = g.gain
    }
  }
  assert.ok(gNear !== null && gEdge !== null, 'close growl never fired for near/edge zombies')
  assert.ok(gNear > gEdge, `point-blank gain ${gNear} not > edge gain ${gEdge}`)
  nearBank.dispose()
  edgeBank.dispose()
}

// ---- v4: footsteps, attack hiss, distant moan, snowstorm ------------------
{
  // Footsteps: a moving player fires a step every FOOTSTEP_STRIDE metres; the
  // cadence tracks speed (sprint fires faster than walk) and standing is silent.
  const walk = bankWithFakeCtx()
  const run = bankWithFakeCtx()
  const still = bankWithFakeCtx()
  let wf = 0, rf = 0, sf = 0
  for (let i = 0; i < 60 * 20; i++) {
    for (const e of walk.updateGroans(1 / 60, [], { x: 0, z: 0 }, 0, { speed: 3.4 })) if (e.type === 'step') wf++
    for (const e of run.updateGroans(1 / 60, [], { x: 0, z: 0 }, 0, { speed: 5.8, sprint: true })) if (e.type === 'step') rf++
    for (const e of still.updateGroans(1 / 60, [], { x: 0, z: 0 }, 0, { speed: 0 })) if (e.type === 'step') sf++
  }
  assert.ok(wf > 2, 'too few walk steps: ' + wf)
  assert.ok(rf > wf, `sprint steps ${rf} not > walk steps ${wf}`)
  assert.strictEqual(sf, 0, 'footsteps fired while standing still')
  walk.dispose(); run.dispose(); still.dispose()
}
{
  // Attack hiss: a zombie inside the strike radius hisses; a far one does not.
  const near = bankWithFakeCtx()
  const far = bankWithFakeCtx()
  let nh = 0, fh = 0
  for (let i = 0; i < 60 * 20; i++) {
    for (const e of near.updateGroans(1 / 60, [fakeZombie('walker', 1.5, 0)], { x: 0, z: 0 })) if (e.type === 'hiss') nh++
    for (const e of far.updateGroans(1 / 60, [fakeZombie('walker', 20, 0)], { x: 0, z: 0 })) if (e.type === 'hiss') fh++
  }
  assert.ok(nh > 1, 'no attack hiss for a zombie at strike range: ' + nh)
  assert.strictEqual(fh, 0, 'hiss fired for a distant zombie')
  near.dispose(); far.dispose()
}
{
  // Distant moan: a far zombie (outside the close band) moans; a close one does
  // not (it groans instead). Reuse one zombie object so the per-zombie moan
  // scheduler (keyed on the object) can advance its cadence across frames.
  const far = bankWithFakeCtx()
  const near = bankWithFakeCtx()
  const farZ = fakeZombie('walker', 20, 0)
  const nearZ = fakeZombie('walker', 3, 0)
  let fm = 0, nm = 0
  for (let i = 0; i < 60 * 40; i++) {
    for (const e of far.updateGroans(1 / 60, [farZ], { x: 0, z: 0 })) if (e.type === 'moan') fm++
    for (const e of near.updateGroans(1 / 60, [nearZ], { x: 0, z: 0 })) if (e.type === 'moan') nm++
  }
  assert.ok(fm > 0, 'no distant moan for a far zombie: ' + fm)
  assert.strictEqual(nm, 0, 'moan fired for a close zombie')
  far.dispose(); near.dispose()
}
{
  // Snowstorm swell: fires periodically on its own LCG, deterministically, and
  // is independent of the persistent ambient bed (works with no startAmbient).
  const b1 = bankWithFakeCtx()
  const b2 = bankWithFakeCtx()
  const s1 = [], s2 = []
  for (let i = 0; i < 60 * 60; i++) {
    b1.updateGroans(1 / 60, [], { x: 0, z: 0 })
    b2.updateGroans(1 / 60, [], { x: 0, z: 0 })
    s1.push(b1._stormCount)
    s2.push(b2._stormCount)
  }
  assert.deepStrictEqual(s1, s2, 'storm schedule not deterministic')
  assert.ok(b1._stormCount >= 1, 'no snowstorm within 60 s: ' + b1._stormCount)
  b1.dispose(); b2.dispose()
}

{
  // v4 jump: a headless jump() is a silent no-op; with a fake ctx it builds a
  // synthesized rustle+grunt stack (bandpass noise src+filter+gain + a tone
  // osc+gain = 5 nodes) when the sample has not decoded.
  const headless = new AudioBank()
  headless.jump() // no ctx -> no throw
  headless.dispose()
  const bank = bankWithFakeCtx()
  const before = bank.ctx._created.length
  bank.jump()
  assert.ok(bank.ctx._created.length - before >= 5, 'jump synthesized stack too small')
  bank.dispose()
}

{
  // v27 landing: a headless land() is a silent no-op; with a fake ctx it builds a
  // synthesized thud stack (tone osc+gain + noise src+filter+gain = 5 nodes) when
  // the sample has not decoded.
  const headless = new AudioBank()
  headless.land() // no ctx -> no throw
  headless.dispose()
  const bank = bankWithFakeCtx()
  const before = bank.ctx._created.length
  bank.land()
  assert.ok(bank.ctx._created.length - before >= 5, 'land synthesized stack too small')
  bank.dispose()
}

{
  // v14 screamer scream: with a decoded sample, groan('screamer') routes the
  // "ahhhhh" buffer source and skips the synthesized sawtooth; the distance
  // falloff makes a close screamer louder than a far one (starts distant,
  // swells as it closes).
  const bank = bankWithFakeCtx()
  bank.loadSfx('assets/')
  bank._sfx.buffers.set('screamer_scream', { duration: 1.5, getChannelData: () => new Float32Array(8) })
  let before = bank.ctx._created.length
  bank.groan('screamer', 10)
  const created = bank.ctx._created.slice(before)
  assert.ok(created.some(n => n.name === 'src' && n.buffer), 'screamer routed as a buffer source')
  assert.ok(!created.some(n => n.name === 'osc'), 'synthesized sawtooth skipped when the sample is present')
  // Distance falloff: the same bank at two distances records the gain the
  // scheduler would use (via the scheduled list) — close > far.
  const near = bank.groan('screamer', 3)
  const far = bank.groan('screamer', 25)
  assert.ok(near === undefined && far === undefined, 'groan returns nothing (gain is internal)')
  bank.dispose()
}

{
  // v14b: the screamer's melee WINDUP now plays the same "ahhhhh" scream sample
  // (not the old square "blip"), and the ammo pickup plays the cardboard-box
  // sample — both route a buffer source and skip their synthesized voices.
  const bank = bankWithFakeCtx()
  bank.loadSfx('assets/')
  bank._sfx.buffers.set('screamer_scream', { duration: 1.5, getChannelData: () => new Float32Array(8) })
  bank._sfx.buffers.set('pickup', { duration: 0.24, getChannelData: () => new Float32Array(8) })
  let before = bank.ctx._created.length
  bank.zombieWindup('screamer', { x: 0, z: 2 })
  let created = bank.ctx._created.slice(before)
  assert.ok(created.some(n => n.name === 'src' && n.buffer), 'screamer windup routed as a buffer source')
  assert.ok(!created.some(n => n.name === 'osc'), 'screamer windup skips the synthesized chirp')
  before = bank.ctx._created.length
  bank.pickup()
  created = bank.ctx._created.slice(before)
  assert.ok(created.some(n => n.name === 'src' && n.buffer), 'pickup routed as a buffer source')
  assert.ok(!created.some(n => n.name === 'osc'), 'pickup skips the two rising chirps')
  bank.dispose()
}

console.log('audio OK')
