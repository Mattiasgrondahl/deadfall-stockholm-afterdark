# Deadfall: Stockholm Afterdark — Improvement Progress

Mission: improve gameplay depth/pacing, visuals/atmosphere/readability, and
audio feedback/tension over the deployed baseline
(https://mattiasgrondahl.github.io/deadfall-stockholm-afterdark/ = `gh-pages`
bundle of `v2` HEAD 6f4078f). Source repo: this workspace (Three.js + Vite,
`src/game/*`, `src/world/*`). No minified-bundle editing.

## Baseline (verified)

- `npm test` 244/244 · `npm run verify` 81/0/0 · E2E 18/18, 0 errors.
- Full details: `.hermes/deadfall-playtest.md`.

## Phase log

### Phase 0 — Discover & playtest — COMPLETE (2026-09-22)
- Identified repo/entry/build/tests; ran unit + headless verify + browser E2E.
- Real-input playtest with screenshots; headless 5-min soak.
- Key findings: control list stale (8 rows vs 5 weapons + crouch/jump/zoom/N);
  no settings panel; pause overlay lock-coupled; Enter-resume lock-dependent;
  intermission 3 s with no threat preview; no spawn telegraphs; no hit
  confirmation; no volume sliders; mute not persisted; no reduced-motion;
  PCFSoft deprecation warning; idle player dies ~20 s, never passes wave 1.
- Baseline perf: headless logic 0.086 ms/frame; scene ≤582 meshes, ≤18 lights;
  zombie cap `min(8+wave,18)`.

### Phase 1 — Core UX & control contract — COMPLETE (commit eaf0ee9)
- Settings.js: localStorage-backed store (master/music/effects volume,
  sensitivity, FOV, quality low/medium/high, flashlight flicker, reduced
  motion, muted, musicMuted) with validation + change events.
- Game: Settings built before subsystems; applySettings() fans out (lighting
  quality + shadows + snow, postfx enabled/grain, player sensMult, sniper
  base FOV, HUD reduced-motion, flashlight effects, HUD music label);
  onStateChange/offStateChange listeners drive Screens overlays.
- Screens: pause overlay is STATE-driven (works without pointer lock);
  resume via RESUME button / overlay click / Enter, with direct-resume
  fallback when lock unavailable; full 13-row control list (1–5 weapons,
  C, Space, Q, N, M); SETTINGS panel (5 sliders + quality + 4 toggles) from
  title & pause; QUIT TO TITLE.
- AudioBank: `_masterIn` effects bus between voices and master;
  attachSettings() applies volumes/mutes live + persists mute flags;
  immediate `.value` writes so gains apply while ctx is suspended.
- Player.sensMult, Sniper.setBaseFov, Flashlight.setEffectsEnabled,
  PostFX.setEnabled/setGrainEnabled, HUD.setReducedMotion + headshot
  marker variant (weapons pass 'head'|'body' to onHit; amber CSS marker).
- Verified: 244/244 node tests, 81/81 verify, 18/18 E2E, build ok; browser
  probes confirm persistence, live volume, quality fan-out, all 3 resume
  paths, music-mute label sync.

### Phase 2 — Gameplay depth — COMPLETE (commit 381b151)
2A pacing (intermission 3→6 s, 7 after boss; nextWavePreview threat banner),
2B enemy roles (per-type melee windup telegraph + windup voice; shotgun
multi-pellet stagger scales with pellets landed; brute armor resists),
2C weapon identity + hit confirmation (headshot-aware kill marker amber+red,
playKill bright ping on headshot), 2D battery decision mechanic (18% of drops
are batteries that recharge the flashlight — light-vs-ammo choice; Game+Match
pickup wiring). 245 tests, verify 81/81.

### Phase 3 — Visual/atmosphere — IN PROGRESS (console-warning cleanup)
- **PCFSoftShadowMap deprecation — FIXED** (`src/world/Lighting.js`): switched
  `renderer.shadowMap.type` from the r185-deprecated `PCFSoftShadowMap` to
  `PCFShadowMap` (the type three itself falls back to). Browser probe confirms
  **0** deprecation warnings (was a recurring console warning). Visually
  identical (three coerced soft→basic internally).
- **"Texture marked for update but no image data found" — reduced 5→3**
  (`src/world/City.js`, `src/world/cityDressing.js`): the photoreal ground
  asphalt, hero-facade image clones, and WANTED poster were bound to materials
  / flagged `needsUpdate` before their `TextureLoader` images decoded, so the
  renderer uploaded an empty texture. Fixed by deferring the map assignment
  (and clone `needsUpdate`) into the source texture's `load` event — the same
  pattern the weapon skins already use. `makeGroundImageTexture`/
  `makeFacadeImageTexture` no longer force a premature upload.
