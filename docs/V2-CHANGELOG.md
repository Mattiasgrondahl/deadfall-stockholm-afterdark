# Version 2 — Change Log

Completed Version 2 improvements (append one entry per landed task, with commit + test evidence).

(Baseline at run start: npm test 93/93, build green, verify 81/0/0, E2E 18/18.)

## V2P-1 — Sky/horizon (commit 2b6c346, round 1)

- New `src/world/sky.js` (74 lines, GPU-1 coder): BackSide shader dome (night
  gradient zenith #04070f → horizon #0d1626 + subtle warm horizon-glow band),
  moon (MeshBasicMaterial 0xcfd8e6, fog:false) placed along Lighting.js
  MOON_OFFSET direction at 380 m, 12 silhouette boxes at radius 360–400 m
  (one shared BoxGeometry + one shared MeshBasicMaterial 0x0a0f14, fog:false,
  seeded LCG 9137, no Math.random). Headless-safe, no per-frame allocation.
- `Game.js` wiring (3 lines, GPU-0 glue): import + `new Sky(scene)` after
  WIRING:LIGHTING + per-frame `sky.update(playerPos)` after lighting.update.
- Evidence: node tools/verify-game.mjs 81 ok / 0 fail / 0 skipped (FULL
  ACCEPTANCE); npm test 93/93; headless-boot 270 meshes / 17 lights / 1 point
  (256→270, +14 sky meshes; lights unchanged; all within budgets).
- Substep V2P-1b landed in round 2 (see below).

## V2P-1b — Sky unit tests (commit 0747bbc, round 2)

- New `test/sky.test.mjs` (117 lines, GPU-1 coder, first-try success): 8 blocks —
  counts (14 meshes / 0 lights), dome (ShaderMaterial BackSide, r420, spec
  uniform colors), fog:false on moon + silhouette materials, shared
  geometry/material references across all 12 silhouettes, LCG twin-instance
  determinism (two Sky instances → identical layout within 1e-9), update math
  (dome exactly at player; moon = player + norm(-18,30,-15)·380 computed
  in-test; silhouettes do not follow the player), headless safety (no
  window/document), dispose (scene emptied + all six resources dispatch their
  dispose event, via addEventListener).
- Evidence: focused 8/8; npm test 101/101 (93+8); verify-game 81 ok / 0 fail /
  0 skipped (FULL ACCEPTANCE); npm run build green (known chunk-size warning
  only). No runtime files changed → budgets unchanged (270 meshes / 17 lights /
  1 point).
- Note: three r185's EventDispatcher exposes addEventListener (not .on); dispose
  verification uses it.

## V2P-2 — Night palette & materials (commit 0d74f83, round 3)

- Unified night palette across the city (GPU-1 coder, first-try success;
  single-subsystem spec, edit-only, 13 lines changed total):
  - `src/world/City.js`: building palette retuned to cooler, darker blue-grays
    `[0x232d3f, 0x2b364d, 0x33415c, 0x273246]`; new per-zone tint
    `TINTS = [1.12, 1.0, 0.9, 0.78]` applied by zone = max(|i−3|, |j−3|)
    (center block brightest → outskirts darkest) via
    `new THREE.Color(base).multiplyScalar(tint)`; buildings now roughness 0.88,
    metalness 0.05 (slight specular to catch streetlights); ground snow
    `0xdde4ee → 0x93a9c2` (dimmed pale blue-gray, still readable, still rough
    0.95).
  - `src/world/cityDressing.js`: pole `0x1a202c / 0.6 / 0.3` (metal glints),
    vehicle body `0x333b46 / 0.6 / 0.25`, cabin `0x3d4656 / 0.65 / 0.2`,
    wheels `0x121418 / 0.5 / 0.35`, barricade planks `0x5f4734 / 0.85 / 0`
    (weathered wood). Streetlight head emissive (`0xffb878 @ 2.5`) deliberately
    untouched — light falloff/halo is V2P-5 scope.
- Design invariant: LCG seed and call order untouched (zone computation consumes
  no `rnd()`), so city layout, plaza/quadrant pattern, and palette indices are
  byte-identical to before — only colors changed. No geometry, no AABBs, no
  new lights, no new imports; headless-safe (pure `THREE.Color` math).
- Evidence: git diff = exactly the specified hunks; npm test 101/101 (0 fail,
  0 skipped); verify-game 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE headless);
  npm run build green (known chunk-size warning only); budgets unchanged —
  270 meshes / 17 lights / 1 point at headless boot (diff adds no geometry;
  S8 budget checks pass).

