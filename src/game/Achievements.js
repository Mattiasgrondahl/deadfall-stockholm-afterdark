// Achievements.js — persistent achievement tracking for Deadfall (v3 T12).
//
// Five categories, each a ladder of thresholds. A counter crossing a threshold
// unlocks that tier ONCE; the unlocked set persists in localStorage so it
// survives restarts, while the per-run COUNTERS reset on restart (per the user
// decision: waves survived — and every other counter — are per-run progress,
// but a tier once earned stays earned). Headless / storage-less envs degrade to
// an in-memory set without throwing, mirroring Settings.js / Score.js.
//
// The class is pure bookkeeping: it owns no THREE objects and touches the DOM
// only through an injected `onUnlock(label)` callback (Game wires it to the
// Screens banner toast). dispose() drops the callback; there are no meshes or
// listeners to reverse.

export const STORAGE_KEY = 'deadfall-achievements'

// Each category: id, a human label prefix, and the threshold ladder. The
// achievement label reads "<label> <n>" (e.g. "SLAYER 50" at 50 kills).
export const CATEGORIES = [
  { id: 'kills', label: 'SLAYER', thresholds: [10, 20, 50, 100] },
  { id: 'lamps', label: 'LAMP LIGHTER', thresholds: [10, 20, 30, 40, 50] },
  { id: 'headshots', label: 'BULLSEYE', thresholds: [25, 50, 75, 100] },
  { id: 'waves', label: 'SURVIVOR', thresholds: [5, 10, 15, 20, 25, 30] },
  { id: 'bosses', label: 'GIANT SLAYER', thresholds: [1, 5, 10, 15, 20, 25, 30] }
]

// id -> sorted threshold list, for O(1) tier lookups on each counter bump.
const LADDER = {}
for (const c of CATEGORIES) LADDER[c.id] = c.thresholds

export class Achievements {
  /**
   * @param env host environment ({ localStorage?: Storage-like }) or null
   * @param onUnlock (label) => void — fired once per newly-unlocked tier
   */
  constructor(env, onUnlock) {
    this.env = env || null
    this._onUnlock = onUnlock || null
    // Persisted: the set of unlocked "id:threshold" keys.
    this.unlocked = this._load()
    // Per-run counters (reset on restart): kills, headshots, lamps, bosses,
    // and waves cleared. These are progress toward the next tier, not records.
    this.counters = { kills: 0, headshots: 0, lamps: 0, bosses: 0, waves: 0 }
  }

  _storage() {
    const s = this.env && this.env.localStorage
    return s || null
  }

  /** Load the persisted unlocked set. Corrupt / unavailable storage -> empty. */
  _load() {
    const set = new Set()
    try {
      const s = this._storage()
      if (!s) return set
      const raw = s.getItem(STORAGE_KEY)
      if (!raw) return set
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        for (const k of arr) if (typeof k === 'string') set.add(k)
      }
    } catch (err) { /* corrupt or unavailable -> empty set */ }
    return set
  }

  /** Persist the unlocked set. Best-effort; storage failures are swallowed. */
  _save() {
    try {
      const s = this._storage()
      if (s) s.setItem(STORAGE_KEY, JSON.stringify([...this.unlocked]))
    } catch (err) { /* storage unavailable — in-memory set still stands */ }
  }

  /** Reset the per-run counters (called on restart). The unlocked set is NOT
   *  touched — earned tiers survive every restart. */
  resetRun() {
    this.counters.kills = 0
    this.counters.headshots = 0
    this.counters.lamps = 0
    this.counters.bosses = 0
    this.counters.waves = 0
  }

  /**
   * Bump a per-run counter by `n` and unlock every tier it newly crosses.
   * A tier unlocks once (guarded by the unlocked set), so re-running the same
   * count after a restart can re-cross it but never re-fires the toast for an
   * already-earned tier. Returns the array of labels unlocked by this bump.
   */
  add(id, n = 1) {
    if (!(id in this.counters)) return []
    const ladder = LADDER[id]
    if (!ladder) return []
    const prev = this.counters[id]
    const next = prev + (Number(n) || 0)
    this.counters[id] = next
    const made = []
    for (const t of ladder) {
      if (prev < t && next >= t) {
        const key = id + ':' + t
        if (!this.unlocked.has(key)) {
          this.unlocked.add(key)
          const label = this.labelFor(id, t)
          made.push(label)
          if (this._onUnlock) { try { this._onUnlock(label) } catch (err) { /* bad listener must not break the bump */ } }
        }
      }
    }
    if (made.length) this._save()
    return made
  }

  // Convenience hooks mirroring the game's event points.
  onKill() { return this.add('kills', 1) }
  onHeadshot() { return this.add('headshots', 1) }
  onLamp() { return this.add('lamps', 1) }
  onBoss() { return this.add('bosses', 1) }
  onWaveCleared() { return this.add('waves', 1) }

  /** Human label for a tier, e.g. "SLAYER 50". */
  labelFor(id, threshold) {
    const cat = CATEGORIES.find((c) => c.id === id)
    return cat ? cat.label + ' ' + threshold : id + ' ' + threshold
  }

  /** Whether a specific tier is already unlocked. */
  isUnlocked(id, threshold) { return this.unlocked.has(id + ':' + threshold) }

  /** Count of unlocked tiers across all categories. */
  get unlockedCount() { return this.unlocked.size }

  /** Total tiers across all ladders (for a "X / N" readout). */
  get totalTiers() {
    let n = 0
    for (const c of CATEGORIES) n += c.thresholds.length
    return n
  }

  /** Drop the injected callback so nothing holds the Screens object alive. */
  dispose() {
    this._onUnlock = null
  }
}