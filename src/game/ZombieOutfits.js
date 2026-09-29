// v26: distinct zombie archetypes built from silhouette geometry, not a printed
// cloth image. The primitive body used to wear a flat JPG garment map ("a
// picture of clothes" pasted on a box). That image is gone; each archetype now
// reads as a different person through its own geometry + flat colour:
//   0 office worker  — suit jacket + necktie
//   1 mailman        — shoulder satchel strap (cap from OUTFIT_ACC)
//   2 police / cop   — chest badge (cap from OUTFIT_ACC)
//   3 fireman        — hi-vis chest stripe (helmet from OUTFIT_ACC)
//   4 woman in a dress — flared skirt (cone)
//   5 stripper       — short flared skirt
//   6 schoolgirl     — pleated skirt + neck ribbon
//   7 jogger         — sleeveless top (bare arms) + shorts
//   8 gym guy        — tank top (bare arms) + shorts
// The head cap/helmet stays with OUTFIT_ACC in Zombie.js; this module supplies
// the BODY props (tie/badge/stripe/satchel/skirt/ribbon) that make each trade
// read at a glance.
// All geometry + materials are SHARED module-level resources (like GEO2 /
// ACC_GEO), so there is no per-spawn allocation. buildOutfitProps returns the
// prop meshes already positioned for the caller to parent to the torso/head;
// they are NOT in the zombie's _parts, so hit-flash / death never repaint them,
// and they leave with the group on death. Headless-safe: pure THREE geometry.
import * as THREE from 'three'

// Shared prop geometry. A cone gives the skirts real flare (a box skirt read as
// a rectangle); the cap visor + badge give the cop/mailman heads a trade.
const SKIRT_GEO = new THREE.ConeGeometry(0.34, 0.5, 8, 1, true) // open cone, flares down
const SHORT_SKIRT_GEO = new THREE.ConeGeometry(0.3, 0.32, 8, 1, true)
const BADGE_GEO = new THREE.BoxGeometry(0.1, 0.12, 0.03)
const VISOR_GEO = new THREE.BoxGeometry(0.26, 0.04, 0.14)
const STRAP_GEO = new THREE.BoxGeometry(0.1, 0.5, 0.05)
const RIBBON_GEO = new THREE.BoxGeometry(0.09, 0.14, 0.03)
const LONGHAIR_GEO = new THREE.BoxGeometry(0.26, 0.42, 0.1) // back panel of long hair

// Shared prop materials — one per role accent, reused across every instance.
const BADGE_MAT = new THREE.MeshStandardMaterial({ color: 0xd8b23a, roughness: 0.4, metalness: 0.5 })
const VISOR_MAT = new THREE.MeshStandardMaterial({ color: 0x0e1320, roughness: 0.6 })
const STRAP_MAT = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.85 })
const RIBBON_MAT = new THREE.MeshStandardMaterial({ color: 0x8a2230, roughness: 0.7 })
const SKIRT_MAT = new THREE.MeshStandardMaterial({ color: 0x8e1f2e, roughness: 0.8 })
const PLEAT_MAT = new THREE.MeshStandardMaterial({ color: 0x6b5140, roughness: 0.85 })
const PINK_SKIRT_MAT = new THREE.MeshStandardMaterial({ color: 0xd23b8f, roughness: 0.7 })
const LONGHAIR_MAT = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.9 })

// Per-archetype prop recipe. `parent` names the anchor the caller attaches to
// ('torso' or 'head'); `pos` is the offset on that anchor. This mirrors the old
// OUTFIT_ACC table but adds the skirt/badge/visor props that make each trade
// read at a glance.
const RECIPE = [
  // 0 office worker: necktie (suit colour already reads as a jacket).
  [{ kind: 'tie', parent: 'torso', pos: [0, 0.1, 0.18] }],
  // 1 mailman: cross-body satchel strap (cap comes from OUTFIT_ACC).
  [{ kind: 'strap', parent: 'torso', pos: [0.12, 0.1, 0.18] }],
  // 2 police: gold chest badge (peaked cap comes from OUTFIT_ACC).
  [{ kind: 'badge', parent: 'torso', pos: [0.14, 0.16, 0.18] }],
  // 3 fireman: hi-vis chest stripe (helmet comes from OUTFIT_ACC).
  [{ kind: 'stripe', parent: 'torso', pos: [0, 0.15, 0] }],
  // 4 woman in a dress: flared skirt below the torso + long back hair.
  [{ kind: 'skirt', parent: 'torso', pos: [0, -0.62, 0] }, { kind: 'longhair', parent: 'head', pos: [0, -0.05, -0.14] }],
  // 5 stripper: short flared skirt + long back hair.
  [{ kind: 'shortSkirt', parent: 'torso', pos: [0, -0.58, 0] }, { kind: 'longhair', parent: 'head', pos: [0, -0.05, -0.14] }],
  // 6 schoolgirl: pleated skirt + neck ribbon + long back hair.
  [{ kind: 'pleat', parent: 'torso', pos: [0, -0.6, 0] }, { kind: 'ribbon', parent: 'torso', pos: [0, 0.12, 0.17] }, { kind: 'longhair', parent: 'head', pos: [0, -0.05, -0.14] }],
  // 7 jogger: no extra prop (bright top + shorts read it); bare arms via sleeve.
  [],
  // 8 gym guy: no extra prop (tank + shorts); bare arms via sleeve.
  []
]

// Materials keyed by prop kind.
const MATS = {
  tie: null, // tie reuses the shared dark ACC material passed in by the caller
  visor: VISOR_MAT,
  badge: BADGE_MAT,
  strap: STRAP_MAT,
  stripe: null, // hi-vis stripe reuses the shared ACC stripe material
  ribbon: RIBBON_MAT,
  skirt: SKIRT_MAT,
  shortSkirt: PINK_SKIRT_MAT,
  pleat: PLEAT_MAT,
  longhair: LONGHAIR_MAT
}

// Geometry keyed by prop kind.
const GEOS = {
  tie: new THREE.BoxGeometry(0.08, 0.5, 0.02),
  visor: VISOR_GEO,
  badge: BADGE_GEO,
  strap: STRAP_GEO,
  stripe: new THREE.BoxGeometry(0.58, 0.12, 0.36),
  ribbon: RIBBON_GEO,
  skirt: SKIRT_GEO,
  shortSkirt: SHORT_SKIRT_GEO,
  pleat: SKIRT_GEO,
  longhair: LONGHAIR_GEO
}

/**
 * Build the archetype-specific prop meshes for a zombie.
 * @param {number} outfit     archetype index (0..8)
 * @param {Object} shared     { tie: Material, stripe: Material } — the caller's
 *                            shared tie / hi-vis materials so those props match
 *                            the existing accessory look.
 * @returns {Array<{mesh:THREE.Mesh, parent:'torso'|'head', pos:number[]}>}
 */
export function buildOutfitProps(outfit, shared) {
  const recipe = RECIPE[outfit] || []
  const out = []
  for (const p of recipe) {
    const geo = GEOS[p.kind]
    const mat = (p.kind === 'tie' || p.kind === 'stripe') ? (shared && shared[p.kind]) : MATS[p.kind]
    if (!geo || !mat) continue
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = true
    out.push({ mesh, parent: p.parent, pos: p.pos })
  }
  return out
}

// Archetypes that should read as female (used by callers that want a longer
// hair silhouette). Dress/schoolgirl/stripper read as women.
export const FEMALE_OUTFITS = new Set([4, 5, 6])

export { GEOS as OUTFIT_PROP_GEO, MATS as OUTFIT_PROP_MAT }