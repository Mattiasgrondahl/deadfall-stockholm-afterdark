import * as THREE from 'three'

/**
 * Player — first-person controller: movement, look, stamina, health,
 * head bob, and collision against the CollisionWorld. Consumes the shared
 * `inputState` data object and never touches the DOM, so it runs in Node
 * tests with real THREE objects.
 */

const WALK_SPEED = 3.4
const SPRINT_SPEED = 5.8
const CROUCH_SPEED = 1.7   // slow, quiet crouch-walk
const LOOK_SENS = 0.0022
const PITCH_LIMIT = 1.45
const ACCEL = 10            // velocity lerp factor, per second
const STAMINA_DRAIN = 26    // per second while sprinting
const STAMINA_REGEN = 18    // per second otherwise
const SPRINT_MIN_STAMINA = 5
// "The light burns breath": holding the flashlight steady costs stamina even
// at rest, trading light for sprint endurance. Only applies when sprint is not
// already draining (sprint semantics unchanged); light off -> normal regen.
const LIGHT_DRAIN = 4       // per second while the flashlight is on
const RADIUS = 0.35
const SPAWN_X = 0, SPAWN_Y = 1.7, SPAWN_Z = 12
// Crouch lowers the eye height from STAND_EYE to CROUCH_EYE over CROUCH_LERP
// seconds (a smooth camera drop, not a snap), and caps movement to CROUCH_SPEED.
const STAND_EYE = 1.7
const CROUCH_EYE = 0.95
const CROUCH_LERP = 6       // eye-height transition rate (per second)
// Vertical motion: the ground is at y=0 and the eye (position.y) rests at
// SPAWN_Y. Gravity is a snappy 2g so the street-scale arcs feel quick;
// JUMP_V gives an apex of JUMP_V^2 / (2 * |GRAVITY|) ≈ 0.98 m.
const GRAVITY = -19.6 // m/s^2
const JUMP_V = 6.2    // m/s initial rise
// Passive health regen: a slow 1 hp/s trickle once the player has gone
// REGEN_DELAY seconds without taking damage. The delay keeps combat honest
// (no instant heal mid-fight) while rewarding disengaging.
const REGEN_RATE = 1     // hp per second
const REGEN_DELAY = 4    // s since last damage before regen resumes

export class Player {
  constructor(camera, inputState, collision, audio = null, flashlight = null) {
    this.camera = camera
    this.inputState = inputState
    this.collision = collision
    this.audio = audio
    this.flashlight = flashlight
    this.position = new THREE.Vector3(SPAWN_X, SPAWN_Y, SPAWN_Z)
    this.velocity = new THREE.Vector3()
    this.yaw = 0           // 0 = facing -Z (city center)
    this.pitch = 0
    this._pitchKick = 0
    // Mouse-look multiplier applied to LOOK_SENS (set from Settings by Game;
    // 1.0 = the shipped baseline feel).
    this.sensMult = 1
    this.health = 100
    this.maxHealth = 100
    this.stamina = 100
    this.maxStamina = 100
    this.isDead = false
    this._bobPhase = 0
    this._bobAmp = 0
    this._regenDelay = 0 // s remaining before passive regen resumes (reset on damage)
    this._eyeHeight = STAND_EYE // camera eye offset above the body; lerps down when crouching
    this._crouching = false
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
      const sens = LOOK_SENS * (this.sensMult > 0 ? this.sensMult : 1)
      this.yaw -= st.turnX * sens
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - st.turnY * sens))
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
    // Crouch (hold C): lowers the eye and caps movement to a slow walk; it also
    // disables sprint. The body stays at the same ground height — only the eye
    // drops (see the eye-height lerp near the camera update below).
    this._crouching = !!st.crouch
    const canSprint = len > 0 && st.sprint && !this._crouching && this.stamina > SPRINT_MIN_STAMINA
    let speed = canSprint ? SPRINT_SPEED : WALK_SPEED
    if (this._crouching) speed = Math.min(speed, CROUCH_SPEED)
    if (len > 0) { dx /= len; dz /= len }

    // Smooth acceleration toward the target velocity.
    const k = Math.min(1, ACCEL * dt)
    this.velocity.x += (dx * speed - this.velocity.x) * k
    this.velocity.z += (dz * speed - this.velocity.z) * k

    this.position.x += this.velocity.x * dt
    this.position.z += this.velocity.z * dt
    this.collision.resolve(this.position, RADIUS)

    // Vertical: a jump edge fires only while grounded (on the ground, not
    // already rising). Gravity then accelerates downward and the ground at
    // y=SPAWN_Y clamps the fall. Head bob (below) still rides on position.y,
    // so the camera carries the jump arc automatically.
    if (st.jump) {
      st.jump = false
      if (this.position.y <= SPAWN_Y + 1e-4 && this.velocity.y <= 0) {
        this.velocity.y = JUMP_V
      }
    }
    this.velocity.y += GRAVITY * dt
    this.position.y += this.velocity.y * dt
    if (this.position.y <= SPAWN_Y) {
      this.position.y = SPAWN_Y
      this.velocity.y = 0
    }

    // Stamina: drains while sprinting, regenerates otherwise. The flashlight
    // burns breath too: while it is on and sprint is not active, stamina drains
    // at LIGHT_DRAIN/s instead of regenerating (clamped at 0). Sprint drain is
    // unchanged and takes precedence.
    const speedNow = Math.hypot(this.velocity.x, this.velocity.z)
    if (canSprint) this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt)
    else if (this.flashlight && this.flashlight.on) this.stamina = Math.max(0, this.stamina - LIGHT_DRAIN * dt)
    else this.stamina = Math.min(100, this.stamina + STAMINA_REGEN * dt)

    // Passive health regen: after REGEN_DELAY seconds without damage, health
    // trickles back at REGEN_RATE hp/s up to maxHealth. Dead players never heal.
    if (!this.isDead && this.health < this.maxHealth) {
      if (this._regenDelay > 0) this._regenDelay = Math.max(0, this._regenDelay - dt)
      else this.health = Math.min(this.maxHealth, this.health + REGEN_RATE * dt)
    }

    // Head bob while moving (amplitude 0.05, frequency proportional to speed).
    if (speedNow > 0.5) {
      this._bobPhase += speedNow * dt * 2.2
      this._bobAmp = 1
    } else {
      this._bobPhase = 0
      this._bobAmp = 0
    }
    const bobY = Math.sin(this._bobPhase) * 0.05 * this._bobAmp
    // Smoothly lerp the eye height toward the crouch/stand target, then place
    // the camera at body position + eye offset + bob. The body (position.y)
    // stays at ground level; only the eye drops when crouching.
    const eyeTarget = this._crouching ? CROUCH_EYE : STAND_EYE
    const ek = Math.min(1, CROUCH_LERP * dt)
    this._eyeHeight += (eyeTarget - this._eyeHeight) * ek
    this.camera.position.set(this.position.x, this.position.y - STAND_EYE + this._eyeHeight + bobY, this.position.z)
    this._pitchKick = Math.max(0, this._pitchKick - dt * 0.15)
    this.camera.rotation.set(this.pitch + this._pitchKick, this.yaw, 0)
  }

  damage(amount, source) {
    if (this.isDead) return
    this.health -= amount
    this._regenDelay = REGEN_DELAY // any hit restarts the regen countdown
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
    this._regenDelay = 0
    this._eyeHeight = STAND_EYE
    this._crouching = false
    this.camera.position.set(SPAWN_X, SPAWN_Y, SPAWN_Z)
    this.camera.rotation.set(0, 0, 0)
  }

  dispose() {
    this.reset()
    this._onDeath = null
  }
}
