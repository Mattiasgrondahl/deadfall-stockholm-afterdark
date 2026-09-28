import * as THREE from 'three'

// v19 graphics: ground-floor storefront detail + base grime/AO band.
//
// The buildings are textured boxes, but at street level they still read as flat
// walls meeting the pavement. This module adds two InstancedMeshes — a dark
// "grime/AO" band hugging the base of every building (a cheap contact-darkening
// that grounds the box and reads as street-level soot) and a warm lit storefront
// strip just above it (a low band of lit shop windows + a thin awning lip). Both
// are static, never toggled, so each collapses to ONE InstancedMesh (2 draw
// calls for the whole city) for +2 meshes and +0 lights.
//
// Headless-safe: no document/window; layout comes from a seeded LCG (no
// Math.random). Deterministic and fully reversible via City.dispose (which
// disposes every group child's geometry + material and calls InstancedMesh
// .dispose()). Instances beyond the cap collapse to zero scale (invisible).

// Cap storefront instances. Two bands per building face, capped per building so
// the total stays bounded regardless of building count.
const MAX_SF = 512

/**
 * Add instanced ground-floor storefront + base-grime bands to `group`.
 * @param {THREE.Group} group the city group (dispose iterates its children).
 * @param {Array<{mesh:THREE.Mesh,w:number,d:number,h:number}>} buildings
 * @returns {THREE.InstancedMesh[]} the created meshes (for the caller to track).
 */
export function addStorefronts(group, buildings) {
  if (!buildings || !buildings.length) return []

  // A unit box reused for both bands, scaled per instance.
  const bandGeo = new THREE.BoxGeometry(1, 1, 1)
  // Grime/AO band: near-black matte soot that darkens the wall/pavement seam.
  const grimeMat = new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.95, metalness: 0.0 })
  // Storefront strip: warm emissive so the street level glows like lit shops.
  const shopMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.6, metalness: 0.1, emissive: 0xffb066, emissiveIntensity: 0.9 })

  const grime = new THREE.InstancedMesh(bandGeo, grimeMat, MAX_SF)
  const shop = new THREE.InstancedMesh(bandGeo, shopMat, MAX_SF)
  grime.receiveShadow = true
  grime.castShadow = false
  shop.castShadow = false
  grime.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  shop.instanceMatrix.setUsage(THREE.StaticDrawUsage)

  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const e = new THREE.Euler()

  let gi = 0
  let si = 0
  for (const b of buildings) {
    const bx = b.mesh.position.x
    const bz = b.mesh.position.z
    const w = b.w
    const d = b.d
    const h = b.h
    if (h < 3) continue // too short to have a street level
    // Four faces: front/back (span w) and left/right (span d).
    const faces = [
      { px: bx, pz: bz + d / 2 + 0.03, ry: 0, span: w },
      { px: bx, pz: bz - d / 2 - 0.03, ry: Math.PI, span: w },
      { px: bx + w / 2 + 0.03, pz: bz, ry: Math.PI / 2, span: d },
      { px: bx - w / 2 - 0.03, pz: bz, ry: -Math.PI / 2, span: d }
    ]
    for (const f of faces) {
      const tw = Math.max(0.5, f.span * 0.96)
      // Grime/AO band: a thin dark strip hugging the base, slightly proud of the
      // wall so it reads as soot staining the wall foot + pavement seam.
      if (gi < MAX_SF) {
        pos.set(f.px, 0.18, f.pz)
        e.set(0, f.ry, 0)
        quat.setFromEuler(e)
        scl.set(tw, 0.36, 0.1)
        m.compose(pos, quat, scl)
        grime.setMatrixAt(gi++, m)
      }
      // Storefront strip: a lit band just above the grime (waist height), inset
      // a touch so it reads as recessed shop windows.
      if (si < MAX_SF) {
        pos.set(f.px, 1.15, f.pz)
        e.set(0, f.ry, 0)
        quat.setFromEuler(e)
        scl.set(tw * 0.86, 0.7, 0.06)
        m.compose(pos, quat, scl)
        shop.setMatrixAt(si++, m)
      }
    }
  }
  // Collapse unused instances to zero scale (harmless, invisible).
  pos.set(0, -9999, 0)
  scl.set(0, 0, 0)
  quat.identity()
  m.compose(pos, quat, scl)
  for (; gi < MAX_SF; gi++) grime.setMatrixAt(gi, m)
  for (; si < MAX_SF; si++) shop.setMatrixAt(si, m)
  grime.instanceMatrix.needsUpdate = true
  shop.instanceMatrix.needsUpdate = true

  group.add(grime, shop)
  return [grime, shop]
}