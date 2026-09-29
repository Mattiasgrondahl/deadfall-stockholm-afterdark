import * as THREE from 'three'

// Blood.js — blood particle pool for hits. A single InstancedMesh (≤ MAX
// instances, one draw call) holds short-lived droplets that spray from the
// impact point, fall under gravity, settle on the ground, and fade out over
// ~0.8 s. A second InstancedMesh holds persistent ground stains: dark-red
// discs left behind by every burst (two on a headshot), evicted oldest-first
// at MAX_STAINS, so the street accumulates blood marks as you fight.
// All motion is deterministic (seeded LCG, fixed gravity).
// Invariant: live droplets always occupy instance slots 0..count-1, so
// InstancedMesh's prefix rendering is always correct (stains follow the same
// invariant, slot 0 = oldest). Headless-safe: builds only plain scene-graph
// objects; a null scene is tolerated (the pool still simulates, it just has
// no mesh). Wired from Shotgun/Axe/Pistol/Sword via
// blood.burst(x, y, z, damage, headHit).

const MAX = 300            // droplet pool cap (one mesh, well under the mesh budget)
const LIFE = 0.8          // s before a droplet fades out
const GRAVITY = -9.8
const SEED = 777
const MIN_DROPS = 2
const MAX_DROPS_PER_BURST = 20
const MAX_STAINS = 120
const STAIN_Y = 0.01      // just above the ground plane (no z-fight)

