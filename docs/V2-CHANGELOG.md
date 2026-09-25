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

## V2P-9 — City readability: landmark beacons + street directionality (commit 13bc3b8, round 11)

- Readability composition per the plan: one primary landmark + secondary
  landmarks + direction cues, all pure emissive/geometry — no new lights,
  no collision AABBs, no Math.random.
- Center spire: 0.6×6×0.6 box on the center-tower roof (position
  (0,12,0), roof y=9 → top y=15), MeshStandardMaterial emissive 0xffc878
  @ 2.5 (warm amber, echoing the streetlight color), castShadow, plus a
  3 m additive halo sprite at (0,15,0). The center tower is the one
  always-present structure in the city, so it is a reliable orientation
  point from anywhere in the play area.
- 4 corner beacons: 0.6×7×0.6 boxes at (±84, 3.5, ±84), emissive
  0xff4433 @ 2.0 (red = caution), + 2.4 m halos at (±84, 7, ±84). The
  beacons sit 1 m from the diagonal wave-spawn points (±85, ±85), so red
  beacons at the world edge mark where waves come from. |coord| > 79.5 is
  always free (block built extent ≤ 7.0 from block center), so placement
  can never collide with LCG-placed buildings.
- 10 street directionality strips: 0.35×0.05×176 boxes along the five
  street center lines per axis ({±12, ±36, ±60}), MeshBasicMaterial
  0x3d6fa8 (cool blue, restrained), at y=0.03 (3 cm above the ground
  plane, no z-fighting), castShadow false. Center lines are always
  walkable (existing "street center lines clear" test covers them); no
  AABBs added, so collision and verifier behavior is unchanged.
- Refactor: the inline 64×64 radial-glow canvas in addStreetlights is
  extracted into an exported makeGlowMap() (document-guarded, null in
  headless), shared by the streetlight, spire, and beacon halo materials.
- City.js: 2 lines — addLandmarks added to the import, called after
  addBarricades.
- Tests: halo test re-scoped to sprites with material color 0xffb066
  (still 40, one shared SpriteMaterial); new block asserting 1 spire
  (position / intensity / castShadow), 4 beacons (exact positions, no
  duplicates), 10 strips (y=0.03), 5 halos (positions), and aabbs still
  exactly 87.
- Evidence: npm test 108/108 (0 fail / 0 skipped); verify-game 81 ok /
  0 fail / 0 skipped (FULL ACCEPTANCE S1–S10); npm run build green
  (known chunk-size warning only). Budgets (independent headless-boot
  probe): 272 meshes + 46 sprites = 318 ≤ 600 / 17 lights ≤ 40 / 3 Points
  ≤ 2500 — exact delta +15 meshes / +5 sprites vs the 257/41 baseline,
  zero new lights.

## V3P-1a — Plaza vs street lighting language (commit b4fda3d, round 13)

- Safe-vs-danger visual language, first half: open plazas read as safe/lit
  gathering areas against streetlight-lit streets and unlit alleys — pure
  emissive glow, no new PointLights (GPU-1 coder, first-try success, 1
  documented deviation: the new test block builds its own City instance
  because the final pre-existing block disposes the shared one, matching the
  snow-gust test pattern).
- `src/world/cityDressing.js` (+13 L): `addPlazaHalos(group, centers)` — one
  shared SpriteMaterial (0xffd9a5, opacity 0.35, AdditiveBlending,
  depthWrite false, map from the shared document-guarded makeGlowMap), one
  sprite per plaza center at y=0.5, scale (6, 6, 1). Color 0xffd9a5 is a
  pale amber deliberately distinct from streetlight 0xffb066, spire
  0xffc878, and beacon 0xff4433, so the V2P-9 color language stays coherent
  (amber = safe open space) and the color-filtered test assertions keep
  passing.
- `src/world/City.js` (+4 L): plaza centers collected at layout time — the
  `rnd() < 0.4` branch now pushes {x, z} to `plazas` before continuing (the
  push consumes no LCG draw, so the city layout is byte-identical);
  `addPlazaHalos(group, plazas)` + `this.plazas` after addLandmarks;
  `getPlazaCenters()` getter (available to V3P-1b signage and HUD work).
- Determinism: the plaza set is LCG-fixed (seed 7). A Node replay of the
  exact draw order (center-building palette draw; 1 draw per block; 1+2 per
  quadrant if built) yields exactly 22 plazas, cross-validated against the
  87-AABB ground truth (1 center + 66 quadrant + 12 vehicle + 8 barricade).
- Tests: `test/city.test.mjs` +1 block — 22 halos, one shared material,
  every halo at a getPlazaCenters() entry (y=0.5, scale 6), 87 aabbs
  unchanged, 67 total sprites in the city group.
- Evidence: focused 16/16; npm test 109/109 (0 fail / 0 skipped);
  verify-game 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE); npm run build
  green (known chunk-size warning only). Budgets: 272 meshes + 68 sprites =
  340 ≤ 600 / 17 lights ≤ 40 / 3 Points ≤ 2500 — exact delta +22 sprites,
  zero new meshes/lights/aabbs.

## V3P-1b — Signage + unlit-corridor marking (commit 9cb6812, round 14)

Completes V3P-1 (safe-vs-dangerous visual language): the poleless central
cross is marked as a danger corridor, plazas are marked safe with signage.

- `src/world/cityDressing.js` (+38 L): `addDangerStrips(group)` — 4 red
  (0xff4433) MeshBasicMaterial ground strips on the unlit central cross:
  two segments along the x=0 street (BoxGeometry(0.35,0.05,76.5) @
  (0,0.09,±41.25), covering z∈[3,79.5] ∪ [-79.5,-3]) and two along the z=0
  street (BoxGeometry(74.5,0.05,0.35) @ (±42.25,0.09,0), covering
  x∈[5,79.5] ∪ [-79.5,-5]). y=0.09 (blue directional strips occupy
  0.005..0.055, so no coplanar overlap at crossings); 1 m clearance around
  the center tower (footprint x∈[-4,4], z∈[-2,2]); one shared material, two
  shared geometries; castShadow=false; no aabbs/lights/sprites.
  `addSigns(group, centers)` — one post + panel per plaza center (22):
  post BoxGeometry(0.12,1.6,0.12) @ y=0.8 (0x1a202a, same values as the
  streetlight pole material), panel BoxGeometry(0.9,0.6,0.1) @ y=1.7
  (base 0x14161c, emissive 0xffd9a5 @ 2.0 — amber = safe, same as the plaza
  halos), shared geometry/material; no halo (ground halo already present);
  no aabbs; castShadow=false.
- `src/world/City.js` (+2 L): import extended + `addDangerStrips(group)` /
  `addSigns(group, plazas)` after addPlazaHalos; LCG layout untouched.
- `test/city.test.mjs` (+48 L): +1 block (focused 17/17): 4 strips at the
  exact positions / 1 shared material / 2 shared geometries; 22 panels @
  y=1.7 emissive 2.0 at plaza centers, 1 shared geometry+material; 22 posts
  @ y=0.8 at plaza centers, 1 shared material; 87 aabbs; 67 city-group
  sprites; city meshes ≤ 600.
- Evidence: npm test 110/110 (0 fail / 0 skipped — node:test counts each
  test() block individually, so the new block adds 1 to the total; corrects
  the round-10 note); verify-game 81 ok / 0 fail / 0 skipped (FULL
  ACCEPTANCE); npm run build green (known chunk-size warning only); E2E
  18/18 PASS, 0 console/page errors (dev :5173 + .browsers/chromium with
  PLAYWRIGHT_BROWSERS_PATH set). Budgets: city group 272 → 320 meshes
  (+48), +0 sprites/lights/aabbs; S8 scene stats 380 meshes + 68 sprites =
  448 ≤ 600, 17 lights ≤ 40, 3 Points ≤ 2500.

## V3P-2 — Zombie eye glow (commit 5d63fad, round 15)

- Eye glow for visibility: two small unlit MeshBasicMaterial boxes nested under each zombie's head mesh at local (±0.075, 0.03, 0.14) — local +z faces the player (group.rotation.y = atan2(dx, dz)), front face protrudes ~0.01 m past the head face for all three head scales (walker ×1, shambler ×0.9, screamer ×1.15). Per-type shared material EYEMAT (walker 0x8aff5e green / shambler 0xd0ff4f yellow-green / screamer 0xff3b2e red), one shared EYE box geometry; on fatal damage both eyes dim to shared DEADEYEMAT 0x2a2a2a so corpses do not glow.
- Nesting under the head (not the group) preserves the load-bearing 6-child body invariant and every existing test (group.children.length === 6); eyes are not in _parts so hit-flash/death material swaps never touch them; getHitboxes() byte-identical — hit detection untouched.
- Budgets: +2 eye meshes per zombie; 10-zombie (wave 3) S8 scene = 400 meshes + 68 sprites = 468 ≤ 600 (+20 over the 380 baseline); 0 lights, 0 sprites, 0 points added. npm test 111/111, verify 81/0/0, build green.

## V3P-3 — Fog-vs-targets sight check (commit 63cfa17, round 16)

- Headless sight check (tools/fog-sight.mjs, 75 L): boots the real Game headless (same pattern as verify-game.mjs), reads live scene.fog = FogExp2(0x0b1020, 0.022) from Game.js L187, evaluates visibility V(d) = exp(−(dρ)²) for every V2 target class. Grades: clear ≥ 0.5, marginal 0.2–0.5, faint < 0.2.
- Results: zombie eye glow clear at every combat distance (0.996 @ 3 m → 0.647 @ 30 m); streetlight halos clear across their 5–14 m reach (0.99–0.91); plaza halos + signage clear 10–30 m, marginal (0.461) at 40 m; central spire same; blue street strips clear ≤ 30 m, marginal @ 40 m, faint @ 60 m; corner beacons clear only within ~35 m (V(118.7 m) = 0.0011 from city center).
- VERDICT: PASS — no tuning needed. Corner-beacon faintness at range is structural: test/fog.test.mjs gates confine ρ to [0.01722, 0.02382], and beacon visibility across that whole range is faint (0.0003–0.0154, >30× below marginal) — no density change can make beacons legible from the center. They are local spawn-zone caution markers (spawns at ±85, ±85, legible within ~35 m). If center-visible beacons were ever wanted, that is a budget-neutral halo-scale/emissive follow-up in cityDressing (V3P-4 territory), not a fog change.
- E2E sanity walk: 18/18 PASS, 0 console errors, 0 page errors (dev :5173, .browsers/chromium-1243, PLAYWRIGHT_BROWSERS_PATH set). No src changes → npm test 111/111, verify 81/0/0, build green stand; budgets unchanged (320 meshes + 68 sprites / 17 lights / 3 points).

## V3P-4 — Street directionality: outer caution strips (commit b44ee9b, round 17)

- Marked the unlit outer end segments of all ten poled street lines (center lines {±12, ±36, ±60} in both axes) with red 0xff4433 MeshBasicMaterial ground strips — the same caution language as the V3P-1b danger cross. Streetlight poles exist only at axis coordinates ±24/±60, so each line's segments from |coord| = 60 to the city edge 79.5 (19.5 m per end, 20 strips total) carry no streetlight at all. Strips: y = 0.09 (0.01 m above the blue directionality strips top at 0.055, so they layer cleanly at crossings), 0.35 m wide, castShadow false, one shared material + one shared geometry per orientation. No lights, no AABBs, no sprites, no Math.random.
- City.js wiring: import + call immediately after addDangerStrips (LCG/layout untouched → city layout byte-identical). test/city.test.mjs: the V3P-1b block now asserts 24 red strips total (the 4 central-cross strips keep their exact-position check via a max-coord ≤ 45 filter) and a new V3P-4 block pins all 20 outer centers, y/castShadow, the shared material, 87 aabbs, and 67 sprites.
- Remaining plan-line items disposed: lamp alignment — poles are already uniformly 4.2 m off the center lines at spacing −60/−24/24/60; no change needed. Vehicle placement — already swept and fixed in 8b-2d (centerline-straddling cars repositioned); no change. Corner-beacon halo-scale candidate (from V3P-3) — DROPPED, not deferred: beacons are local spawn-zone caution markers by design (legible within ~35 m of the ±85 spawns); center visibility is not a design goal.
- Budgets: city group 320 → 340 meshes; clean boot 340 meshes + 68 sprites = 408 ≤ 600; 17 lights, 3 points, 87 aabbs unchanged. npm test 112/112, verify 81/0/0, build green. PHASE 3 COMPLETE.

## V4P-1a — Gust modulation of the wind bed (commit dcb7436, round 19)

- Added LCG-scheduled wind gusts on top of the existing procedural wind bed (AudioBank.js, +98 lines). Design: the gust scheduler piggybacks on the per-frame `updateGroans()` call Game.js already makes every frame — no Game.js wiring change, no new persistent nodes, headless-safe (gated on `_ambientOn`, which is false without an AudioContext).
- Each gust: 4 LCG draws (seed 90909, `>>> 0`, independent of the groan LCG) → duration 1.5–4.5 s, bed-gain peak 0.07–0.11 (base 0.03), gap to next gust 3–12 s, burst gain 0.03–0.09. The gust ramps the bed gain up (40% of duration) and back, and fires a transient "whoosh": buffer source (shared LCG noise buffer) → 400 Hz lowpass → gain, auto-stopped at start + dur + 0.05 s. Fixed draw order keeps schedules bit-identical across twin instances (pinned by test).
- `stopAmbient()` now stops an in-flight burst source (try/catch — real WebAudio throws on double-stop) and clears gust refs; `dispose()` resets gust state alongside the groan state. Persistent node count of the ambient bed remains exactly 6; transient burst concurrency is bounded (gap 3–12 s ≫ max duration 4.5 s).
- Tests: 2 new blocks in test/audio.test.mjs (+34 lines) — (1) twin-bank determinism + bounded node growth over 40 s of ticks: identical gust schedules and every node beyond the bed accounted for as 3-per-gust transient nodes; (2) no gusts fire unless the bed is running, and `stopAmbient()` clears an in-flight burst.
- Evidence: npm test 112/112 (0 fail / 0 skipped), verify-game.mjs 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE), build green (chunk-size warning only). Budgets unchanged: 340 meshes + 68 sprites = 408 ≤ 600, 17 lights, 3 points. Next: V4P-1b (distant city hum/rumble folded into startAmbient).

