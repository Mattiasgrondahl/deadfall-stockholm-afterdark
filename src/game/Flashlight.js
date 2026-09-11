import * as THREE from 'three'

// Flashlight — camera-mounted SpotLight with a draining battery and
// low-battery flicker. Toggled by the F key (inputState.flashlight edge).
// Physical light units (three.js r185 candela). Flicker RNG is a seeded LCG
// (no Math.random); headless-safe (no DOM, audio optional, no shadows).

const SEED = 9021
const BASE_INTENSITY = 300 // cd — ~8x a streetlight pool at equal range
const CONE_ANGLE = 0.45 // rad (~26 deg cone)
const PENUMBRA = 0.35
const DISTANCE = 14 // m cutoff
const DRAIN_SECONDS = 120 // full battery = 120 s of continuous use
const LOW_AT = 0.25 // flicker threshold
const DIM_FACTOR = 0.1 // intensity while flickering out

export class Flashlight {
  constructor(camera, audio) {
    this.camera = camera
    this.audio = audio
    this._seed = SEED

    // Child of the camera: follows view direction, pitch, and bob. The
    // renderer updates the camera's world matrix (camera is not in the
    // scene graph), which cascades to both the light and its target.
    this.spot = new THREE.SpotLight(0xfff2d0, BASE_INTENSITY, DISTANCE, CONE_ANGLE, PENUMBRA, 2)
    this.spot.position.set(0.25, -0.25, 0.2) // beside the weapon view model
    this.spot.target.position.set(0, 0, -10)
    this.spot.castShadow = false
    camera.add(this.spot)
    camera.add(this.spot.target)

    this.on = false
    this.battery = 1 // 0..1
    this._flicker = 'steady' // 'steady' | 'dim'
    this._flickerUntil = 0
    this._time = 0
    this.spot.intensity = 0
  }

  /** Seeded LCG in [0, 1). Deterministic for a fixed call sequence. */
  _rand() {
    this._seed = Math.imul(this._seed, 48271) % 65537
    return this._seed / 65537
  }

  /** Toggle. Turning on with an exhausted battery is a no-op. */
  toggle() {
    if (this.on) {
      this.on = false
      this.spot.intensity = 0
    } else {
      if (this.battery <= 0) return false
      this.on = true
      this._flicker = 'steady'
      this._flickerUntil = this._time
    }
    if (this.audio) this.audio.flashlightClick?.()
    return true
  }

  /** Per frame: consume the F edge, drain battery, auto-off, flicker. */
  update(dt, inputState = null) {
    this._time += dt
    if (inputState) {
      if (inputState.flashlight) {
        inputState.flashlight = false
        this.toggle()
      }
    }
    if (!this.on) {
      this.spot.intensity = 0
      return
    }
    // Battery drains only while on.
    this.battery = Math.max(0, this.battery - dt / DRAIN_SECONDS)
    if (this.battery <= 0) {
      // Exhausted: auto off.
      this.on = false
      this.spot.intensity = 0
      if (this.audio) this.audio.flashlightClick?.()
      return
    }
    // Low-battery flicker: LCG-scheduled dim bursts.
    if (this.battery < LOW_AT) {
      if (this._flicker === 'steady' && this._time >= this._flickerUntil) {
        this._flicker = 'dim'
        this._flickerUntil = this._time + 0.05 + this._rand() * 0.25
      } else if (this._flicker === 'dim' && this._time >= this._flickerUntil) {
        this._flicker = 'steady'
        this._flickerUntil = this._time + 0.2 + this._rand() * 1.3
      }
    } else {
      this._flicker = 'steady'
    }
    this.spot.intensity = this._flicker === 'dim' ? BASE_INTENSITY * DIM_FACTOR : BASE_INTENSITY
  }

  /** New run: battery full, light off, deterministic seed restored. */
  reset() {
    this.on = false
    this.battery = 1
    this._flicker = 'steady'
    this._flickerUntil = 0
    this._time = 0
    this._seed = SEED
    this.spot.intensity = 0
  }

  dispose() {
    this.camera.remove(this.spot, this.spot.target)
    this.spot.dispose()
  }
}
