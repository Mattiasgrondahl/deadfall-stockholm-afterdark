// GLTFLoader → SkinnedMesh + AnimationMixer probe (Ralph round 4, v5 zombie).
//
// Parses the rigged walker GLB from bytes (no fetch / no WebGL) and asserts the
// loaded scene is a skinned mesh with drivable animation clips — the exact
// pieces the in-game Zombie.js skinned-mesh swap depends on. Proves the asset
// is loadable in the headless three.js runtime before the full refactor.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// GLTFLoader decodes embedded textures through browser globals (self/Image/
// createImageBitmap). Headless Node has none, so the image decode path throws.
// The asset's textures are irrelevant to this probe (we test skin + clips), so
// shim a minimal self that yields a blank image and let the parse finish.
if (typeof globalThis.self === 'undefined') {
  globalThis.self = {
    Image: class { set src(_v) {} onload = null; onerror = null },
    createImageBitmap: async () => ({ close() {}, width: 1, height: 1 }),
  }
}

function parseGLB(buffer) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', (gltf) => resolve(gltf), reject)
  })
}

test('rigged walker GLB loads as a SkinnedMesh with drivable clips', async () => {
  const buf = readFileSync(new URL('../public/assets/zombies/walker-final.glb', import.meta.url))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const gltf = await parseGLB(ab)
  // Find the skinned mesh in the loaded scene.
  let skinned = null
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !skinned) skinned = o })
  assert.ok(skinned, 'GLB must contain a SkinnedMesh')
  assert.ok(skinned.skeleton && skinned.skeleton.bones.length > 10, 'skeleton must have bones')
  // The v5 pipeline must bake UVs onto the retopo'd mesh: TEXCOORD_0 present.
  assert.ok(skinned.geometry.getAttribute('uv'), 'skinned mesh must carry UVs (TEXCOORD_0)')
  // The baked base-color + metallic-roughness textures are wired into the
  // material (asserted from the GLB JSON, since headless image decode is a stub).
  const dv = new DataView(ab)
  const jsonLen = dv.getUint32(12, true)
  const json = JSON.parse(Buffer.from(ab.slice(20, 20 + jsonLen)).toString('utf-8'))
  const pbr = (json.materials[0] || {}).pbrMetallicRoughness || {}
  assert.ok(pbr.baseColorTexture, 'material must wire a baked base-color texture')
  assert.ok(pbr.metallicRoughnessTexture, 'material must wire a baked metallic-roughness texture')

  // Clips: at least the core locomotion/attack/death set the plan requires.
  const names = gltf.animations.map((c) => c.name)
  for (const need of ['Idle', 'Walking', 'Running', 'Death']) {
    assert.ok(names.includes(need), `missing clip ${need}`)
  }

  // Drive it: a mixer over the scene can play Idle, then crossfade to Walking,
  // and the bones actually move — all headless, no WebGL.
  const mixer = new THREE.AnimationMixer(gltf.scene)
  const idle = mixer.clipAction(gltf.animations.find((c) => c.name === 'Idle')).play()
  const walk = mixer.clipAction(gltf.animations.find((c) => c.name === 'Walking'))
  // Pick a bone the Walking clip animates (track names match bone names 1:1).
  const qbones = walk._clip.tracks.filter((t) => t.name.endsWith('.quaternion')).map((t) => t.name.replace('.quaternion', ''))
  const bone = skinned.skeleton.bones.find((b) => b.name === 'UpperLegL') ||
    skinned.skeleton.bones.find((b) => qbones.includes(b.name) && b.name !== 'Bone')
  assert.ok(bone, 'must find an animated limb bone')
  const q0 = bone.quaternion.clone()
  mixer.update(0.1)
  mixer.update(0.1)
  mixer.update(0.1)
  const moved = Math.abs(bone.quaternion.x - q0.x) + Math.abs(bone.quaternion.y - q0.y) +
    Math.abs(bone.quaternion.z - q0.z) + Math.abs(bone.quaternion.w - q0.w)
  assert.ok(moved > 1e-4, `bones must move under the mixer (delta ${moved})`)
  walk.reset().setEffectiveWeight(1).play()
  walk.crossFadeFrom(idle, 0.2, false)
  for (let i = 0; i < 30; i++) mixer.update(1 / 60)
  assert.ok(walk.isRunning(), 'walk clip must run after crossfade')
})