## V4P-1b — Distant city hum/rumble bed (commit 14cf2e5, round 20)

- Folded a fixed 4-node city hum/rumble subgraph into `startAmbient()` (AudioBank.js, +23 lines): two sub-bass sine oscillators (32 Hz, 48 Hz) → 120 Hz lowpass → gain 0.015 → master. The hum sits in a separate gain from the gust-modulated wind bed gain, so LCG-scheduled gusts (V4P-1a) swell only the wind, not the rumble. No RNG, no timers, no per-frame node creation — the subgraph is built once per `startAmbient()` and is headless-safe (all code ctx-gated; a headless `new AudioBank()` stays a no-op).
- `stopAmbient()` fades the hum gain to 0 over 0.4 s and stops both hum oscillators at the same `stopAt` as the wind oscillators (null-safe); `dispose()` resets `_humNodes` alongside gust/groan state. Persistent ambient bed: 6 → 10 nodes; transient gust-burst node budget unchanged (gust gap 3–12 s ≫ max gust duration 4.5 s bounds concurrency).
- Tests: the pinned 6-node idempotency block in test/audio.test.mjs was updated to 10 nodes (+32/−4 total); a new V4P-1b block asserts hum presence (32/48 Hz, gain 0.015), idempotency (still 10 nodes after a second `startAmbient()`), `stopAmbient()` clearing `_humNodes`, repeat-stop safety, and the headless no-op path. The V4P-1a gust blocks were untouched — their `bed` count is measured dynamically after `startAmbient()` and adapts automatically.
- Evidence: npm test 112/112 (0 fail / 0 skipped), verify-game.mjs 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE), build green (chunk-size warning only). Budgets unchanged: 340 meshes + 68 sprites = 408 ≤ 600, 17 lights, 3 points. No Game.js wiring change (Game.js already calls `audio.startAmbient()`). Next: V4P-2 (positional audio for nearby threats).

## V4P-2 — Positional audio for nearby threats (commit d30e97b, round 21)

- Groans and the zombie melee-attack one-shot now pan to their sources via transient PannerNodes (AudioBank.js, +60/−9). Design: direction-only panning — `equalpower` model, `distanceModel 'linear'`, `refDistance 1`, `rolloffFactor 0` (no double decay: the scheduler's manual distance falloff still sets level), `maxDistance 30`, source at (x, 0.8, z). `_pannerAt(pos)` returns the master when no position is given or headless. The scheduler fire branch now calls `_playGroanPanned` (walker/shambler = panner + tone + gain + noise + filter + gain = 6 transient nodes; screamer = 3); `groan()` itself is unchanged (tests depend on its direct-to-master path).
- `updateGroans` gains an optional 4th parameter `playerYaw` and keeps `ctx.listener` at the player every frame (position (px, 1.7, pz); forward (sin yaw, 0, −cos yaw)) — piggybacks on the existing per-frame call, no-op headless. Game.js L350 glue (one line, orchestrator): now passes `this.player.yaw` when a player exists.
- `zombieAttack(pos = null)` pans to the source when a position is passed; Zombie.js L207 now passes `this.position`. A no-position call behaves exactly as before.
- Lifetime/budgets: every panner dies with its voice (auto-stop), so transient node growth is exactly 6 per groan fire; the existing ≤ 4 concurrent groan voices bound transient panner nodes (≤ 24 plus a few attack transients). No persistent nodes, no Math.random, no geometry/lights.
- Tests: fake AudioContext extended with `createPanner()` (deliberately wrong defaults — HRTF/inverse/rolloffFactor 1/maxDistance 16 — so the tests prove the code overrides them) plus a `listener` object; 5 new blocks in test/audio.test.mjs (+92/−1): exact 6-node panned-groan graph with panner position/config/wiring; listener tracks player position + facing per frame; 30 s of scheduled groans → exactly one panner per fire at the zombie's position and total node count = 1 + 6·fires (the +1 is the master node `bankWithFakeCtx` creates before the loop — documented spec deviation, fixed in the new assertion only); panned attack = 6 nodes / no panner leak on the plain attack; headless no-op path. All existing assertions untouched.
- Evidence: npm test 112/112 (0 fail / 0 skipped), verify-game.mjs 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE), build green (chunk-size warning only). Budgets unchanged: 340 meshes + 68 sprites = 408 ≤ 600, 17 lights, 3 points. Next: V4P-3 (missing one-shots: dry-fire, player damage, wave cleared, game over, start).

## V4P-3 - Missing one-shots: dry-fire, player hit, wave cleared, start (commit 28cdd49, round 22)

- Audit first (per plan: "verify what exists"): the game-over sound ALREADY exists - playDeath is wired in Player.damage on death (Player.js L104), so no new game-over voice was added. The four real gaps were filled in AudioBank.js (+41 lines) as transient one-shot voices (all _playTone/_playNoise graphs, auto-stopped, no persistent nodes, no RNG, no panners):
  - dryFire() (5 nodes): highpass-2500 click + 900 Hz ping. Called from Shotgun.shoot() early return (empty mag / reloading / fire-interval reject). Input.js fire is edge-based (one press = one shoot attempt), so this produces exactly one click per rejected press - no per-frame spam.
  - hitPlayer() (5 nodes): 90 -> 45 Hz thud + lowpass-300 noise. Called from Player.damage() non-fatal branch; the death branch still uses playDeath (the distinct game-over sound).
  - playWaveCleared(n) (4 nodes): ascending two-tone chime, base = 180 + 15*min(n,8) - pitched below the wave-START chime (playWave uses base 220+15n) so the two events stay distinguishable. Wired in the Game.js onWaveCleared callback (orchestrator glue, GPU-0).
  - playStart() (6 nodes): rising three-note chime 220/330/440 Hz. Wired in Game.js startGame() right after startAmbient (orchestrator glue) - covers both first start and restart.
- Lifetime/budgets: every new voice is transient (auto-stopped at end of its tones), so node growth is exactly 5/5/4/6 per call and returns to baseline; no persistent nodes, no Math.random, no geometry or lights. All call sites null-guarded (?.) so headless Node stays safe and the shotgun/player unit tests (which pass no audio object) are unaffected.
- Tests: 2 new blocks in test/audio.test.mjs (+24 lines): headless no-op path for all four voices; exact transient node counts under the fake AudioContext (5/5/4/6, strictEqual). All existing blocks untouched, including the V4P-2 exact-growth assertion (1 + 6*fires).
- Child deviations (documented, both harmless): (1) the Shotgun early-return line is L126, not L125 - the spec's quoted text matched exactly, so the right line was replaced; (2) the two test blocks were inserted immediately before the final console.log("audio OK") so the success banner prints after the new assertions.
- Evidence: npm test 112/112 (0 fail / 0 skipped); verify-game.mjs 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE S1-S10); build green (chunk-size warning only); headless boot budgets unchanged: 340 meshes + 68 sprites = 408 <= 600, 17 lights, 3 points. Next: V4P-4 (balance, node lifetime, autoplay/gesture docs in README).

## V4P-4b - Autoplay/gesture limitations + audio summary in README (commit 634a700, round 24)

- Docs-only completion of V4P-4 (balance/limiter half was V4P-4a). Added a "## Audio & browser autoplay" section to README.md (+34 lines, between Gameplay and Project layout), satisfying V2-PLAN acceptance "autoplay limitations documented" and Phase 4 V4P-4 "document browser autoplay/gesture limits in README".
- Content (every claim cross-checked against code): (1) all sound synthesized in real time by WebAudio - oscillators, filtered noise bursts, LFO-driven ambient bed; no audio assets loaded or downloaded; (2) autoplay: browsers start a fresh AudioContext suspended until a user gesture; AudioBank resumes it lazily on the first sound call (_resume on every play path, fire-and-forget), and the first sounds only ever follow the START click, an Enter press, or a pointer-lock gesture - the game never depends on pre-gesture audio; under strict autoplay policy the game is silent until START (expected, not a bug) and fully playable without audio; pausing stops the ambient bed, resuming restarts it after the gesture; headless Node has no AudioContext so ctx stays null and every audio method is a no-op (why tests/verify run without an audio device); (3) full v2 feedback list: ambient wind bed with LCG-scheduled gusts + distant city hum/rumble; weapon fire, reload, dry-fire click; per-type zombie groans (30 m falloff, <= 4 concurrent, positionally panned); zombie attack and death; player damage; wave-cleared chime; game-over sting; start/restart chime; ammo pickup; flashlight click; weapon switch; M mutes everything; (4) node budget: the only persistent audio graph is the master gain + soft-clip limiter + the 10-node ambient bed; every one-shot voice is a transient auto-stopped graph; the groan scheduler keeps <= 4 concurrent voices; audio nodes never grow without bound; the soft-clip limiter bends any over-driven mix (worst case ~1.9 pre-limiter) instead of hard-clipping.
- No code changes: npm test 112/112, verify-game.mjs 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE), build green all stand; budgets unchanged (340 meshes + 68 sprites = 408 <= 600, 17 lights, 3 points).
- Next: V5P-1 (hit markers + kill confirmation - HUD.js + CSS).

## V5P-1 - Hit markers + kill confirmation (commit 25f355f, round 25)

- Presentation feedback for weapon hits: the HUD gains a single class-driven hit-marker element. No setTimeout, no per-frame allocations, no style mutation — visibility and lifetime are class toggles decayed by the existing per-frame HUD.update(dt), so the feature is headless-safe and fake-DOM-testable.
- hitMarker(): white X flash, 0.25 s lifetime; fires once per shot that hits at least one zombie.
- killMarker(): red, larger X, 0.6 s lifetime; fires when a zombie dies (kill-counted branch) and overrides any in-flight hit flash.
- clearMarker(): immediate reset, called from startGame() so stale markers never survive a restart.
- Wiring: WeaponBank forwards a new onHit callback to both weapons (same pattern as getZombies/inputState); Shotgun.shoot and Axe.swing call onHit?.() once per shot that registered any hit, right after the existing audio?.hitZombie?.() loop. Game.js glue (orchestrator, GPU-0): weapon.onHit -> hud.hitMarker(); kill hook -> hud.killMarker(); startGame -> hud.clearMarker(); all hud-null-guarded so headless runs are no-ops.
- CSS: .hit-marker X drawn with ::before/::after bars rotated ±45°, .show/.kill variants, z-index above the crosshair, pointer-events: none.
- Tests: new fake-DOM block in test/hud-screens.test.mjs (hidden at rest; hit class set; kill overrides hit; 1 s clock shift decays and clears show; clearMarker; re-trigger works; dispose removes the element). Documented deviation: the fake-DOM stub's classList.add/remove became variadic to match real-DOM semantics (no pre-existing code depended on the single-arg form).
- Evidence: npm test 112/112 (0 fail / 0 skipped); verify-game.mjs 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE S1-S10); build green (chunk-size warning only); focused: hud-screens OK, weaponbank 8/8, shotgun 7/7, axe 6/6. Budgets unchanged: 340 meshes + 68 sprites = 408 <= 600, 17 lights, 3 points.
- Next: V5P-2 (directional damage feedback + damage vignette tuning).

## V5P-2 - Directional damage feedback + damage vignette tuning (commit b2cca49, round 26)

- The HUD now points damage feedback at the attacker: a new full-screen .fx-dmg-edge layer carries a red glow band on its top edge and rotates about the screen center toward the attacker's bearing on each hit (0 = in front, +/-90 = side, 180 = behind), computed from the player->attacker vector against player yaw. Position-less sources (e.g. the debug damage hook) flash the vignette without rotating the edge.
- Vignette retune: trigger is hook-driven (Player._onDamaged, wired by Game.js) with a health-drop fallback; peak opacity scales with damage amount (0.25 + 0.02/pt, cap 0.6) and fades over 0.45 s (was fixed 0.5 over 0.3 s). Edge glow peaks at 0.7 and fades over 0.5 s. Both decay in the existing per-frame HUD.update(dt) - no setTimeout, no per-frame allocations (the transform is written only on hit).
- Zombie melee attacks now pass the zombie object (with its position) as the damage source instead of the string 'zombie', so the HUD can compute a bearing.
- CSS: .fx-dmg-edge (full-screen layer, top-edge band, transform-origin 50% 50%, pointer-events none); .fx-damage center clearance 45% -> 50%.
- Tests: new fake-DOM block in test/hud-screens.test.mjs (fake clock, 16 ms steps: exact front/right/behind angles, peak scales with amount, position-less source does not rotate, both effects decay to rest) + a _onDamaged hook block in test/player.test.mjs.
- Evidence: npm test 112/112 (0 fail / 0 skipped); verify-game.mjs 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE); build green (chunk-size warning only); E2E 18/18 PASS, 0 console/page errors. Budgets unchanged: 340 meshes + 68 sprites = 408 <= 600, 17 lights, 3 points.
- Note: two out-of-spec working-tree changes surfaced during verification and were reviewed, verified, and kept with honest attribution - the missing V5P-1 entry (above) and the groan-panner lifetime fix (below).

