// MusicDirector.js — decides WHICH procedural track plays and WHEN, so no
// track-selection logic lives in Game.js. Game forwards wave events, state
// transitions, and the per-frame tension level; the director translates them
// into AudioBank music calls. Pure bookkeeping: headless-safe, deterministic,
// no timers and no Math.random (hysteresis is threshold-based only).
//
// Track map:
//  - waves 1..2                -> 'ambient' (calm opening)
//  - other waves               -> 'combat'
//  - boss waves (w % bossEvery)==0 -> 'crisis'
//  - a cleared wave            -> 'ambient' (calm between waves)
//  - tension >= 0.75           -> 'crisis'; tension < 0.2 leaves crisis
//  - title / paused            -> pause the music (track remembered)
//  - playing                   -> resume the remembered track
//  - gameover                  -> stop (documented choice: a fade-out to
//    silence reads as death better than letting a loop keep running)
//
// Every call no-ops when the audio bank is missing or has no music methods.

export class MusicDirector {
  constructor(audioBank, { bossEvery = 5 } = {}) {
    this.audio = audioBank || null
    this.bossEvery = Math.max(1, Math.floor(bossEvery) || 5)
    this._current = null   // last track handed to the bank
    this._wave = 0         // last wave seen (decides ambient vs combat)
    this._paused = false
  }

  /** True when the bank exposes the procedural music API. */
  get available() {
    return !!(this.audio && typeof this.audio.playMusicTrack === 'function')
  }

  /** Game state transitions: pause/resume/stop the soundtrack. */
  onStateChange(next, prev) {
    if (!this.available) return
    if (next === 'title' || next === 'paused') {
      this._paused = true
      this.audio.pauseMusic()
    } else if (next === 'playing') {
      this._paused = false
      this.audio.resumeMusic()
    } else if (next === 'gameover') {
      this._paused = false
      this._current = null
      this.audio.stopMusicTrack() // documented: stop, not a crisis fade-down
    }
  }

  /** A wave started: boss waves get crisis, the opening stays ambient. */
  onWaveStart(w) {
    if (!this.available) return
    this._wave = w
    this._paused = false
    this._select(w % this.bossEvery === 0 ? 'crisis' : (w <= 2 ? 'ambient' : 'combat'))
  }

  /** A wave cleared: calm between waves, so drop back to ambient. */
  onWaveCleared(w) {
    if (!this.available) return
    this._select('ambient')
  }

  /** Per-frame tension (0..1). Threshold hysteresis only — no timers. */
  onTension(level) {
    if (!this.available || this._paused) return
    const lv = Number.isFinite(level) ? level : 0
    if (lv >= 0.75 && this._current !== 'crisis') this._select('crisis')
    else if (lv < 0.2 && this._current === 'crisis') {
      this._select(this._wave <= 2 ? 'ambient' : 'combat')
    }
  }

  /** Fresh run: back to the initial state and start the opening track. */
  reset() {
    this._current = null
    this._wave = 1
    this._paused = false
    if (!this.available) return
    this._select('ambient')
  }

  /** Hand a track to the bank unless it is already the current one. */
  _select(name) {
    if (this._current === name) return
    this._current = name
    this.audio.playMusicTrack(name)
  }
}