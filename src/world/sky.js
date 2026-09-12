// Deadfall: Stockholm Afterdark — night sky: dome, moon, city silhouettes.
// Headless-safe (no window/document/audio); deterministic LCG, no Math.random.

import * as THREE from 'three'

export class Sky {
  constructor(scene) {
    this.scene = scene
    this.group = new THREE.Group()

    // Seeded LCG: deterministic, non-negative, no Math.random.
    let s = 9137
    const rnd = () => { s = (s * 48271) % 65537; return s / 65537 }

    // 1. Sky dome. The dome follows the player in update(), so vPos is view-relative.
    this.domeGeo = new THREE.SphereGeometry(420, 16, 12)
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor: { value: new THREE.Color(0x04070f) },
        horizonColor: { value: new THREE.Color(0x0d1626) },
        glowColor: { value: new THREE.Color(0x2a3446) }
      },
      vertexShader:
        'varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 glowColor; varying vec3 vPos; void main() { float h = normalize(vPos).y; vec3 c = mix(horizonColor, topColor, clamp(h, 0.0, 1.0)); c += glowColor * exp(-pow(h * 12.0, 2.0)) * 0.35; gl_FragColor = vec4(c, 1.0); }'
    })
    this.dome = new THREE.Mesh(this.domeGeo, this.domeMat)
    this.group.add(this.dome)

    // 2. Moon. Direction MUST match Lighting.js MOON_OFFSET (-18, 30, -15).
    this.moonGeo = new THREE.SphereGeometry(7, 12, 12)
    this.moonMat = new THREE.MeshBasicMaterial({ color: 0xcfd8e6, fog: false })
    this.moon = new THREE.Mesh(this.moonGeo, this.moonMat)
    this.moonDir = new THREE.Vector3(-18, 30, -15).normalize()
    this.group.add(this.moon)

    // 3. City silhouettes: 12 boxes sharing one geometry and one material.
    // fog:false is required: FogExp2 (density ~0.032) would hide them at 360-400 m.
    this.silhouetteGeo = new THREE.BoxGeometry(1, 1, 1)
    this.silhouetteMat = new THREE.MeshBasicMaterial({ color: 0x0a0f14, fog: false })
    this.silhouettes = []
    for (let i = 0; i < 12; i++) {
      const angle = i * (2 * Math.PI / 12) + (rnd() - 0.5) * 0.2
      const radius = 360 + rnd() * 40
      const height = 8 + rnd() * 22
      const width = 6 + rnd() * 8
      const depth = 6 + rnd() * 8
      const mesh = new THREE.Mesh(this.silhouetteGeo, this.silhouetteMat)
      mesh.scale.set(width, height, depth)
      mesh.position.set(Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius)
      this.silhouettes.push(mesh)
      this.group.add(mesh)
    }

    this.scene.add(this.group)
  }

  update(playerPos) {
    this.dome.position.copy(playerPos)
    this.moon.position.copy(playerPos).addScaledVector(this.moonDir, 380)
  }

  dispose() {
    this.scene.remove(this.group)
    this.domeGeo.dispose()
    this.domeMat.dispose()
    this.moonGeo.dispose()
    this.moonMat.dispose()
    this.silhouetteGeo.dispose()
    this.silhouetteMat.dispose()
  }
}
