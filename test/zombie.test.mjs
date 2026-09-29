import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { CollisionWorld } from '../src/game/CollisionWorld.js'
import { Zombie, TABLE, MAT2, HITMAT, DEADMAT, EYEMAT, DEADEYEMAT, contactNormal, FACEMAT, POSE2, OUTFITMATS, SLEEVE_MATS } from '../src/game/Zombie.js'

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
  assert.deepEqual(TABLE.walker, { speed: .5 + 1, hp: 100, melee: 8, cooldown: 0.9 , shotgunArmor: 1, staggerResist: 1 })
  assert.deepEqual(TABLE.shambler, { speed: 0.8, hp: 180, melee: 14, cooldown: 1.2 , shotgunArmor: 1, staggerResist: 1 })
  assert.deepEqual(TABLE.screamer, { speed: 2.2, hp: 80, melee: 6, cooldown: 0.7 , shotgunArmor: 1, staggerResist: 1.35 })
  const { zombie } = makeZombie('walker', 0, 0, 1)
  assert.equal(zombie.maxHealth, 100)
  const { zombie: w2 } = makeZombie('walker', 0, 0, 2)
  assert.equal(w2.maxHealth, 112) // Math.round(100 * 1.12)
  const { zombie: s2 } = makeZombie('shambler', 0, 0, 2)
  assert.equal(s2.maxHealth, 202) // Math.round(180 * 1.12)
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
    } else if (i === 2 || i === 3) {
      // v17: arms wear a PER-INSTANCE clone of the outfit sleeve material (so two
      // zombies in the same archetype read as different garments). The clone is
      // NOT a member of the shared sleeve pool and NOT the bare skin material.
      assert.ok(!SLEEVE_MATS.includes(ma) && ma !== MAT2.walker, 'a arm is a per-instance sleeve clone')
      assert.ok(!SLEEVE_MATS.includes(mb) && mb !== MAT2.walker, 'b arm is a per-instance sleeve clone')
      assert.equal(ma.isMeshStandardMaterial, true)
      assert.equal(mb.isMeshStandardMaterial, true)
    } else if (i === 0) {
      // v17: torso wears a per-instance clone of the archetype top material.
      assert.ok(!OUTFITMATS.tops.includes(ma) && ma !== MAT2.walker, 'a torso is a per-instance top clone')
      assert.ok(!OUTFITMATS.tops.includes(mb) && mb !== MAT2.walker, 'b torso is a per-instance top clone')
    } else {
      assert.ok(!OUTFITMATS.bottoms.includes(ma) && ma !== MAT2.walker, 'a leg is a per-instance bottom clone')
      assert.ok(!OUTFITMATS.bottoms.includes(mb) && mb !== MAT2.walker, 'b leg is a per-instance bottom clone')
    }
  }
  // Face: same type, different spawn positions -> possibly DIFFERENT shared
  // variant materials; each must be a member of the type's variant array.
  assert.ok(FACEMAT.walker.includes(a.group.children[1].children[0].material), 'a face is a shared walker variant')
  assert.ok(FACEMAT.walker.includes(b.group.children[1].children[0].material), 'b face is a shared walker variant')
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
  assert.equal(a.group.children[1].children[0].material, a2.group.children[1].children[0].material)
  // Distributed: different positions map to different variant indices
  // (verified LCG phases: (0,0) -> 1, (1,0) -> 2), so the two face materials
  // really are different shared variant materials.
  const b = new Zombie(new THREE.Scene(), 'walker', 1, 0, 1)
  assert.notEqual(variantOf(a), variantOf(b), 'phases of (0,0) and (1,0) map to different variants')
  const fa = a.group.children[1].children[0].material
  const fb = b.group.children[1].children[0].material
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
  assert.ok(FACEMAT.walker.includes(zombie.group.children[1].children[0].material)) // face untouched by flash (a shared variant)
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
  assert.equal(zombie.group.children[1].children[0].material, DEADMAT) // face darkened with the corpse
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

