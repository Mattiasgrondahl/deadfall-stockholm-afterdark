import * as THREE from 'three'
import { addStreetlights, addStreetlightPools, addVehicles, addBarricades, addLandmarks, addPlazaHalos, addDangerStrips, addSigns, addOuterStrips, addGroundDressing, addWantedPoster, addRoofDetail, makeFacadeImageTexture } from './cityDressing.js'
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
//
// Realism pass: the facade now ships a NORMAL map (window recesses + vertical
// panel grooves + a grime gradient) and a ROUGHNESS map (glass smoother than
// concrete) alongside the color + emissive maps, so flat boxes read as real
// concrete catching the moon and streetlights.
function facadeGrid(variant) {
  // Deterministic lit-window pattern per variant (LCG, no Math.random).
  let fs = 101 + variant * 37
  const lit = []
  for (let r = 0; r < 8; r++) {
    for (let col = 0; col < 4; col++) {
      lit.push(((fs = (fs * 48271) % 65537) / 65537) < 0.45)
    }
  }
  return lit
}

function drawFacadeTexture(c, variant, emissiveOnly) {
  c.width = 256
  c.height = 256
  const g = c.getContext('2d')
  g.fillStyle = emissiveOnly ? '#000000' : '#ffffff'
  g.fillRect(0, 0, 256, 256)
  const lit = facadeGrid(variant)
  for (let r = 0; r < 8; r++) {
    for (let col = 0; col < 4; col++) {
      const isLit = lit[r * 4 + col]
      const x = col * 64 + 12
      const y = r * 32 + 8
      if (emissiveOnly) {
        if (!isLit) continue
        g.fillStyle = '#ffffff'
      } else {
        g.fillStyle = isLit ? '#d9e2ee' : '#1e2229'
      }
      g.fillRect(x, y, 40, 16)
    }
  }
  const t = new THREE.CanvasTexture(c)
  if (!emissiveOnly) t.colorSpace = THREE.SRGBColorSpace
  return t
}

// Tangent-space normal map: windows are inset (a dark top edge + light bottom
// edge fake the recess), and faint vertical panel grooves run between columns.
// Neutral (128,128,255) base; perturbations are small so it stays subtle.
function drawFacadeNormal(c, variant) {
  c.width = 256
  c.height = 256
  const g = c.getContext('2d')
  g.fillStyle = 'rgb(128,128,255)' // flat surface
  g.fillRect(0, 0, 256, 256)
  // Vertical panel seams: a shadow line on one side, highlight on the other.
  for (let col = 1; col < 4; col++) {
    const x = col * 64
    g.fillStyle = 'rgb(96,128,255)'  // left edge tilts toward -X
    g.fillRect(x - 1, 0, 2, 256)
    g.fillStyle = 'rgb(160,128,255)' // right edge tilts toward +X
    g.fillRect(x + 1, 0, 2, 256)
  }
  // Window recesses: top edge catches less (darker normal), bottom edge more.
  for (let r = 0; r < 8; r++) {
    for (let col = 0; col < 4; col++) {
      const x = col * 64 + 12
      const y = r * 32 + 8
      g.fillStyle = 'rgb(128,96,255)'  // top lip tilts up
      g.fillRect(x, y - 2, 40, 2)
      g.fillStyle = 'rgb(128,160,255)' // bottom lip tilts down
      g.fillRect(x, y + 16, 40, 2)
      g.fillStyle = 'rgb(96,128,255)'  // left jamb
      g.fillRect(x - 2, y, 2, 16)
      g.fillStyle = 'rgb(160,128,255)' // right jamb
      g.fillRect(x + 40, y, 2, 16)
    }
  }
  const t = new THREE.CanvasTexture(c)
  return t
}

