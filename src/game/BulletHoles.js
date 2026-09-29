import * as THREE from 'three'

// BulletHoles.js — persistent bullet-hole decals for walls/buildings. A single
// InstancedMesh holds small dark scorch discs left where a bullet strikes a
// surface, oriented to the surface normal, evicted oldest-first at MAX_HOLES.
// Mirrors the Blood.js ground-stain pool (prefix invariant: slot 0 = oldest).
// All deterministic (seeded LCG); headless-safe (a null scene is tolerated —
// the pool still tracks holes, it just has no mesh). Wired from Shotgun/Pistol
// via bulletHoles.spawn(x, y, z, normal) when a shot hits a wall and no zombie
// absorbed it. One InstancedMesh = one draw call, well under the mesh budget.

const MAX_HOLES = 160
const SEED = 2024

export class BulletHoles {
  constructor(scene) {
    this.scene = scene || null
    this._seed = SEED
    this._rng = () => (this._seed = (Math.imul(this._seed, 48271) >>> 0) % 65537) / 65537
    this.count = 0
    this._pos = []
    this._quat = []
    this._scale = []
    for (let i = 0; i < MAX_HOLES; i++) {
      this._pos.push(new THREE.Vector3())
      this._quat.push(new THREE.Quaternion())
      this._scale.push(1)
    }
    // A small dark disc (scorch) with a tiny punched-hole look via a radial
    // alpha map generated on a canvas (browser only; null headless).
    const geo = new THREE.CircleGeometry(0.05, 10)
    const mat = new THREE.MeshBasicMaterial({
      color: 0x140b0a, transparent: true, opacity: 0.9, depthWrite: false,
      map: makeHoleMap(), side: THREE.DoubleSide
    })
    this._mat = mat
    this._geo = geo
    this._mesh = new THREE.InstancedMesh(geo, mat, MAX_HOLES)
    this._mesh.count = 0
    this._mesh.frustumCulled = false
    this._mesh.visible = false
    if (this.scene && this.scene.add) this.scene.add(this._mesh)
    // Scratch objects (never allocated per spawn).
    this._m = new THREE.Matrix4()
    this._up = new THREE.Vector3(0, 0, 1)
    this._n = new THREE.Vector3()
    this._s = new THREE.Vector3()
  }

  get activeCount() { return this.count }

  /**
   * Add one bullet hole at (x, y, z) oriented to the surface `normal`
   * ({x,y,z} or {x,z}). Evicts the oldest hole when the pool is full.
   */
  spawn(x, y, z, normal) {
    let i
    if (this.count < MAX_HOLES) {
      i = this.count++
    } else {
      // Full: evict the oldest (slot 0) and shift the rest down.
      for (let k = 0; k < MAX_HOLES - 1; k++) {
        this._pos[k].copy(this._pos[k + 1])
        this._quat[k].copy(this._quat[k + 1])
        this._scale[k] = this._scale[k + 1]
        this._write(k)
      }
      i = MAX_HOLES - 1
    }
    // Nudge the hole slightly off the surface toward the viewer so it does not
    // z-fight with the wall.
    const nx = normal ? (normal.x || 0) : 0
    const nz = normal ? (normal.z || 0) : 0
    const ny = normal && typeof normal.y === 'number' ? normal.y : 0
    const off = 0.02
    this._pos[i].set(x + nx * off, y + ny * off, z + nz * off)
    // Orient the disc's +Z axis along the surface normal.
    this._n.set(nx, ny, nz)
    if (this._n.lengthSq() < 1e-6) this._n.set(0, 1, 0)
    this._n.normalize()
    this._quat[i].setFromUnitVectors(this._up, this._n)
    // Small random spin about the normal + a slight size jitter so holes vary.
    const spin = new THREE.Quaternion().setFromAxisAngle(this._n, this._rng() * Math.PI * 2)
    this._quat[i].premultiply(spin)
    this._scale[i] = 0.7 + this._rng() * 0.6
    this._write(i)
    this._mesh.count = this.count
    this._mesh.instanceMatrix.needsUpdate = true
    this._mesh.visible = this.count > 0
  }

  _write(i) {
    this._s.set(this._scale[i], this._scale[i], this._scale[i])
    this._m.compose(this._pos[i], this._quat[i], this._s)
    this._mesh.setMatrixAt(i, this._m)
  }

  /** Remove all holes (restart). */
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
    if (this._mat.map) this._mat.map.dispose()
    this._mat.dispose()
    this._mesh = null
  }
}

// Radial scorch map: a dark center fading to transparent at the rim (browser
// only; null headless so the decal still works as a plain dark disc).
function makeHoleMap() {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas'); c.width = 32; c.height = 32
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16)
  grad.addColorStop(0, 'rgba(0,0,0,1)')
  grad.addColorStop(0.5, 'rgba(20,11,10,0.9)')
  grad.addColorStop(1, 'rgba(20,11,10,0)')
  g.fillStyle = grad; g.fillRect(0, 0, 32, 32)
  return new THREE.CanvasTexture(c)
}