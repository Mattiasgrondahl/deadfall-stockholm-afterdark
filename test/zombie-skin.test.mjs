// Skinned-swap integration probe (Ralph round 5, v5 zombie).
//
// Exercises the browser-only skinned-mesh layer in Zombie.js headlessly by
// injecting a loaded rig into the module's skin cache and attaching it to a
// zombie, then driving update() through the states. Proves the state->clip
// routing, primitive hiding, face/eye re-parenting, and mixer ticking all work
// without a browser. Uses the real rigged walker GLB parsed from bytes.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Zombie } from '../src/game/Zombie.js'

if (typeof globalThis.self === 'undefined') {
  globalThis.self = {
    Image: class { set src(_v) {} onload = null; onerror = null },
    createImageBitmap: async () => ({ close() {}, width: 1, height: 1 }),
  }
}

async function loadRig() {
  const buf = readFileSync(new URL('../public/assets/zombies/walker-final.glb', import.meta.url))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(ab, '', (g) => resolve({ scene: g.scene, animations: g.animations }), reject)
  })
}

function fakePlayer(x, z) {
  return { position: new THREE.Vector3(x, 1.7, z), isDead: false, health: 1000, damage() {} }
}

test('attachSkin swaps primitives for a skinned mesh and routes states', async () => {
  const rec = await loadRig()
  const scene = new THREE.Scene()
  const z = new Zombie(scene, 'walker', 6, 0, 1)
  // Inject the loaded rig and attach it (the constructor's loadSkin is a
  // headless no-op, so attach manually here to exercise the browser path).
  z._attachSkin(rec)
  assert.ok(z._skin, 'attachSkin must build a skinned layer')
  assert.ok(z._skin.skinned.isSkinnedMesh, 'skinned mesh present')
  // Primitives hidden once a skin is attached (limbs hidden; the head primitive
  // stays visible because it carries the face + eyes, which must read at any
  // distance and survive LOD swaps).
  assert.equal(z._parts[0].visible, false, 'torso hidden when skinned')
  assert.equal(z._parts[2].visible, false, 'armL hidden when skinned')
  assert.equal(z._parts[3].visible, false, 'armR hidden when skinned')
  assert.equal(z._parts[4].visible, false, 'legL hidden when skinned')
  assert.equal(z._parts[5].visible, false, 'legR hidden when skinned')
  // The rig GLB has its own head, so the primitive head is hidden when skinned
  // (a visible primitive head produced a DOUBLE head). The face + eyes are
  // re-parented onto the rig's Head bone so they ride the animated head.
  assert.equal(z._parts[1].visible, false, 'head primitive hidden when skinned (no double head)')
  assert.equal(z._face.parent, z._headBone, 'face re-parented to the rig head bone')
  assert.equal(z._eyes[0].parent, z._headBone, 'eyes re-parented to the rig head bone')
  assert.equal(z._skin.root.visible, true, 'skinned root visible near the player')
  // Actions exist for the mapped states (fallback to Idle where a clip is absent).
  for (const s of ['idle', 'walk', 'run', 'attack', 'hurt', 'death']) {
    assert.ok(z._skin.actions[s], `missing action for ${s}`)
  }
  // Drive update() through chase -> melee -> death and confirm the mixer
  // advances and the current action tracks the state.
  const player = fakePlayer(0, 0)
  const collision = { resolve() {}, aabbs: [] }
  for (let i = 0; i < 30; i++) z.update(1 / 60, player, [z], collision, null)
  assert.equal(z._skinState, 'walk', 'chasing should select walk/run')
  assert.ok(z._skin.current && z._skin.current.isRunning(), 'a clip must be running')
  // Move adjacent -> melee -> attack state.
  z.position.set(0.8, 0, 0)
  for (let i = 0; i < 60; i++) z.update(1 / 60, player, [z], collision, null)
  assert.equal(z._skinState, 'attack', 'melee should select attack')
  // Kill -> death state + corpse sink still works.
  z.damage(9999)
  assert.ok(z.isDead)
  z.update(1 / 60, player, [z], collision, null)
  assert.equal(z._skinState, 'death', 'death should select death')
  // dispose releases the mixer without touching the shared rig.
  z.dispose()
  assert.equal(z._skin, null, 'dispose clears the skin layer')
})

test('headless Zombie keeps the primitive body (no skin attached)', () => {
  const scene = new THREE.Scene()
  const z = new Zombie(scene, 'walker', 0, 0, 1)
  assert.equal(z._skin, null, 'headless spawn attaches no skin')
  assert.ok(z._parts.every((p) => p.visible === true), 'primitives visible headless')
})

test('LOD swap: skinned near the player, primitive stub beyond 25 m', async () => {
  const rec = await loadRig()
  const scene = new THREE.Scene()
  const z = new Zombie(scene, 'walker', 0, 0, 1)
  z._attachSkin(rec)
  assert.ok(z._skin, 'skin attached')
  // Near: skinned visible, primitive limbs hidden.
  z._applyLOD({ x: 5, z: 0 })
  assert.equal(z._skin.root.visible, true, 'skinned visible near')
  assert.equal(z._parts[0].visible, false, 'primitive torso hidden near')
  // Far (beyond LOD_DIST): skinned hidden, primitive body restored.
  z._applyLOD({ x: 40, z: 0 })
  assert.equal(z._skin.root.visible, false, 'skinned hidden beyond 25 m')
  assert.equal(z._parts[0].visible, true, 'primitive torso restored beyond LOD')
  assert.equal(z._parts[1].visible, true, 'head/face visible beyond LOD')
  assert.equal(z._face.parent, z._parts[1], 'face moved back to the primitive head when LOD out')
  // Back near: skinned restored.
  z._applyLOD({ x: 2, z: 0 })
  assert.equal(z._skin.root.visible, true, 'skinned restored when near again')
  assert.equal(z._face.parent, z._headBone, 'face back on the rig head bone when near')
})

