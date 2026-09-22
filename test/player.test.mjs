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

{ // pitch kick applies, decays, caps, and resets
  const { player, st, camera } = makePlayer()
  player.addPitchKick(0.02); player.update(0)
  assert.ok(Math.abs(camera.rotation.x - 0.02) < 1e-6, `kick ${camera.rotation.x}`)
  player.update(0.1)
  assert.ok(camera.rotation.x > 0 && camera.rotation.x < 0.02, `decaying ${camera.rotation.x.toFixed(4)}`)
  player.update(0.5)
  assert.strictEqual(camera.rotation.x, 0, 'kick fully decayed')
  player.addPitchKick(0.05)
  assert.strictEqual(player._pitchKick, 0.03, 'kick caps at 0.03')
  player.reset()
  assert.strictEqual(player._pitchKick, 0, 'reset clears kick')
  assert.strictEqual(camera.rotation.x, 0)
}

{ // V5P-2: _onDamaged hook fires with (amount, source) on every hit; no hook is safe
  const { player } = makePlayer()
  let got = null
  player._onDamaged = (amount, source) => { got = [amount, source] }
  const src = { x: 1, z: 2 }
  player.damage(15, src)
  assert.strictEqual(got[0], 15)
  assert.strictEqual(got[1], src)
  player._onDamaged = null
  player.damage(10, 'zombie') // no hook -> no throw
  assert.strictEqual(player.health, 75)
  player.dispose()
}

{ // jump: edge fires only on the ground; gravity lands at 1.7; no re-jump airborne; re-jump after landing
  const { player, st } = makePlayer()
  st.jump = true
  player.update(DT)
  assert.ok(player.position.y > 1.7, `rose to ${player.position.y.toFixed(3)}`)
  assert.ok(player.velocity.y > 0, 'ascending after jump')
  st.jump = true // pressed again while airborne: must be ignored
  player.update(DT)
  assert.ok(player.velocity.y < 6.2, `no re-jump airborne (vy ${player.velocity.y.toFixed(3)})`)
  let landed = -1
  for (let i = 0; i < 300; i++) {
    player.update(DT)
    if (player.position.y === 1.7 && player.velocity.y === 0) { landed = i; break }
  }
  assert.ok(landed >= 0, 'lands back on the ground')
  assert.strictEqual(player.velocity.y, 0)
  st.jump = true
  player.update(DT)
  assert.ok(player.position.y > 1.7, 're-jump works after landing')
  player.reset()
  assert.strictEqual(player.position.y, 1.7)
  assert.strictEqual(player.velocity.y, 0)
}

{ // passive health regen: 1 hp/s after a 4 s no-damage delay; none during it
  const { player } = makePlayer()
  player.health = 50
  player.damage(10) // health 40, regen countdown restarts
  step(player, 60) // 1 s elapsed, still within the 4 s delay
  assert.ok(player.health < 41, `no regen during the delay (health ${player.health.toFixed(2)})`)
  step(player, 60 * 4) // pass the delay window
  const before = player.health
  step(player, 60) // 1 s of regen
  assert.ok(player.health >= before + 0.9 && player.health <= before + 1.1,
    `~1 hp/s regen after the delay (${before.toFixed(2)} -> ${player.health.toFixed(2)})`)
  // Regen never exceeds maxHealth.
  player.health = 99.5
  player._regenDelay = 0
  step(player, 60 * 3)
  assert.ok(player.health <= player.maxHealth, `regen clamps at maxHealth (${player.health})`)
}

{ // crouch: lowers the eye height and caps movement speed; standing restores it
  const { player, st, camera } = makePlayer()
  step(player, 1) // establish the standing eye pose
  // Standing eye sits at the body height (1.7); crouching lerps it down to ~0.95.
  assert.ok(Math.abs(camera.position.y - 1.7) < 0.02, `standing eye ~1.7 (${camera.position.y.toFixed(3)})`)
  st.crouch = true
  step(player, 60) // 1 s of crouch transition
  assert.ok(camera.position.y < 1.2, `crouched eye lowered (${camera.position.y.toFixed(3)})`)
  assert.ok(camera.position.y > 0.7, `crouched eye not below the ground (${camera.position.y.toFixed(3)})`)
  // Crouch-walk is slower than a normal walk.
  const c0 = player.position.clone()
  st.forward = true; step(player, 60); st.forward = false
  const cd = Math.hypot(player.position.x - c0.x, player.position.z - c0.z)
  assert.ok(cd < 2.5, `crouch-walk slower than walk (${cd.toFixed(2)} m/s)`)
  // Sprint is disabled while crouching.
  st.sprint = true; st.crouch = true
  const s0 = player.position.clone()
  step(player, 60); st.sprint = false
  const sd = Math.hypot(player.position.x - s0.x, player.position.z - s0.z)
  assert.ok(sd < 2.5, `sprint disabled while crouched (${sd.toFixed(2)} m/s)`)
  // Standing back up restores the eye height.
  st.crouch = false
  step(player, 60)
  assert.ok(camera.position.y > 1.5, `standing restores the eye (${camera.position.y.toFixed(3)})`)
}

console.log('player OK')
