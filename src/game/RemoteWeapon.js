// src/game/RemoteWeapon.js — v25 co-op: make a remote player's held weapon +
// muzzle flash visible to teammates.
//
// The local player's weapon is a first-person viewmodel attached to the camera,
// so teammates never see it. This module builds a cheap THIRD-PERSON weapon
// silhouette that a RemotePlayer holds in its right hand, plus a short-lived
// muzzle-flash sprite that pops when the server reports a `shoot` event for that
// player. Geometry + materials are SHARED per weapon kind (module-level, like
// RemotePlayer's GEO), so 8 avatars add only a handful of meshes and no
// per-frame allocation. Headless-safe: plain THREE objects, no DOM/WebGL.
//
// Weapon silhouettes mirror the first-person viewmodels (same dark-metal / wood
// colors, same proportions) so a teammate's gun reads as the same weapon the
// local player holds. The flash mirrors the real muzzle-flash color per weapon.
import * as THREE from 'three'

// Per-kind shared geometry (one instance reused by every avatar holding it).
// Sizes mirror the viewmodel parts but are simplified to 1-2 boxes each to stay
// inside the mesh budget (a held weapon is a silhouette, not a detailed prop).
const GEO = {
  pistol: [new THREE.BoxGeometry(0.06, 0.09, 0.26), new THREE.BoxGeometry(0.05, 0.1, 0.06)],
  shotgun: [new THREE.BoxGeometry(0.07, 0.08, 0.6), new THREE.BoxGeometry(0.07, 0.09, 0.12)],
  sniper: [new THREE.BoxGeometry(0.06, 0.09, 0.9)],
  axe: [new THREE.BoxGeometry(0.04, 0.6, 0.04), new THREE.BoxGeometry(0.16, 0.2, 0.05)],
  sword: [new THREE.BoxGeometry(0.07, 0.6, 0.03), new THREE.BoxGeometry(0.14, 0.04, 0.05)],
}
// Per-kind shared materials (dark metal + a secondary accent), matching the FP
// viewmodel palettes so the weapon reads as the same gun.
const MATS = {
  pistol: [
    new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.42, metalness: 0.85 }),
    new THREE.MeshStandardMaterial({ color: 0x4a5157, roughness: 0.4, metalness: 0.7 }),
  ],
  shotgun: [
    new THREE.MeshStandardMaterial({ color: 0x212429, roughness: 0.45, metalness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0x212429, roughness: 0.45, metalness: 0.8 }),
  ],
  sniper: [
    new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.45, metalness: 0.8 }),
  ],
  axe: [
    new THREE.MeshStandardMaterial({ color: 0x6b5433, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x5a6066, roughness: 0.5, metalness: 0.5 }),
  ],
  sword: [
    new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.35, metalness: 0.7 }),
    new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.6, metalness: 0.4 }),
  ],
}
// Muzzle-flash color per ranged weapon (mirrors each viewmodel's flash sprite).
// Melee (axe/sword) has no muzzle flash; the swing itself is the cue.
const FLASH_COLOR = { pistol: 0xffd9a0, shotgun: 0xffcf8a, sniper: 0xffd9a0 }
// Where the weapon sits relative to the avatar's chest, and which way it points.
// Held in the right hand, out front, roughly along the facing direction (+z in
// group space, since the group is rotated to the player's yaw).
const HAND = { x: 0.34, y: 1.15, z: 0.28 }
// Flash sprite sits at the muzzle tip (forward of the hand by the barrel length).
const MUZZLE = { pistol: 0.16, shotgun: 0.34, sniper: 0.48 }
const FLASH_TIME = 0.08 // seconds the flash stays lit

/**
 * Build a held-weapon group for one weapon kind. Returns a Group parented by the
 * caller (RemotePlayer) to its body, or null for an unknown/empty weapon name.
 * The group holds shared-geometry meshes; dispose is a no-op (shared resources).
 */
export function buildRemoteWeapon(name) {
  const parts = GEO[name]
  const mats = MATS[name]
  if (!parts || !mats) return null
  const g = new THREE.Group()
  g.position.set(HAND.x, HAND.y, HAND.z)
  // Grip it pointing forward (+z) with a slight downward tilt so it reads as a
  // ready weapon rather than floating flat.
  g.rotation.x = -Math.PI / 2 + 0.12
  for (let i = 0; i < parts.length; i++) {
    const m = new THREE.Mesh(parts[i], mats[Math.min(i, mats.length - 1)])
    m.castShadow = true
    // Stack the second part (grip/stock/pump/head) behind the first (barrel/blade).
    if (i === 1) m.position.z = name === 'axe' || name === 'sword' ? -0.22 : -0.14
    g.add(m)
  }
  g.userData.weapon = name
  return g
}

/**
 * Build a muzzle-flash sprite for a ranged weapon kind, or null for melee. The
 * sprite is additive + depthTest false so it reads in the dim co-op scene.
 */
export function buildMuzzleFlash(name) {
  const color = FLASH_COLOR[name]
  if (color == null) return null
  const mat = new THREE.SpriteMaterial({
    color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false,
  })
  const s = new THREE.Sprite(mat)
  s.scale.setScalar(0.22)
  s.visible = false
  // Sit at the muzzle tip along the weapon's forward axis (group +z).
  s.position.set(HAND.x, HAND.y, HAND.z + (MUZZLE[name] ?? 0.2))
  return s
}

/** Advance a muzzle-flash sprite one frame: fade out over FLASH_TIME. */
export function updateMuzzleFlash(sprite, dt) {
  if (!sprite || !sprite.visible) return
  sprite.userData.flashT = (sprite.userData.flashT ?? 0) - dt
  if (sprite.userData.flashT <= 0) {
    sprite.visible = false
    sprite.material.opacity = 0
    return
  }
  const f = sprite.userData.flashT / FLASH_TIME
  sprite.material.opacity = 0.9 * f
  sprite.scale.setScalar(0.12 + 0.16 * f)
}

/** Light a muzzle-flash sprite for a fresh shot. */
export function triggerMuzzleFlash(sprite) {
  if (!sprite) return
  sprite.visible = true
  sprite.userData.flashT = FLASH_TIME
  sprite.material.opacity = 0.9
  sprite.scale.setScalar(0.22)
}