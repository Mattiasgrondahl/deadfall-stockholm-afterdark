// src/game/RemotePlayer.js — Phase 2 of MULTIPLAYER_PLAN.md (§6, §11): a cheap
// avatar for OTHER players, driven entirely by snapshots.
//
// The local player has no visible body (first-person), so remote players need a
// simple third-person silhouette. This is a 6-part primitive body (torso, head,
// two arms, two legs) using SHARED module-level geometry + materials, so 8
// avatars add only 48 meshes to the client scene — well inside the ≤600 budget.
// It never simulates: the Game feeds it x/y/z/yaw/pitch/health/dead from the
// snapshot each frame and it just positions + poses the parts. Headless-safe:
// it builds plain THREE objects and touches no DOM/WebGL.
//
// v3 T11: the avatar now wears the SAME outfit materials the single-player
// zombies wear (shared OUTFITMATS from Zombie.js — tops on the torso, bottoms
// on the legs) so remote players read as clothed people instead of flat tinted
// boxes; the head + arms keep a per-id tint so players stay distinguishable.
// Feet are grounded on the ground plane (the group origin sits at the feet, not
// the eye), so avatars no longer hover a body-height above the ground. A name
// label (a canvas-texture Sprite) floats over the head in the browser; in
// headless runs (no canvas factory) it is skipped and the budget is unchanged.
import * as THREE from 'three'
import { OUTFITMATS } from './Zombie.js'
import { buildRemoteWeapon, buildMuzzleFlash, updateMuzzleFlash, triggerMuzzleFlash } from './RemoteWeapon.js'

// Shared geometry (one instance reused by every avatar).
const GEO = {
  torso: new THREE.BoxGeometry(0.5, 1.0, 0.35),
  head: new THREE.BoxGeometry(0.28, 0.3, 0.28),
  arm: new THREE.BoxGeometry(0.13, 0.6, 0.13),
  leg: new THREE.BoxGeometry(0.16, 0.9, 0.16),
  // v34: facial features so a remote avatar's FACING is readable at a glance.
  // Mounted on the head's front face (local -Z, the yaw-0 facing direction), so
  // they rotate with the group's yaw. Tiny boxes read as eyes/nose/mouth.
  eye: new THREE.BoxGeometry(0.05, 0.05, 0.02),
  nose: new THREE.BoxGeometry(0.05, 0.06, 0.04),
  mouth: new THREE.BoxGeometry(0.12, 0.03, 0.02),
}
// One shared dark material for every avatar's face features (never disposed here).
const FACE_MAT = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.9 })
// Per-id tint so players read as distinct; falls back to a neutral color.
const PALETTE = [0x3f7fbf, 0xbf7f3f, 0x3fbf7f, 0xbf3f7f, 0x7f3fbf, 0xbfbf3f, 0x3fbfbe, 0xbe3fbf]
const DEAD_MAT = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 1 })
// CTF team tints (match the HUD scoreboard colors) so remote avatars read as
// teammates vs opponents in a capture-the-flag match. Unknown/null team falls
// back to the per-id tint.
const TEAM_TINT = { lovis: 0x2f6b4a, krag: 0xb0663a }
// The snapshot carries the player's EYE height (position.y, STAND_EYE = 1.7 when
// standing). The avatar group origin is the FEET, so the eye height is subtracted
// to plant the feet on the ground plane instead of hovering a body above it.
const STAND_EYE = 1.7
// Deterministic outfit pick per id (no Math.random) so an avatar's clothes are
// stable across snapshots and identical for every client seeing that player.
const OUTFIT_COUNT = OUTFITMATS.tops.length

function tintFor(id) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

function outfitFor(id) {
  let h = 2166136261
  const s = String(id)
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) & 0x7fffffff
  return h % OUTFIT_COUNT
}

