import * as THREE from 'three'
import { CollisionWorld } from '../game/CollisionWorld.js'
import { City } from '../world/City.js'
import { Player } from '../game/Player.js'
import { WeaponBank } from '../game/WeaponBank.js'
import { AmmoDrops, SHELLS_PER_DROP, BULLETS_PER_DROP, BATTERY_RESTORE } from '../game/AmmoDrops.js'
import { Zombie, ATTACK_RANGE, AIR_CLEAR, DIFFICULTY } from '../game/Zombie.js'
import { WaveManager } from '../game/WaveManager.js'
import { updateWorld, nearestAlivePlayer } from '../game/WorldCore.js'

/**
 * Match — Phase 0 of MULTIPLAYER_PLAN.md (§4.1, §9): the server-side
 * authoritative room. It owns up to 8 players, the shared city/collision,
 * the zombie waves, ammo drops, and per-player kill/score tables, and it
 * advances the whole world through the SAME core the single-player Game uses
 * (WorldCore.updateWorld). It runs entirely headless: no DOM, no audio, no
 * rendering, no Math.random.
 *
 * A Match is the minimal stand-in for the future server room + socket layer
 * (Phase 1). In Phase 1, `step(dt)` is called at 20 Hz by the tick loop and
 * `snapshot()` feeds the 10 Hz snapshot broadcast; scripted input here
 * corresponds to per-tick input commands arriving from clients.
 *
 * Kill attribution: each player's WeaponBank carries `owner = <player id>`,
 * so weapon hits record `zombie.lastDamager`; the core reports kills via
 * ws.onKill and Match credits the killer (null → 'unknown', e.g. debug kills).
 */

export const TICK = 0.05 // 20 Hz server tick (plan §5.1)

// Match-flow defaults (plan §12 suggested defaults, resolved):
const RESPAWN_DELAY = 3.0 // seconds a dead player waits before respawning (§12.1)
const DISCONNECT_GRACE = 5.0 // seconds a dropped slot is held before freeing (§7)
const BOSS_WAVE = 5 // WaveManager's final wave; clearing it ends the match
const MATCH_TIME_CAP = 900 // 15 min hard cap so a stalled room still ends (§12.2)

const SPAWN = { x: 0, y: 1.7, z: 12 } // same shared spawn as the single-player Game
// Per-kill points, mirroring Score.pointsFor (walker 10, shambler 15,
// screamer 25, brute 150, plus 50 × wave).
const KILL_VALUES = { walker: 10, shambler: 15, screamer: 25, brute: 150 }
const WAVE_BONUS = 50

/** Plain input data object, same shape as Game's (the server ignores
 *  pause/flashlight, which are client-only in Phase 0). */
function freshInputState() {
  return {
    forward: false, back: false, left: false, right: false, sprint: false,
    turnX: 0, turnY: 0, fire: false, reload: false, jump: false,
    flashlight: false, pause: false,
    switch1: false, switch2: false, switch3: false, switch4: false
  }
}

export class Match {
  /**
   * @param {object} opts
   * @param {Array<{id: string, x?: number, z?: number}>} [opts.players] initial roster
   * @param {number} [opts.playersCap] max players (default 8)
   * @param {THREE.Scene} [opts.scene] external scene to build into (tests may share one)
   */
  constructor(opts = {}) {
    this.playersCap = opts.playersCap ?? 8
    // Difficulty preset (see DIFFICULTY in Zombie.js); 'normal' is the
    // default. A future lobby/room message can select 'frenzy'.
    this.difficulty = DIFFICULTY[opts.difficulty] ? opts.difficulty : 'normal'
    this.scene = opts.scene || new THREE.Scene()
    this.tick = 0
    this.time = 0
    this.events = [] // pending events, drained by snapshot()
    this._zombieSeq = 0

    // Shared city: identical AABBs and spawn points as the client's city.
    // Headless env — no texture drawing (the server never renders).
    this.collision = new CollisionWorld(180, 180)
    this.collision.clear()
    this.city = new City(this.scene, this.collision, { canvasFactory: () => null })
    this.spawnPoints = this.city.getSpawnPoints()

    this.players = new Map() // id -> slot { id, player, weapon, inputState }
    this.zombies = []
    this.kills = new Map() // id ('unknown' if unattributed) -> count
    this.score = new Map() // id -> points
    this.audio = null      // the server never renders or plays audio

    // Match flow (Phase 3): respawn timers, disconnect grace, end state.
    this._respawnAt = new Map() // id -> time the dead player respawns
    this._ended = false
    this._endReason = null // 'waves' | 'timecap' | 'alldead'
    this.matchTimeCap = opts.matchTimeCap ?? MATCH_TIME_CAP

    this.drops = new AmmoDrops(this.scene, null)
    this.wave = new WaveManager(this.scene, this.spawnPoints, this.collision, null, {
      onWaveStart: (w) => this.events.push({ k: 'waveStart', wave: w }),
      onWaveCleared: (w) => this.events.push({ k: 'waveCleared', wave: w }),
      spawnZombie: (type, x, z) => this.spawnZombie(type, x, z),
      onBossIncoming: (w) => this.events.push({ k: 'bossIncoming', wave: w }),
      onBossSpawn: (w) => this.events.push({ k: 'bossSpawn', wave: w })
    })

    // Authoritative core state (WorldCore.updateWorld). ws.zombies is
    // this.zombies itself, so the core's corpse removal and the wave spawner
    // operate on the live list.
    this.ws = {
      players: [],
      zombies: this.zombies,
      collision: this.collision,
      wave: this.wave,
      drops: this.drops,
      audio: this.audio,
      onKill: (z, by) => this._onKill(z, by),
      onDropSpawn: (x, z) => this.events.push({ k: 'drop', x, z }),
      onDropPickup: (d, p) => this._onDropPickup(d, p)
    }

    for (const p of opts.players || []) this.addPlayer(p.id, p.x, p.z)
    this.wave.reset() // start wave 1 (fires the waveStart event)
  }

