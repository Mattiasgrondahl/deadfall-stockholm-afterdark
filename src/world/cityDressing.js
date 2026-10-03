import * as THREE from 'three'

// Task 8b-1: deterministic streetlight dressing for the city group.
// 40 poles (pole + head) + 40 halo sprites sharing one material,
// no collision AABBs, no Math.random.
const STREETS = [-60, -36, -12, 12, 36]
const POLES = [-60, -24, 24, 60]
const OFFSET = 4.2

// Task V2P-9: shared glow map (64x64 white radial gradient); null in headless Node.
export function makeGlowMap() {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas'); c.width = 64; c.height = 64
  const g2 = c.getContext('2d')
  const grad = g2.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g2.fillStyle = grad; g2.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

// Realism pass (tier 3): a vertical light-shaft map — bright at the lamp head,
// fading down and inward toward the ground — to fake a volumetric beam in the
// night air. Null in headless Node.
function makeShaftMap() {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas'); c.width = 32; c.height = 64
  const g = c.getContext('2d')
  const grad = g.createLinearGradient(0, 0, 0, 64)
  grad.addColorStop(0, 'rgba(255,255,255,0.55)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.18)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad; g.fillRect(0, 0, 32, 64)
  // Horizontal falloff so the beam is narrow at the top and soft at the base.
  const hgrad = g.createLinearGradient(0, 0, 32, 0)
  hgrad.addColorStop(0, 'rgba(0,0,0,0.6)')
  hgrad.addColorStop(0.5, 'rgba(0,0,0,0)')
  hgrad.addColorStop(1, 'rgba(0,0,0,0.6)')
  g.globalCompositeOperation = 'destination-out'
  g.fillStyle = hgrad; g.fillRect(0, 0, 32, 64)
  g.globalCompositeOperation = 'source-over'
  return new THREE.CanvasTexture(c)
}

export function addStreetlights(group, collision, buildings) {
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5)
  // v6 visuals (10): roughness 0.6 -> 0.42 so the pole sits in the same
  // painted-metal scenery band as the bus. Poles tonemap to 0.0018 (below the
  // brute body at 0.0703), so brightness already separates them from actors;
  // this only removes the shared roughness band.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a202a, roughness: 0.42, metalness: 0.3 })
  // v19 graphics: the lamp head is no longer a flat box. It is a real
  // luminaire — a dark metal hood (cone shade) over a small emissive bulb,
  // hung from a short arm that curves off the pole toward the street. The hood
  // + arm are dark painted metal (roughness 0.5, under the 0.70 scenery band)
  // and are STATIC (they never change when a lamp breaks), so they are drawn as
  // two InstancedMeshes (40 instances each = 2 draw calls) instead of 80 meshes.
  // Only the emissive bulb stays a per-lamp mesh with its own cloned material,
  // because Lamps.js darkens it on break (see src/game/Lamps.js).
  const headGeo = new THREE.SphereGeometry(0.16, 10, 8)
  const hoodGeo = new THREE.ConeGeometry(0.34, 0.34, 12, 1, true)
  const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6)
  const hoodMat = new THREE.MeshStandardMaterial({ color: 0x181d26, roughness: 0.5, metalness: 0.35, side: THREE.DoubleSide })
  const armMat = new THREE.MeshStandardMaterial({ color: 0x1a202a, roughness: 0.45, metalness: 0.35 })
  // V6 visuals (4): the bulb is a bloom source, so what matters is its
  // luminance AFTER the ACES tone map (renderer.toneMapping = ACESFilmic,
  // exposure 1.2 — src/world/Lighting.js:29-30). 0xffb066×3.2 → lin 1.705 →
  // tonemapped 0.917, i.e. deep into the shoulder where the bloom mip is
  // already saturated and the halo smears the 0.45 m box into a disc. 2.2
  // (lin 1.172 → 0.867) keeps the head a crisp shape while still clearing the
  // 0.72 bloom cut (PostFX BLOOM.threshold), and the 70 cd pool
  // (src/world/Lighting.js POLE_INTENSITY) still lights the pavement on its
  // own, so round 41's readability stands. Halo opacity 0.5→0.30, scale
  // 2.2→1.6: the glow map peaks at alpha 1.0, so at 0.5 the additive disc
  // alone reached 0.45 tonemapped and washed the head out; at 0.30 it sits at
  // 0.286, well under the cut, so the halo glows without re-blooming.
  const headMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffb066, emissiveIntensity: 2.2 })
  const haloMap = makeGlowMap()
  const haloMat = new THREE.SpriteMaterial({ color: 0xffb066, map: haloMap, transparent: true, opacity: 0.30, blending: THREE.AdditiveBlending, depthWrite: false })
  // Realism pass: a shared vertical light-shaft sprite under each lamp head for
  // a soft volumetric beam in the night air.
  const shaftMap = makeShaftMap()
  const shaftMat = new THREE.SpriteMaterial({ color: 0xffc27a, map: shaftMap, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false })
  const anchors = []
  const lamps = []
  // v19 graphics: collect each luminaire's head position + reach axis so the
  // static hood + arm InstancedMeshes can be built after all lamps are placed.
  const headPos = []   // { x, z, axis } axis = 'x' | 'z' the arm reaches along
  const place = (x, z, shaft, axis) => {
    // v25 lamps: a lamp whose head (y 5.05) sits right up against a building
    // taller than it reads as being mounted on that building's wall/roof, which
    // looks wrong. Skip such lamps so every remaining one stands clear on the
    // pavement. `buildings` is the layout's building list ({x,z,w,d,h}).
    if (buildings && buildings.length) {
      for (const b of buildings) {
        if (b.h <= 5.5) continue // short buildings do not dwarf the lamp head
        const bx = b.x !== undefined ? b.x : (b.mesh && b.mesh.position.x)
        const bz = b.z !== undefined ? b.z : (b.mesh && b.mesh.position.z)
        if (bx === undefined || bz === undefined) continue
        const ex = Math.max(Math.abs(x - bx) - b.w / 2, 0)
        const ez = Math.max(Math.abs(z - bz) - b.d / 2, 0)
        if (Math.hypot(ex, ez) < 3) return // too close to a tall building: skip
      }
    }
    const pole = new THREE.Mesh(poleGeo, poleMat)
    pole.castShadow = true
    pole.position.set(x, 2.5, z)
    group.add(pole)
    // Each bulb gets its OWN material clone so a broken lamp can go dark
    // independently while the rest stay lit.
    const hm = headMat.clone()
    const head = new THREE.Mesh(headGeo, hm)
    // The bulb hangs just under the hood at the arm's end, offset toward the
    // street (reaching back -0.55 along the axis) so the luminaire overhangs
    // the pavement it lights.
    const hx = axis === 'x' ? x - 0.55 : x
    const hz = axis === 'z' ? z - 0.55 : z
    head.position.set(hx, 5.05, hz)
    group.add(head)
    const halo = new THREE.Sprite(haloMat); halo.position.set(hx, 5.05, hz); halo.scale.set(1.6, 1.6, 1); group.add(halo) // v6 visuals (4): 2.2→1.6, glow stays inside the head silhouette
    // Shaft hangs from the head down toward the pavement (tall, narrow). Only
    // the vertical-street lamps get one, to stay inside the mesh/sprite budget.
    let shaftSprite = null
    if (shaft) {
      shaftSprite = new THREE.Sprite(shaftMat); shaftSprite.position.set(hx, 2.6, hz); shaftSprite.scale.set(1.6, 5.2, 1); group.add(shaftSprite)
    }
    anchors.push(new THREE.Vector3(hx, 5.05, hz))
    // Shootable: a small AABB around the head so a bullet can hit + break it.
    // Flagged `shootable` so it blocks bullets but NOT the player (a thin pole
    // should not trap movement), and it is excluded from the light pool when
    // broken.
    let aabb = null
    if (collision && collision.addAABB) {
      // v26: the shootable box now spans BOTH the head (hx,hz) and the pole
      // (x,z) — the arm offsets the head 0.55 m from the pole, so a shot aimed
      // at the visible pole used to miss the head-centred 0.6 m box entirely and
      // the lamp could not be broken. Covering the whole column makes every
      // lamp shootable from any angle.
      const minX = Math.min(hx, x) - 0.3
      const maxX = Math.max(hx, x) + 0.3
      const minZ = Math.min(hz, z) - 0.3
      const maxZ = Math.max(hz, z) + 0.3
      collision.addAABB(minX, minZ, maxX, maxZ, 5.3)
      aabb = collision.aabbs[collision.aabbs.length - 1]
      aabb.shootable = true
    }
    lamps.push({ x: hx, z: hz, head, halo, shaft: shaftSprite, material: hm, aabb, broken: false, timer: 0 })
    headPos.push({ x: hx, z: hz, axis })
  }
  // Vertical-street lamps sit at x+OFFSET beside the street line at x, so their
  // arm reaches back in -x toward the street (axis 'x'). Horizontal-street lamps
  // sit at z+OFFSET, arm reaches -z (axis 'z').
  for (const x of STREETS) for (const z of POLES) place(x + OFFSET, z, true, 'x') // vertical streets (with shafts)
  for (const z of STREETS) for (const x of POLES) place(x, z + OFFSET, false, 'z') // horizontal streets (no shafts)
  // v19 graphics: build the two static luminaire parts as InstancedMeshes.
  // The arm is a short cylinder from the pole top to the head; the hood is a
  // cone shade capping the bulb. Both dark painted metal, never lit, never
  // toggled on break — so a single InstancedMesh each (2 draw calls for 40 lamps).
  const _m = new THREE.Matrix4()
  const _q = new THREE.Quaternion()
  const _s = new THREE.Vector3(1, 1, 1)
  const _p = new THREE.Vector3()
  const _axisX = new THREE.Vector3(0, 0, 1) // +y cylinder → x axis: rotate 90° about z
  const _axisZ = new THREE.Vector3(1, 0, 0) // +y cylinder → z axis: rotate 90° about x
  const _down = new THREE.Vector3(1, 0, 0) // flip the cone so its mouth faces down
  const armMesh = new THREE.InstancedMesh(armGeo, armMat, headPos.length)
  const hoodMesh = new THREE.InstancedMesh(hoodGeo, hoodMat, headPos.length)
  armMesh.castShadow = true
  for (let i = 0; i < headPos.length; i++) {
    const hp = headPos[i]
    // Arm: a horizontal cylinder spanning from the pole (0.55 back along the
    // axis) to the head, at the top of the pole (y≈5.1). The head sits at the
    // -axis end, so the arm centre is 0.275 back from the head.
    const ax = hp.axis === 'x' ? hp.x + 0.275 : hp.x
    const az = hp.axis === 'z' ? hp.z + 0.275 : hp.z
    _q.setFromAxisAngle(hp.axis === 'x' ? _axisX : _axisZ, Math.PI / 2)
    _p.set(ax, 5.1, az)
    _m.compose(_p, _q, _s)
    armMesh.setMatrixAt(i, _m)
    // Hood: cone above the bulb, opening downward (default cone apex is +y, so
    // flip it so the wide mouth faces down over the bulb).
    _q.setFromAxisAngle(_down, Math.PI)
    _p.set(hp.x, 5.28, hp.z)
    _m.compose(_p, _q, _s)
    hoodMesh.setMatrixAt(i, _m)
  }
  armMesh.instanceMatrix.needsUpdate = true
  hoodMesh.instanceMatrix.needsUpdate = true
  group.add(armMesh, hoodMesh)
  return { anchors, lamps }
}