## V4P-2 fix - Groan panner lifetime (commit 838c111)

- V4P-2 routed groans through a per-voice PannerNode, but auto-stopping the audio source does not disconnect the panner, so panners accumulated on the master node without bound over long play - a violation of the bounded-audio-node-growth acceptance criterion. The groan scheduler now tracks each voice as { at, panner } and updateGroans disconnects the panner when the voice expires (panners created only via _pannerAt; master fallback recorded as null).
- Made by the GPU-1 child beyond its V5P-2 file scope during round 26; the child's report misattributed it, and the orchestrator verified it (mtime, diff review, audio tests) before keeping it. It fixes a real documented V2 defect, so it is retained.
- Evidence: node test/audio.test.mjs OK (existing node-count pins unchanged - panners are still created, now released); npm test 112/112; verify-game.mjs 81 ok / 0 fail / 0 skipped.

## V5P-3 — HUD hierarchy/readability (commit 35b5976)

- CSS-only change to src/styles.css (32 insertions / 13 deletions; HUD.js untouched — every HUD element is class-driven, no JS hooks needed). The scene got brighter in phases 2-3 (snow layers, streetlight/plaza halos, beacons, signage, thinned fog) while the HUD was flat text floating over it, so it needed contrast and a clear hierarchy.
- Panel backings: all six HUD clusters (.hud-health, .hud-stamina, .hud-battery, .hud-weapons, .hud-score, .hud-wave) now sit on a var(--panel) background with a 1px var(--panel-edge) border, 6px radius, and padding; bar widths shrunk by 20px each to fit inside the padding (260/260/170/170/110 -> 240/240/150/150/90).
- Hierarchy by importance: health 24px > ammo 22px > wave 20px > score 18px > threat 13px (health was 18px and wave inherited the 22px base — the opposite of the intended priority; wave now has its own 20px rule).
- Contrast: 0 1px 2px black text-shadow on all HUD text; crosshair gained a drop-shadow, its dot grew 3 -> 4px, and its bars went 0.85 -> 0.95 opacity.
- Layer ordering made explicit and DOM-order-independent: #hud-root z-index 10, #fx-root 20, #screens-root 30. The DOM order in index.html is canvas -> fx -> hud -> screens, so before this the damage vignette/edge glow painted UNDER the HUD; now they reliably paint over it, and screens over everything.
- Spacing adjusted for the new panel padding: .hud-threat top 66 -> 78px, .hud-battery bottom 96 -> 104px (no overlap between clusters).
- Untouched by design: all .screen rules (V5P-4 territory), .fx-damage/.fx-dmg-edge/.fx-lowhealth, .hit-marker, .hud-message, .fx-scanlines, all colors, and all JS files.
- Evidence: node test/hud-screens.test.mjs OK; npm test 112/112 (0 fail / 0 skipped); verify-game.mjs 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE S1-S10); build green (232 ms, chunk-size warning only); E2E 18/18 PASS with 0 console/page errors. Budgets unchanged (CSS-only): 340 meshes + 68 sprites = 408 <= 600, 17 lights, 3 points.

## V5P-4 — Pause/game-over/restart polish + concise title controls (commit 9947e04, round 28)

- Pause screen: dim secondary hint line 'or press Enter' under 'click to resume'. Enter now resumes from pause: Screens._onKey calls input.requestLock() when state is 'paused' (Game.js's 'lock' handler transitions PAUSED -> PLAYING; a keydown is a user gesture, so the lock request is legal). Guarded by this._game.input, so headless/no-input runs stay no-ops.
- Game-over screen: dim hint 'or press Enter to restart' between the record line and the RESTART button; stat line format is byte-identical ('Wave N — K kills — S pts'), record line unchanged.
- Title screen: the verbose 'Switch weapon (1 = axe, 2 = shotgun)' row replaced with concise 'Axe / Shotgun'; the controls grid keeps exactly 8 rows (the test pins this).
- Presentation: screens fade in over 0.25 s (.screen.visible gains a screen-in animation); new .tagline.dim rule (13px, 0.65 opacity) for secondary hints; .btn:active press feedback (translateY 1px). No other CSS rules touched — V5P-3 HUD layering and the z-index hud 10 / fx 20 / screens 30 stay as-is.
- Tests: one new fake-DOM block in test/hud-screens.test.mjs (+37 lines): Enter while paused increments the requestLock counter; the pause screen contains exactly 2 .tagline elements; after showGameOver the .tagline.dim hint exists and the stat line reads 'Wave 3 — 5 kills — 100 pts'. All pre-existing assertions stayed green. Note: npm test's total stays 112 because node --test counts hud-screens.test.mjs (a plain assert script with no test() calls) as a single test.
- Evidence: node test/hud-screens.test.mjs OK; npm test 112/112 (0 fail / 0 skipped); verify-game.mjs 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE S1-S10); E2E 18/18 PASS, 0 console/page errors (run before the build, per the dist-write full-reload caution); build green (224 ms, chunk-size warning only). Budgets unchanged: 340 meshes + 68 sprites = 408 <= 600, 17 lights, 3 points.

## V6P-1 — Performance baseline measurement (commit 0928c09, round 29)

- Measurement-only task: no src/, test/, or docs files modified; exactly two new files — tools/perf-measure.mjs (345 L, self-contained Playwright probe, node --check clean, re-runnable) and docs/perf-baseline.md (472-word report).
- Method: headless Chromium (SwiftShader), fresh page per condition, 20 warmup + 80 sampled frames, one-shot renderer.render wall-time wrapper (vsync-safe pattern from tools/shadow-cost.mjs), player pinned at (12, 1.6, 0), no Math.random, 240 s cap per session. All three sessions finished with zero console/page errors and no hangs.
- Results: high idle 1.16/4.3/1.6 ms (σ 0.4), 160 draw calls, 5,232 triangles; low idle 0.98/4.4/1.2 ms, 143 calls, 4,448 triangles, 750 snow points; active (8 zombies) 1.24/4.8/1.5 ms, 188 calls, 5,568 triangles, 380 meshes. Per zombie: +3.5 calls, +42 triangles, ≈+0.01 ms. Low quality saves 17 calls / 784 triangles / 0.18 ms. Heap flat per 60-frame window (no per-frame leak; +1.2 MB one-time for wave-1 entities). Boot → first render 657–765 ms.
- Budget headroom: meshes 340/380 vs ≤600; lights 17 vs ≤40; snow 1500/750 vs ≤2500; zombies 8 observed vs cap 18 (budget ≤24); groan voices at hard cap 4/4; blood pool at cap 300/300 (28 live in E2E combat).
- Headless wall times: verify-game.mjs 1.42 s (81 ok / 0 fail / 0 skipped, FULL ACCEPTANCE); npm test 0.22 s (112 pass / 0 fail / 0 skipped); E2E 24.9 s (18/18 PASS, 0 console/page errors, no hang).
- Verdicts: optional V2P-10 restrained bloom = YES — render wall ≤1.24 ms with ≤188 calls / ≤5.6k triangles leaves a 2–3× margin over a conservative +1–2 ms post-process cost; suggested shape: threshold ≥0.8, half-res, ≤2 passes; re-measure after it lands (SwiftShader-relative figures). V6P-2 regressions ranked: (1) shadow pass 0.186 ms/frame (~16% of high-idle render); (2) WaveManager per-frame zombies.filter → replace with a maintained alive counter; (3) zombie contact/slide allocations (scale with contacting zombies, cap 18); (4) groan PannerNode lifecycle (cap 4 voices); (5) HUD per-frame strings (negligible).
- Evidence: independent re-run — verify 81 ok / 0 fail / 0 skipped, npm test 112/112 exit 0; git status clean except the two untracked temp probes; budgets unchanged (340 meshes + 68 sprites = 408 ≤ 600, 17 lights, 3 Points objects).
## V6P-2a — WaveManager per-frame filter elimination (d537852)
- WaveManager.js +8/−2: update() and forceClear() now count live zombies with an allocation-free index loop instead of per-frame zombies.filter(); the kill tally, wave-clear detection, and spawn gating consume the identical count, so behavior is byte-identical. No Game.js/test edits; no Math.random; headless-safe.
- Verified: wave 11/11; npm test 112/112 (0 fail / 0 skipped); verify-game 81 ok / 0 fail / 0 skipped FULL ACCEPTANCE; build green (29 modules). Budgets unchanged (340 m + 68 s = 408 ≤ 600, 17 lights, 3 points).
## V6P-2b — zombie contact/slide per-frame alloc elimination (d6abe9c)
- Zombie.js +13/−11: contactNormal() now writes into a caller-owned per-zombie scratch object (constructor field _cn, allocated once) using an index loop — zero per-frame {x,z} allocations while sliding (was one object per contact frame, up to 24 concurrent zombies). Dead pen/bestPen code removed; the documented-but-unused "deepest penetration" tie-break comment replaced with the actual rule (first AABB wins exact ties). Behavior byte-identical: same min-dot contact selection, null when free; pickTangent (commit-only, rare) deliberately untouched. contactNormal exported for unit testing.
- test/zombie.test.mjs +25/−1: import extended; one new block pins scratch identity (returns the caller's out object), most-opposing selection, later-AABB-wins-when-more-opposing, strict-< first-AABB tie-break, and no-contact → null with scratch preserved.
- Verified in this round, no code change: groan PannerNode lifecycle is bounded — the scheduler tracks {at, panner} per voice and disconnects expired panners (AudioBank L33/L406; V4P-2f), so ranked item (4) needs no fix. CollisionWorld contains no per-frame allocations (no `new` in the file).
- Decision (recorded in V2-DECISIONS): shadow pass stays ON with no quality tier — 0.186 ms/frame ≈ 1.1% of a 16.7 ms frame; V2-PLAN prefers stable performance over excessive effects; re-measure before any tier if a later feature (e.g. V2P-10 restrained bloom) consumes part of the margin. HUD-string item (5) skipped (negligible).
- Verified: zombie 16/16; npm test 113/113 (0 fail / 0 skipped); verify-game 81 ok / 0 fail / 0 skipped FULL ACCEPTANCE; build green (219 ms, chunk warning only). Budgets unchanged (340 m + 68 s = 408 ≤ 600, 17 lights, 3 points).

## V2P-10a — PostFX scaffold (optional restrained bloom), commit 97c78f0

- New files only: src/game/PostFX.js (51 L) + test/postfx.test.mjs (82 L, 4 blocks). PostFX(scene, camera, renderer, {strength=0.25}) builds EffectComposer + RenderPass + UnrealBloomPass (resolution from renderer.getSize, strength clamped [0,1], radius 0.5, threshold 0.0) only when renderer instanceof THREE.WebGLRenderer; the headless StubRenderer keeps it a no-op (render/setStrength/setSize inert; dispose null-safe and reversible). No Game.js wiring yet (V2P-10b); no scene-graph, light, or mesh changes; no Math.random; no per-frame allocations (one-time construction only).
- Test approach: headless stub renderer -> disabled/no-op/dispose-safe; a fake renderer via Object.create(THREE.WebGLRenderer.prototype) satisfies the guard without a WebGL context (smoke-verified under three r185: composer + RenderPass + UnrealBloomPass construct, addPass, setSize, dispose cleanly) -> enabled-path shape checks; strength clamping incl. NaN-keeps-current-value; setSize + dispose on the enabled path.
- Verified: focused 4/4; npm test 117/117 (0 fail / 0 skipped); verify-game 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE); build green (213 ms, chunk warning only). Budgets unchanged (340 m + 68 s = 408 <= 600, 17 lights, 3 points). Real-bloom visual check deferred to the V2P-10b E2E walk (0 console/page errors required).

## V2P-10b — Game.js bloom wiring (optional restrained bloom), commit eebe681

