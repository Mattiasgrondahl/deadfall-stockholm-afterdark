// AudioBank.js — procedural WebAudio sound bank for Deadfall. Every voice is
// synthesized at call time (oscillators, filtered noise bursts, an LFO-driven
// ambient bed) — no external assets. Headless-safe: when no AudioContext
// exists (Node), the constructor leaves this.ctx = null and every public
// method is a no-op that never throws. In the browser a suspended context is
// resumed on the first play call — the first sound follows the START click /
// pointer-lock gesture, so autoplay policy is never an issue.
// V8: per-type zombie groans (LCG-scheduled, distance falloff, 4-voice cap)
// plus one-shot voices: axeSwing, pickup, drop, flashlightClick, weaponSwitch.

// Groan scheduler constants: per-type base period (s), voice length (s),
// base gain at 0 m. Cutoff 30 m; at most 4 concurrent groan voices.
const GROAN_CUTOFF = 30
const GROAN_MAX_VOICES = 4
const GROAN_SPECS = {
  walker: { base: 2.5, voice: 0.5, gain: 0.35 },
  shambler: { base: 4.5, voice: 0.8, gain: 0.4 },
  screamer: { base: 3.2, voice: 0.4, gain: 0.3 }
}

export class AudioBank {
  constructor() {
    this.ctx = null
    this.master = null
    this.muted = false
    this._ambientOn = false
    this._ambientNodes = null
    this._noiseBuffer = null
    // Groan scheduler state (V8). The scheduler is pure bookkeeping, so it
    // works headless; only the voice firing is gated on ctx.
    this._groanMap = new Map() // zombie -> { nextAt }
    this._groanClock = 0
    this._groanVoices = [] // expiration times of active groan voices
    this._groanSeed = 4242
    if (typeof window !== 'undefined') {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (Ctx) {
        try {
          this.ctx = new Ctx()
          this.master = this.ctx.createGain()
          this.master.gain.value = 0.6
          this.master.connect(this.ctx.destination)
          this._noiseBuffer = this._makeNoiseBuffer(1.0)
        } catch (err) {
          this.ctx = null // construction failed -> treat as headless
        }
      }
    }
  }

