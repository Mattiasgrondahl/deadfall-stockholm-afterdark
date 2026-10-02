import * as THREE from 'three'

// Footprints.js — v3 T13: footprint decals left in the snow by the player and
// every zombie. A single InstancedMesh (one draw call) holds a fixed pool of
// boot/paw prints pressed into the ground, evicted oldest-first at MAX_PRINTS.
// Each print is stamped alternating left/right along the walker's facing, ages
// out over LIFE seconds (fading by shrinking toward the ground), and is a dark
// oval that reads as a depression in the snow. Deterministic (seeded LCG; no
// Math.random). Headless-safe: a null scene is tolerated (the pool still tracks
// prints, it just has no mesh). Mirrors the Blood.js ground-stain pool and the
// BulletHoles.js decal pool (prefix invariant: slot 0 = oldest print).
//
// Budget: one InstancedMesh = one mesh, well under the 640-mesh cap. No lights,
// no points. New file kept under ~350 lines.

const MAX_PRINTS = 64
const LIFE = 6.0          // s before a print has faded out completely
const SEED = 4242
const STEP_DIST = 0.7     // metres of travel between footfalls
const SIDE_OFFSET = 0.16  // lateral offset of the alternating left/right track
const PRINT_Y = 0.02      // just above the ground plane (clears pools 0.02 ties, drifts 0.04)

export class Footprints {
  constructor(scene) {
    this.scene = scene || null
    this._seed = SEED
    this._rng = () => (this._seed = (Math.imul(this._seed, 48271) >>> 0) % 65537) / 65537
    this.count = 0
    this._dirty = false // v37 R6: set by _addPrint; gates update()
    this._pos = []
    this._quat = []
    this._age = []
    this._scale = []
    for (let i = 0; i < MAX_PRINTS; i++) {
      this._pos.push(new THREE.Vector3())
      this._quat.push(new THREE.Quaternion())
      this._age.push(0)
      this._scale.push(1)
    }
    // A soft oval print: a stretched disc with a canvas alpha map (browser only;
    // null headless so the print still reads as a plain dark oval).
    this._geo = makePrintGeometry()
    this._mat = new THREE.MeshBasicMaterial({
      color: 0x1a2330, transparent: true, opacity: 0.5, depthWrite: false,
      map: makePrintMap(), side: THREE.DoubleSide
    })
    this._mesh = new THREE.InstancedMesh(this._geo, this._mat, MAX_PRINTS)
    this._mesh.count = 0
    this._mesh.frustumCulled = false
    this._mesh.visible = false
    if (this.scene && this.scene.add) this.scene.add(this._mesh)
    // Per-walker step accumulators so footfalls fire on real travel, not per frame.
    this._stride = new Map() // id -> { lastX, lastZ, dist, side }
    // Scratch (never allocated per frame).
    this._m = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._upY = new THREE.Vector3(0, 1, 0)
    this._s = new THREE.Vector3()
    this._v = new THREE.Vector3()
    this._right = new THREE.Vector3()
  }

  get activeCount() { return this.count }

  /**
   * Record a footfall for a walker moving from (lastX,lastZ) to (x,z) facing
   * `yaw`. Emits a print once the walker has covered STEP_DIST metres,
   * alternating left/right across the facing direction. `id` keys the stride
   * accumulator so each walker keeps its own gait phase.
   */
  step(id, x, z, yaw) {
    let st = this._stride.get(id)
    if (!st) {
      st = { lastX: x, lastZ: z, dist: 0, side: 1 }
      this._stride.set(id, st)
      return
    }
    const dx = x - st.lastX
    const dz = z - st.lastZ
    st.dist += Math.hypot(dx, dz)
    st.lastX = x
    st.lastZ = z
    if (st.dist < STEP_DIST) return
    st.dist = 0
    st.side = -st.side
    // Place the print at the walker's feet, offset sideways across the facing.
    // yaw 0 faces -Z; the right vector is (fz, 0, -fx) for forward (fx,0,fz).
    const fx = Math.sin(yaw), fz = -Math.cos(yaw) // forward
    this._right.set(fz, 0, -fx)                    // right = forward rotated -90° about Y
    this._v.set(x, PRINT_Y, z).addScaledVector(this._right, SIDE_OFFSET * st.side)
    // Face the print along the direction of travel (its long axis along the step).
    const stepYaw = Math.atan2(dx, -dz)
    this._q.setFromAxisAngle(this._upY, stepYaw)
    this._addPrint(this._v.x, this._v.z, this._q, 0.5 + this._rng() * 0.35)
  }

