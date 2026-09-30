// Deadfall: Stockholm Afterdark — v28 R4 landmark silhouettes.
//
// Three recognizable Stockholm landmarks on the far skyline ring, so the night
// city reads as *Stockholm* and not a generic dark town:
//   - Kaknästornet: a slender tapered TV mast (the tallest thing on the horizon).
//   - Globen (Ericsson Globe): the big white sphere, here a dark dome silhouette.
//   - Gamla stan spire: a needle-thin old-town church steeple.
//
// They sit on the same 360-400 m band as the generic skyline boxes (sky.js) and
// share the same dark, fog-disabled look so they read as part of the skyline.
// This is a SEPARATE scene object (not a Sky child) so the Sky group's fixed
// child/mesh counts are untouched. Deterministic (fixed positions, no RNG).
//
// Budget: +3 meshes, +3 geometries, +1 material. dispose() reverses all of it.
// Headless-safe: takes only a THREE scene; no document/window/AudioContext.

import * as THREE from 'three'

// Same dark tone as the generic skyline silhouettes (sky.js 0x141c28) so the
// landmarks blend into the lit-city skyline rather than popping as black shapes.
const LANDMARK_COLOR = 0x141c28
// Ring band — must stay under the camera far plane (520 in Game.js).
const RING_DIST = 380

export class Landmarks {
  /** @param scene THREE.Scene to add the landmark group to. */
  constructor(scene) {
    // One shared dark material for all three (fog off — they sit 380 m out where
    // FogExp2 would otherwise erase them entirely).
    this.mat = new THREE.MeshBasicMaterial({ color: LANDMARK_COLOR, fog: false })

    // Kaknästornet: a tall, tapering mast. A 4-sided cylinder pinched to a near
    // point at the top reads as a slender TV tower against the sky.
    this.towerGeo = new THREE.CylinderGeometry(1.5, 7, 96, 6)
    this.tower = new THREE.Mesh(this.towerGeo, this.mat)
    this.tower.position.set(-RING_DIST * 0.72, 48, -RING_DIST * 0.69)

    // Globen: the Ericsson Globe — a large sphere half-sunk so only the dome
    // shows above the horizon line, exactly like the real arena.
    this.globeGeo = new THREE.SphereGeometry(34, 16, 12)
    this.globe = new THREE.Mesh(this.globeGeo, this.mat)
    this.globe.position.set(RING_DIST * 0.55, 12, -RING_DIST * 0.83)

    // Gamla stan spire: a needle-thin steeple (a narrow cone) — the old-town
    // church profile that pins the skyline to the historic core.
    this.spireGeo = new THREE.ConeGeometry(5, 60, 6)
    this.spire = new THREE.Mesh(this.spireGeo, this.mat)
    this.spire.position.set(RING_DIST * 0.2, 30, -RING_DIST * 0.98)

    this.meshes = [this.tower, this.globe, this.spire]
    this.geos = [this.towerGeo, this.globeGeo, this.spireGeo]

    this.group = new THREE.Group()
    this.group.name = 'landmarks'
    for (const m of this.meshes) this.group.add(m)
    // Fixed world positions (parallax depth cue) — never follow the player.
    this.group.frustumCulled = false
    scene.add(this.group)
    this.scene = scene
  }

  /** Landmarks are static; no per-frame work. Kept for API symmetry with Sky. */
  update() {}

  /** Remove the group and dispose every geometry + the shared material. */
  dispose() {
    if (!this.group) return
    if (this.scene) this.scene.remove(this.group)
    for (const g of this.geos) g.dispose()
    this.mat.dispose()
    this.group = null
    this.meshes = null
    this.tower = this.globe = this.spire = null
    this.towerGeo = this.globeGeo = this.spireGeo = null
    this.mat = null
    this.scene = null
  }
}