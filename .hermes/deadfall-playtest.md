# Deadfall: Stockholm Afterdark — Phase 0 Playtest & Baseline

Date: 2026-09-22 (session start). Environment: Linux, Node 26, Playwright
Chromium 1.63 (headless, SwiftShader GL), dev server `npm run dev` on :5173.

## What was run

- `npm test` — 244/244 pass, 0 fail (575 ms).
- `npm run verify` — 81 ok / 0 fail / 0 skipped (FULL ACCEPTANCE headless).
- `node tools/e2e-browser.mjs` — 18/18 PASS, 0 console errors, 0 page errors.
- Custom real-input playtest (`tools/_playtest-phase0.mjs`) with screenshots
  in `/tmp/deadfall-shots/` (title, wave-1 start, flashlight on, post-combat,
  wave-2 attempt, paused, game-over, 2560×1080, 820×900).
- Headless 5-minute soak (`tools/_perf-baseline.mjs`).

## Baseline metrics

| Metric | Value |
|---|---|
| Unit tests | 244 pass / 0 fail |
| Headless verify | 81 ok / 0 fail / 0 skipped |
| Browser E2E | 18/18 pass, 0 errors |
| Startup | title screen interactive ~2.5 s after load (dev server) |
| Canvas | full-window (`#game-canvas`), resize handler wired |
| Scene graph (max) | 582 meshes/sprites, 18 lights |
| Max concurrent zombies (cap) | 8 at wave 1 (`cap = min(8+wave, 18)`) |
| Headless sim cost | 0.086 ms/frame (logic only, 5 min soak) |
| Console errors | 0 |
| Console warnings | 2 recurring: `PCFSoftShadowMap deprecated`, `Texture marked for update but no image data found` |
| FPS (headless SwiftShader) | ~2 fps — software GL, NOT representative of real GPU |

## Confirmed working (do not regress)

- Start → wave 1 spawns; movement (WASD), sprint (Shift, stamina drains),
  crouch (C), jump (Space), flashlight (F, battery drains ~1/120 per sec).
- All 5 weapons exist and switch (1–5): axe, shotgun, pistol, sword, sniper.
- Reload (R) works; shotgun 5/30, pistol 12/36, sniper 5/20; axe/sword ∞.
- Aimed shotgun shot at 12 m deals damage (90→68 = 22/pellet × ~3 pellets).
- Ammo drops (+8 reserve), pickup works.
- Pause (P) → PAUSED; resume via re-lock; death → YOU DIED with score;
  restart → wave 1, kills 0, score 0. Mute (M) toggles. Music mute button in HUD.
- Difficulty: NIGHT (normal) / FRENZY (2× speed, flat 50 HP) picker on title.
- Aspect ratios 1280×720, 2560×1080, 820×900 all render without errors.

## Concrete problems found (fix targets)

### P0 — Control contract (Phase 1)
1. **Title controls list is wrong**: shows only 8 rows (WASD/Mouse/LMB/R/Shift/
   F/`1 / 2` Axe-Shotgun/P-Esc). Reality: 5 weapons on keys 1–5, crouch (C),
   jump (Space), zoom (Q), music mute (N). Axe/shotgun labels are stale.
2. **No settings panel at all**: no master/music/effects volume, sensitivity,
   FOV, graphics quality, reduced motion. `Lighting.setQuality` exists but is
   never called from UI; `quality` is hardcoded `'high'`.
3. **No first-run tutorial / control overlay during play.**

### P0 — Pause/resume reliability (Phase 1)
4. **Esc during play does not pause in headless Chromium** (key delivered to
   `Input._onKey`, `inputState.pause` set, but state stayed `playing` in that
   probe; P works). In a real browser Esc also releases pointer lock →
   `handleUnlock()` pauses, so it works there — but the headless result shows
   the pause path is lock-coupled and fragile.
5. **Pause overlay only appears via `pointerlockchange`** (`Screens._onLockChange`).
   If pause happens without a lock change (e.g. P key while lock was never
   acquired), state = paused but the PAUSED overlay is never shown — the player
   sees the live scene with input dead. Verified: `showPause()` is only called
   from the lock listener.
6. **Enter-to-resume depends on pointer lock**: `Screens._onKey` Enter in
   `paused` calls `requestLock()`; if lock fails (headless, or user pressed
   Esc out), resume silently does nothing. Needs a direct fallback.

### P1 — Pacing (Phase 2A)
7. **Idle player dies in ~20 s and never advances past wave 1** (headless soak:
   5 deaths in 2 min, 0 kills). Wave 1 is 8 zombies spawning every 0.7 s with
   no early pressure relief; a passive player is swarmed.
8. **Intermission is 3 s with no composition/threat preview** — the player gets
   no information about what is coming.
9. **Spawn fairness**: spawn points are deterministic but there is no telegraph
   (no light flicker, radio noise, silhouette) before a wave arrives; zombies
   can appear at the nearest point (SAFE list ≤ 87 m) with no warning.

### P1 — Combat feedback (Phase 2C)
10. **No hit confirmation** on the HUD: zero kills/score registered during 30 s
    of browser firing at ~8 m (crosshair spread + no aim assist made hits hard
    to land blind; damage only occurred when aim was forced). No hitmarker, no
    headshot feedback, no damage numbers, no directional damage indicator
    (there is a `_marker` hud path for player damage only).
11. **Melee readability**: axe at 8.5 m dealt 0 (out of reach, no range cue);
    no visible melee arc/range indicator.

### P1 — Audio (Phase 4)
12. **No volume sliders** (master/music/effects). Only mute (M) and music-mute
    (N / HUD button). Mute state is NOT persisted to localStorage.
13. Music is a single looping HTMLAudio track per boss-cycle — no adaptive
    layering (no tension/boss/intermission layers).

### P2 — Visual (Phase 3)
14. `prefers-reduced-motion` not honored anywhere.
15. PCFSoftShadowMap deprecation warning (three 0.185) — should switch to
    PCFShadowMap or explicitly accept.
16. "Texture marked for update but no image data found" warnings — some canvas
    textures upload empty (likely headless-only, but worth guarding).

### P2 — Difficulty (Phase 2E)
17. Only NIGHT/FRENZY. No Blackout/Last-Train resource-pressure mode.
18. FRENZY is pure speed+HP-flatten; no mechanical variety beyond that.

## Baseline screenshots (headless SwiftShader — dim, for reference)

- `/tmp/deadfall-shots/01-title.png` … `09-vp-820x900.png`
  (title, wave-1 start, flashlight on, post-combat, wave-2 attempt, paused,
  game-over, ultrawide, narrow).

## Notes on test methodology

- Headless Chromium cannot acquire pointer lock; playtest fakes
  `input._wasLocked` and forces `player.yaw` to land hits. Real-browser
  behavior must be re-verified in Phase 5 with the same checklist.
- Yaw convention: yaw 0 faces −Z; aiming at (dx,dz) requires
  `yaw = atan2(-dx, -dz)`. (A first probe used atan2(dx,dz) and falsely
  reported zero damage — the game is correct.)