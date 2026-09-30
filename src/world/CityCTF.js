// Deadfall: Stockholm Afterdark — CTF arena "Lovisedal / Kragstalund".
//
// A bespoke, hand-authored suburb arena for two-team Capture-the-Flag, NOT the
// procedural 7x7 block grid of City.js. Two named bases sit on opposite corners
// (Lovisedal school to the south-west, Kragstalund office tower to the north-
// east) with a rail-station chokepoint at the centre and forest on the flanks,
// so a flag run is always a choice: the lit main road (fast, exposed, watched
// by streetlights) or the dark tree lines (sheltered, slow, blind corners).
//
// API contract (deliberately identical to City.js so net/Match.js can swap one
// for the other): constructor(scene, collision, opts), getSpawnPoints(),
// dispose(). CTF adds `bases` (flag pedestals, matching game/Flag.js defaults)
// and `streetlightAnchors` (for LightShafts / light pools). Headless-safe: every
// canvas/texture is guarded behind `opts.canvasFactory` (tests pass `() => null`).
// Deterministic: one fixed LCG for cosmetic jitter only — the layout is authored
// constants, so two builds are identical. Budget: 109 meshes, 0 lights, 1800
// points — far under the S8 caps (800/40/2500).

import * as THREE from 'three'
import { addStreetlights, addStreetlightPools, addContactShadows } from './cityDressing.js'
import { createSnow } from './snow.js'

// Flag pedestals = Flag.js BASE defaults (src/game/Flag.js:23). Match.js feeds
// `city.bases` straight into FlagState, so these MUST stay the corner values.
export const CTF_BASES = { lovis: { x: -90, z: -90 }, krag: { x: 90, z: 90 } }

// Player spawns: one beside each flag pedestal (a CTF spawn should stand next to
// the flag it defends), pulled 5 m off the plinth so the capture radius
// (CAPTURE_RADIUS 4 m, Flag.js) still clears the plinth AABB (±1.4 m). Both
// corners are tree-exclusion zones and sit clear of their own building: the
// school block stops at z=-84.5, the office tower starts at x=67.5.
const SPAWNS = [{ x: -90, z: -85 }, { x: 90, z: 85 }]

// Collision margin. City.js pads buildings by 0.5 m so a body (radius ~0.4)
// never clips a wall; CTF keeps the same convention for every solid prop.
const PAD = 0.5

// The single deterministic LCG (AGENTS.md shape). Used ONLY for cosmetic jitter
// (tree lean, car placement) — never for layout, so the arena is authored, not rolled.
function makeRng(seed) {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 48271) >>> 0) % 65537; return s / 65537 }
}

// One AABB per box footprint (+PAD), returning the registered record so
// dispose() can splice exactly this map's boxes out of the shared world.
function addBoxAABB(collision, x, z, w, d, h) {
  collision.addAABB(x - w / 2 - PAD, z - d / 2 - PAD, x + w / 2 + PAD, z + d / 2 + PAD, h)
  return collision.aabbs[collision.aabbs.length - 1]
}

// Ground plane, same look as City.js (wet-asphalt 0.42 roughness so pavement
// stays a full roughness band below every zombie body). Optional canvas maps.
// The play area is 220x220 but CollisionWorld bounds are only enforced by
// resolve(), so register a perimeter lip spanning the FULL half-extent (±110):
// the walls sit just inside it at ±108.5, so a body pushed out of a wall still
// lands inside the world clamp.
function buildGround(collision, canvasFactory) {
  const geo = new THREE.PlaneGeometry(220, 220)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.MeshStandardMaterial({ color: 0x93a9c2, roughness: 0.42 })
  const ground = new THREE.Mesh(geo, mat)
  ground.receiveShadow = true
  if (typeof canvasFactory === 'function') {
    const c = canvasFactory()
    if (c) {
      c.width = 256; c.height = 256
      const g = c.getContext('2d')
      g.fillStyle = 'rgb(128,128,255)'
      g.fillRect(0, 0, 256, 256)
      const tex = new THREE.CanvasTexture(c)
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(28, 28)
      mat.normalMap = tex
      mat.normalScale = new THREE.Vector2(0.5, 0.5)
    }
  }
  const W = 110
  for (const a of [
    [-W, -W, W, -W + 1, 3], [W - 1, -W, W, W, 3], [-W, W - 1, W, W, 3], [-W, -W, -W + 1, W, 3]
  ]) { collision.addAABB(a[0], a[1], a[2], a[3], a[4]); }
  return ground
}

