# Version 2 — Design & Acceptance Notes

Source of truth for the current Ralph run (branch `v2`). Filesystem + TASKS.md
are the state; this file holds the design and acceptance criteria.

## Baseline (recorded at run start, commit bdb989e)

- v1 complete and playable: Three.js first-person zombie survival, tested.
- Gameplay V2 (tasks V1–V13) DONE — do not redo: weapon bank (1=axe, 2=shotgun;
  rifle retired), F flashlight (battery + low-battery flicker), ~55% ammo drops,
  score + localStorage high score, blood spray (InstancedMesh), per-type zombie
  groans (max 4 voices), AudioBank (procedural WebAudio), HUD + screens,
  verify S1–S10.
- Verified green at run start: npm test 93/93; npm run build green (chunk-size
  warning only); node tools/verify-game.mjs 81 ok / 0 fail / 0 skipped;
  Playwright E2E 18/18, 0 console errors.
- Budgets (hard, documented): meshes ≤ 600, lights ≤ 40, concurrent zombies ≤ 24,
  points ≤ 2500, groan voices ≤ 4, blood instances ≤ 300 (1 draw call).
- Constraints: headless Node-safe everywhere; deterministic (seeded LCG, >>>0,
  no Math.random); procedural geometry/audio only, no large external downloads;
  writes < ~150 lines; `edit` not `write` for existing files; never reformat Game.js.

## Phases for this run (2–7; task table in TASKS.md)

Phase 2 — Visual foundation
- V2P-1 Sky/horizon: night gradient, moon, horizon glow, distant silhouettes.
- V2P-2 Palette & materials: unified night palette, tuned roughness/metalness,
  per-zone tints (City.js / cityDressing.js).
- V2P-3 Fog & atmosphere: density/height tuning, depth cues without hiding targets.
- V2P-4 Moonlight & ambient: shadow-map tuning, night contrast, hemi/ambient balance.
- V2P-5 Streetlights: falloff curve + warm color + cheap halo sprites (no new
  PointLights beyond budget).
- V2P-6 Shadows: cost measurement, quality fallback when unsupported.
- V2P-7 Snow/particles: depth layers, wind drift + gusts, ground splash; keep ≤ 2500.
- V2P-8 Firing feel: muzzle flash (brief light+sprite), camera kick, optional tracer.
- V2P-9 City readability: landmark beacons, street directionality, composition.
- V2P-10 (optional) restrained bloom/emissive only if V6P-1 shows perf headroom.

Phase 3 — Environment & atmosphere
- V3P-1 Safe vs dangerous visual language (lit plazas vs unlit alleys, signage).
- V3P-2 Zombie visibility: eye glow / silhouette contrast; must not break hit detection.
- V3P-3 Fog-vs-targets: verify with headless sight checks + E2E; tune.
- V3P-4 Street directionality: ground markings, lamp alignment, vehicle placement.

Phase 4 — Audio
- V4P-1 Ambient layering: wind bed + gusts + sparse distant rumble/city hum.
- V4P-2 Positional audio: PannerNode for nearby zombie groans/attacks.
- V4P-3 Missing one-shots: dry-fire, player damage, wave cleared, game over,
  start/restart (verify what exists first; add only gaps).
- V4P-4 Balance & safety: master gain, no clipping, bounded node lifetime,
  document browser autoplay/gesture limits in README.

Phase 5 — Gameplay presentation
- V5P-1 Hit markers + kill confirmation.
- V5P-2 Directional damage feedback + damage vignette tuning.
- V5P-3 HUD hierarchy/readability over the improved scene.
- V5P-4 Pause / game-over / restart polish; concise control instructions on title.

Phase 6 — Performance
- V6P-1 Measure: frame-time stability, draw calls, mesh/light/particle counts,
  per-frame allocations, startup time, headless test runtime, E2E runtime.
- V6P-2 Fix regressions: fewer meshes/lights, instancing, culling, node pooling.
  Prefer stable performance over excessive effects.

Phase 7 — Review & final acceptance
- V7P-1 Reviewer pass over the complete V2 implementation (code + docs + budgets).
- V7P-2 Fix every concrete must-fix defect.
- V7P-3 Full suite: npm test; npm run build; node tools/verify-game.mjs; E2E walk.
- V7P-4 Docs: README v2 run/controls/limitations; V2-CHANGELOG; V2-DECISIONS;
  final TASKS.md state; record limitations honestly.

## Acceptance criteria (ALL must be verified, evidence recorded in TASKS.md)

Build & tests: npm test passes (0 fail, 0 unintended skips); npm run build passes;
node tools/verify-game.mjs 0 fail / 0 unintended skips; verifier keeps hard timeouts;
no fatal browser console errors; no uncontrolled per-frame allocations or effect
growth; mesh/light/particle/shadow counts within the documented budgets.

Core gameplay (regression-free): title screen; pointer lock + mouse look; WASD;
sprint; health/stamina; fire + reload; hit detection; walls block shots; zombies
spawn/pursue/attack/take damage/die; waves start and progress; player death;
game over; restart; kill and wave counters correct.

Visuals: V2 changes visible in the browser; night lighting readable and
atmospheric; snow/weather work without obscuring gameplay; city geometry and
landmarks clearer; streetlights/shadows within perf limits; HUD readable.

Audio: initializes safely after user gesture; ambient, weapon, reload, dry-fire,
zombie attack/death, damage, wave, game-over, restart feedback all present;
null-safe and headless-safe; audio nodes do not grow without bound; browser
autoplay limitations documented.

Documentation: README has accurate V2 run instructions, controls, audio/browser
limits; V2-PLAN reflects the implemented design; V2-CHANGELOG lists completed
improvements; TASKS.md records final verification; no secrets/credentials anywhere.
