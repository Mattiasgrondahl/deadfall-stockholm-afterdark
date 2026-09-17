import * as THREE from 'three'

/**
 * Zombie — boxy humanoid pursuer with chase / attack / corpse states.
 *
 * Shared resources: GEO2/MAT2/HITMAT/DEADMAT are module-level and shared by
 * every zombie instance, so spawning allocates no per-zombie geometry or
 * materials. Hit flashes and deaths swap shared material references;
 * dispose() detaches only the per-zombie group and must never dispose the
 * shared entries, which back every other live zombie.
 * Zombies never use Math.random; per-zombie phase comes from a fixed-seed LCG.
 */

const GEO2 = {
  torso: new THREE.BoxGeometry(0.5, 1.0, 0.4),
  head: new THREE.BoxGeometry(0.3, 0.3, 0.3),
  arm: new THREE.BoxGeometry(0.12, 0.55, 0.12),
  leg: new THREE.BoxGeometry(0.14, 0.9, 0.14)
}

const MAT2 = {
  walker: new THREE.MeshStandardMaterial({ color: 0x6b7d5c, roughness: 0.9 }),
  shambler: new THREE.MeshStandardMaterial({ color: 0x7a6a58, roughness: 0.9 }),
  screamer: new THREE.MeshStandardMaterial({ color: 0x9c4f5e, roughness: 0.9, emissive: 0x401018, emissiveIntensity: 0.5 })
}

// Shared flash/death materials: non-fatal hit = 0.15 s red swap; death =
// dull desaturated swap. Swapped by reference only — never disposed.
const HITMAT = new THREE.MeshStandardMaterial({ color: 0x8a1f2a, emissive: 0x661111, roughness: 0.8 })
const DEADMAT = new THREE.MeshStandardMaterial({ color: 0x3a3129, roughness: 1 })
const EYE = new THREE.BoxGeometry(0.07, 0.07, 0.04)
const EYEMAT = {
  walker: new THREE.MeshBasicMaterial({ color: 0x8aff5e }),
  shambler: new THREE.MeshBasicMaterial({ color: 0xd0ff4f }),
  screamer: new THREE.MeshBasicMaterial({ color: 0xff3b2e })
}
const DEADEYEMAT = new THREE.MeshBasicMaterial({ color: 0x2a2a2a })

/** Per-type stats; wave scaling is hp * 1.12^(wave-1), rounded. */
const TABLE = {
  walker: { speed: 1.5, hp: 50, melee: 8, cooldown: 0.9 },
  shambler: { speed: 0.8, hp: 90, melee: 14, cooldown: 1.2 },
  screamer: { speed: 2.2, hp: 40, melee: 6, cooldown: 0.7 }
}

const ORDER = ['walker', 'shambler', 'screamer']

/**
 * Per-type body scale/pose. Anchor centers are load-bearing (hitboxes):
 * the torso mesh center stays exactly at (0, 1.2, 0) and the head center
 * exactly at (0, 1.8, 0) for every type; scale and rotation are applied
 * around those centers, so the anchors never move.
 */
const POSE2 = {
  walker: { torsoS: [1, 1, 1], torsoR: 0, headS: [1, 1, 1], headR: 0, armRest: -0.35, legS: [1, 1, 1] },
  shambler: { torsoS: [1.15, 0.85, 1.1], torsoR: 0.45, headS: [0.9, 0.9, 0.9], headR: 0.35, armRest: 0.2, legS: [0.85, 0.85, 0.85] },
  screamer: { torsoS: [0.7, 1.15, 0.65], torsoR: 0, headS: [1.15, 1.15, 1.15], headR: 0, armRest: -2.6, legS: [1, 1.15, 1] }
}

