import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { CollisionWorld } from '../src/game/CollisionWorld.js'
import { Zombie, TABLE, MAT2, HITMAT, DEADMAT, EYEMAT, DEADEYEMAT, contactNormal, FACEMAT, POSE2, OUTFITMATS } from '../src/game/Zombie.js'

function fakePlayer(x, z) {
  return {
    position: new THREE.Vector3(x, 1.7, z),
    isDead: false,
    health: 1000,
    damage(n, src) {
      if (!this.isDead) {
        this.health -= n
        if (this.health <= 0) this.isDead = true
      }
    }
  }
}

function makeZombie(type, x, z, wave = 1) {
  const scene = new THREE.Scene()
  const collision = new CollisionWorld(180, 180)
  const zombie = new Zombie(scene, type, x, z, wave)
  return { scene, collision, zombie }
}

test('stats: TABLE values exact, wave scaling rounds base * 1.12', () => {
  assert.deepEqual(TABLE.walker, { speed: .5 + 1, hp: 50, melee: 8, cooldown: 0.9 })
  assert.deepEqual(TABLE.shambler, { speed: 0.8, hp: 90, melee: 14, cooldown: 1.2 })
  assert.deepEqual(TABLE.screamer, { speed: 2.2, hp: 40, melee: 6, cooldown: 0.7 })
  const { zombie } = makeZombie('walker', 0, 0, 1)
  assert.equal(zombie.maxHealth, 50)
  const { zombie: w2 } = makeZombie('walker', 0, 0, 2)
  assert.equal(w2.maxHealth, 56) // Math.round(50 * 1.12)
  const { zombie: s2 } = makeZombie('shambler', 0, 0, 2)
  assert.equal(s2.maxHealth, 101) // Math.round(90 * 1.12)
})

test('unknown type throws', () => {
  const scene = new THREE.Scene()
  assert.throws(() => new Zombie(scene, 'ghoul', 0, 0, 1), /unknown zombie type: ghoul/)
})