// Build a small name-plate texture from a canvas (browser only). Returns null
// when no canvas is available (headless), so the label is simply skipped.
function makeNameTexture(canvasFactory, name) {
  if (!canvasFactory) return null
  const safe = String(name || '').slice(0, 24)
  if (!safe) return null
  let canvas
  try { canvas = canvasFactory() } catch (err) { return null }
  if (!canvas || !canvas.getContext) return null
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  canvas.width = 256
  canvas.height = 64
  ctx.clearRect(0, 0, 256, 64)
  ctx.font = 'bold 40px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(8,12,20,0.55)'
  ctx.fillRect(0, 0, 256, 64)
  ctx.fillStyle = '#cfe3ff'
  ctx.fillText(safe, 128, 34)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

export class RemotePlayer {
  /**
   * @param {THREE.Scene} scene
   * @param {string} id player id (used for a stable tint + outfit)
   * @param {object} [opts] { name, canvasFactory } — v3 T11 display name +
   *        optional canvas factory for the name label (browser only)
   */
  constructor(scene, id, opts = {}) {
    this.id = id
    this.group = new THREE.Group()
    const color = tintFor(id)
    // Bright tint + matching emissive so the avatar reads in the dim co-op
    // scene (a plain MeshStandardMaterial box group read as a black blob).
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, emissive: color, emissiveIntensity: 0.45 })
    this._mat = mat
    // v3 T11: shared outfit materials (tops/bottoms) so the avatar is clothed
    // like the single-player bodies. These are SHARED — never disposed here.
    const outfit = outfitFor(id)
    const topMat = OUTFITMATS.tops[outfit]
    const bottomMat = OUTFITMATS.bottoms[outfit]
    const mk = (geo, x, y, z, m) => {
      const mesh = new THREE.Mesh(geo, m)
      mesh.position.set(x, y, z)
      this.group.add(mesh)
      return mesh
    }
    this.torso = mk(GEO.torso, 0, 1.1, 0, topMat)
    this.head = mk(GEO.head, 0, 1.75, 0, mat)
    // v34: face features parented to the head so the avatar's facing is legible.
    // Local -Z is the yaw-0 facing direction; the head sits at the group origin's
    // head height, so these offsets are relative to the head center.
    const face = (geo, x, y, z) => {
      const m = new THREE.Mesh(geo, FACE_MAT)
      m.position.set(x, y, z)
      this.head.add(m)
      return m
    }
    this._faceParts = [
      face(GEO.eye, -0.06, 0.03, -0.145),
      face(GEO.eye, 0.06, 0.03, -0.145),
      face(GEO.nose, 0, -0.01, -0.15),
      face(GEO.mouth, 0, -0.08, -0.145),
    ]
    this.armL = mk(GEO.arm, -0.36, 1.1, 0, mat)
    this.armR = mk(GEO.arm, 0.36, 1.1, 0, mat)
    this.legL = mk(GEO.leg, -0.12, 0.45, 0, bottomMat)
    this.legR = mk(GEO.leg, 0.12, 0.45, 0, bottomMat)
    this._parts = [this.torso, this.head, this.armL, this.armR, this.legL, this.legR]
    this._outfitMats = [topMat, bottomMat] // shared; tracked for the dead-swap restore
    this._walkPhase = 0
    // v3 T11: name label sprite (browser only; headless skips it). A Sprite is
    // not counted as a mesh, so the budget is unchanged.
    this._label = null
    const tex = makeNameTexture(opts.canvasFactory, opts.name)
    if (tex) {
      const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
      this._label = new THREE.Sprite(spriteMat)
      this._label.scale.set(1.6, 0.4, 1)
      this._label.position.set(0, 2.15, 0) // above the head, in group (feet) space
      this.group.add(this._label)
    }
    // v25: the avatar holds a weapon silhouette + carries a muzzle-flash sprite so
    // teammates can see what it is holding and when it fires. The held group is
    // swapped when the snapshot's weapon changes; the flash is triggered by the
    // server's `shoot` event (Multiplayer routes it via flash()). Both are added
    // to the group so they move with the avatar and go away on dispose.
    this._weaponName = null
    this._weapon = null
    this._flash = null
    this._setWeapon('shotgun') // default until the first snapshot sets the real one
    scene.add(this.group)
  }

  /** Swap the held weapon silhouette to match a weapon name (idempotent). */
  _setWeapon(name) {
    if (name === this._weaponName) return
    const g = buildRemoteWeapon(name)
    if (!g) return // unknown weapon: keep the current one
    if (this._weapon) this.group.remove(this._weapon)
    if (this._flash) { this.group.remove(this._flash); this._flash.material.dispose(); this._flash = null }
    this._weapon = g
    this._weaponName = name
    this.group.add(g)
    this._flash = buildMuzzleFlash(name)
    if (this._flash) this.group.add(this._flash)
  }

  /** Light the muzzle flash (called by Multiplayer on a `shoot` event). */
  flash() {
    triggerMuzzleFlash(this._flash)
  }

  /** CTF: tint the avatar's per-instance head/arm material to its team color so
   *  teammates are identifiable in a capture-the-flag match. Passing null (or an
   *  unknown team) restores the per-id tint captured at construction. The dead
   *  swap in apply() overrides every material to DEAD_MAT regardless, so a dead
   *  avatar stays dark even when a team is set. */
  setTeam(team) {
    if (team === this._team) return
    this._team = team
    const color = TEAM_TINT[team]
    if (!this._mat) return
    if (color == null) {
      this._mat.color.set(tintFor(this.id))
      this._mat.emissive.copy(this._mat.color)
    } else {
      this._mat.color.set(color)
      this._mat.emissive.copy(this._mat.color)
    }
  }

  /**
   * Apply one snapshot player entry. Positions the group, faces it toward the
   * yaw, and drives a cheap procedural limb swing from movement delta so the
   * avatar reads as walking (the same idea as the zombie primitive walk).
   */
  apply(p, dt = 0) {
    if (!p) return
    // v3 T11: the snapshot y is the EYE height; the group origin is the FEET, so
    // subtract the standing eye height to plant the feet on the ground plane.
    // When the player jumps (p.y rises) the feet lift with it, and crouching
    // (p.y drops) lowers them — the avatar stays grounded instead of hovering.
    const eye = p.y != null ? p.y : STAND_EYE
    this.group.position.set(p.x, eye - STAND_EYE, p.z)
    this.group.rotation.y = p.yaw || 0
    const moving = !p.dead && (Math.abs(p.x - (this._lastX ?? p.x)) + Math.abs(p.z - (this._lastZ ?? p.z))) > 0.001
    this._lastX = p.x; this._lastZ = p.z
    if (moving) {
      this._walkPhase += dt * 8
      const s = Math.sin(this._walkPhase) * 0.5
      this.armL.rotation.x = s
      this.armR.rotation.x = -s
      this.legL.rotation.x = -s
      this.legR.rotation.x = s
    } else {
      this.armL.rotation.x = this.armR.rotation.x = this.legL.rotation.x = this.legR.rotation.x = 0
    }
    // Dead avatars go dark + sink slightly (feet drop below the ground plane).
    if (p.dead) {
      this.torso.material = DEAD_MAT
      this.legL.material = DEAD_MAT
      this.legR.material = DEAD_MAT
      this.head.material = DEAD_MAT
      this.armL.material = DEAD_MAT
      this.armR.material = DEAD_MAT
      this.group.position.y = (eye - STAND_EYE) - 0.6
      if (this._label) this._label.visible = false
    } else {
      this.torso.material = this._outfitMats[0]
      this.legL.material = this._outfitMats[1]
      this.legR.material = this._outfitMats[1]
      this.head.material = this._mat
      this.armL.material = this._mat
      this.armR.material = this._mat
      if (this._label) this._label.visible = true
    }
    // v25: keep the held weapon in sync with the snapshot and fade the muzzle
    // flash. A dead avatar drops its weapon (hidden) so a corpse doesn't float a
    // gun. The flash ticks down every frame regardless of dead state.
    if (p.weapon && p.weapon !== this._weaponName) this._setWeapon(p.weapon)
    if (this._weapon) this._weapon.visible = !p.dead
    updateMuzzleFlash(this._flash, dt)
  }

  dispose() {
    // The per-instance tint material + the name-label sprite material/texture are
    // owned here; the outfit materials + geometry + DEAD_MAT are shared and must
    // NOT be disposed.
    this._mat.dispose()
    if (this._label) {
      if (this._label.material) this._label.material.dispose()
      if (this._label.material && this._label.material.map) this._label.material.map.dispose()
      this._label = null
    }
    // v25: the muzzle-flash sprite material is owned per-instance (a fresh
    // SpriteMaterial per avatar); the held weapon group uses SHARED geometry +
    // materials, so it is only detached (with the group), never disposed here.
    if (this._flash) { this._flash.material.dispose(); this._flash = null }
    this._weapon = null
    // v34: detach the face features from the head (their geometry + FACE_MAT are
    // shared module-level and must NOT be disposed here).
    if (this._faceParts) {
      for (const m of this._faceParts) if (this.head) this.head.remove(m)
      this._faceParts = null
    }
    if (this.group.parent) this.group.parent.remove(this.group)
    this.group.clear()
  }
}