// Deadfall: Stockholm Afterdark — aurora borealis band.
//
// A single additive ribbon curtain hung high in the northern sky. It is the
// strongest "this is Scandinavia" signal the game can carry, and it is cheap:
// one curved band mesh (a partial cylinder shell) + one shader, no lights, no
// per-frame allocation, deterministic (uTime-driven sine curtains + a seeded
// LCG phase offset; no Math.random). It follows the player every frame like the
// sky dome, so it always sits on the northern horizon.
//
// Budget/geometry rules mirror sky.js: the band radius (AURORA_RADIUS) must stay
// below the camera far plane (520 in Game.js) or the near/far test clips it and
// the aurora silently disappears. The material has fog:false because FogExp2
// (density ~0.022) would erase anything at ~380 m. BackSide so the player, who
// is inside the shell, sees the inner face of the curtain.
//
// Intensity is driven externally via setIntensity(a) in [0,1]: Game feeds it the
// same tension value it feeds the music director, so the aurora swells when the
// player is cornered / a boss is up and settles to a gentle baseline otherwise.
// uIntensity scales both the brightness and the vertical reach of the curtains,
// so a calm sky shows faint low ribbons and a crisis sky shows tall bright ones.
//
// Headless-safe: construction/update/dispose touch only THREE objects, so they
// run under a StubRenderer / plain Node without any browser globals.

import * as THREE from 'three'

// Band sits at a high northern elevation, inside the far plane (520) and just
// inside the sky dome (420). Radius 380 keeps it behind the skyline silhouettes
// (360-400) without clipping.
const AURORA_RADIUS = 380
// Vertical extent of the curtain (world metres) measured up from the band base.
const AURORA_HEIGHT = 120
// Angular sweep of the band around the player — a wide arc on the north side,
// not a full ring, so it reads as a horizon curtain rather than a full halo.
const AURORA_ARC = Math.PI * 0.85 // ~153 degrees
// The band's centre azimuth points north-ish, matching the moon azimuth
// (-x, -z) so the sky reads coherently.
const AURORA_AZ = new THREE.Vector3(-0.35, 0, -0.94).normalize()
// Base elevation of the curtain's lower edge above the horizon (radians).
const AURORA_BASE_ELEV = 12 * Math.PI / 180

// Vertical colour ramp of the curtain: green at the base (the classic aurora
// foot), teal in the middle, violet at the tips. Tuned toward Stockholm winter
// nights — cold, slightly desaturated, not neon.
const COL_BASE = new THREE.Color(0x2fbf7a)   // green foot
const COL_MID = new THREE.Color(0x2aa6b8)    // teal
const COL_TIP = new THREE.Color(0x6a4fb0)    // violet tips

