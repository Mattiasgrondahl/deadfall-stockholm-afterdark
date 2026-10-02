// ZombieOutline.js — v37 R5: dark silhouette shell behind every zombie body.
//
// The night rig lights bodies from one moon direction + streetlight pools, so
// a zombie crossing a bright pool or a lit facade loses its edge: the body and
// the backdrop land in the same tonemapped band and the silhouette stops
// reading. An inverted hull fixes that without a new light: a copy of the same
// shared box geometry, scaled up a few percent, drawn with BackSide only, so
// the camera sees the shell's *inside* as a thin dark rim around the body.
//
// WHY ONE SHELL PER BODY PART, PARENTED TO THAT PART (v37 R5 fix):
// the first cut built the shells as a sibling Group under the zombie root with
// each hull positioned from the part's REST transform. That copies the rest
// pose only — the shells stayed where the limbs start while the walk cycle
// swung the real limbs away from them, a severed arm left its hull floating,
// and the LOD body swap left a black halo around a body that was no longer
// there. Parenting one shell to each part means the shell inherits every
// transform the part gets (walk swing, attack lunge, death collapse, the
// group's boss scale) and hides exactly when its part hides, with no per-frame
// bookkeeping at all. Merging a left/right pair into one hull is impossible
// under that rule (the pair's two limbs swing in opposite phase), so the
// shells are per-part: 6 objects per non-boss body.
//
// Cost contract (verified against tools/verify-game.mjs S8):
//   - ONE module-level MeshBasicMaterial, shared by every live shell. It is
//     never disposed per-zombie (that would break the other live shells); the
//     refcount releases it when the last zombie goes away, mirroring the
//     FABRIC_NORMAL pattern in Zombie.js, so the module rebuilds lazily.
//   - NO new geometry: each shell borrows the geometry object its own part
//     already uses, so the shell count never adds a geometry upload.
//   - +6 Mesh objects per non-boss body, and bosses stay shell-free: a boss
//     group is scaled to 2.5x/5x, which scales the rim width with it and turns
//     the thin outline into a black blob. Measured worst case (20 alive bodies
//     = the v37 R3 cap, + 8 co-op avatars + city) is 723 meshes against the
//     800 gate pinned in tools/verify-game.mjs S8.
//   - Headless-safe: pure THREE objects, no document/window/capabilities.
import * as THREE from 'three'

/** Rim width as a fraction of the body size. 4% of a 0.56 m torso is ~2 cm of
 *  visible edge — enough to separate the silhouette, not enough to fatten it. */
export const OUTLINE_SCALE = 1.04

// The shared shell material. `fog: false` keeps the rim black at every
// distance: FogExp2 would blend the shell toward the fog colour and the rim
// would vanish exactly where readability matters most (30 m+).
let OUTLINE_MAT = null
let OUTLINE_REFS = 0

/** Borrow the shared shell material (refcounted; see releaseOutline). */
export function acquireOutline() {
  if (OUTLINE_MAT === null) {
    OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, fog: false })
    OUTLINE_REFS = 0
  }
  OUTLINE_REFS++
  return OUTLINE_MAT
}

/** Drop one reference; the last zombie out disposes the shared material. */
export function releaseOutline() {
  if (OUTLINE_MAT === null) return
  if (--OUTLINE_REFS <= 0) {
    OUTLINE_MAT.dispose()
    OUTLINE_MAT = null
    OUTLINE_REFS = 0
  }
}

/**
 * Attach one inverted-hull shell to each live body part.
 *
 * Each shell is added as a CHILD of its part at the part's own origin, scaled
 * by OUTLINE_SCALE relative to that part. Concentric + child of the part is
 * the whole trick: the shell inherits the part's position, rotation and
 * per-type scale, so it tracks the walk cycle, the attack lunge, the corpse
 * collapse and the boss group scale for free, and it disappears with the part
 * when a limb is severed or `_applyLOD` hands the body over to the skinned
 * mesh. Nothing has to be updated per frame.
 *
 * @param {Array} parts the zombie's live body parts (torso, head, armL, armR,
 *                      legL, legR). Their `.geometry` is reused, never retained.
 * @returns {Array} the shell meshes, in part order (the caller keeps the array
 *                  only so dispose() can detach them + drop the material ref).
 */
export function attachOutline(parts) {
  const mat = acquireOutline()
  const shells = []
  for (const src of parts) {
    const m = new THREE.Mesh(src.geometry, mat)
    m.name = 'outline'
    m.scale.setScalar(OUTLINE_SCALE)
    // The shell is a silhouette device only: it must not receive shadows
    // (a lit BackSide surface would break the flat black rim) and it never
    // casts one, so the shadow pass stays exactly as cheap as before.
    m.castShadow = false
    m.receiveShadow = false
    src.add(m)
    shells.push(m)
  }
  return shells
}

/** Detach a body's shells and release its reference to the shared material.
 *  Safe to call with a null list (bosses have no shells). */
export function detachOutline(shells) {
  if (!shells) return
  for (const m of shells) {
    if (m.parent) m.parent.remove(m)
  }
  shells.length = 0
  releaseOutline()
}