// Roughness map: concrete ~0.9 (bright = rough), glass insets darker (smoother,
// so lit windows and their panes catch a specular sheen), with a grime band
// near the base raising roughness further.
function drawFacadeRoughness(c, variant) {
  c.width = 256
  c.height = 256
  const g = c.getContext('2d')
  g.fillStyle = 'rgb(224,224,224)' // concrete: fairly rough
  g.fillRect(0, 0, 256, 256)
  // Grime/weathering gradient: rougher (brighter) toward the street level.
  // Guarded so the headless no-op proxy (whose createLinearGradient returns a
  // bare function, not a gradient) doesn't throw on addColorStop.
  const grad = g.createLinearGradient ? g.createLinearGradient(0, 0, 0, 256) : null
  if (grad && grad.addColorStop) {
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(1, 'rgba(255,255,255,0.25)')
    g.fillStyle = grad
    g.fillRect(0, 0, 256, 256)
  }
  // Glass panes: smooth (dark = low roughness) so they glint.
  for (let r = 0; r < 8; r++) {
    for (let col = 0; col < 4; col++) {
      const x = col * 64 + 12
      const y = r * 32 + 8
      g.fillStyle = 'rgb(60,60,60)'
      g.fillRect(x, y, 40, 16)
    }
  }
  const t = new THREE.CanvasTexture(c)
  return t
}

function makeFacadeTextures(env) {
  const factory = env && env.canvasFactory
  if (typeof factory !== 'function') return null
  if (!factory()) return null // unit tests pass a factory returning null
  const pairs = []
  for (let v = 0; v < 4; v++) {
    pairs.push({
      map: drawFacadeTexture(factory(), v, false),
      emissiveMap: drawFacadeTexture(factory(), v, true),
      normalMap: drawFacadeNormal(factory(), v),
      roughnessMap: drawFacadeRoughness(factory(), v)
    })
  }
  return pairs
}