export function cityDressingMeshes(group) {
  let n = 0
  group.traverse(o => { if (o.isMesh) n++ })
  return n
}

// Task 8b-2: parked vehicles — 12 vehicles, shared resources, AABBs
// registered into `collision` (same 0.5 m margin convention as City.js).
export function addVehicles(group, collision) {
  const TABLE = [
    { x: 15.2, z: -50, vertical: true },   // 1 (moved: z=-60 straddled horizontal street z=-60)
    { x: 15.2, z: 20, vertical: true },    // 2
    { x: 15.2, z: 45, vertical: true },    // 3 (moved: z=60 straddled horizontal street z=60)
    { x: 39.2, z: -20, vertical: true },   // 4
    { x: 39.2, z: 0, vertical: true },     // 5 (moved off intersection; old z=60 blocked sample (40,60))
    { x: -39.2, z: 0, vertical: true },    // 6 (moved: z=-60 straddled horizontal street z=-60)
    { x: -39.2, z: 40, vertical: true },   // 7
    { x: -15.2, z: -20, vertical: true },  // 8
    { x: -15.2, z: 45, vertical: true },   // 9 (moved: z=60 straddled horizontal street z=60)
    { x: 0, z: 39.2, vertical: false },   // 10 (moved off intersection; old x=-60 blocked (-60,40))
    { x: 20, z: 39.2, vertical: false },   // 11
    { x: 40, z: -15.2, vertical: false },  // 12
  ]
  const bodyGeoV = new THREE.BoxGeometry(1.8, 1.0, 4.5)
  const cabinGeoV = new THREE.BoxGeometry(1.7, 0.9, 2.4)
  const bodyGeoH = new THREE.BoxGeometry(4.5, 1.0, 1.8)
  const cabinGeoH = new THREE.BoxGeometry(2.4, 0.9, 1.7)
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3)
  // v6 visuals (10): roughness 0.6 -> 0.42. Painted metal bus bodies are
  // scenery and must leave the 0.90/0.95 zombie band entirely; 0.42 also
  // sharpens the moonlight (1.45 lx) specular streak along the 4.5 m flank so
  // a parked bus reads as sheet metal, not as a matte block like a body.
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x333b46, roughness: 0.42, metalness: 0.25 })
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x3d4656, roughness: 0.48, metalness: 0.2 })
  // v6 visuals (10): 0.5 -> 0.30. Rubber keeps the lowest roughness of the
  // three bus parts (a tyre is the glossest surface on the vehicle) and the
  // whole bus now sits under 0.5, far below the body band.
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x121418, roughness: 0.3, metalness: 0.35 })
  // Realism pass: glass windshields + head/tail lights. A SINGLE shared
  // InstancedMesh (one draw call) covers all 12 cars — 12 dark glass panels +
  // 24 warm headlights + 24 red taillights — so the mesh budget grows by only
  // 1. Per-instance color drives the look: glass is a dark glossy tone, lights
  // are bright (picked up by bloom). Head/tail lights sit at the cabin front/rear.
  const carGeo = new THREE.BoxGeometry(1.5, 0.5, 0.06)
  const carMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, metalness: 0.5 })
  const carMesh = new THREE.InstancedMesh(carGeo, carMat, 60)
  carMesh.frustumCulled = false
  carMesh.castShadow = false
  carMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  group.add(carMesh)
  const _m = new THREE.Matrix4()
  const _q = new THREE.Quaternion()
  const _e = new THREE.Euler()
  const _s = new THREE.Vector3(1, 1, 1)
  const _p = new THREE.Vector3()
  const GLASS = new THREE.Color(0x0a0e14)
  const HEAD = new THREE.Color(0xfff2cf)
  const TAIL = new THREE.Color(0xff2a1e)
  const aabbs = []
  let ci = 0
  for (const v of TABLE) {
    const bodyGeo = v.vertical ? bodyGeoV : bodyGeoH
    const cabinGeo = v.vertical ? cabinGeoV : cabinGeoH
    const w = v.vertical ? 1.8 : 4.5
    const d = v.vertical ? 4.5 : 1.8
    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.position.set(v.x, 0.5, v.z)
    group.add(body)
    const cabin = new THREE.Mesh(cabinGeo, cabinMat)
    // cabin offset +1.0 along the long axis (same sign for all vehicles)
    if (v.vertical) cabin.position.set(v.x, 1.45, v.z + 1.0)
    else cabin.position.set(v.x + 1.0, 1.45, v.z)
    group.add(cabin)
    // Windshield + lights as instances of the shared car mesh. Vertical cars run
    // along z; horizontal cars along x (windshield rotated 90° about Y).
    if (v.vertical) {
      _e.set(0, 0, 0); _q.setFromEuler(_e)
      _p.set(v.x, 1.5, v.z + 2.2); _m.compose(_p, _q, _s); carMesh.setMatrixAt(ci, _m); carMesh.setColorAt(ci++, GLASS)
      _s.set(0.28, 0.14, 1); _p.set(v.x - 0.55, 0.7, v.z + 2.2); _m.compose(_p, _q, _s); carMesh.setMatrixAt(ci, _m); carMesh.setColorAt(ci++, HEAD)
      _p.set(v.x + 0.55, 0.7, v.z + 2.2); _m.compose(_p, _q, _s); carMesh.setMatrixAt(ci, _m); carMesh.setColorAt(ci++, HEAD)
      _p.set(v.x - 0.55, 0.7, v.z - 2.2); _m.compose(_p, _q, _s); carMesh.setMatrixAt(ci, _m); carMesh.setColorAt(ci++, TAIL)
      _p.set(v.x + 0.55, 0.7, v.z - 2.2); _m.compose(_p, _q, _s); carMesh.setMatrixAt(ci, _m); carMesh.setColorAt(ci++, TAIL)
      _s.set(1, 1, 1)
    } else {
      _e.set(0, Math.PI / 2, 0); _q.setFromEuler(_e)
      _p.set(v.x + 2.2, 1.5, v.z); _m.compose(_p, _q, _s); carMesh.setMatrixAt(ci, _m); carMesh.setColorAt(ci++, GLASS)
      _s.set(0.28, 0.14, 1); _p.set(v.x + 2.2, 0.7, v.z - 0.55); _m.compose(_p, _q, _s); carMesh.setMatrixAt(ci, _m); carMesh.setColorAt(ci++, HEAD)
      _p.set(v.x + 2.2, 0.7, v.z + 0.55); _m.compose(_p, _q, _s); carMesh.setMatrixAt(ci, _m); carMesh.setColorAt(ci++, HEAD)
      _p.set(v.x - 2.2, 0.7, v.z - 0.55); _m.compose(_p, _q, _s); carMesh.setMatrixAt(ci, _m); carMesh.setColorAt(ci++, TAIL)
      _p.set(v.x - 2.2, 0.7, v.z + 0.55); _m.compose(_p, _q, _s); carMesh.setMatrixAt(ci, _m); carMesh.setColorAt(ci++, TAIL)
      _s.set(1, 1, 1)
    }
    // wheels: 0.9 off-center along the width axis, 1.6 along the long axis
    for (const sW of [-1, 1]) {
      for (const sL of [-1, 1]) {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat)
        if (v.vertical) {
          wheel.position.set(v.x + sW * 0.9, 0.35, v.z + sL * 1.6)
          wheel.rotation.z = Math.PI / 2
        } else {
          wheel.position.set(v.x + sL * 1.6, 0.35, v.z + sW * 0.9)
          wheel.rotation.x = Math.PI / 2
        }
        group.add(wheel)
      }
    }
    collision.addAABB(
      v.x - w / 2 - 0.5,
      v.z - d / 2 - 0.5,
      v.x + w / 2 + 0.5,
      v.z + d / 2 + 0.5,
      1.9
    )
    aabbs.push(collision.aabbs[collision.aabbs.length - 1])
  }
  return aabbs
}

