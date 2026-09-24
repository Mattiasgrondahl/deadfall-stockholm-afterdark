import * as THREE from 'three'

// Task 8c: night lighting, three.js r185 physical units.
// Moon = single shadow-casting DirectionalLight (1.45 lx) that follows the
// player; streetlight pool = 12 PointLights (70 cd) assigned to the nearest
// streetlight anchors each frame; hemi + ambient backstops. No per-frame
// allocation (scratch array reused, in-place sort).

const POINTS_HIGH = 12
const POINTS_LOW = 6
// Raised 55 -> 70 cd so streetlight pools read clearly against the night
// ground (readable street pools).
const POLE_INTENSITY = 70 // cd
const MOON_OFFSET = { x: -18, y: 30, z: -15 } // NW-above the player
// Raised 1.1 -> 1.45 lx: stronger moonlight so silhouettes stay readable.
const MOON_INTENSITY = 1.45

export class Lighting {
  constructor(scene, city, renderer, quality) {
    this.scene = scene
    this.city = city
    this.renderer = renderer
    this.quality = quality || 'high'
    this.anchors = city.streetlightAnchors
    // Shootable lamps: a broken lamp must not claim a pool light. The lamps
    // array (from city.lamps) is indexed in the same order as the anchors.
    this.lamps = city.lamps || null

    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.2
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = this.quality === 'high'
      // three r185 deprecates PCFSoftShadowMap (it silently falls back to
      // PCFShadowMap and warns once). Use the non-deprecated type directly so
      // the console stays clean; visually identical to the old soft map.
      renderer.shadowMap.type = THREE.PCFShadowMap
    }

    // Moon: the only shadow caster; light + target follow the player.
    // Raised 1.1 -> 1.45 lx for readable silhouettes and stronger shadows.
    this.moon = new THREE.DirectionalLight(0x9db4ff, MOON_INTENSITY)
    this.moon.castShadow = true
    this.moon.shadow.mapSize.set(2048, 2048)
    this.moon.shadow.bias = 0.004
    this.moon.shadow.normalBias = 0.05
    const sc = this.moon.shadow.camera
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22
    sc.near = 1; sc.far = 120
    scene.add(this.moon)
    scene.add(this.moon.target) // target must be in the scene graph

    // Hemi/ambient raised (0.22 -> 0.30, 0.08 -> 0.12) so night shapes and
    // silhouettes stay readable without adding lights.
    this.hemi = new THREE.HemisphereLight(0x1a2440, 0x0a0a10, 0.30)
    scene.add(this.hemi)
    this.ambient = new THREE.AmbientLight(0x141a2e, 0.12)
    scene.add(this.ambient)

    // Streetlight pool: fixed settings; positions assigned in update().
    this.lights = []
    for (let i = 0; i < POINTS_HIGH; i++) {
      const l = new THREE.PointLight(0xffb066, POLE_INTENSITY, 14, 2)
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
    // Walk the nearest-first list and assign pool lights to the nearest LIT
    // (non-broken) anchors; broken lamps are skipped so their light goes dark.
    let k = 0
    for (let j = 0; j < s.length && k < this.lights.length; j++) {
      const idx = s[j].i
      if (this.lamps && this.lamps[idx] && this.lamps[idx].broken) continue
      const anchor = a[idx]
      if (k < n) {
        this.lights[k].position.set(anchor.x, anchor.y, anchor.z)
        this.lights[k].intensity = POLE_INTENSITY
      } else {
        this.lights[k].intensity = 0
      }
      k++
    }
    for (; k < this.lights.length; k++) this.lights[k].intensity = 0
  }

  setQuality(q) {
    const tier = q === 'low' ? 'low' : q === 'medium' ? 'medium' : 'high'
    this.quality = tier === 'high' ? 'high' : 'low'
    if (this.renderer.shadowMap) this.renderer.shadowMap.enabled = this.quality === 'high'
    // v6 visuals (3): snow layering follows the quality tier. 'low' keeps the
    // pinned 750-drawn halve, 'medium' gets an intermediate 1050, 'high' the
    // full 1500. Snow tiers are independent of the shadow/lighting collapse.
    if (this.city.setSnowCount) this.city.setSnowCount(tier === 'high' ? 1500 : tier === 'medium' ? 1050 : 750)
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