// Ground detail maps: a wet-asphalt / cracked-pavement look. The normal map
// scatters deterministic cracks + patchy puddle ripples; the roughness map
// darkens puddle patches (smooth, reflective) against rougher dry pavement.
// Headless-safe (canvasFactory null -> returns null).
function makeGroundTextures(env) {
  const factory = env && env.canvasFactory
  if (typeof factory !== 'function') return null
  if (!factory()) return null
  // Normal map: neutral base + deterministic crack strokes.
  const nc = factory()
  nc.width = 256; nc.height = 256
  const ng = nc.getContext('2d')
  ng.fillStyle = 'rgb(128,128,255)'
  ng.fillRect(0, 0, 256, 256)
  let gs = 2024
  const grnd = () => (gs = (gs * 48271) % 65537) / 65537
  ng.strokeStyle = 'rgb(110,128,255)'
  ng.lineWidth = 1
  for (let i = 0; i < 40; i++) {
    const x = grnd() * 256, y = grnd() * 256
    ng.beginPath(); ng.moveTo(x, y)
    ng.lineTo(x + (grnd() - 0.5) * 40, y + (grnd() - 0.5) * 40)
    ng.stroke()
  }
  const normalMap = new THREE.CanvasTexture(nc)
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping
  // Roughness map: dry pavement ~0.85 with darker (smoother) puddle patches.
  const rc = factory()
  rc.width = 256; rc.height = 256
  const rg = rc.getContext('2d')
  rg.fillStyle = 'rgb(216,216,216)'
  rg.fillRect(0, 0, 256, 256)
  gs = 777
  const grnd2 = () => (gs = (gs * 48271) % 65537) / 65537
  rg.fillStyle = 'rgba(40,40,40,0.6)'
  for (let i = 0; i < 14; i++) {
    const x = grnd2() * 256, y = grnd2() * 256, r = 12 + grnd2() * 26
    rg.beginPath(); rg.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2); rg.fill()
  }
  const roughnessMap = new THREE.CanvasTexture(rc)
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping
  return { normalMap, roughnessMap }
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
      // Roughness 0.85 (not 0.95): wet snow catches a soft sheen from the
      // IBL sky and streetlight halos instead of reading as flat matte.
      new THREE.MeshStandardMaterial({ color: 0x93a9c2, roughness: 0.85 })
    )
    // Realism pass: cracked/wet-pavement normal + roughness maps so the ground
    // stops reading as flat card. Headless (canvasFactory null) leaves them off.
    const groundMaps = makeGroundTextures(this.env)
    if (groundMaps) {
      groundMaps.normalMap.repeat.set(24, 24)
      groundMaps.roughnessMap.repeat.set(24, 24)
      ground.material.normalMap = groundMaps.normalMap
      ground.material.normalScale = new THREE.Vector2(0.5, 0.5)
      ground.material.roughnessMap = groundMaps.roughnessMap
      ground.material.needsUpdate = true
    }
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
    // Realism pass (tier 4): a photoreal facade image for the hero buildings —
    // the near ring the player actually walks past. Browser-only; null headless,
    // where the procedural canvas facade stays in place.
    const facadeImage = makeFacadeImageTexture(this.env)
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1d2430, roughness: 0.95, metalness: 0.02 })
    let fv = 113
    const variants = []
    for (const b of buildings) {
      const v = Math.floor(((fv = (fv * 48271) % 65537) / 65537) * 4)
      variants.push(v)
      const facade = new THREE.MeshStandardMaterial({
        color: b.color, roughness: 0.88, metalness: 0.05,
        // V3P-10: emissiveIntensity 1.1 -> 1.5 so lit windows read as warm
        // beacons against the dark facades (checked against metrics below).
        emissive: 0xffa64d, emissiveIntensity: 1.5
      })
      // Hero buildings: within the inner ring (|x|,|z| <= ~13 m of the plaza
      // centre) — the ones the player passes in the opening minutes.
      const hero = facadeImage && Math.abs(b.mesh.position.x) <= 13 && Math.abs(b.mesh.position.z) <= 13
      if (facadePairs) {
        const m = facadePairs[v].map.clone()
        m.repeat.set(b.w / 6, b.h / 21)
        m.needsUpdate = true
        const em = facadePairs[v].emissiveMap.clone()
        em.repeat.set(b.w / 6, b.h / 21)
        em.needsUpdate = true
        const nm = facadePairs[v].normalMap.clone()
        nm.repeat.set(b.w / 6, b.h / 21)
        nm.needsUpdate = true
        const rm = facadePairs[v].roughnessMap.clone()
        rm.repeat.set(b.w / 6, b.h / 21)
        rm.needsUpdate = true
        facade.map = m
        facade.emissiveMap = em
        facade.normalMap = nm
        facade.normalScale = new THREE.Vector2(0.6, 0.6)
        facade.roughnessMap = rm
      }
      // Hero buildings use the photoreal image as the color map (tiled to the
      // facade size); they keep the procedural normal/roughness/emissive maps.
      if (hero) {
        const im = facadeImage.clone()
        im.repeat.set(b.w / 6, b.h / 21)
        im.needsUpdate = true
        facade.map = im
      }
      b.mesh.material = [facade, facade, roofMat, roofMat, facade, facade]
    }
    this._facadeVariants = variants
    // Realism pass (tier 2): rooftop clutter + cornices (2 InstancedMeshes).
    addRoofDetail(group, buildings)

    this.streetlightAnchors = addStreetlights(group)
    addStreetlightPools(group, this.streetlightAnchors)
  this._aabbs.push(...addVehicles(group, collision))
  this._aabbs.push(...addBarricades(group, collision))
  addLandmarks(group)
  addPlazaHalos(group, plazas)
  addDangerStrips(group)
  addOuterStrips(group)
  addGroundDressing(group, this.env && this.env.canvasFactory)
  addSigns(group, plazas)
  // Wanted poster on the center-block building's front face (buildings[0]).
  this._poster = addWantedPoster(group, buildings[0], this.env)
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
        if (mat.normalMap) mat.normalMap.dispose()
        if (mat.roughnessMap) mat.roughnessMap.dispose()
        mat.dispose()
      }
      if (m.isInstancedMesh && m.dispose) m.dispose()
    }
    for (const a of this._aabbs) {
      const i = this.collision.aabbs.indexOf(a)
      if (i >= 0) this.collision.aabbs.splice(i, 1)
    }
    this._aabbs = []
    this._disposed = true
  }
}
