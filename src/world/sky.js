// Deadfall: Stockholm Afterdark — night sky.
//
// Layered sky: a gradient dome (deep-blue zenith -> cold blue horizon, with a
// cool horizon glow and a faint warm city light-pollution haze just above the
// horizon line), a twinkling starfield, a moon, and a ring of dark city
// skyline silhouettes near the dome edge. Dome, moon, and stars follow the
// player every frame so the sky feels infinite; silhouettes are fixed world
// positions (parallax depth cue). Deterministic: LCG for all layout, and the
// only animation is uTime-driven twinkle in the star shader.
//
// IMPORTANT: dome radius (420), star radius (400) and the silhouette band
// (360-400 m) must all stay below the camera far plane (520 in Game.js), or
// they are silently clipped by the near/far test and the sky falls back to
// the flat scene.background color.
//
// The moon direction matches Lighting.js MOON_OFFSET (-18, 30, -15), so the
// visible moon sits exactly behind the moonlight. Moon and silhouette
// materials have fog disabled: at 360-400 m the exponential fog
// (FogExp2 0.022) would otherwise erase them entirely.

import * as THREE from 'three'

function makeLCG(seed) {
  let s = seed
  return () => {
    s = (s * 48271) % 65537
    return s / 65537
  }
}

// Twinkling starfield: ~800 points on the upper hemisphere just inside the
// dome. Additive points with per-star size/brightness/phase (LCG, no
// Math.random); twinkle is a per-star sinusoid in the vertex shader, so the
// CPU only advances uTime each frame.
class StarField {
  constructor(count = 800, radius = 400) {
    const rnd = makeLCG(0xC0FFEE13)
    const pos = new Float32Array(count * 3)
    const star = new Float32Array(count * 3) // size (px), brightness, phase
    let placed = 0, guard = 0
    while (placed < count && guard < count * 50) {
      guard++
      // Uniform point on the sphere; reject below the horizon line.
      const u = rnd(), v = rnd()
      const theta = Math.acos(2 * u - 1)
      const phi = 2 * Math.PI * v
      const x = Math.sin(theta) * Math.cos(phi)
      const y = Math.cos(theta)
      const z = Math.sin(theta) * Math.sin(phi)
      if (y < 0.04) continue
      pos[placed * 3] = x * radius
      pos[placed * 3 + 1] = y * radius
      pos[placed * 3 + 2] = z * radius
      star[placed * 3] = 1.2 + 1.2 * rnd()        // point size, device px
      star[placed * 3 + 1] = 0.45 + 0.55 * rnd()  // brightness
      star[placed * 3 + 2] = rnd() * Math.PI * 2  // twinkle phase
      placed++
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aStar', new THREE.BufferAttribute(star, 3))
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xb9c9e2) }
      },
      vertexShader: `
        attribute vec3 aStar;
        uniform float uTime;
        varying float vA;
        void main() {
          // Twinkle: per-star sinusoid (0.45..1.0 x base brightness).
          vA = aStar.y * (0.45 + 0.55 * sin(uTime * (0.6 + 1.8 * fract(aStar.z)) + aStar.z));
          gl_PointSize = aStar.x;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          // Soft round sprite; fade the edges so the point reads as a star,
          // not a square.
          vec2 p = gl_PointCoord - vec2(0.5);
          float d = length(p);
          float alpha = smoothstep(0.5, 0.12, d) * vA;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
    const points = new THREE.Points(geo, mat)
    points.frustumCulled = false // follows the player; always in the frustum
    this.points = points
    this.geo = geo
    this.mat = mat
  }
  update(playerPos, dt) {
    this.points.position.copy(playerPos)
    this.mat.uniforms.uTime.value += dt
  }
  dispose() {
    this.geo.dispose()
    this.mat.dispose()
  }
}

export class Sky {
  constructor(scene) {
    this.scene = scene
    const group = new THREE.Group()
    group.name = 'sky'

    // Gradient dome: deep-blue zenith -> cold blue horizon, plus a cool
    // horizon glow and a warm light-pollution haze. BackSide so it encloses
    // the player; radius 420 must stay below the camera far plane.
    const domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x04070f) },
        horizonColor: { value: new THREE.Color(0x0d1626) },
        glowColor: { value: new THREE.Color(0x2a3446) }
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 glowColor;
        varying vec3 vPos;
        void main() {
          vec3 d = normalize(vPos);
          float h = d.y; // -1 (below horizon) .. 1 (zenith)
          vec3 c = mix(horizonColor, topColor, smoothstep(-0.02, 0.9, h));
          // Cool horizon glow (city sky glow).
          c += glowColor * exp(-h * h * 144.0) * 0.35;
          // Warm light-pollution haze just above the horizon line.
          c += vec3(0.016, 0.011, 0.006) * exp(-max(h, 0.0) * 5.0);
          // Below the horizon, beyond the city edge: dark ground haze.
          c = mix(c, vec3(0.005, 0.007, 0.011), smoothstep(0.0, -0.35, h));
          gl_FragColor = vec4(c, 1.0);
        }
      `
    })
    const domeGeo = new THREE.SphereGeometry(420, 32, 16)
    const dome = new THREE.Mesh(domeGeo, domeMat)
    dome.name = 'skyDome'
    group.add(dome)
    this.dome = dome
    this.domeGeo = domeGeo
    this.domeMat = domeMat

    // Twinkling stars (just inside the dome).
    this.stars = new StarField(800, 400)
    group.add(this.stars.points)

    // Moon: basic material, fog disabled (FogExp2 would erase it at 380 m).
    // Direction matches Lighting.js MOON_OFFSET so it sits behind the moonlight.
    const moonDir = new THREE.Vector3(-18, 30, -15).normalize()
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xcfd8e6, fog: false })
    const moonGeo = new THREE.SphereGeometry(7, 16, 12)
    const moon = new THREE.Mesh(moonGeo, moonMat)
    moon.name = 'moon'
    moon.position.copy(moonDir).multiplyScalar(380)
    group.add(moon)
    this.moon = moon
    this.moonGeo = moonGeo
    this.moonMat = moonMat
    this.moonDir = moonDir
    this._moonOffset = moonDir.clone().multiplyScalar(380)

    // City skyline silhouettes near the dome edge: 12 boxes on a ring
    // (deterministic LCG; no Math.random). All share ONE geometry and ONE
    // material; per-silhouette size lives in mesh.scale.
    const silhouetteMat = new THREE.MeshBasicMaterial({ color: 0x0a0f14, fog: false })
    const silhouetteGeo = new THREE.BoxGeometry(1, 1, 1)
    const silhouettes = []
    const rnd = makeLCG(0x9E3779B9)
    const COUNT = 12
    for (let i = 0; i < COUNT; i++) {
      const ang = (i / COUNT) * Math.PI * 2 + (rnd() - 0.5) * (Math.PI / COUNT)
      const dist = 360 + rnd() * 40
      const h = 18 + rnd() * 40
      const w = 8 + rnd() * 20
      const mesh = new THREE.Mesh(silhouetteGeo, silhouetteMat)
      mesh.position.set(Math.cos(ang) * dist, h / 2, Math.sin(ang) * dist)
      mesh.scale.set(w, h, w)
      group.add(mesh)
      silhouettes.push(mesh)
    }
    this.silhouettes = silhouettes
    this.silhouetteGeo = silhouetteGeo
    this.silhouetteMat = silhouetteMat
    // Convenience aliases so callers (tests, envmap bake) can reference the
    // starfield resources directly on the Sky instance.
    this.starGeo = this.stars.geo
    this.starMat = this.stars.mat

    scene.add(group)
    this.group = group
  }

  update(playerPos, dt = 0) {
    // Dome + moon follow the player; silhouettes stay fixed (parallax).
    this.dome.position.copy(playerPos)
    this.moon.position.copy(playerPos).add(this._moonOffset)
    this.stars.update(playerPos, dt)
  }

  dispose() {
    this.scene.remove(this.group)
    for (const m of this.group.children) {
      m.geometry.dispose()
      if (Array.isArray(m.material)) { for (const mat of m.material) mat.dispose() }
      else if (m.material) m.material.dispose()
    }
    this.stars.dispose()
  }
}