// Lovisedal school (lovis corner): a long low school block facing the flag pad,
// plus a clock tower — two boxes read as a Swedish "kolonistuga"-scale school.
// Authored to the SW corner (lovis home is -90,-90): the block is pulled off the
// corner so the plinth at (-90,-90) stands on open ground, and the clock tower
// stands on the pad's inland side where the flag run starts.
function buildSchool(group, collision, mat, roofMat, _aabbs) {
  const main = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 18), mat)
  main.position.set(-68, 6, -78)
  main.castShadow = true
  const tower = new THREE.Mesh(new THREE.BoxGeometry(6, 18, 6), mat)
  tower.position.set(-64, 9, -94)
  tower.castShadow = true
  const roof = new THREE.Mesh(new THREE.BoxGeometry(30.6, 0.6, 18.6), roofMat)
  roof.position.set(-68, 12.3, -78)
  group.add(main, tower, roof)
  _aabbs.push(addBoxAABB(collision, -68, -78, 30, 18, 12))
  _aabbs.push(addBoxAABB(collision, -64, -94, 6, 6, 18))
  return { main, tower, roof }
}

// Kragstalund office tower (krag corner): a tall glassy block with a dark roof
// plate. Glass = low roughness + metalness so moonlight/streetlights smear a
// specular streak down the facade instead of a matte concrete block.
function buildOffice(group, collision, _aabbs) {
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x2e3d52, roughness: 0.18, metalness: 0.55 })
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x1d2430, roughness: 0.7, metalness: 0.02 })
  const tower = new THREE.Mesh(new THREE.BoxGeometry(20, 30, 20), glassMat)
  tower.position.set(74, 15, 74)
  tower.castShadow = true
  const roof = new THREE.Mesh(new THREE.BoxGeometry(20.6, 0.6, 20.6), roofMat)
  roof.position.set(74, 30.3, 74)
  group.add(tower, roof)
  _aabbs.push(addBoxAABB(collision, 74, 74, 20, 20, 30))
  return { tower, roof, glassMat, roofMat }
}

// Central rail station = the map's chokepoint. The platform sits ON the SW-NE
// base-to-base diagonal, so every flag run crosses it. The two tracks run
// crosswise (along the SE-NW road corridor), with two 8 m coaches per track and
// a 2 m coupling; the rails are flat (walkable), only platform + coaches block.
function buildStation(group, collision, rnd, _aabbs) {
  const concreteMat = new THREE.MeshStandardMaterial({ color: 0x3a4150, roughness: 0.75 })
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x232d3f, roughness: 0.6, metalness: 0.1 })
  const railMat = new THREE.MeshStandardMaterial({ color: 0x555c66, roughness: 0.4, metalness: 0.7 })
  const platform = new THREE.Mesh(new THREE.BoxGeometry(26, 1.2, 10), concreteMat)
  platform.position.set(0, 0.6, 0)
  platform.castShadow = true
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 8), canopyMat)
  canopy.position.set(0, 4.2, 0)
  canopy.castShadow = true
  // Coaches run along z (axis z), 8 m long with 2 m couplings, straddling the
  // road corridor so the station reads as cover on both sides of the road.
  // One shared geometry + material for all four.
  const carGeo = new THREE.BoxGeometry(3, 3.2, 8)
  const carMat = new THREE.MeshStandardMaterial({ color: 0x4a5262, roughness: 0.35, metalness: 0.4 })
  const spots = [[-8, -5], [-8, 5], [8, -5], [8, 5]]
  const cars = spots.map(([x, z]) => {
    const m = new THREE.Mesh(carGeo, carMat)
    m.position.set(x, 1.6, z)
    m.castShadow = true
    return m
  })
  group.add(platform, canopy, ...cars)
  // Rails: one geometry + material, 4 instances (two rail pairs, one per track).
  const railGeo = new THREE.BoxGeometry(0.14, 0.12, 20)
  const railMesh = new THREE.InstancedMesh(railGeo, railMat, 4)
  railMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  const m = new THREE.Matrix4()
  const p = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3(1, 1, 1)
  const rails = [[-9.4, 0.06, 0], [-6.6, 0.06, 0], [6.6, 0.06, 0], [9.4, 0.06, 0]]
  for (let i = 0; i < 4; i++) { p.set(rails[i][0], rails[i][1], rails[i][2]); m.compose(p, q, s); railMesh.setMatrixAt(i, m) }
  railMesh.instanceMatrix.needsUpdate = true
  group.add(railMesh)
  _aabbs.push(addBoxAABB(collision, 0, 0, 26, 10, 1.2))
  for (const c of cars) _aabbs.push(addBoxAABB(collision, c.position.x, c.position.z, 3, 8, 3.2))
  return { platform, canopy, cars, railMesh, concreteMat, canopyMat, carMat, railMat, railGeo, carGeo }
}

