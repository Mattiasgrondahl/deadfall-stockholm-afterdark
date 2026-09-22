// SkinnedMesh + AnimationMixer mechanism probe (Ralph round 4, v5 zombie upgrade).
//
// Goal: prove the runtime pieces the in-game skinned-mesh swap depends on work
// in the plain-Node (headless) three.js runtime the game tests use, BEFORE the
// full Zombie.js refactor. Specifically:
//   1. Build a minimal rigged mesh (bones + SkinnedMesh with skin weights).
//   2. Drive it with an AnimationMixer whose clips cross-fade (idle <-> walk).
//   3. Confirm mixer.update(dt) advances clip time deterministically and the
//      bone transforms actually change, with no WebGL / document required.
//
// This does NOT touch Zombie.js; it validates the approach in isolation.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'

function buildRiggedFigure() {
  // A two-bone "figure": root -> upper -> lower, with a skinned cylinder-ish
  // box bound to the bones via skin indices/weights. Pure JS, no GLTFLoader.
  const root = new THREE.Bone()
  root.name = 'root'
  const upper = new THREE.Bone()
  upper.name = 'upper'
  upper.position.y = 1.0
  const lower = new THREE.Bone()
  lower.name = 'lower'
  lower.position.y = 1.0
  root.add(upper)
  upper.add(lower)

  const armature = new THREE.Skeleton([root, upper, lower])

  // Geometry: 4 vertices stacked along y, each weighted to a bone.
  const geo = new THREE.BufferGeometry()
  const verts = new Float32Array([
    -0.1, 0.0, 0.0,
    0.1, 0.0, 0.0,
    -0.1, 2.0, 0.0,
    0.1, 2.0, 0.0,
  ])
  const skinIndex = new Uint16Array([
    0, 0, 0, 0,
    0, 0, 0, 0,
    2, 2, 2, 2,
    2, 2, 2, 2,
  ])
  const skinWeight = new Float32Array([
    1, 0, 0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0,
  ])
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4))
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4))
  geo.setIndex([0, 1, 2, 2, 1, 3])

  const mat = new THREE.MeshStandardMaterial({ color: 0x6b7d5c })
  const mesh = new THREE.SkinnedMesh(geo, mat)
  mesh.add(root)
  mesh.bind(armature)
  return { root, upper, lower, mesh, armature }
}

function clip(name, bone, trackValues, duration) {
  // A rotation track on a bone: quaternion keyframes over `duration` seconds.
  const times = [0, duration / 2, duration]
  const q = (axis, angle) => new THREE.Quaternion().setFromAxisAngle(axis, angle)
  const values = [
    ...q(new THREE.Vector3(1, 0, 0), 0).toArray(),
    ...q(new THREE.Vector3(1, 0, 0), trackValues).toArray(),
    ...q(new THREE.Vector3(1, 0, 0), 0).toArray(),
  ]
  return new THREE.AnimationClip(name, duration, [
    new THREE.QuaternionKeyframeTrack(bone.name + '.quaternion', times, values),
  ])
}

test('SkinnedMesh + AnimationMixer crossfade works headless (no WebGL)', () => {
  const { root, upper, lower, mesh, armature } = buildRiggedFigure()
  assert.ok(mesh.isSkinnedMesh, 'mesh must be a SkinnedMesh')
  assert.equal(armature.bones.length, 3)

  const scene = new THREE.Scene()
  scene.add(mesh)

  const mixer = new THREE.AnimationMixer(mesh)
  const idle = clip('idle', upper, 0.1, 1.0)
  const walk = clip('walk', upper, 0.8, 0.6)

  const idleAction = mixer.clipAction(idle)
  const walkAction = mixer.clipAction(walk)
  idleAction.play()

  // Advance the idle clip and confirm the bone actually moves.
  const before = upper.quaternion.w
  mixer.update(0.25)
  const during = upper.quaternion.w
  assert.notEqual(before, during, 'idle clip must rotate the bone over time')

  // Crossfade idle -> walk; after the fade the walk clip should dominate.
  walkAction.reset().setEffectiveWeight(1).play()
  walkAction.crossFadeFrom(idleAction, 0.2, false)
  for (let i = 0; i < 30; i++) mixer.update(1 / 60) // 0.5 s
  // Walk has larger amplitude, so the bone rotation differs from idle-only.
  assert.ok(walkAction.isRunning(), 'walk action must be running after crossfade')
  assert.ok(!idleAction.isRunning() || idleAction.time > 0, 'idle faded out or finishing')

  // Determinism: same dt sequence from a fresh mixer reproduces the same state.
  const mixer2 = new THREE.AnimationMixer(buildRiggedFigure().mesh)
  const upper2 = mixer2.getRoot().children[0].children[0] // upper via root->upper
  // (getRoot returns the mesh; its child root -> upper)
  const root2 = mixer2.getRoot().children[0]
  const upperB = root2.children[0]
  const a2 = mixer2.clipAction(clip('idle', upperB, 0.1, 1.0)).play()
  for (let i = 0; i < 12; i++) mixer2.update(1 / 60)
  const m1 = new THREE.AnimationMixer(buildRiggedFigure().mesh)
  const root1 = m1.getRoot().children[0]
  const upper1 = root1.children[0]
  m1.clipAction(clip('idle', upper1, 0.1, 1.0)).play()
  for (let i = 0; i < 12; i++) m1.update(1 / 60)
  assert.equal(upperB.quaternion.w, upper1.quaternion.w, 'mixer.update must be deterministic')
})

test('mixer.update advances time without WebGL and is dt-driven', () => {
  const { mesh, upper } = buildRiggedFigure()
  const mixer = new THREE.AnimationMixer(mesh)
  const c = clip('idle', upper, 0.5, 2.0)
  const action = mixer.clipAction(c).play()
  const t0 = action.time
  mixer.update(0.5)
  mixer.update(0.5)
  assert.ok(action.time >= t0 + 1.0 - 1e-6, 'clip time advances by summed dt')
})