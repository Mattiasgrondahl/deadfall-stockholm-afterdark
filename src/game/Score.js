// Score.js — run score plus persistent high score for Deadfall.
// Kill values: walker 10, shambler 15, screamer 25, brute (wave-5 boss) 150,
// plus a 50×wave bonus per kill (wave 1 walker = 60). The high score persists
// in localStorage when available (headless / storage-less envs degrade to
// best = 0 without throwing). The HUD reads {value, best}; Screens shows score
// + record flag on game over, and the title screen shows the stored best.

const VALUES = { walker: 10, shambler: 15, screamer: 25, brute: 150 }
const WAVE_BONUS = 50
export const STORAGE_KEY = 'deadfall-highscore'

export class Score {
  /**
   * @param env host environment ({ localStorage?: Storage-like }) or null
   * @param waveGetter () => current wave number
   */
  constructor(env, waveGetter) {
    this.env = env || null
    this._waveGetter = waveGetter || (() => 1)
    this.value = 0
    this.best = this._loadBest()
  }

  _storage() {
    const s = this.env && this.env.localStorage
    return s || null
  }

  _loadBest() {
    try {
      const s = this._storage()
      if (s) {
        const v = parseInt(s.getItem(STORAGE_KEY), 10)
        if (Number.isFinite(v) && v > 0) return v
      }
    } catch (err) { /* storage unavailable or corrupt -> 0 */ }
    return 0
  }

  /** Points a kill of `type` on `wave` is worth. */
  pointsFor(type, wave) {
    return (VALUES[type] || 0) + WAVE_BONUS * (Number(wave) || 1)
  }

  /** Add a kill's points; returns the new run total. */
  addKill(type, wave) {
    this.value += this.pointsFor(type, wave)
    return this.value
  }

  /** New run: score resets, the stored best persists. */
  reset() {
    this.value = 0
  }

  /** Called on game over: true if this run beat the stored best (and saves it). */
  newRecord() {
    if (this.value > this.best) {
      this.best = this.value
      try {
        const s = this._storage()
        if (s) s.setItem(STORAGE_KEY, String(this.value))
      } catch (err) { /* storage unavailable — in-memory best still set */ }
      return true
    }
    return false
  }

  /** Base URL for the hosted backend. The high score is a single global
   *  record owned by the game server, so it is queried on the same origin the
   *  WebSocket already uses (location.host, port 8080 when the game server
   *  serves the site) — NOT the page's base path: the Pages build is served
   *  from /deadfall-stockholm-afterdark while GitHub Pages itself has no
   *  backend, and the dev server proxies /ws (and /api/highscore) to :8080.
   *  Falls back to the base path when there is no location (non-browser). */
  _apiBase() {
    if (typeof location !== 'undefined' && location && location.host) {
      return location.protocol + '//' + location.host
    }
    const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/'
    return base.replace(/\/$/, '')
  }

  /** Production-hosted best: seed the stored best from the server
   *  (GET /api/highscore) so the title screen shows the hosted record even in
   *  a fresh browser — localStorage is per-device. Best-effort: fetch or
   *  storage failures are swallowed and the local best is never lowered. */
  async adoptBest(fetchFn) {
    const f = fetchFn || (typeof fetch !== 'undefined' ? fetch : null)
    if (!f) return this.best
    try {
      const r = await f(this._apiBase() + '/api/highscore')
      if (!r || !r.ok) return this.best
      const j = await r.json()
      const v = Number(j && j.best)
      if (Number.isFinite(v) && v > this.best) {
        this.best = v
        try {
          const s = this._storage()
          if (s) s.setItem(STORAGE_KEY, String(v))
        } catch (err) { /* storage unavailable — in-memory best still set */ }
        if (this._onBestChange) this._onBestChange()
      }
    } catch (err) { /* offline / no backend — keep the local best */ }
    return this.best
  }

  /** Submit the current best to the hosted backend (POST /api/highscore).
   *  Best-effort: any failure is swallowed — the local best already stands. */
  async submitBest(fetchFn) {
    const f = fetchFn || (typeof fetch !== 'undefined' ? fetch : null)
    if (!f || !(this.best > 0)) return false
    try {
      const r = await f(this._apiBase() + '/api/highscore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ score: this.best })
      })
      return !!r && r.ok
    } catch (err) { return false }
  }

  /** Game-over commit: save locally if it is a record, then mirror it to the
   *  hosted backend. Takes the same optional fetch injection as submitBest so
   *  tests can chain both calls offline. Returns whether a record was made. */
  async commitRecord(fetchFn) {
    const made = this.newRecord()
    await this.submitBest(fetchFn)
    return made
  }
}