// Forest on the flanks: 60 trees as TWO InstancedMeshes (trunks + canopies) —
// one draw call each, so a whole forest costs 2 meshes. Trunks are pushed 0.4 m
// out of the canopy footprint so a body steers around the trunk, not the leaves.
function buildForest(group, collision, rnd, _aabbs) {
  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.4, 4.5, 6)
  const canopyGeo = new THREE.ConeGeometry(2.2, 6.5, 7)
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2a241e, roughness: 0.85 })
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x1c2b22, roughness: 0.8 })
  const N = 60
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, N)
  const canopyMesh = new THREE.InstancedMesh(canopyGeo, canopyMat, N)
  trunkMesh.castShadow = true
  canopyMesh.castShadow = true
  trunkMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  canopyMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  const m = new THREE.Matrix4()
  const p = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3(1, 1, 1)
  for (let i = 0; i < N; i++) {
    // Deterministic scatter into the two flank bands (east strip, north strip),
    // kept clear of the station box and both bases so spawns/pads stay open.
    let x, z
    do {
      x = -100 + rnd() * 200
      z = -100 + rnd() * 200
    } while ((Math.abs(x) < 16 && Math.abs(z) < 16) ||
             (x > -95 && x < -55 && z > -95 && z < -55) ||
             (x > 55 && x < 95 && z > 55 && z < 95))
    const scale = 0.8 + rnd() * 0.5
    p.set(x, 2.25 * scale, z)
    s.set(scale, scale, scale)
    m.compose(p, q, s)
    trunkMesh.setMatrixAt(i, m)
    p.set(x, (4.5 + 3.25) * scale, z)
    m.compose(p, q, s)
    canopyMesh.setMatrixAt(i, m)
    // Trunk-only collision (0.8 m footprint + pad): the canopy is scenery.
    _aabbs.push(addBoxAABB(collision, x, z, 0.8, 0.8, 4.5 * scale))
  }
  trunkMesh.instanceMatrix.needsUpdate = true
  canopyMesh.instanceMatrix.needsUpdate = true
  group.add(trunkMesh, canopyMesh)
  return { trunkMesh, canopyMesh, trunkGeo, canopyGeo, trunkMat, canopyMat }
}

