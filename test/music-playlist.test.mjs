// Focused tests for the procedural music system: MusicEngine (three looping
// oscillator tracks + crossfade + headless state), MusicDirector (track
// selection from waves/state/tension), and the AudioBank integration
// (playMusicTrack / musicState / mute / dispose). Uses the same fake
// AudioContext stand-in shape as test/audio.test.mjs.
import assert from 'node:assert'
import { MusicEngine } from '../src/game/MusicEngine.js'
import { MusicDirector } from '../src/game/MusicDirector.js'
import { AudioBank } from '../src/game/AudioBank.js'

// Minimal WebAudio stand-in (same shape as audio.test.mjs): nodes with
// connect/start/stop, AudioParams with the scheduling methods.
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
    createWaveShaper() { return ctx._make(node('shaper')) },
    createBuffer(ch, len, rate) { return { getChannelData: () => new Float32Array(len) } },
    resume() { this.state = 'running'; return Promise.resolve() },
    close() { this.state = 'closed'; return Promise.resolve() }
  }
  return ctx
}

function engineWithCtx() {
  const ctx = makeFakeAudioContext()
  const eng = new MusicEngine()
  eng.start(ctx, ctx.destination)
  return eng
}

// ---- MusicEngine: state + graph ------------------------------------------
{
  // start('ambient') builds the first cycle and flips the observable state.
  const eng = engineWithCtx()
  eng.startTrack('ambient')
  assert.strictEqual(eng.currentTrack, 'ambient')
  assert.strictEqual(eng.isPlaying, true)
  assert.ok(eng.ctx._created.length >= 2, 'no nodes scheduled')
  const out = eng.outGain
  assert.ok(out._children.includes(eng.ctx.destination), 'outGain not wired to dest')
  assert.strictEqual(out.gain.value, 1, 'output gain ramped up')
  // switchTrack crossfades: the outgoing outGain ramps toward 0 while the
  // new track's voices get built. State flips; nothing throws.
  eng.switchTrack('combat')
  assert.strictEqual(eng.currentTrack, 'combat')
  assert.strictEqual(eng.isPlaying, true)
  eng.switchTrack('crisis')
  assert.strictEqual(eng.currentTrack, 'crisis')
  // Re-switching to the current track is a no-op (no extra nodes).
  const before = eng.ctx._created.length
  eng.switchTrack('crisis')
  assert.strictEqual(eng.ctx._created.length, before, 'redundant switch built nodes')
  // Scheduler wraps the pattern index instead of running out of notes.
  eng.ctx.currentTime = 30
  eng.update()
  assert.ok(eng.ctx._created.length > before, 'scheduler stopped scheduling')
  eng.dispose()
}
{
  // Node bookkeeping stays bounded: voices whose scheduled stop has passed are
  // dropped from _nodes/_fade/_ends, so a long session cannot leak references.
  const eng = engineWithCtx()
  eng.startTrack('crisis')
  for (let sec = 0; sec < 3600; sec++) {
    eng.ctx.currentTime = sec
    eng.update()
  }
  assert.ok(eng._nodes.length < 120, 'live-node list must stay bounded, got ' + eng._nodes.length)
  assert.ok(eng._ends.length < 64, 'prune queue must stay bounded, got ' + eng._ends.length)
  assert.ok(eng._created === undefined || eng.ctx._created.length > 1000,
    'scheduler must still have produced many voices over the hour')
  // Many rapid switches must not accumulate dead nodes either.
  for (let i = 0; i < 200; i++) {
    eng.ctx.currentTime += 1
    eng.update()
    eng.switchTrack(i % 2 ? 'combat' : 'crisis')
  }
  eng.ctx.currentTime += 2
  eng.update()
  assert.ok(eng._nodes.length < 120, 'switch storm leaked nodes: ' + eng._nodes.length)
  assert.ok(eng._fade.length < 16, 'fade queue leaked: ' + eng._fade.length)
  eng.dispose()
}
{
  // resume() restores the LAST output ceiling, not a hard 1 (mute-safe).
  const eng = engineWithCtx()
  eng.setOutputGain(0.5)
  eng.startTrack('combat')
  assert.strictEqual(eng.outGain.gain.value, 0.5, 'start must respect the ceiling')
  eng.pause()
  eng.resume()
  assert.strictEqual(eng.outGain.gain.value, 0.5, 'resume must restore the ceiling')
  eng.setOutputGain(0)
  assert.strictEqual(eng.outGain.gain.value, 0)
  eng.dispose()
}
{
  // Deterministic playlist object (owned, plain, no live nodes).
  const eng = new MusicEngine()
  const pl = eng.playlist
  assert.deepStrictEqual(pl.order, ['ambient', 'combat', 'crisis'])
  assert.strictEqual(pl.mode, 'state')
  assert.notStrictEqual(pl, eng.playlist, 'playlist must be a fresh object')
}
{
  // pause/resume keep the track; stop clears it; dispose is idempotent.
  const eng = engineWithCtx()
  eng.startTrack('combat')
  eng.pause()
  assert.strictEqual(eng.isPlaying, false)
  assert.strictEqual(eng.currentTrack, 'combat', 'pause must remember the track')
  eng.resume()
  assert.strictEqual(eng.isPlaying, true)
  assert.strictEqual(eng.currentTrack, 'combat')
  eng.stop()
  assert.strictEqual(eng.isPlaying, false)
  assert.strictEqual(eng.currentTrack, null)
  eng.dispose()
  eng.dispose() // second dispose must not throw
  assert.strictEqual(eng.currentTrack, null)
  assert.strictEqual(eng.isPlaying, false)
  assert.strictEqual(eng.outGain, null, 'dispose must null the out gain')
  // Calls after dispose are safe no-ops.
  eng.startTrack('ambient'); eng.switchTrack('crisis'); eng.pause(); eng.resume()
  eng.setOutputGain(0.5); eng.update(); eng.stop()
}
{
  // Headless (no ctx): every method no-ops but state still tracks.
  const eng = new MusicEngine()
  eng.startTrack('ambient')
  assert.strictEqual(eng.currentTrack, 'ambient')
  assert.strictEqual(eng.isPlaying, true)
  assert.strictEqual(eng.outGain, null)
  eng.switchTrack('crisis')
  assert.strictEqual(eng.currentTrack, 'crisis')
  eng.pause(); eng.resume(); eng.update(); eng.setOutputGain(0.3)
  assert.strictEqual(eng.isPlaying, true)
  eng.stop()
  assert.strictEqual(eng.isPlaying, false)
  eng.dispose()
}
{
  // Unknown track names are ignored; resume with no track is a no-op.
  const eng = engineWithCtx()
  eng.startTrack('nope')
  assert.strictEqual(eng.currentTrack, null)
  eng.resume()
  assert.strictEqual(eng.isPlaying, false)
  eng.dispose()
}

