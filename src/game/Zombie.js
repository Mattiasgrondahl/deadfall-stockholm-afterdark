import * as THREE from 'three'

/**
 * Zombie — boxy humanoid pursuer with chase / attack / corpse states.
 *
 * Shared resources: GEO2/MAT2/HITMAT/DEADMAT are module-level and shared by
 * every zombie instance, so spawning allocates no per-zombie geometry or
 * materials. Hit flashes and deaths swap shared material references;
 * dispose() detaches only the per-zombie group and must never dispose the
 * shared entries, which back every other live zombie.
 * Zombies never use Math.random; per-zombie phase comes from a fixed-seed LCG.
 */

const GEO2 = {
  // Improved humanoid proportions (shared by every zombie — no per-instance
  // geometry). A broader, slightly tapered torso, a smaller head, and longer,
  // slimmer limbs read as a body rather than stacked cubes.
  torso: new THREE.BoxGeometry(0.56, 1.05, 0.34),
  head: new THREE.BoxGeometry(0.26, 0.3, 0.26),
  arm: new THREE.BoxGeometry(0.13, 0.62, 0.13),
  leg: new THREE.BoxGeometry(0.16, 0.95, 0.16)
}

const MAT2 = {
  walker: new THREE.MeshStandardMaterial({ color: 0x6b7d5c, roughness: 0.9 }),
  shambler: new THREE.MeshStandardMaterial({ color: 0x7a6a58, roughness: 0.9 }),
  screamer: new THREE.MeshStandardMaterial({ color: 0x9c4f5e, roughness: 0.9, emissive: 0x401018, emissiveIntensity: 0.5 }),
  brute: new THREE.MeshStandardMaterial({ color: 0x4c5a44, roughness: 0.95 })
}

// Shared flash/death materials: non-fatal hit = 0.15 s red swap; death =
// dull desaturated swap. Swapped by reference only — never disposed.
const HITMAT = new THREE.MeshStandardMaterial({ color: 0x8a1f2a, emissive: 0x661111, roughness: 0.8 })
const DEADMAT = new THREE.MeshStandardMaterial({ color: 0x3a3129, roughness: 1 })
const EYE = new THREE.BoxGeometry(0.07, 0.07, 0.04)
const EYEMAT = {
  walker: new THREE.MeshBasicMaterial({ color: 0x8aff5e }),
  shambler: new THREE.MeshBasicMaterial({ color: 0xd0ff4f }),
  screamer: new THREE.MeshBasicMaterial({ color: 0xff3b2e }),
  brute: new THREE.MeshBasicMaterial({ color: 0xff5a1e })
}
const DEADEYEMAT = new THREE.MeshBasicMaterial({ color: 0x2a2a2a })

/** Per-type stats; wave scaling is hp * 1.12^(wave-1), rounded. `brute` is the
 *  wave-5 boss: a tanky 520-HP bruiser (≈5.8× a shambler's base HP), slow
 *  shamble, heavy melee, and a short lunge (charge) when the player is within
 *  CHARGE_RANGE. `shotgunArmor` is a damage multiplier the Shotgun applies to
 *  each pellet that lands on this type — the boss's thick hide shrugs off most
 *  buckshot (×0.4), so it takes ≥10 full blasts (9×6×22×0.4=475 < 520, 10×=528
 *  ≥ 520) while the pistol (26/shot, no armor) needs exactly 20 body shots. */
const TABLE = {
  walker: { speed: 1.5, hp: 50, melee: 8, cooldown: 0.9, shotgunArmor: 1 },
  shambler: { speed: 0.8, hp: 90, melee: 14, cooldown: 1.2, shotgunArmor: 1 },
  screamer: { speed: 2.2, hp: 40, melee: 6, cooldown: 0.7, shotgunArmor: 1 },
  brute: { speed: 0.7, hp: 520, melee: 30, cooldown: 1.6, shotgunArmor: 0.4 }
}

/** Boss charge window: within this horizontal range the brute lunges instead
 *  of shambling; the lunge adds CHARGE_SPEED for CHARGE_TIME seconds and its
 *  heavy melee lands at the end of the lunge. */
const CHARGE_RANGE = 7
const CHARGE_SPEED = 6
const CHARGE_TIME = 0.55

// Difficulty presets. NORMAL is the shipped baseline (identity). FRENZY: every
// zombie runs at 2× speed and has a flat 50 HP regardless of type, tuned so
// that at wave 1 exactly 2 body shots (pistol 26+26, axe 25+25) or 1 headshot
// (pistol 52, axe 50, sword 90) kill it. The usual 1.12×/wave HP scaling
// still applies on top.
export const DIFFICULTY = {
  normal: { speedMult: 1, hpBase: null },
  frenzy: { speedMult: 2, hpBase: 50 }
}

const ORDER = ['walker', 'shambler', 'screamer', 'brute']

/**
 * Per-type body scale/pose. Anchor centers are load-bearing (hitboxes):
 * the torso mesh center stays exactly at (0, 1.2, 0) and the head center
 * exactly at (0, 1.8, 0) for every type; scale and rotation are applied
 * around those centers, so the anchors never move.
 */
const POSE2 = {
  walker: { torsoS: [1, 1, 1], torsoR: 0, headS: [1, 1, 1], headR: 0, armRest: -0.35, legS: [1, 1, 1] },
  shambler: { torsoS: [1.15, 0.85, 1.1], torsoR: 0.45, headS: [0.9, 0.9, 0.9], headR: 0.35, armRest: 0.2, legS: [0.85, 0.85, 0.85] },
  screamer: { torsoS: [0.7, 1.15, 0.65], torsoR: 0, headS: [1.15, 1.15, 1.15], headR: 0, armRest: -2.6, legS: [1, 1.15, 1] },
  brute: { torsoS: [1.4, 1.15, 1.3], torsoR: 0.15, headS: [1.2, 1.2, 1.2], headR: 0.1, armRest: -0.6, legS: [1.2, 0.95, 1.2] }
}

// Per-type face portrait plane. Colors/emissive mirror MAT2 so a headless or
// not-yet-loaded face blends with the head color. Each type owns an array of
// THREE shared face materials (3 portrait variants); individual zombies pick
// one variant deterministically from their spawn-derived phase, so same-type
// zombies no longer look cloned. The textures are attached lazily in the
// browser only (headless Node keeps the flat materials). When a texture lands,
// the material color switches to white, because MeshStandardMaterial multiplies
// map by color — leaving the head color would tint the portrait dark and hide
// it. The JPEG background already matches the head color, so white keeps the
// portrait edges seamless. The portraits are themselves dark images and the
// night scene is dim, so a scene-lit face would still blend into the head; the
// same texture is also set as emissiveMap (self-lit) so the face stays visible
// wherever the zombie is.
const FACE_GEO = new THREE.PlaneGeometry(0.26, 0.26)
const FACEMAT = {
  walker: [
    new THREE.MeshStandardMaterial({ color: 0x6b7d5c, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x6b7d5c, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x6b7d5c, roughness: 0.9 })
  ],
  shambler: [
    new THREE.MeshStandardMaterial({ color: 0x7a6a58, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x7a6a58, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x7a6a58, roughness: 0.9 })
  ],
  screamer: [
    new THREE.MeshStandardMaterial({ color: 0x9c4f5e, roughness: 0.9, emissive: 0x401018, emissiveIntensity: 0.5 }),
    new THREE.MeshStandardMaterial({ color: 0x9c4f5e, roughness: 0.9, emissive: 0x401018, emissiveIntensity: 0.5 }),
    new THREE.MeshStandardMaterial({ color: 0x9c4f5e, roughness: 0.9, emissive: 0x401018, emissiveIntensity: 0.5 })
  ],
  brute: [
    new THREE.MeshStandardMaterial({ color: 0x4c5a44, roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: 0x4c5a44, roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: 0x4c5a44, roughness: 0.95 })
  ]
}