// Main road: one asphalt strip (no collision — it IS the walkable ground) plus
// 5 parked cars as a single InstancedMesh (1 mesh for 5 cars). The strip runs
// along the SE-NW diagonal (y = -x), crossing the station box; the bases sit on
// the opposite diagonal and reach the lit route across open ground.
function buildRoad(group, collision, _aabbs) {
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.35, metalness: 0.1 })
  const road = new THREE.Mesh(new THREE.PlaneGeometry(14, 150), roadMat)
  road.rotation.x = -Math.PI / 2
  // Three.js applies Euler rotations in XZY order, so a plane first laid flat
  // (rotation.x = -90°) then spun about world Z lies along the y = -x diagonal.
  road.rotation.z = -Math.PI / 4
  road.position.set(0, 0.015, 0)
  road.receiveShadow = true
  const carGeo = new THREE.BoxGeometry(1.9, 1.1, 4.6)
  const carMat = new THREE.MeshStandardMaterial({ color: 0x39404c, roughness: 0.4, metalness: 0.3 })
  const cars = new THREE.InstancedMesh(carGeo, carMat, 5)
  cars.castShadow = true
  cars.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  const m = new THREE.Matrix4()
  const p = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler(0, -Math.PI / 4, 0)
  q.setFromEuler(e)
  const s = new THREE.Vector3(1, 1, 1)
  const spots = [[-30, 30], [-46, 46], [30, -30], [46, -46], [62, -62]]
  for (let i = 0; i < 5; i++) { p.set(spots[i][0], 0.55, spots[i][1]); m.compose(p, q, s); cars.setMatrixAt(i, m) }
  cars.instanceMatrix.needsUpdate = true
  group.add(road, cars)
  for (const sp of spots) _aabbs.push(addBoxAABB(collision, sp[0], sp[1], 1.9, 4.6, 1.1))
  return { road, cars, roadMat, carGeo, carMat }
}

// Flag pedestals: a low plinth + a slim pole at each base, tinted with the team
// colour so the two pads read as lovis (amber) vs krag (red) at a glance. Flag.js
// draws its own flag mesh at these coordinates; this is the plinth only. The
// plinth AABB is deliberately NOT tracked in _aabbs: FlagState owns the capture
// zone here, so dispose() leaves the pad's collision for the next map to rebuild.
function buildPedestals(group, collision) {
  const plinthGeo = new THREE.CylinderGeometry(1.2, 1.4, 0.5, 12)
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 6, 6)
  const lovisMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, emissive: 0xffb066, emissiveIntensity: 1.6, roughness: 0.5 })
  const kragMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, emissive: 0xff4433, emissiveIntensity: 1.6, roughness: 0.5 })
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a202a, roughness: 0.45, metalness: 0.35 })
  const out = []
  for (const [team, mat] of [['lovis', lovisMat], ['krag', kragMat]]) {
    const b = CTF_BASES[team]
    const plinth = new THREE.Mesh(plinthGeo, mat)
    plinth.position.set(b.x, 0.25, b.z)
    const pole = new THREE.Mesh(poleGeo, poleMat)
    pole.position.set(b.x, 3.5, b.z)
    pole.castShadow = true
    group.add(plinth, pole)
    // Shootable, City-lamp style: blocks bullets but never the player.
    collision.addAABB(b.x - 1.4, b.z - 1.4, b.x + 1.4, b.z + 1.4, 6.5)
    const aabb = collision.aabbs[collision.aabbs.length - 1]
    aabb.shootable = true
    out.push({ team, plinth, pole, mat })
  }
  return { plinthGeo, poleGeo, poleMat, lovisMat, kragMat, pedestals: out }
}