## V2P-3 — Fog & atmosphere (commit b4f565f, round 4)

- Fog retune in `src/game/Game.js` L187 (`setupScene()`) — GPU-1 coder,
  first-try success, single-line spec: `FogExp2(0x0b1020, 0.032)` →
  `FogExp2(0x0b1020, 0.022)`. FogExp2 visibility = exp(−(d·ρ)²): at 0.032 a
  zombie at 30 m had ~0.40 visibility (hazy inside streetlight/flashlight
  range); at 0.022: 30 m ~0.65 (readable), 50 m ~0.30, 80 m ~0.045 (city
  depth cue preserved). Fog color kept at 0x0b1020; sky dome and silhouettes
  are fog:false, so they are unaffected by density.
- New `test/fog.test.mjs` (26 lines, 2 blocks): headless `Game({headless:true})`
  + `start()` asserts FogExp2 type, density 0.022, color 0x0b1020; second
  block pins the gates — 30 m visibility ≥ 0.60 (targets readable) and
  80 m < 0.15 (depth cue) — so future fog tuning cannot silently regress
  readability. Headless-safe, no Math.random.
- Evidence: npm test 103/103 (0 fail, 0 skipped); verify-game 81 ok / 0 fail /
  0 skipped (FULL ACCEPTANCE headless, S1–S10); npm run build green (known
  chunk-size warning only); budgets unchanged — 270 meshes / 17 lights /
  1 point (no geometry added).

## V2P-4 — Moonlight & ambient (commit 45546c8, round 5)

- Night-contrast retune in `src/world/Lighting.js` (GPU-1 coder, first-try
  success, single-file spec, edit-only, 4 lines changed + 2 added):
  - Moon key light `0.8 → 1.1 lx` (color 0x9db4ff unchanged) — raises the
    lit-vs-shadowed ratio, i.e. night contrast.
  - New shadow tuning on the only shadow caster: `moon.shadow.bias = 0.004`
    (~0.2 texel of the 44 m / 2048 px map ≈ 0.0215 m texel — kills shadow acne
    without peter-panning) and `moon.shadow.normalBias = 0.05` (lifts
    grazing-angle acne on flat ground). mapSize 2048, frustum ±22, near/far
    1/120, PCFSoft untouched — shadow-cost work deferred to V2P-6.
  - Floor lowered for contrast: hemi `0.3 → 0.22` (colors 0x1a2440 /
    0x0a0a10 unchanged), ambient `0.15 → 0.08` (color 0x141a2e unchanged);
    exposure 1.2 unchanged, so overall brightness stays roughly balanced and
    the scene stays readable.
- `test/lighting.test.mjs`: moon-intensity assertion 0.8 → 1.1 + 2 new
  assertions pinning bias 0.004 / normalBias 0.05; point-light (35 cd / 20 m /
  decay 2), exposure, setQuality, and dispose assertions untouched.
- Evidence: git diff = exactly 2 files (8 insertions, 4 deletions), nothing
  else; npm test 103/103 (0 fail, 0 skipped); verify-game 81 ok / 0 fail /
  0 skipped (FULL ACCEPTANCE headless, S1–S10); npm run build green (known
  chunk-size warning only); budgets unchanged — 270 meshes / 17 lights /
  1 point (no geometry added, no new lights).

## V2P-5 — Streetlights: falloff + warm color + halos (commit b371d25, round 6)

- Streetlight retune + cheap glow in `src/world/Lighting.js` +
  `src/world/cityDressing.js` (GPU-1 coder, first-try success,
  single-deliverable spec, edit-only, 4 files, 56 insertions / 12 deletions):
  - PointLight pool: `35 cd → 55 cd`, reach `20 m → 14 m`, color
    `0xffb878 → 0xffb066` (warmer sodium amber); decay 2 (inverse square)
    and the 12/6 nearest-anchor pool logic untouched. Pool is now hotter and
    tighter: ~13.8 at 2 m, ~1.1 at 7 m, hard cutoff at 14 m instead of
    bleeding light out to 20 m.
  - Head emissive matches the new lamp color: `0xffb878 @ 2.5 → 0xffb066 @ 3.2`
    so fixture, light, and glow read as one warm source.
  - 40 halo sprites (one per lamp head, y=5.2): one shared SpriteMaterial —
    64×64 procedural radial-gradient CanvasTexture (white → transparent,
    `document`-guarded so headless gets map=null), color 0xffb066,
    AdditiveBlending, opacity 0.5, depthWrite false, scale 2.2 m. Sprites
    billboard for free; static (no per-frame update), zero new lights, one
    material shared by all 40.
