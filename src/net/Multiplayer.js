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

// A tiny primitive zombie silhouette for remote (server-authoritative) zombies.
// Shared geometry/material so 18 remote zombies add only 18 meshes. The dim
// co-op scene crushed the dark olive box into a black square, so the material
// now carries a bright green color + emissive (matching the local skinned
// walker's readable config) so remote zombies read as glowing figures.
import * as THREE from 'three'
const ZGEO = new THREE.BoxGeometry(0.6, 1.7, 0.4)
const ZMAT = new THREE.MeshStandardMaterial({ color: 0xb9c4ad, roughness: 0.9, emissive: 0x6f8a4a, emissiveIntensity: 0.55 })

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
    this._wasSelfDead = false
    // Co-op respawn hooks the Game wires up (no-ops until assigned).
    this.onSelfDeath = null
    this.onSelfRespawn = null
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
    for (const p of snap.players) {
      if (p.id === this.pid) { selfDead = !!p.dead; continue } // self is first-person, not proxied
      seen.add(p.id)
      let rp = this.players.get(p.id)
      if (!rp) { rp = new RemotePlayer(this.scene, p.id); this.players.set(p.id, rp) }
      rp.apply(p, 1 / 60)
    }
    this.selfDead = selfDead
    // Surface self death/respawn transitions to the game (co-op respawn flow).
    if (selfDead && !this._wasSelfDead) this.onSelfDeath && this.onSelfDeath()
    if (!selfDead && this._wasSelfDead) this.onSelfRespawn && this.onSelfRespawn()
    this._wasSelfDead = selfDead
    // Respawn events naming this client are also a revive signal.
    for (const ev of (snap.events || [])) {
      if (ev && ev.k === 'respawn' && ev.victim === this.pid) this.onSelfRespawn && this.onSelfRespawn()
    }
    // Drop avatars that left the roster.
    for (const [id, rp] of this.players) {
      if (!seen.has(id)) { rp.dispose(); this.players.delete(id) }
    }
    // Remote zombies: reconcile by match id, remove vanished ones.
    const zseen = new Set()
    for (const z of (snap.zombies || [])) {
      zseen.add(z.id)
      let entry = this.zombies.get(z.id)
      if (!entry) {
        const mesh = new THREE.Mesh(ZGEO, ZMAT)
        this.scene.add(mesh)
        entry = { mesh }
        this.zombies.set(z.id, entry)
      }
      entry.mesh.position.set(z.x, 0.85, z.z)
      if (z.facing != null) entry.mesh.rotation.y = z.facing
      entry.mesh.visible = !z.dead && z.state !== 'dead'
    }
    for (const [id, entry] of this.zombies) {
      if (!zseen.has(id)) { this.scene.remove(entry.mesh); this.zombies.delete(id) }
    }
    this._renderScoreboard(snap)
  }

  /** Format + paint the scoreboard DOM from the snapshot's score/kills maps. */
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
    for (const r of rows) {
      const row = this.doc.createElement('div')
      row.textContent = `${r.id}: ${r.score} pts  ${r.kills} kills`
      this._sbEl.appendChild(row)
    }
  }

  /** Sorted scoreboard rows from a snapshot (mirrors Match.scoreboard()). */
  scoreboard(snap) {
    const s = snap || this.lastSnap
    if (!s) return []
    const rows = []
    for (const id of Object.keys(s.score || {})) {
      rows.push({ id, score: s.score[id] || 0, kills: (s.kills && s.kills[id]) || 0 })
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
  }

  /** Tear down every proxy + the DOM panel + the socket. */
  dispose() {
    for (const rp of this.players.values()) rp.dispose()
    this.players.clear()
    for (const entry of this.zombies.values()) this.scene.remove(entry.mesh)
    this.zombies.clear()
    if (this._sbEl && this._sbEl.parentNode) this._sbEl.parentNode.removeChild(this._sbEl)
    this._sbEl = null
    this.net.close()
  }
}