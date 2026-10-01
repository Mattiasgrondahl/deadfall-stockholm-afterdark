import * as THREE from 'three'
import { CollisionWorld } from '../game/CollisionWorld.js'
import { City } from '../world/City.js'
import { Player } from '../game/Player.js'
import { WeaponBank } from '../game/WeaponBank.js'
import { AmmoDrops, SHELLS_PER_DROP, BULLETS_PER_DROP, BATTERY_RESTORE } from '../game/AmmoDrops.js'
import { Zombie, ATTACK_RANGE, AIR_CLEAR, DIFFICULTY } from '../game/Zombie.js'
import { WaveManager } from '../game/WaveManager.js'
import { updateWorld, nearestAlivePlayer } from '../game/WorldCore.js'
import { DroppedLimbPool } from '../game/DroppedLimbPool.js'
import { FlagState, TEAMS as CTF_TEAMS } from '../game/Flag.js'
import { CityCTF, CTF_BASES } from '../world/CityCTF.js'
import { SwarmDirector } from '../game/SwarmDirector.js'

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
// v15: a co-op match ends once the team has killed this many zombies in total;
// the winner is then the player with the highest score.
const KILL_TARGET = 72

const SPAWN = { x: 0, y: 1.7, z: 12 } // same shared spawn as the single-player Game
// Per-kill points, mirroring Score.pointsFor (walker 10, shambler 15,
// screamer 25, brute 150, plus 50 × wave).
const KILL_VALUES = { walker: 10, shambler: 15, screamer: 25, brute: 150 }
const WAVE_BONUS = 50
// Friendly-fire fraction: a shot that lands on a teammate deals this fraction of
// its listed damage. <1 so teammates can shoot each other without instantly
// deleting each other, but enough that standing in a line of fire is punished.
const FRIENDLY_FIRE = 0.35

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
    // CTF: 'survival' (default) is the shared wave-co-op room; 'ctf' is the
    // two-team Capture-the-Flag match on the bespoke Lovisedal/Kragstalund map.
    this.mode = opts.mode === 'ctf' ? 'ctf' : 'survival'
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

    // CTF: swap in the bespoke two-base arena + the authoritative flag state.
    // The map exposes the same surface (getSpawnPoints/bases) so the rest of
    // the room is unchanged. Teams are assigned round-robin on join.
    this.flag = null
    this._teamTurn = 0
    if (this.mode === 'ctf') {
      this.collision = new CollisionWorld(220, 220)
      this.collision.clear()
      this.city = new CityCTF(this.scene, this.collision, { canvasFactory: () => null })
      this.spawnPoints = this.city.getSpawnPoints()
      this.flag = new FlagState({ bases: this.city.bases })
    }

    this.players = new Map() // id -> slot { id, player, weapon, inputState }
    this.zombies = []
    this.kills = new Map() // id ('unknown' if unattributed) -> count
    this.score = new Map() // id -> points
    // v15: per-player end-screen stats — deaths, headshot kills, and players
    // killed by friendly fire. Keyed by id like kills/score.
    this.deaths = new Map() // id -> times this player died
    this.headshots = new Map() // id -> headshot zombie kills
    this.playerKills = new Map() // id -> teammates killed (friendly fire)
    this.audio = null      // the server never renders or plays audio

    // Match flow (Phase 3): respawn timers, disconnect grace, end state.
    this._respawnAt = new Map() // id -> time the dead player respawns
    this._graceAt = new Map() // id -> time a disconnected slot is freed (v12 §7)
    this._ended = false
    this._endReason = null // 'waves' | 'timecap' | 'alldead'
    this.matchTimeCap = opts.matchTimeCap ?? MATCH_TIME_CAP
    // v15: total team kills that end a co-op match (winner = highest score).
    this.killTarget = opts.killTarget ?? KILL_TARGET

    this.drops = new AmmoDrops(this.scene, null)
    // v3 T1: the authoritative match owns a shared dropped-limb pool so the
    // server-side zombies run the same dismemberment chain as single-player.
    // The server never renders, so the pool's meshes are inert here — it
    // exists to keep the code path identical (and to bound limb meshes).
    this.limbs = new DroppedLimbPool(this.scene)
    // Survival uses discrete waves; CTF drives a continuous neutral swarm instead.
    this.swarm = null
    if (this.mode === 'ctf') {
      this.wave = null
      this.swarm = new SwarmDirector({
        spawnZombie: (type, x, z) => this.spawnZombie(type, x, z),
        players: () => Array.from(this.players.values()).filter((s) => !s.disconnected),
        flag: this.flag,
        liveCount: () => this.zombies.filter((z) => !z.isDead).length,
        bases: this.city.bases
      })
      this.swarm.start()
    } else {
      this.wave = new WaveManager(this.scene, this.spawnPoints, this.collision, null, {
        onWaveStart: (w) => this.events.push({ k: 'waveStart', wave: w }),
        onWaveCleared: (w) => this.events.push({ k: 'waveCleared', wave: w }),
        spawnZombie: (type, x, z) => this.spawnZombie(type, x, z),
        onBossIncoming: (w) => this.events.push({ k: 'bossIncoming', wave: w }),
        onBossSpawn: (w) => this.events.push({ k: 'bossSpawn', wave: w })
      })
    }

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
    if (this.wave) this.wave.reset() // start wave 1 (fires the waveStart event)
  }

  /** Add a player at (x, z) (default: shared spawn). Returns the slot or null. */
  addPlayer(id, x = SPAWN.x, z = SPAWN.z, name = '', team = null) {
    // v12: a reconnect within the grace window reclaims the held slot (same id,
    // position, score, kills) rather than being rejected as a duplicate. The
    // cap counts CONNECTED players only — a graced slot is not a live socket,
    // so a full room plus a dropped player still admits a new joiner.
    if (this.players.has(id)) {
      const held = this.players.get(id)
      return held.disconnected ? this._reclaim(id) : null
    }
    if (this._connectedCount() >= this.playersCap) return null
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
    // v25: a confirmed shot (or melee swing) starts on this player. Broadcast a
    // `shoot` event so teammates render a muzzle flash / swing on the remote
    // avatar. Carries the weapon name so the flash reads correctly per weapon.
    weapon.onFire = (wname) => this.events.push({ k: 'shoot', by: id, weapon: wname })
    player.setOnDeath(() => {
      // v15: record the death on the victim's end-screen stats.
      this.deaths.set(id, (this.deaths.get(id) || 0) + 1)
      this.events.push({ k: 'death', victim: id, by: null })
      // Respawn-on-delay (plan §12.1 default): schedule a respawn unless the
      // match already ended.
      if (!this._ended) this._respawnAt.set(id, this.time + RESPAWN_DELAY)
    })
    // Player-hit feedback hook (Game wires the HUD to it; the match records events).
    player._onDamaged = (n, source) => this.events.push({
      k: 'hit', victim: id, dmg: n, by: source && source.type ? source.type : null
    })
    const slot = { id, player, weapon, inputState, flashlight: null, name: String(name || '').slice(0, 24) }
    // CTF: assign a team. An explicit team wins; otherwise round-robin across
    // the two teams so a lobby splits players evenly. Survival mode leaves team
    // null (single shared team).
    if (this.mode === 'ctf') {
      slot.team = team === 'lovis' || team === 'krag' ? team : CTF_TEAMS[this._teamTurn++ % CTF_TEAMS.length]
      // CTF: spawn at the player's own base flag (not the shared survival spawn)
      // so each side starts beside their own pedestal.
      const home = this.city && this.city.bases ? this.city.bases[slot.team] : null
      if (home) {
        player.position.set(home.x, SPAWN.y, home.z)
        player.camera.position.set(home.x, SPAWN.y, home.z)
      }
    } else {
      slot.team = team || null
    }
    this.players.set(id, slot)
    this.ws.players = Array.from(this.players.values())
    this.kills.set(id, 0)
    this.score.set(id, 0)
    this.deaths.set(id, 0)
    this.headshots.set(id, 0)
    this.playerKills.set(id, 0)
    return slot
  }

  /** Remove a player (disconnect). v12: hold the slot for a grace window
   *  (DISCONNECT_GRACE) instead of freeing it immediately, so a brief drop or a
   *  page refresh can reconnect and reclaim the same slot (same id, position,
   *  score). The slot is flagged disconnected so the sim skips it; `_flow` frees
   *  it once the grace elapses. */
  removePlayer(id) {
    const slot = this.players.get(id)
    if (!slot) return false
    slot.disconnected = true
    this._graceAt.set(id, this.time + DISCONNECT_GRACE)
    this.ws.players = Array.from(this.players.values()).filter((s) => !s.disconnected)
    return true
  }

  /** Reclaim a disconnected slot during its grace window (reconnect). */
  _reclaim(id) {
    const slot = this.players.get(id)
    if (!slot || !slot.disconnected) return null
    slot.disconnected = false
    this._graceAt.delete(id)
    this.ws.players = Array.from(this.players.values()).filter((s) => !s.disconnected)
    return slot
  }

  /** Count of connected (non-graced) players — the number the 8-slot cap
   *  applies to (v12: held slots do not consume a slot). */
  _connectedCount() {
    let n = 0
    for (const slot of this.players.values()) if (!slot.disconnected) n++
    return n
  }

  getPlayer(id) { return this.players.get(id) || null }

  /** Spawn a zombie (the WaveManager calls this; tests may too). */
  spawnZombie(type, x, z, wave = this.wave ? this.wave.wave : 1) {
    // v3 T1: the server-side zombies run the same hit-counted dismemberment
    // chain as single-player (clients report hits; the server never fires
    // weapons itself). HP follows the difficulty table exactly — the chain
    // never touches it.
    const zombie = new Zombie(this.scene, type, x, z, wave, this.difficulty)
    // v3 T1: the shared limb pool, so the server-side chain drops limbs too.
    if (this.limbs) zombie.drops = this.limbs
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
    if (this.limbs) this.limbs.update(d) // v3 T1: tumble dropped limbs on the server too
    this._flow(d)
    return d
  }

  /** Match-flow pass (Phase 3): respawn dead players after the delay, detect
   *  match end (all waves cleared / time cap / all players dead and none
   *  pending respawn), and emit the end event once. */
  _flow(dt) {
    if (this._ended) return
    // CTF: drive the flag state machine from live player positions, then check
    // the win condition (first team to WIN_SCORE captures).
    if (this.mode === 'ctf' && this.flag) {
      if (this.swarm) this.swarm.update(dt)
      this._processFlags(dt)
      if (this.flag.winner) { this._end('ctf'); return }
    }
    // Respawn dead players whose timer has elapsed.
    for (const [id, at] of this._respawnAt) {
      if (this.time >= at) {
        const slot = this.players.get(id)
        if (slot) {
          slot.player.reset()
          slot.weapon.reset?.()
          // CTF: respawn at the player's own base flag (not the shared survival
          // spawn), so a killed carrier comes back at their side's pedestal.
          if (this.mode === 'ctf' && this.city && this.city.bases && slot.team) {
            const home = this.city.bases[slot.team]
            if (home) {
              slot.player.position.set(home.x, SPAWN.y, home.z)
              slot.player.camera.position.set(home.x, SPAWN.y, home.z)
            }
          }
          this.events.push({ k: 'respawn', victim: id })
        }
        this._respawnAt.delete(id)
      }
    }
    // v12: free disconnected slots whose grace window has elapsed (the player
    // did not reconnect in time). Their view models are disposed here.
    for (const [id, at] of this._graceAt) {
      if (this.time >= at) {
        const slot = this.players.get(id)
        if (slot) {
          slot.weapon.dispose()
          slot.player.dispose()
          this.players.delete(id)
        }
        this._graceAt.delete(id)
        this.ws.players = Array.from(this.players.values()).filter((s) => !s.disconnected)
      }
    }
    // End conditions.
    if (this.mode === 'ctf') {
      // CTF ends on a capture-win (handled above) or the time cap; the wave /
      // kill-target survival conditions do not apply.
      // v37 R1: if the clock runs out with the teams TIED, do not end on a
      // meaningless draw — enter sudden-death and keep playing until the next
      // capture decides it (flag.winner is set by tryCapture at WIN_SCORE, but a
      // tie at the cap means neither reached WIN_SCORE, so the next capture wins).
      if (this.time >= this.matchTimeCap) {
        const s = this.flag ? this.flag.scores : { lovis: 0, krag: 0 }
        if (s.lovis === s.krag) {
          if (!this._suddenDeath) {
            this._suddenDeath = true
            if (this.flag) this.flag.suddenDeath = true
            this.events.push({ k: 'suddenDeath' })
          }
        } else {
          this._end('timecap')
        }
      }
      return
    }
    if (this.wave && this.wave.wave >= BOSS_WAVE && this.wave.remaining === 0 && this.zombies.filter((z) => !z.isDead).length === 0) {
      this._end('waves')
    } else if (this._totalKills() >= this.killTarget) {
      // v15: the match ends once the team has killed KILL_TARGET zombies in
      // total; the winner is the highest-scoring player (see scoreboard()).
      this._end('killtarget')
    } else if (this.time >= this.matchTimeCap) {
      this._end('timecap')
    } else if (this._connectedCount() > 0 && this._allDeadNoRespawn()) {
      this._end('alldead')
    }
  }

  _allDeadNoRespawn() {
    // v12: only connected players count. A slot still inside its disconnect
    // grace window is neither "alive" nor gone — it may reconnect — so it must
    // not force an all-dead end. The match ends all-dead only when every
    // connected player is dead with none pending respawn.
    let connected = 0
    for (const slot of this.players.values()) {
      if (slot.disconnected) continue
      connected++
      if (!slot.player.isDead) return false
      if (this._respawnAt.has(slot.id)) return false // pending respawn -> not over
    }
    return connected > 0
  }

  /** CTF: advance the flag state from live player positions each tick.
   *  - A carrier who is HIT this tick (any damage, not just death) drops the
   *    flag at their spot — the objective is "if a zombie hits them the flag is
   *    dropped".
   *  - A carrier reaching their OWN base with the enemy flag scores a capture.
   *  - A live player near a pickable flag (enemy flag at base, or any dropped
   *    flag) claims it.
   *  Emits flagDrop / flagCapture / flagPickup events for the snapshot. */
  _processFlags(dt) {
    const flag = this.flag
    if (!flag) return
    // Drop carried flags whose carrier was HIT this tick (any damage, not just
    // death) — the objective is "if a zombie hits them the flag is dropped".
    // Track each slot's health across ticks and drop on any decrease; a carrier
    // who died (health 0) is covered by the same decrease. dropFlag is
    // idempotent for non-carriers.
    if (!this._prevHealth) this._prevHealth = new Map()
    const droppedThisTick = new Set()
    for (const slot of this.players.values()) {
      if (slot.disconnected) continue
      const p = slot.player
      const prev = this._prevHealth.get(slot.id)
      this._prevHealth.set(slot.id, p.health)
      const carrying = flag.isCarrying(slot.id)
      if (!carrying) continue
      const hit = (prev != null && p.health < prev) || p.isDead
      if (hit && flag.dropFlag(slot.id, p.position.x, p.position.z)) {
        this.events.push({ k: 'flagDrop', team: slot.team, x: p.position.x, z: p.position.z })
        droppedThisTick.add(slot.id)
      }
    }
    // Pickups + captures from live players.
    for (const slot of this.players.values()) {
      if (slot.disconnected) continue
      const p = slot.player
      if (p.isDead || !slot.team) continue
      const x = p.position.x, z = p.position.z
      // Capture first: a carrier reaching their own base scores and frees the
      // flag, so it must run before pickup (a fresh arrival could otherwise
      // re-grab the flag it just scored).
      if (flag.isCarrying(slot.id) && flag.tryCapture(slot.id, slot.team, x, z)) {
        this.events.push({ k: 'flagCapture', team: slot.team, scores: { ...flag.scores } })
        continue
      }
      // Skip pickup for a player who was just hit and dropped the flag this
      // tick — a one-frame grace so they don't instantly re-snatch the flag at
      // their own feet; they must step off and back on (or a teammate grab it).
      if (!flag.isCarrying(slot.id) && !droppedThisTick.has(slot.id) && flag.tryPickup(slot.id, slot.team, x, z, dt)) {
        this.events.push({ k: 'flagPickup', team: slot.team, by: slot.id })
      }
    }
  }

  _end(reason) {
    if (this._ended) return
    this._ended = true
    this._endReason = reason
    this.events.push({ k: 'matchEnd', reason, scoreboard: this.scoreboard() })
  }

  /** v15: total zombies killed by the whole team (sum of every player's kills).
   *  Unattributed ('unknown') kills count too, so the target is met regardless
   *  of attribution. */
  _totalKills() {
    let n = 0
    for (const k of this.kills.values()) n += k
    return n
  }

  /** Final per-player scoreboard (plan §7): score + kills, sorted desc.
   *  v12: rows carry the display name too (from the slot roster, including
   *  slots held in disconnect grace) so the co-op end screen can label players
   *  instead of raw ids.
   *  v15: rows also carry deaths, headshots, and player-kills for the end-game
   *  stats screen; the scoreboard is sorted by score desc so the first row is
   *  the winner (highest score). */
  scoreboard() {
    const names = new Map()
    for (const [id, slot] of this.players) names.set(id, slot.name || id)
    const rows = []
    for (const [id, sc] of this.score) {
      rows.push({
        id,
        name: names.get(id) || id,
        score: sc,
        kills: this.kills.get(id) || 0,
        deaths: this.deaths.get(id) || 0,
        headshots: this.headshots.get(id) || 0,
        playerKills: this.playerKills.get(id) || 0
      })
    }
    rows.sort((a, b) => b.score - a.score)
    return rows
  }

  get ended() { return this._ended }
  get endReason() { return this._endReason }

  _onKill(z, by) {
    const key = by !== null ? by : 'unknown'
    this.kills.set(key, (this.kills.get(key) || 0) + 1)
    // v15: count headshot kills toward the killer's end-screen stats.
    if (z.lastHitHead === true) this.headshots.set(key, (this.headshots.get(key) || 0) + 1)
    const wave = this.wave ? this.wave.wave : 1
    this.score.set(key, (this.score.get(key) || 0) + (KILL_VALUES[z.type] || 0) + WAVE_BONUS * wave)
    // v12: the head flag rides along so the co-op kill feed can mark headshots.
    // WorldCore fires onKill after Zombie.damage set lastHitHead on the killing
    // blow (applyHit forwards the client's head flag into it).
    this.events.push({ k: 'kill', victim: z._matchId, by: by !== null ? by : null, type: z.type, head: z.lastHitHead === true })
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

  /** Authoritative friendly-fire hit from a client: a client's shot landed on a
   *  TEAMMATE (victim is the victim's player id, `by` is the shooter's id). The
   *  client has the authoritative crosshair, so the server applies a reduced
   *  fraction of the weapon damage to the victim's player. A dead/unknown victim
   *  or a self-hit is ignored. The victim's death (if any) flows through the
   *  existing player.setOnDeath respawn path. */
  applyFF(victim, dmg, by) {
    if (!(dmg > 0) || !victim || victim === by) return
    const slot = this.players.get(victim)
    if (!slot || slot.disconnected) return
    const p = slot.player
    if (!p || p.isDead) return
    const applied = dmg * FRIENDLY_FIRE
    const wasDead = p.isDead
    p.damage(applied, null, by !== null && by !== undefined ? by : null, false)
    // v15: a friendly-fire hit that kills a teammate counts as a player kill for
    // the shooter (the victim's death itself is counted in setOnDeath).
    if (!wasDead && p.isDead && by !== null && by !== undefined) {
      this.playerKills.set(by, (this.playerKills.get(by) || 0) + 1)
    }
    this.events.push({ k: 'hit', victim, dmg: Math.round(applied), by: by !== null && by !== undefined ? by : null, ff: true })
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
      if (slot.disconnected) continue // v12: drop from the roster during grace; reclaim on reconnect
      const p = slot.player
      const w = slot.weapon.current
      players.push({
        id: slot.id,
        x: p.position.x, y: p.position.y, z: p.position.z,
        yaw: p.yaw, pitch: p.pitch,
        health: p.health, stamina: Math.round(p.stamina),
        weapon: w.name, ammo: w.ammo, reserve: w.reserve,
        dead: p.isDead, name: slot.name || '', team: slot.team || null
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
    const snap = {
      tick: this.tick, time: this.time,
      wave: this.wave ? this.wave.wave : 0,
      remaining: this.wave ? this.wave.remaining : 0,
      players, zombies,
      kills: Object.fromEntries(this.kills),
      score: Object.fromEntries(this.score),
      drops: this.drops._drops.map(d => ({ x: d.x, z: d.z, t: d.t })),
      events
    }
    // CTF: attach the flag state so clients render the pedestals + carrier +
    // scoreboard. Only present in ctf mode.
    if (this.mode === 'ctf' && this.flag) snap.ctf = this.flag.snapshot()
    return snap
  }
}