// Task 8b-3a: barricades — 8 barricades, 2 planks each (16 meshes),
// shared resources, one AABB registered per barricade (0.5 m margin convention).
export function addBarricades(group, collision) {
  const TABLE = [
    { x: -72, z: 24 },    // 1
    { x: -72, z: 48 },    // 2
    { x: -48, z: -72 },   // 3
    { x: -24, z: 48 },    // 4
    { x: 24, z: -24 },    // 5
    { x: 24, z: 24 },     // 6
    { x: 48, z: 24 },     // 7
    { x: 72, z: -48 },    // 8
  ]
  const plankGeo = new THREE.BoxGeometry(2.5, 0.4, 0.4) // long axis = X
  // v6 visuals (10): roughness 0.85 -> 0.68. Barricade planks are static cover,
  // not actors; they must not sit in the 0.90/0.95 body band. Wood stays the
  // roughest thing in the dressing set (0.68) so it still reads as grainy
  // timber under the moon rather than as painted metal like the bus.
  const plankMat = new THREE.MeshStandardMaterial({ color: 0x5f4734, roughness: 0.68, metalness: 0 })
  const aabbs = []
  // v4 budget (B): 8 barricades × 2 planks = 16 identical meshes sharing one
  // geometry + material. Collapse to ONE InstancedMesh (16 instances). The
  // collision AABBs stay per-barricade (unchanged) — only the render path merges.
  const mesh = new THREE.InstancedMesh(plankGeo, plankMat, TABLE.length * 2)
  mesh.castShadow = true
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scl = new THREE.Vector3(1, 1, 1)
  let i = 0
  for (const { x, z } of TABLE) {
    // 2 planks at the same (x, z): plank 1 center y = 0.5, plank 2 center y = 0.9
    pos.set(x, 0.5, z); m.compose(pos, quat, scl); mesh.setMatrixAt(i++, m)
    pos.set(x, 0.9, z); m.compose(pos, quat, scl); mesh.setMatrixAt(i++, m)
    collision.addAABB(x - 1.75, z - 0.7, x + 1.75, z + 0.7, 1.1)
    aabbs.push(collision.aabbs[collision.aabbs.length - 1])
  }
  mesh.instanceMatrix.needsUpdate = true
  group.add(mesh)
  return aabbs
}

