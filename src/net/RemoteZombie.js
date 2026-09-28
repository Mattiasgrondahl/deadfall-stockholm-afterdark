// src/net/RemoteZombie.js — a co-op zombie body driven by the server snapshot.
//
// The local zombie sim is suppressed in co-op, so remote zombies live only in
// the snapshot. This class renders one remote zombie with the SAME primitive
// body the local Zombie uses (clothes + face + eyes + hair + accessories), so
// co-op bodies read as people instead of black boxes. It mirrors the server's
// limb state (arms/legs/head severed), collapses + lingers on death, and faces
// the snapshot's facing angle. It also exposes a weapon-hit proxy so the local
// weapon can register hits + show feedback; a confirmed hit sends an
// authoritative HIT message (handled by Multiplayer) so the server applies the
// damage.
//
// Reversibility: everything it adds to the scene (the body group + any detached
// falling limbs) is tracked and removed in dispose(). Materials/geometry are
// shared (from Zombie.js) and never disposed here.
import * as THREE from 'three'
import { buildPrimitiveBody, DEADMAT, DEADEYEMAT } from '../game/Zombie.js'

// Deterministic LCG (no Math.random) so per-zombie phase is stable across a
// snapshot stream; seeded from the match id string.
function seedFromId(id) {
  let h = 2166136261
  const s = String(id)
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) & 0x7fffffff
  return h
}

// Falling-limb physics: a detached limb/head tumbles to the ground and stays
// briefly. Shared scratch avoids per-frame allocations.
const _v = new THREE.Vector3()

// Per-type shotgun damage multiplier (mirrors Zombie.TABLE) so the co-op brute
// shrugs off buckshot like the local brute does.
const SHOTGUN_ARMOR = { walker: 1, shambler: 1, screamer: 1, brute: 0.4 }

export class RemoteZombie {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene
   * @param {string} opts.id match id (drives deterministic phase)
   * @param {string} opts.type zombie type (walker/shambler/screamer/brute)
   * @param {(victim:string, dmg:number, head:boolean)=>void} [opts.onHit]
   *        called when the local weapon confirms a hit (sends authoritative HIT)
   */
  constructor(opts) {
    this.scene = opts.scene
    this.id = opts.id
    this.type = opts.type
    this.onHit = opts.onHit || null
    const phase = (seedFromId(this.id) / 0x7fffffff) * 2 * Math.PI
    const b = buildPrimitiveBody(this.type, phase)
    this._phase = phase
    this._time = 0
    this.group = b.group
    this._parts = b.parts
    this._restMats = b.restMats
    this._head = b.head
    this._face = b.face
    this._eyes = b.eyes
    this._hair = b.hair
    this._acc = b.acc
    this._armL = b.armL; this._armR = b.armR
    this._legL = b.legL; this._legR = b.legR
    this._armRest = { l: b.armL.rotation.x, r: b.armR.rotation.x }
    this._limbs = { arms: 0, legs: 0, head: 0 }
    // v3 chain: landed-round counter for the client-side chain prediction.
    // The server's `limbs` counts are authoritative and re-sync it.
    this._chainShots = 0
    this.isDead = false
    this._deathT = 0
    this._removed = false
    this._falling = [] // detached limbs/heads tumbling to the ground
    this._x = 0; this._z = 0; this._facing = 0
    // v4 co-op: snapshot target position. The server sends positions at 10 Hz;
    // without smoothing a remote zombie teleports in 100 ms jumps, which reads as
    // sluggish/jerky versus the smooth single-player zombie. sync() sets the
    // target; update() eases the rendered position toward it every frame so the
    // proxy glides continuously and keeps pace with the (faster) real zombie.
    this._tx = 0; this._tz = 0
    this._seen = false // first snapshot snaps into place; later ones glide
    this._hp = 100
    this._predHp = null
    this._predictedDead = false
    // v4 co-op: the snapshot's `state` is only used for death today, so remote
    // zombies never visibly attack. Track the attack state so the arms can play
    // a windup→swing when the server has the zombie in `attack`, matching the
    // single-player zombie's melee lunge so co-op attacks are actually visible.
    this._state = 'idle'
    this._attackT = 0
    this._wasAttacking = false
    this._flashT = 0
    this.scene.add(this.group)
  }

