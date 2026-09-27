// Score.js — run score plus persistent high score for Deadfall.
// Kill values: walker 10, shambler 15, screamer 25, brute (wave-5 boss) 150,
// plus a 50×wave bonus per kill (wave 1 walker = 60). The high score persists
// in localStorage when available (headless / storage-less envs degrade to
// best = 0 without throwing). The HUD reads {value, best}; Screens shows score
// + record flag on game over, and the title screen shows the stored best.
// v3 T6: the record also carries a player NAME. The name is hosted (the server
// stores {best, name}) so every visitor sees the record holder's name; the
// client sanitizes on input and the server re-validates on POST, and the value
// is only ever rendered via textContent — so a hostile payload can never
// inject markup into the shared record.

const VALUES = { walker: 10, shambler: 15, screamer: 25, brute: 150 }
const WAVE_BONUS = 50
export const STORAGE_KEY = 'deadfall-highscore'
export const NAME_KEY = 'deadfall-player-name'
export const MAX_NAME = 24

// Control-character class (C0 + DEL) as an escape-only regex so this source
// file stays plain ASCII — no literal control bytes in the file.
const CTRL_RE = new RegExp('[\\u0000-\\u001f\\u007f]', 'g')

/** v3 T6: sanitize a player-supplied name for the hosted high score. Strips
 *  control characters (incl. newlines/tabs), collapses runs of whitespace,
 *  trims, and clamps to MAX_NAME. This is the INPUT-side guard; the value is
 *  always rendered with textContent (never innerHTML), so even a leftover
 *  `<img src=x onerror=...>` becomes inert text — zero markup nodes. */
export function sanitizeName(raw) {
  const s = String(raw == null ? '' : raw)
    .replace(CTRL_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME)
  return s
}

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
    // v3 T6: the local player's chosen name (for a solo record) and the
    // hosted record holder's name (from GET /api/highscore). Both are stored
    // sanitized; render via textContent only.
    this.name = this._loadName()
    this.bestName = ''
    // v6: the hosted top-10 leaderboard (from GET /api/highscore). Each entry
    // is {name, score}, already sanitized server-side; rendered via
    // textContent only. Empty until adoptBest lands.
    this.top = []
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

  _loadName() {
    try {
      const s = this._storage()
      if (s) {
        const n = s.getItem(NAME_KEY)
        if (n) return sanitizeName(n)
      }
    } catch (err) { /* storage unavailable -> no name */ }
    return ''
  }

  /** v3 T6: set the local player's name (sanitized + persisted). Called from
   *  the title screen / co-op join so a new record is attributed to it. */
  setName(raw) {
    this.name = sanitizeName(raw)
    try {
      const s = this._storage()
      if (s) s.setItem(NAME_KEY, this.name)
    } catch (err) { /* storage unavailable — in-memory name still set */ }
    return this.name
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
      this.bestName = this.name // v3 T6: the record holder is this player
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

  /** Production-hosted best: seed the stored best (and holder name) from the
   *  server (GET /api/highscore) so the title screen shows the hosted record
   *  even in a fresh browser — localStorage is per-device. Best-effort: fetch
   *  or storage failures are swallowed and the local best is never lowered. */
  async adoptBest(fetchFn) {
    const f = fetchFn || (typeof fetch !== 'undefined' ? fetch : null)
    if (!f) return this.best
    try {
      const r = await f(this._apiBase() + '/api/highscore')
      if (!r || !r.ok) return this.best
      const j = await r.json()
      // v6: adopt the hosted top-10 leaderboard. The server returns
      // {best, name, top:[{name,score}…]}; re-sanitize defensively and keep
      // only clean entries so a hostile payload renders as inert text.
      const rawTop = Array.isArray(j && j.top) ? j.top : []
      const top = []
      for (const e of rawTop) {
        if (!e || typeof e !== 'object') continue
        const sv = Number(e.score)
        if (Number.isFinite(sv) && sv > 0) top.push({ name: sanitizeName(e.name), score: Math.floor(sv) })
      }
      const topChanged = top.length !== this.top.length ||
        top.some((e, i) => !this.top[i] || this.top[i].score !== e.score || this.top[i].name !== e.name)
      if (topChanged) this.top = top
      const v = Number(j && j.best)
      if (Number.isFinite(v) && v > this.best) {
        this.best = v
        // v3 T6: adopt the hosted holder's name (server already sanitized it,
        // but re-sanitize defensively before render).
        this.bestName = sanitizeName(j && j.name)
        try {
          const s = this._storage()
          if (s) s.setItem(STORAGE_KEY, String(v))
        } catch (err) { /* storage unavailable — in-memory best still set */ }
      }
      if (topChanged || (Number.isFinite(v) && v > 0 && v >= this.best)) {
        if (this._onBestChange) this._onBestChange()
      }
    } catch (err) { /* offline / no backend — keep the local best */ }
    return this.best
  }

  /** Submit the current best + holder name to the hosted backend (POST
   *  /api/highscore). Best-effort: any failure is swallowed — the local best
   *  already stands. The name is sent sanitized; the server re-validates. */
  async submitBest(fetchFn) {
    const f = fetchFn || (typeof fetch !== 'undefined' ? fetch : null)
    if (!f || !(this.best > 0)) return false
    try {
      const r = await f(this._apiBase() + '/api/highscore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ score: this.best, name: this.bestName || this.name || '' })
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