import * as THREE from 'three'

/**
 * Zombie — boxy humanoid pursuer with chase / attack / corpse states.
 *
 * Shared resources: GEO and MAT are module-level and shared by every
 * zombie instance, so spawning allocates no per-zombie geometry or
 * materials. dispose() detaches only the per-zombie group; it must never
 * dispose the shared GEO/MAT entries, which back every other live zombie.
 * Zombies never use Math.random.
 */

const GEO = {
  torso: new THREE.BoxGeometry(0.5, 1.0, 0.4),
  head: new THREE.BoxGeometry(0.3, 0.3, 0.3),
  arm: new THREE.BoxGeometry(0.12, 0.55, 0.12)
}

const MAT = {
  walker: new THREE.MeshStandardMaterial({ color: 0x6b7d5c, roughness: 0.9 }),
  shambler: new THREE.MeshStandardMaterial({ color: 0x7a6a58, roughness: 0.9 }),
  screamer: new THREE.MeshStandardMaterial({ color: 0x9c4f5e, roughness: 0.9 })
}

/** Per-type stats; wave scaling is hp * 1.12^(wave-1), rounded. */
const TABLE = {
  walker: { speed: 1.5, hp: 50, melee: 8, cooldown: 0.9 },
  shambler: { speed: 0.8, hp: 90, melee: 14, cooldown: 1.2 },
  screamer: { speed: 2.2, hp: 40, melee: 6, cooldown: 0.7 }
}

export { TABLE, GEO, MAT }

const ATTACK_RANGE = 1.3
const SEPARATION_DIST = 0.9
const SEPARATION_STRENGTH = 0.6
const COLLIDER_RADIUS = 0.5
const NO_PROG_FLIP = 0.6 // s of zero progress while sliding before flipping direction
const CLEAR_DIST = 0.75  // m to keep sliding in free space before resuming chase

/**
 * True contact normal for a circle against the AABBs, choosing the contact
 * that most opposes the wanted direction (deepest penetration breaks ties).
 * Returns {x, z} or null if no box is actually in contact.
 */
function contactNormal(pos, aabbs, radius, wantX, wantZ) {
  let best = null
  let bestDot = Infinity
  let bestPen = 0
  for (const b of aabbs) {
    const cx = pos.x < b.minX ? b.minX : (pos.x > b.maxX ? b.maxX : pos.x)
    const cz = pos.z < b.minZ ? b.minZ : (pos.z > b.maxZ ? b.maxZ : pos.z)
    const dx = pos.x - cx
    const dz = pos.z - cz
    const d2 = dx * dx + dz * dz
    if (d2 >= (radius + 1e-6) * (radius + 1e-6)) continue
    const d = Math.sqrt(d2)
    let nx, nz
    if (d > 1e-9) { nx = dx / d; nz = dz / d }
    else {
      // center inside the box: exit through the nearest face
      const dL = pos.x - b.minX
      const dR = b.maxX - pos.x
      const dT = pos.z - b.minZ
      const dB = b.maxZ - pos.z
      const m = Math.min(dL, dR, dT, dB)
      nx = m === dL ? -1 : (m === dR ? 1 : 0)
      nz = m === dT ? -1 : (m === dB ? 1 : 0)
    }
    const pen = d > 1e-9 ? radius - d : radius
    const dot = nx * wantX + nz * wantZ
    if (dot < bestDot) { bestDot = dot; best = { x: nx, z: nz }; bestPen = pen }
  }
  return best
}

export class Zombie {
  constructor(scene, type, x, z, wave = 1) {
    if (!TABLE[type]) throw new Error('unknown zombie type: ' + type)
    this.type = type
    this.scene = scene
    this.maxHealth = this.health = Math.round(TABLE[type].hp * Math.pow(1.12, wave - 1))
    this.position = new THREE.Vector3(x, 0, z) // group origin = feet (y 0)
    this.isDead = false
    this.deathTimer = 0
    this._attackT = 0
    this._time = 0
    this._killCounted = false
    this._slideX = undefined
    this._slideZ = undefined
    this._slideT = 0
    this._slideDist = 0
    this._noProgT = 0
    this._clearDist = 0
    this._blockedT = 0
    this._flips = 0
    this.group = new THREE.Group()
    const mat = MAT[type]
    const torso = new THREE.Mesh(GEO.torso, mat)
    torso.position.set(0, 1.2, 0)
    const head = new THREE.Mesh(GEO.head, mat)
    head.position.set(0, 1.8, 0)
    const armL = new THREE.Mesh(GEO.arm, mat)
    armL.position.set(-0.33, 1.25, 0.12)
    armL.rotation.x = -1.1 // reaching forward
    const armR = new THREE.Mesh(GEO.arm, mat)
    armR.position.set(0.33, 1.25, 0.12)
    armR.rotation.x = -1.1
    this.group.add(torso, head, armL, armR)
    this.group.position.copy(this.position)
    scene.add(this.group)
  }