  /** Apply the latest snapshot: position, facing, limb state, death. */
  sync(z) {
    if (!z) return
    const first = !this._seen
    this._seen = true
    this._tx = z.x; this._tz = z.z
    if (first) { this._x = z.x; this._z = z.z } // appear at the right spot, then glide
    if (z.facing != null) this._facing = z.facing
    // v4 co-op: remember the authoritative state so update() can pose an attack.
    // A fresh transition into `attack` kicks off a swing timer; holding the
    // attack state keeps the arms raised, and leaving it relaxes them.
    this._state = z.state || 'idle'
    const attacking = this._state === 'attack'
    // v4 co-op: the server emits `chase` while a zombie is pursuing a player.
    // Mirror that as a walk cycle so a moving remote zombie shambles like the
    // single-player zombie instead of sliding across the ground rigidly.
    this._chasing = this._state === 'chase'
    if (attacking && !this._wasAttacking) this._attackT = 0
    this._wasAttacking = attacking
    const dead = z.dead || z.state === 'dead'
    // Mirror the server's limb state (arms/legs/head severed).
    const L = z.limbs || { arms: 0, legs: 0, head: 0 }
    this._applyLimb('armL', L.arms >= 1)
    this._applyLimb('armR', L.arms >= 2)
    this._applyLimb('legL', L.legs >= 1)
    this._applyLimb('legR', L.legs >= 2)
    this._applyHead(L.head >= 1)
    // v3 chain: the server's limb counts are authoritative, so the local
    // round counter is clamped to what actually happened (a prediction that
    // ran ahead of the server is pulled back here).
    this._chainShots = Math.min(this._chainShots, L.arms + L.legs)
    if (dead && !this.isDead) this._die()
    if (!dead) this._predictedDead = false
    if (!this.isDead) {
      this.group.position.set(this._x, 0, this._z)
      this.group.rotation.y = this._facing
      this.group.visible = true
    }
  }

  /** Hide a limb + spawn a tumbling replacement if it just got severed. Severing
   *  is one-way: once a limb is gone it never comes back (the server only ever
   *  adds severance, and a restored limb would re-spawn a falling piece every
   *  snapshot and leak). */
  _applyLimb(which, off) {
    const mesh = this['_' + which]
    if (!mesh) return
    if (this['_sev_' + which]) return // already severed, stay gone
    const wasOn = mesh.visible
    mesh.visible = !off
    if (off && wasOn) { this['_sev_' + which] = true; this._spawnFalling(mesh) }
  }

  /** Hide the head + spawn a tumbling head if it just got severed (one-way). */
  _applyHead(off) {
    if (this._sev_head) return
    const wasOn = this._head.visible
    this._head.visible = !off
    if (this._face) this._face.visible = !off
    if (this._hair) this._hair.visible = !off
    if (this._acc && (this._acc.parent === this._head)) this._acc.visible = !off
    for (const e of this._eyes) e.visible = !off
    if (off && wasOn) { this._sev_head = true; this._spawnFalling(this._head) }
  }

