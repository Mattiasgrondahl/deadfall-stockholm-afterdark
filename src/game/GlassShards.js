import * as THREE from 'three'

// GlassShards.js — a short-lived shard burst when a streetlamp's glass breaks.
// A single InstancedMesh holds a pool of small pale, semi-transparent shards
// that pop outward from the lamp head, fall under gravity, and fade out over
// ~0.7 s. Mirrors the Blood.js droplet pool (prefix invariant, swap-remove,
// deterministic LCG). Headless-safe: a null scene is tolerated. One InstancedMesh
// = one draw call, well under the mesh budget.

const MAX = 60
const LIFE = 0.7
const GRAVITY = -9.8
const SEED = 5150

export class GlassShards {
  constructor(scene) {
    this.scene = scene || null
    this._seed = SEED
    this._rng = () => (this._seed = (Math.imul(this._seed, 48271) >>> 0) % 65537) / 65537
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
    const geo = new THREE.TetrahedronGeometry(0.06)
    const mat = new THREE.MeshBasicMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.8, depthWrite: false })
    this._geo = geo
    this._mat = mat
    this._mesh = new THREE.InstancedMesh(geo, mat, MAX)
    this._mesh.count = 0
    this._mesh.frustumCulled = false
    this._mesh.visible = false
    if (this.scene && this.scene.add) this.scene.add(this._mesh)
    this._m = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._s = new THREE.Vector3()
  }

  get activeCount() { return this.count }

  /** Pop a burst of shards outward + up from (x, y, z). Returns count spawned. */
  burst(x, y, z) {
    const n = Math.min(12, MAX - this.count)
    for (let k = 0; k < n; k++) {
      const i = this.count++
      this._pos[i].set(x + (this._rng() * 2 - 1) * 0.2, y + (this._rng() * 2 - 1) * 0.1, z + (this._rng() * 2 - 1) * 0.2)
      const ang = this._rng() * Math.PI * 2
      const rad = 1.0 + this._rng() * 2.0
      this._vel[i].set(Math.cos(ang) * rad, 1.5 + this._rng() * 2.5, Math.sin(ang) * rad)
      this._age[i] = 0
      this._life[i] = LIFE * (0.7 + this._rng() * 0.6)
      this._scale[i] = 0.6 + this._rng() * 0.8
    }
    return n
  }

  update(dt) {
    let i = 0
    while (i < this.count) {
      this._age[i] += dt
      if (this._age[i] >= this._life[i]) {
        // Swap-remove: move the last live shard into this slot.
        const last = this.count - 1
        if (i !== last) {
          this._pos[i].copy(this._pos[last])
          this._vel[i].copy(this._vel[last])
          this._age[i] = this._age[last]
          this._life[i] = this._life[last]
          this._scale[i] = this._scale[last]
        }
        this.count--
        continue
      }
      this._vel[i].y += GRAVITY * dt
      this._pos[i].addScaledVector(this._vel[i], dt)
      const s = this._scale[i] * (1 - this._age[i] / this._life[i])
      this._q.set(this._rng() * 2 - 1, this._rng() * 2 - 1, this._rng() * 2 - 1, 1).normalize()
      this._s.set(s, s, s)
      this._m.compose(this._pos[i], this._q, this._s)
      this._mesh.setMatrixAt(i, this._m)
      i++
    }
    this._mesh.count = this.count
    if (this.count > 0) this._mesh.instanceMatrix.needsUpdate = true
    this._mesh.visible = this.count > 0
  }

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