  /** Drop a walker's stride accumulator (on death / disconnect). */
  forget(id) { this._stride.delete(id) }

  _addPrint(x, z, quat, scale) {
    let i
    if (this.count < MAX_PRINTS) {
      i = this.count++
    } else {
      // Full pool: evict the oldest (slot 0) and shift the rest down.
      for (let k = 0; k < MAX_PRINTS - 1; k++) {
        this._pos[k].copy(this._pos[k + 1])
        this._quat[k].copy(this._quat[k + 1])
        this._age[k] = this._age[k + 1]
        this._scale[k] = this._scale[k + 1]
      }
      i = MAX_PRINTS - 1
    }
    this._pos[i].set(x, PRINT_Y, z)
    this._quat[i].copy(quat)
    this._age[i] = 0
    this._scale[i] = scale
    this._mesh.count = this.count
    this._mesh.visible = this.count > 0
    this._dirty = true // v37 R6: a new print means update() must rewrite matrices
  }

  update(dt) {
    // v37 R6: gate the whole update on a dirty flag. With no live prints and no
    // new print added this frame there is nothing to age or rewrite, so skip the
    // compaction + matrix pass entirely (and skip the redundant mesh.visible
    // write). _dirty is set by _addPrint and cleared once the pool is empty.
    if (this.count === 0 && !this._dirty) return
    if (this.count === 0) {
      this._dirty = false
      if (this._mesh) this._mesh.visible = false
      return
    }
    // Age every print; compact out the dead ones (prefix invariant) by shifting
    // survivors down, then rewrite every live instance matrix from scratch.
    let w = 0
    for (let r = 0; r < this.count; r++) {
      this._age[r] += dt
      if (this._age[r] >= LIFE) continue
      if (w !== r) {
        this._pos[w].copy(this._pos[r])
        this._quat[w].copy(this._quat[r])
        this._scale[w] = this._scale[r]
      }
      this._age[w] = this._age[r]
      w++
    }
    this.count = w
    if (this._mesh) {
      for (let i = 0; i < this.count; i++) {
        // Fade by shrinking toward the ground as the print ages (full -> nothing).
        // Linear in age; deterministic.
        const fade = 1 - this._age[i] / LIFE
        const s = this._scale[i] * (0.5 + 0.5 * fade)
        this._m.compose(this._pos[i], this._quat[i], this._s.set(s, 1, s * 0.6))
        this._mesh.setMatrixAt(i, this._m)
      }
      this._mesh.count = this.count
      this._mesh.instanceMatrix.needsUpdate = true
      this._mesh.visible = this.count > 0
    }
    // v37 R6: the rewrite is done; clear the dirty flag so an idle pool (no new
    // prints) skips the pass on subsequent frames until the next step() adds one.
    this._dirty = false
  }

  clear() {
    this.count = 0
    this._stride.clear()
    if (this._mesh) { this._mesh.count = 0; this._mesh.visible = false }
  }

  dispose() {
    if (this._mesh) {
      if (this.scene && this.scene.remove) this.scene.remove(this._mesh)
      this._mesh.geometry.dispose()
      if (this._mesh.material.map) this._mesh.material.map.dispose()
      this._mesh.material.dispose()
    }
    this._stride.clear()
    this.count = 0
  }
}

// A flattened oval disc (a footprint silhouette) facing up. All prints share it;
// per-instance scale + yaw vary the look.
function makePrintGeometry() {
  const geo = new THREE.CircleGeometry(0.5, 12)
  geo.rotateX(-Math.PI / 2) // flat on the ground, facing up
  return geo
}

// Soft radial alpha so the print edge dissolves into the snow (browser only).
function makePrintMap() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null
  try {
    const c = document.createElement('canvas')
    c.width = 64; c.height = 64
    const g = c.getContext('2d')
    if (!g) return null
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.6, 'rgba(255,255,255,0.7)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
    const tex = new THREE.CanvasTexture(c)
    return tex
  } catch (err) {
    return null
  }
}