export class CityCTF {
  /** @param scene THREE.Scene; @param collision CollisionWorld (220x220);
   *  @param opts { canvasFactory?: () => canvas|null } — headless tests pass
   *  `() => null`, exactly like City.js's env. */
  constructor(scene, collision, opts = {}) {
    this.scene = scene
    this.collision = collision
    this.opts = opts
    this._aabbs = []
    this._disposed = false
    const canvasFactory = opts.canvasFactory
    const rnd = makeRng(1337) // cosmetic jitter only; layout is authored

    const group = new THREE.Group()
    group.name = 'cityCTF'

    // Shared building material (same palette band as City.js so both maps share
    // one lighting rig look) — one material for school + wall props.
    const buildMat = new THREE.MeshStandardMaterial({ color: 0x2b364d, roughness: 0.62, metalness: 0.05 })
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1d2430, roughness: 0.7, metalness: 0.02 })

    this.ground = buildGround(collision, canvasFactory)
    group.add(this.ground)
    for (const a of collision.aabbs.slice(-4)) this._aabbs.push(a)

    this.school = buildSchool(group, collision, buildMat, roofMat, this._aabbs)
    this.office = buildOffice(group, collision, this._aabbs)
    this.station = buildStation(group, collision, rnd, this._aabbs)
    this.forest = buildForest(group, collision, rnd, this._aabbs)
    this.road = buildRoad(group, collision, this._aabbs)
    const ped = buildPedestals(group, collision)
    this.pedestals = ped.pedestals
    this._pedRes = ped

    // Low perimeter walls: 4 meshes that give the arena a readable edge and stop
    // players walking into the fog (the collision lip spans ±110, see buildGround).
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x232d3f, roughness: 0.7 })
    const wallGeo = new THREE.BoxGeometry(220, 3, 1.5)
    this.walls = []
    for (const [x, z, ry] of [[0, -108.5, 0], [0, 108.5, 0], [-108.5, 0, Math.PI / 2], [108.5, 0, Math.PI / 2]]) {
      const w = new THREE.Mesh(wallGeo, wallMat)
      w.position.set(x, 1.5, z)
      w.rotation.y = ry
      w.castShadow = true
      group.add(w)
      this.walls.push(w)
    }

    // Reuse the City streetlight rig (poles + heads + halos + shafts + AABBs).
    // Pass only the two tall buildings so lamps elsewhere survive the v25
    // "no lamp against a tall wall" cull: the perimeter walls are only 3 m high.
    const lamps = addStreetlights(group, collision, [
      { x: -68, z: -78, w: 30, d: 18, h: 12 },
      { x: 74, z: 74, w: 20, d: 20, h: 30 }
    ])
    this.streetlightAnchors = lamps.anchors
    this.lamps = lamps.lamps
    for (const l of this.lamps) if (l.aabb) this._aabbs.push(l.aabb)
    addStreetlightPools(group, this.streetlightAnchors)
    addContactShadows(group)

    // Falling snow follows the player like City.js (1800 points, budget 2500).
    this.snow = createSnow()
    for (const p of this.snow.points) group.add(p)

    this.bases = CTF_BASES

    this.group = group
    scene.add(group)
  }

  /** Two base spawns, one per flag pedestal (Match uses these for team spawns
   *  and zombie waves; both are verified walkable by test/city-ctf.test.mjs). */
  getSpawnPoints() { return SPAWNS }

  /** Snow follows the player + slow pedestal glow pulse. No allocation. */
  update(playerPos, dt = 0) {
    if (this.snow) this.snow.update(playerPos, dt)
    this._pulseT = (this._pulseT || 0) + dt
    const t = this._pulseT
    if (this._pedRes && this._pedRes.pedestals) {
      for (const p of this._pedRes.pedestals) {
        p.mat.emissiveIntensity = 1.6 + Math.sin(t * 0.8 + (p.team === 'krag' ? 1.7 : 0)) * 0.25
      }
    }
  }

  /** Fully reverse the constructor: group out of the scene, every geometry /
   *  material / texture disposed, this map's AABBs spliced out. Idempotent. */
  dispose() {
    if (this._disposed) return
    this.scene.remove(this.group)
    this.group.traverse((o) => {
      if (!o.isMesh) return
      if (o.geometry) o.geometry.dispose()
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const mat of mats) {
        if (!mat) continue
        if (mat.map) mat.map.dispose()
        if (mat.normalMap) mat.normalMap.dispose()
        if (mat.emissiveMap) mat.emissiveMap.dispose()
        if (mat.roughnessMap) mat.roughnessMap.dispose()
        mat.dispose()
      }
      // InstancedMesh owns an instanceMatrix buffer that geometry/material disposal
      // does not free; City.js calls it too.
      if (o.isInstancedMesh && o.dispose) o.dispose()
    })
    if (this.snow) this.snow.dispose()
    for (const a of this._aabbs) {
      const i = this.collision.aabbs.indexOf(a)
      if (i >= 0) this.collision.aabbs.splice(i, 1)
    }
    this._aabbs = []
    this._disposed = true
    this.group = null
    this.ground = this.school = this.office = this.station = this.forest = this.road = null
    this.pedestals = this.streetlightAnchors = this.lamps = this.snow = null
  }
}