// AudioBank.js — procedural WebAudio sound bank for Deadfall. Every voice is
// synthesized at call time (oscillators, filtered noise bursts, an LFO-driven
// ambient bed) — no external assets. Headless-safe: when no AudioContext
// exists (Node), the constructor leaves this.ctx = null and every public
// method is a no-op that never throws. In the browser a suspended context is
// resumed on the first play call — the first sound follows the START click /
// pointer-lock gesture, so autoplay policy is never an issue.

export class AudioBank {
  constructor() {
    this.ctx = null
    this.master = null
    this.muted = false
    this._ambientOn = false
    this._ambientNodes = null
    this._noiseBuffer = null
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
    if (this.ctx) {
      try { this.ctx.close() } catch (err) {}
      this.ctx = null
      this.master = null
      this._noiseBuffer = null
    }
  }
}