test('per-type tint + brute scale + flash/death swap the skinned material', async () => {
  const rec = await loadRig()
  const scene = new THREE.Scene()
  const walker = new Zombie(scene, 'walker', 0, 0, 1)
  const brute = new Zombie(scene, 'brute', 0, 0, 1)
  walker._attachSkin(rec)
  brute._attachSkin(rec)
  assert.ok(walker._skin && brute._skin, 'both attach a skin')
  // Per-type tint: the body material color differs by type.
  assert.notEqual(walker._skin.skinned.material.color.getHex(),
    brute._skin.skinned.material.color.getHex(), 'types must tint differently')
  // Brute silhouette is larger than the walker's.
  assert.ok(brute._skin.root.scale.x > walker._skin.root.scale.x, 'brute scaled larger')
  // Hit flash swaps the skinned material to HITMAT, then back to the rest mat.
  walker.damage(1)
  assert.notEqual(walker._skin.skinned.material, walker._skinRestMat, 'hit flash swaps the body material')
  for (let i = 0; i < 12; i++) walker.update(1 / 60, fakePlayer(0, 0), [walker], { resolve() {}, aabbs: [] }, null)
  assert.equal(walker._skin.skinned.material, walker._skinRestMat, 'flash recovers to the rest material')
  // Death swaps to DEADMAT.
  walker.damage(9999)
  assert.ok(walker.isDead)
  assert.notEqual(walker._skin.skinned.material, walker._skinRestMat, 'death swaps the body material')
})

test('skinned body sits under the head (no double-offset / floating head)', async () => {
  const rec = await loadRig()
  const scene = new THREE.Scene()
  // Spawn well away from origin so a double-offset bug would be obvious: the
  // group is at the feet position, and the skinned root must stay at the
  // group's LOCAL origin (0,0,0), not copy the world position.
  const z = new Zombie(scene, 'walker', 60, 0, 1)
  z._attachSkin(rec)
  assert.ok(z._skin, 'skin attached')
  assert.equal(z._skin.root.position.x, 0, 'root stays at local origin x')
  assert.equal(z._skin.root.position.z, 0, 'root stays at local origin z')
  // The skinned body's world position must match the group (feet), directly
  // under the head primitive — not 2x the spawn offset.
  z._skin.root.updateWorldMatrix(true, false)
  const body = new THREE.Vector3(); z._skin.root.getWorldPosition(body)
  const head = new THREE.Vector3(); z._parts[1].getWorldPosition(head)
  assert.ok(Math.abs(body.x - 60) < 1e-6, `body world x tracks the group (${body.x})`)
  assert.ok(Math.hypot(body.x - head.x, body.z - head.z) < 1e-6, 'body is directly under the head')
})

test('skinned body stands on the ground with its top at the head (vertical alignment)', async () => {
  const rec = await loadRig()
  const scene = new THREE.Scene()
  const z = new Zombie(scene, 'walker', 0, 0, 1)
  z._attachSkin(rec)
  z._setSkinState('idle')
  z._skin.mixer.update(0.001)
  z.group.updateMatrixWorld(true)
  z._skin.root.updateMatrixWorld(true)
  const bb = new THREE.Box3().setFromObject(z._skin.skinned)
  const head = new THREE.Vector3(); z._parts[1].getWorldPosition(head)
  // Feet must sit on the ground (group origin y 0), not hang below it.
  assert.ok(Math.abs(bb.min.y) < 0.05, `feet on the ground (${bb.min.y})`)
  // The body top must reach the head primitive so head + body read as one body
  // (the "body too small / misaligned with the head" bug left the top far below).
  assert.ok(bb.max.y >= head.y - 0.05, `body top reaches the head (top ${bb.max.y}, head ${head.y})`)
})

test('skinned mesh is bound to its OWN cloned bones in the rendered tree', async () => {
  const rec = await loadRig()
  const scene = new THREE.Scene()
  const z = new Zombie(scene, 'walker', 5, 0, 1)
  z._attachSkin(rec)
  const sm = z._skin.skinned
  // The clone must NOT share the source skeleton (otherwise every zombie poses
  // the shared source armature and the body renders unposed / invisible).
  let src = null; rec.scene.traverse((o) => { if (o.isSkinnedMesh && !src) src = o })
  assert.notEqual(sm.skeleton, src.skeleton, 'skeleton is not the shared source skeleton')
  // Every bone must be a descendant of the cloned root so it renders with it.
  let inTree = 0
  for (const b of sm.skeleton.bones) {
    let p = b, found = false
    while (p) { if (p === z._skin.root || p === z.group) { found = true; break } p = p.parent }
    if (found) inTree++
  }
  assert.equal(inTree, sm.skeleton.bones.length, 'all bones are in the rendered tree')
  // Skinned meshes must not be frustum-culled (bind-pose sphere drops the body).
  assert.equal(sm.frustumCulled, false, 'skinned mesh is not frustum-culled')
  // Two zombies pose independently (independent skeletons).
  const z2 = new Zombie(scene, 'walker', 6, 0, 1)
  z2._attachSkin(rec)
  assert.notEqual(z._skin.skinned.skeleton, z2._skin.skinned.skeleton, 'independent skeletons')
})