// Per-type face portrait plane. Colors/emissive mirror MAT2 so a headless or
// not-yet-loaded face blends with the head color. Each type owns an array of
// THREE shared face materials (3 portrait variants); individual zombies pick
// one variant deterministically from their spawn-derived phase, so same-type
// zombies no longer look cloned. The textures are attached lazily in the
// browser only (headless Node keeps the flat materials). When a texture lands,
// the material color switches to white, because MeshStandardMaterial multiplies
// map by color — leaving the head color would tint the portrait dark and hide
// it. The JPEG background already matches the head color, so white keeps the
// portrait edges seamless. The portraits are themselves dark images and the
// night scene is dim, so a scene-lit face would still blend into the head; the
// same texture is also set as emissiveMap (self-lit) so the face stays visible
// wherever the zombie is.
const FACE_GEO = new THREE.PlaneGeometry(0.26, 0.26)
const FACEMAT = {
  walker: [
    new THREE.MeshStandardMaterial({ color: 0x6b7d5c, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x6b7d5c, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x6b7d5c, roughness: 0.9 })
  ],
  shambler: [
    new THREE.MeshStandardMaterial({ color: 0x7a6a58, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x7a6a58, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x7a6a58, roughness: 0.9 })
  ],
  screamer: [
    new THREE.MeshStandardMaterial({ color: 0x9c4f5e, roughness: 0.9, emissive: 0x401018, emissiveIntensity: 0.5 }),
    new THREE.MeshStandardMaterial({ color: 0x9c4f5e, roughness: 0.9, emissive: 0x401018, emissiveIntensity: 0.5 }),
    new THREE.MeshStandardMaterial({ color: 0x9c4f5e, roughness: 0.9, emissive: 0x401018, emissiveIntensity: 0.5 })
  ]
}

// Per-outfit clothing materials, shared across all zombie types. Outfit 0 =
// suit (dark grey jacket + charcoal trousers), 1 = hoodie + sweatpants
// (heather grey), 2 = blue tee + dark denim jeans. The torso and arms wear
// the top material, the legs the bottom; the head keeps the per-type MAT2
// color so the face still reads. Base colors are the clothing colors so the
// headless / not-yet-loaded state already looks clothed; when the texture
// lands (browser only) the color flips to white, because
// MeshStandardMaterial multiplies map by color (same reasoning as the faces).
const OUTFITMATS = {
  tops: [
    new THREE.MeshStandardMaterial({ color: 0x3b414a, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x3d4a66, roughness: 0.9 })
  ],
  bottoms: [
    new THREE.MeshStandardMaterial({ color: 0x333840, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x2e3d5c, roughness: 0.9 })
  ]
}

let faceTexturesLoading = false
// Asset base for runtime (non-bundled) fetches. Vite substitutes BASE_URL at
// build time, so the same code works on the dev server ("/") and on GitHub
// Pages (base /deadfall-stockholm-afterdark), where an absolute "/assets/..."
// path would 404. The substituted value is normalized to exactly one
// trailing slash because it may or may not carry one depending on the Vite
// version. In headless Node import.meta.env is undefined; the guard in
// loadFaceTextures means this value is never used there.
const ASSET_BASE = (typeof document !== 'undefined' ? ((import.meta.env?.BASE_URL || '').replace(/\/$/, '') + '/') : '')
function loadFaceTextures() {
  if (faceTexturesLoading || typeof document === 'undefined') return
  faceTexturesLoading = true
  const loader = new THREE.TextureLoader()
  for (const type of ORDER) {
    for (let i = 0; i < 3; i++) {
      // Variant 0 is the original portrait ({type}-face.jpg); variants 1 and 2
      // are the extra faces ({type}2-face.jpg, {type}3-face.jpg) — the file
      // suffix is i + 1, so variant 1 loads the "2" file and variant 2 the "3"
      // file.
      loader.load(ASSET_BASE + 'assets/faces/' + type + (i === 0 ? '' : i + 1) + '-face.jpg', (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = 4
        const mat = FACEMAT[type][i]
        // map is multiplied by material.color; white lets the portrait render
        // at true color instead of a dark head-color tint.
        mat.color.set(0xffffff)
        // The portrait is a dark image and the night scene is dim, so a
        // scene-lit face would blend into the head. Self-illuminate it: the same
        // texture as emissiveMap adds a moderate glow independent of scene light,
        // so the face is visible in alleys as well as under streetlamps.
        mat.map = tex
        mat.emissiveMap = tex
        mat.emissive.set(0xffffff)
        mat.emissiveIntensity = 0.5
        mat.needsUpdate = true
      }, () => console.warn(`face texture failed to load; keeping flat head-color face (${type} variant ${i})`))
    }
  }
}

// Browser-only lazy outfit texture loading (headless Node keeps the flat
// colors). Each top/bottom pair is one file per outfit; .jpg is guaranteed by
// tools/generate-outfit-textures.mjs.
let outfitTexturesLoading = false
function loadOutfitTextures() {
  if (outfitTexturesLoading || typeof document === 'undefined') return
  outfitTexturesLoading = true
  const loader = new THREE.TextureLoader()
  const names = ['suit-top', 'suit-pants', 'hoodie-top', 'sweat-pants', 'tee-top', 'jeans-pants']
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const mat = (j === 0 ? OUTFITMATS.tops : OUTFITMATS.bottoms)[i]
      loader.load(ASSET_BASE + 'assets/outfits/' + names[i * 2 + j] + '.jpg', (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = 4
        mat.color.set(0xffffff)
        mat.map = tex
        mat.needsUpdate = true
      }, () => console.warn(`outfit texture failed to load; keeping flat color (${names[i * 2 + j]})`))
    }
  }
}