  // 1 s of deterministic (LCG) white noise, created once and reused by every
  // noise voice. No Math.random: keeps the bank reproducible.
  _makeNoiseBuffer(seconds) {
    const rate = this.ctx.sampleRate || 44100
    const len = Math.max(1, Math.floor(rate * seconds))
    const buf = this.ctx.createBuffer(1, len, rate)
    const d = buf.getChannelData(0)
    let seed = 1234567
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      d[i] = (seed / 0x7fffffff) * 2 - 1
    }
    return buf
  }

  // Resume a suspended context (fire-and-forget; first sound follows a gesture).
  _resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
  }

  // Short noise burst: buffer source -> optional BiquadFilter -> gain -> master.
  _playNoise({ duration, filterType = null, filterFreq = 0, gain, when = 0 }) {
    if (!this.ctx) return
    const t = this.ctx.currentTime + when
    const src = this.ctx.createBufferSource()
    src.buffer = this._noiseBuffer
    const g = this.ctx.createGain()
    if (filterType) {
      const f = this.ctx.createBiquadFilter()
      f.type = filterType
      f.frequency.value = filterFreq
      src.connect(f); f.connect(g)
    } else {
      src.connect(g)
    }
    g.connect(this.master)
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + duration)
    src.start(t)
    src.stop(t + duration + 0.05)
  }

  // Short oscillator tone, optional linear pitch ramp, exponential decay.
  _playTone({ type, freq, freqEnd = null, duration, gain, when = 0 }) {
    if (!this.ctx) return
    const t = this.ctx.currentTime + when
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    if (freqEnd !== null && freqEnd !== freq) osc.frequency.linearRampToValueAtTime(freqEnd, t + duration)
    const g = this.ctx.createGain()
    osc.connect(g); g.connect(this.master)
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + duration)
    osc.start(t)
    osc.stop(t + duration + 0.05)
  }

  shoot() {
    if (!this.ctx) return
    this._resume()
    this._playNoise({ duration: 0.08, filterType: 'lowpass', filterFreq: 1200, gain: 0.5 })
    this._playTone({ type: 'sine', freq: 200, duration: 0.06, gain: 0.25 })
  }

  hitZombie() {
    if (!this.ctx) return
    this._resume()
    this._playTone({ type: 'triangle', freq: 90, duration: 0.10, gain: 0.4 })
    this._playNoise({ duration: 0.03, filterType: 'highpass', filterFreq: 2000, gain: 0.15 })
  }

  // Zombie melee hit on the player: a low groaning thud (filtered noise + low
  // sine). Wired from Zombie.update's attack branch (null-guarded there).
  zombieAttack() {
    if (!this.ctx) return
    this._resume()
    this._playNoise({ duration: 0.12, filterType: 'lowpass', filterFreq: 500, gain: 0.35 })
    this._playTone({ type: 'sine', freq: 70, duration: 0.14, gain: 0.3 })
  }

  reload() {
    if (!this.ctx) return
    this._resume()
    this._playNoise({ duration: 0.03, filterType: 'highpass', filterFreq: 2000, gain: 0.3, when: 0 })
    this._playNoise({ duration: 0.03, filterType: 'highpass', filterFreq: 2000, gain: 0.3, when: 0.15 })
  }

  playWave(n) {
    if (!this.ctx) return
    this._resume()
    const base = 220 + 15 * Math.min(Number(n) || 1, 8)
    this._playTone({ type: 'triangle', freq: base, duration: 0.30, gain: 0.3, when: 0 })
    this._playTone({ type: 'triangle', freq: base * 1.5, duration: 0.30, gain: 0.3, when: 0.18 })
  }

  playDeath() {
    if (!this.ctx) return
    this._resume()
    this._playTone({ type: 'sine', freq: 120, freqEnd: 60, duration: 0.60, gain: 0.4 })
  }

  // -----------------------------------------------------------------
  // V8 one-shot voices. Every caller is null-guarded (?.), so these
  // methods may land without touching their call sites.
  // -----------------------------------------------------------------

  // Axe whoosh: lowpassed sweep + falling low thud.
  axeSwing() {
    if (!this.ctx) return
    this._resume()
    this._playNoise({ duration: 0.12, filterType: 'lowpass', filterFreq: 700, gain: 0.3 })
    this._playTone({ type: 'sine', freq: 110, freqEnd: 60, duration: 0.14, gain: 0.2 })
  }

  // Ammo pickup: two short rising chirps.
  pickup() {
    if (!this.ctx) return
    this._resume()
    this._playTone({ type: 'sine', freq: 660, freqEnd: 880, duration: 0.12, gain: 0.25 })
    this._playTone({ type: 'sine', freq: 880, freqEnd: 1100, duration: 0.10, gain: 0.18, when: 0.08 })
  }

  // Drop landing at the corpse: dull metallic plop.
  drop() {
    if (!this.ctx) return
    this._resume()
    this._playTone({ type: 'sine', freq: 300, freqEnd: 150, duration: 0.08, gain: 0.2 })
    this._playNoise({ duration: 0.04, filterType: 'highpass', filterFreq: 1500, gain: 0.12, when: 0.02 })
  }

  // Flashlight switch click.
  flashlightClick() {
    if (!this.ctx) return
    this._resume()
    this._playNoise({ duration: 0.02, filterType: 'highpass', filterFreq: 3000, gain: 0.3 })
    this._playTone({ type: 'sine', freq: 1200, duration: 0.03, gain: 0.15, when: 0.02 })
  }

  // Weapon swap: two mechanical clicks + a low thud.
  weaponSwitch() {
    if (!this.ctx) return
    this._resume()
    this._playNoise({ duration: 0.02, filterType: 'highpass', filterFreq: 2500, gain: 0.35, when: 0 })
    this._playNoise({ duration: 0.02, filterType: 'highpass', filterFreq: 2500, gain: 0.35, when: 0.06 })
    this._playTone({ type: 'sine', freq: 180, duration: 0.08, gain: 0.2, when: 0.06 })
  }

  // -----------------------------------------------------------------
  // V8 zombie groans: per-type idle vocalization, LCG-scheduled,
  // distance-falloff, capped at GROAN_MAX_VOICES concurrent voices.
  // -----------------------------------------------------------------

  /** Seeded LCG in [0, 1) — independent of the noise-buffer LCG. >>> 0 keeps
   * Math.imul's signed 32-bit result non-negative before the mod. */
  _groanRand() {
    this._groanSeed = (Math.imul(this._groanSeed, 48271) >>> 0) % 65537
    return this._groanSeed / 65537
  }

  /** Number of groan voices currently sounding (for tests/budget checks). */
  activeGroans() {
    return this._groanVoices.length
  }

  /**
   * Play one groan for `type` at `distance` meters: distance-falloff gain,
   * per-type timbre (walker ~90 Hz, shambler ~60 Hz, screamer 400->200 Hz).
   * No-op headless / beyond cutoff.
   */
  groan(type, distance) {
    const spec = GROAN_SPECS[type]
    if (!this.ctx || !spec) return
    const fall = Math.max(0, 1 - distance / GROAN_CUTOFF)
    const gain = spec.gain * fall
    if (gain <= 0.001) return
    this._resume()
    if (type === 'screamer') {
      this._playTone({ type: 'sawtooth', freq: 400, freqEnd: 200, duration: spec.voice, gain })
    } else {
      this._playTone({ type: 'sine', freq: type === 'walker' ? 90 : 60, duration: spec.voice, gain })
      this._playNoise({
        duration: spec.voice * 0.8,
        filterType: 'lowpass',
        filterFreq: type === 'walker' ? 300 : 180,
        gain: gain * 0.6
      })
    }
  }

  /**
   * Per-frame groan scheduler (call from Game's update, after zombies).
   * Each live zombie within GROAN_CUTOFF gets an LCG-drawn phase and a
   * per-type period with jitter; a groan fires when its phase is due and a
   * voice slot is free (otherwise it retries next frame).
   * @returns groans scheduled this frame: [{ type, distance, gain }]
   */
  updateGroans(dt, zombies, playerPos) {
    const scheduled = []
    this._groanClock += dt
    const t = this._groanClock
    // Expire finished voices (concurrency accounting).
    if (this._groanVoices.length) {
      this._groanVoices = this._groanVoices.filter(e => e > t)
    }
    const px = playerPos ? playerPos.x : 0
    const pz = playerPos ? playerPos.z : 0
    for (const z of zombies) {
      if (z.isDead) { this._groanMap.delete(z); continue }
      const spec = GROAN_SPECS[z.type]
      if (!spec) continue
      const dx = z.position.x - px
      const dz = z.position.z - pz
      const d = Math.hypot(dx, dz)
      if (d >= GROAN_CUTOFF) { this._groanMap.delete(z); continue }
      let e = this._groanMap.get(z)
      if (!e) {
        e = { nextAt: t + this._groanRand() * spec.base }
        this._groanMap.set(z, e)
      }
      if (t >= e.nextAt && this._groanVoices.length < GROAN_MAX_VOICES) {
        const gain = spec.gain * Math.max(0, 1 - d / GROAN_CUTOFF)
        e.nextAt = t + spec.base * (0.6 + 0.8 * this._groanRand())
        this._groanVoices.push(t + spec.voice)
        scheduled.push({ type: z.type, distance: d, gain })
        this.groan(z.type, d)
      }
    }
    return scheduled
  }

  startAmbient() {
    if (!this.ctx || this._ambientOn) return
    this._resume()
    const t = this.ctx.currentTime
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200
    const g = this.ctx.createGain(); g.gain.value = 0.03
    // slow LFO on the ambient gain = wind swell
    const lfo = this.ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.05
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 0.02
    lfo.connect(lfoGain); lfoGain.connect(g.gain)
    const o1 = this.ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = 55
    const o2 = this.ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 57
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.master)
    o1.start(t); o2.start(t); lfo.start(t)
    this._ambientNodes = { o1, o2, lfo, g }
    this._ambientOn = true
  }

  stopAmbient() {
    if (!this.ctx || !this._ambientOn) return
    const t = this.ctx.currentTime
    const a = this._ambientNodes
    a.g.gain.cancelScheduledValues(t)
    a.g.gain.setValueAtTime(a.g.gain.value, t)
    a.g.gain.linearRampToValueAtTime(0, t + 0.4)
    const stopAt = t + 0.5
    a.o1.stop(stopAt); a.o2.stop(stopAt); a.lfo.stop(stopAt)
    this._ambientOn = false
    this._ambientNodes = null
  }

  setMuted(on) {
    this.muted = !!on
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime
      this.master.gain.cancelScheduledValues(t)
      this.master.gain.setValueAtTime(this.muted ? 0 : 0.6, t)
    }
  }

  toggleMuted() { this.setMuted(!this.muted) }

  dispose() {
    this.stopAmbient()
    this._groanMap = new Map()
    this._groanVoices = []
    this._groanClock = 0
    if (this.ctx) {
      try { this.ctx.close() } catch (err) {}
      this.ctx = null
      this.master = null
      this._noiseBuffer = null
    }
  }
}