// ---- MusicDirector --------------------------------------------------------
function stubBank() {
  return {
    calls: [],
    pauseCalls: 0,
    resumeCalls: 0,
    stopCalls: 0,
    last: null,
    playMusicTrack(n) { this.calls.push(n); this.last = n },
    stopMusicTrack() { this.stopCalls++; this.last = null },
    pauseMusic() { this.pauseCalls++ },
    resumeMusic() { this.resumeCalls++ },
    musicState() { return { current: this.last, playing: true, playlist: { order: [], mode: 'state' } } }
  }
}
{
  // Wave-driven selection: opening waves ambient, boss waves crisis.
  const bank = stubBank()
  const d = new MusicDirector(bank, { bossEvery: 5 })
  d.onWaveStart(1)
  assert.strictEqual(bank.last, 'ambient', 'wave 1 must be ambient')
  d.onWaveStart(3)
  assert.strictEqual(bank.last, 'combat', 'wave 3 must be combat')
  d.onWaveStart(5)
  assert.strictEqual(bank.last, 'crisis', 'boss wave 5 must be crisis')
  d.onWaveCleared(5)
  assert.strictEqual(bank.last, 'ambient', 'cleared boss wave returns to ambient')
  d.onWaveCleared(3)
  assert.strictEqual(bank.last, 'ambient', 'cleared non-boss wave returns to ambient')
  // Tension hysteresis: crisis in, leave crisis out.
  d.onWaveStart(4)
  assert.strictEqual(bank.last, 'combat')
  d.onTension(0.9)
  assert.strictEqual(bank.last, 'crisis', 'high tension must switch to crisis')
  d.onTension(0.8) // already crisis: no extra switch
  d.onTension(0.1)
  assert.strictEqual(bank.last, 'combat', 'low tension must leave crisis')
  d.onTension(0.9)
  assert.strictEqual(bank.last, 'crisis')
  d.onWaveStart(1)
  d.onTension(0.1)
  assert.strictEqual(bank.last, 'ambient', 'low tension in an early wave returns to ambient')
  // State transitions pause/resume/stop.
  d.onStateChange('paused', 'playing')
  assert.strictEqual(bank.pauseCalls, 1, 'paused must pause the music')
  d.onStateChange('playing', 'paused')
  assert.strictEqual(bank.resumeCalls, 1, 'playing must resume the music')
  d.onStateChange('gameover', 'playing')
  assert.strictEqual(bank.stopCalls, 1, 'gameover must stop the music')
  d.reset()
  assert.strictEqual(bank.last, 'ambient', 'reset starts the opening track')
}
{
  // Null bank: every call no-ops and never throws.
  const d = new MusicDirector(null)
  d.onWaveStart(5); d.onWaveCleared(5); d.onTension(1)
  d.onStateChange('paused', 'playing'); d.reset()
  assert.strictEqual(d.available, false)
}

