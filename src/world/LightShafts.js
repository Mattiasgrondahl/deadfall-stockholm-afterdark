// Deadfall: Stockholm Afterdark — v28 R4 volumetric light shafts.
//
// Soft god-ray cones hanging down from each streetlight so the snowy night air
// reads as hazy and the lamp pools have visible volume. Cheap fake volumetrics:
// ONE additive InstancedMesh of open-ended cones, apex at the lamp head and
// flaring down to the pavement, no new lights. Same instancing pattern as the
// streetlight pools (cityDressing.js addStreetlightPools) and the contact
// shadows (ZombieShadows.js).
//
// Budget: +1 mesh object (an InstancedMesh), +1 geometry, +1 material. No
// lights, no points, no collision. Additive + depthWrite:false so the cone
// GLOWS the air it passes through without darkening or occluding anything.
//
// Deterministic: per-anchor length/alpha jitter comes from a seeded LCG (the
// AmmoDrops.js:96 shape), never Math.random. No per-frame allocation: shafts are
// static, so update() is a no-op that reuses nothing.
//
// Headless-safe: takes only a THREE scene + an array of anchor Vector3s; no
// document/window/AudioContext. dispose() fully reverses (mesh leaves the scene,
// geo + mat disposed).

import * as THREE from 'three'

// Cone geometry: unit radius at the base, unit height, apex up. The instance
// transform flips it apex-down and scales it to the lamp-to-ground drop.
const SHAFT_TOP_Y = 5.05 // lamp-head height (matches the streetlight anchors)
const SHAFT_BASE_R = 2.2 // pool radius the cone flares out to at the ground
const SEED = 0x1F0A55

// Module-level scratch — never allocate in the build loop.
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _scl = new THREE.Vector3()
const _euler = new THREE.Euler()

export class LightShafts {
  /** @param scene THREE.Scene to add the InstancedMesh to.
   *  @param anchors array of THREE.Vector3 lamp-head positions (city.streetlightAnchors).
   *  @param maxShafts hard cap on instances (defaults to the anchor count). */
  constructor(scene, anchors = [], maxShafts = 12) {
    this.scene = scene || null
    this._seed = SEED
    const n = Math.min(anchors.length, maxShafts)
    this.count = n

    // Open-ended cone (no caps) so the shaft is a hollow glow, not a solid blob.
    this.geo = new THREE.ConeGeometry(1, 1, 12, 1, true)
    // Shift the apex to the top so a per-instance scale maps the drop cleanly.
    this.geo.translate(0, 0.5, 0)

    this.mat = new THREE.MeshBasicMaterial({
      color: 0xffb066, // warm sodium, matching the streetlight pools
      transparent: true,
      opacity: 0.06,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false
    })

    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, Math.max(1, n))
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -1
    this.mesh.count = n

    // Place one cone per anchor: apex at the lamp head, base flaring to the
    // ground. The cone geometry has its apex at +0.5 and base at -0.5, so a
    // 180° X-rotation puts the apex DOWN; we instead keep apex-up and place the
    // mesh so the wide base sits on the ground and the apex at the lamp.
    for (let i = 0; i < n; i++) {
      const a = anchors[i]
      const jitter = this._rand() * 0.25 // slight per-lamp length variance
      const drop = SHAFT_TOP_Y * (1 + jitter)
      const r = SHAFT_BASE_R * (1 + jitter * 0.5)
      _scl.set(r, drop, r)
      _m.makeScale(_scl.x, _scl.y, _scl.z)
      // Cone apex at local +0.5*drop after scale; drop the base to y=0 by
      // centering the cone between ground and the lamp head.
      _m.setPosition(a.x, drop * 0.5, a.z)
      this.mesh.setMatrixAt(i, _m)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.scene && this.scene.add) this.scene.add(this.mesh)
  }

  /** Seeded LCG in [0,1) — the AmmoDrops.js:96 shape. */
  _rand() {
    this._seed = (Math.imul(this._seed, 48271) >>> 0) % 65537
    return this._seed / 65537
  }

  /** Shafts are static; kept for API symmetry with the other world modules. */
  update() {}

  /** Remove the mesh and dispose geometry + material. Idempotent. */
  dispose() {
    if (!this.mesh) return
    if (this.scene && this.scene.remove) this.scene.remove(this.mesh)
    this.mesh.dispose()
    this.geo.dispose()
    this.mat.dispose()
    this.mesh = null
    this.geo = null
    this.mat = null
    this.scene = null
  }
}