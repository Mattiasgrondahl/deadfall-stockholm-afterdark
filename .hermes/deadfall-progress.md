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

### Phase 1 — Core UX & control contract — NOT STARTED
Targets: correct control list; first-run overlay; reliable pause/resume
(overlay shown on state change, not only via lock; Enter fallback); settings
panel (master/music/effects volume, sensitivity, FOV, flashlight quality,
reduced motion, graphics low/high); persistent mute; out-of-ammo/reloading/
next-wave feedback.

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
- Dev server already running on :5173 (pid 3431342) — reuse it.
- Throwaway probes live in `tools/_probe-*.mjs` / `tools/_playtest-*.mjs`
  (kept, not committed to docs).
- Yaw convention: yaw 0 faces −Z; aim `atan2(-dx,-dz)`.