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
import { Zombie, HITMAT, DEADMAT } from '../src/game/Zombie.js'

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
  // The primitive body is the always-on visual now: every primitive part stays
  // visible, and the face + eyes stay on the primitive head (which carries them).
  // The skinned rig root is hidden so the pale featureless body no longer
  // overrides the clothed primitive up close.
  assert.ok(z._parts.every((p) => p.visible === true), 'all primitives visible (primitive is the visual)')
  assert.equal(z._face.parent, z._parts[1], 'face stays on the primitive head')
  assert.equal(z._eyes[0].parent, z._parts[1], 'eyes stay on the primitive head')
  assert.equal(z._skin.root.visible, false, 'skinned root hidden (primitive is the visual)')
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

test('primitive body stays visible at any distance; rig root stays hidden', async () => {
  const rec = await loadRig()
  const scene = new THREE.Scene()
  const z = new Zombie(scene, 'walker', 0, 0, 1)
  z._attachSkin(rec)
  assert.ok(z._skin, 'skin attached')
  // Near: primitive visible, rig hidden (primitive is the visual).
  z._applyLOD({ x: 5, z: 0 })
  assert.equal(z._skin.root.visible, false, 'rig hidden near')
  assert.equal(z._parts[0].visible, true, 'primitive torso visible near')
  // Far: same policy — primitive visible, rig hidden.
  z._applyLOD({ x: 40, z: 0 })
  assert.equal(z._skin.root.visible, false, 'rig hidden beyond 25 m')
  assert.equal(z._parts[0].visible, true, 'primitive torso visible beyond LOD')
  assert.equal(z._parts[1].visible, true, 'head/face visible beyond LOD')
  assert.equal(z._face.parent, z._parts[1], 'face stays on the primitive head')
  // Back near: unchanged.
  z._applyLOD({ x: 2, z: 0 })
  assert.equal(z._skin.root.visible, false, 'rig stays hidden when near again')
  assert.equal(z._face.parent, z._parts[1], 'face stays on the primitive head when near')
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

// ---- A2: distinct per-type BODY meshes (static, unrigged) ----
//
// The finished shambler/screamer/brute GLBs are single UNRIGGED meshes (no
// SkinnedMesh, no clips). _attachSkin (which requires an isSkinnedMesh) returns
// null for them, so the body arrives through the separate _attachSkinMesh path:
// the mesh becomes the visible body, the primitive torso/limbs hide, and only the
// head primitive stays (face + eyes + headshot target). These tests parse the real
// shipped GLBs and drive that path headlessly.

async function loadMesh(name) {
  const buf = readFileSync(new URL(`../public/assets/zombies/${name}-mesh.glb`, import.meta.url))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(ab, '', (g) => resolve({ scene: g.scene }), reject)
  })
}

test('A2: MESH_ASSET covers shambler/screamer/brute only (walker keeps primitive)', async () => {
  const mod = await import('../src/game/Zombie.js')
  assert.deepEqual(Object.keys(mod.MESH_ASSET).sort(), ['brute', 'screamer', 'shambler'],
    'exactly the three distinct types get a body mesh')
  assert.equal(mod.MESH_ASSET.walker, undefined, 'walker has no distinct mesh')
})

test('A2: finished body meshes are single unrigged meshes ~1.8 m tall', async () => {
  for (const t of ['shambler', 'screamer', 'brute']) {
    const rec = await loadMesh(t)
    let meshes = 0, skinned = 0, bones = 0
    rec.scene.traverse((o) => { if (o.isMesh) meshes++; if (o.isSkinnedMesh) skinned++; if (o.isBone) bones++ })
    assert.equal(meshes, 1, `${t}: single mesh`)
    assert.equal(skinned, 0, `${t}: unrigged (no SkinnedMesh)`)
    assert.equal(bones, 0, `${t}: no bones`)
    rec.scene.updateMatrixWorld(true)
    const bb = new THREE.Box3().setFromObject(rec.scene)
    const h = bb.max.y - bb.min.y
    assert.ok(h > 1.5 && h < 2.1, `${t}: authored height ~1.8 m (got ${h.toFixed(2)})`)
  }
})