test('face portrait: no glowing eyes over it, enlarged disc, lifted off the torso', () => {
  for (const type of ['walker', 'shambler', 'screamer']) {
    const { zombie } = makeZombie(type, 1, 1, 1)
    const head = zombie.group.children[1]
    assert.equal(zombie.group.children.length, 6, `${type}: body parts unchanged`)
    // v26d: the glowing eye boxes are gone — the face portrait is now the first
    // head child, followed by hair and any head-mounted accessory / female
    // long-hair prop. So the count is 1 (face) + 1 (hair) + head props.
    const headAcc = zombie._acc && head.children.includes(zombie._acc) ? 1 : 0
    const headProps = (zombie._outfitProps || []).filter(p => head.children.includes(p)).length
    assert.equal(head.children.length, 2 + headAcc + headProps, `${type}: face + hair count`)
    const face = head.children[0]
    assert.ok(FACEMAT[type].includes(face.material), `${type}: head child 0 is the face`)
    assert.deepEqual(face.position.toArray(), [0, 0.01, 0.155], `${type}: face lifted, proud of the head`)
    assert.ok(face.geometry.parameters.radius > 0.13, `${type}: face disc enlarged to show the full portrait`)
    assert.ok(!zombie._parts.includes(face), `${type}: face excluded from hit-flash parts`)
    // No glowing eye boxes anywhere on the head.
    // No glowing eye boxes anywhere on the head (no child is the tiny eye box).
    assert.equal(zombie._eyes.length, 0, `${type}: glowing eyes removed`)
    assert.ok(!head.children.some(c => c.geometry && c.geometry.type === 'BoxGeometry' &&
      Math.abs(c.geometry.parameters.width - 0.07) < 1e-9), `${type}: no eye box under the head`)
  }
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
  // Death plays a deterministic flop (limbs splay + head lolls), NOT a freeze
  // mid-swing. At 30 frames deathTimer = 0.5 s, flop = min(0.5/1.5, 1) = 1/3.
  const flop = Math.min((30 / 60) / 1.5, 1)
  const armRest = POSE2.walker.armRest
  assert.equal(zombie._armL.rotation.x, armRest - flop * 0.7)
  assert.equal(zombie._armR.rotation.x, armRest + flop * 0.5)
  assert.equal(zombie._legL.rotation.x, flop * 0.4)
  assert.equal(zombie._legR.rotation.x, -flop * 0.3)
  assert.equal(zombie._head.rotation.x, flop * 0.5)
  // Limbs are splayed (not the rest pose) — the corpse reads dead, not frozen.
  assert.notEqual(zombie._armL.rotation.x, armRest)
})