// Task V2P-9: landmark beacons + street directionality — pure readability.
// Shared geometry/material, no collision AABBs, no lights, no Math.random.
export function addLandmarks(group) {
  const glow = makeGlowMap()
  // Center spire: 6 m box on the center tower roof (roof y=9, top y=15).
  // V6 visuals (4): post-tonemap luminance (ACES, exposure 1.2) 0xffc878×2.5 →
  // 0.910 vs ×2.0 → 0.880. The intensity drop is deliberately small: the
  // blow-out came from the halo, not the box. At opacity 0.6 / scale 3 the
  // sprite burned ~7.5 m of sky into a disc and tonemapped to 0.640 — close
  // enough to the 0.72 cut that the halo was blooming itself. 0.38 / scale 2.2
  // sits at 0.428 (under the cut) while 2.0 still clears it, so the tower
  // keeps a crisp glowing crown at distance.
  const spireMat = new THREE.MeshStandardMaterial({ color: 0x14161c, emissive: 0xffc878, emissiveIntensity: 2.0, roughness: 0.6, metalness: 0.1 })
  const spire = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), spireMat)
  spire.castShadow = true
  spire.position.set(0, 12, 0)
  group.add(spire)
  const spireHaloMat = new THREE.SpriteMaterial({ color: 0xffc878, map: glow, transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false })
  const spireHalo = new THREE.Sprite(spireHaloMat); spireHalo.position.set(0, 15, 0); spireHalo.scale.set(2.2, 2.2, 1); group.add(spireHalo)
  // 4 corner beacons at (±84, ±84), marking the diagonal wave spawn zones (±85, ±85).
  const beaconGeo = new THREE.BoxGeometry(0.6, 7, 0.6)
  // V6 visuals (4): 0xff4433 is the dimmest source (post-tonemap 0.681 at
  // intensity 2.0), so its intensity stays pinned — lowering it would drop the
  // corner markers below the 0.72 bloom cut and lose the spawn-zone read. The
  // blow-out was the halo: at opacity 0.5 / scale 2.4 it smeared a 7 m post
  // into a red disc. 0.34 (tonemapped 0.134, far under the cut) / scale 1.8
  // still marks the zone at 3× the 0.6 m post without re-blooming.
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x14161c, emissive: 0xff4433, emissiveIntensity: 2.0, roughness: 0.6, metalness: 0.1 })
  const beaconHaloMat = new THREE.SpriteMaterial({ color: 0xff4433, map: glow, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false })
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const bx = sx * 84
      const bz = sz * 84
      const beacon = new THREE.Mesh(beaconGeo, beaconMat)
      beacon.castShadow = true
      beacon.position.set(bx, 3.5, bz)
      group.add(beacon)
      const halo = new THREE.Sprite(beaconHaloMat); halo.position.set(bx, 7, bz); halo.scale.set(1.8, 1.8, 1); group.add(halo) // v6 visuals (4): 2.4→1.8
    }
  }
  // 10 street strips along street center lines (always walkable, no aabbs).
  // v17: the old fully-saturated unlit blue (0x3d6fa8, MeshBasicMaterial) read
  // as a harsh blue LINE painted across the snow — the user's "blue lines on the
  // ground" complaint. Desaturated toward the snow tone + made translucent +
  // additive so the centerline now reads as a faint icy sheen on the pavement
  // rather than a colored stripe, while still hinting street direction.
  const stripMat = new THREE.MeshBasicMaterial({ color: 0x6f86a6, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })
  const stripGeoV = new THREE.BoxGeometry(0.35, 0.05, 176)
  const stripGeoH = new THREE.BoxGeometry(176, 0.05, 0.35)
  // v4 budget (B): 5 vertical + 5 horizontal strips share one material but were
  // 10 meshes. Collapse to two InstancedMeshes (one per orientation), 10→2.
  const addStrips = (geo, axis) => {
    const mesh = new THREE.InstancedMesh(geo, stripMat, STREETS.length)
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    const m = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scl = new THREE.Vector3(1, 1, 1)
    let i = 0
    for (const c of STREETS) {
      if (axis === 'v') pos.set(c, 0.03, 0); else pos.set(0, 0.03, c)
      m.compose(pos, quat, scl); mesh.setMatrixAt(i++, m)
    }
    mesh.instanceMatrix.needsUpdate = true
    group.add(mesh)
  }
  addStrips(stripGeoV, 'v')
  addStrips(stripGeoH, 'h')
}

