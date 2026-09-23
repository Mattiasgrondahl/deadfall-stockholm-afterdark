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

### Phase 2 — Gameplay depth — NOT STARTED
2A pacing (longer meaningful intermission + threat preview + spawn telegraphs),
2B enemy roles (windups, audio signatures, avoidance), 2C weapon identity +
hit confirmation, 2D one lightweight decision mechanic, 2E Blackout mode.

### Phase 3 — Visual/atmosphere — NOT STARTED
### Phase 4 — Audio — NOT STARTED
### Phase 5 — Verification & docs — NOT STARTED

## Working conventions

- Checkpoint with git commits per phase; run `npm test` + `npm run verify`
  after every code change; browser E2E after UI changes.
- Playwright needs `PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers`.
- Dev server: `pnpm run dev` on :5173 (background job; restart if it dies —
  the old pid 3431342 is gone).
- Throwaway probes live in `tools/_probe-*.mjs` / `tools/_playtest-*.mjs`
  (kept, not committed to docs).
- Yaw convention: yaw 0 faces −Z; aim `atan2(-dx,-dz)`.