// Build the curtain as a partial cylinder shell: a grid of (segments x rows)
// vertices wrapped around the player at AURORA_RADIUS, rising AURORA_HEIGHT.
// vPos carries the local position; vRow (0 at the base, 1 at the top) drives the
// colour ramp; a per-column phase offset (aPhase) is baked so the ribbons shear
// instead of translating as one slab.
function buildCurtainGeometry() {
  const COLS = 48
  const ROWS = 8
  const verts = COLS * ROWS
  const pos = new Float32Array(verts * 3)
  const row = new Float32Array(verts)
  const phase = new Float32Array(verts)
  const start = -AURORA_ARC / 2
  const step = AURORA_ARC / (COLS - 1)
  // Right-handed basis for the band plane: forward = AURORA_AZ, up = world up.
  const up = new THREE.Vector3(0, 1, 0)
  const right = new THREE.Vector3().crossVectors(up, AURORA_AZ).normalize()
  let p = 0, r = 0, ph = 0
  for (let c = 0; c < COLS; c++) {
    const ang = start + step * c
    // Rotate the forward vector around world up by `ang` to sweep the arc.
    const dir = AURORA_AZ.clone().applyAxisAngle(up, ang)
    const colPhase = (c / COLS) * Math.PI * 2
    for (let y = 0; y < ROWS; y++) {
      const t = y / (ROWS - 1) // 0 base .. 1 top
      // Horizontal point on the arc, lifted by the base elevation, then raised
      // along `up` by the row height. A slight inward lean (reduce radius with
      // height) makes the curtain tilt back like a real aurora.
      const rr = AURORA_RADIUS * (1 - 0.12 * t)
      const h = Math.sin(AURORA_BASE_ELEV) * AURORA_RADIUS + t * AURORA_HEIGHT
      const horiz = rr * (1 - 0.06 * t)
      pos[p++] = dir.x * horiz + right.x * 0
      pos[p++] = h
      pos[p++] = dir.z * horiz
      row[r++] = t
      phase[ph++] = colPhase
    }
  }
  const idx = []
  for (let c = 0; c < COLS - 1; c++) {
    for (let y = 0; y < ROWS - 1; y++) {
      const a = c * ROWS + y
      const b = a + ROWS
      idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aRow', new THREE.BufferAttribute(row, 1))
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
  geo.setIndex(idx)
  return geo
}

export class Aurora {
  constructor(scene) {
    this.scene = scene
    const geo = buildCurtainGeometry()
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0.35 }, // gentle baseline; Game drives it up on tension
        uBase: { value: COL_BASE.clone() },
        uMid: { value: COL_MID.clone() },
        uTip: { value: COL_TIP.clone() }
      },
      vertexShader: `
        attribute float aRow;
        attribute float aPhase;
        uniform float uTime;
        varying float vRow;
        varying float vPhase;
        varying float vWave;
        void main() {
          vRow = aRow;
          vPhase = aPhase;
          // Two detuned travelling waves along the arc give the curtain its
          // fold/shear; the column phase offset keeps columns out of lockstep.
          vWave = sin(uTime * 0.6 + aPhase) * 0.6 + sin(uTime * 0.23 + aPhase * 0.5) * 0.4;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uIntensity;
        uniform vec3 uBase; uniform vec3 uMid; uniform vec3 uTip;
        varying float vRow;
        varying float vPhase;
        varying float vWave;
        void main() {
          // Vertical colour ramp: green foot -> teal -> violet tips.
          vec3 col = mix(uBase, uMid, smoothstep(0.0, 0.5, vRow));
          col = mix(col, uTip, smoothstep(0.5, 1.0, vRow));
          // Curtain brightness: strongest low, fading toward the tips, with a
          // flickering vertical band structure driven by the wave + a fine
          // stripe so it reads as rayed curtains, not a flat gradient.
          float band = 0.5 + 0.5 * sin(vPhase * 6.0 + uTime * 0.9 + vWave * 3.0);
          float ray = 0.35 + 0.65 * smoothstep(0.35, 0.85, band);
          float fade = (1.0 - vRow) * 0.85 + 0.15; // brighter at the foot
          float alpha = ray * fade * uIntensity;
          // A slow global breathing so the whole curtain swells and calms.
          alpha *= 0.7 + 0.3 * sin(uTime * 0.15 + vPhase);
          gl_FragColor = vec4(col * (0.6 + 0.4 * uIntensity), alpha);
        }
      `
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = 'aurora'
    mesh.frustumCulled = false // follows the player; always in the frustum
    mesh.renderOrder = -1 // draw before the sky dome reads cleanly behind it
    scene.add(mesh)
    this.mesh = mesh
    this.geo = geo
    this.mat = mat
  }

  // Drive the curtain brightness/reach from outside (Game feeds it tension).
  setIntensity(a) {
    const v = Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 0
    this.mat.uniforms.uIntensity.value = v
  }

  update(playerPos, dt = 0) {
    // Follow the player so the curtain always hangs on the northern horizon.
    this.mesh.position.copy(playerPos)
    this.mat.uniforms.uTime.value += dt
  }

  dispose() {
    this.scene.remove(this.mesh)
    this.geo.dispose()
    this.mat.dispose()
  }
}