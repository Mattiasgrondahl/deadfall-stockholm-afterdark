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
import { loadSkin, buildSkin } from '../game/Zombie.js'

// A tiny primitive zombie silhouette used as a fallback until the skinned rig
// loads (and as the permanent body if the rig fails). Shared geometry/material
// so fallback boxes add only 1 mesh each. The dim co-op scene crushed the dark
// olive box into a black square, so it carries a muted color + low emissive.
import * as THREE from 'three'
const ZGEO = new THREE.BoxGeometry(0.6, 1.7, 0.4)
const ZMAT = new THREE.MeshStandardMaterial({ color: 0x5f6b4a, roughness: 0.95, emissive: 0x3a4530, emissiveIntensity: 0.18 })
// Per-type zombie-skin tones for remote bodies: darker, more saturated corpse
// colors (the pale SKIN_TINT read as white under the dim light) so the bodies
// read as greenish/grey zombies rather than glowing white blobs.
const REMOTE_TINT = { walker: 0x6f7d54, shambler: 0x7a6f4a, screamer: 0x8a5560, brute: 0x5a6350 }
// Remote zombies get the same skinned walker body as local zombies so they read
// up close. Cap skinned bodies so a full 24-zombie wave stays inside the mesh
// budget; overflow zombies fall back to the shared box.
const SKIN_CAP = 18

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
    // Remote zombies: reconcile by match id, remove vanished ones. Prefer the
    // skinned walker body (same as local zombies) once the rig is loaded; fall
    // back to the shared box until then or past the skin cap.
    const zseen = new Set()
    let skinnedCount = 0
    for (const [id, e] of this.zombies) if (e.root) skinnedCount++
    for (const z of (snap.zombies || [])) {
      zseen.add(z.id)
      let entry = this.zombies.get(z.id)
      if (!entry) {
        // Create a fallback box immediately so every remote zombie has a visible
        // body even before (or without) the skinned rig — headless keeps boxes.
        entry = { mesh: null, root: null, _box: null }
        const box = new THREE.Mesh(ZGEO, ZMAT)
        this.scene.add(box)
        entry._box = box
        entry.mesh = box
        this.zombies.set(z.id, entry)
      }
      // Build/upgrade to a skinned body if we have room and the rig is ready.
      if (!entry.root && skinnedCount < SKIN_CAP) {
        loadSkin('walker', (rec) => {
          const built = buildSkin(rec)
          if (!built) return
          const e2 = this.zombies.get(z.id)
          if (!e2 || e2.root) return
          // Tint + emissive per the zombie's type so remote bodies read as varied
          // people (not all pale-white) and stay readable under the dim scene.
          // Use darker, more saturated zombie-skin tones (the pale SKIN_TINT read
          // as white under the dim light) with a low emissive so the body is a
          // muted greenish/grey corpse, not a glowing white blob.
          const tint = REMOTE_TINT[z.type] || REMOTE_TINT.walker
          const bodyMat = built.skinned.material ? built.skinned.material.clone() : new THREE.MeshStandardMaterial()
          bodyMat.map = null; bodyMat.emissiveMap = null
          bodyMat.color.setHex(tint)
          bodyMat.emissive = new THREE.Color(tint)
          bodyMat.emissiveIntensity = 0.18
          bodyMat.roughness = 0.95
          built.skinned.material = bodyMat
          built.skinned.castShadow = true; built.skinned.receiveShadow = true
          // Place the body deterministically from the REST-pose geometry bounds
          // (measured once, before any scale/lift), so every remote clone lands
          // identically: scale the mesh so its crown reaches 1.8 m and lift the
          // root so the scaled feet land on y 0. Per-instance post-lift
          // measurement gave inconsistent lifts (some bodies hovered).
          built.root.position.set(0, 0, 0)
          built.root.scale.setScalar(1)
          built.root.updateMatrixWorld(true)
          const bb = new THREE.Box3().setFromObject(built.skinned)
          const dim = bb.getSize(new THREE.Vector3())
          const scale = dim.y > 1e-6 ? (1.8 / dim.y) : 1
          built.root.scale.setScalar(scale)
          built.root.position.set(0, -bb.min.y * scale, 0)
          e2._liftY = built.root.position.y
          // No face portrait on remote bodies: the face image sat on the back of
          // the head (the rig head faces away from the camera-relative primitive
          // face), so it reads wrong in co-op. The body alone reads as a zombie.
          this.scene.add(built.root)
          e2.root = built.root
          e2.mesh = built.skinned
          if (e2._box) { this.scene.remove(e2._box); e2._box = null }
          skinnedCount++
          this._poseRemoteZombie(e2, z)
        })
      }
      this._poseRemoteZombie(entry, z)
    }
    for (const [id, entry] of this.zombies) {
      if (!zseen.has(id)) {
        if (entry.root) { this.scene.remove(entry.root); entry.root.traverse((o) => { if (o.isSkinnedMesh && o.material) o.material.dispose() }) }
        if (entry._box) this.scene.remove(entry._box)
        this.zombies.delete(id)
      }
    }
    this._renderScoreboard(snap)
  }

  /** Position + face + visibility for a remote zombie entry (skinned root or
   *  fallback box). Dead zombies hide. */
  _poseRemoteZombie(entry, z) {
    entry._z = z // latest snapshot data for the weapon hit proxy
    // Once the server confirms the zombie alive again (not dead), clear any
    // client-predicted death so it becomes targetable again.
    if (!z.dead && z.state !== 'dead') { entry._predictedDead = false }
    const node = entry.root || entry._box
    if (!node) return
    // Skinned root keeps its build-time lift Y (feet/head alignment); only x/z
    // follow the snapshot. Overwriting y to 0 every snapshot fought the lift and
    // made the body jump up and down.
    if (entry.root) node.position.set(z.x, entry._liftY || 0, z.z)
    else node.position.set(z.x, 0.85, z.z)
    if (z.facing != null) node.rotation.y = z.facing
    node.visible = !z.dead && z.state !== 'dead'
    if (entry._box) entry._box.visible = node.visible
  }

  /** Hit-testable proxies for the live remote zombies, so the local weapon can
   *  register hits + show feedback in co-op (the server is authoritative and
   *  receives an authoritative HIT per confirmed hit). Each proxy mirrors the
   *  server hitbox contract (torso y+1.2 r0.45, head y+1.8 r0.3) and client-
   *  predicts death on a fatal hit for instant feedback. */
  getTargets() {
    const out = []
    for (const [id, e] of this.zombies) {
      const z = e._z
      if (!z || z.dead || z.state === 'dead') continue
      if (e._predictedDead) continue // client-predicted fatal hit, awaiting server confirm
      const hp0 = z.health != null ? z.health : (z.hp != null ? z.hp : 50)
      const proxy = {
        isDead: false,
        _id: id,
        _hp: e._predHp != null ? e._predHp : hp0,
        getHitboxes() {
          return [
            { center: new THREE.Vector3(z.x, 1.2, z.z), radius: 0.45, isHead: false },
            { center: new THREE.Vector3(z.x, 1.8, z.z), radius: 0.3, isHead: true }
          ]
        },
        damage(amount, dir, by, head) {
          proxy._hp -= amount
          e._predHp = proxy._hp
          if (proxy._hp <= 0) { proxy.isDead = true; e._predictedDead = true }
          if (proxy.net) proxy.net.sendHit(id, amount, head)
        }
      }
      proxy.net = this.net
      out.push(proxy)
    }
    return out
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
    for (const entry of this.zombies.values()) {
      if (entry.root) { this.scene.remove(entry.root); entry.root.traverse((o) => { if (o.isSkinnedMesh && o.material) o.material.dispose() }) }
      if (entry._box) this.scene.remove(entry._box)
    }
    this.zombies.clear()
    if (this._sbEl && this._sbEl.parentNode) this._sbEl.parentNode.removeChild(this._sbEl)
    this._sbEl = null
    this.net.close()
  }
}