  /** Add a player at (x, z) (default: shared spawn). Returns the slot or null. */
  addPlayer(id, x = SPAWN.x, z = SPAWN.z) {
    if (this.players.has(id) || this.players.size >= this.playersCap) return null
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 400)
    const inputState = freshInputState()
    const player = new Player(camera, inputState, this.collision, null)
    player.position.set(x, SPAWN.y, z)
    player.camera.position.set(x, SPAWN.y, z)
    const weapon = new WeaponBank(this.scene, camera, this.collision, null)
    weapon.owner = id // kill attribution
    weapon.getZombies = () => this.zombies
    weapon.inputState = inputState
    weapon.onDecapitate = (zz, dir) => {
      zz._headOff = true // snapshot mirrors this so remote bodies lose the head
      this.events.push({
        k: 'decapitate', victim: zz._matchId, by: id,
        dir: dir ? { x: dir.x, z: dir.z } : null
      })
    }
    player.setOnDeath(() => {
      this.events.push({ k: 'death', victim: id, by: null })
      // Respawn-on-delay (plan §12.1 default): schedule a respawn unless the
      // match already ended.
      if (!this._ended) this._respawnAt.set(id, this.time + RESPAWN_DELAY)
    })
    // Player-hit feedback hook (Game wires the HUD to it; the match records events).
    player._onDamaged = (n, source) => this.events.push({
      k: 'hit', victim: id, dmg: n, by: source && source.type ? source.type : null
    })
    const slot = { id, player, weapon, inputState, flashlight: null }
    this.players.set(id, slot)
    this.ws.players = Array.from(this.players.values())
    this.kills.set(id, 0)
    this.score.set(id, 0)
    return slot
  }

  /** Remove a player (disconnect). Detaches their view models; the slot,
   *  kill/score history stay recorded. */
  removePlayer(id) {
    const slot = this.players.get(id)
    if (!slot) return false
    this.players.delete(id)
    slot.weapon.dispose()
    slot.player.dispose()
    this.ws.players = Array.from(this.players.values())
    return true
  }

  getPlayer(id) { return this.players.get(id) || null }

  /** Spawn a zombie (the WaveManager calls this; tests may too). */
  spawnZombie(type, x, z, wave = this.wave ? this.wave.wave : 1) {
    const zombie = new Zombie(this.scene, type, x, z, wave, this.difficulty)
    zombie._matchId = ++this._zombieSeq
    this.zombies.push(zombie)
    return zombie
  }

  /** One authoritative simulation step (the plan's 20 Hz tick). Scripted
   *  input = write the slot's inputState fields before calling this. */
  step(dt = TICK) {
    const d = Math.min(Math.max(dt, 0), 0.1)
    this.tick++
    this.time += d
    updateWorld(d, this.ws)
    this._flow(d)
    return d
  }

  /** Match-flow pass (Phase 3): respawn dead players after the delay, detect
   *  match end (all waves cleared / time cap / all players dead and none
   *  pending respawn), and emit the end event once. */
  _flow(dt) {
    if (this._ended) return
    // Respawn dead players whose timer has elapsed.
    for (const [id, at] of this._respawnAt) {
      if (this.time >= at) {
        const slot = this.players.get(id)
        if (slot) {
          slot.player.reset()
          slot.weapon.reset?.()
          this.events.push({ k: 'respawn', victim: id })
        }
        this._respawnAt.delete(id)
      }
    }
    // End conditions.
    if (this.wave && this.wave.wave >= BOSS_WAVE && this.wave.remaining === 0 && this.zombies.filter((z) => !z.isDead).length === 0) {
      this._end('waves')
    } else if (this.time >= this.matchTimeCap) {
      this._end('timecap')
    } else if (this.players.size > 0 && this._allDeadNoRespawn()) {
      this._end('alldead')
    }
  }

  _allDeadNoRespawn() {
    for (const slot of this.players.values()) {
      if (!slot.player.isDead) return false
      if (this._respawnAt.has(slot.id)) return false // pending respawn -> not over
    }
    return this.players.size > 0
  }

  _end(reason) {
    if (this._ended) return
    this._ended = true
    this._endReason = reason
    this.events.push({ k: 'matchEnd', reason, scoreboard: this.scoreboard() })
  }

  /** Final per-player scoreboard (plan §7): score + kills, sorted desc. */
  scoreboard() {
    const rows = []
    for (const [id, sc] of this.score) {
      rows.push({ id, score: sc, kills: this.kills.get(id) || 0 })
    }
    rows.sort((a, b) => b.score - a.score)
    return rows
  }

  get ended() { return this._ended }
  get endReason() { return this._endReason }

  _onKill(z, by) {
    const key = by !== null ? by : 'unknown'
    this.kills.set(key, (this.kills.get(key) || 0) + 1)
    const wave = this.wave ? this.wave.wave : 1
    this.score.set(key, (this.score.get(key) || 0) + (KILL_VALUES[z.type] || 0) + WAVE_BONUS * wave)
    this.events.push({ k: 'kill', victim: z._matchId, by: by !== null ? by : null, type: z.type })
  }

  /** Authoritative hit from a client: a client-side shot confirmed a hit on the
   *  zombie with this match id. Applies the damage on the server so the kill is
   *  attributed + counted even when the server-side aim ray missed (the client
   *  has the authoritative crosshair). Ignores unknown/dead ids. */
  applyHit(id, dmg, head, by) {
    if (!(dmg > 0)) return
    for (const z of this.zombies) {
      if (z._matchId === id && !z.isDead) {
        z.damage(dmg, null, by !== null && by !== undefined ? by : null, !!head)
        return
      }
    }
  }

  _onDropPickup(d, p) {
    let slot = null
    for (const s of this.players.values()) {
      if (s.player === p) { slot = s; break }
    }
    if (!slot) return
    if (d && d.kind === 'battery') {
      // Batteries recharge the player's flashlight when the client owns one
      // (the server-side slot keeps a nullable handle; headless stays null).
      if (slot.flashlight) slot.flashlight.recharge(BATTERY_RESTORE)
      this.events.push({ k: 'pickup', pid: slot.id, x: d.x, z: d.z, battery: true })
      return
    }
    const bullets = d && d.kind === 'bullets'
    const amount = bullets ? BULLETS_PER_DROP : SHELLS_PER_DROP
    if (bullets) slot.weapon.pistol.reserve += amount
    else slot.weapon.shotgun.reserve += amount
    this.events.push({ k: 'pickup', pid: slot.id, x: d.x, z: d.z, bullets, amount })
  }

  /** Zombie state as the core will play it next tick:
   *  dead | stagger | attack | chase | idle (no alive player). */
  _zombieState(z) {
    if (z.isDead) return 'dead'
    if (z._kbT > 0) return 'stagger'
    const target = nearestAlivePlayer(z.position.x, z.position.z, this.ws.players)
    if (!target) return 'idle'
    const dx = target.position.x - z.position.x
    const dz = target.position.z - z.position.z
    if (Math.hypot(dx, dz) <= ATTACK_RANGE && Math.abs(target.position.y - 1.2) <= AIR_CLEAR) return 'attack'
    return 'chase'
  }

  /**
   * Serializable state snapshot (plan §5.2). Events emitted since the
   * previous snapshot are drained and included.
   */
  snapshot() {
    const players = []
    for (const slot of this.players.values()) {
      const p = slot.player
      const w = slot.weapon.current
      players.push({
        id: slot.id,
        x: p.position.x, y: p.position.y, z: p.position.z,
        yaw: p.yaw, pitch: p.pitch,
        health: p.health, stamina: Math.round(p.stamina),
        weapon: w.name, ammo: w.ammo, reserve: w.reserve,
        dead: p.isDead
      })
    }
    const zombies = []
    for (const z of this.zombies) {
      zombies.push({
        id: z._matchId, type: z.type,
        x: z.position.x, z: z.position.z,
        health: z.health,
        state: this._zombieState(z),
        facing: z.isDead ? null : z.group.rotation.y,
        limbs: { arms: z.armsLost || 0, legs: z.legsLost || 0, head: z._headOff ? 1 : 0 }
      })
    }
    const events = this.events
    this.events = []
    return {
      tick: this.tick, time: this.time,
      wave: this.wave ? this.wave.wave : 0,
      remaining: this.wave ? this.wave.remaining : 0,
      players, zombies,
      kills: Object.fromEntries(this.kills),
      score: Object.fromEntries(this.score),
      drops: this.drops._drops.map(d => ({ x: d.x, z: d.z, t: d.t })),
      events
    }
  }
}