// ---- AudioBank integration ------------------------------------------------
{
  // Headless bank: engine exists, tracks state, mute + dispose are safe.
  const bank = new AudioBank()
  assert.ok(bank._musicEngine, 'engine must exist headless')
  bank.playMusicTrack('combat')
  assert.strictEqual(bank.musicState.current, 'combat')
  bank.setMusicMuted(true)
  bank.setMuted(true)
  bank.pauseMusic(); bank.resumeMusic(); bank.stopMusicTrack()
  assert.strictEqual(bank.musicState.current, null)
  bank.dispose()
  assert.strictEqual(bank._musicEngine, null, 'dispose must clear the engine')
  bank.playMusicTrack('ambient') // safe after dispose
  bank.dispose()
}
{
  // With a fake ctx + fake Audio element: playMusicTrack builds the engine
  // graph into the music bus, mute silences it, dispose tears it down.
  globalThis.Audio = function () {
    this.loop = true; this.preload = ''; this.src = ''; this.currentTime = 0
    this.paused = false; this.duration = NaN
    this.play = () => { this.paused = false; return Promise.resolve() }
    this.pause = () => { this.paused = true }
    this.addEventListener = () => {}
    this.removeEventListener = () => {}
  }
  try {
    const bank = new AudioBank()
    bank.ctx = makeFakeAudioContext()
    bank.master = bank.ctx.createGain()
    bank.shaper = bank.ctx.createWaveShaper()
    bank.shaper.curve = bank._makeLimiterCurve()
    bank.master.connect(bank.shaper)
    bank.shaper.connect(bank.ctx.destination)
    bank._noiseBuffer = bank.ctx.createBuffer(1, 4, 44100)
    bank.ctx.createMediaElementSource = function (el) {
      const n = { name: 'media', _children: [], connect(t) { this._children.push(t) }, _el: el }
      this._created.push(n)
      return n
    }
    bank.playMusicTrack('combat')
    assert.strictEqual(bank.musicState.current, 'combat')
    assert.strictEqual(bank.musicState.playing, true)
    assert.deepStrictEqual(bank.musicState.playlist.order, ['ambient', 'combat', 'crisis'])
    assert.strictEqual(bank._musicEngineWired, true, 'engine graph must be wired')
    assert.ok(bank._musicEngine.outGain._children.includes(bank.master),
      'engine output must reach the music bus')
    bank.playMusicTrack('crisis')
    assert.strictEqual(bank.musicState.current, 'crisis')
    bank.setMusicMuted(true)
    assert.strictEqual(bank._musicEngine.outGain.gain.value, 0, 'music mute must silence the engine')
    bank.setMusicMuted(false)
    assert.ok(bank._musicEngine.outGain.gain.value > 0, 'unmute restores the engine')
    bank.setMuted(true)
    assert.strictEqual(bank._musicEngine.outGain.gain.value, 0, 'global mute silences the engine')
    bank.setMuted(false)
    bank.pauseMusic()
    assert.strictEqual(bank.musicState.playing, false)
    bank.resumeMusic()
    assert.strictEqual(bank.musicState.playing, true)
    bank.dispose()
    assert.strictEqual(bank._musicEngine, null, 'dispose clears the engine')
    assert.strictEqual(bank.musicState.current, null)
  } finally {
    delete globalThis.Audio
  }
}
{
  // The mp3 layer still works untouched alongside the engine.
  const bank = new AudioBank()
  bank.playMusic('x.mp3')
  bank.playLevelMusic(['a.mp3', 'b.mp3'], 1, 120)
  bank.stopMusic()
  bank.dispose()
}