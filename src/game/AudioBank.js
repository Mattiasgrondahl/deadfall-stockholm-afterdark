// AudioBank.js — procedural WebAudio sound bank for Deadfall. Every voice is
// synthesized at call time (oscillators, filtered noise bursts, an LFO-driven
// ambient bed) — no external assets. Headless-safe: when no AudioContext
// exists (Node), the constructor leaves this.ctx = null and every public
// method is a no-op that never throws. In the browser a suspended context is
// resumed on the first play call — the first sound follows the START click /
// pointer-lock gesture, so autoplay policy is never an issue.
// V8: per-type zombie groans (LCG-scheduled, distance falloff, 4-voice cap)
// plus one-shot voices: axeSwing, pickup, drop, flashlightClick, weaponSwitch.

import { MusicEngine } from './MusicEngine.js'
import { SfxSamples } from './SfxSamples.js'

// Groan scheduler constants: per-type base period (s), voice length (s),
// base gain at 0 m. Cutoff 30 m; at most 4 concurrent groan voices.
const GROAN_CUTOFF = 30
const GROAN_MAX_VOICES = 4
// v4: Minecraft-style proximity dread. When the nearest live zombie closes
// inside CLOSE_GROWL_RADIUS, a dedicated low "close growl" fires on a short
// LCG cadence that speeds up and gets louder the closer the zombie gets — a
// "something is right behind you" cue layered on top of the per-zombie ambient
// groans above. Independent voice slot so it never starves the ambient groans.
const CLOSE_GROWL_RADIUS = 9
const CLOSE_GROWL_MIN = 2.2   // period (s) when the zombie is right on top
const CLOSE_GROWL_MAX = 5.5   // period (s) at the edge of the dread radius
const CLOSE_GROWL_GAIN = 0.55 // gain at point-blank (scaled by proximity)
// v4 distant moan: a long mournful far-away wail, distinct from the short
// per-zombie groans. Fires on a slow independent LCG cadence for zombies in the
// far band (between MOAN_NEAR and GROAN_CUTOFF) so distant hordes ache audibly
// across the street. Its own voice slot so it never starves the groans.
const MOAN_NEAR = 12          // inside this the zombie groans, not moans (too close)
const MOAN_MIN = 7.0          // shortest moan period (s) at the near edge of the band
const MOAN_MAX = 16.0         // longest moan period (s) at the far edge
const MOAN_GAIN = 0.34        // gain at the near edge (falloff toward the cutoff)
// v4 attack hiss: a sharp sibilant snarl a zombie lets off as it closes to
// striking distance / winds up a melee swing. Fires on a short cadence only
// while the nearest zombie is inside HISS_RADIUS, louder the closer it gets.
const HISS_RADIUS = 3.2       // ~attack range + a little, so it reads as "about to strike"
const HISS_MIN = 1.1          // period (s) point-blank
const HISS_MAX = 2.6          // period (s) at the edge of the strike radius
const HISS_GAIN = 0.5         // gain at point-blank (scaled by proximity)
// v4 footsteps: cadence driven by the player's ground speed. A step fires every
// FOOTSTEP_STRIDE metres travelled, so the rate tracks walk vs sprint naturally.
const FOOTSTEP_STRIDE = 2.0   // metres travelled per footfall (alternates L/R)
const FOOTSTEP_WALK_GAIN = 0.16
const FOOTSTEP_RUN_GAIN = 0.26
// v4 jump: a soft cloth-rustle + effort grunt fired once on the jump edge.
const JUMP_GAIN = 0.22
// v4 weather: a periodic snowstorm swell layered over the wind bed. Separate
// from the short gusts above — a longer, louder blizzard sweep that rises and
// falls every STORM_MIN..STORM_MAX seconds to sell the winter setting.
const STORM_MIN = 22          // shortest gap between storms (s)
const STORM_MAX = 48          // longest gap between storms (s)
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
    // v4 SFX: file-based one-shot samples (generated Stable-Audio-3 WAVs). Built
    // lazily in loadSfx(); null until then and headless, so every voice falls
    // back to its procedural synthesis.
    this._sfx = null
    // Groan scheduler state (V8). The scheduler is pure bookkeeping, so it
    // works headless; only the voice firing is gated on ctx.
    this._groanMap = new Map() // zombie -> { nextAt }
    this._groanClock = 0
    this._groanVoices = [] // { at, p } per active groan voice (p = PannerNode, null headless)
    this._groanSeed = 4242
    // v4 proximity-dread growl: separate LCG + next-fire clock so the close
    // growl cadence is independent of the per-zombie ambient groans.
    this._closeGrowlNextAt = 0
    this._closeGrowlSeed = 777001
    this._closeGrowlVoices = [] // { at, p } per active close growl (p = PannerNode) — freed on expiry
    // v4 distant moan: independent LCG + next-fire clock + a last-moaned map so a
    // given far zombie only moans on its own slow cadence. Own voice list (no leak).
    this._moanNextAt = 0
    this._moanSeed = 555001
    this._moanMap = new Map() // zombie -> { nextAt }
    this._moanVoices = [] // { at, p } per active moan voice
    // v4 attack hiss: independent LCG + next-fire clock keyed on the nearest
    // zombie inside the strike radius.
    this._hissNextAt = 0
    this._hissSeed = 333001
    this._hissVoices = [] // { at, p } per active hiss voice
    // v4 footsteps: distance travelled since the last footfall + a left/right
    // toggle + a dedicated LCG so footstep timing never shares the groan RNG.
    this._stepAccum = 0
    this._stepFlip = false
    this._stepSeed = 246001
    // v4 weather: the snowstorm swell scheduler (own LCG + next-fire clock),
    // independent of the short gusts so storms and gusts don't collide.
    this._stormNextAt = 12
    this._stormSeed = 135790
    this._stormCount = 0
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
    // SFX/ambient input bus (browser-only): voices connect here instead of
    // master; effectsVolume scales it. Headless stays null.
    this._masterIn = null
    // Effects-volume ceiling (master's ceiling when no Settings is attached).
    this._fxCeil = 1
    // Master bus ceiling driven by the masterVolume setting (0.6 = baseline).
    this._masterCeil = 0.6
    // Music bus ceiling driven by the musicVolume setting (0.5 = baseline).
    this._musicCeil = 0.5
    // Attached Settings instance (attachSettings); unsubscribed on dispose.
    this._settings = null
    this._settingsOff = null
    // Soundtrack: a looping background music track (the YuE2 hard-rock song).
    // Driven by an HTML <audio> element routed through a MediaElementSource ->
    // musicGain -> master, so mute/volume follow the same graph as the SFX.
    // Browser-only; headless leaves _musicEl null and every music call no-ops.
    this._musicEl = null
    this._musicSrc = null
    this._musicGain = null
    this._musicUrl = null
    this._musicOn = false
    this._musicMuted = false
    this._plPaused = false // boss-fight pause flag for the mp3 playlist
    // Procedural soundtrack (additive to the mp3 layer above): three
    // oscillator-scheduled tracks owned by MusicEngine. Created always, even
    // headless, so music state is observable without an AudioContext. Its
    // output gain is routed through the music bus (or master) by _wireMusic.
    this._musicEngine = new MusicEngine()
    this._musicEngineWired = false
    this._musicEngineCeil = 0.5
    this._musicEngineClock = 0
    this._onMusicEnded = null
    this._onMusicTimeUpdate = null
    this._musicLen = 0
    // Phase 4: adaptive tension bed. A low drone + a slow pulse whose level and
    // rate follow the danger the player is in (alive-zombie pressure + low
    // health). Created lazily on the first non-zero tension, so quiet moments
    // cost nothing; fully torn down in stopAmbient/dispose. Headless-safe.
    this._tensionOn = false
    this._tensionNodes = null
    this._tensionTarget = 0   // 0..1 requested level (set by Game each frame)
    this._tensionCur = 0      // smoothed actual level driving the gain/pulse
    this._tensionPulseNext = 0
    this._tensionSeed = 20250923
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
          // SFX/ambient input bus: every non-music voice routes through
          // _masterIn -> master, so the effects-volume slider scales combat
          // and ambience without touching the music bus or the limiter chain.
          this._masterIn = this.ctx.createGain()
          this._masterIn.gain.value = 1
          this._masterIn.connect(this.master)
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

  /** Routing target for a voice with no explicit destination: the SFX input
   *  bus when it exists (so effectsVolume scales it), else the master. */
  _fxDest() {
    return this._masterIn || this.master
  }

  /** v4 SFX: build the file-based sample bank and start decoding the generated
   *  Stable-Audio-3 one-shots. `base` is the asset URL prefix (Vite BASE_URL +
   *  '/'), matching how the soundtrack resolves its mp3s. No-op headless (no
   *  AudioContext). Safe to call once at wiring time; the voices fall back to
   *  their procedural synthesis until each buffer finishes decoding. */
  loadSfx(base = '') {
    if (!this.ctx) return
    if (!this._sfx) this._sfx = new SfxSamples(this.ctx, base)
    this._sfx.load()
  }

  /** v4 SFX: play a generated one-shot through the fx bus (or a panner dest).
   *  Returns true if a decoded sample played, false if the caller should run its
   *  procedural fallback. `opts` mirrors _playNoise/_playTone ({ gain, when,
   *  dest, rate }). */
  _playSfx(name, opts = {}) {
    if (!this._sfx) return false
    const o = Object.assign({}, opts)
    if (!o.dest) o.dest = this._fxDest()
    return this._sfx.play(name, o)
  }

  /** Attach a Settings instance: volumes/mutes follow it live, and the stored
   *  state is applied immediately. Headless-safe (no ctx -> gains just record). */
  attachSettings(settings) {
    if (!settings) return
    this._settings = settings
    this._settingsOff = settings.onChange((key) => {
      if (key === 'masterVolume' || key === 'muted') this._applyMasterGain()
      else if (key === 'musicVolume' || key === 'musicMuted') this._applyMusicGain()
      else if (key === 'effectsVolume') this._applyFxGain()
    })
    this._fxCeil = settings.get('effectsVolume')
    this._musicCeil = settings.get('musicVolume')
    this._masterCeil = settings.get('masterVolume')
    this.setMuted(settings.get('muted'))
    this.setMusicMuted(settings.get('musicMuted'))
    this._applyFxGain()
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
    g.connect(dest || this._fxDest())
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
    osc.connect(g); g.connect(dest || this._fxDest())
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + duration)
    osc.start(t)
    osc.stop(t + duration + 0.05)
  }

  // Voiced "urgh": a low sawtooth glottal carrier pushed through two band-pass
  // formants (F1 ~ low back vowel, F2 ~ the "r"-colored second formant) plus a
  // breath-noise layer. This is the growl's vowel core — a plain sine reads as a
  // hum, whereas two resonant bands over a saw give an "urgh"/"grr" colour.
  _playFormant({ freq, freqEnd = null, f1, f2, duration, gain, when = 0, dest = null }) {
    if (!this.ctx) return
    const t = this.ctx.currentTime + when
    const osc = this.ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(freq, t)
    if (freqEnd !== null && freqEnd !== freq) osc.frequency.linearRampToValueAtTime(freqEnd, t + duration)
    const env = this.ctx.createGain()
    env.gain.setValueAtTime(gain, t)
    env.gain.exponentialRampToValueAtTime(0.001, t + duration)
    // Two parallel formant band-passes mix into the shared envelope.
    const bp1 = this.ctx.createBiquadFilter()
    bp1.type = 'bandpass'; bp1.frequency.value = f1; bp1.Q.value = 6
    const bp2 = this.ctx.createBiquadFilter()
    bp2.type = 'bandpass'; bp2.frequency.value = f2; bp2.Q.value = 8
    osc.connect(bp1); bp1.connect(env)
    osc.connect(bp2); bp2.connect(env)
    env.connect(dest || this._fxDest())
    osc.start(t)
    osc.stop(t + duration + 0.05)
  }

  shoot() {
    if (!this.ctx) return
    this._resume()
    // v4 SFX: play the generated shotgun blast when it has decoded; fall back to
    // the synthesized blast otherwise (headless / not-yet-loaded / fetch failure).
    if (this._playSfx('shotgun', { gain: 0.9 })) return
    // Shotgun blast — big-bore, explosive, LOUD, and now grittier. A fast-attack
    // noise burst is run through a WaveShaper for a hard clip (the powder crack),
    // a second lowpassed body layer gives the heavy boom, two sub-bass sines
    // thump the chest, and a long rolling lowpass tail lingers. Gains are pushed
    // toward the limiter so the blast reads as a wall of sound.
    // 1) Bright transient crack — the sharp muzzle report.
    this._playNoise({ duration: 0.05, filterType: 'highpass', filterFreq: 1200, gain: 0.9 })
    // 2) Clipped body boom — a lowpassed noise burst pushed through a soft
    //    WaveShaper curve so the powder blast has a hard, saturated edge.
    this._playShotgunBody()
    // 3) Deep sub-bass thump — the chest-thumping low end of a big-bore shot.
    this._playTone({ type: 'sine', freq: 120, freqEnd: 40, duration: 0.30, gain: 0.7 })
    // 4) A second, even lower sine for weight and decay.
    this._playTone({ type: 'sine', freq: 70, freqEnd: 30, duration: 0.42, gain: 0.5, when: 0.02 })
    // 5) Rolling filtered tail — the room-shaking rumble that lingers.
    this._playNoise({ duration: 0.5, filterType: 'lowpass', filterFreq: 400, gain: 0.4, when: 0.06 })
  }

  // The shotgun's mid/body layer: a lowpassed noise burst fed through a
  // WaveShaper (soft-clip curve) into a fast-attack, two-stage-decay gain, so
  // the blast has a saturated crack rather than a soft puff. Falls back to a
  // plain lowpassed burst if the WaveShaper curve cannot be built.
  _playShotgunBody() {
    const t = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this._noiseBuffer
    const lp = this.ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1100
    const shaper = this.ctx.createWaveShaper()
    shaper.curve = shotgunCurve()
    shaper.oversample = '2x'
    const g = this.ctx.createGain()
    src.connect(lp); lp.connect(shaper); shaper.connect(g); g.connect(this._fxDest())
    // Fast attack, then a two-stage decay (a quick snap then a slower body).
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.9, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.08)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
    src.start(t)
    src.stop(t + 0.35)
  }

  hitZombie() {
    if (!this.ctx) return
    this._resume()
    if (this._playSfx('hit_flesh', { gain: 0.5 })) return
    this._playTone({ type: 'triangle', freq: 90, duration: 0.10, gain: 0.4 })
    this._playNoise({ duration: 0.03, filterType: 'highpass', filterFreq: 2000, gain: 0.15 })
  }

  // Limb severed by a bullet: a wet tear — a short lowpassed noise rip plus a
  // quick descending squelch. Null-guarded for headless.
  dismember() {
    if (!this.ctx) return
    this._resume()
    this._playNoise({ duration: 0.09, filterType: 'bandpass', filterFreq: 900, gain: 0.3 })
    this._playTone({ type: 'sawtooth', freq: 260, freqEnd: 90, duration: 0.12, gain: 0.22 })
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

  /** Telegraph cue: the sound a zombie makes as it winds up a melee swing,
   *  before the hit lands. Per-type so the player can hear what is about to
   *  swing: a short intake hiss (walker/shambler), a sharp chirp (screamer),
   *  a low growl swell (brute). Panned to the attacker when a position is
   *  given (same era-tolerant routing as zombieAttack). */
  zombieWindup(type = 'walker', pos = null) {
    if (!this.ctx) return
    this._resume()
    const dest = this._pannerAt(pos)
    if (type === 'screamer') {
      this._playTone({ type: 'square', freq: 700, freqEnd: 1100, duration: 0.12, gain: 0.18, dest })
    } else if (type === 'brute') {
      this._playTone({ type: 'sawtooth', freq: 55, freqEnd: 75, duration: 0.4, gain: 0.22, dest })
    } else {
      this._playNoise({ duration: 0.18, filterType: 'bandpass', filterFreq: type === 'shambler' ? 300 : 500, gain: 0.16, dest })
    }
  }

  reload() {
    if (!this.ctx) return
    this._resume()
    if (this._playSfx('reload', { gain: 0.7 })) return
    this._playNoise({ duration: 0.03, filterType: 'highpass', filterFreq: 2000, gain: 0.3, when: 0 })
    this._playNoise({ duration: 0.03, filterType: 'highpass', filterFreq: 2000, gain: 0.3, when: 0.15 })
  }

  // Sniper rifle crack: a sharp high-passed report transient + a deep body
  // thump + a short rolling tail. Distinct from the shotgun/pistol voices.
  sniperShot() {
    if (!this.ctx) return
    this._resume()
    if (this._playSfx('sniper', { gain: 0.85 })) return
    this._playNoise({ duration: 0.05, filterType: 'highpass', filterFreq: 3200, gain: 0.5 })
    this._playTone({ type: 'sine', freq: 160, freqEnd: 55, duration: 0.22, gain: 0.4 })
    this._playNoise({ duration: 0.18, filterType: 'bandpass', filterFreq: 800, gain: 0.12, when: 0.03 })
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
    if (this._playSfx('zombie_death', { gain: 0.6 })) return
    this._playTone({ type: 'sine', freq: 120, freqEnd: 60, duration: 0.60, gain: 0.4 })
  }

  // -----------------------------------------------------------------
  // V8 one-shot voices. Every caller is null-guarded (?.), so these
  // methods may land without touching their call sites.
  // -----------------------------------------------------------------

  // Axe whoosh: a heavier, slower low sweep + a deep wooden/metallic impact thud.
  axeSwing() {
    if (!this.ctx) return
    this._resume()
    if (this._playSfx('melee_swing', { gain: 0.6 })) return
    // Air displacement: broad low whoosh, then a weighty low thud on the strike.
    this._playNoise({ duration: 0.16, filterType: 'lowpass', filterFreq: 600, gain: 0.34 })
    this._playTone({ type: 'sine', freq: 120, freqEnd: 55, duration: 0.16, gain: 0.28, when: 0.06 })
    this._playNoise({ duration: 0.05, filterType: 'bandpass', filterFreq: 300, gain: 0.2, when: 0.08 })
  }

  // Pistol shot: sharp short crack (highpassed noise) + brief falling ping.
  // Quieter and tighter than the shotgun blast.
  pistolShot() {
    if (!this.ctx) return
    this._resume()
    if (this._playSfx('pistol', { gain: 0.8 })) return
    this._playNoise({ duration: 0.05, filterType: 'highpass', filterFreq: 900, gain: 0.4 })
    this._playTone({ type: 'sine', freq: 900, freqEnd: 300, duration: 0.07, gain: 0.2 })
  }

  // Sword swing: a bright, fast blade whoosh + a short metallic ring. Sharper
  // and higher than the axe so the two melee weapons read distinctly.
  swordSwing() {
    if (!this.ctx) return
    this._resume()
    if (this._playSfx('melee_swing', { gain: 0.55, rate: 1.15 })) return
    // Fast high whoosh (bandpassed air) then a brief metallic ring partial.
    this._playNoise({ duration: 0.14, filterType: 'bandpass', filterFreq: 2600, gain: 0.32 })
    this._playTone({ type: 'triangle', freq: 1500, freqEnd: 900, duration: 0.12, gain: 0.16, when: 0.04 })
    this._playTone({ type: 'sine', freq: 2200, duration: 0.08, gain: 0.1, when: 0.06 })
  }

  // Ammo pickup: two short rising chirps.
  pickup() {
    if (!this.ctx) return
    this._resume()
    if (this._playSfx('pickup', { gain: 0.6 })) return
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

  // Glass shatter (a broken streetlamp): a bright highpassed noise burst for the
  // initial crack, a scatter of short descending high tones for individual
  // shards ringing, and a faint highpassed rattle as fragments settle.
  glassBreak() {
    if (!this.ctx) return
    this._resume()
    // The crack: a sharp bright noise transient.
    this._playNoise({ duration: 0.08, filterType: 'highpass', filterFreq: 3500, gain: 0.5, when: 0 })
    // Ringing shards: a few short high tones sliding down, spread in time.
    this._playTone({ type: 'triangle', freq: 2600, freqEnd: 1400, duration: 0.12, gain: 0.22, when: 0.01 })
    this._playTone({ type: 'triangle', freq: 3400, freqEnd: 1900, duration: 0.10, gain: 0.18, when: 0.05 })
    this._playTone({ type: 'sine', freq: 4200, freqEnd: 2600, duration: 0.09, gain: 0.14, when: 0.09 })
    this._playTone({ type: 'sine', freq: 2000, freqEnd: 1100, duration: 0.14, gain: 0.12, when: 0.12 })
    // Settling rattle: a soft highpassed tail.
    this._playNoise({ duration: 0.18, filterType: 'bandpass', filterFreq: 5000, gain: 0.12, when: 0.14 })
  }

  // -----------------------------------------------------------------
  // V4P-3 one-shots. All transient (auto-stopped), no persistent nodes,
  // no RNG, no panners. Call sites are null-guarded.
  // -----------------------------------------------------------------

  // Dry fire: empty-chamber mechanical click (rejected shotgun shot).
  dryFire() {
    if (!this.ctx) return
    this._resume()
    if (this._playSfx('dryfire', { gain: 0.6 })) return
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
  /** Kill confirmation: a short, dry "thok" tick. `head` adds a brighter,
   *  higher ping so a headshot kill reads distinctly from a body kill. */
  playKill(head = false) {
    if (!this.ctx) return
    this._resume()
    this._playNoise({ duration: 0.05, filterType: 'bandpass', filterFreq: 1800, gain: 0.25 })
    if (head) {
      this._playTone({ type: 'triangle', freq: 1200, freqEnd: 1600, duration: 0.12, gain: 0.22, when: 0.02 })
    } else {
      this._playTone({ type: 'triangle', freq: 300, freqEnd: 220, duration: 0.1, gain: 0.18, when: 0.02 })
    }
  }

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

  /** Seeded LCG in [0,1) for the proximity-dread close growl (independent). */
  _closeGrowlRand() {
    this._closeGrowlSeed = (Math.imul(this._closeGrowlSeed, 48271) >>> 0) % 65537
    return this._closeGrowlSeed / 65537
  }

  /** Seeded LCG in [0,1) for the distant moan (independent). */
  _moanRand() {
    this._moanSeed = (Math.imul(this._moanSeed, 48271) >>> 0) % 65537
    return this._moanSeed / 65537
  }

  /** Seeded LCG in [0,1) for the attack hiss (independent). */
  _hissRand() {
    this._hissSeed = (Math.imul(this._hissSeed, 48271) >>> 0) % 65537
    return this._hissSeed / 65537
  }

  /** Seeded LCG in [0,1) for footstep timing jitter (independent). */
  _stepRand() {
    this._stepSeed = (Math.imul(this._stepSeed, 48271) >>> 0) % 65537
    return this._stepSeed / 65537
  }

  /** Seeded LCG in [0,1) for the snowstorm swell (independent of the gust LCG). */
  _stormRand() {
    this._stormSeed = (Math.imul(this._stormSeed, 48271) >>> 0) % 65521
    return this._stormSeed / 65537
  }

  /**
   * v4 distant moan: a long mournful far-away wail routed through a panner at
   * pos. Distance falloff is applied by the caller (gain already scaled). Falls
   * back to a synthesized low formant wail when the sample has not decoded.
   */
  _playMoanPanned(distance, gain, pos, entry = null) {
    if (!this.ctx) return
    const p = this._pannerAt(pos)
    if (!this._playSfx('moan_distant', { gain: Math.min(0.6, gain), dest: p })) {
      // Synthesized stand-in: a slow descending low formant wail + breath noise.
      this._playFormant({ freq: 110, freqEnd: 70, f1: 260, f2: 620, duration: 2.4, gain, dest: p })
      this._playNoise({ duration: 2.2, filterType: 'lowpass', filterFreq: 500, gain: gain * 0.4, dest: p })
    }
    if (entry) entry.p = p
  }

  /**
   * v4 attack hiss: a sharp sibilant snarl a zombie lets off as it closes to
   * striking distance. Routed through a panner at pos; `entry` records the
   * panner so updateGroans disconnects it on expiry. Synthesized hiss fallback.
   */
  _playHissPanned(gain, pos, entry = null) {
    if (!this.ctx) return
    const p = this._pannerAt(pos)
    if (!this._playSfx('attack_hiss', { gain: Math.min(0.7, gain), dest: p })) {
      // Synthesized hiss: a bright bandpassed noise burst (sibilant spit).
      this._playNoise({ duration: 0.4, filterType: 'bandpass', filterFreq: 3200, gain, dest: p })
    }
    if (entry) entry.p = p
  }

  /**
   * v4 footstep: one footfall at the listener (no panner — it is the player's
   * own steps). `run` picks the louder/tighter variant. Synthesized crunch
   * fallback when the sample has not decoded.
   */
  footstep(run = false) {
    if (!this.ctx) return
    this._resume()
    const gain = run ? FOOTSTEP_RUN_GAIN : FOOTSTEP_WALK_GAIN
    if (this._playSfx('footstep', { gain, rate: run ? 1.12 : 1 })) return
    // Synthesized stand-in: a short lowpassed scuff + a soft thud.
    this._playNoise({ duration: 0.09, filterType: 'lowpass', filterFreq: 900, gain })
    this._playTone({ type: 'sine', freq: 120, freqEnd: 70, duration: 0.06, gain: gain * 0.5 })
  }

  /**
   * v4 jump: a soft body-movement cue fired once when the player leaves the
   * ground (a cloth rustle + a low effort grunt). At the listener (no panner —
   * it is the player's own jump). Synthesized fallback when the sample has not
   * decoded: a short bandpassed noise rustle + a low falling grunt tone.
   */
  jump() {
    if (!this.ctx) return
    this._resume()
    if (this._playSfx('jump', { gain: JUMP_GAIN })) return
    // Synthesized stand-in: a brief cloth rustle + a soft low grunt.
    this._playNoise({ duration: 0.12, filterType: 'bandpass', filterFreq: 700, gain: JUMP_GAIN * 0.6 })
    this._playTone({ type: 'sine', freq: 180, freqEnd: 120, duration: 0.14, gain: JUMP_GAIN * 0.5 })
  }

  /**
   * v4 weather: a snowstorm swell layered over the wind bed. A long lowpassed
   * noise sweep that rises then falls (blizzard gust), plus a faint highpassed
   * "blowing snow" hiss. Transient (auto-stopped); nothing persistent added.
   * Uses the sample when available, else synthesizes the sweep.
   */
  _scheduleStorm(t) {
    if (!this.ctx) return
    const at = this.ctx.currentTime
    const dur = 6.0 + 4.0 * this._stormRand()
    const peak = 0.09 + 0.05 * this._stormRand()
    const gap = STORM_MIN + (STORM_MAX - STORM_MIN) * this._stormRand()
    if (!this._playSfx('snowstorm', { gain: peak })) {
      // Synthesized blizzard sweep: lowpassed noise rising then falling.
      const src = this.ctx.createBufferSource()
      src.buffer = this._noiseBuffer
      src.loop = true
      const f = this.ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 700
      const b = this.ctx.createGain()
      b.gain.setValueAtTime(0.001, at)
      b.gain.linearRampToValueAtTime(peak, at + dur * 0.35)
      b.gain.linearRampToValueAtTime(0.001, at + dur)
      src.connect(f); f.connect(b); b.connect(this._fxDest())
      src.start(at)
      src.stop(at + dur + 0.05)
      // Faint blowing-snow hiss on top.
      this._playNoise({ duration: dur * 0.6, filterType: 'highpass', filterFreq: 3000, gain: peak * 0.25, when: dur * 0.2 })
    }
    this._stormCount++
    this._stormNextAt = t + dur + gap
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
    // v4 SFX: walker + brute use a generated growl (distance-scaled via `gain`);
    // screamer/shambler keep the synthesized voice. Fall back to synthesis when
    // the sample has not decoded yet.
    if (type === 'walker' && this._playSfx('growl_walker', { gain: Math.min(0.7, gain) })) return
    if (type === 'brute' && this._playSfx('growl_brute', { gain: Math.min(0.7, gain) })) return
    if (type === 'screamer') {
      this._playTone({ type: 'sawtooth', freq: 400, freqEnd: 200, duration: spec.voice, gain })
    } else if (type === 'brute') {
      // Boss "urgh": a sub-bass rumble under a voiced formant growl.
      this._playTone({ type: 'sine', freq: 45, freqEnd: 32, duration: spec.voice, gain })
      this._playFormant({ freq: 70, freqEnd: 50, f1: 320, f2: 900, duration: spec.voice * 0.8, gain: gain * 0.7 })
    } else {
      // Walker/shambler: a voiced "urgh" — a low saw carrier through two formant
      // bands plus a breath-noise layer, instead of a bare hum.
      const base = type === 'walker' ? 95 : 62
      this._playFormant({ freq: base, freqEnd: base * 0.85, f1: type === 'walker' ? 500 : 380, f2: type === 'walker' ? 1300 : 1000, duration: spec.voice, gain })
      this._playNoise({
        duration: spec.voice * 0.8,
        filterType: 'lowpass',
        filterFreq: type === 'walker' ? 500 : 320,
        gain: gain * 0.5
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
    if (!pos || !this.ctx) return this._fxDest()
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
      if (typeof p.setPosition !== 'function') { p.disconnect(); return this._fxDest() }
      p.setPosition(pos.x, 0.8, pos.z)
    }
    p.connect(this._fxDest())
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
    if (entry) entry.p = dest === this.master || dest === this._masterIn ? null : dest
    if (type === 'screamer') {
      this._playTone({ type: 'sawtooth', freq: 400, freqEnd: 200, duration: spec.voice, gain, dest })
    } else if (type === 'brute') {
      this._playTone({ type: 'sine', freq: 45, freqEnd: 32, duration: spec.voice, gain, dest })
      this._playFormant({ freq: 70, freqEnd: 50, f1: 320, f2: 900, duration: spec.voice * 0.8, gain: gain * 0.7, dest })
    } else {
      const base = type === 'walker' ? 95 : 62
      this._playFormant({ freq: base, freqEnd: base * 0.85, f1: type === 'walker' ? 500 : 380, f2: type === 'walker' ? 1300 : 1000, duration: spec.voice, gain, dest })
      this._playNoise({
        duration: spec.voice * 0.8,
        filterType: 'lowpass',
        filterFreq: type === 'walker' ? 500 : 320,
        gain: gain * 0.5,
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
  updateGroans(dt, zombies, playerPos, playerYaw = 0, playerState = null) {
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
    // v4 proximity dread: track the nearest live zombie for the close growl.
    let minD = Infinity
    let nearest = null
    for (const z of zombies) {
      if (z.isDead) { this._groanMap.delete(z); continue }
      const spec = GROAN_SPECS[z.type]
      if (!spec) continue
      const dx = z.position.x - px
      const dz = z.position.z - pz
      const d = Math.hypot(dx, dz)
      if (d >= GROAN_CUTOFF) { this._groanMap.delete(z); continue }
      if (d < minD) { minD = d; nearest = z }
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
      // v4 distant moan: a far zombie (outside the close groan band) lets off a
      // long mournful wail on its own slow LCG cadence, so distant hordes ache
      // audibly across the street. Own voice slot (cap 2) so it never starves
      // the groans; gain falls off toward the cutoff.
      if (d >= MOAN_NEAR && this._moanVoices.length < 2) {
        let me = this._moanMap.get(z)
        if (!me) {
          me = { nextAt: t + this._moanRand() * MOAN_MAX }
          this._moanMap.set(z, me)
        }
        if (t >= me.nextAt) {
          const prox = Math.max(0, 1 - (d - MOAN_NEAR) / (GROAN_CUTOFF - MOAN_NEAR))
          const mgain = MOAN_GAIN * (0.4 + 0.6 * prox)
          const period = MOAN_MAX - (MOAN_MAX - MOAN_MIN) * prox
          me.nextAt = t + period * (0.7 + 0.6 * this._moanRand())
          const mentry = { at: t + 2.6, p: null }
          this._moanVoices.push(mentry)
          scheduled.push({ type: 'moan', distance: d, gain: mgain })
          this._playMoanPanned(d, mgain, { x: z.position.x, z: z.position.z }, mentry)
        }
      } else {
        this._moanMap.delete(z)
      }
    }
    // v4 proximity dread: a dedicated close growl when the nearest live zombie
    // is inside CLOSE_GROWL_RADIUS. The period shrinks and the gain rises as it
    // closes (Minecraft-style "it's right behind you"), on its own LCG cadence
    // so it layers over — never starves — the ambient groans above.
    if (nearest && minD < CLOSE_GROWL_RADIUS) {
      const prox = Math.max(0, 1 - minD / CLOSE_GROWL_RADIUS) // 0 at edge, 1 point-blank
      if (t >= this._closeGrowlNextAt) {
        const period = CLOSE_GROWL_MAX - (CLOSE_GROWL_MAX - CLOSE_GROWL_MIN) * prox
        this._closeGrowlNextAt = t + period * (0.7 + 0.6 * this._closeGrowlRand())
        const gain = CLOSE_GROWL_GAIN * (0.4 + 0.6 * prox)
        const pos = { x: nearest.position.x, z: nearest.position.z }
        // Route through a panner at the nearest zombie so the growl sits in 3D;
        // track it so the node is disconnected when the voice expires (no leak).
        const p = this._pannerAt(pos)
        if (!this._playSfx('growl_close', { gain, dest: p })) {
          // No sample yet (headless / not loaded): synthesize a low close snarl.
          this._playFormant({ freq: 78, freqEnd: 58, f1: 300, f2: 820, duration: 0.5, gain, dest: p })
          this._playNoise({ duration: 0.4, filterType: 'lowpass', filterFreq: 420, gain: gain * 0.5, dest: p })
        }
        this._closeGrowlVoices.push({ at: t + 0.6, p })
        scheduled.push({ type: 'close', distance: minD, gain })
      }
    } else {
      // No one close: keep the next-fire clock pinned near the present so the
      // first close growl sounds promptly the moment a zombie enters the radius.
      this._closeGrowlNextAt = Math.min(this._closeGrowlNextAt, t + CLOSE_GROWL_MAX)
    }
    // v4 attack hiss: a sharp sibilant snarl when the nearest zombie is within
    // striking distance (about to attack). Louder + faster the closer it gets,
    // on its own LCG cadence so it layers over the close growl. Cap 1 voice.
    if (nearest && minD < HISS_RADIUS && this._hissVoices.length < 1) {
      const hprox = Math.max(0, 1 - minD / HISS_RADIUS)
      if (t >= this._hissNextAt) {
        const hperiod = HISS_MAX - (HISS_MAX - HISS_MIN) * hprox
        this._hissNextAt = t + hperiod * (0.7 + 0.6 * this._hissRand())
        const hgain = HISS_GAIN * (0.5 + 0.5 * hprox)
        const hentry = { at: t + 0.5, p: null }
        this._hissVoices.push(hentry)
        scheduled.push({ type: 'hiss', distance: minD, gain: hgain })
        this._playHissPanned(hgain, { x: nearest.position.x, z: nearest.position.z }, hentry)
      }
    } else {
      this._hissNextAt = Math.min(this._hissNextAt, t + HISS_MAX)
    }
    // Expire finished hiss voices and release their panners (swap-pop).
    if (this._hissVoices.length) {
      let hi = 0
      while (hi < this._hissVoices.length) {
        const e = this._hissVoices[hi]
        if (e.at > t) { hi++; continue }
        if (e.p && typeof e.p.disconnect === 'function') e.p.disconnect()
        this._hissVoices[hi] = this._hissVoices[this._hissVoices.length - 1]
        this._hissVoices.pop()
      }
    }
    // Expire finished moan voices and release their panners (swap-pop).
    if (this._moanVoices.length) {
      let mi = 0
      while (mi < this._moanVoices.length) {
        const e = this._moanVoices[mi]
        if (e.at > t) { mi++; continue }
        if (e.p && typeof e.p.disconnect === 'function') e.p.disconnect()
        this._moanVoices[mi] = this._moanVoices[this._moanVoices.length - 1]
        this._moanVoices.pop()
      }
    }
    // v4 footsteps: fire a footfall every FOOTSTEP_STRIDE metres the player
    // travels, so the cadence tracks walk vs sprint automatically. playerState
    // is { speed, sprint } (speed = ground-plane m/s); silent when standing.
    if (playerState && playerState.speed > 0.4) {
      this._stepAccum += playerState.speed * dt
      if (this._stepAccum >= FOOTSTEP_STRIDE) {
        this._stepAccum -= FOOTSTEP_STRIDE
        this._stepFlip = !this._stepFlip
        const run = playerState.sprint === true || playerState.speed > 5
        this.footstep(run)
        scheduled.push({ type: 'step', distance: 0, gain: run ? FOOTSTEP_RUN_GAIN : FOOTSTEP_WALK_GAIN })
      }
    } else {
      // Standing still: bleed off the partial stride so resuming doesn't fire a
      // stale step immediately.
      this._stepAccum = 0
    }
    // Expire finished close-growl voices and release their panners (swap-pop,
    // no per-frame allocation), mirroring the ambient-groan voice cleanup above.
    if (this._closeGrowlVoices.length) {
      let ci = 0
      while (ci < this._closeGrowlVoices.length) {
        const e = this._closeGrowlVoices[ci]
        if (e.at > t) { ci++; continue }
        if (e.p && typeof e.p.disconnect === 'function') e.p.disconnect()
        this._closeGrowlVoices[ci] = this._closeGrowlVoices[this._closeGrowlVoices.length - 1]
        this._closeGrowlVoices.pop()
      }
    }
    // V4P-1a gust tick (piggybacks on this per-frame call): fire a gust when
    // due. No-op headless (ambient never starts without ctx).
    this._ambClock += dt
    if (this._ambientOn && this._gustGainNode && this._ambClock >= this._gustNextAt) {
      this._scheduleGust(this._ambClock)
    }
    // v4 weather: a periodic snowstorm swell (longer + louder than a gust) fires
    // every STORM_MIN..STORM_MAX s, selling the winter setting. Independent of
    // the (v9-removed) persistent wind bed — it is a self-contained transient
    // burst, so it plays whenever there is a context. Own LCG so it never
    // collides with the short gusts above. No-op headless (no ctx).
    if (this.ctx && this._ambClock >= this._stormNextAt) {
      this._scheduleStorm(this._ambClock)
    }
    // Procedural soundtrack scheduler tick (same per-frame piggyback): keeps
    // the pattern loop scheduled ahead of the clock. No-op headless.
    this._updateMusicEngine(dt)
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
    src.connect(f); f.connect(b); b.connect(this._fxDest())
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
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this._fxDest())
    o1.start(t); o2.start(t); lfo.start(t)
    // V4P-1b: distant city hum/rumble - fixed 4-node subgraph (two sub-bass
    // sines through a 120 Hz lowpass, gain below the wind bed), separate from
    // the gust-modulated wind gain so gusts swell only the wind.
    const ho1 = this.ctx.createOscillator(); ho1.type = 'sine'; ho1.frequency.value = 32
    const ho2 = this.ctx.createOscillator(); ho2.type = 'sine'; ho2.frequency.value = 48
    const hlp = this.ctx.createBiquadFilter(); hlp.type = 'lowpass'; hlp.frequency.value = 120
    const hg = this.ctx.createGain(); hg.gain.value = 0.015
    ho1.connect(hlp); ho2.connect(hlp); hlp.connect(hg); hg.connect(this._fxDest())
    ho1.start(t); ho2.start(t)
    this._humNodes = { ho1, ho2, hlp, hg }
    this._ambientNodes = { o1, o2, lfo, g }
    this._gustGainNode = g
    this._ambientOn = true
  }

  stopAmbient() {
    if (!this.ctx || !this._ambientOn) return
    this._stopTension()
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
    this._applyMasterGain()
    this._applyMusicGain()
    if (this._settings) this._settings.set('muted', this.muted)
  }

  /** Seeded LCG in [0,1) for tension-pulse jitter (independent stream). */
  _tensionRand() {
    this._tensionSeed = (Math.imul(this._tensionSeed, 48271) >>> 0) % 65537
    return this._tensionSeed / 65537
  }

  /**
   * Phase 4: drive the adaptive tension bed. `level` is 0..1 (caller computes it
   * from alive-zombie pressure + low player health). The bed is created lazily
   * on the first non-zero level and torn down when the level returns to 0 (or on
   * stopAmbient/dispose), so calm moments cost nothing. Each call smooths the
   * actual level toward the target and, when due, fires a transient low "pulse"
   * whose rate rises with tension — a heartbeat that quickens as danger closes.
   * Headless-safe: no ctx -> records the target only, never throws.
   */
  setTension(level, dt = 0) {
    const target = Math.max(0, Math.min(1, Number(level) || 0))
    this._tensionTarget = target
    if (!this.ctx) return
    // Ease the realized level toward the target (frame-rate independent).
    const k = dt > 0 ? Math.min(1, dt * 2.5) : 1
    this._tensionCur += (target - this._tensionCur) * k
    if (this._tensionCur < 0.005 && target < 0.005) {
      if (this._tensionOn) this._stopTension()
      return
    }
    if (!this._tensionOn) this._startTension()
    const t = this.ctx.currentTime
    const n = this._tensionNodes
    if (!n) return
    // Drone gain rises with tension (sub-bass dread under the mix).
    n.g.gain.setTargetAtTime(0.02 + 0.06 * this._tensionCur, t, 0.4)
    // Pulse rate: from a slow ~1.1 s interval at low tension to ~0.5 s at max.
    const interval = 1.1 - 0.6 * this._tensionCur
    if (this._tensionCur > 0.12 && this._ambClock >= this._tensionPulseNext) {
      this._fireTensionPulse(this._tensionCur)
      this._tensionPulseNext = this._ambClock + interval * (0.85 + 0.3 * this._tensionRand())
    }
  }

  /** Build the persistent tension drone (two detuned low sawtooths through a
   *  lowpass into a tension-scaled gain). Transient pulses are separate. */
  _startTension() {
    if (!this.ctx || this._tensionOn) return
    const t = this.ctx.currentTime
    const o1 = this.ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 41
    const o2 = this.ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 43.5
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180
    const g = this.ctx.createGain(); g.gain.value = 0.02
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this._fxDest())
    o1.start(t); o2.start(t)
    this._tensionNodes = { o1, o2, lp, g }
    this._tensionOn = true
    this._tensionPulseNext = this._ambClock
  }

  /** A single low heartbeat pulse: a short sub-bass thump, gain scaled by the
   *  current tension. Transient (auto-stopped), routed through the SFX bus. */
  _fireTensionPulse(cur) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(58, t)
    osc.frequency.exponentialRampToValueAtTime(34, t + 0.18)
    const g = this.ctx.createGain()
    const peak = 0.05 + 0.12 * cur
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(peak, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
    osc.connect(g); g.connect(this._fxDest())
    osc.start(t)
    osc.stop(t + 0.28)
  }

  /** Tear down the tension drone (called when level returns to 0 and on stop). */
  _stopTension() {
    if (!this.ctx || !this._tensionOn) return
    const t = this.ctx.currentTime
    const n = this._tensionNodes
    if (n) {
      n.g.gain.cancelScheduledValues(t)
      n.g.gain.setValueAtTime(n.g.gain.value, t)
      n.g.gain.linearRampToValueAtTime(0, t + 0.4)
      const stopAt = t + 0.5
      n.o1.stop(stopAt); n.o2.stop(stopAt)
    }
    this._tensionNodes = null
    this._tensionOn = false
    this._tensionCur = 0
  }

  /** Master bus gain: 0 while muted, else the masterVolume ceiling (0.6 = the
   *  shipped baseline ceiling with no Settings attached). The direct `.value`
   *  write makes the change take effect immediately even while the context is
   *  still suspended (pre-gesture); the scheduled write keeps the timeline
   *  clean for automation. */
  _applyMasterGain() {
    if (this.ctx && this.master) {
      // Read the ceiling fresh: during a settings change event the cached
      // _masterCeil may not have been updated yet (listener order).
      const ceil = this._settings ? this._settings.get('masterVolume') : this._masterCeil
      this._masterCeil = ceil
      const v = this.muted ? 0 : ceil
      const t = this.ctx.currentTime
      this.master.gain.cancelScheduledValues(t)
      this.master.gain.setValueAtTime(v, t)
      this.master.gain.value = v
    }
  }

  /** SFX/ambient input bus gain: the effectsVolume ceiling (1 = baseline). */
  _applyFxGain() {
    if (this._masterIn) {
      const ceil = this._settings ? this._settings.get('effectsVolume') : this._fxCeil
      this._fxCeil = ceil
      this._masterIn.gain.value = ceil
    }
  }

  /** Music bus gain: 0 when either mute flag is set, else the musicVolume
   *  ceiling (0.5 = the shipped baseline). */
  _applyMusicGain() {
    const ceil = this._settings ? this._settings.get('musicVolume') : this._musicCeil
    this._musicCeil = ceil
    const v = (this.muted || this._musicMuted) ? 0 : ceil
    if (this._musicGain) this._musicGain.gain.value = v
    // The procedural engine has its own output gain feeding the same bus, so
    // mute/volume apply to it too (headless: no node, but the value is kept).
    this._musicEngineCeil = v
    if (this._musicEngine) this._musicEngine.setOutputGain(v)
  }

  /** Route the procedural engine's output into the music bus (browser-only,
   *  lazy: the graph is built on the first track start, after a gesture). */
  _wireMusicEngine() {
    if (!this.ctx || !this._musicEngine || this._musicEngineWired) return
    const dest = this._musicGain || this.master
    if (!dest) return
    this._musicEngine.start(this.ctx, dest)
    this._musicEngine.setOutputGain(this._musicEngineCeil)
    this._musicEngineWired = true
  }

  /** Start/switch the procedural soundtrack to a named track. Headless-safe:
   *  the engine still records the state so tests can observe it. */
  playMusicTrack(name) {
    if (!this._musicEngine) return
    this._wireMusicEngine()
    if (this._musicEngine.currentTrack === name && this._musicEngine.isPlaying) return
    this._musicEngine.switchTrack(name)
  }

  /** Stop the procedural soundtrack (ramps to silence, tears nodes down). */
  stopMusicTrack() {
    if (this._musicEngine) this._musicEngine.stop()
  }

  /** Pause the procedural soundtrack; the track is remembered for resume. */
  pauseMusic() {
    if (this._musicEngine) this._musicEngine.pause()
  }

  /** Resume the remembered procedural track after a pause. */
  resumeMusic() {
    if (!this._musicEngine) return
    this._wireMusicEngine()
    this._musicEngine.resume()
  }

  /** Observable procedural-music state (owned plain object, no live nodes). */
  get musicState() {
    if (!this._musicEngine) return { current: null, playing: false, playlist: { order: [], mode: 'none' } }
    return {
      current: this._musicEngine.currentTrack,
      playing: this._musicEngine.isPlaying,
      playlist: this._musicEngine.playlist
    }
  }

  /** Advance the procedural scheduler. Called from updateGroans (per frame). */
  _updateMusicEngine(dt) {
    if (!this._musicEngine) return
    this._musicEngineClock += Math.max(0, Number(dt) || 0)
    if (this._musicEngineClock < 0.5) return
    this._musicEngineClock = 0
    this._musicEngine.update()
  }

  toggleMuted() { this.setMuted(!this.muted) }

  /** One-shot spawn stinger (browser-only): plays a pre-rendered wav file
   *  (Wan2GP-generated horror hit) through a MediaElementSource into the SFX
   *  bus so it obeys master volume + mute. Headless-safe: no-op without a
   *  live AudioContext. Throttled so a wave burst cannot stack voices. */
  playSpawnStinger(url) {
    if (!this.ctx || this.muted || typeof Audio === 'undefined') return
    const now = (this.ctx && this.ctx.currentTime) || 0
    if (now - (this._stingerAt || -Infinity) < 1.2) return
    this._stingerAt = now
    this._resume()
    try {
      const el = new Audio(url)
      el.preload = 'auto'
      const src = this.ctx.createMediaElementSource(el)
      const g = this.ctx.createGain()
      g.gain.value = 0.5
      src.connect(g)
      g.connect(this._masterIn || this.master)
      el.play().catch(() => {})
      el.addEventListener('ended', () => { try { src.disconnect(); g.disconnect() } catch (err) {} })
    } catch (err) { /* unsupported: silent no-op */ }
  }

  /** Load + loop the soundtrack (browser-only). `url` is the mp3 path; `seconds`
   *  is the KNOWN true track length (defaults to the element's duration). The
   *  element is routed through a MediaElementSource into a dedicated musicGain
   *  -> master so it obeys mute. No-op headless (no AudioContext/DOM).
   *
   *  Looping is driven off the known length, NOT the element's `duration`:
   *  some browsers misreport an mp3's duration and fire `ended` early (around
   *  the 30 s mark), which cut the song short. A `timeupdate` watchdog rewinds
   *  to 0 once playback reaches the known end, so the full song always plays
   *  through before it loops. `ended` is kept as a backup that only restarts
   *  when we're genuinely near the known end. */
  playMusic(url, seconds) {
    if (!this.ctx || typeof Audio === 'undefined') return
    if (!this._musicEl) {
      const el = new Audio()
      el.loop = false // manual loop: replay on the known-end watchdog
      el.preload = 'auto'
      el.crossOrigin = 'anonymous'
      this._musicEl = el
      try {
        this._musicSrc = this.ctx.createMediaElementSource(el)
        this._musicGain = this.ctx.createGain()
        this._musicGain.gain.value = this._musicMuted || this.muted ? 0 : 0.5
        this._musicSrc.connect(this._musicGain)
        this._musicGain.connect(this.master)
      } catch (err) {
        // createMediaElementSource unsupported: fall back to the element's own
        // output (still looped), just not routed through the master graph.
        this._musicSrc = null
        this._musicGain = null
      }
      // Known length drives the loop; fall back to the element's (unreliable)
      // duration only if no explicit length was given.
      this._musicLen = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
      this._onMusicTimeUpdate = () => {
        if (!this._musicOn || !this._musicEl) return
        const len = this._musicLen || (this._musicEl.duration || 0)
        if (len <= 0) return
        const t = this._musicEl.currentTime || 0
        // Reached the known end. With a playlist active, advance to the NEXT
        // song (sequential playback); otherwise loop the single track.
        if (t >= len - 0.25) {
          if (this._plUrls && this._plUrls.length > 1) this._advancePlaylist()
          else { try { this._musicEl.currentTime = 0; this._musicEl.play().catch(() => {}) } catch (err) {} }
        }
      }
      this._onMusicEnded = () => {
        if (!this._musicOn || !this._musicEl) return
        try {
          const t = this._musicEl.currentTime || 0
          const len = this._musicLen || (this._musicEl.duration || 0)
          // Only restart from 0 when we're genuinely near the known end; if
          // `ended` fired early (wrong duration), resume where we stopped so the
          // song isn't cut short.
          if (len > 0 && t < len - 1.5) this._musicEl.currentTime = t
          else this._musicEl.currentTime = 0
          this._musicEl.play().catch(() => {})
        } catch (err) {}
      }
      if (typeof el.addEventListener === 'function') {
        el.addEventListener('ended', this._onMusicEnded)
        el.addEventListener('timeupdate', this._onMusicTimeUpdate)
      }
    }
    if (Number.isFinite(seconds) && seconds > 0) this._musicLen = seconds
    if (this._musicUrl !== url) { this._musicUrl = url; this._musicEl.src = url }
    this._musicOn = true
    this._musicEl.play().catch(() => {}) // autoplay policy: first sound follows a gesture
  }

  stopMusic() {
    this._musicOn = false
    if (this._musicEl) { try { this._musicEl.pause() } catch (err) {} }
  }

  /** Deterministic mp3 playlist: cycle through `urls` forever, switching to
   *  the next song when the current one reaches its known end. `urls` is a
   *  caller-resolved list (already prefixed with the asset base); `seconds`
   *  is either one number (the known length of EACH track, same length per
   *  song) or a per-track array of known lengths aligned with `urls` — the
   *  watchdog then rewinds each song at its own end. The rotation rides the
   *  existing timeupdate watchdog: when the known-end rewind fires, the src
   *  advances to the next song (mod length) and the watchdog length follows
   *  it, so the set repeats over and over. No Math.random, no timers.
   *  No-op headless. */
  playPlaylist(urls, seconds) {
    if (!Array.isArray(urls) || urls.length === 0) return
    this._plUrls = urls.slice()
    // Per-track lengths (v6 audio 8): an array gives each song its own known
    // end; a scalar is replicated across the list (legacy same-length call).
    this._plLens = Array.isArray(seconds)
      ? urls.map((_, i) => { const v = Number(seconds[i]); return Number.isFinite(v) && v > 0 ? v : 0 })
      : urls.map(() => { const v = Number(seconds); return Number.isFinite(v) && v > 0 ? v : 0 })
    this._plIndex = 0
    this.playMusic(urls[0], this._plLens[0])
    if (this._musicEl && this._plUrls.length > 1) {
      // One shared advance handler; replace any previous one to avoid stacking.
      if (this._onPlaylistAdvance) {
        try { this._musicEl.removeEventListener('ended', this._onPlaylistAdvance) } catch (err) {}
      }
      this._onPlaylistAdvance = () => { this._advancePlaylist() }
      if (typeof this._musicEl.addEventListener === 'function') {
        this._musicEl.addEventListener('ended', this._onPlaylistAdvance)
      }
    }
  }

  /** Move the playlist to the next song (mod length) and start it. Shared by
   *  the known-end watchdog, the native `ended` event, and skipPlaylistTrack.
   *  No-op when no playlist is active or the music bus is off. */
  _advancePlaylist() {
    if (!this._musicOn || !this._plUrls || this._plUrls.length < 2) return
    this._plIndex = (((this._plIndex || 0) + 1) % this._plUrls.length)
    const url = this._plUrls[this._plIndex]
    // The watchdog length follows the new song so its own known end drives the
    // next advance.
    const len = this._plLens ? this._plLens[this._plIndex] : 0
    if (Number.isFinite(len) && len > 0) this._musicLen = len
    if (this._musicEl) {
      if (this._musicUrl !== url) { this._musicUrl = url; this._musicEl.src = url }
      try { this._musicEl.currentTime = 0 } catch (err) {}
      this._musicEl.play().catch(() => {})
    }
  }

  /** Skip to the next song in the playlist right now (player-initiated). */
  skipPlaylistTrack() { this._advancePlaylist() }

  /** v4 UI: human-readable title of the CURRENT playlist track, derived from its
   *  filename (the shipped mp3s carry a language suffix: _en/_ja/_sv). Returns
   *  '' when no playlist is active so the HUD can hide the "now playing" line. */
  currentPlaylistName() {
    if (!this._plUrls || !this._plUrls.length) return ''
    const url = this._plUrls[this._plIndex || 0]
    if (!url) return ''
    const base = String(url).split('/').pop().split('?')[0].replace(/\.mp3$/i, '')
    const stem = base.replace(/^song_/i, '')
    // Human-readable titles for the shipped soundtrack (keyed by filename stem).
    const TITLES = { hord_en: 'Hord (EN)', matsubou_ja: 'Matsubou (JP)', javelin_sv: 'Javelin (SV)', boss: 'Boss Theme' }
    if (TITLES[stem]) return TITLES[stem]
    // Fallback: prettify an unmapped snake_case stem into Title Case.
    const pretty = stem.replace(/_/g, ' ').trim()
    return pretty ? pretty.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : ''
  }

  /** Temporarily pause the mp3 playlist (e.g. for a boss fight) while keeping
   *  the playlist state so resumePlaylistTrack can continue the same song. */
  pausePlaylistTrack() {
    if (this._musicEl && this._musicOn) { try { this._musicEl.pause() } catch (err) {} }
  }

  /** Resume the mp3 playlist after pausePlaylistTrack / playBossMusic: restore
   *  the playlist's current song src (the boss track overwrote it) and play. */
  resumePlaylistTrack() {
    if (!this._musicEl || !this._musicOn) return
    if (this._plUrls && this._plUrls.length > 0) {
      const url = this._plUrls[this._plIndex || 0]
      const len = this._plLens ? this._plLens[this._plIndex || 0] : 0
      if (Number.isFinite(len) && len > 0) this._musicLen = len
      if (this._musicUrl !== url) { this._musicUrl = url; this._musicEl.src = url }
    }
    this._musicEl.play().catch(() => {})
  }

  /** Dedicated boss-fight music: pause the mp3 playlist and play a single boss
   *  track (mystical / slow / scary) on the same music bus. `url` is a
   *  caller-resolved URL; `seconds` its known length. No-op headless. */
  playBossMusic(url, seconds) {
    if (!url || !this.ctx || typeof Audio === 'undefined') return
    this._plPaused = true
    this.pausePlaylistTrack()
    this.playMusic(url, seconds)
  }

  /** Leave the boss fight: stop the boss track and resume the mp3 playlist
   *  where it left off. No-op headless. */
  stopBossMusic() {
    if (!this._plPaused) return
    this._plPaused = false
    this.resumePlaylistTrack()
  }

  /** Per-level music: pick a track for a boss-cycle (a "level" = every 5 waves)
   *  and switch to it. `urls` is a caller-resolved list of track URLs (already
   *  prefixed with the asset base); `cycle` is the 0-based boss-cycle index.
   *  The track cycles through the list, so each level gets a different song and
   *  the set repeats once the list is exhausted. Delegates to playMusic so the
   *  existing loop/watchdog/gain graph is reused. No-op headless. */
  playLevelMusic(urls, cycle, seconds) {
    if (!Array.isArray(urls) || urls.length === 0) return
    const i = ((Math.floor(cycle) % urls.length) + urls.length) % urls.length
    this.playMusic(urls[i], seconds)
  }

  /** Set the music bus gain (0..1); either mute flag overrides it to 0. */
  setMusicVolume(v) {
    this._musicCeil = Math.max(0, Math.min(1, Number(v) || 0))
    this._applyMusicGain()
  }

  /** Mute/unmute ONLY the soundtrack (SFX stay audible). Independent of the
   *  global mute: either flag silences the music bus. Persisted when a
   *  Settings instance is attached. */
  setMusicMuted(on) {
    this._musicMuted = !!on
    this._applyMusicGain()
    if (this._settings) this._settings.set('musicMuted', this._musicMuted)
  }

  toggleMusicMuted() { this.setMusicMuted(!this._musicMuted) }

  dispose() {
    this.stopAmbient()
    this._stopTension()
    this.stopMusic()
    if (this._musicEl) {
      if (this._onMusicEnded) { try { this._musicEl.removeEventListener('ended', this._onMusicEnded) } catch (err) {} }
      if (this._onPlaylistAdvance) { try { this._musicEl.removeEventListener('ended', this._onPlaylistAdvance) } catch (err) {} }
      if (this._onMusicTimeUpdate) { try { this._musicEl.removeEventListener('timeupdate', this._onMusicTimeUpdate) } catch (err) {} }
      try { this._musicEl.src = '' } catch (err) {}
    }
    this._musicEl = null
    this._musicSrc = null
    this._musicGain = null
    this._musicUrl = null
    this._onMusicEnded = null
    this._onPlaylistAdvance = null
    this._plUrls = null
    this._plLens = null
    this._plIndex = 0
    this._onMusicTimeUpdate = null
    this._musicLen = 0
    this._musicMuted = false
    if (this._musicEngine) { this._musicEngine.dispose(); this._musicEngine = null }
    this._musicEngineWired = false
    this._musicEngineClock = 0
    if (this._settingsOff) { this._settingsOff(); this._settingsOff = null }
    this._settings = null
    this._masterIn = null
    this._groanMap = new Map()
    this._groanVoices = []
    this._groanClock = 0
    this._closeGrowlVoices = []
    this._closeGrowlNextAt = 0
    this._moanVoices = []
    this._moanMap = new Map()
    this._moanNextAt = 0
    this._hissVoices = []
    this._hissNextAt = 0
    this._stepAccum = 0
    this._stepFlip = false
    this._stormNextAt = 12
    this._stormCount = 0
    this._ambClock = 0
    this._gustNextAt = 2
    this._gustSrc = null
    this._gustGainNode = null
    this._humNodes = null
    this._tensionNodes = null
    this._tensionOn = false
    this._tensionTarget = 0
    this._tensionCur = 0
    this.shaper = null
    if (this._sfx) { this._sfx.dispose(); this._sfx = null }
    if (this.ctx) {
      try { this.ctx.close() } catch (err) {}
      this.ctx = null
      this.master = null
      this._noiseBuffer = null
    }
  }
}

// Soft-clip WaveShaper curve for the shotgun body: a tanh-like saturation that
// adds harmonic grit to the powder blast without full square-wave harshness.
// Cached so repeated shots reuse one Float32Array.
let _shotgunCurve = null
function shotgunCurve() {
  if (_shotgunCurve) return _shotgunCurve
  const n = 1024
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(x * 2.2)
  }
  _shotgunCurve = curve
  return curve
}
