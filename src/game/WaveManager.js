// WaveManager — deterministic wave scheduler for zombie spawns.
//
// Owns wave progression: queue composition (type + spawn point), spawn
// cadence (0.7 s), concurrent-cap throttling, kill counting, and wave
// clear detection. All data is deterministic — no Math.random.
//
// Clear fires on `spawned > 0 && alive === 0`, i.e. every *alive* zombie
// is dead; unspawned queue remainder is discarded (the debug
// forceWaveClear / killAllZombies paths depend on this).

const SPAWN_INTERVAL = 0.7 // seconds between spawns
const INTERMISSION = 3.0   // seconds between waves

export class WaveManager {
  /**
   * @param scene       THREE.Scene (spawn callback builds entities)
   * @param spawnPoints city spawn points [{x, z}, ...]
   * @param collision   CollisionWorld (unused here; contract symmetry)
   * @param audio       audio bank or null (headless); calls null-guarded
   * @param callbacks   { onWaveStart(w), onWaveCleared(w), spawnZombie(type, x, z) }
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
  }

  get total() { return 5 + 3 * this.wave }
  get cap() { return Math.min(8 + this.wave, 18) }
  get remaining() { return this.total - this.killed }

  /** Start (or restart) wave 1. */
  reset() {
    this.wave = 1
    this.spawned = 0
    this.killed = 0
    this.timer = 0
    this.intermission = 0
    this._prevAlive = 0
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
        this.cb.onWaveStart?.(this.wave)
        this.audio?.playWave?.(this.wave)
      }
      return
    }
    const alive = game.zombies.filter(z => !z.isDead).length
    if (alive < this._prevAlive) this.killed += this._prevAlive - alive
    this._prevAlive = alive
    if (this.spawned > 0 && alive === 0) {
      // Every live zombie is dead; discard the unspawned remainder.
      // Checked BEFORE spawning so a same-tick spawn cannot mask the clear.
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
        this.timer = SPAWN_INTERVAL
      }
    }
  }

  /** Debug: kill every live zombie and discard the unspawned remainder. */
  forceClear(game) {
    const alive = game.zombies.filter(z => !z.isDead).length
    if (alive === 0 && this.spawned === 0) return
    for (const z of game.zombies) {
      if (!z.isDead) z.damage(z.maxHealth + 10)
    }
    this.killed += alive
    this._prevAlive = 0
    this.spawned = this.total
    this.intermission = INTERMISSION
  }
}
