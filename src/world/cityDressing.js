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

export function addStreetlights(group) {
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5)
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a202a, roughness: 0.6, metalness: 0.3 })
  const headGeo = new THREE.BoxGeometry(0.45, 0.18, 0.45)
  const headMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffb066, emissiveIntensity: 3.2 })
  const haloMap = makeGlowMap()
const haloMat = new THREE.SpriteMaterial({ color: 0xffb066, map: haloMap, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
  const anchors = []
  const place = (x, z) => {
    const pole = new THREE.Mesh(poleGeo, poleMat)
    pole.castShadow = true
    pole.position.set(x, 2.5, z)
    group.add(pole)
    const head = new THREE.Mesh(headGeo, headMat)
    head.position.set(x, 5.2, z)
    group.add(head)
    const halo = new THREE.Sprite(haloMat); halo.position.set(x, 5.2, z); halo.scale.set(2.2, 2.2, 1); group.add(halo)
    anchors.push(new THREE.Vector3(x, 5.2, z))
  }
  for (const x of STREETS) for (const z of POLES) place(x + OFFSET, z) // vertical streets
  for (const z of STREETS) for (const x of POLES) place(x, z + OFFSET) // horizontal streets
  return anchors
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
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x333b46, roughness: 0.6, metalness: 0.25 })
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x3d4656, roughness: 0.65, metalness: 0.2 })
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x121418, roughness: 0.5, metalness: 0.35 })
  const aabbs = []
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
  const plankMat = new THREE.MeshStandardMaterial({ color: 0x5f4734, roughness: 0.85, metalness: 0 })
  const aabbs = []
  for (const { x, z } of TABLE) {
    // 2 planks at the same (x, z): plank 1 center y = 0.5, plank 2 center y = 0.9
    const plank1 = new THREE.Mesh(plankGeo, plankMat)
    plank1.position.set(x, 0.5, z)
    group.add(plank1)
    const plank2 = new THREE.Mesh(plankGeo, plankMat)
    plank2.position.set(x, 0.9, z)
    group.add(plank2)
    collision.addAABB(x - 1.75, z - 0.7, x + 1.75, z + 0.7, 1.1)
    aabbs.push(collision.aabbs[collision.aabbs.length - 1])
  }
  return aabbs
}

// Task V2P-9: landmark beacons + street directionality — pure readability.
// Shared geometry/material, no collision AABBs, no lights, no Math.random.
export function addLandmarks(group) {
  const glow = makeGlowMap()
  // Center spire: 6 m box on the center tower roof (roof y=9, top y=15).
  const spireMat = new THREE.MeshStandardMaterial({ color: 0x14161c, emissive: 0xffc878, emissiveIntensity: 2.5, roughness: 0.6, metalness: 0.1 })
  const spire = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), spireMat)
  spire.castShadow = true
  spire.position.set(0, 12, 0)
  group.add(spire)
  const spireHaloMat = new THREE.SpriteMaterial({ color: 0xffc878, map: glow, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })
  const spireHalo = new THREE.Sprite(spireHaloMat); spireHalo.position.set(0, 15, 0); spireHalo.scale.set(3, 3, 1); group.add(spireHalo)
  // 4 corner beacons at (±84, ±84), marking the diagonal wave spawn zones (±85, ±85).
  const beaconGeo = new THREE.BoxGeometry(0.6, 7, 0.6)
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x14161c, emissive: 0xff4433, emissiveIntensity: 2.0, roughness: 0.6, metalness: 0.1 })
  const beaconHaloMat = new THREE.SpriteMaterial({ color: 0xff4433, map: glow, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const bx = sx * 84
      const bz = sz * 84
      const beacon = new THREE.Mesh(beaconGeo, beaconMat)
      beacon.castShadow = true
      beacon.position.set(bx, 3.5, bz)
      group.add(beacon)
      const halo = new THREE.Sprite(beaconHaloMat); halo.position.set(bx, 7, bz); halo.scale.set(2.4, 2.4, 1); group.add(halo)
    }
  }
  // 10 street strips along street center lines (always walkable, no aabbs).
  const stripMat = new THREE.MeshBasicMaterial({ color: 0x3d6fa8 })
  const stripGeoV = new THREE.BoxGeometry(0.35, 0.05, 176)
  const stripGeoH = new THREE.BoxGeometry(176, 0.05, 0.35)
  for (const x of STREETS) {
    const strip = new THREE.Mesh(stripGeoV, stripMat)
    strip.castShadow = false
    strip.position.set(x, 0.03, 0)
    group.add(strip)
  }
  for (const z of STREETS) {
    const strip = new THREE.Mesh(stripGeoH, stripMat)
    strip.castShadow = false
    strip.position.set(0, 0.03, z)
    group.add(strip)
  }
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
  const mat = new THREE.MeshBasicMaterial({ color: 0xff4433 })
  const geoZ = new THREE.BoxGeometry(0.35, 0.05, 76.5) // along z at x=0
  const geoX = new THREE.BoxGeometry(74.5, 0.05, 0.35) // along x at z=0
  const pos = [[0, 0.09, 41.25, geoZ], [0, 0.09, -41.25, geoZ], [42.25, 0.09, 0, geoX], [-42.25, 0.09, 0, geoX]]
  for (const [x, y, z, geo] of pos) {
    const strip = new THREE.Mesh(geo, mat)
    strip.castShadow = false
    strip.position.set(x, y, z)
    group.add(strip)
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
  for (const c of centers) {
    const post = new THREE.Mesh(postGeo, postMat)
    post.castShadow = false
    post.position.set(c.x, 0.8, c.z)
    group.add(post)
    const panel = new THREE.Mesh(panelGeo, panelMat)
    panel.castShadow = false
    panel.position.set(c.x, 1.7, c.z)
    group.add(panel)
  }
}

// Task V3P-4: street directionality — mark the poleless outer end segments
// of the ten poled street lines (beyond the last poles at |coord| = 60, out
// to the city edge 79.5) with the same red caution language as the danger
// cross. Shared geometry/material, no lights, no AABBs, no sprites, no
// Math.random.
export function addOuterStrips(group) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xff4433 })
  const geoV = new THREE.BoxGeometry(0.35, 0.05, 19.5) // runs along z
  const geoH = new THREE.BoxGeometry(19.5, 0.05, 0.35) // runs along x
  for (const x of STREETS) {
    for (const s of [-1, 1]) {
      const strip = new THREE.Mesh(geoV, mat)
      strip.castShadow = false
      strip.position.set(x, 0.09, s * 69.75)
      group.add(strip)
    }
  }
  for (const z of STREETS) {
    for (const s of [-1, 1]) {
      const strip = new THREE.Mesh(geoH, mat)
      strip.castShadow = false
      strip.position.set(s * 69.75, 0.09, z)
      group.add(strip)
    }
  }
}
