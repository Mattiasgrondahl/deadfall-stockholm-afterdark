// Deadfall: Stockholm Afterdark — breath plumes in the cold.
//
// A small additive Points puff emitted in front of the player's face whenever
// they sprint or move fast in the freezing air — the classic "you can see your
// breath" winter tell. Cheap: one Points object, a fixed pool of puffs recycled
// oldest-first, each rising + expanding + fading over a short life. Deterministic
// (seeded LCG; no Math.random), no per-frame allocation, headless-safe (a null
// scene is tolerated; the pool still runs, it just has no mesh).
//
// Budget: one Points object (sceneStats counts Points objects, not vertices), so
// this adds 1 to the points count — trivial against the 2500 cap. No lights, no
// meshes. Kept under ~350 lines.
//
// Emission is driven externally via emit(x, z, yaw, intensity): Game calls it
// from the movement wiring with a strength scaled by how fast the player is
// moving (and 0 when standing still), so idle moments stay clear and a sprint
// leaves a visible trail of condensation.

import * as THREE from 'three'

const MAX_PUFFS = 48      // pool size (recycled oldest-first)
const LIFE = 1.1          // s before a puff fades out entirely
const SEED = 0xBEEF13
const RISE = 0.6          // m/s upward drift (warm breath rising into cold air)
const SPREAD = 0.5        // lateral drift spread per puff
const GROW = 0.9          // px/s sprite growth

export class Breath {
  constructor(scene) {
    this.scene = scene || null
    this._seed = SEED
    this._rng = () => (this._seed = (Math.imul(this._seed, 48271) >>> 0) % 65537) / 65537

    const pos = new Float32Array(MAX_PUFFS * 3)
    const life = new Float32Array(MAX_PUFFS)   // remaining life (0 = dead slot)
    const vel = new Float32Array(MAX_PUFFS * 3) // per-puff drift
    const size = new Float32Array(MAX_PUFFS)    // current sprite size (px)
    for (let i = 0; i < MAX_PUFFS; i++) { pos[i * 3 + 1] = -9999; life[i] = 0 }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1))
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(0xcfe0f0) }
      },
      vertexShader: `
        attribute float aLife;
        attribute float aSize;
        varying float vA;
        void main() {
          // Fade in fast, fade out slow across the puff's life.
          float t = 1.0 - aLife;           // 0 just born .. 1 about to die
          vA = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.4, 1.0, t));
          gl_PointSize = aSize;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          vec2 p = gl_PointCoord - vec2(0.5);
          float d = length(p);
          float a = smoothstep(0.5, 0.1, d) * vA * 0.28; // soft, faint condensation
          gl_FragColor = vec4(uColor, a);
        }
      `
    })
    const points = new THREE.Points(geo, mat)
    points.frustumCulled = false
    points.renderOrder = 2
    this.geo = geo
    this.mat = mat
    this.points = points
    this._pos = pos
    this._life = life
    this._vel = vel
    this._size = size
    this._cursor = 0
    if (this.scene) this.scene.add(points)
  }

  // Emit one puff at the player's face, ahead along their facing. `intensity`
  // in [0,1] scales how many puffs land this call (Game passes sprint strength).
  emit(x, z, yaw, intensity = 1) {
    if (!Number.isFinite(intensity) || intensity <= 0) return
    // Deterministic fractional emission: accumulate, spawn on whole units.
    this._acc = (this._acc || 0) + intensity
    while (this._acc >= 1) {
      this._acc -= 1
      this._spawn(x, z, yaw)
    }
  }

  _spawn(x, z, yaw) {
    const i = this._cursor
    this._cursor = (this._cursor + 1) % MAX_PUFFS
    // A point just ahead of and BELOW eye height, jittered. v32: pushed further
    // ahead and lower so the puffs read as breath under the crosshair instead of
    // a bright additive glimmer sitting dead-center in view.
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw) // player facing (-Z at yaw 0)
    const ahead = 0.6 + this._rng() * 0.2
    this._pos[i * 3] = x + fx * ahead + (this._rng() - 0.5) * 0.1
    this._pos[i * 3 + 1] = 1.42 + (this._rng() - 0.5) * 0.1
    this._pos[i * 3 + 2] = z + fz * ahead + (this._rng() - 0.5) * 0.1
    this._vel[i * 3] = (this._rng() - 0.5) * SPREAD
    this._vel[i * 3 + 1] = RISE * (0.7 + this._rng() * 0.6)
    this._vel[i * 3 + 2] = (this._rng() - 0.5) * SPREAD
    this._size[i] = 6 + this._rng() * 6
    this._life[i] = 1 // just born (life counts down 1 -> 0)
  }

  update(dt) {
    const pos = this._pos, life = this._life, vel = this._vel, size = this._size
    for (let i = 0; i < MAX_PUFFS; i++) {
      if (life[i] <= 0) continue
      life[i] = Math.max(0, life[i] - dt / LIFE)
      const i3 = i * 3
      pos[i3] += vel[i3] * dt
      pos[i3 + 1] += vel[i3 + 1] * dt
      pos[i3 + 2] += vel[i3 + 2] * dt
      size[i] += GROW * dt
    }
    this.geo.attributes.position.needsUpdate = true
    this.geo.attributes.aLife.needsUpdate = true
    this.geo.attributes.aSize.needsUpdate = true
  }

  dispose() {
    if (this.scene) this.scene.remove(this.points)
    this.geo.dispose()
    this.mat.dispose()
  }
}