// SfxSamples.js — file-based one-shot sound effects for AudioBank.
//
// The generated Stable-Audio-3 SFX (public/assets/audio/sfx/*.wav) are loaded
// once, decoded to AudioBuffers, and played through the same fx bus the
// procedural voices use. This module owns the fetch/decode/cache lifecycle and
// the per-shot voice routing; AudioBank calls `play(name, opts)` and falls back
// to its synthesized voice when a sample is not (yet) available, so the bank
// still works before the assets finish loading and in every headless test.
//
// Headless-safe: no AudioContext (Node) means `load()`/`play()` are no-ops that
// never throw; the procedural voices remain the only path there. Determinism is
// untouched — this module only plays pre-baked samples, it never allocates
// randomness. dispose() releases every decoded buffer (fully reverses load()).

// Map a logical SFX name to its shipped WAV path. Kept short and flat so the
// asset audit (tools/check-assets.mjs) can resolve each reference.
const SFX_BASE = 'assets/audio/sfx/'
const SFX_FILES = {
  shotgun: SFX_BASE + 'sfx_shotgun.wav',
  pistol: SFX_BASE + 'sfx_pistol.wav',
  sniper: SFX_BASE + 'sfx_sniper.wav',
  reload: SFX_BASE + 'sfx_reload.wav',
  dryfire: SFX_BASE + 'sfx_dryfire.wav',
  growl_walker: SFX_BASE + 'sfx_growl_walker.wav',
  growl_brute: SFX_BASE + 'sfx_growl_brute.wav',
  zombie_death: SFX_BASE + 'sfx_zombie_death.wav',
  hit_flesh: SFX_BASE + 'sfx_hit_flesh.wav',
  pickup: SFX_BASE + 'sfx_pickup.wav',
  melee_swing: SFX_BASE + 'sfx_melee_swing.wav'
}

export const SFX_NAMES = Object.keys(SFX_FILES)

export class SfxSamples {
  /** @param ctx AudioContext (or null headless). @param base URL prefix for the
   *  asset paths (Pages base or dev root); resolved by the caller. */
  constructor(ctx, base = '') {
    this.ctx = ctx || null
    this.base = base
    this.buffers = new Map() // name -> decoded AudioBuffer
    this.pending = new Map() // name -> in-flight Promise (dedupe concurrent loads)
  }

  /** Kick off decode of every SFX file. Fire-and-forget; each buffer lands in
   *  `buffers` when ready. No-op without an AudioContext. */
  load() {
    if (!this.ctx) return
    for (const name of SFX_NAMES) this._loadOne(name)
  }

  /** Ensure one sample is loading (idempotent). */
  _loadOne(name) {
    if (!this.ctx) return
    if (this.buffers.has(name) || this.pending.has(name)) return
    const url = this.base + SFX_FILES[name]
    const p = fetch(url)
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((ab) => (ab ? this.ctx.decodeAudioData(ab) : null))
      .then((buf) => { if (buf) this.buffers.set(name, buf) })
      .catch(() => {}) // missing/undecodable: leave it absent -> procedural fallback
      .finally(() => this.pending.delete(name))
    this.pending.set(name, p)
  }

  /** True if a decoded buffer for `name` is ready to play. */
  has(name) {
    return this.buffers.has(name)
  }

  /** Play a decoded sample once through `dest` (defaults to the caller's fx
   *  bus). Returns true if a buffer played, false if the caller should fall
   *  back to its procedural voice. `opts`: { gain, when, dest, rate }. */
  play(name, opts = {}) {
    const buf = this.buffers.get(name)
    if (!buf || !this.ctx) return false
    const t = this.ctx.currentTime + (opts.when || 0)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    if (opts.rate) src.playbackRate.value = opts.rate
    const g = this.ctx.createGain()
    g.gain.value = opts.gain != null ? opts.gain : 1
    src.connect(g)
    g.connect(opts.dest || this.ctx.destination)
    src.start(t)
    src.stop(t + buf.duration + 0.05)
    return true
  }

  /** Release every decoded buffer + drop the context reference. */
  dispose() {
    this.buffers.clear()
    this.pending.clear()
    this.ctx = null
  }
}