// Task V3P-1a: safe-zone language - one shared additive halo material,
// soft amber ground glow at every plaza center. No lights, no aabbs.
export function addPlazaHalos(group, centers) {
  const glow = makeGlowMap()
  const mat = new THREE.SpriteMaterial({ color: 0xffd9a5, map: glow, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
  for (const c of centers) {
    const halo = new THREE.Sprite(mat)
    halo.position.set(c.x, 0.5, c.z)
    halo.scale.set(6, 6, 1)
    group.add(halo)
  }
}

// Task V3P-1b: mark the unlit central cross (streets x=0 / z=0 have no
// streetlight poles) as a danger corridor with ground-level red strips.
// Red = caution (same 0xff4433 as the spawn beacons). y=0.09 keeps the
// strips clear of the blue directional strips (y 0.005..0.055) at crossings.
// No lights, no aabbs, no sprites, no Math.random.
export function addDangerStrips(group) {
  // v17: was a fully-opaque saturated red (0xff4433) that read as a bright red
  // LINE across the snow ("red lines on the ground"). Now a dim, translucent
  // additive ember tint so the danger corridor still reads as caution but no
  // longer as a painted stripe.
  const mat = new THREE.MeshBasicMaterial({ color: 0xff6a52, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false })
  const geoZ = new THREE.BoxGeometry(0.35, 0.05, 76.5) // along z at x=0
  const geoX = new THREE.BoxGeometry(74.5, 0.05, 0.35) // along x at z=0
  const pos = [[0, 0.09, 41.25, geoZ], [0, 0.09, -41.25, geoZ], [42.25, 0.09, 0, geoX], [-42.25, 0.09, 0, geoX]]
  // v4 budget (B): 4 red strips share one material. Group by geometry into two
  // InstancedMeshes (2 each), 4→2. Same look, no per-strip logic.
  const byGeo = new Map()
  for (const [x, y, z, geo] of pos) {
    if (!byGeo.has(geo)) byGeo.set(geo, [])
    byGeo.get(geo).push([x, y, z])
  }
  const m = new THREE.Matrix4()
  const p = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scl = new THREE.Vector3(1, 1, 1)
  for (const [geo, list] of byGeo) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length)
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    let i = 0
    for (const [x, y, z] of list) {
      p.set(x, y, z); m.compose(p, quat, scl); mesh.setMatrixAt(i++, m)
    }
    mesh.instanceMatrix.needsUpdate = true
    group.add(mesh)
  }
}

// Task V3P-1b: safe-zone signage - one post + emissive amber panel per plaza
// center, complementing the V3P-1a ground halos. Amber = safe (0xffd9a5).
// No lights, no aabbs, no Math.random.
export function addSigns(group, centers) {
  const postGeo = new THREE.BoxGeometry(0.12, 1.6, 0.12)
  const postMat = new THREE.MeshStandardMaterial({ color: 0x1a202a, roughness: 0.6, metalness: 0.3 })
  const panelGeo = new THREE.BoxGeometry(0.9, 0.6, 0.1)
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x14161c, emissive: 0xffd9a5, emissiveIntensity: 2.0, roughness: 0.6, metalness: 0.1 })
  // v4 budget (B): one post + one panel per plaza were 2×N meshes sharing two
  // shared geometry/material pairs. Collapse to two InstancedMeshes (posts,
  // panels), 2N→2. Same look, no per-sign logic.
  const n = centers.length
  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scl = new THREE.Vector3(1, 1, 1)
  const posts = new THREE.InstancedMesh(postGeo, postMat, n)
  posts.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  const panels = new THREE.InstancedMesh(panelGeo, panelMat, n)
  panels.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  let i = 0
  for (const c of centers) {
    pos.set(c.x, 0.8, c.z); m.compose(pos, quat, scl); posts.setMatrixAt(i, m)
    pos.set(c.x, 1.7, c.z); m.compose(pos, quat, scl); panels.setMatrixAt(i, m)
    i++
  }
  posts.instanceMatrix.needsUpdate = true
  panels.instanceMatrix.needsUpdate = true
  group.add(posts)
  group.add(panels)
}

// Task V3P-4: street directionality — mark the poleless outer end segments
// of the ten poled street lines (beyond the last poles at |coord| = 60, out
// to the city edge 79.5) with the same red caution language as the danger
// cross. Shared geometry/material, no lights, no AABBs, no sprites, no
// Math.random.
export function addOuterStrips(group) {
  // v17: same softening as the danger cross — a dim additive ember tint instead
  // of an opaque red stripe, so the outer street ends read as a faint caution
  // glow rather than a painted red line on the snow.
  const mat = new THREE.MeshBasicMaterial({ color: 0xff6a52, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false })
  const geoV = new THREE.BoxGeometry(0.35, 0.05, 19.5) // runs along z
  const geoH = new THREE.BoxGeometry(19.5, 0.05, 0.35) // runs along x
  // v4 budget (B): 5 streets × 2 ends × 2 orientations = 20 strips share one
  // material. Collapse to two InstancedMeshes (10 each), 20→2.
  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scl = new THREE.Vector3(1, 1, 1)
  const meshV = new THREE.InstancedMesh(geoV, mat, STREETS.length * 2)
  meshV.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  let i = 0
  for (const x of STREETS) for (const s of [-1, 1]) {
    pos.set(x, 0.09, s * 69.75); m.compose(pos, quat, scl); meshV.setMatrixAt(i++, m)
  }
  meshV.instanceMatrix.needsUpdate = true
  group.add(meshV)
  const meshH = new THREE.InstancedMesh(geoH, mat, STREETS.length * 2)
  meshH.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  i = 0
  for (const z of STREETS) for (const s of [-1, 1]) {
    pos.set(s * 69.75, 0.09, z); m.compose(pos, quat, scl); meshH.setMatrixAt(i++, m)
  }
  meshH.instanceMatrix.needsUpdate = true
  group.add(meshH)
}

// Task V3P-6a: streetlight ground pools — one flat disc per streetlight
// anchor. MeshBasicMaterial (unlit) + additive blending makes every pole
// read as lit even when the point-light pool (12 of 40) is not assigned to
// it. Shared geometry + material, no lights, no AABBs, no sprites.
export function addStreetlightPools(group, anchors) {
  const geo = new THREE.CircleGeometry(1.6, 20)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })
  // v4 budget (B): 40 identical discs shared one geometry + material but were 40
  // separate meshes (40 draw calls). Collapse to ONE InstancedMesh — same look,
  // 40→1 meshes. Positions come straight from the streetlight anchors; no
  // per-pool logic, so instancing is behaviour-preserving.
  const mesh = new THREE.InstancedMesh(geo, mat, anchors.length)
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scl = new THREE.Vector3(1, 1, 1)
  let i = 0
  for (const a of anchors) {
    pos.set(a.x, 0.02, a.z)
    m.compose(pos, quat, scl)
    mesh.setMatrixAt(i++, m)
  }
  mesh.instanceMatrix.needsUpdate = true
  group.add(mesh)
}