// Per-outfit clothing materials, shared across all zombie types. Nine distinct
// archetypes so a crowd reads as varied people, not clones:
//   0 lawyer/suit (charcoal jacket + white shirt + dark tie)
//   1 mailman (navy uniform + grey trousers)
//   2 police (dark navy jacket + black trousers + cap)
//   3 fireman (tan turnout coat + dark trousers + helmet)
//   4 woman in a dress (crimson dress, one-piece top+skirt)
//   5 stripper (black top + pink skirt)
//   6 schoolgirl (white blouse + plaid grey skirt)
//   7 jogger (bright teal top + black shorts)
//   8 gym guy (grey tank + black shorts)
// The torso wears the top material and the legs the bottom; the arms stay bare
// (per-type MAT2 skin color) and the head keeps the per-type color so the face
// still reads. Base colors are the clothing colors so the headless /
// not-yet-loaded state already looks clothed; when the texture lands (browser
// only) the color flips to white, because MeshStandardMaterial multiplies map
// by color. `acc` names an optional accessory prop (tie/cap/helmet/stripe)
// built per archetype so the silhouette reads even without a texture.
const OUTFITMATS = {
  tops: [
    new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.85 }), // lawyer jacket
    new THREE.MeshStandardMaterial({ color: 0x27324f, roughness: 0.85 }), // mailman navy
    new THREE.MeshStandardMaterial({ color: 0x1c2436, roughness: 0.85 }), // police navy
    new THREE.MeshStandardMaterial({ color: 0xb5854a, roughness: 0.9 }),  // fireman tan
    new THREE.MeshStandardMaterial({ color: 0x8e1f2e, roughness: 0.8 }),  // dress crimson
    new THREE.MeshStandardMaterial({ color: 0x17141a, roughness: 0.7 }),  // stripper black
    new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.85 }), // schoolgirl blouse
    new THREE.MeshStandardMaterial({ color: 0x1fa08f, roughness: 0.7 }),  // jogger teal
    new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.7 })   // gym tank
  ],
  bottoms: [
    new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.9 }),  // lawyer trousers
    new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.9 }),  // mailman grey
    new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.9 }),  // police black
    new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.9 }),  // fireman dark
    new THREE.MeshStandardMaterial({ color: 0x8e1f2e, roughness: 0.8 }),  // dress skirt (same)
    new THREE.MeshStandardMaterial({ color: 0xd23b8f, roughness: 0.7 }),  // stripper pink
    new THREE.MeshStandardMaterial({ color: 0x6b5140, roughness: 0.85 }), // schoolgirl plaid
    new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.85 }), // jogger shorts
    new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.85 })  // gym shorts
  ]
}
// Per-archetype accessory: a small prop that makes the silhouette read. No
// archetype uses a separate accessory mesh — every outfit's identity (police
// cap, fireman helmet, tie, hi-vis stripe, skirt) is carried by its top/bottom
// texture, so no extra mesh is spent and the 600-mesh scene budget holds at the
// 18-alive ceiling with the sniper as a fifth weapon. null = none.
const OUTFIT_ACC = [null, null, null, null, null, null, null, null, null]
const OUTFIT_COUNT = OUTFITMATS.tops.length
// Shared accessory geometry + materials (built once, reused across zombies;
// cheap boxes so the mesh budget is unaffected). tie = thin dark strip on the
// chest; cap = flat police cap on the head; helmet = rounded fireman helmet;
// stripe = hi-vis band across the chest. Each is parented to the torso/head so
// it moves with the body and is removed with the group on death.
const ACC_GEO = {
  tie: new THREE.BoxGeometry(0.08, 0.5, 0.02),
  cap: new THREE.BoxGeometry(0.3, 0.06, 0.3),
  helmet: new THREE.BoxGeometry(0.32, 0.14, 0.32),
  stripe: new THREE.BoxGeometry(0.58, 0.12, 0.36)
}
const ACC_MAT = {
  tie: new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.7 }),
  cap: new THREE.MeshStandardMaterial({ color: 0x141a2a, roughness: 0.7 }),
  helmet: new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.5, metalness: 0.2 }),
  stripe: new THREE.MeshStandardMaterial({ color: 0xf2d43d, roughness: 0.6, emissive: 0x3a3200 })
}

let faceTexturesLoading = false
// Asset base for runtime (non-bundled) fetches. Vite substitutes BASE_URL at
// build time, so the same code works on the dev server ("/") and on GitHub
// Pages (base /deadfall-stockholm-afterdark), where an absolute "/assets/..."
// path would 404. The substituted value is normalized to exactly one
// trailing slash because it may or may not carry one depending on the Vite
// version. In headless Node import.meta.env is undefined; the guard in
// loadFaceTextures means this value is never used there.
const ASSET_BASE = (typeof document !== 'undefined' ? ((import.meta.env?.BASE_URL || '').replace(/\/$/, '') + '/') : '')
function loadFaceTextures() {
  if (faceTexturesLoading || typeof document === 'undefined') return
  faceTexturesLoading = true
  const loader = new THREE.TextureLoader()
  for (const type of ORDER) {
    for (let i = 0; i < 3; i++) {
      // Variant 0 is the original portrait ({type}-face.jpg); variants 1 and 2
      // are the extra faces ({type}2-face.jpg, {type}3-face.jpg) — the file
      // suffix is i + 1, so variant 1 loads the "2" file and variant 2 the "3"
      // file.
      loader.load(ASSET_BASE + 'assets/faces/' + type + (i === 0 ? '' : i + 1) + '-face.jpg', (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = 4
        const mat = FACEMAT[type][i]
        // map is multiplied by material.color; white lets the portrait render
        // at true color instead of a dark head-color tint.
        mat.color.set(0xffffff)
        // The portrait is a dark image and the night scene is dim, so a
        // scene-lit face would blend into the head. Self-illuminate it: the same
        // texture as emissiveMap adds a moderate glow independent of scene light,
        // so the face is visible in alleys as well as under streetlamps.
        mat.map = tex
        mat.emissiveMap = tex
        mat.emissive.set(0xffffff)
        mat.emissiveIntensity = 0.5
        mat.needsUpdate = true
      }, () => console.warn(`face texture failed to load; keeping flat head-color face (${type} variant ${i})`))
    }
  }
}