- Game.js +7/−1 (4 targeted edits, no other file touched): `import { PostFX }` after the AudioBank import; `this.postfx = new PostFX(this.scene, this.camera, this.renderer, { strength: 0.25 })` at WIRING:SKY (camera created in setupScene before initSubsystems; the browser renderer is already sized by start()'s resize() before initSubsystems, so the constructor's `renderer.getSize()` is valid); `render()` now renders through the EffectComposer when `postfx.enabled`, otherwise `renderer.render`; `resize()` forwards size via `postfx.setSize(w, h)`. Headless: the StubRenderer is not `instanceof THREE.WebGLRenderer`, so PostFX stays disabled and every hook is a no-op — headless behavior byte-identical.
- Values kept exactly per the round-32 spec (strength 0.25, radius 0.5, threshold 0.0, full resolution). The V6P-1 suggested shape (threshold ≥ 0.8, half resolution) remains an open retune option for V7P-3 — a deliberate decision point, not a defect.
- Verified: node --check clean; npm test 117/117 (0 fail / 0 skipped); verify-game 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE S1–S10); E2E sanity walk (dev :5173, 240 s cap, run before build per the dist-write full-reload caution) 0 console/page errors; in-browser state postfx enabled with 2 composer passes. Quantitative bloom ON/OFF pixel diff on an identical world state (new temp probe tools/e2e-bloom-diff.mjs): 31.8% of pixels shifted >8 luminance, mean +3.71/255, bright pixels 1.17% → 1.30% — an active, restrained full-frame glow; readability preserved.
- No scene-graph, light, or mesh changes → budgets unchanged (340 meshes + 68 sprites = 408 ≤ 600, 17 lights ≤ 40, 3 points ≤ 2500). V2P-10 (optional) COMPLETE; phase 2 visual tasks all done.
## V7P-1 — Final reviewer pass (complete V2) — commit c38ce3f
- Reviewer (GPU-1, deepseek-v4-reviewer) produced docs/v2-final-review.md: verdict ACCEPT WITH CAVEATS. Every V2-PLAN acceptance criterion verified with concrete evidence: verify-game 81 ok / 0 fail / 0 skipped re-run; zero real Math.random in src; budgets (408 boot / 564 worst-case ≤ 600 meshes, 17 ≤ 40 lights, 1500 snow + 3 blood ≤ 2500 points, groan voices ≤ 4, blood ≤ 300, concurrent zombies ≤ 18 cap ≤ 24); per-frame-alloc spot-checks clean (Zombie _cn scratch L125/L248, WaveManager index-loop count L120-125, snow/AudioBank gust tick, Game.js L337-371 — no new in hot paths); audio null-safe with groan panners {at,p} tracked + disconnected on expiry (L33/L441/L402-408), transient gusts, soft-clip limiter (L54-60); 21 test files cover every V2 subsystem; README setup/controls/audio section accurate; V2-DECISIONS records shadow/bloom/fog decisions; no secrets found.
- Must-fix: none.
- Should-fix (non-blocking, deferred as optional V7P-3 follow-ups): (1) HUD.js:177 per-frame weapon-slot array literals -> fixed pair; (2) AudioBank.js:402 _groanVoices rebuilt each frame while groans active (bounded ≤ 4) -> in-place splice; (3) Zombie.js:260 pickTangent allocates [tx,tz] per slide commit (rare, project-accepted) -> optional scratch; (4) AudioBank.js:33 comment says {at, panner} but code uses entry.p -> fix comment; (5) WaveManager.js:120/146 comment conflates the 24 budget with the actual cap min(8+wave, 18) -> reword; (6) delete the 4 untracked temp probes (tools/e2e-probe2.mjs, tools/e2e-step-probe.mjs, tools/e2e-bloom-diff.mjs, .debug-bloom-shot.png) after V7P-3 passes cleanly.
- Confirmed decisions: bloom KEEP (strength 0.25 / radius 0.5 / threshold 0.0 / full-res; measured restrained — 31.8% of pixels >8 luminance shift, mean +3.71/255, bright pixels 1.17% -> 1.30%, readability preserved; retune to V6P-1's threshold ≥ 0.8 / half-res remains an optional V7P-3 decision requiring a visual check); shadows ON, no tier (0.186 ms/frame ≈ 1.1% of a 16.7 ms frame); fog rho = 0.022 PASS (corner beacons are local spawn-zone markers by design).
- Independent orchestrator re-run after the review: npm test 117/117 (0 fail / 0 skipped); verify-game 81 ok / 0 fail / 0 skipped FULL ACCEPTANCE; no src/test files touched.

## V7P-3 — Final full-suite verification — commit a916fc8
- No code changes: final acceptance re-run of the entire V2 suite (dev :5173 live; E2E run BEFORE `npm run build` per the dist-write full-reload caution; hard 240 s cap on every browser command).
- npm test: 117/117 pass, 0 fail, 0 skipped (216 ms).
- E2E browser walk (tools/e2e-browser.mjs, headless Playwright Chromium): 18/18 PASS, 0 console/page errors — title → START → gameplay → weapon switch (axe/shotgun) → shotgun kill + blood + score (walker = 60) → pickup +8 → flashlight on/off + battery drain → pause → resume (pointer lock engaged) → game over ("Wave 1 — 1 kills — 60 pts") → restart (wave 1, kills 0, score 0).
- In-browser scene-state capture (one-shot Playwright snap, title + gameplay): postfx enabled with 2 composer passes, fog density 0.022, title 340 meshes + 68 sprites + 17 lights + 3 point objects, 356 meshes with 2 zombies in play — all within documented budgets (≤600 meshes, ≤40 lights, ≤2500 points). V2 visuals (night lighting, active restrained bloom, snow, landmarks, HUD) confirmed present in the browser, on top of the per-task quantitative evidence (fog-sight PASS, bloom ON/OFF pixel diff mean +3.71/255, shadow cost 0.186 ms/frame, V6P-1 perf baseline).
- npm run build: green (known chunk-size warning only). node tools/verify-game.mjs: 81 ok / 0 fail / 0 skipped — FULL ACCEPTANCE S1–S10.
- Housekeeping: deleted the 4 untracked temp probes (tools/e2e-probe2.mjs, tools/e2e-step-probe.mjs, tools/e2e-bloom-diff.mjs, .debug-bloom-shot.png) after the suite passed cleanly, per V7P-1 should-fix (6); git tree fully clean.
- Status: every V2-PLAN build/test/verify/E2E acceptance item re-verified in one final pass; remaining = V7P-4 final docs (+ 5 non-blocking code-hygiene items from V7P-1, optional).

## V7P-4 — Final documentation pass; Version 2 complete (commit 9bef156, round 37)

- Docs-only round; no code, test, or build changes. Final accuracy pass per V2-PLAN Phase 7 (V7P-4):
  - README.md: project layout corrected — it predated the phase 2–4 files, so it now lists `PostFX` + `ray` in src/game and `cityDressing`, `sky`, `snow` in src/world; Technical notes gains one line describing the optional restrained bloom pass (strength 0.25, ~1 ms/frame, auto-disabled headless, budgets intact). All other sections (setup, commands, controls, gameplay, audio & autoplay, verification) were re-checked against the code and were already accurate.
  - V2-DECISIONS.md: three closing entries — final bloom KEEP confirmation (as shipped: strength 0.25 / radius 0.5 / threshold 0.0 / full-res, with the V2P-10b pixel-diff evidence; V6P-1's threshold ≥ 0.8 / half-res shape remains an optional post-release retune requiring a visual check); the 5 non-blocking code-hygiene should-fix items from V7P-1 deliberately deferred (bounded micro-allocs + comment wording; none touch gameplay, tests, budgets, or acceptance criteria); phase 7 complete.
  - TASKS.md: V7P-4 row marked done with evidence; round-37 log appended; final state recorded (file is git-ignored, per run convention).
- Final verification re-run (docs cannot affect code; recorded for the acceptance trail): npm test 117/117 (0 fail / 0 skipped); node tools/verify-game.mjs 81 ok / 0 fail / 0 skipped — FULL ACCEPTANCE S1–S10. npm run build green (known chunk-size warning only) and E2E 18/18 PASS with 0 console/page errors stand from V7P-3 (run before the build, per the dist-write full-reload caution).
- Final budgets: clean boot 340 meshes + 68 sprites = 408 ≤ 600; worst case 24 concurrent zombies = 564 meshes ≤ 600; 17 ≤ 40 lights; 1500 snow points (+ blood pool ≤ 300 instances, 1 draw call) ≤ 2500; groan voices ≤ 4; concurrent zombies ≤ 18 cap ≤ 24 budget.
- Acceptance audit: every docs/V2-PLAN.md L72–95 criterion now has concrete evidence in TASKS.md — build/tests/verify/E2E green, core gameplay regression-free, V2 visuals visible in the browser (night lighting, snow, landmarks, safe-vs-danger legibility, HUD), audio safe after user gesture with all listed feedbacks, zero reviewer must-fix defects, docs final. Version 2 is COMPLETE on branch v2.

## Round 38 — Final acceptance probes (pointer lock, mouse look, movement, reload)

The main E2E walk verifies game state by direct injection (positions, yaw/pitch, damage), so three additional headless-browser probes were run to verify the real input paths it cannot exercise:

- Pointer lock: acquires on the START gesture and stays locked through play (`document.pointerLockElement === canvas`), zero console errors.
- Mouse look: a `mousemove` event with `movementX = 100` dispatched inside the page produced a yaw delta of exactly `-0.22 rad = 100 × 0.0022` (`LOOK_SENS`) — the Input.js pointermove → turnX/turnY → Player.update → camera pipeline works at the intended sensitivity. Note: CDP-synthesized mouse movement (`page.mouse.move`) delivers zero movement deltas while pointer-locked in headless Chromium — a test-harness artifact, not a game defect; in-page-dispatched events exercise the real handler path.
- Movement: holding W for 1.2 s moved the player 2.04 m; Shift+W for 1.2 s moved 3.48 m (1.7× walk speed, as designed).
- Reload: one shotgun shot dropped the magazine 5→4; the reload (KeyR-equivalent input flag) refilled it to 5 and drew 1 from reserve (30→29), then cleared the reloading state.

Kept `tools/e2e-mouselook2.mjs` and `tools/e2e-movement.mjs` as permanent acceptance probes (they cover input paths the state-injection E2E cannot reach headlessly); removed the superseded first probe. No game code changed.

## v2.x cleanup pass — deferred reviewer should-fixes resolved (round 39)

The five non-blocking hygiene items deferred at V7P-4 are now fixed; all are behavior-neutral (117/117 tests, 81/0/0 verifier, 18/18 E2E all still pass):

- `HUD.js`: per-frame weapon-slot array literal unrolled into two explicit slot updates (no per-frame array allocation).
- `AudioBank.js`: groan-voice expiry now uses in-place swap-pop instead of rebuilding the live-voice list every frame while groans are active (entries are `{at, p}` and order carries no meaning; length accounting and panner disconnects unchanged).
- `AudioBank.js`: comment said `{ at, panner }` while the code uses `entry.p` — comment corrected.
- `Zombie.js`: `pickTangent` now writes into the constructor-owned scratch `this._tan` (mirroring the existing `_cn` pattern) instead of allocating `[tx, tz]` on commit — commit-only allocation removed, steering behavior identical.
- `WaveManager.js`: the per-frame count comment incorrectly attributed to "concurrent zombie cap is 24" — corrected: the spawn gate compares the count against the wave cap `min(8 + wave, 18)`, under the 24 budget; the debug `forceClear` comment corrected likewise.

Evidence: npm test 117/117 (0 fail / 0 skipped); node tools/verify-game.mjs 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE); E2E 18/18 with 0 console/page errors (run before build); build green. Version 2 now has zero open code items.

## Deployment — GitHub Pages (round 39)

- Repo `Mattiasgrondahl/deadfall-stockholm-afterdark` made public (user-approved); `v2` branch pushed.
- `npm run pages` added (`vite build --base /deadfall-stockholm-afterdark`) so asset URLs resolve under the Pages subpath.
- `gh-pages` branch published containing only the built `dist/` (`index.html` + `assets/`); Pages enabled with source = `gh-pages` branch root.
- Deployed URL: **https://mattiasgrondahl.github.io/deadfall-stockholm-afterdark/**
- Verified on the live deployment: assets 200, E2E 18/18 PASS with 0 console/page errors, mouse-look pipeline PASS (in-page movementX → exact LOOK_SENS yaw delta; CDP-synthesized movement stays a headless artifact), WASD/sprint/reload probe PASS.
- README documents the online URL, `npm run pages`, and the redeploy procedure.

## Procedural music system — 3-track WebAudio soundtrack (round 40)

- New `src/game/MusicEngine.js`: fully procedural soundtrack — three looping
  tracks built from oscillators + gain envelopes scheduled ahead of time (no
  mp3 assets, no Math.random): `ambient` (slow minor-key pad over a soft
  drone), `combat` (driving eighth-note minor pulses), `crisis` (faster,
  higher-register dissonant stabs). Looping is pattern-based: the scheduler
  wraps the pattern index back to 0 at each bar boundary, so a loop is just
  the same pattern again — no abrupt silence, no clicks. `switchTrack`
  crossfades (cancelScheduledValues + setValueAtTime + 0.8 s linear ramps;
  outgoing nodes stopped ~0.9 s later). Full lifecycle
  (`start/switchTrack/stop/pause/resume/dispose`, dispose idempotent and
  nulling every node/param). Headless-safe: with no AudioContext every method
  no-ops while state (currentTrack / isPlaying / playlist) still updates.
- New `src/game/MusicDirector.js`: owns ALL track selection — boss waves
  (`w % bossEvery === 0`) → crisis, opening waves → ambient, others →
  combat; cleared waves → ambient; tension ≥ 0.75 → crisis and < 0.2 leaves
  it (threshold hysteresis, no timers); title/paused pause the music, playing
  resumes, gameover stops (documented choice). `reset()` restarts ambient.
- `AudioBank.js`: always owns a MusicEngine (even headless); new
  `playMusicTrack/stopMusicTrack/pauseMusic/resumeMusic` + `musicState`
  getter. Engine output routes through the music bus (`_musicGain || master`)
  and `_applyMusicGain` applies both mute flags + musicVolume to it. The mp3
  layer (`playMusic/stopMusic/playLevelMusic`) is kept intact and additive.
  `dispose()` disposes + nulls the engine.
- `Game.js`: minimal wiring only — constructs the director after audio,
  forwards state/wave/tension events, `startGame` resets it. The two mp3
  `playLevelMusic` call sites were removed so exactly one music layer plays;
  `LEVEL_TRACKS` stays for the AudioBank API. No track-selection logic in
  Game.js.
- New `test/music-playlist.test.mjs` (fake AudioContext + fake Audio,
  `globalThis.Audio` cleaned up in a finally block): engine state/crossfade/
  scheduler-wrap/dispose/headless, director wave/tension/state matrix,
  AudioBank integration incl. mute + dispose.
- Evidence: `node --test test/music-playlist.test.mjs` green; `npm test`
  262/262 (0 fail / 0 skipped; 255 baseline + 7 new);
  `node tools/verify-game.mjs` 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE);
  `npm run build` green (known chunk-size warning only).

### Review pass — reviewer fixes (round 40 follow-up)

