// src/net/Multiplayer.js — Phase 5 of MULTIPLAYER_PLAN.md (§6): the browser
// client-side integration controller.
//
// It owns the network layer (NetClient) and the visual proxies for OTHER
// players (RemotePlayer) and remote zombies, driven entirely by the 10 Hz
// snapshots the server broadcasts. The local player stays first-person and is
// simulated by the Game; this module only renders everyone else and exposes a
// scoreboard/lobby view. It is DOM-free by default (an optional `document`
// enables the scoreboard DOM) so it is headless-testable: tests inject a fake
// socket + a fake document and assert the scene graph + scoreboard without a
// browser.
//
// Reversibility: everything it adds to the scene (RemotePlayer groups, zombie
// stubs) is tracked and removed in dispose(), so stopping multiplayer or the
// Game tears it all down cleanly.
import { RemotePlayer } from '../game/RemotePlayer.js'
import { NetClient } from './NetClient.js'
import { RemoteZombie } from './RemoteZombie.js'
import { makeFFProxy } from './FFProxy.js'

// A tiny primitive zombie silhouette used as the over-budget fallback body.
// Shared geometry/material so fallback boxes add only 1 mesh each.
import * as THREE from 'three'
const ZGEO = new THREE.BoxGeometry(0.6, 1.7, 0.4)
const ZMAT = new THREE.MeshStandardMaterial({ color: 0x5f6b4a, roughness: 0.95, emissive: 0x3a4530, emissiveIntensity: 0.18 })
// Per-type shotgun armor (mirrors Zombie.TABLE) so a fallback-box hit applies the
// same buckshot armor the full body would.
const SHOTGUN_ARMOR = { walker: 1, shambler: 1, screamer: 1, brute: 0.4 }
// Cap the number of full primitive remote bodies so a full wave stays inside the
// mesh budget AND the GPU draw-call budget on weak machines; overflow zombies
// use the cheap shared fallback box instead of a full PBR body. v4 co-op: raised
// 12 → 16 to cover the wave-3 roster (total 14) plus a couple of lingering dead,
// so the tail of a big wave shows real bodies instead of green boxes. Overflow
// beyond this still gets a box, and boxes are now hit-testable (see getTargets).
const MAX_REMOTE = 16

export class Multiplayer {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene
   * @param {object} [opts.env] { document } — optional, for the scoreboard DOM
   * @param {string} [opts.name] local display name
   * @param {string} [opts.room] room name
   * @param {typeof WebSocket} [opts.Socket] injectable WebSocket ctor (tests)
   * @param {string} [opts.url] ws url
   */
  constructor(opts = {}) {
    this.scene = opts.scene
    this.env = opts.env || {}
    this.doc = this.env.document || null
    this.net = new NetClient({
      url: opts.url, Socket: opts.Socket, name: opts.name, room: opts.room
    })
    this.players = new Map() // id -> RemotePlayer (excludes self)
    this.zombies = new Map() // matchId -> { mesh }
    this.lastSnap = null
    this.selfDead = false
    this.selfHealth = null
    this.selfStamina = null
    this.selfPos = null
    this._wasSelfDead = false
    // Co-op respawn hooks the Game wires up (no-ops until assigned).
    this.onSelfDeath = null
    this.onSelfRespawn = null
    // Friendly-fire / incoming-damage feedback: the server emits a `hit` event
    // when this client takes damage (zombie melee or a teammate's friendly fire).
    // The Game wires this to the same hit-flash/vignette + hit sound single-player
    // uses, so being attacked is actually felt in co-op instead of health silently
    // dropping. `n` is the damage applied this snapshot.
    this.onSelfHit = null
    // v12: match-end hook. The server emits a `matchEnd` event (wave-5 cleared /
    // time cap / all-dead) in a snapshot; Multiplayer surfaces it once so the
    // Game can stop the co-op run and show the final scoreboard.
    this.onMatchEnd = null
    this.matchEnded = false
    this.endReason = null
    this.finalScoreboard = null
    // v12: rolling kill feed (most-recent first) for the co-op scoreboard.
    this._killFeed = []
    this._onWelcome = (msg) => { this.pid = msg.pid }
    this._onSnap = (snap) => { this.lastSnap = snap; this._sync(snap) }
    this._onClose = () => { /* NetClient already flips its own connected flag */ }
    this.net.on('welcome', this._onWelcome)
    this.net.on('snap', this._onSnap)
    this.net.on('close', this._onClose)
    this.pid = null
    // Scoreboard DOM (browser only).
    this._sbEl = null
    if (this.doc) this._buildScoreboard()
  }

  get connected() { return this.net.connected }

