// Focused tests for the Player controller, driven headlessly with a
// real THREE camera and a real CollisionWorld (pure math, Node-safe).
import assert from 'node:assert'
import * as THREE from 'three'
import { Player } from '../src/game/Player.js'
import { CollisionWorld } from '../src/game/CollisionWorld.js'

const DT = 1 / 60

function makePlayer(collision = new CollisionWorld(180, 180)) {
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000)
  const st = {
    forward: false, back: false, left: false, right: false, sprint: false,
    turnX: 0, turnY: 0, fire: false, reload: false, pause: false
  }
  const player = new Player(camera, st, collision, null)
  return { player, st, camera, collision }
}

const step = (p, n) => { for (let i = 0; i < n; i++) p.update(DT) }

{ // forward walk: >= 2.5 m in 1 s, along facing direction, yaw unchanged
  const { player, st } = makePlayer()
  const s0 = player.position.clone()
  st.forward = true; step(player, 60); st.forward = false
  const dx = player.position.x - s0.x, dz = player.position.z - s0.z
  const dist = Math.hypot(dx, dz)
  const len = Math.hypot(dx, dz) || 1
  const dot = (dx / len) * -Math.sin(player.yaw) + (dz / len) * -Math.cos(player.yaw)
  assert.ok(dist >= 2.5, `walked ${dist.toFixed(2)} m in 1 s`)
  assert.ok(dot > 0.9, `moving along facing: ${dot.toFixed(3)}`)
  assert.ok(Math.abs(player.yaw) < 1e-9, 'yaw unchanged by movement')
}

{ // strafe left at yaw 0 moves -X
  const { player, st } = makePlayer()
  const x0 = player.position.x
  st.left = true; step(player, 30); st.left = false
  assert.ok(player.position.x < x0 - 0.4, `dx ${(player.position.x - x0).toFixed(3)}`)
}

{ // look: turnX/turnY consumed, yaw sign, pitch clamps at +-1.45
  const { player, st } = makePlayer()
  st.turnX = 100; player.update(DT)
  assert.ok(Math.abs(player.yaw + 0.22) < 0.005, `yaw ${player.yaw.toFixed(4)}`)
  assert.strictEqual(st.turnX, 0)
  assert.strictEqual(st.turnY, 0)
  st.turnY = -1e6; player.update(DT)
  assert.ok(Math.abs(player.pitch - 1.45) < 1e-3, `pitch up ${player.pitch.toFixed(3)}`)
  st.turnY = 1e6; player.update(DT)
  assert.ok(Math.abs(player.pitch + 1.45) < 1e-3, `pitch down ${player.pitch.toFixed(3)}`)
  assert.strictEqual(player.camera.rotation.order, 'YXZ')
}

{ // sprint beats walk; stamina drains then regenerates
  const { player, st } = makePlayer()
  const s0 = player.position.clone()
  st.forward = true; st.sprint = true; step(player, 60); st.sprint = false
  const sprintD = Math.hypot(player.position.x - s0.x, player.position.z - s0.z)
  const w0 = player.position.clone()
  step(player, 60); st.forward = false
  const walkD = Math.hypot(player.position.x - w0.x, player.position.z - w0.z)
  assert.ok(sprintD > walkD + 0.5, `sprint ${sprintD.toFixed(2)} vs walk ${walkD.toFixed(2)}`)
  assert.ok(player.stamina < 99, `stamina after sprint ${player.stamina.toFixed(1)}`)
  const st0 = player.stamina
  step(player, 60)
  assert.ok(player.stamina > st0 + 1.5, `regen ${st0.toFixed(1)} -> ${player.stamina.toFixed(1)}`)
}

{ // obstacle ejects player; world boundary clamps at half-size - radius
  const { player, st, collision } = makePlayer()
  collision.addAABB(10, 0, 14, 4, 5)
  player.position.set(12, 1.7, 2) // inside the box
  step(player, 5)
  const b = collision.aabbs[0]
  const r = 0.35
  const overlapped =
    player.position.x > b.minX - r && player.position.x < b.maxX + r &&
    player.position.z > b.minZ - r && player.position.z < b.maxZ + r
  assert.ok(!overlapped, 'ejected out of AABB')
  // Nearest-point distance is at least radius (tolerance for float tangency).
  const cx = Math.max(b.minX, Math.min(player.position.x, b.maxX))
  const cz = Math.max(b.minZ, Math.min(player.position.z, b.maxZ))
  const d = Math.hypot(player.position.x - cx, player.position.z - cz)
  assert.ok(d >= 0.35 - 1e-6, `distance after eject ${d.toFixed(9)}`)
  player.yaw = -Math.PI / 2 // face +X
  player.position.set(88, 1.7, 0)
  player.velocity.set(0, 0, 0)
  st.forward = true; step(player, 600); st.forward = false
  assert.ok(player.position.x <= 90 - 0.35 + 1e-3, `x ${player.position.x.toFixed(3)}`)
}

{ // damage, death callback, heal clamp, reset to spawn
  const { player, st } = makePlayer()
  let deaths = 0, src = null
  player.setOnDeath((p, s) => { deaths++; src = s })
  player.damage(30, 'zombie')
  assert.strictEqual(player.health, 70)
  player.heal(100)
  assert.strictEqual(player.health, 100)
  player.damage(100, 'melee')
  assert.strictEqual(player.health, 0)
  assert.strictEqual(player.isDead, true)
  assert.strictEqual(deaths, 1)
  assert.strictEqual(src, 'melee')
  player.damage(50, 'again')
  assert.strictEqual(player.health, 0)
  assert.strictEqual(deaths, 1) // no double death
  player.reset()
  assert.strictEqual(player.position.x, 0)
  assert.strictEqual(player.position.z, 12)
  assert.strictEqual(player.position.y, 1.7)
  assert.strictEqual(player.health, 100)
  assert.strictEqual(player.stamina, 100)
  assert.strictEqual(player.isDead, false)
  assert.strictEqual(player.yaw, 0)
  assert.strictEqual(player.pitch, 0)
  assert.strictEqual(player.camera.position.z, 12) // camera synced
  player.dispose()
}

{ // head bob stays within 0.05 of eye height; all finite
  const { player, st, camera } = makePlayer()
  st.forward = true; step(player, 120); st.forward = false
  assert.ok(Number.isFinite(camera.position.x) && Number.isFinite(camera.position.y) && Number.isFinite(camera.position.z))
  assert.ok(Math.abs(camera.position.y - 1.7) <= 0.05, `camera y ${camera.position.y.toFixed(4)}`)
  step(player, 120)
  assert.strictEqual(camera.position.y, 1.7) // bob settles when at rest
}

console.log('player OK')
