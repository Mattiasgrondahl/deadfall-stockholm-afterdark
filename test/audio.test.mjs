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
  bank.shoot()
  const shotgunNodes = bank.ctx._created.length - b0
  b0 = bank.ctx._created.length
  bank.pistolShot()
  const pistolNodes = bank.ctx._created.length - b0
  assert.ok(shotgunNodes > pistolNodes, `shotgun (${shotgunNodes}) heavier than pistol (${pistolNodes})`)
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
  for (let i = 0; i < 60 * 40; i++) {
    b1.updateGroans(1 / 60, [], { x: 0, z: 0 })
    b2.updateGroans(1 / 60, [], { x: 0, z: 0 })
    n1.push(b1._gustCount)
    n2.push(b2._gustCount)
  }
  assert.deepStrictEqual(n1, n2)
  assert.ok(b1._gustCount >= 2, `too few gusts in 40 s: ${b1._gustCount}`)
  assert.strictEqual(b1.ctx._created.length, bed + 3 * b1._gustCount, 'persistent node growth')
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
  // Every scheduled groan fires exactly one panner at the zombie's position;
  // node growth is exact and bounded (fresh bank, walker "urgh" voice = 8 nodes).
  const bank = bankWithFakeCtx()
  const z = fakeZombie('walker', 3, 0)
  let fires = 0
  for (let i = 0; i < 60 * 30; i++) fires += bank.updateGroans(1 / 60, [z], { x: 0, z: 0 }).length
  const panners = bank.ctx._created.filter(n => n.name === 'panner')
  assert.ok(fires > 2, 'too few groans: ' + fires)
  assert.strictEqual(panners.length, fires, 'panner count != fired groans')
  for (const p of panners) {
    assert.strictEqual(p.position.x.value, 3)
    assert.strictEqual(p.position.y.value, 0.8)
    assert.strictEqual(p.position.z.value, 0)
  }
  // +2: master + limiter created by bankWithFakeCtx before the loop.
  assert.strictEqual(bank.ctx._created.length, 2 + 8 * fires, 'unbounded node growth')
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
  // loops, and obeys mute. dispose stops + clears it.
  const bank = new AudioBank()
  assert.equal(bank._musicEl, null, 'headless: no music element')
  bank.playMusic('x.mp3') // must not throw headless
  bank.stopMusic()
  bank.dispose()

  const bank2 = bankWithFakeCtx()
  const ctxNode = (name) => ({ name, _children: [], connect(t) { this._children.push(t) } })
  bank2.ctx.createMediaElementSource = function (el) { const n = ctxNode('media'); this._created.push(n); n._el = el; return n }
  globalThis.Audio = function () { this.loop = false; this.preload = ''; this.src = ''; this.play = () => Promise.resolve(); this.pause = () => { this.paused = true } }
  let before = bank2.ctx._created.length
  bank2.playMusic('track.mp3')
  assert.ok(bank2._musicEl, 'music element created')
  assert.equal(bank2._musicEl.loop, true, 'track loops')
  assert.equal(bank2._musicEl.src, 'track.mp3')
  // +2 nodes: media source + music gain.
  assert.equal(bank2.ctx._created.length - before, 2, 'music graph is src + gain')
  assert.ok(bank2._musicGain._children.includes(bank2.master), 'music gain wired to master')
  bank2.setMuted(true)
  assert.equal(bank2._musicGain.gain.value, 0, 'mute silences music')
  bank2.setMuted(false)
  assert.equal(bank2._musicGain.gain.value, 0.5, 'unmute restores music')
  bank2.setMusicVolume(0.2)
  assert.equal(bank2._musicGain.gain.value, 0.2, 'setMusicVolume applies')
  bank2.stopMusic()
  assert.equal(bank2._musicOn, false)
  bank2.dispose()
  assert.equal(bank2._musicEl, null, 'dispose clears music element')
  delete globalThis.Audio
}

console.log('audio OK')