export { TABLE, GEO2, MAT2, HITMAT, DEADMAT, EYEMAT, DEADEYEMAT, contactNormal, FACE_GEO, FACEMAT, POSE2, OUTFITMATS }

const ATTACK_RANGE = 1.3
const SEPARATION_DIST = 0.9
const SEPARATION_STRENGTH = 0.6
const COLLIDER_RADIUS = 0.5
const NO_PROG_FLIP = 0.6 // s of zero progress while sliding before flipping direction
const CLEAR_DIST = 0.75  // m to keep sliding in free space before resuming chase

/**
 * True contact normal for a circle against the AABBs, choosing the contact
 * that most opposes the wanted direction (first AABB wins exact ties).
 * Writes {x, z} into the caller-owned scratch object out and returns out,
 * or returns null if no box is actually in contact. No allocations per call.
 */
function contactNormal(pos, aabbs, radius, wantX, wantZ, out) {
  let bestDot = Infinity
  let has = false
  for (let i = 0; i < aabbs.length; i++) {
    const b = aabbs[i]
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
    const dot = nx * wantX + nz * wantZ
    if (dot < bestDot) { bestDot = dot; has = true; out.x = nx; out.z = nz }
  }
  return has ? out : null
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
    // Per-frame scratch for contactNormal (avoids per-frame {x, z} allocs).
    this._cn = { x: 0, z: 0 }
    this._tan = { x: 0, z: 0 } // scratch for pickTangent (removes its commit-only [tx,tz] allocation)
    // Deterministic per-zombie phase (fixed-seed LCG from spawn coords + type).
    // Stored here for later tasks (walk animation, groan scheduling). Math.imul
    // keeps the LCG exact: later iterations exceed 2^53 under plain '*'.
    let seed = Math.floor((x + 200) * 100 + (z + 200) * 37 + ORDER.indexOf(type) * 101)
    for (let i = 0; i < 3; i++) seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
    this._phase = (seed / 0x7fffffff) * 2 * Math.PI

    // Body: torso, head, two arms, two legs — all from the shared GEO2 pool,
    // posed per type. Child order is fixed: torso, head, armL, armR, legL, legR.
    this.group = new THREE.Group()
    const mat = MAT2[type]
    const pose = POSE2[type]
    // Clothing outfit: an independent deterministic re-mapping of the spawn LCG
    // phase (offset so it does not track the face variant) selects one of the
    // three shared top/bottom material pairs. No extra LCG draw, so the face
    // variant pick (below) is unaffected.
    const outfit = Math.floor((((this._phase / (2 * Math.PI)) + 0.37) % 1) * 3)
    this._outfit = outfit
    const topMat = OUTFITMATS.tops[outfit]
    const bottomMat = OUTFITMATS.bottoms[outfit]
    const parts = []
    const torso = new THREE.Mesh(GEO2.torso, topMat)
    torso.position.set(0, 1.2, 0)
    torso.scale.set(pose.torsoS[0], pose.torsoS[1], pose.torsoS[2])
    torso.rotation.x = pose.torsoR
    parts.push(torso)
    const head = new THREE.Mesh(GEO2.head, mat)
    head.position.set(0, 1.8, 0)
    head.scale.set(pose.headS[0], pose.headS[1], pose.headS[2])
    head.rotation.x = pose.headR
    parts.push(head)
    // Eye glow: two small unlit boxes nested under the head; local +z faces the
    // player (group.rotation.y = atan2(dx, dz)). Shared per-type material. Eyes
    // are NOT in _parts, so hit flash and death swaps never touch them.
    const eMat = EYEMAT[type]
    this._eyes = []
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(EYE, eMat)
      eye.position.set(0.075 * side, 0.03, 0.14)
      head.add(eye)
      this._eyes.push(eye)
    }
    // Face portrait plane nested under the head, just in front of the head's
    // front face (0.15 -> 0.155, no z-fighting); the eyes (front z 0.16) still
    // protrude over the portrait. NOT in _parts, so hit flash never touches it;
    // only the death branch swaps it to DEADMAT.
    // Variant pick: the spawn-derived LCG phase (above) selects one of the
    // 3 shared variant materials per zombie — deterministic (no Math.random)
    // and spreads zombies of a type across the variants by position.
    const variant = Math.floor((this._phase / (2 * Math.PI)) * 3) % 3
    const face = new THREE.Mesh(FACE_GEO, FACEMAT[type][variant])
    face.position.set(0, 0, 0.155)
    head.add(face)
    this._face = face
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(GEO2.arm, topMat)
      arm.position.set(0.33 * side, 1.45, 0.12)
      arm.rotation.x = pose.armRest
      parts.push(arm)
      if (side === -1) this._armL = arm
      else this._armR = arm
    }
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(GEO2.leg, bottomMat)
      leg.position.set(0.15 * side, 0.45, 0)
      leg.scale.set(pose.legS[0], pose.legS[1], pose.legS[2])
      parts.push(leg)
      if (side === -1) this._legL = leg
      else this._legR = leg
    }
    this.group.add(...parts)
    this.group.position.copy(this.position)
    scene.add(this.group)
    this._parts = parts
    for (const p of parts) p.castShadow = true
    // Per-part rest materials (torso, head, armL, armR, legL, legR) so hit
    // flash / recovery can restore each part to its own material.
    this._restMats = [topMat, mat, topMat, topMat, bottomMat, bottomMat]
    this._flashT = 0
    loadFaceTextures() // guarded no-op after the first zombie (headless: no-op)
    loadOutfitTextures() // same guard pattern; browser-only
  }

  /** State update. No randomness. `audio` may be null (headless). */
  update(dt, player, zombies, collision, audio) {
    if (this.isDead) {
      this.deathTimer += dt
      this.position.y = -Math.min(this.deathTimer * 0.35, 0.8) // sink
      this.group.rotation.x = -Math.min(this.deathTimer / 1.5, 1) * 1.2 // fall over
      // Reset limbs to rest pose so corpses do not freeze mid-swing.
      const armRest = POSE2[this.type].armRest
      this._armL.rotation.x = armRest
      this._armR.rotation.x = armRest
      this._legL.rotation.x = 0
      this._legR.rotation.x = 0
      this.group.position.copy(this.position)
      return
    }
    // Hit-flash decay: runs on every live frame (including the attack branch,
    // which returns before _time advances), so a flash fades in real time.
    if (this._flashT > 0) {
      this._flashT -= dt
      if (this._flashT <= 0) {
        for (let i = 0; i < this._parts.length; i++) this._parts[i].material = this._restMats[i]
      }
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
        player.damage(TABLE[this.type].melee, this)
        if (audio && audio.zombieAttack) audio.zombieAttack(this.position) // null-guarded; V4P-2 positional
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
    const n = contactNormal(this.position, collision.aabbs, COLLIDER_RADIUS, wantX, wantZ, this._cn)
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
      this._tan.x = tx; this._tan.z = tz
      return this._tan
    }
    if (this._slideX === undefined) {
      // Chasing the player.
      if (netLen < stepLen - 1e-4) {
        // Fully blocked: commit to a slide and try to get around.
        const tan = pickTangent()
        this._slideX = tan.x; this._slideZ = tan.z
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
    // Walk cycle, synchronized with the bob below (same frequency 6): arms
    // swing around the per-type rest pose, legs around 0, exactly opposite
    // phase per pair. Deterministic: _phase is the fixed-seed LCG value.
    const armRest = POSE2[this.type].armRest
    const swing = Math.sin(this._time * 6 + this._phase) * 0.35
    this._armL.rotation.x = armRest + swing
    this._armR.rotation.x = armRest - swing
    this._legL.rotation.x = swing * 1.2
    this._legR.rotation.x = -swing * 1.2
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

  /** Clothing outfit index (0 suit, 1 hoodie+sweatpants, 2 tee+jeans). */
  getOutfit() { return this._outfit }

  /** Contract signature; `dir` is accepted and ignored.
   *  Non-fatal hits flash HITMAT for 0.15 s; a fatal hit swaps to DEADMAT. */
  damage(amount, dir = null) {
    if (this.isDead) return
    this.health -= amount
    if (this.health <= 0) {
      this.health = 0
      this.isDead = true
      this.deathTimer = 0
      this._flashT = 0
      for (let i = 0; i < this._parts.length; i++) this._parts[i].material = DEADMAT
      for (const e of this._eyes) e.material = DEADEYEMAT
      this._face.material = DEADMAT
    } else {
      this._flashT = 0.15
      for (let i = 0; i < this._parts.length; i++) this._parts[i].material = HITMAT
    }
  }

  /** Detach only the per-zombie group. Shared GEO/MAT are module-level and
   *  shared across all zombies — never dispose them here. */
  dispose() {
    this.scene.remove(this.group)
  }
}
