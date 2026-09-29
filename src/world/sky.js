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
// Moon direction matches Lighting.js MOON_OFFSET (-18, 30, -15), so the
// visible moon sits exactly behind the moonlight. Moon and silhouette
// materials have fog disabled: at 360-400 m the exponential fog
// (FogExp2 0.022) would otherwise erase them entirely.
//
// v3 T7: the moon is now a larger, texture-mapped disc set at a LOWER elevation
// than the moonlight. The light stays high (MOON_OFFSET) so the scene still
// reads moonlit, but the visible disc hangs lower in the sky where it is easy
// to see. Its azimuth matches the light (-x, -z) and only the elevation is
// lowered (MOON_ELEV). A browser-only moon.jpg is loaded onto the disc; headless
// keeps the flat pale disc so the sky still reads correctly without a texture.

import * as THREE from 'three'

// Browser-only asset base (same guard as Zombie.js — headless yields '').
const ASSET_BASE = (typeof document !== 'undefined' ? ((import.meta.env?.BASE_URL || '').replace(/\/$/, '') + '/') : '')

// v3 T7: moon geometry constants. The disc is bigger than the old radius-7
// sphere and sits at a LOWER elevation than the moonlight (the light stays high
// so the scene reads moonlit; the visible disc hangs lower where it is easy to
// see). Azimuth matches the light (-x, -z); only the elevation is lowered.
const MOON_DIST = 380
const MOON_RADIUS = 15
const MOON_ELEV = 22 * Math.PI / 180 // radians above the horizon

// Azimuth of the moonlight projected onto the ground plane, normalized.
const MOON_AZ = new THREE.Vector3(-18, 0, -15).normalize()

// v3 T7: build the lowered moon direction from the light azimuth + a lower
// elevation. Deterministic (no Math.random).
function moonDirection() {
  const e = Math.cos(MOON_ELEV)
  return new THREE.Vector3(MOON_AZ.x * e, Math.sin(MOON_ELEV), MOON_AZ.z * e).normalize()
}

// v3 T7: lazily load the moon texture onto the disc material (browser only).
// Headless (no document) keeps the flat pale disc; a failed load is swallowed.
function loadMoonTexture(mat) {
  if (typeof document === 'undefined' || !ASSET_BASE) return
  try {
    const loader = new THREE.TextureLoader()
    loader.load(ASSET_BASE + 'assets/sky/moon.jpg', (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      mat.map = tex
      mat.needsUpdate = true
    }, undefined, () => { /* keep the flat disc */ })
  } catch (err) { /* headless-safe: ignore */ }
}

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
        topColor: { value: new THREE.Color(0x070b16) },
        horizonColor: { value: new THREE.Color(0x18253a) },
        glowColor: { value: new THREE.Color(0x3a4a63) }
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
          // Cool horizon glow (city sky glow). v4 VISUALS (C2): 0.35 -> 0.55 so the
          // horizon reads brighter, narrowing the sky-vs-ground luminance gap.
          c += glowColor * exp(-h * h * 144.0) * 0.55;
          // Warm light-pollution haze just above the horizon line. v4 (C2):
          // brighter + wider band so the skyline base glows like a real city.
          c += vec3(0.030, 0.021, 0.011) * exp(-max(h, 0.0) * 3.5);
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

    // Moon: a larger texture-mapped disc at a lower elevation than the light
    // (v3 T7). Basic material, fog disabled (FogExp2 would erase it at 380 m).
    // The disc always faces the player (lookAt in update) so it reads as a full
    // moon from any angle. Headless keeps the flat pale disc (no texture).
    const moonDir = moonDirection()
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xcfd8e6, fog: false })
    const moonGeo = new THREE.CircleGeometry(MOON_RADIUS, 32)
    const moon = new THREE.Mesh(moonGeo, moonMat)
    moon.name = 'moon'
    moon.position.copy(moonDir).multiplyScalar(MOON_DIST)
    loadMoonTexture(moonMat)
    group.add(moon)
    this.moon = moon
    this.moonGeo = moonGeo
    this.moonMat = moonMat
    this.moonDir = moonDir
    this._moonOffset = moonDir.clone().multiplyScalar(MOON_DIST)

    // City skyline silhouettes near the dome edge: 12 boxes on a ring
    // (deterministic LCG; no Math.random). All share ONE geometry and ONE
    // material; per-silhouette size lives in mesh.scale.
    // v4 VISUALS (C2): lifted from pure 0x0a0f14 black to a dim blue-grey so the
    // distant skyline reads as a lit city catching the sky glow, not a black void.
    const silhouetteMat = new THREE.MeshBasicMaterial({ color: 0x141c28, fog: false })
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
    // v3 T7: the moon is a flat disc, so turn it to face the player every frame
    // (it hangs at a fixed offset from the player, so it always reads full).
    this.moon.lookAt(playerPos)
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
