// Deadfall: Stockholm Afterdark — v28 R4 snow accumulation on the viewmodel.
//
// Standing still in the falling snow lets a thin dusting of frost build up on
// the near view-model region (the gun held at the bottom of the frame). This is
// a self-contained Points cluster parented to the CAMERA, so it always sits in
// the lower-front of the view like a weapon does, and it needs no changes to
// the weapon modules themselves. Moving or firing shakes the snow off.
//
// Cheap + safe: one additive Points object, a fixed pool, count grows while idle
// and collapses on movement/fire. Deterministic (seeded LCG, no Math.random).
// Headless-safe (camera may be a plain Object3D). dispose() reverses fully.

import * as THREE from 'three'

const MAX_FLAKES = 40
const LIFE = 6.0 // a flake lingers ~6 s before melting off on its own

// Valid hex seed for the flake LCG.
const LCG_SEED = 0x5EED17

export class ViewSnow {
  /** @param camera THREE.Camera (or any Object3D) to parent the frost to. */
  constructor(camera) {
    this.camera = camera
    this._seed = LCG_SEED
    this._accum = 0 // fractional spawn accumulator
    this._age = new Float32Array(MAX_FLAKES).fill(LIFE) // all dead at start

    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(MAX_FLAKES * 3)
    const aLife = new Float32Array(MAX_FLAKES)
    const aSize = new Float32Array(MAX_FLAKES)
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aLife', new THREE.BufferAttribute(aLife, 1))
    geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1))
    this._pos = pos
    this._life = aLife
    this._size = aSize
    this._cursor = 0

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {},
      vertexShader: `
        attribute float aLife;
        attribute float aSize;
        varying float vLife;
        void main() {
          vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (1.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vLife;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.0, d);
          // Fade in fast, out slow; invisible when dead (aLife <= 0).
          float life = clamp(vLife, 0.0, 1.0);
          float alpha = a * smoothstep(0.0, 0.15, life) * 0.5;
          gl_FragColor = vec4(0.85, 0.9, 1.0, alpha);
        }
      `
    })

    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 5
    if (camera && camera.add) camera.add(this.points)
    this.geo = geo
    this.mat = mat
  }

  // Seeded LCG in [0,1) — deterministic flake placement.
  _rand() {
    this._seed = (Math.imul(this._seed, 48271) >>> 0) % 65537
    return this._seed / 65537
  }

  /**
   * Accumulate frost while the player is idle. `intensity` is 0..1 (higher =
   * more settled snow): pass ~1 when standing still, ~0 when moving/firing so
   * the dusting shakes off. Spawns flakes into the near view region.
   */
  emit(intensity) {
    if (!(intensity > 0)) return
    this._accum += intensity * 0.35
    while (this._accum >= 1) {
      this._accum -= 1
      const i = this._cursor
      this._cursor = (this._cursor + 1) % MAX_FLAKES
      // Flake sits low-front of the view (camera-local): below and ahead.
      this._pos[i * 3] = (this._rand() - 0.5) * 0.5
      this._pos[i * 3 + 1] = -0.28 - this._rand() * 0.12
      this._pos[i * 3 + 2] = -0.5 - this._rand() * 0.15
      this._life[i] = LIFE
      this._size[i] = 6 + this._rand() * 8
    }
  }

  /** Age every flake; melt off over LIFE seconds. */
  update(dt) {
    for (let i = 0; i < MAX_FLAKES; i++) {
      if (this._life[i] > 0) this._life[i] = Math.max(0, this._life[i] - dt)
    }
    this.geo.attributes.position.needsUpdate = true
    this.geo.attributes.aLife.needsUpdate = true
    this.geo.attributes.aSize.needsUpdate = true
  }

  /** Remove the cluster from the camera and dispose geo + material. */
  dispose() {
    if (!this.points) return
    if (this.camera && this.camera.remove) this.camera.remove(this.points)
    this.geo.dispose()
    this.mat.dispose()
    this.points = null
    this.geo = null
    this.mat = null
    this.camera = null
  }
}