test('pursuit: closes 10 m to ~8.5 m in 1 s and faces the player', () => {
  const { collision, zombie } = makeZombie('walker', 10, 0, 1)
  const player = fakePlayer(0, 0)
  for (let i = 0; i < 60; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  const d = Math.hypot(zombie.position.x, zombie.position.z)
  assert.ok(Math.abs(d - 8.5) < 0.3, `distance ${d} not ~8.5`)
  // Player is at -x from the zombie, so it must face -x: rotation.y = atan2(-10, 0).
  assert.ok(Math.abs(zombie.group.rotation.y + Math.PI / 2) < 1e-6, `rotation.y ${zombie.group.rotation.y}`)
})

test('melee within 1.3 m with per-type cooldown', () => {
  const { collision, zombie } = makeZombie('walker', 1.2, 0, 1)
  const player = fakePlayer(0, 0)
  for (let i = 0; i < 60; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  assert.equal(player.health, 992) // one 8-damage hit at t = 0.9 s
  for (let i = 0; i < 54; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  assert.equal(player.health, 984) // second hit at t = 1.8 s
})

test('kill: corpse sinks, deathTimer reaches 5 s', () => {
  const { collision, zombie } = makeZombie('walker', 3, 0, 1)
  const player = fakePlayer(-3, 0)
  zombie.damage(zombie.maxHealth + 10)
  assert.ok(zombie.isDead)
  assert.equal(zombie.health, 0)
  for (let i = 0; i < 302; i++) zombie.update(1 / 60, player, [zombie], collision, null) // ~5.03 s
  assert.ok(zombie.deathTimer >= 5, `deathTimer ${zombie.deathTimer}`)
  assert.ok(zombie.position.y < -0.5, `y ${zombie.position.y}`)
})

test('collision.resolve keeps the zombie out of the box; zombie routes around it', () => {
  const { collision, zombie } = makeZombie('walker', 3, 0, 1)
  collision.addAABB(-1, -1, 1, 1, 5)
  const player = fakePlayer(-3, 0)
  for (let i = 0; i < 180; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  // The zombie must never end up inside the box…
  assert.ok(collision.isWalkable(zombie.position.x, zombie.position.z, 0.5),
    `inside box at (${zombie.position.x}, ${zombie.position.z})`)
  // …and with wall-slide it now routes around the box (past the wall,
  // along its side) instead of vibrating against the face forever.
  assert.ok(zombie.position.x < 1.4, `x ${zombie.position.x} (expected to have passed the wall at 1 + radius)`)
})

test('head-on wall contact triggers slide along the face, no vibration', () => {
  // Zombie directly in front of a flat face, chasing straight into it.
  // The step is fully cancelled each frame (resolve restores pre-step
  // position), so the old `pushed`-based trigger never fired and the
  // zombie vibrated in place. It must now slide along the face.
  const { collision, zombie } = makeZombie('walker', 0, 41.1, 1)
  collision.addAABB(-2.75, 37.8, 2.75, 40.6, 5)
  const player = fakePlayer(0, 12) // straight-on chase
  for (let i = 0; i < 60; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  assert.ok(zombie.position.x > 0.5, `x ${zombie.position.x} (expected sliding along face)`)
  assert.ok(Math.abs(zombie.position.z - 41.1) < 1e-6, `z ${zombie.position.z} (must stay on face, 40.6 + radius 0.5)`)
  assert.ok(collision.isWalkable(zombie.position.x, zombie.position.z, 0.5))
})

test('hitboxes: torso r 0.45 @ y+1.2, head r 0.3 @ y+1.8, world space', () => {
  const { zombie } = makeZombie('shambler', 2, 4, 1)
  const hb = zombie.getHitboxes()
  assert.equal(hb.length, 2)
  assert.equal(hb[0].center.x, 2)
  assert.equal(hb[0].center.y, 1.2)
  assert.equal(hb[0].center.z, 4)
  assert.equal(hb[0].radius, 0.45)
  assert.equal(hb[0].isHead, false)
  assert.equal(hb[1].center.x, 2)
  assert.equal(hb[1].center.y, 1.8)
  assert.equal(hb[1].center.z, 4)
  assert.equal(hb[1].radius, 0.3)
  assert.equal(hb[1].isHead, true)
})

test('dead zombie inert: no movement, no damage to a live player', () => {
  const { collision, zombie } = makeZombie('walker', 1.2, 0, 1)
  const player = fakePlayer(0, 0)
  zombie.damage(zombie.maxHealth + 10)
  const bx = zombie.position.x
  const bz = zombie.position.z
  for (let i = 0; i < 60; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  assert.equal(zombie.position.x, bx)
  assert.equal(zombie.position.z, bz) // (y still sinks, per corpse behavior)
  assert.equal(player.health, 1000)
})

test('shared geometry/materials; dispose detaches only the group', () => {
  const scene = new THREE.Scene()
  const a = new Zombie(scene, 'walker', 0, 0, 1)
  const b = new Zombie(scene, 'walker', 2, 0, 1)
  assert.equal(a.group.children.length, 6) // torso, head, armL, armR, legL, legR
  for (let i = 0; i < 6; i++) {
    assert.equal(a.group.children[i].geometry, b.group.children[i].geometry)
    // Materials all come from the small shared pool: same type -> same head
    // skin; clothing comes from the 3 shared top/bottom material pairs. These
    // two spawns pick different outfits, so per-part identity is NOT expected;
    // membership in the shared arrays is the shared-material guarantee.
    const ma = a.group.children[i].material
    const mb = b.group.children[i].material
    if (i === 1) {
      assert.equal(ma, MAT2.walker); assert.equal(mb, MAT2.walker)
    } else if (i === 0 || i === 2 || i === 3) {
      assert.ok(OUTFITMATS.tops.includes(ma), 'a torso/arm is a shared top material')
      assert.ok(OUTFITMATS.tops.includes(mb), 'b torso/arm is a shared top material')
    } else {
      assert.ok(OUTFITMATS.bottoms.includes(ma), 'a leg is a shared bottom material')
      assert.ok(OUTFITMATS.bottoms.includes(mb), 'b leg is a shared bottom material')
    }
  }
  // Face: same type, different spawn positions -> possibly DIFFERENT shared
  // variant materials; each must be a member of the type's variant array.
  assert.ok(FACEMAT.walker.includes(a.group.children[1].children[2].material), 'a face is a shared walker variant')
  assert.ok(FACEMAT.walker.includes(b.group.children[1].children[2].material), 'b face is a shared walker variant')
  assert.equal(scene.children.length, 2) // two groups, no per-zombie geo
  a.dispose()
  assert.equal(scene.children.length, 1)
  b.dispose()
  assert.equal(scene.children.length, 0)
  a.dispose() // never throws, even when called twice
})

test('face variant: deterministic per-zombie pick, distributed across the variants', () => {
  const variantOf = (z) => Math.floor((z._phase / (2 * Math.PI)) * 3) % 3
  // Deterministic: same type + same spawn position -> same variant and the
  // exact same shared material instance.
  const a = new Zombie(new THREE.Scene(), 'walker', 0, 0, 1)
  const a2 = new Zombie(new THREE.Scene(), 'walker', 0, 0, 1)
  assert.equal(variantOf(a), variantOf(a2), 'same position always picks the same variant')
  assert.equal(a.group.children[1].children[2].material, a2.group.children[1].children[2].material)
  // Distributed: different positions map to different variant indices
  // (verified LCG phases: (0,0) -> 1, (1,0) -> 2), so the two face materials
  // really are different shared variant materials.
  const b = new Zombie(new THREE.Scene(), 'walker', 1, 0, 1)
  assert.notEqual(variantOf(a), variantOf(b), 'phases of (0,0) and (1,0) map to different variants')
  const fa = a.group.children[1].children[2].material
  const fb = b.group.children[1].children[2].material
  assert.ok(FACEMAT.walker.includes(fa) && FACEMAT.walker.includes(fb), 'both face materials are shared walker variants')
  assert.notEqual(fa, fb, 'different variants -> different face materials')
})

test('per-type bodies and anchors', () => {
  for (const type of ['walker', 'shambler', 'screamer']) {
    const { zombie } = makeZombie(type, 1, 1, 1)
    const parts = zombie.group.children
    assert.ok(parts.length >= 6, `${type} has ${parts.length} meshes`)
    assert.ok(Math.abs(parts[0].position.y - 1.2) < 1e-6, `${type} torso center y`)
    assert.ok(Math.abs(parts[1].position.y - 1.8) < 1e-6, `${type} head center y`)
  }
  const { zombie: sh } = makeZombie('shambler', 1, 1, 1)
  assert.ok(sh.group.children[0].rotation.x > 0.4, 'shambler torso hunched forward')
  const { zombie: sc } = makeZombie('screamer', 1, 1, 1)
  assert.ok(sc.group.children[2].rotation.x < -2, 'screamer arms raised')
})

test('hit flash swaps to HITMAT then restores per-part rest materials', () => {
  const { zombie } = makeZombie('walker', 0, 0, 1)
  zombie.damage(10) // non-fatal
  for (const m of zombie.group.children) assert.equal(m.material, HITMAT)
  assert.ok(FACEMAT.walker.includes(zombie.group.children[1].children[2].material)) // face untouched by flash (a shared variant)
  for (let i = 0; i < 10; i++) zombie.update(1 / 60, null, [zombie], null, null)
  for (let i = 0; i < zombie.group.children.length; i++) {
    assert.equal(zombie.group.children[i].material, zombie._restMats[i])
  }
  assert.equal(zombie.group.children[1].material, MAT2.walker) // head keeps its skin color
})

test('fatal hit switches every part to DEADMAT', () => {
  const { zombie } = makeZombie('shambler', 0, 0, 1)
  zombie.damage(zombie.maxHealth + 10)
  assert.ok(zombie.isDead)
  for (const m of zombie.group.children) assert.equal(m.material, DEADMAT)
  assert.equal(zombie.group.children[1].children[2].material, DEADMAT) // face darkened with the corpse
})

test('L-pocket: walker touching two boxes slides out and keeps moving', () => {
  // Pocket: thin box A [−2.75..2.75, 37.8..40.6] and box B [1..7.5, 40.5..47].
  // The walker starts at (0, 41.1), in contact with A's top face (and near B's
  // left face), chasing the player straight south. The old ±90°-of-want rule
  // picked the tangent running into B and stalled forever; the true contact
  // normal must send it out of the pocket.
  const { collision, zombie } = makeZombie('walker', 0, 41.1, 1)
  collision.addAABB(-2.75, 37.8, 2.75, 40.6, 5)
  collision.addAABB(1, 40.5, 7.5, 47, 5)
  const player = fakePlayer(0, 12)
  let moved = 0
  let px = zombie.position.x, pz = zombie.position.z
  for (let i = 0; i < 600; i++) {
    zombie.update(1 / 60, player, [zombie], collision, null)
    moved += Math.hypot(zombie.position.x - px, zombie.position.z - pz)
    px = zombie.position.x; pz = zombie.position.z
  }
  assert.ok(moved > 2, `total distance moved ${moved.toFixed(2)} m (expected > 2)`)
  assert.ok(zombie.position.z < 40 || Math.abs(zombie.position.x) > 3.3,
    `still stuck in pocket at (${zombie.position.x.toFixed(2)}, ${zombie.position.z.toFixed(2)})`)
  assert.ok(collision.isWalkable(zombie.position.x, zombie.position.z, 0.5))
})

test('eye glow: two shared-material eyes nested under head; dimmed on death', () => {
  for (const type of ['walker', 'shambler', 'screamer']) {
    const { zombie } = makeZombie(type, 1, 1, 1)
    const head = zombie.group.children[1]
    assert.equal(zombie.group.children.length, 6, `${type}: body parts unchanged`)
    assert.equal(head.children.length, 3, `${type}: eye + face count`)
    assert.equal(head.children[0].position.x, -0.075)
    assert.equal(head.children[0].position.z, 0.14)
    assert.equal(head.children[1].position.x, 0.075)
    for (const eye of head.children.slice(0, 2)) assert.equal(eye.material, EYEMAT[type])
    const face = head.children[2]
    assert.deepEqual(face.position.toArray(), [0, 0, 0.155])
    assert.ok(FACEMAT[type].includes(face.material))
    assert.ok(!zombie._parts.includes(face), `${type}: face excluded from hit-flash parts`)
  }
  const { zombie } = makeZombie('walker', 0, 0, 1)
  assert.equal(zombie._eyes.length, 2)
  zombie.damage(zombie.maxHealth + 10)
  for (const e of zombie._eyes) assert.equal(e.material, DEADEYEMAT)
})

test('contactNormal writes into caller scratch (no per-frame allocs)', () => {
  const { collision } = makeZombie('walker', 0, 0, 1)
  const out = { x: 0, z: 0 }
  const pos = new THREE.Vector3(0, 0, 0)
  // Box A on the west (closest point (0.4, 0), normal (-1, 0)) and box B on
  // the south (closest point (0, -0.4), normal (0, -1)); zombie radius 0.6.
  collision.addAABB(0.4, -1, 4, 1, 5)
  collision.addAABB(-1, -0.4, 1, 4, 5)
  // Most-opposing normal wins: wanting south, A (dot 0) beats B (dot 1).
  assert.equal(contactNormal(pos, collision.aabbs, 0.6, 0, -1, out), out)
  assert.equal(out.x, -1); assert.equal(out.z, 0)
  // A later AABB still wins when it opposes more: want (1, 2) gives
  // dot A = -1, dot B = -2, so B wins.
  assert.equal(contactNormal(pos, collision.aabbs, 0.6, 1, 2, out), out)
  assert.equal(out.x, 0); assert.equal(out.z, -1)
  // Exact tie (want (1, 1): both dots -1) -> first AABB wins (strict <).
  assert.equal(contactNormal(pos, collision.aabbs, 0.6, 1, 1, out), out)
  assert.equal(out.x, -1); assert.equal(out.z, 0)
  // No contact -> null; the scratch keeps its previous values.
  const far = new THREE.Vector3(50, 0, 50)
  assert.equal(contactNormal(far, collision.aabbs, 0.6, 0, -1, out), null)
  assert.equal(out.x, -1); assert.equal(out.z, 0)
})

test('walk cycle: limbs oscillate in opposite phase while chasing', () => {
  const { collision, zombie } = makeZombie('walker', 10, 0)
  const player = fakePlayer(0, 0)
  const armRest = POSE2.walker.armRest
  let aLmin = Infinity, aLmax = -Infinity, lLmin = Infinity, lLmax = -Infinity
  for (let i = 0; i < 30; i++) {
    zombie.update(1 / 60, player, [zombie], collision, null)
    const aL = zombie._armL.rotation.x - armRest
    const aR = zombie._armR.rotation.x - armRest
    const lL = zombie._legL.rotation.x
    const lR = zombie._legR.rotation.x
    assert.ok(Math.abs(aL + aR) < 1e-9, `arms not opposite at step ${i}: ${aL} + ${aR}`)
    assert.ok(Math.abs(lL + lR) < 1e-9, `legs not opposite at step ${i}: ${lL} + ${lR}`)
    aLmin = Math.min(aLmin, aL); aLmax = Math.max(aLmax, aL)
    lLmin = Math.min(lLmin, lL); lLmax = Math.max(lLmax, lL)
  }
  assert.ok(aLmax - aLmin > 0.3, `arm swing range ${aLmax - aLmin} (need > 0.3)`)
  assert.ok(Math.max(Math.abs(lLmin), Math.abs(lLmax)) > 0.1,
    `leg swing ${lLmin}..${lLmax} (need max |dev| > 0.1)`)
})

test('walk cycle: screamer arms stay raised while swinging', () => {
  const { collision, zombie } = makeZombie('screamer', 10, 0)
  const player = fakePlayer(0, 0)
  for (let i = 0; i < 30; i++) {
    zombie.update(1 / 60, player, [zombie], collision, null)
    assert.ok(zombie._armL.rotation.x < -2, `screamer left arm not raised at step ${i}`)
    assert.ok(zombie._armR.rotation.x < -2, `screamer right arm not raised at step ${i}`)
  }
})

test('death resets limbs to rest pose', () => {
  const { collision, zombie } = makeZombie('walker', 3, 0)
  const player = fakePlayer(-3, 0)
  // Swing a few frames first so a corpse would otherwise freeze mid-swing.
  for (let i = 0; i < 10; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  zombie.damage(zombie.maxHealth + 10)
  for (let i = 0; i < 30; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  assert.equal(zombie._armL.rotation.x, POSE2.walker.armRest)
  assert.equal(zombie._armR.rotation.x, POSE2.walker.armRest)
  assert.equal(zombie._legL.rotation.x, 0)
  assert.equal(zombie._legR.rotation.x, 0)
})

test('outfits: deterministic clothing materials per spawn; flash/death logic intact; headless-safe', () => {
  const scene = new THREE.Scene()
  // Mappings precomputed with the same spawn LCG + 0.37 offset:
  // (-85,0) -> 0 (suit), (-40,0) -> 1 (hoodie + sweatpants), (-70,0) -> 2 (tee + jeans)
  const a = new Zombie(scene, 'walker', -85, 0, 1)
  const b = new Zombie(scene, 'walker', -40, 0, 1)
  const c = new Zombie(scene, 'walker', -70, 0, 1)
  assert.equal(a.getOutfit(), 0)
  assert.equal(b.getOutfit(), 1)
  assert.equal(c.getOutfit(), 2)

  for (const z of [a, b, c]) {
    const o = z.getOutfit()
    const [torso, head, armL, armR, legL, legR] = z._parts
    assert.equal(torso.material, OUTFITMATS.tops[o])
    assert.equal(armL.material, OUTFITMATS.tops[o])
    assert.equal(armR.material, OUTFITMATS.tops[o])
    assert.equal(legL.material, OUTFITMATS.bottoms[o])
    assert.equal(legR.material, OUTFITMATS.bottoms[o])
    assert.equal(head.material, MAT2[z.type]) // head keeps the type skin color
    for (let i = 0; i < z._parts.length; i++) assert.equal(z._restMats[i], z._parts[i].material)
  }

  // Hit flash restores each part to its OWN rest material
  a.damage(5, null)
  for (const p of a._parts) assert.equal(p.material, HITMAT)
  a.update(0.2, null, [], null, null)
  assert.equal(a._parts[0].material, OUTFITMATS.tops[0])
  assert.equal(a._parts[1].material, MAT2.walker)
  assert.equal(a._parts[4].material, OUTFITMATS.bottoms[0])

  // Death behavior unchanged: every part (including clothing) -> DEADMAT
  b.damage(200, null)
  for (const p of b._parts) assert.equal(p.material, DEADMAT)

  // Headless Node: no document, so no texture is ever attached
  for (const m of [...OUTFITMATS.tops, ...OUTFITMATS.bottoms]) assert.equal(m.map, null)

  // Layout pin unchanged
  assert.equal(a.group.children.length, 6)

  a.dispose(); b.dispose(); c.dispose()
  assert.equal(scene.children.length, 0)
})
