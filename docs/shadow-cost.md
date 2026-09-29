# V2P-6a — Moon shadow map per-frame cost (measured)

Method: real headless Chromium (Playwright, 1280×720, SwiftShader software
rasterization) against the running dev server; player pinned at world
(12, y, 0), health pinned at 100. Render cost timed inside `renderer.render`
via a one-time wrapper; raw rAF deltas collected separately. 3 conditions ×
3 runs; first 20 samples per run discarded. 80 frames per run (60 effective →
180 effective samples per condition, the same effective total as the 200-frame
design) because measured headless pacing (~102 ms/frame) would push 9 × 200
frames past the 120 s hard cap; the initial 200-frame attempt timed out as
expected. Zero restarts, zero console/page errors, state 'playing' throughout.

## Render-call cost (ms/frame; mean / median / p95, 180 samples per condition)

| Condition | mean | median | p95 | rAF delta mean / p95 | calls* | tris* |
|---|---|---|---|---|---|---|
| A high (shadow ON, 12 pt lights, snow 1500) | 0.888 | 0.80 | 1.1 | 103.6 / 134.5 | 106 | 4128 |
| B no-shadow (shadow OFF, 12 pt lights, snow 1500) | 0.793 | 0.70 | 1.0 | 99.6 / 130.7 | 106 | 4128 |
| C low (shadow OFF, 6 pt lights, snow 750) | 0.723 | 0.70 | 0.9 | 103.7 / 130.4 | 106 | 4128 |

Per-run means: A 0.903 / 0.953 / 0.808 · B 0.773 / 0.860 / 0.745 · C 0.722 / 0.713 / 0.733.
\* `renderer.info.render.calls` / `.triangles` of the last frame of each run; identical across all 9 runs.

## Derived costs

- Shadow-only cost (mean A − mean B): **0.095 ms/frame**
- Full-fallback saving (mean A − mean C): **0.165 ms/frame**

## Interpretation

1. The moon shadow pass is currently an *empty* pass: `render.calls` and
   `render.triangles` are identical in A, B, and C, and the only `castShadow = true`
   anywhere in the game is the moon light itself (`src/world/Lighting.js:31`) — no
   mesh ever casts, so the 2048² shadow map renders nothing every frame. The
   0.095 ms delta is that idle pass (RT bind/clear + traversal), at the noise
   floor of run-to-run variation in this headless setup.
2. vsync is not masking: headless rAF pacing ran 37.5–145 ms (mean 102.3 ms) per
   frame under SwiftShader, so render-call wall time is the authoritative metric,
   and it shows the whole scene (106 draw calls, 4128 triangles) submits in under
   1 ms. Per-condition full-frame delta means barely differ (103.6 / 99.6 / 103.7
   ms): base-scene rasterization load dominates, not the shadow.
3. `setQuality('low')` buys ~0.165 ms/frame here — real but tiny against a
   16.7 ms budget, and the data does not justify a 1024 mapSize tier or a
   smaller shadow frustum today: with no casters, neither parameter changes the
   measured cost at all.
4. These numbers are a lower bound for a build that actually enables casting
   meshes; if real casters enter the frustum, the shadow pass must be
   re-measured before any mapSize/frustum tier decision.

V6P-1 citation: at 1280×720, 2048² PCFSoft, frustum ±22 m, player pinned at
(12, y, 0): V2P-6a measured the idle shadow pass at 0.095 ms/frame (no casters
in the scene); V2P-6b enabled real casters and re-measured — see the
"V2P-6b re-measurement" section below for the current numbers.

## V2P-6b re-measurement — real casters enabled (round 8)

Cast enabled (commit 566e555): all city building boxes (`City.js` factory),
streetlight poles (`cityDressing.js`), and all six body meshes per zombie
(`Zombie.js`); ground `receiveShadow = true`. Moon light settings unchanged
(2048² PCFSoft, frustum ±22 m, near 1 / far 120, bias 0.004 / normalBias
0.05). Same probe, same pin (player (12, y, 0)); numbers below are the
orchestrator's independent re-run (the child's run agreed within run-to-run
noise).

| Condition | mean | p95 | calls | tris |
|---|---|---|---|---|
| A high (shadow ON, casters live) | 0.994 | 1.2 | 134 | 5044 |
| B no-shadow (shadow OFF, casters live) | 0.808 | 1.0 | 106 | 4128 |
| C low (shadow OFF, 6 pt lights, 750 snow) | 0.737 | 0.9 | 106 | 4128 |

- Shadow-only real-caster cost (A−B): **0.186 ms/frame** (child's run: 0.18;
  idle pass in V2P-6a: 0.095 — live casters roughly double the shadow-pass
  cost, still ~1.1% of a 16.7 ms frame budget).
- Full-fallback saving (A−C): 0.257 here, but C ≈ B within 0.07 ms in the other
  two runs, so the non-shadow part of low quality saves ~0–0.07 ms/frame.
- The shadow pass now does real work: +28 draw calls / +916 triangles vs B
  (casters inside the ±22 m frustum: building boxes, poles, zombie bodies).
- Zero console/page errors; state 'playing' throughout; probe exit 0.
