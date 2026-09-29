// MusicEngine.js — fully procedural soundtrack for Deadfall: three looping
// tracks (ambient / combat / crisis) built entirely from WebAudio oscillators
// and gain envelopes scheduled ahead of time, like the AudioBank voices. No
// mp3 assets, no Math.random (fixed note patterns only).
//
// Looping is pattern-based: each track is one fixed bar-length pattern whose
// notes are scheduled repeatedly while the engine runs. When the scheduler
// window passes a cycle boundary the pattern index wraps back to 0, so the
// loop is just the same pattern again — no abrupt silence and no clicks.
//
// Track changes crossfade: the outgoing track's gain ramps to 0 over 0.8 s
// (its nodes are stopped ~0.9 s later) while the incoming track ramps up.
// Every ramp starts from the parameter's current value after
// cancelScheduledValues + setValueAtTime, so there are no discontinuities.
//
// Headless-safe: with no AudioContext every method is a no-op that never
// throws, but internal state (current track, playing flag, playlist) still
// updates so tests can observe it. The engine owns exactly one output gain
// node (outGain) that the host (AudioBank) connects to its music bus.

// One bar per track, in seconds. Fixed note tables — fully deterministic.
const BAR = { ambient: 4.0, combat: 1.0, crisis: 0.5 }
// Note patterns: [semitone offset from the root, velocity 0..1] per eighth
// slot of one bar. Minor-key sets; crisis adds tritones + minor seconds.
const PATTERNS = {
  ambient: [[0, 0.5], [7, 0.35], [3, 0.4], [10, 0.3]],
  combat: [[0, 0.8], [0, 0.5], [7, 0.6], [10, 0.5], [12, 0.7], [7, 0.5], [3, 0.6], [10, 0.5]],
  crisis: [[12, 0.9], [18, 0.7], [13, 0.8], [11, 0.7], [12, 0.9], [17, 0.7], [13, 0.8], [6, 0.6]]
}
// Root / root-octave MIDI per track (ambient low pad, crisis higher stabs).
const ROOTS = { ambient: 33, combat: 45, crisis: 57 }
const XFADE = 0.8   // crossfade ramp duration (s)
const TEARDOWN = 0.9 // outgoing nodes stopped this long after the ramp starts
const LOOKAHEAD = 2.4 // scheduling window ahead of ctx.currentTime (s)
const PRUNE_AFTER = 0.2 // seconds past a voice's stop time before dropping the ref
const EPS = 0.0001

/** MIDI note number -> frequency (A4 = 69 = 440 Hz). */
function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12) }

export class MusicEngine {
  constructor() {
    this.ctx = null
    this.dest = null
    this.outGain = null   // engine-owned output gain (host connects it to its bus)
    this._track = null    // current track name (null when nothing is playing)
    this._playing = false
    this._disposed = false
    this._nodes = []      // live nodes of the current track
    this._ends = []       // finished-voice pruning queue: { at, nodes }
    this._outCeil = 1     // last output gain ceiling (mute/volume)
    this._cycles = 0      // completed pattern loops (pattern index wraps to 0)
    this._nextAt = 0      // start time of the next cycle to schedule
    this._fade = []       // pending fade-out teardowns: { at, nodes }
  }

  /** Wire the AudioContext + destination. No-op headless / after dispose. */
  start(ctx, dest) {
    if (!ctx || this._disposed) return
    this.ctx = ctx
    this.dest = dest || ctx.destination
    if (!this.outGain) {
      this.outGain = ctx.createGain()
      this.outGain.gain.value = this._outCeil
      this.outGain.connect(this.dest)
    }
  }

  get currentTrack() { return this._track }
  get isPlaying() { return this._playing }
  /** Owned plain object describing the playlist — never live node refs. */
  get playlist() { return { order: ['ambient', 'combat', 'crisis'], mode: 'state' } }

  /** Start (or restart) a named track. Unknown names are ignored. */
  startTrack(name) {
    if (this._disposed || !PATTERNS[name]) return
    if (this._track === name && this._playing) return
    this._fadeOut()
    this._track = name
    this._playing = true
    this._build(name)
  }

  /** Crossfade from the current track to another (no-op if already playing). */
  switchTrack(name) {
    if (this._disposed || !PATTERNS[name]) return
    if (this._track === name && this._playing) return
    this.startTrack(name)
  }

  /** Ramp to silence and tear the current track's nodes down. */
  stop() {
    if (this._disposed) return
    this._playing = false
    this._track = null
    this._fadeOut()
  }

  /** Suspend playback but remember the track; resume() restarts it. */
  pause() {
    if (this._disposed) return
    this._playing = false
    this._fadeOut()
  }

  resume() {
    if (this._disposed || !this._track) return
    this._playing = true
    if (this.outGain) {
      const t = this.ctx ? this.ctx.currentTime : 0
      const g = this.outGain.gain
      g.cancelScheduledValues(t)
      g.setValueAtTime(g.value, t)
      g.linearRampToValueAtTime(this._outCeil, t + XFADE)
    }
    this._build(this._track)
  }

  /** Set the engine output gain (mute/volume). Clamped to 0..1. */
  setOutputGain(v) {
    if (!this.outGain) return
    const val = Math.max(0, Math.min(1, Number(v) || 0))
    this._outCeil = val
    this.outGain.gain.value = val
  }