  /** Detach a limb/head from the body and let it tumble to the ground. */
  _spawnFalling(mesh) {
    // Copy world position so the detached piece starts where it was attached.
    mesh.updateWorldMatrix(true, false)
    const wp = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld)
    const piece = new THREE.Mesh(mesh.geometry, mesh.material)
    piece.castShadow = true
    piece.position.copy(wp)
    piece.rotation.set(0, this._facing, 0)
    // Give it a small outward + upward tumble velocity.
    piece._vy = 1.2
    piece._vx = (Math.sin(this._facing) * 0.6)
    piece._vz = (Math.cos(this._facing) * 0.6)
    piece._spin = 4
    piece._life = 0
    this.scene.add(piece)
    this._falling.push(piece)
    // Hard cap: if a pathological snapshot stream ever over-produces pieces,
    // expire the oldest immediately so the body can never leak meshes.
    if (this._falling.length > 8) {
      const old = this._falling.shift()
      this.scene.remove(old)
    }
  }

  /** Begin the death collapse: swap to dead materials, start sinking/flopping. */
  _die() {
    this.isDead = true
    this._deathT = 0
    for (let i = 0; i < this._parts.length; i++) this._parts[i].material = DEADMAT
    for (const e of this._eyes) e.material = DEADEYEMAT
    if (this._face) this._face.material = DEADMAT
  }

  /** Advance timers: collapse the corpse, tumble falling limbs, expire them. */
  update(dt) {
    // Tumble falling limbs/heads to the ground; expire after a short linger.
    for (let i = this._falling.length - 1; i >= 0; i--) {
      const p = this._falling[i]
      p._life += dt
      p._vy -= 9 * dt
      p.position.x += p._vx * dt
      p.position.z += p._vz * dt
      p.position.y += p._vy * dt
      if (p.position.y < 0.06) { p.position.y = 0.06; p._vy = 0; p._vx *= 0.6; p._vz *= 0.6 }
      p.rotation.x += p._spin * dt
      if (p._life > 4) { this.scene.remove(p); this._falling.splice(i, 1) }
    }
    if (!this.isDead) {
      // v4 co-op: glide the rendered position toward the latest snapshot target so
      // a remote zombie moves smoothly between 10 Hz updates instead of teleporting
      // in 100 ms jumps. Converge fast enough to keep pace with the real zombie
      // (~0.1 s) but never overshoot.
      const k = Math.min(1, 12 * dt)
      this._x += (this._tx - this._x) * k
      this._z += (this._tz - this._z) * k
      this.group.position.set(this._x, 0, this._z)
      // v4 co-op: drive the same gait the single-player zombie uses. The server
      // snapshot carries a per-zombie `state`; `attack` plays the melee lunge,
      // `chase` plays the walk cycle (legs swing, arms counter-swing, body bobs),
      // and anything else (idle/stagger) eases the limbs back to rest. Without
      // this a moving remote zombie slid across the ground rigidly, which read
      // as "different movement / different look" versus single-player.
      this._time += dt
      if (this._wasAttacking) {
        this._attackT += dt
        const t = Math.min(this._attackT / 0.5, 1) // 0→1 over ~0.5 s
        // Windup (first 35%) raises the arms back, swing (rest) drives them down.
        const wind = t < 0.35 ? t / 0.35 : 1
        const swing = t < 0.35 ? 0 : (t - 0.35) / 0.65
        const raise = -0.6 * wind            // arms back/up during windup
        const strike = 1.1 * swing           // arms forward/down during swing
        const lean = 0.18 * swing            // torso lunge
        if (this._armL && this._armL.visible) this._armL.rotation.x = this._armRest.l + raise + strike
        if (this._armR && this._armR.visible) this._armR.rotation.x = this._armRest.r + raise + strike
        this.group.rotation.x = lean
      } else if (this._chasing) {
        // Walk cycle, same shape + frequency (6) as Zombie.update so the gait
        // matches single-player: legs stride, arms counter-swing, the body bobs
        // and sways, and the head counter-bobs. Deterministic (phase from id).
        const t = this._time * 6 + this._phase
        const swing = Math.sin(t) * 0.42
        const legSwing = Math.sin(t) * 0.5
        if (this._legL && this._legL.visible) this._legL.rotation.x = legSwing + Math.sin(t * 2) * 0.06
        if (this._legR && this._legR.visible) this._legR.rotation.x = -legSwing + Math.sin(t * 2 + Math.PI) * 0.06
        if (this._armL && this._armL.visible) { this._armL.rotation.x = this._armRest.l - swing; this._armL.rotation.z = -0.12 }
        if (this._armR && this._armR.visible) { this._armR.rotation.x = this._armRest.r + swing; this._armR.rotation.z = 0.12 }
        this.group.rotation.z = Math.sin(t) * 0.05
        this.group.rotation.x = Math.sin(this._time * 6) * 0.08
        if (this._head && this._head.visible) this._head.rotation.z = Math.sin(t + Math.PI) * 0.04
        this._attackT = 0
      } else {
        // Not attacking and not chasing (idle or knocked back): ease limbs + torso
        // back to rest once, so a stopped zombie stands still instead of freezing
        // mid-stride. No per-frame allocation.
        if (this._armL && this._armL.visible) { this._armL.rotation.x = this._armRest.l; this._armL.rotation.z = 0 }
        if (this._armR && this._armR.visible) { this._armR.rotation.x = this._armRest.r; this._armR.rotation.z = 0 }
        if (this._legL && this._legL.visible) this._legL.rotation.x = 0
        if (this._legR && this._legR.visible) this._legR.rotation.x = 0
        if (this._head && this._head.visible) this._head.rotation.z = 0
        this.group.rotation.x = 0
        this.group.rotation.z = 0
        this._attackT = 0
      }
    }
    if (!this.isDead) return
    this._deathT += dt
    // Sink + flop over + splay limbs so the corpse reads dead, not frozen.
    const flop = Math.min(this._deathT / 1.5, 1)
    this.group.position.set(this._x, -Math.min(this._deathT * 0.35, 0.8), this._z)
    this.group.rotation.x = -flop * 1.2
    this.group.rotation.z = flop * 0.25
    if (this._armL && this._armL.visible) { this._armL.rotation.x = this._armRest.l - flop * 0.7; this._armL.rotation.z = -flop * 0.6 }
    if (this._armR && this._armR.visible) { this._armR.rotation.x = this._armRest.r + flop * 0.5; this._armR.rotation.z = flop * 0.6 }
    if (this._legL && this._legL.visible) this._legL.rotation.x = flop * 0.4
    if (this._legR && this._legR.visible) this._legR.rotation.x = -flop * 0.3
    if (this._head && this._head.visible) this._head.rotation.x = flop * 0.5
    // Linger ~5 s, then hide + expire the corpse. (No opacity fade: DEADMAT is a
    // shared material, so mutating its opacity would affect every corpse.)
    if (this._deathT > 5) {
      this.group.visible = this._deathT < 6.5
      if (this._deathT > 6.5) this._removed = true
    }
  }

  /** True once the corpse has fully expired and should be dropped from the map. */
  get gone() { return this._removed }

  /** A weapon-hit proxy for the local weapon (server hitbox contract). Cached
   *  per body so the weapon's per-frame hit loop allocates nothing. */
  getTarget() {
    if (this._proxy) return this._proxy
    const self = this
    const hb = [
      { center: new THREE.Vector3(), radius: 0.45, isHead: false },
      { center: new THREE.Vector3(), radius: 0.3, isHead: true }
    ]
    const proxy = {
      get isDead() { return self.isDead || self._predictedDead },
      _id: self.id,
      // Melee weapons read z.position.{x,y,z} for range + blood; the proxy has
      // no real Vector3, so expose a live plain object (and a no-op knockback)
      // so melee hits register instead of throwing and freezing the loop.
      position: { x: self._x, y: 0, z: self._z },
      knockback() {},
      shotgunArmor: SHOTGUN_ARMOR[self.type] != null ? SHOTGUN_ARMOR[self.type] : 1,
      getHitboxes() {
        // Reuse two scratch vectors (no per-frame allocation) and refresh the
        // live position for melee range checks.
        proxy.position.x = self._x; proxy.position.y = 0; proxy.position.z = self._z
        hb[0].center.set(self._x, 1.2, self._z)
        hb[1].center.set(self._x, 1.8, self._z)
        return hb
      },
      damage(amount, dir, by, head) {
        self._predHp = (self._predHp == null ? self._hp : self._predHp) - amount
        if (self._predHp <= 0) self._predictedDead = true
        if (self.onHit) self.onHit(self.id, amount, head)
      },
      hitLimbAt(x, y, z) {
        // v3 T1 chain: client-side prediction mirrors the server chain —
        // landed body round 1 takes the LEFT arm, round 2 the RIGHT arm,
        // round 3 a leg, and the round after three limbs are gone is the
        // kill. The server's snapshot is authoritative and re-syncs the
        // counts, so a wrong prediction is corrected by the next snapshot.
        const near = (lx, ly, lz, r) => {
          const dx = x - (self._x + lx), dz = z - (self._z + lz), dy = y - ly
          return dx * dx + dz * dz + dy * dy < r * r
        }
        if (self._predictedDead || self.type === 'brute') return null // boss immune; kill owned by the server
        // v3 chain: the kill resolves first — three limbs gone means this
        // round finishes the zombie (predicted locally; the snapshot confirms).
        if (self._chainShots >= 1 && self._limbs.arms + self._limbs.legs >= 3) {
          self._predHp = 0; self._predictedDead = true
          return null
        }
        // v3 chain order: rounds 1-2 take the arms (left first), round 3 a
        // leg — only when the impact actually lands near a surviving limb.
        // Sever radius 0.416 m mirrors Zombie._limbAt (round 60): the proxy
        // must sever on exactly the impacts the server-side Zombie severs, or
        // the client hides a limb the server still shows (and vice versa)
        // until the next snapshot re-syncs. 0.416 is the largest radius that
        // keeps a dead-centre torso hit (0.417 m from a socket) a non-sever.
        // Socket offsets include the arm sockets' z (±0.1), same as Zombie.
        const R = 0.416
        if (self._limbs.arms < 2) {
          if (self._armL && self._armL.visible && near(-0.34, 1.42, 0.1, R)) { self._applyLimb('armL', true); self._limbs.arms++; self._chainShots++; if (self.onHit) self.onHit(self.id, 0, false, 'arm'); return 'arm' }
          if (self._armR && self._armR.visible && near(0.34, 1.42, 0.1, R)) { self._applyLimb('armR', true); self._limbs.arms++; self._chainShots++; if (self.onHit) self.onHit(self.id, 0, false, 'arm'); return 'arm' }
        }
        if (self._limbs.legs < 2) {
          if (self._legL && self._legL.visible && near(-0.16, 0.47, 0, R)) { self._applyLimb('legL', true); self._limbs.legs++; self._chainShots++; if (self.onHit) self.onHit(self.id, 0, false, 'leg'); return 'leg' }
          if (self._legR && self._legR.visible && near(0.16, 0.47, 0, R)) { self._applyLimb('legR', true); self._limbs.legs++; self._chainShots++; if (self.onHit) self.onHit(self.id, 0, false, 'leg'); return 'leg' }
        }
        return null
      },
      _chainShot(n = 1) {
        // v3 T1 chain: the landed-round counter for the proxy. After three
        // limbs are gone the next landed round is the kill — predicted locally
        // so the body collapses at once, then confirmed by the snapshot.
        for (let i = 0; i < n; i++) {
          if (self._predictedDead) return
          if (self._chainShots >= 3) { self._predHp = 0; self._predictedDead = true; return }
          self._chainShots++
        }
      }
    }
    this._proxy = proxy
    return proxy
  }

  /** Remove the body + any falling pieces from the scene. */
  dispose() {
    this.scene.remove(this.group)
    for (const p of this._falling) this.scene.remove(p)
    this._falling.length = 0
  }
}