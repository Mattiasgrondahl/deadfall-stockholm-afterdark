// Deadfall: Stockholm Afterdark — v28 R4 soft contact shadows under zombies.
//
// Zombies read as floating unless something anchors them to the pavement. Real
// shadow mapping is a quality tier that is OFF on low/mid (Lighting.js enables
// renderer.shadowMap only on 'high'), so on most machines a zombie has no
// ground contact at all. This module adds a cheap, always-on substitute: ONE
// InstancedMesh of dark radial-gradient discs laid flat just above the ground
// (y = 0.02), one instance per LIVE zombie, repositioned under each body every
// frame. It is the same technique already proven in cityDressing.js
// addContactShadows (lines ~902-960) for vehicles + barricades, applied to the
// moving actors instead of the static props.
//
// Budget: +1 mesh object (an InstancedMesh counts as one), +1 geometry, +1
// material, +1 texture (browser only). No lights, no points, no collision.
// Normal blending + depthWrite:false so the disc DARKENS the pavement instead
// of adding light — a shadow must never brighten the ground it sits on.
//
// Deterministic: no Math.random anywhere; the footprint is a fixed size and the
// per-instance tint comes from a seeded LCG (the AmmoDrops.js:96 shape) so a
// pool of shadows is never a uniform flat grey. No per-frame allocation: one
// module-level Matrix4 + Vector3 + Color are reused every update.
//
// Headless-safe: the radial-gradient canvas map is built only when `document`
// exists (makeShadowDecalMap mirrors cityDressing.js makeShadowDecalMap);
// headless keeps the mesh with a solid dark material and never renders it.
// dispose() fully reverses: mesh leaves the scene, geo/mat/map + the instance
// buffers are disposed.

import * as THREE from 'three'

// Disc height is 1 unit and it is rotated flat, so a per-instance scale of
// (width, length, 1) maps directly to metres. A human footprint is roughly
// 0.5 m wide x 0.8 m long; a contact shadow is padded well past that so the
// body's silhouette has something to sit in (cityDressing pads vehicle
// footprints by 1.5x for the same reason).
const FOOT_W = 1.2
const FOOT_L = 1.6
// Above the ground plane but below every other decal layer: footprints live at
// 0.02 too, so the shadow is pushed BACK in the transparent queue (renderOrder
// -2 vs Footprints' default 0) and the prints stay visible on top of it.
const SHADOW_Y = 0.02
// LCG seed for the per-instance tint jitter.
const SEED = 0x5A01D3

// Module-level scratch — never allocate in update().
const _m = new THREE.Matrix4()
const _pos = new THREE.Vector3()
const _scl = new THREE.Vector3()
const _col = new THREE.Color()

/** Radial-gradient alpha for the disc: dense core, soft rim. Browser-only,
 *  exactly like cityDressing.js makeShadowDecalMap — headless returns null so
 *  the material falls back to a plain dark disc that still never renders. */
function makeShadowDecalMap() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null
  try {
    const c = document.createElement('canvas')
    c.width = 64; c.height = 64
    const g = c.getContext && c.getContext('2d')
    if (!g) return null
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(0,0,0,0.60)')
    grad.addColorStop(0.5, 'rgba(0,0,0,0.30)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
    return new THREE.CanvasTexture(c)
  } catch (err) {
    return null
  }
}

export class ZombieShadows {
  /** @param scene THREE.Scene to add the InstancedMesh to.
   *  @param maxCount pool size — one instance per zombie the game can have
   *  alive at once (the S8 zombie budget is 24). */
  constructor(scene, maxCount = 24) {
    this.scene = scene || null
    this.maxCount = maxCount
    this.count = 0
    this._seed = SEED

    // A unit square rotated flat: per-instance scale then maps straight to the
    // footprint's width/length in metres (same as the contact-shadow discs).
    this.geo = new THREE.PlaneGeometry(1, 1)
    this.geo.rotateX(-Math.PI / 2)
    this.map = makeShadowDecalMap()
    // With a map the canvas carries the darkness (white tint x alpha ramp);
    // headless has no map, so the tint itself is the shadow colour.
    this.mat = new THREE.MeshBasicMaterial({
      color: this.map ? 0x0a0e16 : 0x05070b,
      map: this.map,
      transparent: true,
      opacity: this.map ? 0.9 : 0.42,
      depthWrite: false,
      fog: false,
      toneMapped: false
    })
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, maxCount)
    // The geometry is already rotated flat (rotateX above), so the mesh itself
    // stays unrotated — rotating it again would stand the discs back up.
    this.mesh.position.y = SHADOW_Y
    this.mesh.renderOrder = -2            // under footprints / blood decals
    this.mesh.frustumCulled = false       // instances move every frame
    this.mesh.count = 0                   // nothing shown until the first update
    this.mesh.visible = false
    // Shadows follow the actors, so the buffer is rewritten every frame.
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    // Per-instance tint jitter: seeded, allocated once here, never per frame.
    for (let i = 0; i < maxCount; i++) this.mesh.setColorAt(i, this._tint())
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    if (this.scene && this.scene.add) this.scene.add(this.mesh)
  }

  /** Seeded LCG in [0, 1) — the AmmoDrops.js:96 shape. The >>> 0 keeps
   *  Math.imul's signed result non-negative before the mod. */
  _rand() {
    this._seed = (Math.imul(this._seed, 48271) >>> 0) % 65537
    return this._seed / 65537
  }

  /** One instance tint: a near-black blue with a few percent of jitter, so a
   *  row of shadows is not a single flat blob. */
  _tint() {
    const j = this._rand() * 0.05
    return _col.setRGB(0.02 + j * 0.4, 0.03 + j * 0.5, 0.05 + j * 0.7)
  }

  /** Place one disc under every live zombie. `zombies` is the live list; each
   *  entry needs `.group` (an Object3D whose origin is the feet) and `.isDead`.
   *  Dead bodies get no shadow — a corpse lies inside its own silhouette.
   *  `mesh.count` is the number of live zombies clamped to maxCount, so every
   *  instance past it is never drawn (hidden by definition). */
  update(zombies) {
    const mesh = this.mesh
    if (!mesh) return
    let n = 0
    if (zombies && zombies.length) {
      for (const z of zombies) {
        if (!z || z.isDead || !z.group) continue
        if (n >= this.maxCount) break
        z.group.getWorldPosition(_pos)
        _pos.y = SHADOW_Y
        _scl.set(FOOT_W, FOOT_L, 1)
        _m.makeScale(_scl.x, _scl.y, _scl.z)
        _m.setPosition(_pos.x, 0, _pos.z)
        mesh.setMatrixAt(n++, _m)
      }
    }
    mesh.count = n
    mesh.visible = n > 0
    mesh.instanceMatrix.needsUpdate = true
  }

  /** Fully reverse the construction: the mesh leaves the scene and every
   *  owned GPU resource is released. Idempotent. */
  dispose() {
    if (!this.mesh) return
    if (this.scene && this.scene.remove) this.scene.remove(this.mesh)
    this.mesh.dispose()          // frees the instanceMatrix / instanceColor buffers
    this.geo.dispose()
    if (this.mat.map) this.mat.map.dispose()
    this.mat.dispose()
    this.mesh = null
    this.geo = null
    this.mat = null
    this.map = null
    this.count = 0
  }
}