  /** Stop everything and drop every node/param reference. Safe twice. */
  dispose() {
    if (this._disposed) return
    this._disposed = true
    this._playing = false
    this._track = null
    this._kill(this._nodes)
    for (const f of this._fade) this._kill(f.nodes)
    this._nodes = []
    this._ends = []
    this._fade = []
    if (this.outGain) { try { this.outGain.disconnect() } catch (err) {} }
    this.outGain = null
    this.ctx = null
    this.dest = null
  }

  /** Ramp the current track out over XFADE s and stop its nodes after. */
  _fadeOut() {
    if (!this._nodes.length) return
    const nodes = this._nodes
    this._nodes = []
    if (this.ctx && this.outGain) {
      const t = this.ctx.currentTime
      const g = this.outGain.gain
      g.cancelScheduledValues(t)
      g.setValueAtTime(g.value, t)
      g.linearRampToValueAtTime(EPS, t + XFADE)
      this._fade.push({ at: t + TEARDOWN, nodes })
    } else {
      this._kill(nodes) // headless: nothing to ramp, tear down immediately
    }
  }

  /** Build one cycle of a track's pattern: drone + pattern voices, ramped in
   *  to the current output ceiling (mute/volume), never above it. */
  _build(name) {
    if (!this.ctx || !this.outGain) return
    const t = this.ctx.currentTime
    const g = this.outGain.gain
    g.cancelScheduledValues(t)
    g.setValueAtTime(g.value, t)
    g.linearRampToValueAtTime(this._outCeil, t + XFADE)
    this._nodes = this._voices(name, t)
    this._cycles = 0
    this._nextAt = t + BAR[name]
  }

  /** Schedule one pattern cycle of `name` starting at `start`. Returns nodes. */
  _voices(name, start) {
    const ctx = this.ctx
    const nodes = []
    const bar = BAR[name]
    const pat = PATTERNS[name]
    const root = ROOTS[name]
    const step = bar / pat.length
    // Soft drone under the whole bar (a pad bed), louder for denser tracks.
    const drone = this._voice(name, root - 12, start, bar * 2, 0.12, 'triangle')
    nodes.push(drone.g, drone.osc)
    for (let i = 0; i < pat.length; i++) {
      const at = start + i * step
      const dur = step * (name === 'ambient' ? 1.8 : 0.85)
      const v = this._voice(name, root + pat[i][0], at, dur, pat[i][1] * 0.22,
        name === 'ambient' ? 'sine' : 'square')
      nodes.push(v.g, v.osc)
    }
    return nodes
  }

  /** One oscillator + its gain envelope, connected to outGain. */
  _voice(name, midi, at, dur, peak, type) {
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = mtof(midi)
    const g = ctx.createGain()
    const t0 = at
    const t1 = at + Math.max(0.02, dur * 0.25)
    const t2 = at + dur
    g.gain.setValueAtTime(EPS, t0)
    g.gain.linearRampToValueAtTime(Math.max(EPS, peak), t1)
    g.gain.linearRampToValueAtTime(EPS, t2)
    osc.connect(g)
    g.connect(this.outGain)
    osc.start(t0)
    osc.stop(t2 + 0.02)
    // Remember when this voice goes silent so update() can drop the JS-side
    // references — otherwise _nodes grows without bound over a long session.
    this._ends.push({ at: t2 + PRUNE_AFTER, nodes: [osc, g] })
    return { osc, g }
  }

  /** Advance the scheduler: wrap the pattern index back to 0 each cycle. */
  update() {
    if (this._disposed) return
    if (!this.ctx || !this._playing || !this._track) return
    const t = this.ctx.currentTime
    const name = this._track
    while (this._nextAt < t + LOOKAHEAD) {
      this._nodes = this._nodes.concat(this._voices(name, this._nextAt))
      this._cycles = (this._cycles + 1) % 1024 // pattern index wraps to 0
      this._nextAt += BAR[name]
    }
    for (let i = this._fade.length - 1; i >= 0; i--) {
      if (this._fade[i].at <= t) { this._kill(this._fade[i].nodes); this._fade.splice(i, 1) }
    }
    // Drop references to voices whose scheduled stop time has passed: the
    // browser has already released those nodes, so keeping them alive here
    // would leak memory for the whole session.
    for (let i = this._ends.length - 1; i >= 0; i--) {
      if (this._ends[i].at <= t) { this._prune(this._ends[i].nodes); this._ends.splice(i, 1) }
    }
  }

  /** Remove finished nodes from the live-node list (no stop() needed: they
   *  already have a scheduled stop). */
  _prune(nodes) {
    if (!this._nodes.length || !nodes.length) return
    this._nodes = this._nodes.filter(n => !nodes.includes(n))
    this._fade = this._fade.filter(f => {
      const keep = f.nodes.filter(n => !nodes.includes(n))
      if (keep.length === f.nodes.length) return true
      if (!keep.length) return false
      f.nodes = keep
      return true
    })
  }

  _kill(nodes) {
    for (const n of nodes) { try { n.stop() } catch (err) {} }
    this._nodes = this._nodes.filter(n => !nodes.includes(n))
  }
}