- Tests: `test/lighting.test.mjs` — existing 35 cd / 20 m assertions updated
  to 55 / 14 (same strict form; the child caught these — they predated the
  spec) + new block pinning all 12 pooled lights (0xffb066, 55 cd, 14 m,
  decay 2). `test/city.test.mjs` — new block: exactly 40 sprites sharing one
  SpriteMaterial (color/blending/depthWrite/opacity) and a head mesh with
  emissive 0xffb066 @ 3.2; existing assertions untouched.
- Evidence: npm test 105/105 (0 fail, 0 skipped); verify-game 81 ok / 0 fail /
  0 skipped (FULL ACCEPTANCE headless, S1–S10); npm run build green (known
  chunk-size warning only); budgets: sceneStats 258 → 298 meshes (258 real
  meshes + 40 sprites counted via isMesh||isSprite) ≤ 600, 17 lights ≤ 40,
  1 point ≤ 2500; no new lights, no per-frame allocation.
- Baseline correction: a worktree probe of commit 608946f (pre-change) shows
  clean headless boot = 258 meshes / 17 lights / 1 point — the "270 meshes"
  recorded in rounds 1–5 was a stale over-count. Future counts use the
  corrected 258 baseline (+40 here = 298).
- Also synced a stale Lighting.js header comment (moon "0.8 lx" → "1.1 lx",
  leftover from V2P-4).

## V2P-6a — Shadows: cost measurement (R7)

- Method: real browser (Playwright headless Chromium, SwiftShader, 1280×720)
  against the running dev server; player pinned at open street (12, y, 0),
  health pinned; per-frame cost measured inside `renderer.render` via a
  one-time wrapper (vsync-independent); 3 conditions × 3 runs, first 20
  samples/run discarded (80 frames/run, 180 effective samples/condition).
- Conditions: A = high (shadow ON, 12 point lights, 1500 snow);
  B = high with `renderer.shadowMap.enabled = false` (isolates shadow cost);
  C = `setQuality('low')` (shadow off, 6 lights, 750 snow).
- Results (render-call ms/frame, mean / median / p95):
  A 0.888 / 0.80 / 1.1 · B 0.793 / 0.70 / 1.0 · C 0.723 / 0.70 / 0.9;
  `render.calls` 106 and `render.triangles` 4128 identical in all 9 runs.
- Derived: shadow-only cost (A−B) = **0.095 ms/frame**;
  full-fallback saving (A−C) = **0.165 ms/frame**.
- KEY FINDING: the shadow pass is currently an *idle* pass — the only
  `castShadow = true` in src/ is the moon light itself (Lighting.js:31); no
  mesh ever casts, so the 2048² PCFSoft map renders nothing. Neither a 1024
  mapSize tier nor a smaller frustum changes the measured cost today.
  These numbers are a lower bound for a build that enables casters.
- Files: `tools/shadow-cost.mjs` (149 L probe), `docs/shadow-cost.md`
  (53 L findings + V6P-1 citation). No src/ changes.
- Evidence: npm test 105/105 (0 fail, 0 skipped); verify-game 81 ok / 0 fail /
  0 skipped (FULL ACCEPTANCE); budgets unchanged (298 meshes / 17 lights /
  1 point). Committed 7b3e4f2.

## V2P-6b — Shadows: real casters enabled + re-measured (commit 566e555, round 8)

- Casters enabled (4 added lines across 3 files, single GPU-1 coder, first try):
  - `src/world/City.js`: `ground.receiveShadow = true` after the ground rotation;
    `mesh.castShadow = true` inside the building factory (covers every city box).
  - `src/world/cityDressing.js`: `pole.castShadow = true` on the streetlight pole
    (lamp head / halos / vehicles / barricades untouched).
  - `src/game/Zombie.js`: `for (const p of parts) p.castShadow = true` — all six
    body meshes per zombie.
- Re-measured with `tools/shadow-cost.mjs` (child run + independent orchestrator
  re-run; 180 effective samples/condition, player pinned at (12, y, 0)):
  A (shadow ON) mean 0.994 / p95 1.2, 134 calls / 5044 tris;
  B (no shadow) 0.808 / 1.0, 106 / 4128; C (low) 0.737 / 0.9, 106 / 4128.
- Shadow-only real-caster cost (A−B): **0.186 ms/frame** (child's run 0.18 —
  stable across 3 independent runs; the idle pass measured in V2P-6a was 0.095).
  The shadow pass now does real work: +28 draw calls / +916 triangles.
