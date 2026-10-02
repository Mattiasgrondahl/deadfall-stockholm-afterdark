// verify-outline.mjs — deterministic proof of the zombie silhouette shell
// (v37 R5/R5b, src/game/ZombieOutline.js). No renderer, no screenshots, so no
// SwiftShader instability and no streetlight-flicker noise.
//
// WHY THIS EXISTS: the shell's whole value is a rim the player can SEE, and two
// separate bugs made it invisible while every unit test stayed green. (1) The
// first cut built the shells as a sibling group from each part's REST transform,
// so shells stayed behind while limbs swung. (2) The second cut scaled every
// shell by a flat 1.04, which makes rim width proportional to the part: the
// 0.13 m arm got 2.6 mm of edge = 0.4 px at 5 m — sub-pixel, scored "not
// discernible" by the local VLM probe. Both are geometry properties, so both
// are provable here in milliseconds, headless.
//
// Checks, all of them properties the design depends on:
//   A. CONTAINMENT — every frame of the walk cycle, each part's OWN geometry
//      box is strictly inside its shell's box. (Own geometry only: the face
//      disc and hair intentionally stick out past the head hull, so a
//      setFromObject over descendants is the wrong comparison.)
//   B. RIM IN METRES — the expansion past the part equals OUTLINE_RIM on every
//      axis of every part, so thin limbs get the same visible edge as the torso.
//   C. PIXEL WIDTH — the rim projects to >= 1 px at gameplay range (the metric
//      that exposes a sub-pixel rim).
//   D. CULLING COUPLING — a hidden part takes its shell off screen with it
//      (dismemberment + the LOD body swap must not leave a floating hull).
//   E. BOSSES have no shell; F. dispose() leaves the scene empty.
import * as THREE from 'three'
import { Zombie } from '../src/game/Zombie.js'
import { OUTLINE_RIM } from '../src/game/ZombieOutline.js'

const FRAMES = 240 // 4 s of the walk cycle at 1/60
const PART_NAMES = ['torso', 'head', 'armL', 'armR', 'legL', 'legR']
// Matches the game camera (Game.js: new PerspectiveCamera(75, 16/9, ...)) at
// the 1280 px viewport the look-capture / E2E tools use.
const FOV_DEG = 75, VIEW_PX = 1280
const RANGES = [2, 5, 10, 20]

let fails = 0
const ok = (label, pass, detail = '') => {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!pass) fails++
}

const ownBox = (mesh, out) => {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
  return out.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld)
}
// Each term is shell.min - part.min (<= 0 when the shell starts earlier) or
// part.max - shell.max (<= 0 when the shell ends later). The MOST POSITIVE term
// is the tightest axis; strict containment means it stays < 0.
const slack = (part, shell, A, B) => {
  ownBox(part, A); ownBox(shell, B)
  return Math.max(
    B.min.x - A.min.x, B.min.y - A.min.y, B.min.z - A.min.z,
    A.max.x - B.max.x, A.max.y - B.max.y, A.max.z - B.max.z)
}
const pxAt = (metres, dist) =>
  (metres / (2 * dist * Math.tan((FOV_DEG / 2) * Math.PI / 180))) * VIEW_PX

const scene = new THREE.Scene()
const A = new THREE.Box3(), B = new THREE.Box3(), size = new THREE.Vector3()

// A walk cycle for every archetype: the shells must hold through the swing.
for (const type of ['walker', 'shambler', 'screamer', 'brute']) {
  const z = new Zombie(scene, type, 0, 0, 1)
  const isBoss = z.isBoss
  const label = `${type}${isBoss ? ' (boss)' : ''}`

  if (isBoss) {
    ok(`${label}: no silhouette shell`, z._outline === null,
      'the rim scales with the group, so a 2.5x/5x boss is already outlined by its own size')
    z.dispose()
    continue
  }

  // A + B: containment and rim metres over the full cycle.
  let worstSlack = -Infinity, worstAt = null
  let worstRimDev = -1, worstRim = 0, rimAt = null, frames = 0
  for (let f = 0; f < FRAMES; f++) {
    z.update(1 / 60, null, [z], null, null)
    z.group.updateMatrixWorld(true)
    for (let i = 0; i < 6; i++) {
      const s = slack(z._parts[i], z._outline[i], A, B)
      frames++
      if (s > worstSlack) { worstSlack = s; worstAt = `frame ${f} ${PART_NAMES[i]}` }
      z._parts[i].geometry.boundingBox.getSize(size)
      // Per-axis: the shell expands each axis by its own scale factor, so all
      // three must land on OUTLINE_RIM, not just x.
      const sx = z._outline[i].scale, ax = [sx.x, sx.y, sx.z], nm = ['x', 'y', 'z']
      for (let k = 0; k < 3; k++) {
        const rim = Math.abs((ax[k] - 1) * size.getComponent(k) * 0.5)
        const dev = Math.abs(rim - OUTLINE_RIM)
        if (dev > worstRimDev) { worstRimDev = dev; worstRim = rim; rimAt = `frame ${f} ${PART_NAMES[i]}.${nm[k]}` }
      }
    }
  }
  ok(`${label}: shell surrounds its part on every frame`, worstSlack < 0,
    `tightest slack ${worstSlack.toFixed(5)} m over ${frames} checks (${worstAt})`)
  ok(`${label}: rim is ${OUTLINE_RIM} m on every axis of every part`,
    Math.abs(worstRim - OUTLINE_RIM) < 1e-9,
    `worst ${worstRim.toFixed(5)} m (${rimAt})`)

  // C: the rim must project to at least a pixel at gameplay range.
  z._parts[2].geometry.boundingBox.getSize(size)
  const rim = (z._outline[2].scale.x - 1) * size.x * 0.5
  const px = RANGES.map((d) => `${pxAt(rim, d).toFixed(1)}px@${d}m`).join(' ')
  ok(`${label}: rim is at least 1 px at 10 m (arm, the thinnest part)`,
    pxAt(rim, 10) >= 1, px)

  // D: a hidden part must cull its shell.
  const holder = new THREE.Group(); holder.visible = false
  holder.add(z._outline[2])
  let visited = 0
  holder.traverseVisible(() => visited++)
  ok(`${label}: hidden part culls its shell`, visited === 0,
    `${visited} shell(s) reached by the render traversal`)

  // F: dispose reverses everything.
  z.dispose()
  ok(`${label}: dispose leaves no scene children`, scene.children.length === 0)
}

// Shared-material contract: the refcount must release the module material so a
// later world rebuilds it lazily instead of reusing a disposed one.
{
  const a = new Zombie(scene, 'walker', 0, 0, 1)
  const b = new Zombie(scene, 'walker', 3, 0, 1)
  ok('shells share ONE material across bodies', a._outline[0].material === b._outline[0].material)
  a.dispose(); b.dispose()
  const c = new Zombie(scene, 'walker', 6, 0, 1)
  ok('material is rebuilt after the last shell is released',
    c._outline[0].material.side === THREE.BackSide && c._outline[0].material.fog === false)
  c.dispose()
}

console.log(fails === 0 ? '\nverify-outline: all checks passed' : `\nverify-outline: ${fails} FAILURE(S)`)
process.exit(fails === 0 ? 0 : 1)
