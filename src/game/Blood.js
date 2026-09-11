import * as THREE from 'three'

// Blood.js — blood particle pool for hits. A single InstancedMesh (≤ MAX
// instances, one draw call) holds short-lived droplets that spray from the
// impact point, fall under gravity, settle on the ground, and fade out over
// ~0.8 s. All motion is deterministic (seeded LCG, fixed gravity).
// Invariant: live droplets always occupy instance slots 0..count-1, so
// InstancedMesh's prefix rendering is always correct. Headless-safe: builds
// only plain scene-graph objects; a null scene is tolerated (the pool still
// simulates, it just has no mesh). Wired from Shotgun (pellet impacts) and
// Axe (melee hits) via blood.burst(x, y, z, damage, headHit).

const MAX = 300            // pool cap (one mesh, well under the mesh budget)
const LIFE = 0.8          // s before a droplet fades out
const GRAVITY = -9.8
const SEED = 777
const MIN_DROPS = 2
const MAX_DROPS_PER_BURST = 14

export class Blood {
  constructor(scene) {
    this.scene = scene || null
    this._seed = SEED
    this._rng = () => (this._seed = Math.imul(this._seed, 48271) % 65537) / 65537
    // Pool: preallocated flat arrays; `count` live droplets (slots 0..count-1).
    this.count = 0
    this._pos = []
    this._vel = []
    this._age = []
    this._life = []
    this._scale = []
    for (let i = 0; i < MAX; i++) {
      this._pos.push(new THREE.Vector3())
      this._vel.push(new THREE.Vector3())
      this._age.push(0)
      this._life.push(LIFE)
      this._scale.push(1)
    }
    // One mesh for all droplets: tiny tetrahedra, dark red, unlit (cheap).
    this._geo = new THREE.TetrahedronGeometry(0.05)
    this._mat = new THREE.MeshBasicMaterial({ color: 0x7a0f0f })
    this._mesh = new THREE.InstancedMesh(this._geo, this._mat, MAX)
    this._mesh.count = 0
    this._mesh.frustumCulled = false
    this._mesh.visible = false
    if (this.scene && this.scene.add) this.scene.add(this._mesh)
    // Scratch objects for matrix composition (never allocated per frame).
    this._m = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._s = new THREE.Vector3()
  }

  get activeCount() { return this.count }

  /**
   * Spray droplets at (x, y, z). Count scales with damage (dmg/4, clamped
   * 2..14); headshot doubles it (clamped to 14). New droplets take the next
   * prefix slots. Returns droplets spawned.
   */
  burst(x, y, z, damage, headHit = false) {
    let n = Math.min(MAX_DROPS_PER_BURST, Math.max(MIN_DROPS, Math.round((damage || 0) / 4)))
    if (headHit) n = Math.min(MAX_DROPS_PER_BURST, n * 2)
    n = Math.min(n, MAX - this.count)
    for (let k = 0; k < n; k++) {
      const i = this.count++
      // Small jitter around the impact point.
      this._pos[i].set(
        x + (this._rng() - 0.5) * 0.2,
        y + (this._rng() - 0.5) * 0.3,
        z + (this._rng() - 0.5) * 0.2
      )
      // Upward/outward spray.
      const a = this._rng() * Math.PI * 2
      const r = 0.6 + this._rng() * 2.2
      this._vel[i].set(Math.cos(a) * r, 1.0 + this._rng() * 2.5, Math.sin(a) * r)
      this._age[i] = 0
      this._life[i] = LIFE * (0.7 + this._rng() * 0.6)
      this._scale[i] = 0.6 + this._rng() * 0.8
      this._m.compose(this._pos[i], this._q, this._s.set(this._scale[i], this._scale[i], this._scale[i]))
      this._mesh.setMatrixAt(i, this._m)
    }
    if (n > 0) {
      this._mesh.count = this.count
      this._mesh.instanceMatrix.needsUpdate = true
      this._mesh.visible = true
    }
    return n
  }

  /** Per frame: age droplets, apply gravity, settle on the ground, fade out. */
  update(dt) {
    // Age + cull (swap the tail into the dead slot keeps slots 0..count-1 live).
    for (let i = 0; i < this.count; i++) {
      this._age[i] += dt
      if (this._age[i] >= this._life[i]) {
        const j = this.count - 1
        this._pos[i].copy(this._pos[j])
        this._vel[i].copy(this._vel[j])
        this._age[i] = this._age[j]
        this._life[i] = this._life[j]
        this._scale[i] = this._scale[j]
        this._m.compose(this._pos[i], this._q, this._s.set(this._scale[i], this._scale[i], this._scale[i]))
        this._mesh.setMatrixAt(i, this._m)
        this.count--
        i--
      }
    }
    // Integrate + write instance matrices (scale fades to 0 as they age).
    for (let i = 0; i < this.count; i++) {
      const v = this._vel[i]
      v.y += GRAVITY * dt
      const p = this._pos[i]
      p.addScaledVector(v, dt)
      if (p.y < 0) { p.y = 0; v.y = 0; v.x *= 0.6; v.z *= 0.6 } // settle
      const s = this._scale[i] * (1 - this._age[i] / this._life[i])
      this._m.compose(p, this._q, this._s.set(s, s, s))
      this._mesh.setMatrixAt(i, this._m)
    }
    this._mesh.count = this.count
    if (this.count > 0) this._mesh.instanceMatrix.needsUpdate = true
    this._mesh.visible = this.count > 0
  }

  /** Remove all droplets (restart). */
  clear() {
    this.count = 0
    this._mesh.count = 0
    this._mesh.visible = false
  }

  dispose() {
    this.clear()
    if (this.scene && this.scene.remove) this.scene.remove(this._mesh)
    this._mesh.dispose()
    this._geo.dispose()
    this._mat.dispose()
    this._mesh = null
  }
}
