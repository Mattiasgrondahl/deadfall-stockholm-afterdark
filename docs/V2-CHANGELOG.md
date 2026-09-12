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