- Full-fallback saving (A−C): 0.257 in the orchestrator re-run, but C ≈ B within
  0.07 ms in the other two runs — the non-shadow part of low quality saves
  ~0–0.07 ms/frame.
- 0 console/page errors; state 'playing' throughout; probe exit 0. No new
  meshes or lights; budgets unchanged (298 meshes / 17 lights / 1 point).
- Evidence: npm test 105/105 (0 fail / 0 skipped); verify-game 81 ok / 0 fail /
  0 skipped (FULL ACCEPTANCE); npm run build green (known chunk-size warning
  only).
- Decision: shadows stay ON at high quality (0.186 ms ≈ 1.1% of a 16.7 ms frame
  budget); no mapSize/frustum tier yet — see V2-DECISIONS.md.

## V2P-7 — Snow depth layers, wind drift, gusts (state at 73faccb)

- Replaced the single uniform 1500-flake Points with 3 depth layers, each its
  own THREE.Points in the same 60 m player-centered box: near 600 flakes
  (size 0.13, opacity 0.85, fall 2.6 m/s, drift 1.0 m/s), mid 550 (0.08,
  0.70, 2.0, 0.6), far 350 (0.045, 0.50, 1.4, 0.35) — near flakes read as
  large/bright/fast, far flakes as small/dim/slow, giving a real depth gradient.
- Per-flake variation from one seeded LCG stream (seed 7, unchanged): fall
  multiplier in [0.7, 1.3], wobble phase/frequency/amplitude — no Math.random.
- Deterministic global gust: g(t) ∈ [0,1] = 0.5 + 0.5·(0.65·sin(2πt/17) +
  0.35·sin(2πt/4.3 + 1.7)), a pure function of accumulated dt; modulates the
  +x drift (0.6×–2.0× of the band base), adds zero-mean ±z crosswind, and
  slows falling to ×0.7 at gust peaks (updraft feel).
- setCount scales every layer proportionally (750 → 300/275/175), so the
  Lighting low-quality 1500→750 toggle keeps working unchanged.
- Total flakes unchanged (1500 ≤ 2500 budget); +2 draw calls (1→3 Points);
  no new meshes or lights; update() allocates nothing per frame.
- Evidence: npm test 106/106 (0 fail / 0 skipped, +1 new twin-determinism
  block); verify-game 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE); npm run
  build green (known chunk-size warning only). Twin instances bit-identical
  across all 1500 flakes after 30 updates.

## V2P-8 — Firing feel: muzzle flash upgrade + camera pitch kick (commit 9975622, round 10)

- Muzzle flash (Shotgun.js): flat opaque 0.3 m quad → additive-blend
  THREE.Sprite with a procedural 64×64 radial-glow CanvasTexture
  (255,220,160 → transparent), document-guarded (map null headless,
  same pattern as cityDressing halos), depthTest/depthWrite off so it is
  never clipped by the barrel. Fade: opacity 0.9→0, scale 0.3→0.1,
  light intensity 500→0 all linear over FLASH_TIME (0.05 → 0.07 s),
  instead of the old constant-on-then-snap-off. shoot() resets to full
  state so a render between shoot() and the next update sees a full flash.
- Camera pitch kick: new Player.addPitchKick(a) (cap 0.03 rad), decayed
  at 0.15 rad/s in Player.update and added to camera.rotation.x
  (which Player writes every frame, so the kick lives on the Player, not
  the weapon). Shotgun 0.018 rad (~0.12 s), axe 0.008 rad (~0.05 s).
  Kick call sites are typeof-guarded so existing fake-player tests
  (plain objects without the method) keep passing.
- Dispose fix: Sprite has no .geometry, so the Shotgun.dispose() child
  loop skipped it — material + texture now disposed explicitly.
- No new lights (the existing pooled flashLight is reused), no Game.js
  wiring (Player.update already runs every frame before weapon.update),
  no Math.random, no per-frame allocations.
- Tests: +1 shotgun block (Sprite type, additive blend, fade to 0,
  map null headless, kick 0.018→0 via player.update) +1 player block
  (apply/decay/cap/reset).
- Tracer (explicitly optional in the plan) deferred — revisit after V6P-1
  if perf headroom shows.
- Evidence: npm test 107/107 (0 fail / 0 skipped); verify-game 81 ok /
  0 fail / 0 skipped (FULL ACCEPTANCE); npm run build green (known
  chunk-size warning only). Budgets: 257 meshes + 41 sprites = 298
  (≤ 600; exact delta −1 mesh / +1 sprite) / 17 lights (≤ 40) / 3 Points
  (≤ 2500), independently re-probed headless.
