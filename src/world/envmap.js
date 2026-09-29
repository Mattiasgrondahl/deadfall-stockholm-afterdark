// Deadfall: Stockholm Afterdark — IBL environment map baked from the game's own sky.
// Renders the sky (gradient dome + moon + city silhouettes) into a cube render
// target — tone mapping OFF, so the PMREM input stays linear radiance — then
// prefilters it with PMREMGenerator and assigns the result to scene.environment.
// The dome shader is view-relative (object-space), so a bake from a camera at
// the origin matches what the player actually sees at any position.
//
// Cost: one-shot at world init (6 cube-face renders + PMREM prefilter, a few
// milliseconds); zero per-frame cost, no extra scene objects, no Math.random,
// headless-safe (no-op without a WebGLRenderer). Memory: one 256² x 6 cube RT
// (freed after the bake) + the PMREM output texture (shared by all materials).

import * as THREE from 'three'

export function bakeSkyEnvironment(renderer, sky, scene, opts = {}) {
  if (!renderer || !(renderer instanceof THREE.WebGLRenderer)) return null
  const size = Number.isFinite(opts.size) ? Math.floor(opts.size) : 256
  const intensity = Number.isFinite(opts.intensity) ? opts.intensity : 0.5

  // Temp scene reusing the LIVE sky geometry/materials (shared resources are
  // never disposed here; the live sky keeps them). Positions copied so the
  // bake sees the sky from the origin, exactly as the player's camera does.
  const temp = new THREE.Scene()
  const dome = new THREE.Mesh(sky.domeGeo, sky.domeMat)
  const moon = new THREE.Mesh(sky.moonGeo, sky.moonMat)
  moon.position.copy(sky.moonDir).multiplyScalar(380)
  temp.add(dome, moon)
  for (const m of sky.silhouettes) {
    const c = new THREE.Mesh(m.geometry, m.material)
    c.position.copy(m.position)
    c.scale.copy(m.scale)
    temp.add(c)
  }

  const cubeRT = new THREE.WebGLCubeRenderTarget(size, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter
  })
  const cubeCam = new THREE.CubeCamera(0.1, 1000, cubeRT)

  // The cube render must produce linear radiance. Material shaders apply tone
  // mapping AFTER summing direct + IBL light, so a pre-tonemapped IBL would be
  // double-compressed (and would wash out the ambient contribution). Save the
  // renderer's tone mapping, bake with it off, restore.
  const savedToneMapping = renderer.toneMapping
  const savedExposure = renderer.toneMappingExposure
  renderer.toneMapping = THREE.NoToneMapping
  try {
    cubeCam.update(renderer, temp)
  } finally {
    renderer.setRenderTarget(null)
    renderer.toneMapping = savedToneMapping
    renderer.toneMappingExposure = savedExposure
  }

  const pmrem = new THREE.PMREMGenerator(renderer)
  const envRT = pmrem.fromCubemap(cubeRT.texture)
  pmrem.dispose()
  cubeRT.dispose()

  scene.environment = envRT.texture
  scene.environmentIntensity = intensity
  return envRT
}