// Browser-only lazy outfit texture loading (headless Node keeps the flat
// colors). Each top/bottom pair is one file per outfit; .jpg is guaranteed by
// tools/generate-outfit-textures.mjs. Nine archetypes, order matches OUTFITMATS.
let outfitTexturesLoading = false
const OUTFIT_FILES = [
  'lawyer-top', 'lawyer-pants',
  'mailman-top', 'mailman-pants',
  'police-top', 'police-pants',
  'fireman-top', 'fireman-pants',
  'dress-top', 'dress-skirt',
  'stripper-top', 'stripper-skirt',
  'schoolgirl-top', 'schoolgirl-skirt',
  'jogger-top', 'jogger-shorts',
  'gym-top', 'gym-shorts'
]
function loadOutfitTextures() {
  if (outfitTexturesLoading || typeof document === 'undefined') return
  outfitTexturesLoading = true
  const loader = new THREE.TextureLoader()
  for (let i = 0; i < OUTFIT_COUNT; i++) {
    for (let j = 0; j < 2; j++) {
      const mat = (j === 0 ? OUTFITMATS.tops : OUTFITMATS.bottoms)[i]
      const file = OUTFIT_FILES[i * 2 + j]
      loader.load(ASSET_BASE + 'assets/outfits/' + file + '.jpg', (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = 4
        mat.color.set(0xffffff)
        mat.map = tex
        mat.needsUpdate = true
      }, () => console.warn(`outfit texture failed to load; keeping flat color (${file})`))
    }
  }
}

export { TABLE, GEO2, MAT2, HITMAT, DEADMAT, EYEMAT, DEADEYEMAT, contactNormal, FACE_GEO, FACEMAT, POSE2, OUTFITMATS, ATTACK_RANGE, AIR_CLEAR, CHARGE_RANGE, CHARGE_SPEED, CHARGE_TIME }

// --- Browser-only skinned-mesh layer (v5 upgrade) ---------------------------
// When a rigged+animated GLB is available (browser only), a zombie's primitive
// body is swapped for a SkinnedMesh driven by an AnimationMixer. Headless Node
// (and any zombie whose asset has not loaded yet) keeps the primitive stub, so
// the deterministic movement/hitbox tests are unaffected.
//
// LOD: skinned within LOD_DIST of the player (camera proxy), primitive stub
// beyond. Both bodies always exist; only visibility toggles, so no allocation
// churn and the primitive fallback is instant. The player stands in for the
// camera because the game is first-person and the camera tracks the player.
const LOD_DIST = 25
//
// Per-state clip mapping (clip names come from the retargeted rig, e.g. the
// Mixamo/RobotExpressive humanoid): idle->Idle, walk->Walking, run->Running,
// attack->Punch, hurt->No, death->Death. A missing clip falls back to Idle, so
// a rig without every clip still animates.
const SKIN_CLIPS = { idle: 'Idle', walk: 'Walking', run: 'Running', attack: 'Punch', hurt: 'No', death: 'Death' }
// Per-type tint applied to the shared baked body material so the types read
// distinctly (the bake merged torso/legs into one material, so a per-type color
// multiply is the variant mechanism that mirrors MAT2). The brute is also
// scaled up ~1.4x for its boss silhouette.
const SKIN_TINT = {
  walker: 0xb9c4ad, shambler: 0xc4b39c, screamer: 0xd89aa6, brute: 0xa8b39a
}
// Per-type asset path under assets/zombies/. A type without a file keeps the
// primitive body (the loader warns and leaves the stub in place).
const SKIN_ASSET = { walker: 'walker-final.glb', shambler: 'walker-final.glb', screamer: 'walker-final.glb', brute: 'walker-final.glb' }
// Shared per-type loaded rig (geometry + clips + skeleton template). One GLB
// parse per type is shared by every zombie of that type; each zombie clones the
// skinned mesh and gets its own mixer (cloning a SkinnedMesh shares geometry,
// and Skeleton.clone gives an independent pose).
const skinCache = {} // type -> { scene, animations } | 'loading' | 'missing'
let skinLoader = null
// v5 skinned-rig swap is DISABLED: the walker-final.glb rig is corrupted (all
// bones collapsed to the origin and skin weights mis-assigned to the wrong
// bones — the Head bone drives the torso, the arms are weighted to finger
// bones). That made the body render small, the face sit mid-body, and the arms
// disappear. Until the rig is re-authored from source, the full-size primitive
// body (torso/head/arms/legs + face) is the visual. Flip this to true to
// re-enable the skinned path.
const USE_SKINNED_RIG = false

function loadSkin(type, onReady) {
  if (!USE_SKINNED_RIG) return // primitive body is the visual; skip the rig
  if (typeof document === 'undefined') return // headless: never load
  const entry = skinCache[type]
  if (entry && entry !== 'loading') {
    if (entry !== 'missing') onReady(entry)
    return
  }
  if (entry === 'loading') {
    // A load is already in flight for this type; poll cheaply on the next tick
    // via the microtask queue once it resolves (the shared scene is set below).
    const wait = () => {
      const e = skinCache[type]
      if (e && e !== 'loading') { if (e !== 'missing') onReady(e); return }
      Promise.resolve().then(wait)
    }
    wait()
    return
  }
  skinCache[type] = 'loading'
  if (!skinLoader) {
    // GLTFLoader lives under three's examples/jsm; import it lazily so the
    // headless bundle never pulls it in.
    import('three/examples/jsm/loaders/GLTFLoader.js').then((m) => {
      skinLoader = new m.GLTFLoader()
      start()
    }).catch(() => { skinCache[type] = 'missing' })
  } else {
    start()
  }
  function start() {
    const url = ASSET_BASE + 'assets/zombies/' + SKIN_ASSET[type]
    skinLoader.load(url, (gltf) => {
      const rec = { scene: gltf.scene, animations: gltf.animations }
      skinCache[type] = rec
      onReady(rec)
    }, undefined, () => {
      skinCache[type] = 'missing'
      console.warn(`skinned mesh failed to load; keeping primitive body (${type})`)
    })
  }
}

/** Clone a loaded rig scene into a per-zombie skinned mesh + mixer. Cloning the
 *  SkinnedMesh shares geometry but gives each instance an independent Skeleton
 *  (so one zombie's animation never poses another's). Returns the skinned mesh,
 *  the mixer, and a name->clip map, or null if no skinned mesh was found.
 *
 *  three.js `Object3D.clone(true)` copies the SkinnedMesh but NOT its Skeleton:
 *  the clone keeps a reference to the ORIGINAL armature's bones, which live in
 *  the (unrendered) source scene. Binding to those leaves the body unposed and
 *  unrendered (the "no zombie body" bug). We rebuild the skeleton from the
 *  CLONED bones (matched by name) so every instance poses independently and
 *  its bones are actually in the rendered tree. */