// Task V3P-6b: ground dressing — subtle snow-compaction noise map on the
// ground, crosswalks at the four outer intersections, snowdrift patches at
// street corners. Deterministic LCG (seed 77); no Math.random. The ground
// map is skipped when `canvasFactory` is null (unit tests) or absent.
export function addGroundDressing(group, canvasFactory) {
  const ground = group.children[0] // ground plane, registered first by City
  if (typeof canvasFactory === 'function') {
    const c = canvasFactory()
    if (c) {
      c.width = 512
      c.height = 512
      const g = c.getContext('2d')
      // Headless-safe: fillStyle/fillRect and property assignments only.
      g.fillStyle = '#93a9c2'
      g.fillRect(0, 0, 512, 512)
      const light = '#9ab0c9'
      const dark = '#8b9fb8'
      let s = 77
      const rnd = () => (s = (s * 48271) % 65537) / 65537
      for (let i = 0; i < 240; i++) {
        const x = Math.floor(rnd() * 500)
        const y = Math.floor(rnd() * 500)
        const w = 8 + Math.floor(rnd() * 36)
        const h = 8 + Math.floor(rnd() * 36)
        g.fillStyle = rnd() < 0.5 ? light : dark
        g.fillRect(x, y, w, h)
      }
      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(3, 3) // 512 px tile = 60 m; the ground is 180 m
      tex.needsUpdate = true
      // Only apply the snow-compaction noise when no photoreal asphalt map is
      // already present (City.js loads an asphalt image first in the browser).
      // This stops the snow canvas from clobbering the wet-asphalt color map —
      // the "ground reads as snow instead of asphalt" conflict.
      if (!ground.material.map) {
        ground.material.map = tex
        ground.material.color.set(0xffffff) // the map carries the base color
      }
    }
  }
  // Crosswalks: 4 intersections at (+-36, +-36), 2 bands per street. Additive
  // white reads through the snow; y=0.085 sits clear of the blue centerline
  // strips (y=0.03, top at 0.055).
  const mat = new THREE.MeshBasicMaterial({ color: 0xd8e2f0, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
  const geoX = new THREE.BoxGeometry(9, 0.05, 0.9)
  const geoZ = new THREE.BoxGeometry(0.9, 0.05, 9)
  // v4 budget (B): 4 intersections × 2 streets × 2 bands = 16 crosswalk bands
  // share one material across two geometries (8 per orientation). Collapse to
  // two InstancedMeshes (8 each), 16→2. Same look, no per-band logic.
  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scl = new THREE.Vector3(1, 1, 1)
  const bandsX = new THREE.InstancedMesh(geoX, mat, 8)
  const bandsZ = new THREE.InstancedMesh(geoZ, mat, 8)
  bandsX.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  bandsZ.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  let i = 0
  for (const sx of [36, -36]) {
    for (const sz of [36, -36]) {
      for (const s of [3.2, -3.2]) {
        pos.set(sx, 0.085, sz + s); m.compose(pos, quat, scl); bandsX.setMatrixAt(i, m)
        pos.set(sx + s, 0.085, sz); m.compose(pos, quat, scl); bandsZ.setMatrixAt(i, m)
        i++
      }
    }
  }
  bandsX.instanceMatrix.needsUpdate = true
  bandsZ.instanceMatrix.needsUpdate = true
  group.add(bandsX)
  group.add(bandsZ)
  // Snowdrift patches at street corners: flat discs, 2 per intersection,
  // offset off the centerline strips so nothing z-fights.
  const driftGeo = new THREE.CircleGeometry(2.2, 16)
  driftGeo.rotateX(-Math.PI / 2)
  const driftMat = new THREE.MeshStandardMaterial({ color: 0xbcd0e6, roughness: 1 })
  // v4 budget (B): 4 intersections × 2 corners × 2 offsets = 8 drifts share one
  // geometry + material. Collapse to ONE InstancedMesh (8 instances), 8→1.
  const drifts = new THREE.InstancedMesh(driftGeo, driftMat, 8)
  drifts.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  i = 0
  for (const sx of [36, -36]) {
    for (const sz of [36, -36]) {
      for (const s of [2.6, -2.6]) {
        pos.set(sx + s, 0.04, sz + s); m.compose(pos, quat, scl); drifts.setMatrixAt(i++, m)
      }
    }
  }
  drifts.instanceMatrix.needsUpdate = true
  group.add(drifts)
  // v17 snow ground-splash (V2P-7): deterministic snow-accumulation speckles
  // scattered across the WHOLE ground plane, so the pavement reads as fresh
  // snow rather than as flat blue asphalt. Before this the only snow dressing
  // was the 8 corner drifts + a faint compaction noise map, so the ground read
  // ~50% saturated blue (the user's "blue lines on the ground"). One
  // InstancedMesh of small soft white discs laid just above the plane
  // (y=0.012, clear of the 0.005..0.055 strips so nothing z-fights), scaled +
  // rotated per instance from a seeded LCG (no Math.random). 96 patches over
  // the 180 m plane (one mesh, StaticDrawUsage, additive so it brightens the
  // snow without new lights). Headless (canvasFactory null) still adds the
  // mesh — it is geometry-only, so the count is stable in tests.
  const splashGeo = new THREE.CircleGeometry(1, 12)
  splashGeo.rotateX(-Math.PI / 2)
  const splashMat = new THREE.MeshBasicMaterial({ color: 0xeef4ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })
  const SPLASH_N = 96
  const splash = new THREE.InstancedMesh(splashGeo, splashMat, SPLASH_N)
  splash.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  let ss = 1337
  const srnd = () => (ss = (Math.imul(ss, 48271) >>> 0) % 65537) / 65537
  const sq = new THREE.Quaternion()
  const eul = new THREE.Euler()
  const sp = new THREE.Vector3()
  const sc = new THREE.Vector3()
  for (let j = 0; j < SPLASH_N; j++) {
    sp.set((srnd() - 0.5) * 168, 0.012, (srnd() - 0.5) * 168)
    const r = 1.2 + srnd() * 2.6 // patch radius 1.2..3.8 m
    sc.set(r, 1, r * (0.6 + srnd() * 0.7)) // squash into an elongated drift
    eul.set(0, srnd() * Math.PI * 2, 0)
    sq.setFromEuler(eul)
    m.compose(sp, sq, sc)
    splash.setMatrixAt(j, m)
  }
  splash.instanceMatrix.needsUpdate = true
  group.add(splash)
}

// Wanted poster: a weathered "WANTED — DEAD OR ALIVE" placard with a zombie
// portrait, pinned to the front face of the center-block building. The face is
// at z = +d/2 (facing +z, toward the player's south approach). It loads the
// WanGP-generated poster image (browser-only, via TextureLoader); when the image
// is unavailable (missing asset or headless Node) it falls back to a canvas-
// drawn poster so the feature is always visible. A small spotlight above it
// lights the placard so it reads in the dark (the only light dressing adds).
// No collision, no Math.random. Returns the poster mesh (or null when no facade
// is available).
export function addWantedPoster(group, building, env) {
  if (!building || !building.mesh) return null
  const { w, d, h } = building
  const pw = Math.min(2.2, w * 0.5)
  const ph = pw * 1.35
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.0,
    emissive: 0x2a2016,
    // v37 R7: 0.8, measured. poster_v3.jpg is a darker source than the v2
    // portrait it replaces (mean luma 90.7 vs 164.8), so at the old 0.25 the
    // placard read as a regression in the dark: 20.4 rect luma / 11.9 text-band
    // vs v2's 28.5 / 21.9. At 0.8 it is 27.8 / 19.4 — v2 parity — with the
    // highest edge energy of the 0.25/0.5/0.8/1.2 sweep (tools/_poster-emissive
    // .mjs). The lit case is spot-dominated and flat across the sweep, so this
    // knob only buys the unlit read.
    emissiveIntensity: 0.8
  })
  // Load the poster texture. The image map is assigned ONLY once it has decoded
  // (via the loader's onLoad callback) — assigning it up front makes the renderer
  // upload an empty texture and warn "no image data found" (r185). The canvas
  // fallback is already decoded, so it is assigned immediately. When neither is
  // available (headless, no canvasFactory) the material keeps a paper-tan color.
  const map = makePosterTexture(env, (tex) => {
    mat.map = tex
    mat.color.setHex(0xffffff)
    mat.emissiveIntensity = 0.8
    mat.needsUpdate = true
  })
  // Attach the map immediately when we already have a decoded image (canvas
  // fallback) OR a loader texture whose decode will complete shortly. Assigning
  // up front guarantees the material compiles WITH a map define on its first
  // frame — attaching only later (needsUpdate) can leave a cached no-map program
  // that renders the placard blank white. The paper-tan color is the fallback
  // when no texture exists at all (headless / no canvasFactory).
  if (map) {
    mat.map = map
    mat.color.setHex(0xffffff)
    mat.emissiveIntensity = 0.8
  } else {
    mat.color.setHex(0xd8c9a0)
    mat.emissiveIntensity = 0.6
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat)
  mesh.castShadow = false
  // Front face of the box is at local +z = d/2; nudge 0.02 off the wall so the
  // poster never z-fights the facade. Vertically centred a bit above eye level.
  mesh.position.set(building.mesh.position.x, Math.min(h - ph / 2 - 0.3, 1.7 + ph / 2), building.mesh.position.z + d / 2 + 0.02)
  group.add(mesh)
  // v23: a small spotlight above the placard so the WANTED poster reads in the
  // dark. It sits just above the top edge and ~0.9 m out from the wall (on the
  // player's +z side), aimed down-forward at the poster centre. Warm 0xffd9a0
  // matches the streetlights; a tight ~35° cone with a short 6 m range keeps the
  // pool of light on the placard without spilling into the street or eating the
  // 40-light budget (this is the only light added by dressing). No shadows
  // (castShadow stays off scene-wide for cost). The target is parented to the
  // group so it moves with the world and is torn down with it.
  const light = new THREE.SpotLight(0xffd9a0, 2.4, 6, Math.PI / 5, 0.4, 2)
  light.position.set(building.mesh.position.x, mesh.position.y + ph / 2 + 0.5, building.mesh.position.z + d / 2 + 0.9)
  light.castShadow = false
  const target = new THREE.Object3D()
  target.position.copy(mesh.position)
  light.target = target
  group.add(light)
  group.add(target)
  return mesh
}

