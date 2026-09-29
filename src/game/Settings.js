// Settings.js — persistent player settings for Deadfall (browser localStorage
// with a headless no-op fallback). One flat object of validated values, a
// versioned storage key, and change notification. Game constructs this before
// any subsystem reads a knob (volume, sensitivity, FOV, quality, reduced
// motion, blackout battery) so every consumer starts from the stored state.
//
// Values are plain data; nothing here touches the DOM or AudioContext.
// Storage errors (private mode, quota) degrade silently to defaults.

export const SETTINGS_KEY = 'deadfall-settings-v1'

export const DEFAULTS = {
  masterVolume: 0.8,   // 0..1 — scales the 0.6 master bus ceiling
  musicVolume: 0.5,    // 0..1 — music bus ceiling (see AudioBank._musicCeil)
  effectsVolume: 1.0,  // 0..1 — SFX/ambient input bus into master
  muted: false,        // global mute (M key) — persisted
  musicMuted: false,   // soundtrack-only mute (N key / HUD button) — persisted
  sensitivity: 1.0,    // mouse-look multiplier on LOOK_SENS
  fov: 75,             // base vertical FOV in degrees (sniper scope unaffected)
  quality: 'high',     // 'low' | 'medium' | 'high' — lighting/shadow/snow/postfx
  flashlightEffects: true, // low-battery flicker + dim bursts
  reducedMotion: false,    // honor prefers-reduced-motion / explicit opt-in
  blackoutBattery: false   // BLACKOUT difficulty: battery drains 3× faster
}

const RANGES = {
  masterVolume: [0, 1],
  musicVolume: [0, 1],
  effectsVolume: [0, 1],
  sensitivity: [0.2, 3],
  fov: [65, 100]
}

const ENUMS = {
  quality: ['low', 'medium', 'high'],
  flashlightEffects: [true, false],
  reducedMotion: [true, false],
  blackoutBattery: [true, false],
  muted: [true, false],
  musicMuted: [true, false]
}

function clamp(v, [lo, hi]) { return Math.max(lo, Math.min(hi, v)) }

export class Settings {
  /** @param env host environment ({ localStorage?: Storage-like }) or null */
  constructor(env) {
    this.env = env || null
    this.values = { ...DEFAULTS }
    this._listeners = []
    this._load()
  }

  _storage() {
    const s = this.env && this.env.localStorage
    return s || null
  }

  _load() {
    try {
      const s = this._storage()
      if (!s) return
      const raw = s.getItem(SETTINGS_KEY)
      if (!raw) return
      const obj = JSON.parse(raw)
      if (!obj || typeof obj !== 'object') return
      for (const k of Object.keys(DEFAULTS)) {
        if (!(k in obj)) continue
        const v = obj[k]
        if (RANGES[k]) this.values[k] = clamp(Number(v), RANGES[k])
        else if (ENUMS[k]) {
          if (ENUMS[k].includes(v)) this.values[k] = v
          else if (k === 'quality' && (v === 'med' || v === 'medium')) this.values[k] = 'medium'
        }
      }
    } catch (err) { /* corrupt or unavailable storage -> defaults */ }
  }

  save() {
    try {
      const s = this._storage()
      if (s) s.setItem(SETTINGS_KEY, JSON.stringify(this.values))
    } catch (err) { /* storage unavailable -> keep in-memory values */ }
  }

  get(key) { return this.values[key] }

  /** Set one key (validated + clamped). Returns the stored value. */
  set(key, value) {
    if (!(key in DEFAULTS)) return undefined
    let v = value
    if (RANGES[key]) {
      const n = Number(value)
      if (!Number.isFinite(n)) return this.values[key]
      v = clamp(n, RANGES[key])
    } else if (ENUMS[key]) {
      if (key === 'quality') v = value === 'med' ? 'medium' : (ENUMS[key].includes(value) ? value : DEFAULTS[key])
      else v = !!value
    }
    if (this.values[key] === v) return v
    this.values[key] = v
    this.save()
    this._emit(key, v)
    return v
  }

  /** Subscribe to (key, value) changes; returns an unsubscribe function. */
  onChange(cb) {
    this._listeners.push(cb)
    return () => {
      const i = this._listeners.indexOf(cb)
      if (i >= 0) this._listeners.splice(i, 1)
    }
  }

  _emit(key, value) {
    for (const cb of this._listeners) {
      try { cb(key, value) } catch (err) { /* a bad listener must not break others */ }
    }
  }
}
