import * as THREE from 'three'
import { addStreetlights, addVehicles, addBarricades, addLandmarks, addPlazaHalos, addDangerStrips, addSigns, addOuterStrips } from './cityDressing.js'
import { createSnow } from './snow.js'

const PALETTE = [0x232d3f, 0x2b364d, 0x33415c, 0x273246]
const TINTS = [1.12, 1.0, 0.9, 0.78]
const SPAWNS = [
  [-85, 0], [85, 0], [0, -85], [0, 85],
  [-85, -85], [85, -85], [-85, 85], [85, 85],
  [-12, -12], [12, -12], [-12, 12], [12, 12]
].map(([x, z]) => ({ x, z }))

// Task V3P-5: procedural lit-window facade textures, 4 pattern variants.
// Each 256x256 tile covers a nominal 6 m x 21 m facade (4 cols x 8 rows).
// The color map is white-based so the per-building palette tint (material
// color) still applies; the emissive map marks the lit windows only.
// Headless-safe: `env.canvasFactory()` may be null (unit tests) or a no-op
// proxy canvas (headless Game) — drawing uses fillStyle/fillRect only and
// never a context method's return value, and the texture is never uploaded
// when nothing renders.
function drawFacadeTexture(c, variant, emissiveOnly) {
  c.width = 256
  c.height = 256
  const g = c.getContext('2d')
  g.fillStyle = emissiveOnly ? '#000000' : '#ffffff'
  g.fillRect(0, 0, 256, 256)
  let fs = 101 + variant * 37 // per-variant LCG; no Math.random
  for (let r = 0; r < 8; r++) {
    for (let col = 0; col < 4; col++) {
      const lit = ((fs = (fs * 48271) % 65537) / 65537) < 0.45
      const x = col * 64 + 12
      const y = r * 32 + 8
      if (emissiveOnly) {
        if (!lit) continue
        g.fillStyle = '#ffffff'
      } else {
        g.fillStyle = lit ? '#d9e2ee' : '#1e2229'
      }
      g.fillRect(x, y, 40, 16)
    }
  }
  const t = new THREE.CanvasTexture(c)
  if (!emissiveOnly) t.colorSpace = THREE.SRGBColorSpace
  return t
}

function makeFacadeTextures(env) {
  const factory = env && env.canvasFactory
  if (typeof factory !== 'function') return null
  if (!factory()) return null // unit tests pass a factory returning null
  const pairs = []
  for (let v = 0; v < 4; v++) {
    pairs.push({ map: drawFacadeTexture(factory(), v, false), emissiveMap: drawFacadeTexture(factory(), v, true) })
  }
  return pairs
}

export class City {
  constructor(scene, collision, env) {
    this.scene = scene
    this.collision = collision
    this.env = env
    this._aabbs = []
    this._disposed = false
    let s = 7 // deterministic LCG layout; no Math.random
    const rnd = () => (s = (s * 48271) % 65537) / 65537

    const group = new THREE.Group()
    group.name = 'city'
    const plazas = []

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(180, 180),
      new THREE.MeshStandardMaterial({ color: 0x93a9c2, roughness: 0.95 })
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    group.add(ground)

    const buildings = []
    const building = (x, z, w, d, h, zone) => {
      const color = new THREE.Color(PALETTE[Math.floor(rnd() * 4)]).multiplyScalar(TINTS[zone])
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0.05 })
      )
      mesh.position.set(x, h / 2, z)
      mesh.castShadow = true
      group.add(mesh)
      collision.addAABB(x - w / 2 - 0.5, z - d / 2 - 0.5, x + w / 2 + 0.5, z + d / 2 + 0.5, h)
      this._aabbs.push(collision.aabbs[collision.aabbs.length - 1])
      buildings.push({ mesh, w, d, h, color })
    }

    // Center block (0,0): one 8x4x9 building; registered first -> collision.aabbs[0].
    building(0, 0, 8, 4, 9, 0)

    // 7x7 blocks (pitch 24, size 15): plaza or 4 quadrant buildings (2 m alleys).
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        if (i === 3 && j === 3) continue
        const bx = (i - 3) * 24
        const bz = (j - 3) * 24
        const zone = Math.max(Math.abs(i - 3), Math.abs(j - 3))
        if (rnd() < 0.4) { plazas.push({ x: bx, z: bz }); continue } // plaza: no buildings
        for (let q = 0; q < 4; q++) {
          if (rnd() >= 0.6) continue
          const qx = bx + (q & 1 ? 4.25 : -4.25)
          const qz = bz + (q & 2 ? 4.25 : -4.25)
          building(qx, qz, 5.5, 5.5, 5 + Math.floor(rnd() * 18), zone)
        }
      }
    }

    // Task V3P-5: assign a facade variant per building with a separate LCG
    // (seed 113) so the layout LCG above is untouched; wrap each building in a
    // BoxGeometry material array (facade x4 + shared roof x2). The texture
    // repeat scales the nominal 6 m x 21 m tile to the building's size.
    const facadePairs = makeFacadeTextures(this.env)
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1d2430, roughness: 0.95, metalness: 0.02 })
    let fv = 113
    const variants = []
    for (const b of buildings) {
      const v = Math.floor(((fv = (fv * 48271) % 65537) / 65537) * 4)
      variants.push(v)
      const facade = new THREE.MeshStandardMaterial({
        color: b.color, roughness: 0.88, metalness: 0.05,
        emissive: 0xffa64d, emissiveIntensity: 1.1
      })
      if (facadePairs) {
        const m = facadePairs[v].map.clone()
        m.repeat.set(b.w / 6, b.h / 21)
        m.needsUpdate = true
        const em = facadePairs[v].emissiveMap.clone()
        em.repeat.set(b.w / 6, b.h / 21)
        em.needsUpdate = true
        facade.map = m
        facade.emissiveMap = em
      }
      b.mesh.material = [facade, facade, roofMat, roofMat, facade, facade]
    }
    this._facadeVariants = variants

    this.streetlightAnchors = addStreetlights(group)
  this._aabbs.push(...addVehicles(group, collision))
  this._aabbs.push(...addBarricades(group, collision))
  addLandmarks(group)
  addPlazaHalos(group, plazas)
  addDangerStrips(group)
  addOuterStrips(group)
  addSigns(group, plazas)
  this.plazas = plazas
  this.snow = createSnow()
  for (const p of this.snow.points) group.add(p)
    this.group = group
    scene.add(group)
  }

  getSpawnPoints() { return SPAWNS }
  getPlazaCenters() { return this.plazas }
  getFacadeVariants() { return this._facadeVariants }

  setSnowCount(n) { this.snow.setCount(n) }

  update(playerPos, dt = 0) { this.snow.update(playerPos, dt) }

  dispose() {
    if (this._disposed) return
    this.scene.remove(this.group)
    for (const m of this.group.children) {
      m.geometry.dispose()
      const mats = Array.isArray(m.material) ? m.material : [m.material]
      for (const mat of mats) {
        if (mat.map) mat.map.dispose()
        if (mat.emissiveMap) mat.emissiveMap.dispose()
        mat.dispose()
      }
    }
    for (const a of this._aabbs) {
      const i = this.collision.aabbs.indexOf(a)
      if (i >= 0) this.collision.aabbs.splice(i, 1)
    }
    this._aabbs = []
    this._disposed = true
  }
}
