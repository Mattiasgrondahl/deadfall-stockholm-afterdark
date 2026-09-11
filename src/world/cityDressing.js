import * as THREE from 'three'

// Task 8b-1: deterministic streetlight dressing for the city group.
// 40 poles (5 vertical streets x 4 + 5 horizontal streets x 4),
// 8 shared resources, no collision AABBs, no Math.random.
const STREETS = [-60, -36, -12, 12, 36]
const POLES = [-60, -24, 24, 60]
const OFFSET = 4.2

export function addStreetlights(group) {
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5)
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x1c222c, roughness: 0.8 })
  const headGeo = new THREE.BoxGeometry(0.45, 0.18, 0.45)
  const headMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffb878, emissiveIntensity: 2.5 })
  const anchors = []
  const place = (x, z) => {
    const pole = new THREE.Mesh(poleGeo, poleMat)
    pole.position.set(x, 2.5, z)
    group.add(pole)
    const head = new THREE.Mesh(headGeo, headMat)
    head.position.set(x, 5.2, z)
    group.add(head)
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
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a4149, roughness: 0.9 })
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x46505e, roughness: 0.9 })
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 })
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
  const plankMat = new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 0.9 })
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
