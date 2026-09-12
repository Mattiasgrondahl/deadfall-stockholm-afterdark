import * as THREE from 'three'

/**
 * Player — first-person controller: movement, look, stamina, health,
 * head bob, and collision against the CollisionWorld. Consumes the shared
 * `inputState` data object and never touches the DOM, so it runs in Node
 * tests with real THREE objects.
 */

const WALK_SPEED = 3.4
const SPRINT_SPEED = 5.8
const LOOK_SENS = 0.0022
const PITCH_LIMIT = 1.45
const ACCEL = 10            // velocity lerp factor, per second
const STAMINA_DRAIN = 26    // per second while sprinting
const STAMINA_REGEN = 18    // per second otherwise
const SPRINT_MIN_STAMINA = 5
const RADIUS = 0.35
const SPAWN_X = 0, SPAWN_Y = 1.7, SPAWN_Z = 12

export class Player {
  constructor(camera, inputState, collision, audio = null) {
    this.camera = camera
    this.inputState = inputState
    this.collision = collision
    this.audio = audio
    this.position = new THREE.Vector3(SPAWN_X, SPAWN_Y, SPAWN_Z)
    this.velocity = new THREE.Vector3()
    this.yaw = 0           // 0 = facing -Z (city center)
    this.pitch = 0
    this._pitchKick = 0
    this.health = 100
    this.maxHealth = 100
    this.stamina = 100
    this.isDead = false
    this._bobPhase = 0
    this._bobAmp = 0
    this._onDeath = null
    this.camera.rotation.order = 'YXZ'
  }

  setOnDeath(cb) { this._onDeath = cb }

  /** Additive recoil pitch kick; decays in update(); capped. */
  addPitchKick(a) { this._pitchKick = Math.min(0.03, this._pitchKick + a) }

  update(dt) {
    const st = this.inputState

    // Look: consume accumulated mouse deltas, clamp pitch.
    if (st.turnX !== 0 || st.turnY !== 0) {
      this.yaw -= st.turnX * LOOK_SENS
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - st.turnY * LOOK_SENS))
      st.turnX = 0
      st.turnY = 0
    }

    // Movement direction in world space from yaw (yaw 0 faces -Z).
    const fwd = (st.forward ? 1 : 0) - (st.back ? 1 : 0)
    const side = (st.left ? 1 : 0) - (st.right ? 1 : 0)
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    let dx = -sin * fwd - cos * side
    let dz = -cos * fwd + sin * side
    const len = Math.hypot(dx, dz)
    const canSprint = len > 0 && st.sprint && this.stamina > SPRINT_MIN_STAMINA
    const speed = canSprint ? SPRINT_SPEED : WALK_SPEED
    if (len > 0) { dx /= len; dz /= len }

    // Smooth acceleration toward the target velocity.
    const k = Math.min(1, ACCEL * dt)
    this.velocity.x += (dx * speed - this.velocity.x) * k
    this.velocity.z += (dz * speed - this.velocity.z) * k

    this.position.x += this.velocity.x * dt
    this.position.z += this.velocity.z * dt
    this.collision.resolve(this.position, RADIUS)

    // Stamina: drains while sprinting, regenerates otherwise.
    const speedNow = Math.hypot(this.velocity.x, this.velocity.z)
    if (canSprint) this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt)
    else this.stamina = Math.min(100, this.stamina + STAMINA_REGEN * dt)

    // Head bob while moving (amplitude 0.05, frequency proportional to speed).
    if (speedNow > 0.5) {
      this._bobPhase += speedNow * dt * 2.2
      this._bobAmp = 1
    } else {
      this._bobPhase = 0
      this._bobAmp = 0
    }
    const bobY = Math.sin(this._bobPhase) * 0.05 * this._bobAmp
    this.camera.position.set(this.position.x, this.position.y + bobY, this.position.z)
    this._pitchKick = Math.max(0, this._pitchKick - dt * 0.15)
    this.camera.rotation.set(this.pitch + this._pitchKick, this.yaw, 0)
  }

  damage(amount, source) {
    if (this.isDead) return
    this.health -= amount
    if (this._onDamaged) this._onDamaged(amount, source)
    if (this.health > 0) this.audio?.hitPlayer?.()
    if (this.health <= 0) {
      this.health = 0
      this.isDead = true
      this.audio?.playDeath?.()
      if (this._onDeath) this._onDeath(this, source)
    }
  }

  heal(amount) {
    if (this.isDead) return
    this.health = Math.min(this.maxHealth, this.health + amount)
  }

  /** Restore spawn state (spawn point (0, 1.7, 12), full health/stamina,
   *  yaw 0 facing the city center). */
  reset() {
    this.position.set(SPAWN_X, SPAWN_Y, SPAWN_Z)
    this.velocity.set(0, 0, 0)
    this.yaw = 0
    this.pitch = 0
    this._pitchKick = 0
    this.health = this.maxHealth
    this.stamina = 100
    this.isDead = false
    this._bobPhase = 0
    this._bobAmp = 0
    this.camera.position.set(SPAWN_X, SPAWN_Y, SPAWN_Z)
    this.camera.rotation.set(0, 0, 0)
  }

  dispose() {
    this.reset()
    this._onDeath = null
  }
}