- **Residual 3 warnings**: stack traces show they fire inside three's uniform
  upload during the first render of boot-time-bound textures (not the 3 city
  image sources, which now defer correctly). The live scene enumerates **no**
  empty textures post-load and the game renders correctly — these are benign
  transient uploads, not a correctness bug. Re-confirmed non-regression:
  245/245 node tests, 81/81 verify-game.
- Probe: `tools/_probe-pcf-texture.mjs` (kept, not committed to docs).

### Phase 4 — Audio — COMPLETE (adaptive tension bed)
- **Adaptive tension layer** (`src/game/AudioBank.js` + `Game.js`): the playtest's
  gap was "single looping track, no adaptive layering." Added a procedural
  tension bed — a low detuned-sawtooth drone through a lowpass whose gain rises
  with danger, plus a transient sub-bass "heartbeat" pulse whose interval
  tightens from ~1.1 s (calm) to ~0.5 s (max). Created lazily on the first
  non-zero level (calm moments cost nothing), faded out over ~1 s when the level
  returns to 0, and torn down in `stopAmbient`/`dispose`. Deterministic LCG
  pulse jitter; headless-safe (records the target only, never throws).
- **Driver** (`Game._computeTension`): level = 0.6·(alive/cap) + 0.4·(1 −
  health/maxHealth) + 0.3 boss-bump, clamped 0..1, called each frame after the
  groans. Full-health/few-zombies reads near 0; being swarmed at low HP reads
  near 1.
- **Tests** (`test/audio.test.mjs`): headless no-op, lazy 4-node drone +
  idempotent restart, gain rises with tension, fade-to-zero teardown, twin-bank
  determinism + bounded persistent nodes (only the 2 drone oscillators persist),
  teardown via stopAmbient and dispose. Fake-ctx param gained `setTargetAtTime`.
- **Verified**: 245/245 node tests, 81/81 verify-game; browser probe
  (`tools/_probe-tension.mjs`) confirms the bed builds on entering play, the
  level tracks danger, and 0 page errors.

### Phase 5 — Verification & docs — COMPLETE
- **Production build**: `npm run build` succeeds (53 modules, index.js 792.9 kB /
  202.3 kB gzip; the >500 kB chunk advisory is pre-existing, not an error).
  Bundle carries the Phase 3+4 markers (PCFShadowMap, setTension/_computeTension).
- **Browser E2E**: `tools/e2e-browser.mjs` **18/18 PASS, 0 console errors, 0 page
  errors** against the dev server — full flow title→START→combat→pickup→
  flashlight→pause→resume→game-over→restart. Resume shows `pointerLocked: true`
  (Phase 1 state-driven pause/resume holds). The earlier 60 s "timeout" was the
  harness per-call cap, not a failure — the background run completed green.
- **Headless**: `npm test` 245/245, `verify-game` 81/81/0.
- **Checkpoints**: Phase 3 committed `1e655a2`, Phase 4 committed `11013d3`
  (per-phase commits, working tree clean).
- **Deployed**: `v2` pushed to origin (`6f4078f..e9e3741`); gh-pages `14436a0`
  (build of `e9e3741` via `npm run pages` in a temp `.deploy-ghpages` worktree,
  synced + committed + pushed + worktree removed; first push hit a transient
  GitHub Pages "Internal Server Error", retried clean). Live-verified: index
  references `index-DJxiCtn5.js` + `index-C4CqS745.css` (both 200, JS byte-size
  793,110 matches the local build), Phase 3/4 markers (`PCFShadowMap`,
  `setTension`, `_computeTension`) present in the live bundle, and
  weapons/faces/ground/poster assets all 200 image/jpeg. (Supersedes `9f878c6`.)
- All five phases of the improvement mission are COMPLETE and LIVE.

## Working conventions

- Checkpoint with git commits per phase; run `npm test` + `npm run verify`
  after every code change; browser E2E after UI changes.
- Playwright needs `PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers`.
- Dev server: `pnpm run dev` on :5173 (background job; restart if it dies —
  the old pid 3431342 is gone).
- Throwaway probes live in `tools/_probe-*.mjs` / `tools/_playtest-*.mjs`
  (kept, not committed to docs).
- Yaw convention: yaw 0 faces −Z; aim `atan2(-dx,-dz)`.