// PostFX.js - optional restrained bloom pass (V2P-10a).
// Builds an EffectComposer (RenderPass + UnrealBloomPass) only when given a
// real WebGLRenderer; with the headless StubRenderer it stays a no-op.
// No scene-graph changes, no new lights/meshes, no Math.random,
// no per-frame allocations.
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

const clamp01 = (v) => Math.min(1, Math.max(0, v))

export class PostFX {
  constructor(scene, camera, renderer, opts = {}) {
    this.scene = scene
    this.camera = camera
    this.enabled = false
    this.composer = null
    this.bloom = null
    this.strength = clamp01(Number.isFinite(opts.strength) ? opts.strength : 0.25)
    if (!(renderer instanceof THREE.WebGLRenderer)) return
    const size = renderer.getSize(new THREE.Vector2())
    this.composer = new EffectComposer(renderer)
    const renderPass = new RenderPass(scene, camera)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), this.strength, 0.5, 0.0)
    this.composer.addPass(renderPass)
    this.composer.addPass(this.bloom)
    this.enabled = true
  }

  render() {
    if (this.enabled) this.composer.render()
  }

  setStrength(v) {
    this.strength = clamp01(Number.isFinite(v) ? v : this.strength)
    if (this.bloom) this.bloom.strength = this.strength
  }

  setSize(w, h) {
    if (this.enabled) this.composer.setSize(w, h)
  }

  dispose() {
    if (this.bloom) this.bloom.dispose()
    if (this.composer) this.composer.dispose()
    this.bloom = null
    this.composer = null
    this.enabled = false
  }
}