// Build the poster texture: prefer the generated image (browser), else draw a
// WANTED placard on a canvas (browser or any canvasFactory), else null.
function makePosterTexture(env, onLoaded) {
  if (typeof document !== 'undefined') {
    try {
      const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/'
      // v37 R7: the wanted poster is the generated skull plate (poster_v3.jpg).
      // The filename is the cache key — the prod server sends
      // Cache-Control immutable max-age=1yr, so a new image must ship under a new
      // name (v25 shipped poster_v2.jpg the same way); replacing in place leaves
      // clients on the cached picture. onError leaves the paper-tan fallback.
      const url = base.replace(/\/$/, '') + '/assets/posters/poster_v3.jpg'
      // onLoad fires once the JPEG has decoded; that is when we attach it to the
      // material (see addWantedPoster). onError leaves the paper-tan fallback.
      const tex = new THREE.TextureLoader().load(url, (t) => { if (onLoaded) onLoaded(t) })
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 4
      return tex
    } catch (err) { /* fall through to canvas */ }
  }
  const factory = env && env.canvasFactory
  if (typeof factory !== 'function') return null
  const c = factory()
  if (!c) return null
  c.width = 256; c.height = 340
  const g = c.getContext('2d')
  g.fillStyle = '#d8c9a0'; g.fillRect(0, 0, 256, 340)
  g.fillStyle = '#2a2016'; g.fillRect(0, 0, 256, 8)
  g.fillRect(0, 332, 256, 8)
  g.textAlign = 'center'
  g.fillStyle = '#1a140c'
  g.font = 'bold 56px Georgia, serif'
  g.fillText('WANTED', 128, 74)
  // Zombie portrait: a pale skull-ish face with hollow eyes and a snarl.
  g.fillStyle = '#7d8a72'
  g.beginPath(); g.ellipse(128, 176, 58, 74, 0, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#10130f'
  g.beginPath(); g.ellipse(104, 158, 15, 19, 0, 0, Math.PI * 2); g.fill()
  g.beginPath(); g.ellipse(152, 158, 15, 19, 0, 0, Math.PI * 2); g.fill()
  g.fillRect(104, 210, 48, 16) // open snarling mouth
  g.fillStyle = '#1a140c'
  g.font = 'bold 26px Georgia, serif'
  g.fillText('DEAD OR ALIVE', 128, 288)
  g.font = 'bold 22px Georgia, serif'
  g.fillText('REWARD 500', 128, 318)
  return new THREE.CanvasTexture(c)
}

// Realism pass (graphics tier 2): rooftop clutter + cornices as two InstancedMeshes.
// Each InstancedMesh counts as ONE mesh toward the 600-mesh budget, so this adds
// exactly 2 meshes while giving every building a broken-up silhouette (AC units,
// vents, water tanks) and a roofline lip. Deterministic placement from a fresh
// LCG (no Math.random); headless-safe (geometry/material still built, just never
// rendered). Returns the two meshes so City can add them to the group.
export function addRoofDetail(group, buildings) {
  if (!buildings || !buildings.length) return []
  let s = 4242
  const rnd = () => (s = (s * 48271) % 65537) / 65537

  // Rooftop clutter: small boxes scattered on tops. Cap instances at a fixed
  // count; unused instances are collapsed to zero scale.
  const MAX_CLUTTER = 160
  const clutterGeo = new THREE.BoxGeometry(1, 1, 1)
  const clutterMat = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.9, metalness: 0.1 })
  const clutter = new THREE.InstancedMesh(clutterGeo, clutterMat, MAX_CLUTTER)
  clutter.castShadow = true
  clutter.receiveShadow = false
  clutter.instanceMatrix.setUsage(THREE.StaticDrawUsage)

  // Cornice: a thin horizontal lip near the roofline of each building.
  const corniceGeo = new THREE.BoxGeometry(1, 0.5, 1)
  const corniceMat = new THREE.MeshStandardMaterial({ color: 0x1a2130, roughness: 0.92, metalness: 0.04 })
  const cornice = new THREE.InstancedMesh(corniceGeo, corniceMat, buildings.length)
  cornice.castShadow = true
  cornice.receiveShadow = false
  cornice.instanceMatrix.setUsage(THREE.StaticDrawUsage)

  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const quat = new THREE.Quaternion()

  let ci = 0
  for (const b of buildings) {
    const bx = b.mesh.position.x
    const bz = b.mesh.position.z
    const top = b.h
    // 2-4 clutter pieces per building, within the footprint.
    const n = 2 + Math.floor(rnd() * 3)
    for (let k = 0; k < n && ci < MAX_CLUTTER; k++) {
      const cw = 0.6 + rnd() * 1.2
      const cd = 0.6 + rnd() * 1.2
      const ch = 0.5 + rnd() * 1.4
      const ox = (rnd() - 0.5) * Math.max(0, b.w - cw)
      const oz = (rnd() - 0.5) * Math.max(0, b.d - cd)
      pos.set(bx + ox, top + ch / 2, bz + oz)
      scl.set(cw, ch, cd)
      m.compose(pos, quat, scl)
      clutter.setMatrixAt(ci++, m)
    }
    // Cornice lip: slightly wider/deeper than the footprint, just under the top.
    pos.set(bx, top - 0.25, bz)
    scl.set(b.w + 0.4, 0.5, b.d + 0.4)
    m.compose(pos, quat, scl)
    cornice.setMatrixAt(buildings.indexOf(b), m)
  }
  // Collapse unused clutter instances to zero scale (harmless, invisible).
  for (; ci < MAX_CLUTTER; ci++) {
    pos.set(0, -9999, 0); scl.set(0, 0, 0)
    m.compose(pos, quat, scl)
    clutter.setMatrixAt(ci, m)
  }
  clutter.instanceMatrix.needsUpdate = true
  cornice.instanceMatrix.needsUpdate = true
  group.add(clutter, cornice)
  return [clutter, cornice]
}