Independent review of the music subsystem returned accept-with-fixes; all
findings addressed:
- MUST-FIX (unbounded node bookkeeping): `MusicEngine` now keeps an `_ends`
  queue of each voice's scheduled stop time; `update()` prunes finished
  voices out of `_nodes` and out of any pending `_fade` entries, so neither
  array grows without bound over a long session (measured: 1 simulated hour
  of crisis playback keeps `_nodes` < 120 and `_ends` < 64; a 200-switch
  storm leaves `_fade` < 16). New bounded-growth assertions added to
  `test/music-playlist.test.mjs`.
- Should-fix (mute interaction): `resume()`/`_build()` now ramp to the last
  output ceiling recorded by `setOutputGain` (`_outCeil`) instead of a hard
  1, so pause/resume under a volume ceiling or mute cannot jump to full
  gain. New test asserts resume restores 0.5 after `setOutputGain(0.5)`.
- Should-fix (dead code): removed the `void LEVEL_TRACKS` retention hack;
  `LEVEL_TRACKS`/`LEVEL_TRACK_SECONDS` are now exported constants with an
  honest comment (kept for the AudioBank mp3 API + docs, no call sites).
- Noted, accepted: `AudioBank._updateMusicEngine` is throttled to one tick
  per 0.5 s, so a track switch reaches the engine within 0.5 s — bounded,
  no leak, and imperceptible behind the 0.8 s crossfade.
- Evidence after fixes: `node --test test/music-playlist.test.mjs` green;
  `npm test` 262/262 (0 fail / 0 skipped); `node tools/verify-game.mjs`
  81 ok / 0 fail / 0 skipped; `npm run build` green (chunk-size warning
  only).

## v6 visuals (1) — stronger night lighting (round 41)

First item of the v6 visuals workstream: lift the night scene so silhouettes
and streetlight pools read clearly without adding lights or geometry.

- `src/world/Lighting.js`: moon DirectionalLight 1.1 → 1.45 lx (new
  `MOON_INTENSITY` constant); streetlight pool `POLE_INTENSITY` 55 → 70 cd;
  HemisphereLight 0.22 → 0.30; AmbientLight 0.08 → 0.12. Light count stays
  exactly 15 (1 moon + 1 hemi + 1 ambient + 12 pooled points, ≤ 40 budget);
  colors, distance 14, decay 2, shadow map 2048, biases, ACES tone mapping,
  moon-follow, nearest-anchor pool with broken-lamp skip, setQuality
  low(6)/high(12), and dispose are unchanged. No new lights/meshes, no
  per-frame allocations.
- `test/lighting.test.mjs`: pinned values updated (moon 1.45; 70 cd in the
  anchors, setQuality low/high, and streetlights assertions); all other
  assertions intact.
- Evidence: `node --test test/lighting.test.mjs` 4/4; `npm test` 262/262
  (0 fail / 0 skipped); `node tools/verify-game.mjs` 81 ok / 0 fail / 0
  skipped (FULL ACCEPTANCE).
- Reviewer risk flags for later rounds: brighter streetlights slightly grow
  UnrealBloom halos (re-measure in the bloom round); shadow biases are more
  load-bearing under the stronger moon (check acne/peter-panning in-browser).

## v6 visuals (2) — fog / atmospheric depth (round 42)

Second item of the v6 visuals workstream: replace the single flat FogExp2 with
a quality-tiered fog plus cheap atmospheric layering, keeping both hard
readability gates intact for every tier.

- `src/game/Game.js`: new exported `FOG_TIERS` table — `high` 0.022 /
  `medium` 0.019 / `low` 0.018, all color `0x0b1020` — and a
  `setFogQuality(q)` helper that mirrors `Lighting.setQuality` (anything that
  is not `medium`/`high` collapses to `low`). `setupScene()` now seeds the fog
  from the stored tier and `applySettings('quality')` retunes it live next to
  `lighting.setQuality` / `postfx.setEnabled`. Every tier sits inside both
  gates: `vis(d) = exp(-(d*density)^2)` needs `vis(30) >= 0.60`
  (density <= 0.02382) and `vis(80) < 0.15` (density >= 0.01722), so the
  cheaper tiers are thinner and clearer but never thinner than the far-falloff
  floor. `high` stays the pinned 0.022 baseline.
- `src/game/Game.js` `_createGroundHaze()`: two additive, `depthWrite:false`,
  `fog:false` ground-haze sheets that reuse the city ground plane geometry (no
  new geometry, no lights, no points). Alpha rises with distance from the
  sheet centre: near band `k=0.010` cap `0.16` (0.09 at 30 m — a pool at the
  player's feet, never a wall of mist), far band `k=0.008` cap `0.22`
  (0.06 at 30 m, saturating past ~130 m) so the street reads as receding mist.
  Both follow the player on X/Z in `update()` like the sky dome; `dispose()`
  removes them and disposes their materials.
- `src/game/Game.js` + `src/world/City.js`: per-material fog tuning — the
  ground/road keeps scene fog but gets `fogDensity = 0.82`, so distance
  separates street from skyline instead of flattening both. `City` now exposes
  `this.ground` for the haze layer to reuse. Zombie materials untouched.
- Budgets: meshes 510 -> 512 (<= 600 / verify-game <= 640), lights 18 (<= 40),
  points unchanged (snow 1500, <= 2500). No `Math.random`, no per-frame
  allocation (uniform writes only), headless-safe. Moon/stars/skyline keep
  `fog: false` — `src/world/sky.js` untouched.
- `test/fog.test.mjs`: rewritten from 2 pinned assertions to 4 tests — the
  high tier still pins 0.022 / 0x0b1020, the tier fan-out is asserted live via
  `settings.set('quality', ...)` with per-tier density + both gates for all
  three tiers, and the haze layer is checked for `fog:false` additive
  blending, 30 m faintness, caps, ground `fogDensity`, and dispose teardown.
- Evidence: `node --test test/fog.test.mjs` 4/4; `node --test test/sky.test.mjs`
  8/8 (fog:false intact); `npm test` 264/264 (0 fail / 0 skipped);
  `node tools/verify-game.mjs` 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE,
  walker-at-(30,12) kill flow not skipped); `npm run build` green (chunk-size
  warning only).
- Note for later rounds: `tools/fog-sight.mjs` still hard-pins 0.022 and
  passes because the default tier is `high`; if a future round changes the
  default quality it must update that probe too.

## v6 visuals (3) — snow / weather layering (round 43)

Third item of the v6 visuals workstream: turn the single uniform snow box into
a layered weather volume with quality tiers and a deterministic squall beat,
without spending a single extra light or breaking zombie readability.

- `src/world/snow.js`: the sheet is now a 4-band depth hierarchy — near
  700 flakes (size 0.15, opacity 0.95, fall 3.1 m/s), mid 700 (0.10 / 0.78 /
  2.3), far 260 (0.06 / 0.60 / 1.7) and a high-altitude haze band 140
  (0.035 / 0.34 / 1.1) that reads as weather volume rather than discrete
  flakes. Size, brightness and fall speed fall monotonically with depth. Each
  band carries its own crosswind phase (plus a per-flake wind phase), so the
  bands shear against each other instead of translating as one slab; the
  existing twin-sine gust clock is unchanged. Geometry allocates 1800 flakes
  (700/700/260/140 — every tier share is an exact integer, no rounding drift).
- `src/world/snow.js`: new `setTier(q)` for the quality tiers — low 750 drawn
  (only the two readable bands stay visible), medium 1050, high 1500 — all
  driven through `setDrawRange` + `visible`, never a geometry rebuild.
  `setCount(n)` keeps its legacy proportional contract (750 halves, 1500
  restores) so the pinned lighting/city assertions stay green.
- `src/world/snow.js`: cheap weather beat — a deterministic triangle-envelope
  squall on its own 23 s clock (4.5 s rise, 9.5 s decay, smoothed, no
  `Math.random`) multiplies density up to x1.4, clamped band-by-band to the
  1800 allocated flakes. Measured peaks: high 1800, medium 1450, low 1037 —
  always >= the tier base and <= 1800, i.e. 700 points of margin under the
  2500-point budget on the worst frame. `update()` returns the drawn count and
  still allocates nothing per frame (positions mutated in place, buffers and
  materials reused).
- `src/world/Lighting.js` `setQuality(q)`: keeps the shadow/lighting collapse
  (`medium` still behaves as `low` for shadows) but now forwards the real tier
  to the snow layer (1500 / 1050 / 750). `src/game/Game.js` `applySettings`
  passes the stored tier through instead of pre-collapsing it, so `medium`
  reaches the snow tier live (fog already did in round 42).
- Budgets: points 5 point-objects, 1800 flakes allocated / <= 1800 drawn
  (<= 2500), meshes 512 at title / 597 peak in play (<= 600 / <= 640), lights
  18 (<= 40, none added). No `Math.random`, zero per-frame allocation,
  headless-safe. Zombies stay readable: flakes are 0.035-0.15 world units and
  the sheet follows the player, so the walker-at-(30,12) kill flow is ok.
- `test/snow.test.mjs` (new, 6 tests): band count + allocation ceiling,
  monotonic size/opacity hierarchy and near-vs-haze fall-rate separation, the
  three tiers (incl. low hiding 2 bands and unknown tiers falling back to
  high), squall bounds/peaks per tier, twin-instance determinism with
  independent band crosswind, and a heap-growth + buffer-identity check for
  zero per-frame allocation. `test/city.test.mjs` snow assertions updated to
  4 layers / 1800 flakes; `test/lighting.test.mjs` untouched (750 / 1500 pins
  still pass).
- Evidence: `node --test test/snow.test.mjs` 6/6; `node --test
  test/fog.test.mjs` 4/4, `test/sky.test.mjs` 8/8, `test/lighting.test.mjs`
  4/4, `test/city.test.mjs` 23/23; `npm test` 270/270 (0 fail / 0 skipped);
  `node tools/verify-game.mjs` 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE,
  walker-at-(30,12) kill flow not skipped); `npm run build` green (chunk-size
  warning only).
- Note for later rounds: the squall peak is now the worst-case point count
  (1800). Any new point layer (embers, rain, debris) must budget against
  2500 - 1800 = 700, not against the 1500 baseline.

## v6 visuals (4) — restrained bloom / emissive (round 44)

Fourth item of the v6 visuals workstream: make lamps and landmarks read as
deliberate glow instead of blown-out discs, without washing out zombies and
without spending a single mesh, light or point.