test('A2: _attachSkinMesh swaps the primitive torso/limbs for the body mesh, keeps the head', async () => {
  const rec = await loadMesh('shambler')
  const scene = new THREE.Scene()
  const z = new Zombie(scene, 'shambler', 0, 0, 1)
  z._attachSkinMesh(rec)
  assert.ok(z._skinMesh, 'mesh body attached')
  assert.equal(z._skinMesh.root.visible, true, 'mesh body visible')
  // Torso + limbs hidden; head stays (it carries the face + is the headshot target).
  for (const i of [0, 2, 3, 4, 5]) assert.equal(z._parts[i].visible, false, `primitive part ${i} hidden`)
  assert.equal(z._parts[1].visible, true, 'head primitive stays visible')
  assert.equal(z._face.parent, z._parts[1], 'face stays on the head')
  // _parts is NOT spliced — dismemberment/flash still index it.
  assert.equal(z._parts.length, 6, 'primitive parts retained')
  // Feet land on local y 0 and the body top reaches the head.
  z.group.updateMatrixWorld(true); z._skinMesh.root.updateMatrixWorld(true)
  const bb = new THREE.Box3().setFromObject(z._skinMesh.body)
  const head = new THREE.Vector3(); z._parts[1].getWorldPosition(head)
  assert.ok(Math.abs(bb.min.y) < 0.05, `feet on the ground (${bb.min.y.toFixed(2)})`)
  // The body top must reach the head's lower region. The head is a sphere centred
  // at y 1.8 with radius ~0.13, so its bottom edge is ~1.67; the torso/neck must
  // meet it (within 0.2 m) so head + body read as one figure, not a gap.
  assert.ok(bb.max.y >= head.y - 0.2, `body top meets the head base (top ${bb.max.y.toFixed(2)}, head ${head.y.toFixed(2)})`)
  // Body material is a per-instance tinted clone (map dropped, type color).
  assert.notEqual(z._skinMesh.body.material, rec.scene.children[0].material, 'material is a per-instance clone')
  assert.equal(z._skinMesh.body.material.map, null, 'baked map dropped')
  assert.equal(z._meshRestMat, z._skinMesh.body.material, 'rest mat recorded')
})

test('A2: _applyLOD keeps the mesh-body policy even after _attachSkin re-shows primitives', async () => {
  const rig = await loadRig()
  const rec = await loadMesh('screamer')
  const scene = new THREE.Scene()
  const z = new Zombie(scene, 'screamer', 0, 0, 1)
  z._attachSkinMesh(rec)
  z._attachSkin(rig) // the rig loader re-shows every primitive part + calls _applyLOD
  // _applyLOD must re-hide the torso/limbs (no double body) and keep the mesh shown.
  z._applyLOD({ x: 2, z: 0 })
  assert.equal(z._skinMesh.root.visible, true, 'mesh body stays visible')
  for (const i of [0, 2, 3, 4, 5]) assert.equal(z._parts[i].visible, false, `primitive part ${i} re-hidden`)
  assert.equal(z._parts[1].visible, true, 'head stays visible')
  assert.equal(z._skin.root.visible, false, 'rig root stays hidden')
  // Far distance: same policy (mesh is always the visual).
  z._applyLOD({ x: 40, z: 0 })
  assert.equal(z._skinMesh.root.visible, true, 'mesh body visible beyond LOD')
  assert.equal(z._parts[0].visible, false, 'primitive torso stays hidden beyond LOD')
})

test('A2: hit-flash + death repaint the body mesh, then restore; dispose reverses', async () => {
  const rec = await loadMesh('brute')
  const scene = new THREE.Scene()
  const z = new Zombie(scene, 'brute', 0, 0, 1)
  z._attachSkinMesh(rec)
  const rest = z._meshRestMat
  // Hit flash swaps the body to HITMAT, then recovers to the rest material.
  z.damage(1)
  assert.equal(z._skinMesh.body.material, HITMAT, 'hit flash repaints the body mesh')
  for (let i = 0; i < 12; i++) z.update(1 / 60, fakePlayer(0, 0), [z], { resolve() {}, aabbs: [] }, null)
  assert.equal(z._skinMesh.body.material, rest, 'flash recovers to the rest material')
  // Death greys the body like the primitive corpse.
  z.damage(9999)
  assert.ok(z.isDead)
  assert.equal(z._skinMesh.body.material, DEADMAT, 'death repaints the body mesh')
  // dispose detaches the clone + disposes the owned material, leaving the shared
  // cache scene intact (other zombies of the type still use it).
  z.dispose()
  assert.equal(z._skinMesh, null, 'dispose clears the mesh layer')
  assert.equal(z._meshRestMat, null, 'dispose disposes the owned rest material')
  assert.ok(rec.scene, 'shared cache scene survives dispose')
})

test('A2: distinct types tint differently and brute scales larger', async () => {
  const sh = await loadMesh('shambler')
  const sc = await loadMesh('screamer')
  const br = await loadMesh('brute')
  const scene = new THREE.Scene()
  const a = new Zombie(scene, 'shambler', 0, 0, 1); a._attachSkinMesh(sh)
  const b = new Zombie(scene, 'screamer', 0, 0, 1); b._attachSkinMesh(sc)
  const c = new Zombie(scene, 'brute', 0, 0, 1); c._attachSkinMesh(br)
  assert.notEqual(a._meshRestMat.color.getHex(), b._meshRestMat.color.getHex(), 'shambler/screamer tint differently')
  assert.notEqual(b._meshRestMat.color.getHex(), c._meshRestMat.color.getHex(), 'screamer/brute tint differently')
  assert.ok(c._skinMesh.root.scale.x > a._skinMesh.root.scale.x, 'brute scaled larger')
})

test('A2: headless spawn attaches no mesh body (primitive kept)', () => {
  const scene = new THREE.Scene()
  const z = new Zombie(scene, 'shambler', 0, 0, 1)
  assert.equal(z._skinMesh, null, 'headless spawn attaches no mesh body')
  assert.ok(z._parts.every((p) => p.visible === true), 'primitives visible headless')
})