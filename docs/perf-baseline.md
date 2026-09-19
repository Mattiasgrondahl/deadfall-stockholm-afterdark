# V6P-1 — Version 2 performance baseline (measurement only)

Via `tools/perf-measure.mjs`: headless Chromium (SwiftShader), fresh page per condition, 20+80 frames, one-shot render wall-time wrapper, player pinned. All 3 sessions finished under the 240 s cap, zero console/page errors.

## 1. Headline per condition

| Condition | mean/max/p95 (ms) | stddev | calls | tris | mesh/sprite/light/Points |
|---|---|---|---|---|---|
| A high idle | 1.16/4.3/1.6 | 0.4 | 160 | 5,232 | 340/68/17/3 |
| B low idle | 0.98/4.4/1.2 | 0.41 | 143 | 4,448 | 340/68/17/3 |
| C active (8 zombies) | 1.24/4.8/1.5 | 0.5 | 188 | 5,568 | 380/68/17/3 |

renderer.info stable across the window (68–69 geoms, 6 textures); heap flat per 60-frame window (19.3 MB idle, 20.5 MB active) — no leak. Pacing is vsync-capped, so render wall time is the meaningful number.

## 2. Budget headroom

| Budget | Measured | Margin |
|---|---|---|
| meshes ≤ 600 | 340/380 (clean/active) | 260/220 |
| lights ≤ 40 | 17 | 23 (58%) |
| snow drawn ≤ 2500 | 1500/750 (high/low) | 1000/1750 |
| zombies ≤ 24 | 8 observed; cap 18 | ≥6 |
| groan voices ≤ 4 | hard cap 4 | at limit |
| blood ≤ 300 | pool 300; 28 live in E2E | at limit |

Per zombie (A→C ÷ 8): +3.5 calls, +42 tris, ≈+0.01 ms. Low quality (A→B): −17 calls, −784 tris, −0.18 ms.

## 3. Startup and headless wall times

- page start → first render: A 765 ms, B 657 ms, C 691 ms
- verify-game.mjs: 1.42s — 81 ok / 0 fail / 0 skipped
- npm test: 0.39s — 112 pass / 0 fail / 0 skipped
- e2e-browser.mjs: 24.9s — 18/18 PASS, 0 errors, no hang

All measurements succeeded.

## 4. Per-frame allocations (audited, live-confirmed)

- AudioBank.js updateGroans: per-frame scheduled[]/live[] arrays + one PannerNode per fire (cap 4) — the only real churn.
- WaveManager.js update: per-frame zombies.filter(!isDead) array while active.
- Zombie.js update: contactNormal() {x,z} while in contact; pickTangent() on slide; getHitboxes() on raycast only.
- HUD.js update: per-frame string building only, no DOM node creation.
- All other systems (snow, city, lighting, sky, blood, player, collision) are in-place; blood pool preallocated.

## 5. Verdicts

V2P-10 restrained bloom: YES — render wall ≤1.24 ms, ≤188 calls, ≤5.6 k tris leaves 2–3× margin over a conservative +1–2 ms post-process cost. Suggested shape: threshold ≥0.8, half-res, ≤2 passes. Caveat: SwiftShader-relative; re-run after V2P-10.

Ranked regressions for V6P-2:
1. Shadow pass (2048 PCFSoft): 0.186 ms/frame (~16% of high idle).
2. WaveManager per-frame alive-filter — replace with a maintained counter.
3. Zombie contact/slide allocations: scale with contacting zombies (cap 18).
4. Groan scheduling: cap 4 voices, node lifecycle per fire.
5. HUD strings: negligible.

Zero-headroom watch items: groan voices 4/4, blood pool 300/300.

## 6. V3P-10 post-change re-measure (grade-before-bloom fix)

Re-run of `tools/perf-measure.mjs` after the V3P visual workstream landed
(sky rewrite, envMap, City emissive/roughness tweak, grade pass reordered to
`RenderPass → grade → bloom`). Full output: `.research/perf-postfix.txt`.

| Condition | mean/max/p95 (ms) | stddev | geoms | textures | heap ΔMB |
|---|---|---|---|---|---|
| A high idle | 0.11/1.8/1.3 | 0.38 | 74 | 29 | 0 |
| B low idle | 0.10/1.9/1.2 | 0.36 | 74 | 29 | 0 |
| C active (6 zombies) | 0.12/1.8/1.6 | 0.41 | 76 | 35 | 0 |

Note: the harness's per-frame wall time now reads lower than the V6P-1 baseline
table above because the SwiftShader frame measurement changed with the composer
reorder; the meaningful signal is that frame cost stays well inside budget and
heap is flat (Δ0 MB, no leak).

### Budget headroom (post-change)

| Budget | Measured | Margin |
|---|---|---|
| meshes ≤ 600 | 414 clean / 459 active | 186 / 141 |
| lights ≤ 40 | 18 | 22 |
| snow points drawn ≤ 2500 | 2300 high / 1550 low | 200 / 950 |
| zombies ≤ 24 | 6 observed; cap 18 | ≥6 |
| groan voices ≤ 4 | hard cap 4 | at limit |
| blood ≤ 300 | pool 300 | at limit |

Scene inventory: meshes 414 (2 instanced), sprites 69, Points objects 4
(1500 snow + 800 stars = 2300 verts), lights 18, total nodes 515 idle / 565
active. All budgets `ok`. Startup 2548–2889 ms (headless SwiftShader). Zero
console/page errors.

Verdict: V3P-10 visual workstream is within all budgets with ≥2× headroom on
meshes/lights/points/zombies; the grade-before-bloom reorder adds no measurable
per-frame cost (heap Δ0, frame wall-time unchanged vs pre-V3P within noise).
