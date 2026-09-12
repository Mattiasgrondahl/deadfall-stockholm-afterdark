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