function buildSkin(rec) {
  const root = rec.scene.clone(true)
  let skinned = null
  root.traverse((o) => { if (o.isSkinnedMesh && !skinned) skinned = o })
  if (!skinned) return null
  // Map each cloned bone by name so we can rebind the cloned mesh to the
  // cloned armature instead of the shared source skeleton.
  const boneMap = {}
  root.traverse((o) => { if (o.isBone && !(o.name in boneMap)) boneMap[o.name] = o })
  const srcBones = skinned.skeleton.bones
  const bones = srcBones.map((b) => boneMap[b.name]).filter(Boolean)
  if (bones.length === srcBones.length && bones.length > 0) {
    const skeleton = new THREE.Skeleton(bones)
    skinned.skeleton = skeleton
    skinned.bind(skeleton, root.matrixWorld)
  }
  // Skinned meshes are deformed past their bind-pose bounding sphere, so the
  // default frustum culling can drop the whole body when it moves/animates.
  skinned.frustumCulled = false
  const mixer = new THREE.AnimationMixer(root)
  const clips = {}
  for (const c of rec.animations) clips[c.name] = c
  return { root, skinned, mixer, clips }
}

const ATTACK_RANGE = 1.3
const AIR_CLEAR = 0.9 // melee skips a player this far above torso height (mid-jump)
const SEPARATION_DIST = 0.9
const SEPARATION_STRENGTH = 0.6
const COLLIDER_RADIUS = 0.5
const NO_PROG_FLIP = 0.6 // s of zero progress while sliding before flipping direction
const CLEAR_DIST = 0.75  // m to keep sliding in free space before resuming chase
const KB_TIME = 0.35     // s of stagger after a melee hit
const KB_STRENGTH = 3    // initial m/s; total push = STRENGTH*TIME/2 ≈ 0.53 m

/**
 * True contact normal for a circle against the AABBs, choosing the contact
 * that most opposes the wanted direction (first AABB wins exact ties).
 * Writes {x, z} into the caller-owned scratch object out and returns out,
 * or returns null if no box is actually in contact. No allocations per call.
 */
function contactNormal(pos, aabbs, radius, wantX, wantZ, out) {
  let bestDot = Infinity
  let has = false
  for (let i = 0; i < aabbs.length; i++) {
    const b = aabbs[i]
    const cx = pos.x < b.minX ? b.minX : (pos.x > b.maxX ? b.maxX : pos.x)
    const cz = pos.z < b.minZ ? b.minZ : (pos.z > b.maxZ ? b.maxZ : pos.z)
    const dx = pos.x - cx
    const dz = pos.z - cz
    const d2 = dx * dx + dz * dz
    if (d2 >= (radius + 1e-6) * (radius + 1e-6)) continue
    const d = Math.sqrt(d2)
    let nx, nz
    if (d > 1e-9) { nx = dx / d; nz = dz / d }
    else {
      // center inside the box: exit through the nearest face
      const dL = pos.x - b.minX
      const dR = b.maxX - pos.x
      const dT = pos.z - b.minZ
      const dB = b.maxZ - pos.z
      const m = Math.min(dL, dR, dT, dB)
      nx = m === dL ? -1 : (m === dR ? 1 : 0)
      nz = m === dT ? -1 : (m === dB ? 1 : 0)
    }
    const dot = nx * wantX + nz * wantZ
    if (dot < bestDot) { bestDot = dot; has = true; out.x = nx; out.z = nz }
  }
  return has ? out : null
}

