import * as THREE from 'three'

// v4 VISUALS (Phase C1): instanced window trim + sills.
//
// The city's buildings are plain BoxGeometry with a facade texture; up close
// they still read as flat boxes because the facade normal map is only a 2-line
// window lip. This module adds ONE InstancedMesh of a thin window-frame/sill
// box, placed deterministically on the four visible faces of each building, so
// the facades gain real geometric relief (window reveals + sills that catch the
// moon and streetlights) for +1 mesh and +0 lights.
//
// Headless-safe: no document/window; positions come from a seeded LCG (no
// Math.random). Deterministic and fully reversible via City.dispose (which
// disposes every group child's geometry + material and calls InstancedMesh
// .dispose()). Instances beyond the cap collapse to zero scale (invisible).

// Cap window-trim instances. Two per lit window row-band, capped per building
// so the total stays bounded regardless of building count.
const MAX_TRIM = 512

/**
 * Add an instanced window-frame/sill mesh to `group` for each building.
 * @param {THREE.Group} group the city group (dispose iterates its children).
 * @param {Array<{mesh:THREE.Mesh,w:number,d:number,h:number}>} buildings
 * @returns {THREE.InstancedMesh[]} the created meshes (for the caller to track).
 */
export function addFacadeTrim(group, buildings) {
  if (!buildings || !buildings.length) return []
  let s = 8123
  const rnd = () => (s = (Math.imul(s, 48271) >>> 0) % 65537) / 65537

  // A thin horizontal sill/frame bar. The unit box is scaled per instance to
  // span a window-band width and sit proud of the facade face.
  const trimGeo = new THREE.BoxGeometry(1, 1, 1)
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x11161f, roughness: 0.85, metalness: 0.08 })
  const trim = new THREE.InstancedMesh(trimGeo, trimMat, MAX_TRIM)
  trim.castShadow = true
  trim.receiveShadow = false
  trim.instanceMatrix.setUsage(THREE.StaticDrawUsage)

  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const e = new THREE.Euler()

  let ci = 0
  for (const b of buildings) {
    const bx = b.mesh.position.x
    const bz = b.mesh.position.z
    const w = b.w
    const d = b.d
    const h = b.h
    // One trim band every ~3 m of height (matches the facade's window rows),
    // capped so tall towers don't blow the instance budget.
    const bands = Math.min(6, Math.max(1, Math.floor(h / 3)))
    for (let band = 0; band < bands; band++) {
      const y = 1.5 + band * 3
      if (y > h - 0.5) break
      // Four faces: front/back (span w) and left/right (span d). Two faces per
      // band keeps the count down while still framing the visible sides.
      const faces = [
        { px: bx, pz: bz + d / 2 + 0.04, ry: 0, span: w },
        { px: bx, pz: bz - d / 2 - 0.04, ry: Math.PI, span: w },
        { px: bx + w / 2 + 0.04, pz: bz, ry: Math.PI / 2, span: d },
        { px: bx - w / 2 - 0.04, pz: bz, ry: -Math.PI / 2, span: d }
      ]
      for (const f of faces) {
        if (ci >= MAX_TRIM) break
        const tw = Math.max(0.4, f.span * 0.9)
        pos.set(f.px, y, f.pz)
        e.set(0, f.ry, 0)
        quat.setFromEuler(e)
        scl.set(tw, 0.12, 0.14)
        m.compose(pos, quat, scl)
        trim.setMatrixAt(ci++, m)
      }
    }
  }
  // Collapse unused instances to zero scale (harmless, invisible).
  pos.set(0, -9999, 0)
  scl.set(0, 0, 0)
  quat.identity()
  m.compose(pos, quat, scl)
  for (; ci < MAX_TRIM; ci++) trim.setMatrixAt(ci, m)
  trim.instanceMatrix.needsUpdate = true

  group.add(trim)
  return [trim]
}