  /** State update. No randomness. `audio` may be null (headless). */
  update(dt, player, zombies, collision, audio) {
    if (this.isDead) {
      this.deathTimer += dt
      this.position.y = -Math.min(this.deathTimer * 0.35, 0.8) // sink
      this.group.rotation.x = -Math.min(this.deathTimer / 1.5, 1) * 1.2 // fall over
      this.group.position.copy(this.position)
      return
    }
    if (!player || player.isDead) return
    const dx = player.position.x - this.position.x
    const dz = player.position.z - this.position.z
    const dist = Math.hypot(dx, dz)
    this.group.rotation.y = Math.atan2(dx, dz) // face player
    if (dist <= ATTACK_RANGE) {
      this._attackT += dt
      if (this._attackT >= TABLE[this.type].cooldown) {
        this._attackT = 0
        player.damage(TABLE[this.type].melee, 'zombie')
        if (audio && audio.zombieAttack) audio.zombieAttack() // null-guarded
      }
      return
    }
    let dirX = dx / dist
    let dirZ = dz / dist
    for (const o of zombies) {
      if (o === this || o.isDead) continue
      const ox = this.position.x - o.position.x
      const oz = this.position.z - o.position.z
      const od = Math.hypot(ox, oz)
      if (od < SEPARATION_DIST && od > 1e-6) {
        dirX += (ox / od) * SEPARATION_STRENGTH
        dirZ += (oz / od) * SEPARATION_STRENGTH
      }
    }
    const len = Math.hypot(dirX, dirZ)
    if (len > 1e-6) {
      dirX /= len
      dirZ /= len
    }
    // Committed wall slide. The zombie chases the player until its step is
    // fully blocked, then commits to a slide direction (tangent to the face
    // actually in contact, sign aligned toward the player) and keeps it, so
    // it can round corners and climb out of narrow pockets. While sliding it
    // keeps the direction as long as it makes progress; a stuck zombie (no
    // progress for NO_PROG_FLIP seconds) flips to the opposite direction; in
    // free space the slide is cleared and chasing resumes.
    const wantX = dirX, wantZ = dirZ
    if (this._slideX !== undefined) { dirX = this._slideX; dirZ = this._slideZ }
    const preX = this.position.x
    const preZ = this.position.z
    const stepLen = TABLE[this.type].speed * dt
    this.position.x += dirX * stepLen
    this.position.z += dirZ * stepLen
    collision.resolve(this.position, COLLIDER_RADIUS)
    const netX = this.position.x - preX
    const netZ = this.position.z - preZ
    const netLen = Math.hypot(netX, netZ)
    const n = contactNormal(this.position, collision.aabbs, COLLIDER_RADIUS, wantX, wantZ)
    const pickTangent = () => {
      let tx, tz
      if (n === null) {
        // Blocked by world bounds with no AABB contact: rotate wanted 90°.
        tx = -wantZ; tz = wantX
      } else {
        // 90° rotation of the contact normal; the sign is fixed below so a
        // head-on chase (want ⊥ normal, a true tie) slides toward +x.
        tx = n.z; tz = -n.x
      }
      if (tx * wantX + tz * wantZ < 0) { tx = -tx; tz = -tz }
      return [tx, tz]
    }
    if (this._slideX === undefined) {
      // Chasing the player.
      if (netLen < stepLen - 1e-4) {
        // Fully blocked: commit to a slide and try to get around.
        const [tx, tz] = pickTangent()
        this._slideX = tx; this._slideZ = tz
        this._slideT = 0; this._slideDist = 0; this._noProgT = 0
        this._clearDist = 0
        this._flips++
      }
    } else if (n === null) {
      // Free space: keep sliding briefly to clear the corner/edge just passed,
      // then resume chasing. Clearing immediately would let the chase direction
      // point back into the corner and trap the zombie in a ping-pong.
      this._clearDist += netLen
      this._slideT += dt
      if (this._clearDist > CLEAR_DIST) {
        this._slideX = undefined; this._slideZ = undefined
        this._slideT = 0; this._slideDist = 0; this._noProgT = 0
        this._clearDist = 0
      }
    } else {
      // Sliding while in contact with an obstacle.
      const prog = netX * this._slideX + netZ * this._slideZ
      if (prog > 0.004) {
        // Making progress along the committed direction: keep it.
        this._slideT += dt
        this._slideDist += prog
        this._noProgT = 0
        this._clearDist = 0
      } else {
        // Stuck: flip to the opposite direction after a grace period.
        this._noProgT += dt
        if (this._noProgT > NO_PROG_FLIP) {
          this._slideX = -this._slideX
          this._slideZ = -this._slideZ
          this._noProgT = 0
          this._flips++
        }
      }
    }
    this._time += dt
    this.group.rotation.x = Math.sin(this._time * 6) * 0.08 // bob
    this.group.position.copy(this.position)
  }

  /** Weapon hitbox contract: world-space centers, so sunk corpses sink out of reach. */
  getHitboxes() {
    const { x, y, z } = this.position
    return [
      { center: new THREE.Vector3(x, y + 1.2, z), radius: 0.45, isHead: false },
      { center: new THREE.Vector3(x, y + 1.8, z), radius: 0.3, isHead: true }
    ]
  }

  /** Contract signature; `dir` is accepted and ignored. */
  damage(amount, dir = null) {
    if (this.isDead) return
    this.health -= amount
    if (this.health <= 0) {
      this.health = 0
      this.isDead = true
      this.deathTimer = 0
    }
  }

  /** Detach only the per-zombie group. Shared GEO/MAT are module-level and
   *  shared across all zombies — never dispose them here. */
  dispose() {
    this.scene.remove(this.group)
  }
}
