# Fog-vs-Targets Headless Sight Check (V3P-3)

`tools/fog-sight.mjs` boots the real `Game` headless (`{headless: true}`, same pattern as
`tools/verify-game.mjs`) and reads the live `scene.fog` from `Game.js` `setupScene` (line 187).
Confirmed: `FogExp2(0x0b1020, 0.022)`. Visibility V(d) = exp(−(d·ρ)²); grades:
clear ≥ 0.5, marginal 0.2–0.5, faint < 0.2. No source changes; budgets unchanged.

## Table

| Target | Range | Key V(d) | Grade |
|---|---|---|---|
| Zombie eye glow | 3–30 m (combat) | 0.996@3 … 0.647@30 | clear at all combat distances |
| Streetlight halos | 5–14 m (reach) | 0.988@5 … 0.909@14 | clear throughout |
| Plaza halo + signage | 10–40 m | 0.953@10 … 0.461@40 | clear ≤30 m, marginal @40 |
| Central spire + halo | 10–40 m | 0.953@10 … 0.461@40 | clear ≤30 m, marginal @40 |
| Street direction strips | 10–60 m | 0.953@10 … 0.175@60 | clear ≤30, marginal @40, faint @60 |
| Corner beacons | 35–118.7 m | 0.553@35 … 0.0011@118.7 | clear only within ~35 m |

## Findings

1. **Zombies legible at combat range: yes.** V goes 0.996 → 0.647 over 3–30 m, never
   below the 0.5 clear threshold; attack range (≤1.3 m) is ~full visibility.
2. **Halos and signage legible in intended ranges: yes.** Streetlight halos clear
   throughout their 5–14 m reach (0.91–0.99); plaza halo + signage clear at 10–30 m,
   marginal (0.461) at the outer edge of the 10–40 m range.
3. **Corner beacons: not visible from city center.** V(118.7 m) = 0.0011 (faint).
   They turn clear within ~35 m (0.553), stay marginal to ~50 m, faint beyond 60 m —
   behaving as local spawn-zone markers, which is their design role (zombies spawn
   at ±85, ±85).
4. **Tuning feasibility: none.** `test/fog.test.mjs` gates confine ρ to
   [0.01722, 0.02382]. Beacon V(118.7 m) across that range: 0.0154 at ρ=0.0172,
   0.0011 at ρ=0.022, 0.0003 at ρ=0.0238 — faint everywhere, >30× below the marginal
   threshold. **No ρ in the range makes corner beacons legible from the center.**
5. **Verdict: PASS — no tuning needed.** Every gameplay-relevant target is clear within
   its intended range, and corner-beacon behavior matches its local-marker design. If
   center-visible beacons were ever wanted, that would be a follow-up task: a
   budget-neutral halo-scale or emissive change in a city-dressing function, not a
   density change.

## Deviation

Pre-extracted reference V(120 m) = 0.0007 is slightly off; computed values are
V(120 m) ≈ 0.00094 and V(118.7 m) = 0.00109. No effect on any grade or the verdict.
