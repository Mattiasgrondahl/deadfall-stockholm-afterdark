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
  screamer: { base: 3.2, voice: 0.4, gain: 0.3 },
  brute: { base: 6.0, voice: 1.1, gain: 0.5 }
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
    this._groanVoices = [] // { at, p } per active groan voice (p = PannerNode, null headless)
    this._groanSeed = 4242
    // V4P-1a: LCG-scheduled wind gusts on the ambient bed. Bookkeeping is
    // pure (advances with the per-frame updateGroans tick); each gust fires
    // transient burst nodes only - the persistent bed stays fixed (10 nodes:
    // 6 wind + 4 city hum).
    this._ambClock = 0
    this._gustSeed = 90909
    this._gustNextAt = 2
    this._gustCount = 0
    this._gustGainNode = null
    this._gustSrc = null
    this._humNodes = null
    this.shaper = null
    if (typeof window !== 'undefined') {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (Ctx) {
        try {
          this.ctx = new Ctx()
          this.master = this.ctx.createGain()
          this.master.gain.value = 0.6
          // V4P-4: soft-clip limiter after the master so an over-driven mix
          // (worst case ~1.9 pre-limiter) bends instead of hard-clipping.
          this.shaper = this.ctx.createWaveShaper()
          this.shaper.curve = this._makeLimiterCurve()
          this.shaper.oversample = 'none'
          this.master.connect(this.shaper)
          this.shaper.connect(this.ctx.destination)
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

  // V4P-4 soft-clip curve for the master limiter: linear up to the knee,
  // then asymptotic toward 1 (|y| < 1 for every input), so any over-driven
  // mix bends smoothly instead of hard-clipping. Sampled over [-2, 2];
  // WaveShaper clamps inputs beyond the curve ends.
  _makeLimiterCurve() {
    const N = 2048
    const k = 0.8
    const tau = 0.5
    const c = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      const x = (2 * i / (N - 1) - 1) * 2
      const a = Math.abs(x)
      const y = a <= k ? a : 1 - (1 - k) * Math.exp(-(a - k) / tau)
      c[i] = Math.sign(x) * y
    }
    return c
  }

  // Resume a suspended context (fire-and-forget; first sound follows a gesture).
  _resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
  }

  // Short noise burst: buffer source -> optional BiquadFilter -> gain -> master.
  _playNoise({ duration, filterType = null, filterFreq = 0, gain, when = 0, dest = null }) {
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
    g.connect(dest || this.master)
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + duration)
    src.start(t)
    src.stop(t + duration + 0.05)
  }

  // Short oscillator tone, optional linear pitch ramp, exponential decay.
  _playTone({ type, freq, freqEnd = null, duration, gain, when = 0, dest = null }) {
    if (!this.ctx) return
    const t = this.ctx.currentTime + when
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    if (freqEnd !== null && freqEnd !== freq) osc.frequency.linearRampToValueAtTime(freqEnd, t + duration)
    const g = this.ctx.createGain()
    osc.connect(g); g.connect(dest || this.master)
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
  // V4P-2: when a source position is passed, the voice pans to it.
  zombieAttack(pos = null) {
    if (!this.ctx) return
    this._resume()
    const dest = this._pannerAt(pos)
    this._playNoise({ duration: 0.12, filterType: 'lowpass', filterFreq: 500, gain: 0.35, dest })
    this._playTone({ type: 'sine', freq: 70, duration: 0.14, gain: 0.3, dest })
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

  // Pistol shot: sharp short crack (highpassed noise) + brief falling ping.
  // Quieter and tighter than the shotgun blast.
  pistolShot() {
    if (!this.ctx) return
    this._resume()
    this._playNoise({ duration: 0.05, filterType: 'highpass', filterFreq: 900, gain: 0.4 })
    this._playTone({ type: 'sine', freq: 900, freqEnd: 300, duration: 0.07, gain: 0.2 })
  }

  // Sword swing: longer, lower whoosh than the axe + a deep metallic thud.
  swordSwing() {
    if (!this.ctx) return
    this._resume()
    this._playNoise({ duration: 0.22, filterType: 'lowpass', filterFreq: 500, gain: 0.35 })
    this._playTone({ type: 'sine', freq: 130, freqEnd: 70, duration: 0.2, gain: 0.25, when: 0.05 })
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
  // V4P-3 one-shots. All transient (auto-stopped), no persistent nodes,
  // no RNG, no panners. Call sites are null-guarded.
  // -----------------------------------------------------------------

  // Dry fire: empty-chamber mechanical click (rejected shotgun shot).
  dryFire() {
    if (!this.ctx) return
    this._resume()
    this._playNoise({ duration: 0.02, filterType: 'highpass', filterFreq: 2500, gain: 0.25 })
    this._playTone({ type: 'sine', freq: 900, duration: 0.03, gain: 0.15, when: 0.01 })
  }

  // Player takes a hit (non-fatal): dull thud with a low ring. Fatal hits
  // use playDeath() instead (already wired in Player.damage).
  hitPlayer() {
    if (!this.ctx) return
    this._resume()
    this._playTone({ type: 'sine', freq: 90, freqEnd: 45, duration: 0.25, gain: 0.4 })
    this._playNoise({ duration: 0.10, filterType: 'lowpass', filterFreq: 300, gain: 0.25, when: 0.02 })
  }

  // Wave cleared: ascending two-tone chime, pitched below the wave-start
  // chime (playWave uses base 220+15n; this uses base 180+15n).
  playWaveCleared(n) {
    if (!this.ctx) return
    this._resume()
    const base = 180 + 15 * Math.min(Number(n) || 1, 8)
    this._playTone({ type: 'triangle', freq: base, duration: 0.25, gain: 0.3, when: 0 })
    this._playTone({ type: 'triangle', freq: base * 1.25, duration: 0.25, gain: 0.3, when: 0.15 })
  }

  // Run start / restart: rising three-note chime.
  playStart() {
    if (!this.ctx) return
    this._resume()
    this._playTone({ type: 'triangle', freq: 220, duration: 0.15, gain: 0.25, when: 0 })
    this._playTone({ type: 'triangle', freq: 330, duration: 0.15, gain: 0.25, when: 0.12 })
    this._playTone({ type: 'triangle', freq: 440, duration: 0.15, gain: 0.25, when: 0.24 })
  }

  // Wave-5 boss: a low war-horn swell when the finale is triggered, and a
  // heavy sub-bass stomp when the brute actually stomps in.
  playBossIncoming() {
    if (!this.ctx) return
    this._resume()
    this._playTone({ type: 'sawtooth', freq: 70, freqEnd: 55, duration: 1.2, gain: 0.3 })
    this._playTone({ type: 'triangle', freq: 140, freqEnd: 110, duration: 1.2, gain: 0.15 })
  }

  playBoss() {
    if (!this.ctx) return
    this._resume()
    this._playTone({ type: 'sine', freq: 50, freqEnd: 30, duration: 0.8, gain: 0.5 })
    this._playNoise({ duration: 0.35, filterType: 'lowpass', filterFreq: 150, gain: 0.4 })
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

  /** Seeded LCG in [0,1) for gust scheduling (independent of the groan LCG). */
  _gustRand() {
    this._gustSeed = (Math.imul(this._gustSeed, 48271) >>> 0) % 65537
    return this._gustSeed / 65537
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
    } else if (type === 'brute') {
      // Boss growl: a sub-bass rumble under a low growl tone.
      this._playTone({ type: 'sine', freq: 45, freqEnd: 32, duration: spec.voice, gain })
      this._playTone({ type: 'sawtooth', freq: 80, freqEnd: 55, duration: spec.voice * 0.7, gain: gain * 0.5 })
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

  /** Write 3D coords onto the first spatial API shape in `list` that exists:
   * a coord dict with plain numbers (c.x = ...), a coord dict of AudioParams
   * (c.x.value = ...), or an AudioParam triad { x, y, z }. Returns true when
   * written, false when no holder matches. */
  _set3(list, x, y, z) {
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      if (!c) continue
      if (typeof c.x === 'number') { c.x = x; c.y = y; c.z = z; return true }
      if (c.x && typeof c.x.value === 'number') { c.x.value = x; c.y.value = y; c.z.value = z; return true }
    }
    return false
  }

  /** V4P-2: direction-only PannerNode at world position pos (or the plain
   * master when no position / headless). Distance level is already applied by
   * the scheduler's manual falloff, so rolloffFactor is 0 — no double decay. */
  _pannerAt(pos) {
    if (!pos || !this.ctx) return this.master
    const p = this.ctx.createPanner()
    p.panningModel = 'equalpower'
    p.distanceModel = 'linear'
    p.refDistance = 1
    p.rolloffFactor = 0
    p.maxDistance = GROAN_CUTOFF
    // Position eras: modern positionX/Y/Z AudioParams, legacy setPosition(),
    // or a `position` coord dict — no single shape exists in every engine, so
    // fall back to unpanned master output when none match (never throws).
    const triad = p.positionX ? { x: p.positionX, y: p.positionY, z: p.positionZ } : null
    if (!this._set3([p.position, triad], pos.x, 0.8, pos.z)) {
      if (typeof p.setPosition !== 'function') { p.disconnect(); return this.master }
      p.setPosition(pos.x, 0.8, pos.z)
    }
    p.connect(this.master)
    return p
  }

  /** V4P-2: same voice as groan(), routed through a panner at pos. `entry`
   * (a { at, panner } slot owned by the scheduler) records the panner so
   * updateGroans can disconnect it when the voice expires. */
  _playGroanPanned(type, distance, pos, entry = null) {
    const spec = GROAN_SPECS[type]
    if (!this.ctx || !spec) return
    const fall = Math.max(0, 1 - distance / GROAN_CUTOFF)
    const gain = spec.gain * fall
    if (gain <= 0.001) return
    this._resume()
    const dest = this._pannerAt(pos)
    if (entry) entry.p = dest === this.master ? null : dest
    if (type === 'screamer') {
      this._playTone({ type: 'sawtooth', freq: 400, freqEnd: 200, duration: spec.voice, gain, dest })
    } else if (type === 'brute') {
      this._playTone({ type: 'sine', freq: 45, freqEnd: 32, duration: spec.voice, gain, dest })
      this._playTone({ type: 'sawtooth', freq: 80, freqEnd: 55, duration: spec.voice * 0.7, gain: gain * 0.5, dest })
    } else {
      this._playTone({ type: 'sine', freq: type === 'walker' ? 90 : 60, duration: spec.voice, gain, dest })
      this._playNoise({
        duration: spec.voice * 0.8,
        filterType: 'lowpass',
        filterFreq: type === 'walker' ? 300 : 180,
        gain: gain * 0.6,
        dest
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
  updateGroans(dt, zombies, playerPos, playerYaw = 0) {
    const scheduled = []
    this._groanClock += dt
    const t = this._groanClock
    // Expire finished voices (concurrency accounting) and release their
    // panners so per-groan PannerNodes do not accumulate on the master.
    if (this._groanVoices.length) {
      // In-place expiry (swap-pop): no per-frame list rebuild while groans
      // are active; entry order carries no meaning (only length and expiry).
      let i = 0
      while (i < this._groanVoices.length) {
        const e = this._groanVoices[i]
        if (e.at > t) { i++; continue }
        if (e.p && typeof e.p.disconnect === 'function') e.p.disconnect()
        this._groanVoices[i] = this._groanVoices[this._groanVoices.length - 1]
        this._groanVoices.pop()
      }
    }
    const px = playerPos ? playerPos.x : 0
    const pz = playerPos ? playerPos.z : 0
    // V4P-2: keep the listener at the player (eye height 1.7) with facing
    // from yaw, so panned voices track the player each frame. No-op headless.
    const L = this.ctx && this.ctx.listener
    if (L) {
      const sy = Math.sin(playerYaw), cy = Math.cos(playerYaw)
      // Same era tolerance as _pannerAt: modern positionX/forwardX
      // AudioParams, coord dicts elsewhere; silent no-op when the engine
      // exposes neither shape (no throw).
      const ft = L.forwardX ? { x: L.forwardX, y: L.forwardY, z: L.forwardZ } : null
      const pt = L.positionX ? { x: L.positionX, y: L.positionY, z: L.positionZ } : null
      this._set3([L.forward, ft], sy, 0, -cy)
      this._set3([L.position, pt], px, 1.7, pz)
    }
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
        const entry = { at: t + spec.voice, p: null }
        this._groanVoices.push(entry)
        scheduled.push({ type: z.type, distance: d, gain })
        this._playGroanPanned(z.type, d, { x: z.position.x, z: z.position.z }, entry)
      }
    }
    // V4P-1a gust tick (piggybacks on this per-frame call): fire a gust when
    // due. No-op headless (ambient never starts without ctx).
    this._ambClock += dt
    if (this._ambientOn && this._gustGainNode && this._ambClock >= this._gustNextAt) {
      this._scheduleGust(this._ambClock)
    }
    return scheduled
  }

  /**
   * Fire one LCG-drawn gust: ramp the ambient bed gain up and back, plus a
   * low-passed noise "whoosh" burst. Burst nodes are transient (auto-stopped
   * after dur); nothing persistent is added. Draw order is fixed.
   */
  _scheduleGust(t) {
    if (!this.ctx) return
    const at = this.ctx.currentTime
    const dur = 1.5 + 3.0 * this._gustRand()
    const peak = 0.07 + 0.04 * this._gustRand()
    const gap = 3.0 + 9.0 * this._gustRand()
    const p = this._gustGainNode.gain
    p.cancelScheduledValues(at)
    p.setValueAtTime(0.03, at)
    p.linearRampToValueAtTime(peak, at + dur * 0.4)
    p.linearRampToValueAtTime(0.03, at + dur)
    const src = this.ctx.createBufferSource()
    src.buffer = this._noiseBuffer
    const f = this.ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 400
    const b = this.ctx.createGain()
    b.gain.setValueAtTime(0.001, at)
    b.gain.linearRampToValueAtTime(0.03 + 0.06 * this._gustRand(), at + dur * 0.3)
    b.gain.linearRampToValueAtTime(0.001, at + dur)
    src.connect(f); f.connect(b); b.connect(this.master)
    src.start(at)
    src.stop(at + dur + 0.05)
    this._gustSrc = src
    this._gustCount++
    this._gustNextAt = t + dur + gap
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
    // V4P-1b: distant city hum/rumble - fixed 4-node subgraph (two sub-bass
    // sines through a 120 Hz lowpass, gain below the wind bed), separate from
    // the gust-modulated wind gain so gusts swell only the wind.
    const ho1 = this.ctx.createOscillator(); ho1.type = 'sine'; ho1.frequency.value = 32
    const ho2 = this.ctx.createOscillator(); ho2.type = 'sine'; ho2.frequency.value = 48
    const hlp = this.ctx.createBiquadFilter(); hlp.type = 'lowpass'; hlp.frequency.value = 120
    const hg = this.ctx.createGain(); hg.gain.value = 0.015
    ho1.connect(hlp); ho2.connect(hlp); hlp.connect(hg); hg.connect(this.master)
    ho1.start(t); ho2.start(t)
    this._humNodes = { ho1, ho2, hlp, hg }
    this._ambientNodes = { o1, o2, lfo, g }
    this._gustGainNode = g
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
    const h = this._humNodes
    if (h) {
      h.hg.gain.cancelScheduledValues(t)
      h.hg.gain.setValueAtTime(h.hg.gain.value, t)
      h.hg.gain.linearRampToValueAtTime(0, t + 0.4)
      h.ho1.stop(stopAt); h.ho2.stop(stopAt)
      this._humNodes = null
    }
    if (this._gustSrc) {
      try { this._gustSrc.stop(stopAt) } catch (err) {}
    }
    this._gustSrc = null
    this._gustGainNode = null
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
    this._ambClock = 0
    this._gustNextAt = 2
    this._gustSrc = null
    this._gustGainNode = null
    this._humNodes = null
    this.shaper = null
    if (this.ctx) {
      try { this.ctx.close() } catch (err) {}
      this.ctx = null
      this.master = null
      this._noiseBuffer = null
    }
  }
}
