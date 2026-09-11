import * as THREE from 'three'

// Task 8c: night lighting, three.js r185 physical units.
// Moon = single shadow-casting DirectionalLight (0.8 lx) that follows the
// player; streetlight pool = 12 PointLights (35 cd) assigned to the nearest
// streetlight anchors each frame; hemi + ambient backstops. No per-frame
// allocation (scratch array reused, in-place sort).

const POINTS_HIGH = 12
const POINTS_LOW = 6
const POLE_INTENSITY = 35 // cd
const MOON_OFFSET = { x: -18, y: 30, z: -15 } // NW-above the player

export class Lighting {
  constructor(scene, city, renderer, quality) {
    this.scene = scene
    this.city = city
    this.renderer = renderer
    this.quality = quality || 'high'
    this.anchors = city.streetlightAnchors

    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.2
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = this.quality === 'high'
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
    }

    // Moon: the only shadow caster; light + target follow the player.
    this.moon = new THREE.DirectionalLight(0x9db4ff, 0.8)
    this.moon.castShadow = true
    this.moon.shadow.mapSize.set(2048, 2048)
    const sc = this.moon.shadow.camera
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22
    sc.near = 1; sc.far = 120
    scene.add(this.moon)
    scene.add(this.moon.target) // target must be in the scene graph

    this.hemi = new THREE.HemisphereLight(0x1a2440, 0x0a0a10, 0.3)
    scene.add(this.hemi)
    this.ambient = new THREE.AmbientLight(0x141a2e, 0.15)
    scene.add(this.ambient)

    // Streetlight pool: fixed settings; positions assigned in update().
    this.lights = []
    for (let i = 0; i < POINTS_HIGH; i++) {
      const l = new THREE.PointLight(0xffb878, POLE_INTENSITY, 20, 2)
      scene.add(l)
      this.lights.push(l)
    }

    // Reused nearest-anchor scratch — no per-frame allocation.
    this.scratch = this.anchors.map(a => ({ i: 0, d2: 0 }))
  }

  update(playerPos) {
    this.moon.position.set(playerPos.x + MOON_OFFSET.x, MOON_OFFSET.y, playerPos.z + MOON_OFFSET.z)
    this.moon.target.position.copy(playerPos)
    this.moon.target.updateMatrixWorld()

    const a = this.anchors
    const s = this.scratch
    for (let i = 0; i < a.length; i++) {
      const dx = a[i].x - playerPos.x
      const dz = a[i].z - playerPos.z
      s[i].i = i
      s[i].d2 = dx * dx + dz * dz
    }
    s.sort((p, q) => p.d2 - q.d2)

    const n = this.quality === 'high' ? POINTS_HIGH : POINTS_LOW
    for (let k = 0; k < this.lights.length; k++) {
      if (k < n) {
        const anchor = a[s[k].i]
        this.lights[k].position.set(anchor.x, anchor.y, anchor.z)
        this.lights[k].intensity = POLE_INTENSITY
      } else {
        this.lights[k].intensity = 0
      }
    }
  }

  setQuality(q) {
    this.quality = q === 'low' ? 'low' : 'high'
    if (this.renderer.shadowMap) this.renderer.shadowMap.enabled = this.quality === 'high'
    if (this.city.setSnowCount) this.city.setSnowCount(this.quality === 'high' ? 1500 : 750)
    this.update(this.moon.target.position)
  }

  dispose() {
    this.scene.remove(this.moon, this.moon.target, this.hemi, this.ambient)
    this.moon.dispose()
    this.hemi.dispose()
    this.ambient.dispose()
    for (const l of this.lights) {
      this.scene.remove(l)
      l.dispose()
    }
    if (this.renderer.shadowMap) this.renderer.shadowMap.enabled = false
  }
}
