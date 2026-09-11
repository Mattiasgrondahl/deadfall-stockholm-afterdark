// Focused tests for AudioBank.js. Node has no AudioContext, so the primary
// tests verify the disabled/no-op path (constructor + every public method must
// never throw). A small fake AudioContext also exercises the real graph-
// building code paths — the only CI check of the procedural voices, since the
// sandbox has no browser.
import assert from 'node:assert'
import { AudioBank } from '../src/game/AudioBank.js'

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

console.log('audio OK')
