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

const SPAWN_INTERVAL = 0.7 // seconds between spawns
const INTERMISSION = 3.0   // seconds between waves

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
  get cap() { return Math.min(8 + this.wave, 18) }
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
    for (let i = 0; i < total; i++) {
      if (wave < 3 && i % 5 === 0) types.push('shambler')
      else if (wave === 3 && i % 2 === 1) types.push('screamer')
      else if (wave > 3 && i % 5 === 0) types.push('shambler')
      else if (wave > 3 && i % 2 === 1) types.push('screamer')
      else types.push('walker')
    }
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
        this.timer = 0
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
    // compares this against the wave cap (min(8 + wave, 18), under the 24 budget).
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
        this.intermission = INTERMISSION
        return
      }
      this.cb.onWaveCleared?.(this.wave)
      this.intermission = INTERMISSION
      return
    }
    if (this.spawned < this.total && alive < this.cap) {
      this.timer -= dt
      if (this.timer <= 0) {
        const q = this.queue[this.spawned]
        this.cb.spawnZombie(q.type, q.x, q.z)
        this.spawned++
        if (isBossWave(this.wave) && this.spawned >= this.total) this._bossArmed = true
        this.timer = SPAWN_INTERVAL
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
    this.intermission = INTERMISSION
  }
}
