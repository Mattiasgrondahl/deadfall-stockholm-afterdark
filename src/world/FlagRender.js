// FlagRender.js — client-side rendering of the CTF flags from a snapshot.
//
// The authoritative flag state lives on the server (game/Flag.js); the client
// only draws it. This module builds, for each team, a static flag pole at the
// team's base pedestal plus a banner mesh whose position tracks the flag:
//   - at base   -> banner sits on its own pedestal
//   - carried   -> banner rides above the carrier (looked up from the snapshot
//                  players list by carrier id)
//   - dropped   -> banner lies flat at the dropped field position
// A soft ground ring marks each base's capture zone so players can see the
// target. Everything is a handful of meshes + one ring pair; the whole thing is
// disposed cleanly. No RNG, no per-frame allocation, headless-safe (scene is
// injected; textures are optional via canvasFactory).

import * as THREE from 'three'

const TEAM_COLOR = { lovis: 0x2f6b4a, krag: 0xb0663a } // lovis green, krag amber
const POLE_H = 6.0
const BANNER_Y = POLE_H - 0.9
const CARRIER_LIFT = 2.4 // banner floats above a carrier's head

const _v = new THREE.Vector3()

export class FlagRender {
  /**
   * @param opts { scene, bases:{lovis:{x,z},krag:{x,z}}, canvasFactory? }
   */
  constructor(opts = {}) {
    this.scene = opts.scene
    this.bases = opts.bases || { lovis: { x: -90, z: -90 }, krag: { x: 90, z: 90 } }
    this.group = new THREE.Group()
    this.group.name = 'flags'
    this.group.frustumCulled = false
    if (this.scene) this.scene.add(this.group)

    const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, POLE_H, 6)
    const bannerGeo = new THREE.PlaneGeometry(1.6, 1.0)
    const ringGeo = new THREE.RingGeometry(3.4, 4.0, 24)
    ringGeo.rotateX(-Math.PI / 2)
    this._poleGeo = poleGeo
    this._bannerGeo = bannerGeo
    this._ringGeo = ringGeo
    this._mats = []
    this._parts = {}

    for (const team of ['lovis', 'krag']) {
      const b = this.bases[team]
      const color = TEAM_COLOR[team]
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.7 })
      const bannerMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.25 })
      const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide })
      this._mats.push(poleMat, bannerMat, ringMat)

      const pole = new THREE.Mesh(poleGeo, poleMat)
      pole.position.set(b.x, POLE_H / 2, b.z)
      const banner = new THREE.Mesh(bannerGeo, bannerMat)
      banner.position.set(b.x + 0.9, BANNER_Y, b.z)
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.position.set(b.x, 0.03, b.z)

      this.group.add(pole, banner, ring)
      this._parts[team] = { pole, banner, ring, bannerMat }
    }
  }

  /** Feed one snapshot's ctf block + players list. Positions the banners:
   *  carried -> above the carrier; dropped -> at the drop spot; at base -> on
   *  the pedestal. Called once per snapshot (10 Hz), not per frame. */
  sync(ctf, players) {
    if (!ctf) return
    const byId = new Map()
    for (const p of players) byId.set(p.id, p)
    for (const team of ['lovis', 'krag']) {
      const f = ctf.flags && ctf.flags[team]
      const part = this._parts[team]
      if (!f || !part) continue
      const b = this.bases[team]
      if (f.carrier !== null && byId.has(f.carrier)) {
        const c = byId.get(f.carrier)
        part.banner.position.set(c.x + 0.6, c.y + CARRIER_LIFT, c.z)
        part.banner.visible = true
      } else if (f.dropped) {
        part.banner.position.set(f.dropped.x, 0.4, f.dropped.z)
        part.banner.visible = true
      } else {
        part.banner.position.set(b.x + 0.9, BANNER_Y, b.z)
        part.banner.visible = true
      }
    }
  }

  /** Cheap per-frame flutter so a carried banner reads as cloth, not a card. */
  update(dt, time) {
    for (const team of ['lovis', 'krag']) {
      const part = this._parts[team]
      if (part) part.banner.rotation.y = Math.sin(time * 3 + (team === 'lovis' ? 0 : 1.5)) * 0.25
    }
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group)
    this._poleGeo.dispose()
    this._bannerGeo.dispose()
    this._ringGeo.dispose()
    for (const m of this._mats) m.dispose()
    this._parts = {}
    this._mats = []
  }
}