  /** Build the lobby/scoreboard DOM panel (browser only). */
  _buildScoreboard() {
    const d = this.doc
    this._sbEl = d.createElement('div')
    this._sbEl.className = 'mp-scoreboard'
    this._sbEl.style.cssText = 'position:absolute;top:8px;right:8px;min-width:160px;' +
      'font:12px/1.4 monospace;color:#cfe3ff;background:rgba(10,14,22,0.6);' +
      'padding:6px 8px;border:1px solid rgba(120,150,200,0.3);display:none'
    if (d.body) d.body.appendChild(this._sbEl)
  }

  /** v12: append a kill to the rolling feed (most-recent first), capped short so
   *  the scoreboard stays readable. Names are resolved from the snapshot roster;
   *  an unknown killer id (a zombie kill with no player) reads as the victim
   *  "died". Headshots are flagged so the feed can mark them. */
  _pushKill(ev, snap) {
    if (!this.doc) return
    const names = {}
    for (const p of (snap && snap.players) || []) if (p && p.id) names[p.id] = p.name || p.id
    const victim = names[ev.victim] || 'PLAYER'
    // v12: the killer of a zombie kill is always the player the server credited
    // (`by` is a pid); the victim id is a zombie id that is never in the player
    // roster, so it reads as "<killer> ▸ <TYPE>". A 'death' event (player victim)
    // has no `by` and renders as "<victim> DIED".
    const killer = ev.by != null ? (names[ev.by] || 'YOU') : null
    const head = ev.head || ev.headshot || false
    const line = killer ? `${killer} ▸ ${victim}${head ? ' (HEAD)' : ''}` : `${victim} DIED`
    this._killFeed.unshift(line)
    if (this._killFeed.length > 5) this._killFeed.length = 5
  }