- `src/game/PostFX.js`: bloom retuned to source-only via a `BLOOM` constant —
  strength 0.25→0.18, radius 0.5→0.35, threshold 0.0→0.72. Pass order is
  untouched (RenderPass → gtao → grade → bloom, bloom last / renderToScreen),
  GTAO `blendIntensity` 0.5 and the grade uniforms (uGrain 0.012, uVignette
  0.05) unchanged. The gate that matters is the *tonemapped* luminance:
  `src/world/Lighting.js` sets ACESFilmic tone mapping at exposure 1.2, so
  `UnrealBloomPass.highPass` tests post-curve values, not raw HDR. Measured on
  that curve (x' = x(2.51x+0.03)/(x(2.43x+0.59)+0.14), x = lin·1.2): the
  round-41 lit band (moon 1.45 / hemi 0.30 / ambient 0.12 / 70 cd pools on
  stone and snow) lands at 0.50–0.72, while every emissive source stays above
  it — lamp 0.867, spire 0.880, plaza panel 0.900, facade window 0.776,
  beacon 0.681. Threshold 0.72 therefore clears the ambient ground band and
  keeps every source: the whole brightened night scene no longer blooms.
  Radius 0.35 cuts halo reach (0.5·radius·(2^k−1) at the outermost mip) from
  15.5 to 10.9 screen units, so halos stop smearing the silhouette; strength
  0.18 only amplifies the surviving sources because the additive halos carry
  the perceived glow.
- `src/world/cityDressing.js`: emissives + halos cut where they were over-
  glowing. Lamp head 3.2→2.2 (post-tonemap 0.917→0.867, off the ACES shoulder)
  with its halo 0.5/2.2 → 0.30/1.6 (0.286, far under the cut, so the glow no
  longer re-blooms the 0.45 m head). Spire 2.5→2.0 with halo 0.6/3 → 0.38/2.2
  (the halo, not the box, was burning 7.5 m of sky into a disc). Corner
  beacons keep intensity 2.0 — at 0.681 they are the dimmest source and the
  reason the threshold cannot go higher — and take the cut on the halo:
  0.5/2.4 → 0.34/1.8. Round 41's readability survives: every source still
  clears the cut, and the 70 cd pavement pools are untouched.
- `src/game/Lamps.js`: relight/reset restore the restrained 2.2 instead of the
  old blown-out 3.2, so a repaired lamp matches a never-broken one.
- `src/game/PostFX.js` + `src/game/Game.js`: new `setTier(q)` (high 0.18 /
  medium 0.12 / low 0.08) called from `applySettings`. It never enables post by
  itself — low/medium remain the cheap fallback because
  `setEnabled(s.quality === 'high')` still gates the whole composer, and co-op
  still disables it. A low-quality path therefore pays nothing.
- Zombies: no material changes. Body emissive 0x401018×0.5 tonemaps to 0.003
  and the hit flash 0x661111 to 0.030 — two orders under the cut — so a walker
  at 30 m is never bloomed and readability came from the threshold, not from
  touching `src/game/Zombie.js`.
- Budgets: meshes 512 at title / 597 peak in play (<= 600 / <= 640), lights 18
  (<= 40), points 1800 drawn (<= 2500), zombies <= 24 — zero objects added,
  parameters only. No `Math.random`, zero per-frame allocation, headless-safe
  (StubRenderer keeps PostFX a no-op).
- `test/postfx.test.mjs` (7 tests, 3 new): the new pin (0.18 / 0.35 / 0.72)
  with pass order + GTAO + grade uniforms intact; a threshold test that
  re-derives the ACES curve in-process and asserts the lit band stays under the
  cut, every source stays above it, the beacon sits within 0.1 of it, each
  halo stays ≥0.2 under it, and zombie emissives stay two orders below; a
  halo-reach test proving the 0.35 radius is narrower than the 0.5 baseline;
  and a per-tier test that `setTier` never enables post by itself. Existing
  stub/dispose/clamp tests updated to the new default.
  `test/city.test.mjs` + `test/lamps.test.mjs` pins moved to the new values.
- Evidence: `node --test test/postfx.test.mjs` 7/7; fog 4/4, sky 8/8, lighting
  4/4, snow 6/6, city 23/23, zombie 27/27, lamps 1/1; `npm test` 273/273
  (0 fail / 0 skipped); `node tools/verify-game.mjs` 81 ok / 0 fail / 0
  skipped (FULL ACCEPTANCE, walker-at-(30,12) kill flow not skipped);
  `npm run build` green (chunk-size warning only).
- Note for later rounds: the bloom cut is 0.72 and the corner beacons sit at
  0.681 — do not dim `beaconMat` below intensity 2.0 or the spawn-zone markers
  drop out of the bloom. Any new emissive must be checked against the tonemapped
  table in `PostFX.js`, not against raw intensity. The halos are still
  unverified in a real browser (headless has no readPixels); re-check them in
  item (10) with the material/contrast pass.

## v6 visuals (5) — clearer enemy silhouettes (round 45)

Fifth item of the v6 visuals workstream: make a zombie read as a human-shaped
threat against the dark, foggy, snowy night at combat distance, without
spending a single mesh, light or point.

- Diagnosis first, with numbers. The gate is Michelson contrast between the
  zombie body and the fog backdrop, computed through the real pipeline:
  sRGB→linear→Lambert under the round-41 rig (moon 1.45 lx 0x9db4ff, hemi
  0.30 0x1a2440/0x0a0a10, ambient 0.12 0x141a2e; camera-facing torso at
  N.L≈0.5 for the moon)→exposure 1.2→ACESFilmic→FogExp2 blend toward
  0x0b1020 at the round-42 tier densities (high 0.022 / medium 0.019 / low
  0.018). The fog backdrop tonemaps to 0.0021. Measured before: walker
  0.95/0.94/0.93, shambler 0.93/0.92/0.90, screamer 0.94/0.93/0.91 and brute
  0.86/0.84/**0.81** at 10/20/30 m on 'high'. Against the 0.90 readability
  gate the brute failed at every distance and shambler/screamer at 30 m —
  the brute (0x4c5a44, 0.093 linear luminance) was the worst silhouette.
- `src/game/Zombie.js` MAT2: the four shared body colors lifted ~1.6× in
  linear luminance — walker 0x6b7d5c→0x8b9c77, shambler 0x7a6a58→0x998873,
  screamer 0x9c4f5e→0xb46574, brute 0x4c5a44→0x65755b. This is the minimum
  mechanism that closes the gap: materials are module-level and shared by
  every zombie, so the change costs zero meshes, zero lights, zero points,
  and no per-zombie object. Per-type luminance order (walker > shambler >
  screamer > brute) and hues (screamer R/G > 3, walker/brute green-dominant)
  are preserved, so the per-type silhouettes stay distinct — shape cues
  (POSE2, hair cap, accessories) were not touched.
- `src/game/Zombie.js` FACEMAT: base colors mirror MAT2 exactly (the file
  documents that they must), so a flat face still blends seamlessly with the
  lifted head color.
- Eyes untouched: EYEMAT is MeshBasicMaterial (self-lit), already at C ≥ 0.99
  against the fog at 10/20/30 m on every tier, so it already carried the
  silhouette and needed no change.
- Bloom stays clean (round 44 contract): the lifted bodies tonemap to
  0.07–0.17 on the ACES curve — still two orders under the 0.72 cut — so
  zombies never bloom. Screamer emissive 0x401018×0.5 kept as-is.
- Low/medium fallback: fog is thinner there (0.019 / 0.018), so contrast is
  strictly easier — every type clears ≥0.91 at 30 m on all three tiers with
  no extra work. No new quality branches.
- Budgets: meshes 512 title / 597 peak in play (<= 600 / <= 640), lights 18
  (<= 40), points 1800 drawn (<= 2500), zombies <= 24 — zero objects added,
  colors only. No `Math.random`, zero per-frame allocation, headless-safe.
- `test/zombie.test.mjs` (31 tests, 4 new): a contrast helper that re-derives
  the whole pipeline in-process (sRGB→linear, Lambert under the shipped rig,
  exposure 1.2, ACES, FogExp2 per tier); asserts C ≥ 0.90 for every type at
  10/20/30 m on every tier; asserts every body tonemaps under 0.72; asserts
  the per-type luminance order and hue distinctness (no homogenizing); and
  asserts FACEMAT mirrors MAT2.
- Evidence: `node --test test/zombie.test.mjs` 31/31; postfx 7/7, fog 4/4,
  sky 8/8, lighting 4/4, snow 6/6, city 23/23, lamps 1/1, zombie-skin 7/7,
  skin-perf-gate 1/1, decap-head 8/8; `npm test` 277/277 (0 fail / 0
  skipped); `node tools/verify-game.mjs` 81 ok / 0 fail / 0 skipped (FULL
  ACCEPTANCE, walker-at-(30,12) kill flow ok); `npm run build` green
  (chunk-size warning only).
- Note for later rounds: MAT2 colors are now pinned by the contrast test —
  any future dimming must be re-measured through the same ACES+Fog model
  (the test helper shows the exact math), not by eye. The primitive MAT2 path
  is what the gate measures; the shipped skinned path is brighter still
  (SKIN_TINT + emissive 0.55 → C ≈ 0.99), so it has margin. HITMAT/DEADMAT
  are still swapped by reference and never disposed.

## v6 visuals (6) — muzzle flash + hit feedback (round 46)

- Diagnosis first, numbers not taste. Two gates were computed analytically
  (headless has no readPixels, so both are re-derived inside the tests):
  (a) does the muzzle flash wash out the target, (b) is hit feedback
  perceptible. Only (b) fails.
- (a) Muzzle flash — PASSES unchanged, so the lights stay as they are. The
  pistol's `flashLight` is 300 cd / 6 m / decay 2 and the shotgun's is 500 cd /
  8 m / decay 2; the contribution to a zombie is `fY·I·0.5/d²` (fY = luminance
  of the light color, N·L = 0.5 front-facing). Pistol: 3.889 linear at 5 m
  (tonemapped 0.882 on a walker body — a brief pop, not a white-out) and
  exactly 0 at 15 m because the 6 m cutoff is already spent. Shotgun: 2.431 at
  6 m, 0 at 15 m. Nothing beyond reach can be pushed over the round-44 0.72
  bloom cut, and the brief in-range pop is the intended read. The sniper keeps
  its deliberate no-flash design (bolt-action report carried by audio).
- (b) Hit feedback — FAILED, and this is the round-45 regression. Lifting MAT2
  pushed every body above HITMAT (0x8a1f2a / emissive 0x661111, tonemapped
  0.069): Michelson C went negative — walker −0.434, shambler −0.332, screamer
  −0.247, brute −0.011 — so a non-fatal hit read as a dark patch instead of a
  flash.
- Fix (minimum): HITMAT → color 0xe84a38 + emissive 0xb02214
  (`src/game/Zombie.js:41-49`). Emissive is view-independent, so the flash
  reads at any distance and on 'low' where the muzzle light is dropped.
  Result: tonemapped 0.327, C 0.305 (walker, the hardest) to 0.646 (brute),
  still under the 0.72 bloom cut — a hit must not bloom — and still deep red
  (R/G 11.8). The 0.15 s window is unchanged; it survives a 60 fps frame
  budget (still flashing at 0.133 s, restored by 0.167 s). HITMAT stays a
  shared material swapped by reference, never disposed per zombie.
- Low-quality fallback: new `setTier(q)` on `Pistol` / `Shotgun` and
  `WeaponBank.setTier` forwarded from `Game.applySettings`
  (`src/game/Game.js:500-504`). 'low' hides both flash PointLights and pins
  their intensity to 0, and dims the additive sprite 0.9 → 0.45; the sprite
  alone still reads and hit feedback still lands because HITMAT is emissive,
  not light-driven. No light is ever created or removed, so the 18-light
  budget is untouched.
- Budgets: meshes 512 title / 597 peak in play (<= 600 / <= 640), lights 18
  (<= 40), points 1800 drawn (<= 2500), zombies <= 24, blood <= 300 — zero
  objects added. No `Math.random`, zero per-frame allocation, headless-safe
  (`typeof document === 'undefined'` path in Pistol.js kept).
- Tests: `test/zombie.test.mjs` (34 tests, 3 new) asserts HITMAT is brighter
  than every lifted MAT2 body (C >= 0.30), stays under the bloom cut, still
  clears C >= 0.90 through 30 m fog on every tier, stays red, and that the
  0.15 s window survives 60 fps. `test/pistol.test.mjs` (11, 2 new) and
  `test/shotgun.test.mjs` (12, 2 new) re-derive the flash contribution and
  assert the tier gate.
- Evidence: pistol 11/11, shotgun 12/12, zombie 34/34, blood 6/6, postfx 7/7,
  fog 4/4, sky 8/8, lighting 4/4, snow 6/6, city 23/23, lamps 1/1;
  `npm test` 284/284 (0 fail / 0 skipped); `node tools/verify-game.mjs`
  81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE, walker-at-(30,12) kill flow
  ok); `npm run build` green (chunk-size warning only).
- Note for later rounds: HITMAT is now pinned by the contrast test — the muzzle
  flash lights are pinned at 300 cd/6 m and 500 cd/8 m by the pistol/shotgun
  tests, so any future flash retune must re-run the same `fY·I·0.5/d²` model.
  Perceptibility of the flash and the hit flash is still unverified in a real
  browser (headless has no readPixels).

## v6 visuals (7) — damage vignette (round 47)

- Diagnosis first, numbers not taste. The damage vignette is DOM/CSS
  (`HUD.js` builds `.fx-damage` / `.fx-lowhealth` / `.fx-dmg-edge` into
  `#fx-root`), not post-processing — PostFX `uVignette` 0.05 is a separate,
  pinned grade-pass term and was left alone. Both red layers were measured by
  compositing their sRGB gradient over the round-45 pipeline output
  (fog backdrop tonemapped 0.0021, walker at 30 m C 0.967 with no overlay):
  `.fx-damage` (0 @50% → 0.55 @100%) kept the center clear only to t=0.50 but
  put 60% of the screen above 5% alpha at the 0.35 fallback peak and 67% at
  the 0.60 hook peak, rim alpha 0.19/0.33 effective — enough to pull a 30 m
  walker to C 0.67/0.54, under the 0.90 readability gate. `.fx-lowhealth`
  (0 @40% → 0.45 @100%) was the actual offender: 78% of the screen covered,
  C 0.511 at t=0.5 and 0.097 at the rim, and it never fades while pct < 0.3 —
  a constant full-strength frame exactly when the player is panicking.
- Fix (minimum): `.fx-damage` stops → `rgba(180,20,20,0) 72% / 0.32 100%`
  (`src/styles.css:68-73`). The clear disc now spans the central 40% band
  (72% of screen height, 128% of width at 16:9), the tinted fraction at the
  worst hook peak is 0.360, and the rim's 0.176 worst-case alpha only dents
  local C (0.72) in the outer ring where no 10–30 m enemy appears.
  `.fx-lowhealth` → `rgba(0,0,0,0) 62% / rgba(140,10,10,0.30) 100%`
  (`src/styles.css:95-100`) and it now breathes: a deterministic 1.8 s sine
  pulse in [0.25, 0.75] (`src/game/HUD.js:201-206`) written through the
  opacity write that already ran every frame — no extra per-frame style
  write, no `Math.random`. Worst-case rim alpha 0.225 instead of a constant
  0.45, and the frame lifts periodically so peripheral silhouettes re-read.
- Severity now scales with damage taken instead of a flat 0.35: the
  health-drop fallback is `0.18 + 0.006/pt` capped at 0.40
  (`src/game/HUD.js:190`) and the `dmgFeedback` hook peak is
  `0.25 + 0.012/pt` capped at 0.55 (was 0.02/pt cap 0.60,
  `src/game/HUD.js:353-355`). The damage vignette is suppressed while the
  low-health frame is on (`HUD.js:204`) so the two red layers never stack.
- Low-quality fallback: on 'low' there is no PostFX pass, so the DOM vignette
  is the only vignette — it still reads (rim 0.32 × peak ≥ 0.25 at the edges),
  and no second mechanism was added, so nothing doubles the darkening.
- Budgets: zero new DOM nodes, lights, meshes or points; the per-frame DOM
  write count is unchanged (two opacity writes before, two after).
  Headless-safe: HUD is still constructed only when `env.document` exists and
  `update(null, null, null)` stays a no-op.
- Tests: `test/hud-screens.test.mjs` parses the two CSS gradients from
  `src/styles.css` and asserts the center 40% band stays at zero alpha, the
  clear disc reaches t >= 0.55–0.60, rim alphas stay capped, the tinted
  fraction is <= 0.40, the low-health pulse stays inside [0.25, 0.75] with a
  >= 0.30 range and is deterministic across two HUDs on the same clock, and
  the headless no-op path holds. One pinned assertion (vignette fires at
  20% HP) was updated to the no-stack rule.
- Evidence: hud-screens green; postfx 7/7, zombie 34/34, pistol 11/11,
  shotgun 12/12, fog 4/4, sky 8/8, lighting 4/4, snow 6/6, city 23/23,
  lamps 1/1, blood 6/6; `npm test` 284/284 (0 fail / 0 skipped);
  `node tools/verify-game.mjs` 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE,
  walker-at-(30,12) kill flow ok, 597 meshes / 18 lights / 1800 points
  unchanged); `npm run build` green (chunk-size warning only).
- Note for later rounds: the two gradient stop pairs and the HUD peak-opacity
  formulas are now pinned by `test/hud-screens.test.mjs` — any future vignette
  retune must keep the clear disc >= 0.55–0.60 of the gradient extent and the
  rim alphas capped, and must re-run the same sRGB-over-tonemap compositing
  model. Actual on-screen perception still needs a real-browser check.

## v6 visuals (8) — wave / danger indicators (round 48)

- Diagnosis first, numbers not taste. The wave HUD exposed exactly two
  numbers (`HUD.js:278-281`): "WAVE n" and "left: n". During an intermission
  (3 s after wave 1, +0.5 s per wave to a 6 s cap, 7 s after a boss wave —
  `intermissionFor`) the player could not see how much time remained, what
  composition was coming, or what the next wave total was; while fighting
  there was no readout of how close the wave sat to its concurrent cap
  `min(8 + wave, 18)` (wave 1 cap 9, wave 5 cap 13). The composition data
  already existed (`WaveManager.nextWavePreview`) but only reached the
  transient Screens banner, which clears after 2.5 s.
- Fix (minimum): the two existing top-center elements gained a second line
  each — no new overlay, nothing covering the center. `.hud-wave` now shows
  "in <s>s — <composition>" built verbatim from `nextWavePreview`
  (`src/game/HUD.js:296-310`) with an `imminent` highlight at ≤2 s;
  `.hud-threat` shows "next: <total>" + "cap <n>" during the intermission and
  "room <r>/<cap>" — red "CAP <n>/<cap>" via the `danger` class — while
  fighting (`src/game/HUD.js:311-322`, styles `src/styles.css:309-333`).
- The boss never counts against the spawn cap but is counted in `remaining`,
  so the cap-pressure test subtracts the wired `hud.boss` when alive
  (`src/game/HUD.js:288-293`); without that, wave 5 would read over-cap for
  the whole brute fight. No WaveManager getter was added.
- Low-quality fallback: everything here is DOM/CSS, so it works on 'low' by
  construction; no second mechanism was added, and the round-47 rule holds —
  the fx root still contains exactly `fx-damage` / `fx-dmg-edge` /
  `fx-lowhealth`, and the vignette stays suppressed while low-health is on.
- Budgets: zero new lights, meshes or points; the two pre-existing per-frame
  text writes are unchanged and the two sub-lines are write-gated (written
  only when their string changes), so steady-state DOM writes did not grow.
  Headless-safe: HUD is still built only when `env.document` exists, and a
  wave source without `intermission`/`cap`/`nextWavePreview` degrades to the
  old readouts instead of throwing.
- Tests: `test/hud-screens.test.mjs` gained six blocks — intermission
  countdown text tracks `intermission`, composition matches
  `nextWavePreview` verbatim (including BOSS), next-total + cap readout,
  room/CAP danger incl. the wave-5 boss exclusion, the write-gate (unchanged
  sub-lines are not rewritten, changed ones are), headless degradation, and
  the fx-layer count/identity staying at three.
- Evidence: hud-screens green; postfx 7/7, zombie 34/34, pistol 11/11,
  shotgun 12/12, fog 4/4, sky 8/8, lighting 4/4, snow 6/6, city 23/23,
  lamps 1/1, blood 6/6; `npm test` 284/284 (0 fail / 0 skipped);
  `node tools/verify-game.mjs` 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE,
  walker-at-(30,12) kill flow ok, 597 meshes / 18 lights / 1800 points
  unchanged); `npm run build` green (chunk-size warning only).
- Note for later rounds: the countdown/preview/cap strings are pinned by
  `test/hud-screens.test.mjs` — any future wave-HUD change must keep reading
  `nextWavePreview` / `cap` / `intermission` from WaveManager rather than
  re-deriving composition in the HUD, and must keep the boss excluded from
  the cap-pressure test. Co-op snapshots (`Game.js:214-218`) carry only
  wave/remaining, so co-op HUD degrades to the old readouts by design.

## v6 visuals (9) — screen/HUD readability (round 49)

- Diagnosis first, numbers not taste. Michelson contrast was computed for
  every text element against its actual composited background: `.screen`
  rgba(4,6,12,0.78) over `--bg` #05070c first, then `.panel`
  rgba(10,14,24,0.82) over that, with sRGB↔linear conversion and alpha
  compositing done in linear light. The panel composite lands at sRGB
  (9,13,22) — so most palette colors already cleared the dark-panel regime
  easily; the real offenders were opacity-diluted text (`.weapon-slot`
  0.55 → effective C 0.43, `.tagline.dim` 0.65 → C 0.51,
  `.difficulty-label` 0.7 → C 0.56) and the two top readouts
  (`.hud-threat` / `.hud-threat-sub`) reading bare off the snow-lit ground
  (0x93a9c2) at C 0.06.
- Threshold stated explicitly: 0.60 C for text over the dark panel (a
  defensible floor for small UI text on near-black — distinct from the
  in-world zombie gate of C ≥ 0.90 vs fog), and 0.30 C for bare text over a
  bright snow-lit scene. After the fix every panel pair measures ≥ 0.96 and
  bare ink over snow measures 0.379.
- Minimum fixes, DOM/CSS only, palette identity kept (values lifted, not
  restyled): `--ink` #d6deee→#e2e9f6, `--ink-dim` #8b98b0→#a4b0c6,
  `--banner` #eef4ff→#f2f6ff; `.weapon-slot` opacity 0.55→0.8 moved to
  `:not(.active)` so the active slot is untouched; `.tagline.dim`
  0.65→0.85; `.difficulty-label` 0.7→0.85 + explicit `color: var(--ink)`;
  `.stat` text lifted to `--banner` so the wave/kills/pts line is the
  clearest thing on the game-over screen (RESTART/RESUME and the stat line
  now sit at the top of their screens' contrast ladder); `.hud-threat` +
  `.hud-threat-sub` given the same panel backing the other HUD clusters
  use; and the previously unstyled `.setting-row` / `.setting-label` /
  `.setting-value` rules added so settings-screen text is explicit.
- Narrow screens: the `@media (max-width: 560px)` block had shrunk
  `.hud-value`/`.weapon-ammo` to 16px and the music button to 11px —
  restored to 20px/20px/12px; the 900px `.hud-threat` 11px stays (legible
  at that size on its new panel).
- Budgets: zero new lights, meshes or points; zero new full-screen tint
  layers (fx root still exactly `fx-damage` / `fx-dmg-edge` /
  `fx-lowhealth`, round-47 no-stack rule intact); no new per-frame DOM
  writes (the round-48 sub-line write-gate is untouched); headless-safe
  (Screens/HUD still no-op without `document`).
- Tests: `test/hud-screens.test.mjs` gained a round-49 block that re-derives
  the panel/screen composites from the CSS tokens and asserts every panel
  pair ≥ 0.60, the action lines (banner) ≥ the secondary colors, the two
  top readouts carry `background: var(--panel)` + border, and the narrow
  block keeps hud-value/weapon-ammo ≥ 20px and the music button ≥ 12px.
- Evidence: hud-screens green; `npm test` 284/284 (0 fail / 0 skipped);
  `node tools/verify-game.mjs` 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE,
  walker-at-(30,12) kill flow ok); `npm run build` green (chunk-size
  warning only).
- Note for later rounds: the new contrast assertions read token values and
  rule text out of `src/styles.css` — any future palette change must keep
  ink/ink-dim/banner above the 0.60 floor over the panel composite, and the
  `.hud-threat`/`.hud-threat-sub` panel backing must stay.

## v6 visuals (10) — material roughness / contrast / color hierarchy (round 50)

- Diagnosis first, numbers not taste. Every material group was tabulated for
  roughness / metalness / color and re-measured for tonemapped luminance
  through the shipped curve (sRGB→linear→Lambert under the night rig — moon
  1.45 lx `0x9db4ff`, hemi 0.30 `0x1a2440`/`0x0a0a10`, ambient 0.12
  `0x141a2e` — then exposure 1.2 → ACESFilmic). `verify-game` has no
  `readPixels`, so every claim here is analytic and re-derived inside
  `test/material-hierarchy.test.mjs`.
- The hierarchy collapse was a **roughness-band collision, not a brightness
  one**. Zombie bodies occupy 0.90 (walker/shambler/screamer) / 0.95 (brute),
  and static scenery sat *inside* that band: ground 0.85, building bodies and
  facade variants 0.88, roofs 0.95, barricade planks 0.85, bus 0.60–0.65, pole
  0.60. Brightness ordering was already correct — ground 0.2320 > walker 0.1741
  > shambler 0.1369 > screamer 0.1139 > brute 0.0703 > plank 0.0196 > pole
  0.0018 > wheel 0.0008, with HITMAT 0.3272 above every body — so no color was
  touched. What was missing was a material cue that separates an actor from
  the wall behind it at a glance.
- Threshold stated explicitly: bodies stay in the ROUGH band (≥ 0.90), static
  scenery moves to the SMOOTH band (≤ 0.70), and the two bands must be
  separated by ≥ 0.20. That gap is asserted numerically, not eyeballed.
- Minimum fix, roughness values only, palette identity untouched:
  `src/world/City.js` ground 0.85→0.55, building body 0.88→0.62, facade
  variant 0.88→0.62, roof 0.95→0.70; `src/world/cityDressing.js` bus body
  0.6→0.42, cabin 0.65→0.48, wheels 0.5→0.30, planks 0.85→0.68, pole
  0.6→0.42. Roughness scales only the specular term, never the diffuse
  silhouette, so the round-45 body band (0.0703–0.1741), the C ≥ 0.91-at-30 m
  fog gate and HITMAT 0.3272 are unchanged by construction — no gate needed
  re-tuning.
- Which light drives the effect: the moon (1.45 lx) is the only directional
  term, and the 70 cd streetlight pools own the close-range specular. Lowering
  roughness widens each specular lobe, so the wet-snow sheen spreads further
  across the plaza and bus flanks read as sheet metal rather than matte blocks
  — the separation is visible on `high` and `low` alike, because roughness is
  not a tier-dependent input anywhere in the `Game.applySettings` fan-out
  (`Lighting.setQuality` / `PostFX.setTier` / `WeaponBank.setTier`,
  `Game.js:490-504`). No second mechanism doubles the effect on `low`.
- The IBL env map is genuinely installed (`src/world/envmap.js:61` sets
  `scene.environment`, `:62` sets `scene.environmentIntensity`), so the lower
  roughness produces a real sky reflection rather than a dead parameter — at
  zero added draw calls, lights, meshes or points. Metalness was deliberately
  left alone (facades 0.05, ground 0) so no scenery surface gains a mirror
  highlight that could compete with a body.
- Budgets: zero new lights, meshes, points or full-screen tint layers; city
  mesh count stays 388 and global budgets stay 597 meshes / 18 lights / 1800
  points. No new per-frame material writes — `City.update()` flickers facade
  `emissiveIntensity` only, and the test asserts ground/facade roughness is
  identical across two update frames. Headless-safe.
- Tests: new `test/material-hierarchy.test.mjs` (11 assertions) pins the rough
  body band, the smooth scenery band, the ≥ 0.20 separation, HITMAT 0.3272 >
  every body at C ≥ 0.30, the round-45 0.07–0.175 body band and sub-0.72 bloom
  cut, the C ≥ 0.91-at-30 m gate, the dark-scenery floor under the brute, the
  unchanged mesh/light counts, the no-per-frame-write rule, tier invariance,
  and that `DEADMAT` corpses fall out of the actor band.
- Evidence: material-hierarchy 11/11; `npm test` 295/295 (0 fail / 0 skipped,
  up from 284); `node tools/verify-game.mjs` 81 ok / 0 fail / 0 skipped (FULL
  ACCEPTANCE, walker-at-(30,12) kill flow ok); `npm run build` green
  (chunk-size warning only).
- Note for later rounds: the body roughness band (0.90/0.95) and HITMAT are
  now load-bearing for this separation test — any future zombie-material change
  must keep bodies ≥ 0.90 and every static scenery material ≤ 0.70, or the
  ≥ 0.20 band gap fails.

## v6 gameplay (1) — wave pacing curve (round 51, WIP landed + green)

- `src/game/WaveManager.js` rewritten from constant knobs to curves, all
  deterministic (no `Math.random`, no per-frame allocation):
  - **Spawn cadence**: `SPAWN_BASE` 0.7 s at wave 1, −0.05 s per wave to a
    `SPAWN_MIN` 0.45 s floor at wave 6 (still above the pistol's 0.28 s fire
    interval, so a wave can never outrun the player's rate of fire). Waves
    1–3 keep the exact 0.7 s cadence pinned by wave.test / match.test /
    verify S6. Exposed as `WaveManager.spawnInterval`.
  - **Intermission ceiling** 6.0→5.0 s (`INTERMISSION_MAX`): above wave 5 the
    curve flattens so pressure comes from cadence + cap, not from ever-longer
    waits. Waves 1–4 keep the pinned 3.0/3.5/4.0/4.5 s; boss waves keep the
    7 s `BOSS_INTERMISSION`.
  - **Concurrency cap**: `capFor(wave)` = 8+wave through wave 9, then
    +0.5/wave to a 16 ceiling (was `min(8+wave, 18)`). Wave 1/2/3 stay
    9/10/11 and wave 5 stays 13; wave 12 + boss stays inside the 24-zombie
    budget.
  - **Composition**: shared `queueTypeAt(wave, i)` rule now drives both
    `buildQueue` and `nextWavePreview` (no duplicated logic). Waves 1–2 keep
    their pinned shape; wave 3 is the first screamer wave; from wave 4
    shamblers move from every 5th slot to every 4th (25 %) while screamers
    stay on odd slots.
  - `reset()` sets `timer = 0` so wave 1's first spawn lands on the 0.05 s
    frame (match.test pins 0.05/0.75/1.45/2.15/2.85 s); every later wave's
    transition sets `timer = spawnIntervalFor(wave)`, so its first spawn waits
    a full cadence tick after the intermission expires.
- Test re-pins: `test/wave.test.mjs` forceClear + natural-clear cases now
  expect the 3.0 s wave-2 intermission and the 0.7 s first-spawn delay;
  `test/boss.test.mjs` wave-10 forceClear loop uses 7.1 s at i=4 (wave-5 boss
  BOSS_INTERMISSION) instead of 6.1 s.
- Evidence: wave 11/11, boss 14/14, match 9/9; `npm test` 295/295
  (0 fail / 0 skipped); `node tools/verify-game.mjs` 81 ok / 0 fail /
  0 skipped (FULL ACCEPTANCE, walker-at-(30,12) kill flow ok);
  `npm run build` green (chunk-size warning only).
- Review pass (round 51, ACCEPT-WITH-FIXES, all fixes applied): stale
  `min(8+wave,18)` comments/labels updated to `capFor` (WaveManager.js:253,
  tools/verify-game.mjs S6 labels); `nextWavePreview` collapsed to a single
  `queueTypeAt` call (no duplicated rules); `queueTypeAt` docstring corrected
  (wave 3's i%5 branch is dead — the odd-slot screamer rule wins first);
  late-wave shambler pin added to wave.test (waves 4/10 exceed the 7-entry
  SAFE list and must still resolve to real points). New dedicated acceptance
  test `test/wave-pacing.test.mjs` (6 tests) pins the full curves:
  spawnInterval 0.7→0.45 floor (above the pistol's 0.28 s), capFor 9..17 then
  the 16 ceiling (cap+boss ≤ 24), intermission 3.0/4.5/5.0 ceiling + boss 7.0,
  queueTypeAt composition + preview/buildQueue consistency, wave-6 live
  0.45 s cadence, and cross-instance determinism.
- Note: the 24-zombie budget is a design bound, not a runtime enforcement —
  `MAX_ZOMBIES` exists only in `src/net/protocol.js` and is never imported;
  `Game.spawnZombie`/`Match.spawnZombie` push unconditionally. Cap ≤ 16 (+1
  boss) keeps the bound true by construction.
- Evidence (post-review): wave 11/11, wave-pacing 6/6, boss 14/14, match 9/9;
  `npm test` 301/301 (0 fail / 0 skipped); `node tools/verify-game.mjs`
  81 ok / 0 fail / 0 skipped; `npm run build` green.

## v6 gameplay (2) — ammo-drop balance (round 51)

- Economy analysis first: a 10-wave run is 217 kills (Σ(5+3w) + 2 bosses)
  needing ~1015 pistol body shots (hp×1.12^(w−1) ÷ 26). Income at 12 bullets/
  drop was 36 + 217×0.55×0.82×0.5×12 ≈ 623 — the pistol ran dry around
  wave 7–8, before the wave-10 boss. Shells were already fine
  (30 + ~391 vs ~350 needed).
- Minimum fix: `BULLETS_PER_DROP` 12 → 18 (src/game/AmmoDrops.js:20). Income
  becomes 36 + ~881 ≈ 917 ≈ 90 % of need — the pistol stays the scarce
  weapon but survives to the finale. `DROP_CHANCE` 0.55, `BATTERY_CHANCE`
  0.18, `SHELLS_PER_DROP` 8, weapon reserves and the LCG are untouched;
  pickups read the constant, so Game/Match handlers needed no change.
- Test: `test/ammodrop.test.mjs` constant pin 12→18 + new deterministic
  '10-wave ammo economy: pistol survives to the wave-10 boss' (income
  ≥ 0.85×need and < need — scarce but survivable; shells ≥ 350).
- Evidence: ammodrop 9/9, difficulty 7/7, match 9/9; `npm test` 302/302
  (0 fail / 0 skipped); `node tools/verify-game.mjs` 81 ok / 0 fail /
  0 skipped; `npm run build` green.

## v6 gameplay (3) — per-type stagger resistance (round 52)

- Research finding: screamer had no special behavior beyond stats
  (src/game/Zombie.js:78) and knockback had no per-type scaling, so fast
  types were trivially kited and the brute could be staggered out of its
  own charge.
- Minimum fix: `staggerResist` added to TABLE (Zombie.js:76-79 — walker 1,
  shambler 1, screamer 1.35, brute 0.35), exposed as `this.staggerResist`
  (:581), and `knockback()` multiplies `_kbX/_kbZ` by it (:1295-1296).
  Higher resist = less stagger displacement: screamer resists kiting
  (0.675 m vs 0.5), brute is barely moved (0.175 m) and cannot be shoved
  out of an in-flight lunge (the stagger block returns before the charge
  block, :983 vs :1016, so _chargeT survives the stagger). KB_TIME 0.35 /
  KB_STRENGTH 3 unchanged; shotgun STAGGER_BASE compounds with resist
  (brute point-blank push 1.44 → 0.504 m/s) — intended crowd-control
  weakening.
- Tests: test/zombie.test.mjs new 'knockback: per-type stagger resistance'
  (exact 1e-9 pins 0.5/0.675/0.175 m at 21×1/60 steps, ordering
  brute<walker<screamer, chase resumes per type); test/boss.test.mjs
  brute-knockback re-pinned z=-2.175 + chase-resume assertion. TABLE
  deepEqual pins updated for all four types.
- Review: ACCEPT-WITH-FIXES (no must-fix). Applied: KB_STRENGTH comment
  now states "× staggerResist" (Zombie.js:522-524); TASKS.md round-46-era
  "≈ 0.53 m" note corrected. Noted for later: RemoteZombie.js:210 proxy
  knockback is a no-op stub — mirror staggerResist there if remote
  stagger is ever implemented.
- Evidence: zombie+boss 53/53, `npm test` 303/303 (0 fail / 0 skipped),
  `node tools/verify-game.mjs` 81 ok / 0 fail / 0 skipped,
  `npm run build` green.

## v6 gameplay (4) — stamina/flashlight tradeoff (round 53)

- Research finding: stamina and the flashlight were fully decoupled — the
  light neither drained nor blocked stamina regen, and HUD.js:221 read a
  nonexistent `player.maxStamina`.
- Minimum fix: `LIGHT_DRAIN = 4` stamina/s while the flashlight is on and
  sprint is NOT active (Player.js:22, branch :130-137 — strict
  if/else-if/else: sprint 26/s keeps precedence, never 30/s; light-on
  blocks regen entirely; clamped at 0). `this.maxStamina = 100` added
  (:59), fixing the HUD bar read. Constructor gains optional 5th arg
  `flashlight = null` (:42); Game.js:371-373 wires
  `player.flashlight = this.flashlight` after Flashlight creation (Player
  is constructed earlier, so post-creation assignment; the link survives
  reset/respawn, and flashlight.reset() means a new run starts on regen).
  Match.js:124's 4-arg Player keeps flashlight null — server-side stamina
  semantics unchanged.
- Tests: test/player.test.mjs two blocks — light-on drain ~4/s standing
  (3.5–4.5 band), light-off regen 18/s, exact clamp at 0, maxStamina===100,
  back-compat no-flashlight regen; review fixes added sprint+light
  precedence pin (25.5–26.5/s, proves 26 not 30) and the
  SPRINT_MIN_STAMINA boundary case (stamina 4 ≤ 5 disables sprint → light
  drain 4/s takes over, clamps at 0).
- Review: ACCEPT-WITH-FIXES (no must-fix); both should-fix test pins
  applied. Balance note: 25 s of continuous light empties a full bar while
  a 120 s battery runs — a real light-vs-sprint tradeoff.
- Evidence: player+flashlight green, `npm test` 303/303 (0 fail / 0
  skipped), `node tools/verify-game.mjs` 81 ok / 0 fail / 0 skipped.

## v6 gameplay (5) — reload feedback dip (round 54)

- Research finding: reload had audio-only feedback — the view model was
  static during reload and completion had no visual cue at all (melee
  already had phased slash feedback, intermission choices need new UI).
- Minimum fix: deterministic reload dip on the view model —
  DIP_Y -0.05 / DIP_Z +0.06 (Pistol.js:25, Shotgun.js:25) applied through
  a sin(π·p) envelope (p = min(1, 1 − _reloadT/RELOAD_TIME)) on top of the
  untouched bob+recoil rest pose (Pistol.js:133-141, Shotgun.js:129-137).
  Review fix applied: the reload-progress branch was moved BEFORE the view
  write so the completion frame lands on exact rest (deletes the one-frame
  2.4 mm stale-dip deviation), and p is clamped to [0,1]. Sniper/melee
  untouched; view.position is read by nothing in net/HUD — view-model-only.
- Tests: test/pistol.test.mjs :153 + test/shotgun.test.mjs :120 — dip
  >0.03 below rest (y) and >0.03 back (z) near the sin peak, exact rest on
  the completion frame, ammo/reserve transfer pins (pistol 4/12→12/28,
  shotgun 3/5→5/28), _recoil zeroed first for a clean rest comparison.
- Review: ACCEPT-WITH-FIXES (no must-fix); should-fix reorder + clamp
  applied, tests updated to assert rest on the completion frame.
- Evidence: pistol+shotgun 25/25, `npm test` 305/305 (0 fail / 0 skipped),
  `node tools/verify-game.mjs` 81 ok / 0 fail / 0 skipped.

## v6 gameplay (6) — restart-state coverage (round 55)

- Research finding: the restart path (Game.startGame, Game.js:567-604) was
  only pinned by a state-PLAYING assertion (headless-boot.test.mjs:21-22);
  nothing proved it actually clears run state.
- Change: new test/restart-state.test.mjs (test-only, no src changes).
  `dirty()` spends ammo, damages the player, drains flashlight battery,
  debug-spawns + kills 6 walkers, steps 120 frames (kills/score/drops/clock
  move), forceWaveClear + 240 frames (wave 1→2); `assertClean()` then pins
  after restart: PLAYING, zombies 0, kills 0, score 0, wave 1, health 100,
  timeInGame 0, drops 0, full mag + reserve, flashlight battery 1 + off,
  `_boss` null. Three tests: resetRun path, GAMEOVER→startGame path, and
  the PLAYING early-return guard (startGame while PLAYING must NOT wipe
  kills/score/wave — Game.js:568).
- Review: ACCEPT-WITH-FIXES (no must-fix); all three should-fixes applied
  (flashlight/boss coverage added, early-return micro-test added, reserve
  assert shared via assertClean so both restart paths check it).
- No restart bugs found — startGame already clears every field.
- Evidence: restart-state 3/3, `npm test` 308/308 (0 fail / 0 skipped),
  `node tools/verify-game.mjs` 81 ok / 0 fail / 0 skipped.

## v6 audio (8) — anime-inspired trilingual power-metal playlist (round 57)

- Request: three NEW power-metal songs about killing zombies, inspired by the
  Attack on Titan opening ("Shinzou wo Sasageyo"), one in Swedish, one in
  English, one in Japanese — played in-game as one looping playlist
  (song 1 → 2 → 3 → restart).
- Generation: three YuE2 specs tools/audio-specs/df_{javelin_sv,hord_en,
  matsubou_ja}.json (seeds 1010-1012, anime-opening style prompts, game-lyric
  prompts: Swedish "Kasta spjutet mot natten / död eller frihet", English
  "Dedicate your hearts / the dead are marching", Japanese "心臓を捧げよ").
  Generated on GPU 2 via tools/wangp_assets.py (env_uv python). The Swedish
  job needed a retry (first run hit the 3600 s score-stage timeout at 150 s
  duration; the 180 s target completed on the second run).
- Landing: wav → mp3 via ffmpeg (libmp3lame -q:a 2) to
  public/assets/audio/song_{javelin_sv,hord_en,matsubou_ja}.mp3. Measured
  durations: 180.0 / 70.9 / 86.1 s.
- Code: AudioBank.playPlaylist now accepts per-track lengths — `seconds` may
  be a scalar (legacy, replicated) or an array aligned with `urls`; the
  watchdog length follows each advance (_plLens, AudioBank.js:1116-1138),
  dispose nulls it. Game.js SONG_PLAYLIST points at the three new mp3s with
  SONG_PLAYLIST_SECONDS = [180, 71, 86]; startGame still calls playPlaylist
  on the START gesture. README audio section rewritten (song titles,
  languages, AoT inspiration, per-song rotation).
- Tests: test/audio.test.mjs playlist block extended — per-length playlist
  pins first-song length, watchdog follows each advance (75, 150), wrap
  restores the first length, scalar call still replicates across the list.
- Evidence: audio suite green, `npm test` 308/308 (0 fail / 0 skipped),
  `node tools/verify-game.mjs` 81 ok / 0 fail / 0 skipped, build green.