// v3 T14: build one irregular "splat" disc — a fan-triangulated polygon whose
// vertex radii are jittered by a seeded LCG (no Math.random), so the silhouette
// reads as a viscous blood blob instead of a clean circle. All stains share this
// geometry; per-instance non-uniform scale + spin vary its look (see _writeStain).
function makeSplatGeometry() {
  let s = 1337
  const rnd = () => (s = (Math.imul(s, 48271) >>> 0) % 65537) / 65537
  const SEG = 14
  const base = 0.5
  const pos = [0, 0, 0] // center vertex
  const idx = []
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2
    const r = base * (0.62 + rnd() * 0.6) // radius jitter → lumpy edge
    pos.push(Math.cos(a) * r, 0, Math.sin(a) * r)
    idx.push(0, i + 1, ((i + 1) % SEG) + 1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

export class Blood {
  constructor(scene) {
    this.scene = scene || null
    this._seed = SEED
    this._rng = () => (this._seed = (Math.imul(this._seed, 48271) >>> 0) % 65537) / 65537
    // Pool: preallocated flat arrays; `count` live droplets (slots 0..count-1).
    this.count = 0
    this._pos = []
    this._vel = []
    this._age = []
    this._life = []
    this._scale = []
    this._spin = []
    this._color = []
    for (let i = 0; i < MAX; i++) {
      this._pos.push(new THREE.Vector3())
      this._vel.push(new THREE.Vector3())
      this._age.push(0)
      this._life.push(LIFE)
      this._scale.push(1)
      this._spin.push(new THREE.Quaternion())
      this._color.push(new THREE.Color())
    }
    // One mesh for all droplets: flat blood flecks (a thin disc), unlit (cheap).
    // v3: a flat CircleGeometry instead of a 3D tetrahedron so airborne blood
    // reads as flat splatter, not a chunky 3D object with height off the ground.
    // A white base material so per-instance color (varied arterial/venous reds)
    // multiplies in.
    this._geo = new THREE.CircleGeometry(0.05, 6)
    this._mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    this._mesh = new THREE.InstancedMesh(this._geo, this._mat, MAX)
    this._mesh.count = 0
    this._mesh.frustumCulled = false
    this._mesh.visible = false
    if (this.scene && this.scene.add) this.scene.add(this._mesh)
    // Ground stains (Task E): persistent dark-red discs, one InstancedMesh,
    // per-instance color. Prefix invariant: slot 0 = oldest stain.
    this._stainCount = 0
    this._stainPos = []
    this._stainScale = []
    this._stainColor = []
    this._stainRot = []
    this._stainAspect = []
    for (let i = 0; i < MAX_STAINS; i++) {
      this._stainPos.push(new THREE.Vector3())
      this._stainScale.push(1)
      this._stainColor.push(new THREE.Color())
      this._stainRot.push(0)
      this._stainAspect.push(1)
    }
    // v3 T14: stains are irregular viscous splats, not perfect discs. One shared
    // blob polygon (LCG-jittered radii) is stretched non-uniformly + spun per
    // instance, so no two stains read alike. Headless-safe (plain geometry).
    const stainGeo = makeSplatGeometry()
    stainGeo.rotateX(-Math.PI / 2) // flat on the ground, facing up
    const stainMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false })
    this._stainMesh = new THREE.InstancedMesh(stainGeo, stainMat, MAX_STAINS)
    this._stainMesh.count = 0
    this._stainMesh.frustumCulled = false
    this._stainMesh.visible = false
    if (this.scene && this.scene.add) this.scene.add(this._stainMesh)
    // Scratch objects for matrix composition (never allocated per frame).
    this._m = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._s = new THREE.Vector3()
    this._upY = new THREE.Vector3(0, 1, 0)
  }

  get activeCount() { return this.count }

  /**
   * Spray droplets at (x, y, z). Count scales with damage (dmg/4, clamped
   * 2..20); headshot doubles it (clamped to 20). New droplets take the next
   * prefix slots. `dir` (optional {x,z} bullet direction) biases the fan so the
   * spray streaks along the shot rather than puffing symmetrically. Returns the
   * number of droplets spawned (the count tests depend on this).
   */
  burst(x, y, z, damage, headHit = false, dir = null) {
    let n = Math.min(MAX_DROPS_PER_BURST, Math.max(MIN_DROPS, Math.round((damage || 0) / 4)))
    if (headHit) n = Math.min(MAX_DROPS_PER_BURST, n * 2)
    n = Math.min(n, MAX - this.count)
    // Directional bias: a unit-ish forward vector (defaults to straight up-out).
    let fx = 0, fz = 0
    if (dir) {
      const dl = Math.hypot(dir.x || 0, dir.z || 0)
      if (dl > 1e-4) { fx = (dir.x || 0) / dl; fz = (dir.z || 0) / dl }
    }
    for (let k = 0; k < n; k++) {
      const i = this.count++
      // Small jitter around the impact point.
      this._pos[i].set(
        x + (this._rng() - 0.5) * 0.22,
        y + (this._rng() - 0.5) * 0.34,
        z + (this._rng() - 0.5) * 0.22
      )
      // Wider outward/upward spray, biased along the bullet direction so the
      // burst streaks forward instead of puffing evenly.
      const a = this._rng() * Math.PI * 2
      const r = 0.8 + this._rng() * 3.0
      const bias = 1.4 + this._rng() * 2.2
      this._vel[i].set(
        Math.cos(a) * r + fx * bias,
        1.2 + this._rng() * 3.0,
        Math.sin(a) * r + fz * bias
      )
      this._age[i] = 0
      this._life[i] = LIFE * (0.7 + this._rng() * 0.6)
      this._scale[i] = 0.6 + this._rng() * 0.9
      // v3: droplets are flat flecks that lie face-up and only spin in-plane
      // (about world Y), so airborne blood reads as flat splatter rather than a
      // 3D chunk with height off the ground.
      this._spin[i].set(0, 0, 0, 1)
      // Arterial-to-venous red variation (bright red → deep maroon).
      const t = this._rng()
      this._color[i].setRGB(0.55 + t * 0.35, 0.02 + t * 0.05, 0.02 + t * 0.04)
      this._m.compose(this._pos[i], this._spin[i], this._s.set(this._scale[i], this._scale[i], this._scale[i]))
      this._mesh.setMatrixAt(i, this._m)
      this._mesh.setColorAt(i, this._color[i])
    }
    // Persistent ground stain (Task E gore): one per burst, two on a headshot.
    // Stains use the impact point (x, z); they live on the ground plane.
    const stainN = headHit ? 2 : 1
    for (let k = 0; k < stainN; k++) this._addStain(x, z)
    if (n > 0) {
      this._mesh.count = this.count
      this._mesh.instanceMatrix.needsUpdate = true
      if (this._mesh.instanceColor) this._mesh.instanceColor.needsUpdate = true
      this._mesh.visible = true
    }
    return n
  }

  /** Add one stain at (x, z) on the ground plane. Evicts the oldest stain
    * (slot 0) when the pool is full, preserving the prefix invariant. */
  _addStain(x, z) {
    let i
    if (this._stainCount < MAX_STAINS) {
      i = this._stainCount++
    } else {
      // Full pool: evict the oldest (slot 0) and shift the rest down.
      for (let k = 0; k < MAX_STAINS - 1; k++) {
        this._stainPos[k].copy(this._stainPos[k + 1])
        this._stainScale[k] = this._stainScale[k + 1]
        this._stainColor[k].copy(this._stainColor[k + 1])
        this._stainRot[k] = this._stainRot[k + 1]
        this._stainAspect[k] = this._stainAspect[k + 1]
        this._writeStain(k)
      }
      i = MAX_STAINS - 1
    }
    // Small jitter around the impact point so repeated hits don't stack
    // perfectly concentric circles.
    this._stainPos[i].set(x + (this._rng() - 0.5) * 0.35, STAIN_Y, z + (this._rng() - 0.5) * 0.35)
    this._stainScale[i] = 0.8 + this._rng() * 1.1
    // Random in-plane spin so stains read as irregular splats, not identical discs.
    this._stainRot[i] = this._rng() * Math.PI * 2
    // v3 T14: non-uniform aspect so the shared blob stretches into a different
    // silhouette each time (0.6–1.4 across one axis).
    this._stainAspect[i] = 0.6 + this._rng() * 0.8
    // Dark-red variation (linear color; the white base material multiplies it).
    // v3 T14: darker, so the blood reads with contrast against snow.
    const t = this._rng()
    this._stainColor[i].setRGB(0.11 + t * 0.10, 0.003 + t * 0.005, 0.004 + t * 0.005)
    this._writeStain(i)
    this._stainMesh.count = this._stainCount
    this._stainMesh.instanceMatrix.needsUpdate = true
    if (this._stainMesh.instanceColor) this._stainMesh.instanceColor.needsUpdate = true
    this._stainMesh.visible = this._stainCount > 0
  }

  _writeStain(i) {
    // Flat splat: scale x/z sets the radius, y stays 1; spun about Y and
    // stretched along one axis (aspect) for an irregular, non-circular silhouette.
    this._q.setFromAxisAngle(this._upY, this._stainRot[i])
    const s = this._stainScale[i]
    this._m.compose(this._stainPos[i], this._q, this._s.set(s * this._stainAspect[i], 1, s))
    this._stainMesh.setMatrixAt(i, this._m)
    this._stainMesh.setColorAt(i, this._stainColor[i])
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
        this._spin[i].copy(this._spin[j])
        this._color[i].copy(this._color[j])
        this._age[i] = this._age[j]
        this._life[i] = this._life[j]
        this._scale[i] = this._scale[j]
        this._m.compose(this._pos[i], this._spin[i], this._s.set(this._scale[i], this._scale[i], this._scale[i]))
        this._mesh.setMatrixAt(i, this._m)
        this._mesh.setColorAt(i, this._color[i])
        this.count--
        i--
      }
    }
    // Integrate + write instance matrices (scale fades to 0 as they age; the
    // flat fleck spins in-plane about world Y while airborne).
    for (let i = 0; i < this.count; i++) {
      const v = this._vel[i]
      v.y += GRAVITY * dt
      const p = this._pos[i]
      p.addScaledVector(v, dt)
      if (p.y < 0) { p.y = 0; v.y = 0; v.x *= 0.6; v.z *= 0.6 } // settle
      // v3: spin the flat fleck about the world Y axis only (in-plane), so it
      // never tips edge-on and reads as a flat splat for its whole flight.
      if (p.y > 0.02) {
        this._q.setFromAxisAngle(this._upY, dt * 6)
        this._spin[i].premultiply(this._q).normalize()
      }
      const s = this._scale[i] * (1 - this._age[i] / this._life[i])
      this._m.compose(p, this._spin[i], this._s.set(s, s, s))
      this._mesh.setMatrixAt(i, this._m)
    }
    this._mesh.count = this.count
    if (this.count > 0) {
      this._mesh.instanceMatrix.needsUpdate = true
      if (this._mesh.instanceColor) this._mesh.instanceColor.needsUpdate = true
    }
    this._mesh.visible = this.count > 0
  }

  /** Remove all droplets AND stains (restart). */
  clear() {
    this.count = 0
    this._mesh.count = 0
    this._mesh.visible = false
    this._stainCount = 0
    this._stainMesh.count = 0
    this._stainMesh.visible = false
  }

  dispose() {
    this.clear()
    if (this.scene && this.scene.remove) {
      this.scene.remove(this._mesh)
      this.scene.remove(this._stainMesh)
    }
    this._mesh.dispose()
    this._geo.dispose()
    this._mat.dispose()
    this._mesh = null
    this._stainMesh.dispose()
    this._stainMesh.geometry.dispose()
    this._stainMesh.material.dispose()
    this._stainMesh = null
  }
}