// Realism pass (tier 4): WanGP-generated photoreal facade image (browser-only,
// via TextureLoader). Returns a loaded texture, or null in headless Node so the
// procedural canvas facade stays in place. The caller repeats it per building.
export function makeFacadeImageTexture(env) {
  if (typeof document === 'undefined') return null
  try {
    const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/'
    const url = base.replace(/\/$/, '') + '/assets/facades/facade.jpg'
    const tex = new THREE.TextureLoader().load(url)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    return tex
  } catch (err) {
    return null
  }
}

// Realism pass (tier 3): soft contact-shadow decals under grounded props.
// One InstancedMesh of dark radial-gradient discs (1 mesh, 20 instances: 12
// vehicles + 8 barricades) laid flat just above the ground, so props read as
// resting on the pavement instead of floating. Uses the same additive-style
// transparent material (normal blending, depthWrite off) so it darkens the
// ground without new lights. Browser-only texture; headless keeps the mesh but
// never renders it. No collision, no lights, no Math.random.
function makeShadowDecalMap() {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas'); c.width = 64; c.height = 64
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(0,0,0,0.55)')
  grad.addColorStop(0.5, 'rgba(0,0,0,0.28)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

export function addContactShadows(group) {
  const VEH = [
    { x: 15.2, z: -50, vertical: true }, { x: 15.2, z: 20, vertical: true },
    { x: 15.2, z: 45, vertical: true }, { x: 39.2, z: -20, vertical: true },
    { x: 39.2, z: 0, vertical: true }, { x: -39.2, z: 0, vertical: true },
    { x: -39.2, z: 40, vertical: true }, { x: -15.2, z: -20, vertical: true },
    { x: -15.2, z: 45, vertical: true }, { x: 0, z: 39.2, vertical: false },
    { x: 20, z: 39.2, vertical: false }, { x: 40, z: -15.2, vertical: false }
  ]
  const BAR = [
    { x: -72, z: 24 }, { x: -72, z: 48 }, { x: -48, z: -72 }, { x: -24, z: 48 },
    { x: 24, z: -24 }, { x: 24, z: 24 }, { x: 48, z: 24 }, { x: 72, z: -48 }
  ]
  const count = VEH.length + BAR.length
  const geo = new THREE.PlaneGeometry(1, 1)
  const map = makeShadowDecalMap()
  const mat = new THREE.MeshBasicMaterial({
    color: map ? 0xffffff : 0x000000,
    map: map || null,
    transparent: true,
    opacity: map ? 1 : 0.4,
    depthWrite: false
  })
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.02
  mesh.renderOrder = 1
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scl = new THREE.Vector3()
  let i = 0
  for (const v of VEH) {
    // Vehicle footprint ~1.8 x 4.5; pad the disc a little past it.
    const sx = (v.vertical ? 1.8 : 4.5) * 1.5
    const sz = (v.vertical ? 4.5 : 1.8) * 1.5
    pos.set(v.x, 0, v.z)
    scl.set(sx, sz, 1)
    m.compose(pos, quat, scl)
    mesh.setMatrixAt(i++, m)
  }
  for (const b of BAR) {
    pos.set(b.x, 0, b.z)
    scl.set(3.4, 2.0, 1)
    m.compose(pos, quat, scl)
    mesh.setMatrixAt(i++, m)
  }
  mesh.instanceMatrix.needsUpdate = true
  group.add(mesh)
  return mesh
}

// Realism pass (tier 4): WanGP-generated photoreal wet-asphalt ground image
// (browser-only, via TextureLoader). Returns a loaded texture, or null in
// headless Node so the procedural ground maps stay in place.
export function makeGroundImageTexture(env) {
  if (typeof document === 'undefined') return null
  try {
    const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/'
    const url = base.replace(/\/$/, '') + '/assets/ground/asphalt.jpg'
    // No onLoad that forces an upload: TextureLoader already flags the texture
    // when the image decodes. Callers must NOT set needsUpdate before the image
    // arrives, or three warns "Texture marked for update but no image data
    // found." (r185). The clone sites in City.js mark their clones inside the
    // source's onLoad instead.
    const tex = new THREE.TextureLoader().load(url)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    return tex
  } catch (err) {
    return null
  }
}
