// WaveManager — deterministic wave scheduler for zombie spawns.
//
// Owns wave progression: queue composition (type + spawn point), spawn
// cadence (0.7 s), concurrent-cap throttling, kill counting, and wave
// clear detection. All data is deterministic — no Math.random.
//
// Clear fires on `spawned > 0 && alive === 0`, i.e. every *alive* zombie
// is dead; unspawned queue remainder is discarded (the debug
// forceWaveClear / killAllZombies paths depend on this).
//
// Boss finale: at the end of every BOSS_EVERY-th wave (5, 10, 15, ...), once
// that wave's queue is fully spawned AND every zombie is dead, the wave is held
// open for BOSS_DELAY seconds and a `brute` boss stomps in from the far north
// spawn point (onBossIncoming -> onBossSpawn callbacks). Killing the boss clears
// the wave normally. Boss HP scales with the wave (1.12^wave), so the level-5
// boss takes many shots and later bosses take progressively more. A debug
// forceClear on a boss wave skips the boss (it never arms the gate) and moves on.

// v6 gameplay (1) — the spawn cadence is a curve, not a constant. Wave 1 is
// the tutorial pace (0.7 s); each wave shortens it by 0.05 s down to a 0.45 s
// floor at wave 6. 0.45 s stays well above the pistol's 0.28 s fire interval,
// so a wave can never outrun the player's effective rate of fire. Waves 1-3
// keep the exact 0.7 s cadence pinned by wave.test / match.test / verify S6.
const SPAWN_BASE = 0.7
const SPAWN_STEP = 0.05
const SPAWN_MIN = 0.45
// Intermission grows with the wave: early waves stay fast (3 s), later waves
// give room to reposition and reload. The ceiling is 5 s (not 6): above wave
// 5 the curve flattens, so the pressure ramp comes from the cadence and cap
// instead of from ever-longer waits. The wave-5/10/... boss waves keep their
// longer breather after the boss falls.
const INTERMISSION_BASE = 3.0
const INTERMISSION_STEP = 0.5
const INTERMISSION_MAX = 5.0
const BOSS_INTERMISSION = 7.0
// Concurrency cap: 8 + wave up to wave 9, then a gentler +0.5/wave ramp that
// tops out at 16 by wave 10 and holds there. The old min(8 + wave, 18) let the
// cap saturate at 18 by wave 10 while `total` kept growing, so late waves were
// a pure grind: 41 zombies against an 18 cap at a flat cadence meant ~16 s of
// dead stall at the cap. 16 keeps wave 12 + boss inside the 24-zombie budget.
const CAP_BASE = 8
const CAP_KNEE = 9
const CAP_SLOPE = 0.5
const CAP_MAX = 16

/** A boss stomps in at the end of every BOSS_EVERY-th wave (5, 10, 15, ...). */
const BOSS_EVERY = 5
/** True when `wave` is a boss wave (a multiple of BOSS_EVERY). */
const isBossWave = (wave) => wave > 0 && wave % BOSS_EVERY === 0
/** Gap after a boss wave's queue is fully spawned and cleared before the boss
 *  stomps in — a short, dramatic pause instead of an instant spawn. */
const BOSS_DELAY = 1.5
/** Spawn point for the boss: index 3 of City.getSpawnPoints() = (0, 85), the
 *  far north end of the main street, so the brute walks the player down. */
const BOSS_POINT = { x: 0, z: 85 }

/** Intermission length after clearing `wave`: grows with the wave number
 *  (3 s at wave 1, +0.5 s per wave, capped at 5 s; 7 s after a boss wave).
 *  The 5 s ceiling is a floor-preserving choice: every intermission stays at
 *  least as long as the pistol's 1.1 s reload, and waves 1-4 keep the exact
 *  3.0/3.5/4.0/4.5 s values pinned by wave.test and verify-game S6. */
function intermissionFor(wave, wasBoss) {
  if (wasBoss) return BOSS_INTERMISSION
  return Math.min(INTERMISSION_MAX, INTERMISSION_BASE + INTERMISSION_STEP * (Math.max(1, wave) - 1))
}

/** Seconds between spawns for `wave` — 0.7 s at wave 1, tightening to the
 *  0.45 s floor at wave 6. Deterministic; no allocation. */
function spawnIntervalFor(wave) {
  return Math.max(SPAWN_MIN, SPAWN_BASE - SPAWN_STEP * (Math.max(1, wave) - 1))
}

/** Concurrent-zombie cap for `wave`: 8 + wave through wave 9, then +0.5 per
 *  wave up to the 16 ceiling. Wave 1/2/3 stay 9/10/11 and wave 5 stays 13. */
function capFor(wave) {
  const w = Math.max(1, wave)
  if (w <= CAP_KNEE) return Math.floor(CAP_BASE + w)
  return Math.min(CAP_MAX, Math.floor(CAP_BASE + CAP_KNEE + CAP_SLOPE * (w - CAP_KNEE)))
}