  /**
   * Apply one snapshot: reconcile the RemotePlayer + zombie maps against the
   * authoritative roster, and refresh the scoreboard DOM. Pure w.r.t. the scene
   * (adds/removes proxies only), so it is unit-testable with a fake socket.
   */
  _sync(snap) {
    if (!snap || !Array.isArray(snap.players)) return
    const seen = new Set()
    // Self state from the authoritative roster: dead flag + respawn events.
    let selfDead = false
    let selfHealth = null
    let selfStamina = null
    for (const p of snap.players) {
      // v9: the server is authoritative for the self player's health/stamina too.
      // The client runs an empty local horde (the server owns the zombies), so
      // nothing damages the local player on the client — without adopting the
      // snapshot health the HUD would always read full and death would never
      // register visually. Capture them here; Game applies them to the player.
      if (p.id === this.pid) {
        selfDead = !!p.dead
        if (Number.isFinite(p.health)) selfHealth = p.health
        if (Number.isFinite(p.stamina)) selfStamina = p.stamina
        // v4: capture the authoritative self position so incoming-hit feedback can
        // point the directional edge glow at the nearest attacker (see _attackerSource).
        if (Number.isFinite(p.x) && Number.isFinite(p.z)) this.selfPos = { x: p.x, z: p.z }
        continue // self is first-person, not proxied
      }
      seen.add(p.id)
      let rp = this.players.get(p.id)
      if (!rp) {
        // v3 T11: pass the display name + a canvas factory so the avatar gets a
        // name label (browser only; headless has no canvas → label skipped).
        rp = new RemotePlayer(this.scene, p.id, { name: p.name, canvasFactory: this.env.canvasFactory })
        this.players.set(p.id, rp)
      }
      rp.apply(p, 1 / 60)
      // CTF: tint the avatar to its team so teammates are identifiable.
      if (rp.setTeam) rp.setTeam(p.team || null)
    }
    this.selfDead = selfDead
    // v9: authoritative self health/stamina for the local HUD + death detection.
    this.selfHealth = selfHealth
    this.selfStamina = selfStamina
    // Surface self death/respawn transitions to the game (co-op respawn flow).
    if (selfDead && !this._wasSelfDead) this.onSelfDeath && this.onSelfDeath()
    if (!selfDead && this._wasSelfDead) this.onSelfRespawn && this.onSelfRespawn()
    this._wasSelfDead = selfDead
    // Respawn events naming this client are also a revive signal.
    for (const ev of (snap.events || [])) {
      if (!ev) continue
      if (ev.k === 'respawn' && ev.victim === this.pid) this.onSelfRespawn && this.onSelfRespawn()
      // Incoming damage on THIS client (zombie melee or teammate friendly fire):
      // surface it so the Game plays the hit feedback. The server already applied
      // the health change (adopted via selfHealth above); this is the cue.
      if (ev.k === 'hit' && ev.victim === this.pid && this.onSelfHit) {
        // Pass a source with a world position so the HUD's directional edge glow
        // points at the attacker exactly like single-player (where `source` is the
        // live Zombie/Player). `ev.by` is a zombie type for melee, or a player id
        // for friendly fire; resolve it to the nearest matching proxy's position.
        const src = this._attackerSource(snap, ev.by, !!ev.ff)
        this.onSelfHit(ev.dmg || 0, src, !!ev.ff)
      }
      // v12: match end — surface the final scoreboard to the Game once.
      if (ev.k === 'matchEnd' && !this.matchEnded) {
        this.matchEnded = true
        this.endReason = ev.reason || null
        this.finalScoreboard = Array.isArray(ev.scoreboard) ? ev.scoreboard : this.scoreboard(snap)
        this.onMatchEnd && this.onMatchEnd(this.endReason, this.finalScoreboard)
      }
      // v12: kill feed — record recent kills (victim id + killer id + headshot).
      if (ev.k === 'kill') this._pushKill(ev, snap)
      // v25: a teammate fired (or swung). Light that player's remote muzzle flash
      // so everyone sees who is shooting and roughly what they are firing.
      if (ev.k === 'shoot') {
        const rp = this.players.get(ev.by)
        if (rp) rp.flash()
      }
    }
    // Drop avatars that left the roster.
    for (const [id, rp] of this.players) {
      if (!seen.has(id)) { rp.dispose(); this.players.delete(id) }
    }
    // Remote zombies: reconcile by match id. Each is a RemoteZombie with the same
    // primitive body the local Zombie uses (clothes + face + eyes + hair +
    // accessories), mirroring the server's limb state and collapsing on death.
    // Cap the count so a full wave stays inside the mesh budget.
    const zseen = new Set()
    let liveCount = 0
    for (const [, e] of this.zombies) if (e instanceof RemoteZombie && !e.gone) liveCount++
    for (const z of (snap.zombies || [])) {
      zseen.add(z.id)
      let entry = this.zombies.get(z.id)
      if (!entry) {
        if (liveCount >= MAX_REMOTE) {
          // Over budget: a shared fallback box so the zombie is still visible.
          // v4 co-op: the box is now HIT-TESTABLE too (see getTargets) — before,
          // overflow zombies were green boxes you could see but not shoot, which
          // read as "unshootable green squares" at the tail of a big wave (e.g.
          // wave 3's 14-zombie roster over the old 12 cap). The box carries the
          // match id + type so a confirmed hit still routes an authoritative HIT.
          entry = { _box: null, _id: z.id, _type: z.type, _dead: false, _predHp: 100, _predictedDead: false }
          const box = new THREE.Mesh(ZGEO, ZMAT)
          box.position.set(z.x, 0.85, z.z)
          this.scene.add(box)
          entry._box = box
          this.zombies.set(z.id, entry)
        } else {
          // v3 chain: a sever cue passes dmg 0 (visual feedback only) and must not
          // send an authoritative HIT message — only real damage is sent.
          entry = new RemoteZombie({ scene: this.scene, id: z.id, type: z.type, onHit: (v, d, h) => { if (d > 0) this.net.sendHit(v, d, h) } })
          this.zombies.set(z.id, entry)
          liveCount++
        }
      }
      if (entry instanceof RemoteZombie) entry.sync(z)
      else if (entry._box) {
        entry._box.position.set(z.x, 0.85, z.z)
        if (z.facing != null) entry._box.rotation.y = z.facing
        entry._dead = !!(z.dead || z.state === 'dead')
        // v4 co-op melee fix: mirror authoritative HP so melee predicted-death
        // works for overflow (box) zombies too — pull the local prediction back
        // to the server's health when it is higher, never raising a real kill.
        if (typeof z.health === 'number' && (entry._predHp == null || entry._predHp > z.health)) {
          entry._predHp = z.health
        }
        entry._box.visible = !entry._dead
      }
    }
    for (const [id, entry] of this.zombies) {
      if (!zseen.has(id)) {
        if (entry instanceof RemoteZombie) entry.dispose()
        else if (entry._box) this.scene.remove(entry._box)
        this.zombies.delete(id)
      } else if (entry instanceof RemoteZombie && entry.gone) {
        entry.dispose()
        this.zombies.delete(id)
      }
    }
    this._renderScoreboard(snap)
  }