export class Zombie {
  constructor(scene, type, x, z, wave = 1, difficulty = 'normal') {
    if (!TABLE[type]) throw new Error('unknown zombie type: ' + type)
    const diff = DIFFICULTY[difficulty] || DIFFICULTY.normal
    this.type = type
    this.scene = scene
    this.speed = TABLE[type].speed * diff.speedMult
    const baseHp = diff.hpBase != null ? diff.hpBase : TABLE[type].hp
    this.maxHealth = this.health = Math.round(baseHp * Math.pow(1.12, wave - 1))
    // The brute is the wave-5 boss: a 1.4× silhouette, so both weapon hitboxes
    // scale by HITBOX_SCALE (the two-sphere contract and the per-type radii
    // 0.45/0.3 stay exact for the three regular types).
    this.isBoss = type === 'brute'
    // Shotgun armor: the boss's hide shrugs off most buckshot (×0.4 per pellet),
    // so it needs ≥10 full blasts; every other type is unarmored (×1). The
    // pistol/axe/sword ignore this and apply full damage.
    this.shotgunArmor = TABLE[type].shotgunArmor
    this._hitboxScale = this.isBoss ? 1.4 : 1
    // Charge (boss only): when the player is within CHARGE_RANGE the brute
    // commits to a lunge for CHARGE_TIME seconds at CHARGE_SPEED m/s.
    this._chargeT = 0
    this._chargeX = 0
    this._chargeZ = 0
    // Limb damage: shot-off limbs. Arms lost (0/1/2) do not slow the zombie —
    // it keeps coming with one or no arms. Legs lost (0/1) make it limp: a
    // one-legged zombie hops on the remaining leg and moves at LIMPLESS_SPEED
    // of its normal speed. The severed limb's mesh is hidden. The boss keeps
    // all limbs (too tough to dismember) so its charge/melee are unaffected.
    this.armsLost = 0
    this.legsLost = 0
    this._limp = false
    this._hopPhase = 0
    this.position = new THREE.Vector3(x, 0, z) // group origin = feet (y 0)
    this.isDead = false
    this.deathTimer = 0
    this._attackT = 0
    this._time = 0
    this._killCounted = false
    // Id of the player whose hit last dealt damage (set by weapons that know
    // their owner via the `by` argument); the killer is the last one to hit
    // because damage() no-ops on a dead zombie. null in solo play / debug kills.
    this.lastDamager = null
    this._slideX = undefined
    this._slideZ = undefined
    this._slideT = 0
    this._slideDist = 0
    this._noProgT = 0
    this._clearDist = 0
    this._blockedT = 0
    this._flips = 0
    // Per-frame scratch for contactNormal (avoids per-frame {x, z} allocs).
    this._cn = { x: 0, z: 0 }
    this._tan = { x: 0, z: 0 } // scratch for pickTangent (removes its commit-only [tx,tz] allocation)
    this._kbT = 0 // stagger timer (s), decremented in update()
    this._kbX = 0 // stagger velocity x (m/s)
    this._kbZ = 0 // stagger velocity z (m/s)
    // Deterministic per-zombie phase (fixed-seed LCG from spawn coords + type).
    // Stored here for later tasks (walk animation, groan scheduling). Math.imul
    // keeps the LCG exact: later iterations exceed 2^53 under plain '*'.
    let seed = Math.floor((x + 200) * 100 + (z + 200) * 37 + ORDER.indexOf(type) * 101)
    for (let i = 0; i < 3; i++) seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
    this._phase = (seed / 0x7fffffff) * 2 * Math.PI

    // Body: torso, head, two arms, two legs — all from the shared GEO2 pool,
    // posed per type. Child order is fixed: torso, head, armL, armR, legL, legR.
    this.group = new THREE.Group()
    const mat = MAT2[type]
    const pose = POSE2[type]
    // Clothing outfit: an independent deterministic re-mapping of the spawn LCG
    // phase (offset so it does not track the face variant) selects one of the
    // nine shared top/bottom material pairs. No extra LCG draw, so the face
    // variant pick (below) is unaffected.
    const outfit = Math.floor((((this._phase / (2 * Math.PI)) + 0.37) % 1) * OUTFIT_COUNT)
    this._outfit = outfit
    const topMat = OUTFITMATS.tops[outfit]
    const bottomMat = OUTFITMATS.bottoms[outfit]
    const parts = []
    const torso = new THREE.Mesh(GEO2.torso, topMat)
    torso.position.set(0, 1.2, 0)
    torso.scale.set(pose.torsoS[0], pose.torsoS[1], pose.torsoS[2])
    torso.rotation.x = pose.torsoR
    parts.push(torso)
    const head = new THREE.Mesh(GEO2.head, mat)
    head.position.set(0, 1.8, 0)
    head.scale.set(pose.headS[0], pose.headS[1], pose.headS[2])
    head.rotation.x = pose.headR
    this._head = head
    parts.push(head)
    // Eye glow: two small unlit boxes nested under the head; local +z faces the
    // player (group.rotation.y = atan2(dx, dz)). Shared per-type material. Eyes
    // are NOT in _parts, so hit flash and death swaps never touch them.
    const eMat = EYEMAT[type]
    this._eyes = []
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(EYE, eMat)
      eye.position.set(0.075 * side, 0.03, 0.14)
      head.add(eye)
      this._eyes.push(eye)
    }
    // Face portrait plane nested under the head, just in front of the head's
    // front face (0.15 -> 0.155, no z-fighting); the eyes (front z 0.16) still
    // protrude over the portrait. NOT in _parts, so hit flash never touches it;
    // only the death branch swaps it to DEADMAT.
    // Variant pick: the spawn-derived LCG phase (above) selects one of the
    // 3 shared variant materials per zombie — deterministic (no Math.random)
    // and spreads zombies of a type across the variants by position.
    const variant = Math.floor((this._phase / (2 * Math.PI)) * 3) % 3
    const face = new THREE.Mesh(FACE_GEO, FACEMAT[type][variant])
    face.position.set(0, 0, 0.155)
    head.add(face)
    this._face = face
    for (const side of [-1, 1]) {
      // Bare arms: the top texture/color is torso-only; arms keep the
      // per-type skin color so the cloth reads as a jacket/shirt on the body.
      const arm = new THREE.Mesh(GEO2.arm, mat)
      arm.position.set(0.34 * side, 1.42, 0.1)
      arm.rotation.x = pose.armRest
      parts.push(arm)
      if (side === -1) this._armL = arm
      else this._armR = arm
    }
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(GEO2.leg, bottomMat)
      leg.position.set(0.16 * side, 0.47, 0)
      leg.scale.set(pose.legS[0], pose.legS[1], pose.legS[2])
      parts.push(leg)
      if (side === -1) this._legL = leg
      else this._legR = leg
    }
    // Outfit accessory prop (tie/cap/helmet/hi-vis stripe) so the silhouette
    // reads as a specific profession even without a texture. Parented to the
    // torso or head so it moves with the body; NOT in _parts, so hit-flash and
    // death material swaps never touch it. Removed with the group on death.
    const acc = OUTFIT_ACC[outfit]
    if (acc) {
      const prop = new THREE.Mesh(ACC_GEO[acc], ACC_MAT[acc])
      if (acc === 'tie') { prop.position.set(0, 0.1, 0.18); torso.add(prop) }
      else if (acc === 'stripe') { prop.position.set(0, 0.15, 0); torso.add(prop) }
      else if (acc === 'cap') { prop.position.set(0, 0.19, 0.02); head.add(prop) }
      else if (acc === 'helmet') { prop.position.set(0, 0.19, 0); head.add(prop) }
      prop.castShadow = true
      this._acc = prop
    }
    this.group.add(...parts)
    this.group.position.copy(this.position)
    scene.add(this.group)
    this._parts = parts
    for (const p of parts) p.castShadow = true
    // Per-part rest materials (torso, head, armL, armR, legL, legR) so hit
    // flash / recovery can restore each part to its own material.
    this._restMats = [topMat, mat, mat, mat, bottomMat, bottomMat]
    this._flashT = 0
    loadFaceTextures() // guarded no-op after the first zombie (headless: no-op)
    loadOutfitTextures() // same guard pattern; browser-only
    // v5: try to swap in a rigged skinned mesh (browser-only, async). Until it
    // arrives the primitive body above is the visual; headless never swaps.
    this._skin = null // { root, skinned, mixer, clips, actions, current }
    this._skinState = 'idle'
    loadSkin(type, (rec) => this._attachSkin(rec))
  }

  /** Swap the primitive body for a cloned skinned mesh + mixer once the rigged
   *  GLB loads. Hides the primitives (kept for hit-flash/death material swaps
   *  and the face/eyes) and parents the face + eyes to the rig's head bone if
   *  present. No-op if a skin is already attached or none was found. */
  _attachSkin(rec) {
    if (this._skin || this.isDead) return
    const built = buildSkin(rec)
    if (!built) return
    const { root, skinned, mixer, clips } = built
    // The rig GLB is authored upright at ~1.8 m; scale to this type's silhouette
    // height so the skinned body matches the primitive anchors. The brute gets a
    // 1.4x boss silhouette on top of its type height.
    const h = this._skinHeight()
    const dim = new THREE.Box3().setFromObject(skinned).getSize(new THREE.Vector3())
    const bb = new THREE.Box3().setFromObject(skinned)
    const scale = dim.y > 1e-6 ? (h / dim.y) * (this.isBoss ? 1.4 : 1) : 1
    root.scale.setScalar(scale)
    // The rig's origin sits at its hips/center, so its bind-pose feet are at a
    // negative local y (≈ -0.88 m). The group origin is the FEET (y 0), so
    // without a lift the body hangs half-buried with its head-top far below the
    // head primitive (the "body too small / misaligned with the head" bug).
    // Lift the root so the scaled feet land on y 0; the scaled top then reaches
    // the target height, aligning the skinned head with the head primitive.
    root.position.set(0, -bb.min.y * scale, 0)
    // Per-instance material clone tinted to the type so shared-rig zombies of
    // different types read distinctly. Cloning keeps the baked map but gives this
    // zombie its own color (and lets hit-flash / death swap it safely).
    const srcMat = Array.isArray(skinned.material) ? skinned.material[0] : skinned.material
    const bodyMat = srcMat ? srcMat.clone() : new THREE.MeshStandardMaterial({ color: SKIN_TINT[this.type] })
    bodyMat.color.setHex(SKIN_TINT[this.type])
    skinned.material = bodyMat
    this._skinRestMat = bodyMat
    // The rig GLB already contains its own head (the skinned mesh spans up to
    // the head crown), so keeping the primitive head box visible produced a
    // DOUBLE head (the rig head + the primitive box) and made the body read
    // short because the primitive box floated above the rig head. Re-parent the
    // face portrait + eyes onto the rig's Head bone so they ride the animated
    // head, then hide the primitive head entirely.
    let headBone = null
    root.traverse((o) => { if (o.isBone && /head/i.test(o.name) && !headBone) headBone = o })
    if (headBone) {
      // Move the face + eyes off the primitive head onto the rig head bone.
      // The face sat at local z 0.155 on the primitive head; on the bone we
      // place it just in front of the rig head's face plane.
      if (this._face && this._face.parent) this._face.parent.remove(this._face)
      // Remember both placements so the LOD swap can move them back.
      this._faceOnBone = new THREE.Vector3(0, 0.02, 0.13)
      this._faceOnHead = new THREE.Vector3(0, 0, 0.155)
      this._eyeOnBone = new THREE.Vector3(0.07, 0.05, 0.12)
      this._eyeOnHead = new THREE.Vector3(0.075, 0.03, 0.14)
      if (this._face) {
        this._face.position.copy(this._faceOnBone)
        headBone.add(this._face)
      }
      for (const eye of this._eyes || []) {
        if (eye.parent) eye.parent.remove(eye)
        eye.userData.side = eye.position.x < 0 ? -1 : 1
        eye.position.set(this._eyeOnBone.x * eye.userData.side, this._eyeOnBone.y, this._eyeOnBone.z)
        headBone.add(eye)
      }
      this._headBone = headBone
    }
    // Hide the primitive limbs AND the primitive head (the rig head shows now).
    this._parts[0].visible = false // torso
    this._parts[2].visible = false // armL
    this._parts[3].visible = false // armR
    this._parts[4].visible = false // legL
    this._parts[5].visible = false // legR
    this._parts[1].visible = false // head (face/eyes re-parented to the rig)
    this._headVisible = false
    this._lodSkinned = true
    // The skinned root is a CHILD of this.group, which already sits at the feet
    // position (group.position = this.position). The root therefore stays at the
    // group's LOCAL x/z origin (0) — copying the world position would
    // double-offset the body away from the head (the "floating head, no body"
    // bug). The y-lift set above is preserved (do NOT reset it here).
    this.group.add(root)
    // Build one action per mapped state, falling back to Idle for missing clips.
    const actions = {}
    for (const state of Object.keys(SKIN_CLIPS)) {
      const clip = clips[SKIN_CLIPS[state]] || clips.Idle
      if (!clip) continue
      const a = mixer.clipAction(clip)
      a.enabled = true
      actions[state] = a
    }
    this._skin = { root, skinned, mixer, clips, actions, current: null }
    this._setSkinState('idle')
    this._applyLOD(this.position, null)
  }

  /** LOD: show the skinned body within LOD_DIST of the player (camera proxy)
   *  and the primitive stub beyond. Toggles visibility only — both bodies
   *  always exist, so swapping is allocation-free and instant. The head
   *  primitive (which carries the face + eyes) stays visible when LOD'd out so
   *  the face still reads at distance. No-op when no skin is attached. */
  _applyLOD(playerPos) {
    if (!this._skin) return
    let near = true
    if (playerPos) {
      const dx = playerPos.x - this.position.x
      const dz = playerPos.z - this.position.z
      near = (dx * dx + dz * dz) <= LOD_DIST * LOD_DIST
    }
    if (near === this._lodSkinned) return
    this._lodSkinned = near
    this._skin.root.visible = near
    // Limbs: visible only when LOD'd out (primitive body).
    this._parts[0].visible = !near // torso
    this._parts[2].visible = !near // armL
    this._parts[3].visible = !near // armR
    this._parts[4].visible = !near // legL
    this._parts[5].visible = !near // legR
    // The face + eyes ride the rig's Head bone when skinned (near) and move
    // back onto the primitive head when LOD'd out (far), so the face reads at
    // any distance and there is never a double head.
    const host = near ? this._headBone : this._parts[1]
    if (host) {
      if (this._face && this._face.parent !== host) {
        if (this._face.parent) this._face.parent.remove(this._face)
        this._face.position.copy(near ? this._faceOnBone : this._faceOnHead)
        host.add(this._face)
      }
      for (const eye of this._eyes || []) {
        if (eye.parent !== host) {
          if (eye.parent) eye.parent.remove(eye)
          eye.position.copy(near ? this._eyeOnBone : this._eyeOnHead)
          eye.position.x = Math.abs(eye.position.x) * (eye.userData.side || 1)
          host.add(eye)
        }
      }
    }
    this._parts[1].visible = !near // primitive head only when LOD'd out
  }

  /** Target standing height for the skinned body (matches the primitive
   *  silhouette so the head/hitbox anchors line up). */
  _skinHeight() {
    const pose = POSE2[this.type]
    // Primitive head center sits at y 1.8 * head scale; approximate the visible
    // top as 1.8 + half head, and feet at 0. Keep it simple and deterministic.
    return 1.8 * (pose.headS ? pose.headS[1] : 1)
  }

  /** Cross-fade the mixer to the action for `state` (idle/walk/run/attack/hurt/
   *  death). Falls back to idle when the state has no action. */
  _setSkinState(state) {
    if (!this._skin) return
    const next = this._skin.actions[state] || this._skin.actions.idle
    if (!next || this._skin.current === next) return
    next.reset()
    next.setEffectiveWeight(1)
    next.play()
    if (this._skin.current) next.crossFadeFrom(this._skin.current, 0.2, false)
    this._skin.current = next
    this._skinState = state
  }

  /** State update. No randomness. `audio` may be null (headless). */
  update(dt, player, zombies, collision, audio) {
    // Advance the skinned-mixer (browser-only) on every frame, including dead /
    // stagger frames, so a death animation plays out and clips stay in sync.
    if (this._skin) this._skin.mixer.update(dt)
    if (this.isDead) {
      this._setSkinState('death')
      this.deathTimer += dt
      this.position.y = -Math.min(this.deathTimer * 0.35, 0.8) // sink
      const flop = Math.min(this.deathTimer / 1.5, 1)
      this.group.rotation.x = -flop * 1.2 // fall over
      this.group.rotation.z = flop * 0.25 // loll to one side as it collapses
      // Splay the limbs as it collapses so the corpse reads dead, not frozen:
      // arms flung out, legs askew, head lolling back.
      const armRest = POSE2[this.type].armRest
      this._armL.rotation.x = armRest - flop * 0.7
      this._armR.rotation.x = armRest + flop * 0.5
      this._armL.rotation.z = -flop * 0.6
      this._armR.rotation.z = flop * 0.6
      this._legL.rotation.x = flop * 0.4
      this._legR.rotation.x = -flop * 0.3
      if (this._head) this._head.rotation.x = flop * 0.5 // head lolls back
      this.group.position.copy(this.position)
      return
    }
    // Hit-flash decay: runs on every live frame (including the attack branch,
    // which returns before _time advances), so a flash fades in real time.
    if (this._flashT > 0) {
      this._flashT -= dt
      if (this._flashT <= 0) {
        for (let i = 0; i < this._parts.length; i++) this._parts[i].material = this._restMats[i]
        if (this._skin) this._skin.skinned.material = this._skinRestMat
      }
    }
    if (!player || player.isDead) return
    // Hit stagger: after a melee hit the zombie is pushed along the knockback
    // vector while it decays linearly, and it neither chases nor attacks for
    // the duration. Displacement is smooth and deterministic (total ≈
    // KB_STRENGTH * KB_TIME / 2). Limbs drop to rest pose while staggered.
    if (this._kbT > 0) {
      this._setSkinState('hurt')
      this._kbT = Math.max(0, this._kbT - dt)
      const f = this._kbT / KB_TIME
      this.position.x += this._kbX * f * dt
      this.position.z += this._kbZ * f * dt
      collision.resolve(this.position, COLLIDER_RADIUS)
      const armRest = POSE2[this.type].armRest
      this._armL.rotation.x = armRest
      this._armR.rotation.x = armRest
      this._legL.rotation.x = 0
      this._legR.rotation.x = 0
      this.group.rotation.x = 0
      this.group.position.copy(this.position)
      return
    }
    const dx = player.position.x - this.position.x
    const dz = player.position.z - this.position.z
    const dist = Math.hypot(dx, dz)
    this.group.rotation.y = Math.atan2(dx, dz) // face player
    this._applyLOD(player.position) // skinned near, primitive stub beyond LOD_DIST
    // Boss charge: inside CHARGE_RANGE (but outside melee) the brute commits to
    // a straight lunge at the player for CHARGE_TIME seconds. The lunge uses the
    // committed direction (no separation, no slide logic) so it reads as a
    // telegraphed rush; it ends on its own timer, after which normal chase /
    // melee resumes. While lunging the zombie does not do its cooldown melee.
    if (this.isBoss && this._chargeT <= 0 && dist > ATTACK_RANGE && dist <= CHARGE_RANGE) {
      this._chargeT = CHARGE_TIME
      this._chargeX = dx / dist
      this._chargeZ = dz / dist
    }
    if (this._chargeT > 0) {
      this._setSkinState('run')
      this._chargeT = Math.max(0, this._chargeT - dt)
      const stepLen = CHARGE_SPEED * dt
      this.position.x += this._chargeX * stepLen
      this.position.z += this._chargeZ * stepLen
      collision.resolve(this.position, COLLIDER_RADIUS)
      // Lunge pose: arms cocked back, legs mid-stride (deterministic clock).
      const armRest = POSE2[this.type].armRest
      const swing = Math.sin(this._time * 14 + this._phase) * 0.6
      this._armL.rotation.x = armRest - 1.2 + swing
      this._armR.rotation.x = armRest - 1.2 - swing
      this._legL.rotation.x = swing * 1.6
      this._legR.rotation.x = -swing * 1.6
      this._time += dt
      this.group.position.copy(this.position)
      return
    }
    // Melee only lands when the player is within horizontal range AND not
    // high above the torso (a mid-jump player is out of arm reach).
    if (dist <= ATTACK_RANGE && Math.abs(player.position.y - 1.2) <= AIR_CLEAR) {
      this._setSkinState('attack')
      this._attackT += dt
      if (this._attackT >= TABLE[this.type].cooldown) {
        this._attackT = 0
        player.damage(TABLE[this.type].melee, this)
        if (audio && audio.zombieAttack) audio.zombieAttack(this.position) // null-guarded; V4P-2 positional
      }
      return
    }
    let dirX = dx / dist
    let dirZ = dz / dist
    for (const o of zombies) {
      if (o === this || o.isDead) continue
      const ox = this.position.x - o.position.x
      const oz = this.position.z - o.position.z
      const od = Math.hypot(ox, oz)
      if (od < SEPARATION_DIST && od > 1e-6) {
        dirX += (ox / od) * SEPARATION_STRENGTH
        dirZ += (oz / od) * SEPARATION_STRENGTH
      }
    }
    const len = Math.hypot(dirX, dirZ)
    if (len > 1e-6) {
      dirX /= len
      dirZ /= len
    }
    // Committed wall slide. The zombie chases the player until its step is
    // fully blocked, then commits to a slide direction (tangent to the face
    // actually in contact, sign aligned toward the player) and keeps it, so
    // it can round corners and climb out of narrow pockets. While sliding it
    // keeps the direction as long as it makes progress; a stuck zombie (no
    // progress for NO_PROG_FLIP seconds) flips to the opposite direction; in
    // free space the slide is cleared and chasing resumes.
    const wantX = dirX, wantZ = dirZ
    if (this._slideX !== undefined) { dirX = this._slideX; dirZ = this._slideZ }
    const preX = this.position.x
    const preZ = this.position.z
    const stepLen = this._effSpeed() * dt
    this.position.x += dirX * stepLen
    this.position.z += dirZ * stepLen
    collision.resolve(this.position, COLLIDER_RADIUS)
    const netX = this.position.x - preX
    const netZ = this.position.z - preZ
    const netLen = Math.hypot(netX, netZ)
    const n = contactNormal(this.position, collision.aabbs, COLLIDER_RADIUS, wantX, wantZ, this._cn)
    const pickTangent = () => {
      let tx, tz
      if (n === null) {
        // Blocked by world bounds with no AABB contact: rotate wanted 90°.
        tx = -wantZ; tz = wantX
      } else {
        // 90° rotation of the contact normal; the sign is fixed below so a
        // head-on chase (want ⊥ normal, a true tie) slides toward +x.
        tx = n.z; tz = -n.x
      }
      if (tx * wantX + tz * wantZ < 0) { tx = -tx; tz = -tz }
      this._tan.x = tx; this._tan.z = tz
      return this._tan
    }
    if (this._slideX === undefined) {
      // Chasing the player.
      if (netLen < stepLen - 1e-4) {
        // Fully blocked: commit to a slide and try to get around.
        const tan = pickTangent()
        this._slideX = tan.x; this._slideZ = tan.z
        this._slideT = 0; this._slideDist = 0; this._noProgT = 0
        this._clearDist = 0
        this._flips++
      }
    } else if (n === null) {
      // Free space: keep sliding briefly to clear the corner/edge just passed,
      // then resume chasing. Clearing immediately would let the chase direction
      // point back into the corner and trap the zombie in a ping-pong.
      this._clearDist += netLen
      this._slideT += dt
      if (this._clearDist > CLEAR_DIST) {
        this._slideX = undefined; this._slideZ = undefined
        this._slideT = 0; this._slideDist = 0; this._noProgT = 0
        this._clearDist = 0
      }
    } else {
      // Sliding while in contact with an obstacle.
      const prog = netX * this._slideX + netZ * this._slideZ
      if (prog > 0.004) {
        // Making progress along the committed direction: keep it.
        this._slideT += dt
        this._slideDist += prog
        this._noProgT = 0
        this._clearDist = 0
      } else {
        // Stuck: flip to the opposite direction after a grace period.
        this._noProgT += dt
        if (this._noProgT > NO_PROG_FLIP) {
          this._slideX = -this._slideX
          this._slideZ = -this._slideZ
          this._noProgT = 0
          this._flips++
        }
      }
    }
    this._time += dt
    // Skinned body: chase moves the legs, so pick walk (or run for the fast
    // screamer / lunge). The primitive limb code below still runs but its
    // targets are hidden once a skin is attached, so it stays harmless.
    this._setSkinState(this.speed >= 2 ? 'run' : 'walk')
    // Walk cycle, synchronized with the bob below (same frequency 6): arms
    // counter-swing the legs, the hips sway, and the head counter-bobs, so the
    // gait reads as a lurching shamble rather than a rigid slide. Deterministic:
    // _phase is the fixed-seed LCG value; no Math.random.
    const armRest = POSE2[this.type].armRest
    const t = this._time * 6 + this._phase
    const swing = Math.sin(t) * 0.42
    let legSwing = Math.sin(t) * 0.5
    // Limp: with a leg gone, the stride halves and the lost leg stays tucked up
    // (a one-legged hop). The body bobs vertically on the hop cycle.
    if (this._limp) {
      legSwing = Math.sin(t) * 0.22
      this._hopPhase = t
    }
    // Legs: bigger stride, with a small knee-lift asymmetry via a second harmonic.
    if (this._legL && this._legL.visible) this._legL.rotation.x = legSwing + Math.sin(t * 2) * 0.06
    if (this._legR && this._legR.visible) this._legR.rotation.x = -legSwing + Math.sin(t * 2 + Math.PI) * 0.06
    // Arms: counter-swing the legs, with a slight outward droop so they hang.
    if (this._armL && this._armL.visible) { this._armL.rotation.x = armRest - swing; this._armL.rotation.z = -0.12 }
    if (this._armR && this._armR.visible) { this._armR.rotation.x = armRest + swing; this._armR.rotation.z = 0.12 }
    // Hips sway side to side + a forward lean tied to how fast it moves.
    this.group.rotation.z = Math.sin(t) * 0.05
    let bob = Math.sin(this._time * 6) * 0.08 + Math.min(this.speed, 3) * 0.012
    if (this._limp) bob = Math.abs(Math.sin(t)) * 0.12 // vertical hop on one leg
    this.group.rotation.x = bob
    // Head counter-bobs against the body so the head stays steadier than the torso.
    if (this._head) this._head.rotation.z = Math.sin(t + Math.PI) * 0.04
    this.group.position.copy(this.position)
  }

  /** Weapon hitbox contract: world-space centers, so sunk corpses sink out of reach.
   *  The two-sphere contract (body + head) holds for every type; the brute's
   *  1.4× silhouette scales both radii (0.63 / 0.42) while the anchor heights
   *  stay at y+1.2 / y+1.8, so pistol/shotgun aim logic is unchanged. */
  getHitboxes() {
    const { x, y, z } = this.position
    const s = this._hitboxScale
    return [
      { center: new THREE.Vector3(x, y + 1.2, z), radius: 0.45 * s, isHead: false },
      { center: new THREE.Vector3(x, y + 1.8, z), radius: 0.3 * s, isHead: true }
    ]
  }

  /** Clothing outfit index (0 suit, 1 hoodie+sweatpants, 2 tee+jeans). */
  getOutfit() { return this._outfit }

  /** Effective movement speed given limb loss: a one-legged zombie limps at
   *  45% speed. Arms don't affect speed. Used by the chase step. */
  _effSpeed() {
    return this.legsLost > 0 ? this.speed * 0.45 : this.speed
  }

  /**
   * Limb-damage hit test. Weapons call this with the world-space point where a
   * bullet struck a zombie's body. If the point lands on an arm (near an arm
   * mesh) or a leg (near a leg mesh), that limb is severed: its mesh is hidden
   * and the counter increments. Arms keep the zombie moving normally; losing a
   * leg makes it limp (slower + a one-legged hop). Returns 'arm' | 'leg' | null
   * so the caller can play a dismember cue. The boss ignores limb damage.
   * Deterministic (no Math.random): the hit point alone decides.
   */
  hitLimbAt(x, y, z) {
    if (this.isDead || this.isBoss) return null
    // Limb centers (local, before the group origin offset): arms hang at
    // y≈1.42, ±0.34 in x; legs at y≈0.47, ±0.16 in x. A hit point within a
    // small radius of a surviving limb's world center severs it. The boss is
    // too tough to dismember, so it returns null. Deterministic: the point
    // alone decides.
    const ox = this.position.x, oz = this.position.z, oy = this.position.y
    const near = (lx, ly, lz, r) => {
      const dx = x - (ox + lx), dz = z - (oz + lz), dy = y - (oy + ly)
      return Math.hypot(dx, dy, dz) <= r
    }
    // Check legs first (a leg hit shouldn't be stolen by an overlapping arm).
    if (this.legsLost < 2) {
      if (this._legL && this._legL.visible && near(-0.16, 0.47, 0, 0.34)) { this._severLeg(this._legL); return 'leg' }
      if (this._legR && this._legR.visible && near(0.16, 0.47, 0, 0.34)) { this._severLeg(this._legR); return 'leg' }
    }
    if (this.armsLost < 2) {
      if (this._armL && this._armL.visible && near(-0.34, 1.42, 0.1, 0.3)) { this._severArm(this._armL); return 'arm' }
      if (this._armR && this._armR.visible && near(0.34, 1.42, 0.1, 0.3)) { this._severArm(this._armR); return 'arm' }
    }
    return null
  }

  _severArm(mesh) {
    mesh.visible = false
    this.armsLost++
  }

  _severLeg(mesh) {
    mesh.visible = false
    this.legsLost++
    this._limp = true
  }

  /** Contract signature; `dir` is accepted and ignored. `by` (optional) is
   *  the id of the player dealing the damage; it is recorded as lastDamager
   *  so multiplayer kill attribution can credit the killer (the last hit is
   *  the killing hit, because this method no-ops on a dead zombie).
   *  Non-fatal hits flash HITMAT for 0.15 s; a fatal hit swaps to DEADMAT. */
  damage(amount, dir = null, by = null) {
    if (this.isDead) return
    if (by !== null) this.lastDamager = by
    this.health -= amount
    if (this.health <= 0) {
      this.health = 0
      this.isDead = true
      this.deathTimer = 0
      this._flashT = 0
      for (let i = 0; i < this._parts.length; i++) this._parts[i].material = DEADMAT
      for (const e of this._eyes) e.material = DEADEYEMAT
      this._face.material = DEADMAT
      if (this._skin) this._skin.skinned.material = DEADMAT
    } else {
      this._flashT = 0.15
      for (let i = 0; i < this._parts.length; i++) this._parts[i].material = HITMAT
      if (this._skin) this._skin.skinned.material = HITMAT
    }
  }

  /** Hit reaction: stagger backward along (dx, dz) at `strength` m/s,
   *  decaying over KB_TIME. No-op on a dead zombie (its corpse is inert). */
  knockback(dx, dz, strength = KB_STRENGTH) {
    if (this.isDead) return
    this._kbX = dx * strength
    this._kbZ = dz * strength
    this._kbT = KB_TIME
  }

  /** Detach only the per-zombie group. Shared GEO/MAT are module-level and
   *  shared across all zombies — never dispose them here. */
  dispose() {
    this.scene.remove(this.group)
    // Release the per-instance mixer (stops its actions). The cloned skinned
    // mesh shares geometry with the shared loaded rig, so only the mixer and
    // this instance's cloned skeleton need cleanup — never the shared rig.
    if (this._skin) {
      this._skin.mixer.stopAllAction()
      this._skin.mixer.uncacheRoot(this._skin.mixer.getRoot())
      this._skin = null
    }
  }
}
