# V2 Final Review (V7P-1)

**Verdict: ACCEPT WITH CAVEATS.** Every acceptance criterion in V2-PLAN (L72–95) passes with concrete evidence. No must-fix defects; the caveats are a documented deferral and minor hygiene items.

## Verified evidence

- `node tools/verify-game.mjs` (re-run this pass): 81 ok / 0 fail / 0 skipped, S1–S10.
- `Math.random` in src/: zero real calls (all grep hits are comments).
- Budgets (verify gates pass): headless boot 340 m + 68 s = 408 ≤ 600; worst case 24 concurrent zombies 496 m + 68 s = 564 ≤ 600; 17 lights ≤ 40; snow 1500 + blood 3 points ≤ 2500; groan voices ≤ 4 (`GROAN_MAX_VOICES`, AudioBank L438); blood instances ≤ 300; concurrent zombies ≤ 18 (WaveManager `cap`) ≤ 24 budget.
- Per-frame allocation spot-checks: Zombie `_cn` scratch (L125, L248 — V6P-2b), WaveManager index-loop count (L120–125 — V6P-2a), snow.js index loops, AudioBank gust tick, Game.js L337–371 — no `new` in the hot path.
- Audio safety: every play path null-guards `ctx`; groan panners tracked `{at, p}` (L33, L441) and disconnected on expiry (L402–408); gusts transient (auto-stopped, L483); soft-clip limiter present (L54–60); autoplay documented in README §Audio & browser autoplay.
- Tests: 21 files cover all V2 subsystems (sky, fog, lighting, city, zombie, wave, player, shotgun, axe, weaponbank, audio, hud, hud-screens, postfx) plus v1; no stale duplicates.
- Docs accurate: README setup/controls match code; V2-CHANGELOG complete through V2P-10b; V2-DECISIONS records the shadow/bloom/fog decisions.
- Secrets grep across src/, tools/, docs/: none found.

## Must-fix

None.

## Should-fix (non-blocking)

1. `HUD.js:177` — two small array literals allocated every frame while the weapon bank is active; use a fixed pair.
2. `AudioBank.js:402` — `updateGroans` rebuilds `_groanVoices` (`const live = []`) each frame while groans are active; bounded ≤ 4 (already accepted in round 31), but in-place splice removes the alloc.
3. `Zombie.js:260` — `pickTangent()` allocates `[tx, tz]` per slide commit; event-driven and rare (project left as-is), could reuse a scratch.
4. `AudioBank.js:33` — comment says `{ at, panner }` but code uses `entry.p`; fix the comment.
5. `WaveManager.js:120,146` — comment "concurrent zombie cap is 24" conflates budget with the actual cap `min(8+wave, 18)`; reword.
6. Housekeeping: delete the 4 untracked probe artifacts (`tools/e2e-probe2.mjs`, `tools/e2e-step-probe.mjs`, `tools/e2e-bloom-diff.mjs`, `.debug-bloom-shot.png`) after V7P-3.

## Confirmed design decisions

- **Bloom: KEEP** current shape (strength 0.25 / radius 0.5 / threshold 0.0 / full-res; PostFX.js L20/L25, Game.js L384). Round-34 pixel-diff probe: active but restrained (31.8% of pixels shifted >8 luminance, mean +3.71/255, bright pixels 1.17% → 1.30%; readability preserved). Deviates from V6P-1's suggested threshold ≥ 0.8 / half-res; retune is explicitly deferred as an optional V7P-3 decision ("do NOT retune without a visual check").
- **Shadows: KEEP ON, no tier** — V2P-6b re-measurement: real-caster cost 0.186 ms/frame ≈ 1.1% of a 16.7 ms frame (shadow-cost.md); 2–3× headroom.
- **Fog ρ = 0.022: KEEP** — fog-sight.md verdict PASS; test gate [0.01722, 0.02382]; corner beacons faint from center by design (local spawn-zone markers).
- **V6P-2a / V6P-2b fixes present** (verified above).
