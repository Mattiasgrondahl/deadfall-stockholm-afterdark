# Version 2 — Decisions Log

Record important visual, audio, and architecture decisions as they are made
(one entry each: decision, rationale, where it lives).

- v1 frozen at `feat/iteration-2` (3ddf023); v2 work on branch `v2`; merge
  v2→v1 only after full acceptance. (carried from V1–V13)
- Gameplay V2 scope (axe+shotgun, flashlight, drops, score, blood, groans)
  completed in tasks V1–V13; the current run covers visual/atmosphere/audio/
  presentation/performance phases only, per docs/V2-PLAN.md.
- GPU-1 children are unreliable in this deployment (multiple pre-write deaths).
  Escalation policy: after 3 consecutive GPU-1 child failures on the same task,
  the orchestrator performs the task directly on GPU-0 and records the escalation.
  Round-1 evidence: the broad V2P-1 spec (file + wiring + tests + 4 test runs)
  killed a GPU-1 child pre-write; the narrowed single-file spec succeeded.
  → Keep GPU-1 delegations single-file / single-deliverable where possible.
- V2P-1 sky: the dome follows the player each frame (position.copy), so the
  shader gradient stays view-relative; the moon is placed along the same
  direction as Lighting.js moonlight (MOON_OFFSET -18,30,-15) so the lit side
  matches shadow direction; moon + silhouettes use fog:false because FogExp2
  density ~0.032 fully hides 360–400 m objects; silhouette layout uses a
  glibc-style LCG (s=(s*48271)%65537, seed 9137) — always non-negative, same
  family already accepted in the V13 review.
- V2P-2 palette & materials: night look achieved by retuning material parameters
  only, never geometry or layout — LCG seed/call order untouched so city layout
  stays byte-identical. Per-zone tint = multiplicative scalar on the LCG-picked
  base color (center ×1.12 → outskirts ×0.78) to give the city a subtle
  brightness gradient at near-zero cost (no new materials, no new meshes).
  Roughness/metalness retuned (buildings 0.88/0.05; metal dressing
  0.5–0.65 / 0.2–0.35) so streetlights + moonlight produce visible specular
  response instead of flat matte surfaces. Streetlight head emissive left
  as-is: falloff curve + warm halo belong to V2P-5.
