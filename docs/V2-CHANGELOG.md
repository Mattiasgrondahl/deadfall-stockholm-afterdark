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