  /** Resolve an incoming-hit source to an object with a world `position` so the
   *  HUD's directional edge glow points at the attacker exactly like single-player
   *  (where `source` is the live Zombie/Player). `by` is a zombie type for melee
   *  hits or a player id for friendly fire; read the position straight from the
   *  snapshot (proxies may not exist yet this frame). Returns null when nothing
   *  matches (the HUD then skips the directional cue). */
  _attackerSource(snap, by, ff) {
    if (!by || !snap) return null
    if (ff) {
      // Friendly fire: `by` is the shooter's player id.
      for (const p of (snap.players || [])) {
        if (p.id === by && Number.isFinite(p.x) && Number.isFinite(p.z)) return { position: { x: p.x, z: p.z } }
      }
      return null
    }
    // Zombie melee: `by` is the zombie type; pick the nearest live zombie of it to
    // the self position (the one most likely to have landed the melee).
    const self = this.selfPos
    let best = null
    let bestD2 = Infinity
    for (const z of (snap.zombies || [])) {
      if (z.type !== by) continue
      if (z.dead || z.state === 'dead') continue
      if (!Number.isFinite(z.x) || !Number.isFinite(z.z)) continue
      const d2 = self ? (z.x - self.x) * (z.x - self.x) + (z.z - self.z) * (z.z - self.z) : 0
      if (d2 < bestD2) { bestD2 = d2; best = { x: z.x, z: z.z } }
    }
    return best ? { position: best } : null
  }

  /** Hit-testable proxies for the live remote zombies, so the local weapon can
   *  register hits + show feedback in co-op (the server is authoritative and
   *  receives an authoritative HIT per confirmed hit). Each RemoteZombie exposes
   *  a proxy that mirrors the server hitbox contract and client-predicts death. */
  getTargets() {
    const out = []
    for (const [, e] of this.zombies) {
      if (e instanceof RemoteZombie) {
        const t = e.getTarget()
        if (t && !t.isDead) out.push(t)
      } else if (e._box && !e._dead && !e._predictedDead) {
        // v4 co-op: overflow (fallback-box) zombies are shootable too. Expose the
        // same minimal hitbox contract a RemoteZombie proxy does so the weapon hit
        // loop registers the hit and routes an authoritative HIT to the server.
        out.push(this._boxProxy(e))
      }
    }
    return out
  }

  // Reused per-frame box proxies (no allocation): one scratch object per entry id.
  _boxProxy(e) {
    let p = e._proxy
    if (!p) {
      const self = e
      const net = this.net
      const hb = [
        { center: new THREE.Vector3(), radius: 0.45, isHead: false },
        { center: new THREE.Vector3(), radius: 0.3, isHead: true }
      ]
      p = e._proxy = {
        get isDead() { return self._dead || self._predictedDead },
        _id: self._id,
        // Live position view (see RemoteZombie.getTarget): melee reads
        // position.x/z without calling getHitboxes(), so a snapshot position
        // would be stale and every co-op melee swing would miss.
        get position() {
          const v = self._posView || (self._posView = { x: 0, y: 0.85, z: 0 })
          const bx = self._box ? self._box.position.x : 0
          const bz = self._box ? self._box.position.z : 0
          v.x = bx; v.y = 0; v.z = bz
          return v
        },
        knockback() {},
        shotgunArmor: SHOTGUN_ARMOR[self._type] != null ? SHOTGUN_ARMOR[self._type] : 1,
        getHitboxes() {
          const x = self._box.position.x, z = self._box.position.z
          p.position.x = x; p.position.y = 0; p.position.z = z
          hb[0].center.set(x, 1.0, z)
          hb[1].center.set(x, 1.7, z)
          return hb
        },
        damage(amount) {
          self._predHp = (self._predHp == null ? 100 : self._predHp) - amount
          if (self._predHp <= 0) self._predictedDead = true
          if (amount > 0 && net) net.sendHit(self._id, amount, false)
        },
        hitLimbAt() { return null }
      }
    }
    return p
  }

  /** Friendly-fire proxies for the live teammates (excludes self), so the local
   *  weapon's hit loop can register shots that land on a teammate and send an
   *  authoritative MSG.FF to the server. Rebuilt from the last snapshot's roster
   *  so positions track the interpolated avatars. */
  getPlayers() {
    const snap = this.lastSnap
    if (!snap || !Array.isArray(snap.players)) return []
    const out = []
    const sendFF = (victim, dmg) => this.net.sendFF(victim, dmg)
    for (const p of snap.players) {
      if (!p || p.id === this.pid || p.dead) continue
      out.push(makeFFProxy(p, sendFF))
    }
    return out
  }