test('outfits: deterministic clothing materials per spawn; flash/death logic intact; headless-safe', () => {
  const scene = new THREE.Scene()
  // Mappings precomputed with the same spawn LCG + 0.37 offset (9 archetypes):
  // (-85,0) -> 1 (mailman), (-40,0) -> 4 (dress), (-70,0) -> 8 (gym)
  const a = new Zombie(scene, 'walker', -85, 0, 1)
  const b = new Zombie(scene, 'walker', -40, 0, 1)
  const c = new Zombie(scene, 'walker', -70, 0, 1)
  assert.equal(a.getOutfit(), 1)
  assert.equal(b.getOutfit(), 4)
  assert.equal(c.getOutfit(), 8)

  for (const z of [a, b, c]) {
    // v17: each zombie clones its archetype top/bottom/sleeve and tints them, so
    // the parts wear the zombie's OWN clone materials (not the shared pool). The
    // outfit INDEX is still deterministic; the clones are per-instance.
    const [torso, head, armL, armR, legL, legR] = z._parts
    const [topC, bottomC, sleeveC] = z._outfitMats
    assert.equal(torso.material, topC)
    assert.equal(armL.material, sleeveC) // arms wear the sleeve clone twin
    assert.equal(armR.material, sleeveC)
    assert.equal(legL.material, bottomC)
    assert.equal(legR.material, bottomC)
    assert.equal(head.material, MAT2[z.type]) // head keeps the type skin color
    for (let i = 0; i < z._parts.length; i++) assert.equal(z._restMats[i], z._parts[i].material)
  }

  // Hit flash restores each part to its OWN rest material
  a.damage(5, null)
  for (const p of a._parts) assert.equal(p.material, HITMAT)
  a.update(0.2, null, [], null, null)
  assert.equal(a._parts[0].material, a._outfitMats[0])
  assert.equal(a._parts[1].material, MAT2.walker)
  assert.equal(a._parts[2].material, a._outfitMats[2]) // sleeve restored, not bare skin
  assert.equal(a._parts[3].material, a._outfitMats[2])
  assert.equal(a._parts[4].material, a._outfitMats[1])

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

test('v24 silhouette props + cloth roughness: collared/shouldered/belted garments', () => {
  const scene = new THREE.Scene()
  const z = new Zombie(scene, 'walker', -85, 0, 1)
  // v24: each zombie carries 4 silhouette props (collar + 2 shoulder pads + belt)
  // parented to the torso, NOT in _parts, so hit-flash / death never repaints them.
  assert.equal(z._silhouette.length, 4, 'collar + 2 shoulders + belt')
  const [collar, padL, padR, belt] = z._silhouette
  // Collar + shoulders reuse the zombie's own top clone (match the jacket).
  assert.equal(collar.material, z._outfitMats[0])
  assert.equal(padL.material, z._outfitMats[0])
  assert.equal(padR.material, z._outfitMats[0])
  // Belt is the shared dark leather material (not per-instance).
  assert.equal(belt.material.color.getHex(), 0x1a1611)
  // Props are children of the torso, so the group still has exactly 6 parts.
  assert.equal(z.group.children.length, 6)
  assert.ok(z._silhouette.every(p => p.parent === z._parts[0]), 'props parented to torso')
  // Hit flash must NOT touch the props (they are not in _parts).
  const before = z._silhouette.map(p => p.material)
  z.damage(5, null)
  assert.deepEqual(z._silhouette.map(p => p.material), before, 'flash leaves props alone')
  // Cloth roughness map is assigned to every outfit top/bottom/sleeve (headless-safe).
  for (const m of [...OUTFITMATS.tops, ...OUTFITMATS.bottoms]) {
    assert.ok(m.roughnessMap, 'top/bottom carry the shared cloth roughness map')
    assert.notEqual(m.roughnessMap.colorSpace, 'srgb', 'roughness map is not sRGB-decoded')
  }
  // dispose removes the group (props go with it) and frees the scene.
  z.dispose()
  assert.equal(scene.children.length, 0)
})

test('knockback: a melee hit staggers the zombie backward, then chase resumes', () => {
  const { collision, zombie } = makeZombie('walker', 0, -2, 1) // player at origin
  const player = fakePlayer(0, 0)
  // Push away from the player (player -> zombie direction is (0, -1)).
  zombie.knockback(0, -1, 3)
  assert.equal(zombie._kbT, 0.35)
  const x0 = zombie.position.x
  for (let i = 0; i < 21; i++) zombie.update(1 / 60, player, [zombie], collision, null) // 0.35 s
  assert.ok(zombie._kbT < 1e-9, `_kbT=${zombie._kbT}`) // 21*(1/60) ≈ 0.35 in fp
  // Discrete sum of the linear decay: exactly 0.5 m back from -2.
  assert.ok(Math.abs(zombie.position.z + 2.5) < 1e-9, `z=${zombie.position.z}`)
  assert.ok(Math.abs(zombie.position.x - x0) < 1e-9, `x=${zombie.position.x}`) // ~1e-16 fp noise from resolve()
  // Stagger ends with limbs at rest pose
  assert.equal(zombie._legL.rotation.x, 0)
  assert.equal(zombie._armL.rotation.x, POSE2.walker.armRest)
  // After the stagger the zombie resumes chasing the player (+z here).
  const zAfter = zombie.position.z
  for (let i = 0; i < 30; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  assert.ok(zombie.position.z > zAfter, 'chase resumes after stagger')
  // Knocking a dead zombie is a no-op.
  zombie.damage(zombie.maxHealth + 10)
  const deadX = zombie.position.x
  zombie.knockback(1, 0, 5)
  assert.equal(zombie._kbT, 0)
  assert.equal(zombie.position.x, deadX)
})

test('knockback: per-type stagger resistance — screamer resists kiting, brute barely moves', () => {
  // Same setup as the walker knockback pin above: spawn at (0,-2), push (0,-1,3),
  // step 21 frames at 1/60 (the full KB_TIME window). Displacement is the
  // discrete sum of the linear decay (0.5 m at resist 1) times staggerResist.
  const expect = { walker: 0.5, screamer: 0.5 * 1.35, brute: 0.5 * 0.35 }
  const dist = {}
  for (const type of ['walker', 'screamer', 'brute']) {
    const { collision, zombie } = makeZombie(type, 0, -2, 1)
    const player = fakePlayer(0, 0)
    zombie.knockback(0, -1, 3)
    assert.equal(zombie.staggerResist, TABLE[type].staggerResist)
    for (let i = 0; i < 21; i++) zombie.update(1 / 60, player, [zombie], collision, null)
    dist[type] = Math.abs(zombie.position.z + 2)
    assert.ok(Math.abs(dist[type] - expect[type]) < 1e-9, `${type} z=${zombie.position.z}`)
    // Chase resumes after the stagger for every type.
    const zAfter = zombie.position.z
    for (let i = 0; i < 30; i++) zombie.update(1 / 60, player, [zombie], collision, null)
    assert.ok(zombie.position.z > zAfter, `${type}: chase resumes after stagger`)
  }
  // Ordering: brute < walker < screamer.
  assert.ok(dist.brute < dist.walker && dist.walker < dist.screamer,
    `ordering broken: brute=${dist.brute} walker=${dist.walker} screamer=${dist.screamer}`)
})

test('melee skips a player jumping above arm reach; hits once grounded', () => {
  const { collision, zombie } = makeZombie('walker', 1.2, 0, 1)
  const player = fakePlayer(0, 0)
  player.position.y = 2.6 // mid-jump: 1.4 m above the torso center (1.2)
  for (let i = 0; i < 60; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  assert.equal(player.health, 1000) // no hit while the player is high
  player.position.y = 1.7 // lands back on the ground
  for (let i = 0; i < 60; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  assert.equal(player.health, 992) // one 8-damage hit after landing
})

// ---- limb damage -------------------------------------------------------------
// v3 T1: the dismemberment chain. hitLimbAt severs only when the impact lands
// near a surviving limb; _chainShot counts the landed body rounds and the
// round after three limbs are gone is the kill. The chain is hit-counted, so
// it never touches maxHealth — the difficulty HP contract stays exact. Tests
// below drive the two entry points exactly as the weapons do (hitLimbAt
// first, then _chainShot).

test('limb damage: shooting an arm severs it and the zombie keeps coming', () => {
  const { zombie } = makeZombie('walker', 0, 0, 1)
  const armWorld = new THREE.Vector3(0 - 0.34, 1.42, 0 + 0.1) // left arm center
  const r = zombie.hitLimbAt(armWorld.x, armWorld.y, armWorld.z)
  assert.equal(r, 'arm', 'a hit on the arm severs it')
  assert.equal(zombie.armsLost, 1)
  assert.equal(zombie._armL.visible, false, 'severed arm hidden')
  assert.equal(zombie.isDead, false, 'losing an arm does not kill it')
  // A second arm hit severs the other arm; still alive, still full speed.
  assert.equal(zombie.hitLimbAt(0.34, 1.42, 0.1), 'arm')
  assert.equal(zombie.armsLost, 2)
  assert.equal(zombie._effSpeed(), zombie.speed, 'arms do not slow the zombie')
})

test('limb damage: shooting a leg makes the zombie limp and slower', () => {
  const { zombie } = makeZombie('walker', 0, 0, 1)
  assert.equal(zombie.hitLimbAt(-0.16, 0.47, 0), 'leg', 'a hit on the leg severs it')
  assert.equal(zombie.legsLost, 1)
  assert.equal(zombie._legL.visible, false)
  assert.equal(zombie._limp, true)
  assert.ok(zombie._effSpeed() < zombie.speed, 'a one-legged zombie is slower')
  assert.ok(Math.abs(zombie._effSpeed() - zombie.speed * 0.45) < 1e-9)
  assert.equal(zombie.isDead, false, 'losing a leg does not kill it')
})

test('limb damage: the boss cannot be dismembered', () => {
  const { zombie } = makeZombie('brute', 0, 0, 5)
  assert.equal(zombie.hitLimbAt(-0.34, 1.42, 0.1), null, 'boss arms are immune')
  assert.equal(zombie.hitLimbAt(-0.16, 0.47, 0), null, 'boss legs are immune')
  assert.equal(zombie.armsLost, 0)
  assert.equal(zombie.legsLost, 0)
  zombie._chainShot(1)
  assert.equal(zombie.isDead, false, 'the boss is immune to the chain kill too')
})

test('limb damage: a hit on the torso severs nothing', () => {
  const { zombie } = makeZombie('walker', 0, 0, 1)
  assert.equal(zombie.hitLimbAt(0, 1.2, 0), null, 'torso hit is not a limb')
  assert.equal(zombie.armsLost, 0)
  assert.equal(zombie.legsLost, 0)
})

test('v3 chain: three limbs fall off, the fourth round kills', () => {
  const { zombie } = makeZombie('walker', 0, 0, 1)
  // Round 1: left arm.
  assert.equal(zombie.hitLimbAt(-0.34, 1.42, 0.1), 'arm')
  zombie._chainShot(1)
  assert.equal(zombie.armsLost, 1)
  assert.equal(zombie.isDead, false)
  // Round 2: right arm.
  assert.equal(zombie.hitLimbAt(0.34, 1.42, 0.1), 'arm')
  zombie._chainShot(1)
  assert.equal(zombie.armsLost, 2)
  assert.equal(zombie.isDead, false)
  // Round 3: a leg — the zombie starts to limp.
  assert.equal(zombie.hitLimbAt(-0.16, 0.47, 0), 'leg')
  assert.equal(zombie.legsLost, 1)
  assert.equal(zombie.isDead, false, 'three limbs gone is still alive')
  // Round 4: the kill shot, wherever it lands.
  assert.equal(zombie.hitLimbAt(0, 1.2, 0), null, 'the kill round severs nothing')
  zombie._chainShot(1)
  assert.equal(zombie.isDead, true, 'the fourth body round kills')
  assert.equal(zombie.health, 0)
})

test('v3 chain: rounds that miss the limbs still advance the chain', () => {
  const { zombie } = makeZombie('walker', 0, 0, 1)
  // Three center-mass rounds sever nothing but spend the chain...
  for (let i = 0; i < 3; i++) {
    assert.equal(zombie.hitLimbAt(0, 1.2, 0), null)
    zombie._chainShot(1)
  }
  assert.equal(zombie.armsLost, 0)
  assert.equal(zombie.legsLost, 0)
  assert.equal(zombie.isDead, false, 'three torso rounds are not lethal yet')
  // ...the fourth landed round kills whatever is left.
  zombie._chainShot(1)
  assert.equal(zombie.isDead, true, 'the fourth landed round kills whatever is left')
})

test('v3 chain: a severed limb leaves the hit-flash set and is reversible', () => {
  const { zombie } = makeZombie('walker', 0, 0, 1)
  assert.equal(zombie.hitLimbAt(-0.34, 1.42, 0.1), 'arm')
  assert.equal(zombie._parts.includes(zombie._armL), false, 'severed arm leaves the flash set')
  zombie.damage(10) // non-fatal: flash repaints the surviving parts only
  assert.equal(zombie._armL.material, zombie._limbRest.armL, 'a severed arm is never repainted')
  zombie.restoreLimbs(0, 0)
  assert.equal(zombie._armL.visible, true, 'restoreLimbs regrows the arm')
  assert.equal(zombie.armsLost, 0)
  assert.ok(zombie._parts.includes(zombie._armL), 'the limb is back in the flash set')
})

test('v3 chain: the chain kill routes through the normal death path', () => {
  const { zombie } = makeZombie('walker', 0, 0, 1)
  zombie.armsLost = 2
  zombie.legsLost = 1
  zombie._chainShots = 3
  zombie.lastDamager = 'p1'
  zombie._chainKill()
  assert.equal(zombie.isDead, true)
  assert.equal(zombie.health, 0)
  assert.equal(zombie.lastHitHead, false, 'a chain kill is a body kill')
  assert.equal(zombie._parts[0].material, DEADMAT, 'corpse material swap ran')
})

test('v3 chain: the chain never touches HP (difficulty contract intact)', () => {
  // The chain is hit-counted, so it must not raise or lower health: a frenzy
  // walker still dies to exactly 2 pistol body rounds (26 + 26 >= 50) and a
  // normal walker to 2 rounds (50 HP), regardless of what the chain severs.
  const scene = new THREE.Scene()
  const f = new Zombie(scene, 'walker', 0, 0, 1, 'frenzy')
  assert.equal(f.maxHealth, 50, 'frenzy flat 50 HP is untouched by the chain')
  f.hitLimbAt(-0.34, 1.42, 0.1)
  f._chainShot(1)
  f.damage(26)
  assert.equal(f.health, 24, 'round 1 severs the left arm and deals 26')
  f.damage(26)
  assert.ok(f.isDead, 'the second body round kills by damage, not by the chain')
  assert.equal(f.armsLost, 1, 'the chain ended after the first arm')
})

// v6 visuals (5): clearer enemy silhouettes. The readability gate is Michelson
// contrast between the zombie body and the fog backdrop, computed exactly as
// the renderer does it: sRGB->linear -> Lambert under the shipped night rig
// (moon 1.45 lx 0x9db4ff, hemi 0.30 0x1a2440/0x0a0a10, ambient 0.12 0x141a2e)
// -> exposure 1.2 -> ACESFilmic -> FogExp2 blend toward the fog color. Gate:
// C >= 0.90 at 10/20/30 m on every fog tier, and the body must stay under the
// 0.72 bloom cut so zombies never bloom (round 44).
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linOf = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => s2l(v / 255))
const lumY = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
const aces = (x) => Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14))
const EXPOSURE = 1.2
const FOG_RGB = linOf(0x0b1020)
const BG = aces(lumY(FOG_RGB) * EXPOSURE)
// Irradiance on a camera-facing vertical torso: hemi at N.L=0.5, ambient 1.0,
// moon at N.L=0.5 (average of front/back-lit, moon elevation ~50 deg).
const IRR = [0, 1, 2].map((i) =>
  0.30 * 0.5 * (linOf(0x1a2440)[i] + linOf(0x0a0a10)[i]) +
  0.12 * linOf(0x141a2e)[i] +
  1.45 * 0.5 * linOf(0x9db4ff)[i])
const YIRR = lumY(IRR)
const FOG_DENSITY = { high: 0.022, medium: 0.019, low: 0.018 }
// Screamer emissive 0x401018 x 0.5 expressed as a multiplier on body luminance.
const SCREAM_EM = 0.5 * lumY(linOf(0x401018)) / lumY(linOf(0xb46574))

function bodyContrast(hex, emMult, tier, d) {
  const vis = Math.exp(-((d * FOG_DENSITY[tier]) ** 2))
  const lit = aces(lumY(linOf(hex)) * (YIRR + emMult) * EXPOSURE)
  const body = lit * vis + BG * (1 - vis)
  return (body - BG) / (body + BG)
}

test('silhouette contrast: every type clears C >= 0.90 at 10/20/30 m on all tiers', () => {
  const EM = { walker: 0, shambler: 0, screamer: SCREAM_EM, brute: 0 }
  for (const tier of ['high', 'medium', 'low']) {
    for (const type of ['walker', 'shambler', 'screamer', 'brute']) {
      for (const d of [10, 20, 30]) {
        const c = bodyContrast(MAT2[type].color.getHex(), EM[type], tier, d)
        assert.ok(c >= 0.90, `${tier}/${type} at ${d} m: C=${c.toFixed(3)} >= 0.90`)
      }
    }
  }
})

test('silhouette contrast: bodies stay under the 0.72 bloom cut (round 44)', () => {
  for (const type of ['walker', 'shambler', 'screamer', 'brute']) {
    const em = type === 'screamer' ? SCREAM_EM : 0
    const lit = aces(lumY(linOf(MAT2[type].color.getHex())) * (YIRR + em) * EXPOSURE)
    assert.ok(lit < 0.72, `${type} body tonemapped ${lit.toFixed(4)} < 0.72`)
  }
})

test('silhouette contrast: per-type luminance order preserved (no homogenizing)', () => {
  const y = (t) => lumY(linOf(MAT2[t].color.getHex()))
  assert.ok(y('walker') > y('shambler'), 'walker brighter than shambler')
  assert.ok(y('shambler') > y('screamer'), 'shambler brighter than screamer')
  assert.ok(y('screamer') > y('brute'), 'screamer brighter than brute')
  // Per-type hues stay distinct: R/G separates the red screamer from the
  // green walker/brute, and the greens keep G > R while the screamer does not.
  const rg = (t) => { const v = linOf(MAT2[t].color.getHex()); return v[0] / v[1] }
  const gb = (t) => { const v = linOf(MAT2[t].color.getHex()); return v[1] / v[2] }
  assert.ok(rg('screamer') > 3, 'screamer stays the red one (R/G > 3)')
  assert.ok(rg('walker') < 1 && rg('brute') < 1, 'walker/brute stay green-dominant')
  assert.ok(gb('brute') > 1 && gb('screamer') < 1, 'brute stays green-vs-blue dominant')
})

test('silhouette contrast: FACEMAT mirrors the lifted MAT2 colors', () => {
  for (const type of ['walker', 'shambler', 'screamer', 'brute']) {
    for (const m of FACEMAT[type]) assert.equal(m.color.getHex(), MAT2[type].color.getHex())
  }
})

// v6 visuals (6): hit feedback. Round 45 lifted MAT2, which pushed every body
// above the old HITMAT: Michelson C went NEGATIVE (−0.01…−0.43), so a hit read
// as a dark patch. HITMAT is now 0xe84a38 + emissive 0xb02214. Emissive is
// view-independent, so the flash reads at any distance and on 'low' where the
// muzzle-flash light is dropped. Numbers reuse the round-45 rig above.
const hitLit = () => aces((lumY(linOf(HITMAT.color.getHex())) * YIRR + HITMAT.emissiveIntensity * lumY(linOf(HITMAT.emissive.getHex()))) * EXPOSURE)

test('hit feedback: HITMAT is brighter than every lifted MAT2 body (C >= 0.30)', () => {
  const lit = hitLit()
  assert.ok(lit > 0.3, `HITMAT tonemapped ${lit.toFixed(4)} must read as a flash`)
  assert.ok(lit < 0.72, `HITMAT tonemapped ${lit.toFixed(4)} stays under the bloom cut`)
  const EM = { walker: 0, shambler: 0, screamer: SCREAM_EM, brute: 0 }
  for (const type of ['walker', 'shambler', 'screamer', 'brute']) {
    const body = aces(lumY(linOf(MAT2[type].color.getHex())) * (YIRR + EM[type]) * EXPOSURE)
    const c = (lit - body) / (lit + body)
    assert.ok(c >= 0.30, `${type}: C=${c.toFixed(3)} >= 0.30 (body ${body.toFixed(4)})`)
  }
})

test('hit feedback: the flash still reads through fog at 30 m and stays red', () => {
  const lit = hitLit()
  for (const tier of ['high', 'medium', 'low']) {
    const vis = Math.exp(-((30 * FOG_DENSITY[tier]) ** 2))
    const fogged = lit * vis + BG * (1 - vis)
    const c = (fogged - BG) / (fogged + BG)
    assert.ok(c >= 0.90, `${tier} at 30 m: C=${c.toFixed(3)} >= 0.90`)
  }
  const v = linOf(HITMAT.color.getHex())
  assert.ok(v[0] / v[1] > 8, 'the hit flash stays deep red (R/G > 8)')
})

test('hit feedback: 0.15 s window survives a 60 fps frame budget', () => {
  const { collision, zombie } = makeZombie('walker', 3, 0, 1)
  const player = fakePlayer(-3, 0)
  zombie.damage(10)
  for (const p of zombie._parts) assert.equal(p.material, HITMAT)
  for (let i = 0; i < 8; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  assert.equal(zombie._parts[0].material, HITMAT, 'still flashing at 0.133 s')
  for (let i = 0; i < 2; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  assert.notEqual(zombie._parts[0].material, HITMAT, 'restored by 0.167 s')
})
