import * as THREE from 'three'
import { addStreetlights, addVehicles, addBarricades } from './cityDressing.js'
import { createSnow } from './snow.js'

const PALETTE = [0x232d3f, 0x2b364d, 0x33415c, 0x273246]
const TINTS = [1.12, 1.0, 0.9, 0.78]
const SPAWNS = [
  [-85, 0], [85, 0], [0, -85], [0, 85],
  [-85, -85], [85, -85], [-85, 85], [85, 85],
  [-12, -12], [12, -12], [-12, 12], [12, 12]
].map(([x, z]) => ({ x, z }))

export class City {
  constructor(scene, collision, env) {
    this.scene = scene
    this.collision = collision
    this.env = env
    this._aabbs = []
    this._disposed = false
    let s = 7 // deterministic LCG layout; no Math.random
    const rnd = () => (s = (s * 48271) % 65537) / 65537

    const group = new THREE.Group()
    group.name = 'city'

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(180, 180),
      new THREE.MeshStandardMaterial({ color: 0x93a9c2, roughness: 0.95 })
    )
    ground.rotation.x = -Math.PI / 2
    group.add(ground)

    const building = (x, z, w, d, h, zone) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE[Math.floor(rnd() * 4)]).multiplyScalar(TINTS[zone]), roughness: 0.88, metalness: 0.05 })
      )
      mesh.position.set(x, h / 2, z)
      group.add(mesh)
      collision.addAABB(x - w / 2 - 0.5, z - d / 2 - 0.5, x + w / 2 + 0.5, z + d / 2 + 0.5, h)
      this._aabbs.push(collision.aabbs[collision.aabbs.length - 1])
    }

    // Center block (0,0): one 8x4x9 building; registered first -> collision.aabbs[0].
    building(0, 0, 8, 4, 9, 0)

    // 7x7 blocks (pitch 24, size 15): plaza or 4 quadrant buildings (2 m alleys).
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        if (i === 3 && j === 3) continue
        const bx = (i - 3) * 24
        const bz = (j - 3) * 24
        const zone = Math.max(Math.abs(i - 3), Math.abs(j - 3))
        if (rnd() < 0.4) continue // plaza: no buildings
        for (let q = 0; q < 4; q++) {
          if (rnd() >= 0.6) continue
          const qx = bx + (q & 1 ? 4.25 : -4.25)
          const qz = bz + (q & 2 ? 4.25 : -4.25)
          building(qx, qz, 5.5, 5.5, 5 + Math.floor(rnd() * 18), zone)
        }
      }
    }

    this.streetlightAnchors = addStreetlights(group)
  this._aabbs.push(...addVehicles(group, collision))
  this._aabbs.push(...addBarricades(group, collision))
  this.snow = createSnow()
  group.add(this.snow.points)
    this.group = group
    scene.add(group)
  }

  getSpawnPoints() { return SPAWNS }

  setSnowCount(n) { this.snow.setCount(n) }

  update(playerPos, dt = 0) { this.snow.update(playerPos, dt) }

  dispose() {
    if (this._disposed) return
    this.scene.remove(this.group)
    for (const m of this.group.children) {
      m.geometry.dispose()
      m.material.dispose()
    }
    for (const a of this._aabbs) {
      const i = this.collision.aabbs.indexOf(a)
      if (i >= 0) this.collision.aabbs.splice(i, 1)
    }
    this._aabbs = []
    this._disposed = true
  }
}