  /** Format + paint the scoreboard DOM from the snapshot's score/kills maps.
   *  v7: rows are labelled by display NAME (not the opaque pid) and the panel
   *  header shows how many players are online, so joining a room shows the full
   *  roster with scores at a glance. */
  _renderScoreboard(snap) {
    if (!this._sbEl) return
    const rows = this.scoreboard(snap)
    this._sbEl.style.display = 'block'
    // Rebuild rows without innerHTML of live data (plain text only).
    while (this._sbEl.firstChild) this._sbEl.removeChild(this._sbEl.firstChild)
    const head = this.doc.createElement('div')
    const ping = this.net.pingMs
    const status = this.net.connected ? (ping ? `WAVE ${snap.wave}  LEFT ${snap.remaining}  ${ping}ms` : `WAVE ${snap.wave}  LEFT ${snap.remaining}`) : 'CONNECTION LOST'
    head.textContent = status
    this._sbEl.appendChild(head)
    // Online-player count line (roster size), so the room's population is legible.
    const count = this.doc.createElement('div')
    count.textContent = `PLAYERS ${rows.length}`
    this._sbEl.appendChild(count)
    for (const r of rows) {
      const row = this.doc.createElement('div')
      row.textContent = `${r.name}: ${r.score} pts  ${r.kills} kills`
      this._sbEl.appendChild(row)
      // v12: a compact health bar under each player so teammates' state is legible
      // at a glance (who is about to drop). Dead players show an empty bar.
      const bar = this.doc.createElement('div')
      bar.className = 'mp-hp'
      const fill = this.doc.createElement('div')
      fill.className = 'mp-hp-fill'
      const pct = Math.max(0, Math.min(100, Math.round((r.health / 100) * 100)))
      fill.style.width = (r.dead ? 0 : pct) + '%'
      fill.style.background = r.dead ? '#7a2b2b' : (pct > 50 ? '#3fae5a' : pct > 25 ? '#c9a227' : '#c0392b')
      bar.appendChild(fill)
      this._sbEl.appendChild(bar)
    }
    // v12: kill feed — the most recent kills, most-recent first.
    if (this._killFeed.length) {
      const feed = this.doc.createElement('div')
      feed.className = 'mp-killfeed'
      for (const line of this._killFeed) {
        const lineEl = this.doc.createElement('div')
        lineEl.textContent = line
        feed.appendChild(lineEl)
      }
      this._sbEl.appendChild(feed)
    }
  }

  /** Sorted scoreboard rows from a snapshot (mirrors Match.scoreboard()).
   *  v7: each row carries the player's display name (joined from the snapshot's
   *  players roster by id) so the scoreboard reads names, not opaque pids. */
  scoreboard(snap) {
    const s = snap || this.lastSnap
    if (!s) return []
    // id -> name map from the authoritative roster (names already sanitized by
    // the server / buildHello; empty name falls back to the pid).
    const names = {}
    const health = {}
    const dead = {}
    for (const p of (s.players || [])) {
      if (!p || !p.id) continue
      names[p.id] = p.name || p.id
      if (Number.isFinite(p.health)) health[p.id] = p.health
      if (p.dead) dead[p.id] = true
    }
    const rows = []
    for (const id of Object.keys(s.score || {})) {
      rows.push({ id, name: names[id] || id, score: s.score[id] || 0, kills: (s.kills && s.kills[id]) || 0, health: health[id] != null ? health[id] : 100, dead: !!dead[id] })
    }
    rows.sort((a, b) => b.score - a.score)
    return rows
  }

  /** Per-frame tick from the Game loop: advance timers, send input, interpolate. */
  update(dt, inputState, yaw) {
    this.net.update(dt)
    if (inputState) this.net.maybeSendInput(inputState, yaw)
    this.net.maybePing()
    // Re-pose existing avatars with fresh interpolation between snapshots.
    const interp = this.net.interpolated()
    for (const p of interp.players) {
      if (p.id === this.pid) continue
      const rp = this.players.get(p.id)
      if (rp) rp.apply(p, dt)
    }
    // Advance remote zombie corpses + falling limbs.
    for (const [id, e] of this.zombies) {
      if (e instanceof RemoteZombie) {
        e.update(dt)
        if (e.gone) { e.dispose(); this.zombies.delete(id) }
      }
    }
  }

  /** Tear down every proxy + the DOM panel + the socket. */
  dispose() {
    for (const rp of this.players.values()) rp.dispose()
    this.players.clear()
    for (const entry of this.zombies.values()) {
      if (entry instanceof RemoteZombie) entry.dispose()
      else if (entry._box) this.scene.remove(entry._box)
    }
    this.zombies.clear()
    if (this._sbEl && this._sbEl.parentNode) this._sbEl.parentNode.removeChild(this._sbEl)
    this._sbEl = null
    this.net.close()
  }
}