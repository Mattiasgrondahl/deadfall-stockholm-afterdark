// PostFX.js - restrained bloom (V2P-10a) + a film grade pass (V3P-10).
// Builds an EffectComposer (RenderPass + grade ShaderPass + UnrealBloomPass)
// only when given a real WebGLRenderer; with the headless StubRenderer it
// stays a no-op. No scene-graph changes, no new lights/meshes, no
// Math.random, no per-frame allocations.
//
// PASS ORDER (V3P-10 fix): RenderPass -> grade -> bloom. The grade pass runs
// BEFORE bloom, not after. Why: the baseline look comes from the bloom pass
// being the final pass (renderToScreen), which writes the scene + bloom halo
// straight to the canvas through three's output color-space conversion. When a
// ShaderPass is appended AFTER bloom, the bloom result is read back out of an
// offscreen RT and re-encoded, which loses ~17 meanY and ~230 detail units
// (measured against the committed baseline). Running the grade BEFORE bloom
// keeps bloom as the final on-screen pass, so the calibrated brightness and
// edge detail survive intact, while grain + vignette still tint the image.
//
// The grade pass therefore applies only: (1) animated film grain (per-pixel
// hash, 24 fps reseed — in-game flicker, deterministic in spirit: pure function
// of time and pixel position), (2) a soft vignette. No ACES, no shadow lift,
// no saturation/contrast math — those brighten the pre-bloom buffer and the
// bloom then over-amplifies them, blowing out meanY.
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

const clamp01 = (v) => Math.min(1, Math.max(0, v))

const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.012 },       // grain amplitude (fraction of full scale)
    uVignette: { value: 0.05 }      // corner darkening (0 = none)
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // Film grain: per-pixel hash, reseeded ~24x per second so it flickers
      // like film, but stays a pure function of (pixel, time).
      float seed = floor(uTime * 24.0);
      float h = fract(sin(dot(gl_FragCoord.xy + seed * 127.3, vec2(12.9898, 78.233))) * 43758.5453);
      c += (h - 0.5) * uGrain;
      // Vignette: centered, quadratic fall-off to the corners.
      vec2 p = vUv - 0.5;
      c *= 1.0 - uVignette * pow(length(p) * 1.35, 2.0);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `
}

export class PostFX {
  constructor(scene, camera, renderer, opts = {}) {
    this.scene = scene
    this.camera = camera
    this.enabled = false
    this.composer = null
    this.bloom = null
    this.grade = null
    this.strength = clamp01(Number.isFinite(opts.strength) ? opts.strength : 0.25)
    if (!(renderer instanceof THREE.WebGLRenderer)) return
    const size = renderer.getSize(new THREE.Vector2())
    this.composer = new EffectComposer(renderer)
    const renderPass = new RenderPass(scene, camera)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), this.strength, 0.5, 0.0)
    // Grade pass BEFORE bloom: grain + vignette tint the scene, then bloom is
    // the LAST enabled pass so it renders straight to the screen (the composer
    // auto-sets renderToScreen on the last enabled pass). This preserves the
    // baseline's brightness and edge detail that a post-bloom ShaderPass would
    // otherwise lose on the RT->screen re-encode.
    this.grade = new ShaderPass(GRADE_SHADER)
    this.composer.addPass(renderPass)
    this.composer.addPass(this.grade)
    this.composer.addPass(this.bloom)
    this.enabled = true
  }

  render() {
    if (this.enabled) {
      this.grade.uniforms.uTime.value = performance.now() / 1000
      this.composer.render()
    }
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
    if (this.grade) this.grade.dispose()
    if (this.composer) this.composer.dispose()
    this.bloom = null
    this.grade = null
    this.composer = null
    this.enabled = false
  }
}