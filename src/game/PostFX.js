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
//
// V6 visuals (4) — restrained bloom, measured rather than guessed.
// Round 41 raised moon 1.1→1.45, hemi 0.22→0.30, ambient 0.08→0.12 and
// streetlight pools 55→70 cd; the review asked item (4) to re-measure the
// halos that growth produced. The gate that matters is NOT the raw HDR value:
// Lighting.js sets renderer.toneMapping = ACESFilmic with exposure 1.2, so
// every fragment is tone-mapped before UnrealBloomPass.highPass tests it
// (highPass keeps a fragment when dot(c, (0.2126, 0.7152, 0.0722)) >
// threshold − 0.004, on the already-tonemapped buffer). Evaluating that curve
// (x' = min(1, x(2.51x+0.03) / (x(2.43x+0.59)+0.14)), x = lin·1.2) against the
// pinned emissive colors gives the source table used by test/postfx.test.mjs:
//   lamp 0xffb066×2.2 → lin 1.172 → 0.867    spire 0xffc878×2.0 → 0.880
//   beacon 0xff4433×2.0 → 0.681              plaza panel 0xffd9a5×2.0 → 0.900
//   facade window 0xffa64d×1.5 → 0.776
// while a *lit* surface (moon 1.45 / 70 cd pool / hemi 0.30 / ambient 0.12 on
// stone, snow and facades) sits at 0.50–0.72 after tonemap. Pinning threshold
// 0.72 therefore cuts above the lit ground/wall band and below every emissive
// source (≥ 0.681), i.e. only real light sources bloom — the old threshold 0.0
// bloomed the entire brightened night scene. radius 0.5→0.35: mip k is spread
// by 0.5·radius·(2^k−1), so the outermost mip (k=5) reached 15.5 screen units
// past a source at 0.5 and reaches 10.9 at 0.35 — halos stop smearing the
// silhouette. strength 0.25→0.18: with the scene excluded, only the sources
// are amplified, and the additive halos (round 44 cut their opacity + scale in
// src/world/cityDressing.js) already carry the perceived glow. Zombies stay
// clean: body emissive 0x401018×0.5 tonemaps to 0.003, hit flash 0x661111 to
// 0.030 — two orders under the cut, so no zombie ever blooms. Quality tiers:
// high 0.18 / medium 0.12 / low 0.08 via setTier; every tier stays gated by
// setEnabled(quality === 'high') in Game.js, so low/medium remain the cheap
// no-composer fallback.
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'

const clamp01 = (v) => Math.min(1, Math.max(0, v))

// V6 visuals (4): bloom parameters, one source of truth. `threshold` is the
// luminance cut UnrealBloomPass.highPass applies to the ACES-tonemapped buffer
// — 0.72 sits above the lit ground/wall band (0.50–0.72) and below every
// emissive source (≥ 0.681), so only real light sources bloom. `radius` sets
// halo spread per mip (0.5·radius·(2^k−1) total reach). `strength` is the
// composite weight.
const BLOOM = { strength: 0.18, radius: 0.35, threshold: 0.72 }

// Quality-tier bloom strength. Post is still gated off entirely for low/medium
// (Game.js: setEnabled(s.quality === 'high')), so these are the values the
// enabled path would use if a tier ever turns it on — medium is a restrained
// half-step down, low is near-flat. The cheap fallback stays cheap: no
// composer render at all when disabled.
const BLOOM_TIERS = { high: 0.18, medium: 0.12, low: 0.08 }

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
    this.gtao = null
    this.strength = clamp01(Number.isFinite(opts.strength) ? opts.strength : BLOOM.strength)
    if (!(renderer instanceof THREE.WebGLRenderer)) return
    const size = renderer.getSize(new THREE.Vector2())
    this.composer = new EffectComposer(renderer)
    const renderPass = new RenderPass(scene, camera)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), this.strength, BLOOM.radius, BLOOM.threshold)
    // Grounding AO (graphics tier 3): GTAO darkens corners, wall/floor junctions
    // and the crevices behind props so the flat-lit scene reads with depth. It
    // runs right after RenderPass and BEFORE grade + bloom, compositing AO onto
    // the beauty buffer (output=Default) while keeping bloom as the final
    // on-screen pass. blendIntensity is kept low (0.5) so it stays subtle.
    this.gtao = new GTAOPass(scene, camera, size.x, size.y)
    this.gtao.output = 0 // Default: beauty + AO blended
    this.gtao.blendIntensity = 0.5
    // Grade pass BEFORE bloom: grain + vignette tint the scene, then bloom is
    // the LAST enabled pass so it renders straight to the screen (the composer
    // auto-sets renderToScreen on the last enabled pass). This preserves the
    // baseline's brightness and edge detail that a post-bloom ShaderPass would
    // otherwise lose on the RT->screen re-encode.
    this.grade = new ShaderPass(GRADE_SHADER)
    this._grainAmount = this.grade.uniforms && this.grade.uniforms.uGrain ? this.grade.uniforms.uGrain.value : 0
    this.composer.addPass(renderPass)
    this.composer.addPass(this.gtao)
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

  /**
   * V6 visuals (4): pick the bloom strength for a quality tier. The composer
   * itself stays gated by setEnabled (low/medium render no post at all), so
   * this only tunes the enabled path; it never turns post on by itself.
   */
  setTier(q) {
    const tier = q === 'low' ? 'low' : q === 'medium' ? 'medium' : 'high'
    this.setStrength(BLOOM_TIERS[tier])
    return tier
  }

  /** Full on/off for the whole composer (quality tiers: low skips post). */
  setEnabled(on) {
    if (!this.composer) return
    this.enabled = !!on
  }

  /** Film grain on/off (reduced motion disables the animated grain). */
  setGrainEnabled(on) {
    if (this.grade && this.grade.uniforms && this.grade.uniforms.uGrain) {
      this.grade.uniforms.uGrain.value = on ? this._grainAmount : 0
    }
  }

  setSize(w, h) {
    if (this.enabled) {
      this.composer.setSize(w, h)
      if (this.gtao) this.gtao.setSize(w, h)
    }
  }

  dispose() {
    if (this.bloom) this.bloom.dispose()
    if (this.grade) this.grade.dispose()
    if (this.gtao) this.gtao.dispose()
    if (this.composer) this.composer.dispose()
    this.bloom = null
    this.grade = null
    this.gtao = null
    this.composer = null
    this.enabled = false
  }
}