/** Type of queue slot `i` in `wave`. The composition rule is a curve of its
 *  own: waves 1-2 keep their pinned shape (shamblers every 5th slot); wave 3
 *  is the first screamer wave (every odd slot, no shamblers); from wave 4 the
 *  shambler share rises from every 5th slot to every 4th — 25% instead of 20%
 *  — while screamers stay at every odd slot, so the late-wave threat mix
 *  grows without ever exceeding the SAFE-point budget. Deterministic. */
function queueTypeAt(wave, i) {
  if (wave < 3 && i % 5 === 0) return 'shambler'
  if (wave === 3 && i % 2 === 1) return 'screamer'
  if (wave > 3 && i % 4 === 0) return 'shambler'
  if (wave > 3 && i % 2 === 1) return 'screamer'
  return 'walker'
}

export class WaveManager {
  /**
   * @param scene       THREE.Scene (spawn callback builds entities)
   * @param spawnPoints city spawn points [{x, z}, ...]
   * @param collision   CollisionWorld (unused here; contract symmetry)
   * @param audio       audio bank or null (headless); calls null-guarded
   * @param callbacks   { onWaveStart(w), onWaveCleared(w), spawnZombie(type, x, z),
   *                      onBossIncoming(w), onBossSpawn(w) } (last two optional)
   */
  constructor(scene, spawnPoints, collision, audio, callbacks = {}) {
    this.scene = scene
    this.spawnPoints = spawnPoints
    this.audio = audio
    this.cb = callbacks
    this.wave = 0
    this.spawned = 0
    this.killed = 0
    this.timer = 0
    this.queue = []
    this.intermission = 0
    this._prevAlive = 0
    // Boss state (wave-5 finale): armed when wave 5 is fully spawned, fires
    // once the wave-5 queue is cleared, spawns the brute after BOSS_DELAY.
    this._bossArmed = false
    this._bossPending = false
    this._bossTimer = 0
    this._bossSpawned = false
  }

  get total() { return 5 + 3 * this.wave }
  get cap() { return capFor(this.wave) }
  /** Current spawn cadence (seconds between spawns) — exposed so the pacing
   *  acceptance test and the HUD can read the curve without duplicating it. */
  get spawnInterval() { return spawnIntervalFor(this.wave) }

  /** Next-wave composition preview for the intermission HUD: the type counts
   *  of the wave that starts when the current intermission ends. Returns null
   *  outside the intermission (or before wave 1 exists). */
  get nextWavePreview() {
    if (this.intermission <= 0) return null
    const next = this.wave + 1
    const counts = { walker: 0, shambler: 0, screamer: 0 }
    const total = 5 + 3 * next
    for (let i = 0; i < total; i++) counts[queueTypeAt(next, i)]++
    return { wave: next, total, ...counts, boss: isBossWave(next) }
  }
  get remaining() {
    // While the boss is pending/spawned it is not part of the queue total, so
    // it must be counted or the HUD "left" readout would hit 0 while the fight
    // is still on.
    return this.total - this.killed + (this._bossPending || this._bossSpawned ? 1 : 0)
  }

  /** Start (or restart) wave 1. */
  reset() {
    this.wave = 1
    this.spawned = 0
    this.killed = 0
    this.timer = 0
    this.intermission = 0
    this._prevAlive = 0
    this._bossArmed = false
    this._bossPending = false
    this._bossTimer = 0
    this._bossSpawned = false
    this.queue = this.buildQueue(1)
    // v6 gameplay (1): wave 1 keeps the pinned opening — timer 0 means the
    // first zombie lands on the 0.05 s frame (match.test pins 0.05/0.75/1.45/
    // 2.15/2.85), and every later spawn follows the wave-1 0.7 s cadence.
    this.timer = 0
    this.cb.onWaveStart?.(1)
    this.audio?.playWave?.(1)
  }

  /**
   * Deterministic queue: type by index rule; shamblers take the closest
   * points (so the slowest zombies are killable early) — at most SAFE.length
   * of them. The rest (non-shamblers plus any extra shamblers) cycle 0..n-1
   * and reuse points once the wave outgrows the point count.
   */
  buildQueue(wave) {
    const n = this.spawnPoints.length
    const total = 5 + 3 * wave
    const SAFE = [10, 11, 8, 9, 3, 0, 1] // nearest-first points ≤ 87 m from (0,12)
    const types = []
    for (let i = 0; i < total; i++) types.push(queueTypeAt(wave, i))
    const used = new Set()
    const pts = new Array(total).fill(-1)
    // Shamblers take the nearest points first — at most one per SAFE entry.
    // Once SAFE is exhausted (large waves), extra shamblers are left for the
    // general cycling below, so a point can never be left undefined.
    let s = 0
    for (let i = 0; i < total; i++) {
      if (types[i] === 'shambler' && s < SAFE.length) {
        while (s < SAFE.length && used.has(SAFE[s])) s++
        if (s < SAFE.length) {
          pts[i] = SAFE[s]
          used.add(pts[i])
          s++
        }
      }
    }
    // Everyone not yet assigned (non-shamblers + extra shamblers) cycles
    // 0..n-1, reusing points once the wave outgrows the point count.
    for (let i = 0; i < total; i++) {
      if (pts[i] !== -1) continue
      let p = i % n
      let tries = 0
      while (used.has(p) && tries < n) { p = (p + 1) % n; tries++ }
      pts[i] = tries < n ? p : i % n
      used.add(pts[i])
    }
    return types.map((t, i) => ({
      type: t,
      x: this.spawnPoints[pts[i]].x,
      z: this.spawnPoints[pts[i]].z
    }))
  }

  /** Per-frame update, called only while PLAYING. dt is clamped upstream. */
  update(dt, game) {
    if (this.intermission > 0) {
      this.intermission -= dt
      if (this.intermission <= 0) {
        this.wave++
        this.spawned = 0
        this.killed = 0
        // v6 gameplay (1): the new wave's first spawn waits a full cadence
        // instead of firing on the same frame the intermission expires.
        this.timer = spawnIntervalFor(this.wave)
        this.queue = this.buildQueue(this.wave)
        this._prevAlive = 0
        // Reset the boss gate for the new wave: with a boss every BOSS_EVERY
        // waves, the previous boss wave's flags must not leak into the next.
        this._bossArmed = false
        this._bossPending = false
        this._bossTimer = 0
        this._bossSpawned = false
        this.cb.onWaveStart?.(this.wave)
        this.audio?.playWave?.(this.wave)
      }
      return
    }
    // Boss finale: once the wave-5 queue is fully spawned, the wave is not
    // "cleared" while the boss is pending/spawned — the alive check below
    // counts the brute, and the pending timer holds the wave open.
    if (this._bossPending) {
      this._bossTimer -= dt
      if (this._bossTimer <= 0) {
        this._bossPending = false
        this._bossSpawned = true
        this.cb.spawnZombie('brute', BOSS_POINT.x, BOSS_POINT.z)
        this.cb.onBossSpawn?.(this.wave)
        this.audio?.playBoss?.()
      }
      return
    }
    // Per-frame: count alive zombies without allocating; the spawn gate below
    // compares this against the wave cap (capFor(wave), ≤ 16, under the 24 budget).
    let alive = 0
    const zs = game.zombies
    for (let i = 0; i < zs.length; i++) if (!zs[i].isDead) alive++
    if (alive < this._prevAlive) this.killed += this._prevAlive - alive
    // killed can never exceed spawned: a kill only exists once its zombie was
    // spawned. (Debug paths that kill before the spawn lands must not inflate
    // the counter past the queue, or `remaining` would read negative.)
    if (this.killed > this.spawned) this.killed = this.spawned
    this._prevAlive = alive
    if (this.spawned > 0 && alive === 0) {
      // Every live zombie is dead; discard the unspawned remainder.
      // Checked BEFORE spawning so a same-tick spawn cannot mask the clear.
      if (isBossWave(this.wave) && this.spawned >= this.total && !this._bossSpawned) {
        // A boss wave finished its whole queue and every zombie is down: hold
        // the wave open for a short dramatic beat, then stomp in the boss.
        this._bossPending = true
        this._bossTimer = BOSS_DELAY
        this.cb.onBossIncoming?.(this.wave)
        this.audio?.playBossIncoming?.()
        return
      }
      // A debug forceClear (or any kill-all path) on a boss wave skips the boss
      // entirely: spawned === total and the boss is never armed, so jump
      // straight to the next wave instead of holding the wave open forever.
      if (isBossWave(this.wave) && !this._bossArmed) {
        this.cb.onWaveCleared?.(this.wave)
        this.intermission = intermissionFor(this.wave, false)
        return
      }
      this.cb.onWaveCleared?.(this.wave)
      this.intermission = intermissionFor(this.wave, this._bossSpawned)
      return
    }
    if (this.spawned < this.total && alive < this.cap) {
      this.timer -= dt
      if (this.timer <= 0) {
        const q = this.queue[this.spawned]
        this.cb.spawnZombie(q.type, q.x, q.z)
        this.spawned++
        if (isBossWave(this.wave) && this.spawned >= this.total) this._bossArmed = true
        this.timer = spawnIntervalFor(this.wave)
      }
    }
  }

  /** Debug: kill every live zombie and discard the unspawned remainder. */
  forceClear(game) {
    // Count alive zombies without allocating (debug clear check).
    let alive = 0
    const zs = game.zombies
    for (let i = 0; i < zs.length; i++) if (!zs[i].isDead) alive++
    if (alive === 0 && this.spawned === 0) return
    for (const z of game.zombies) {
      if (!z.isDead) z.damage(z.maxHealth + 10)
    }
    this.killed += alive
    this._prevAlive = 0
    this.spawned = this.total
    // A forced clear on wave 5 must not stall the run behind the boss gate:
    // debug clears jump straight to the next wave. Only wave 5's own clear
    // consumes the boss — clearing an earlier wave must leave the finale
    // intact so the run still reaches its boss.
    this._bossPending = false
    if (isBossWave(this.wave)) this._bossSpawned = true
    this.intermission = intermissionFor(this.wave, this._bossSpawned)
  }
}
