# Deadfall: Stockholm Afterdark

A first-person zombie survival shooter set in a frozen, snow-covered Stockholm
after dark. Built with **Three.js** and **Vite**, 100% procedural (no external
assets, no backend). Survive the zombie waves, keep your magazine loaded, and
try to see the dawn.

## Setup

Requires Node.js 18+ (tested on Node 26) and npm.

```bash
npm install
npm run dev
```

Then open **http://localhost:5173** in a desktop browser (Chrome or Firefox
with hardware acceleration). Click **START** on the title screen —
pointer lock engages and the first wave starts.

> Notes for this workspace:
> - The npm cache lives inside the project (see `.npmrc`), because `~` is
>   read-only here.
> - If your shell exports `NODE_ENV=production`, npm will skip devDependencies
>   (vite, playwright-core). In that case use
>   `NODE_ENV=development npm install` or `npm install --include=dev`.
>
> On a normal machine plain `npm install` works as usual.

## Other commands

```bash
npm run build      # production build (dist/)
npm run preview    # serve the production build on :4173
npm test           # node:test unit tests for pure game logic
npm run verify     # headless playthrough of the real game in Node (no browser)
node tools/e2e-browser.mjs   # real-browser E2E via Playwright Chromium (run with `npm run dev`)
```

## Controls

| Input | Action |
|---|---|
| W A S D | Move |
| Mouse | Look (pointer lock) |
| Shift | Sprint (drains stamina) |
| Left mouse | Fire (current weapon) |
| R | Reload (shotgun; axe needs no reload) |
| 1 | Switch to the axe |
| 2 | Switch to the shotgun |
| F | Flashlight on/off (battery drains, flickers when low) |
| P / Esc | Pause / resume (Esc releases pointer lock) |
| M | Mute / unmute |

## Gameplay

- Survive escalating waves of three zombie types: walkers, shamblers, screamers.
  Each type has its own idle groan, falling off with distance. Waves get
  tougher and more numerous; a cleared wave triggers a brief respite.
- Two weapons, switched with **1 / 2**: a **shotgun** (5-round magazine, 30
  reserve, spread blast) and a **hand axe** (melee arc, unlimited swings,
  cooldown only). Headshots deal double damage with either weapon.
- Killing a zombie has a ~55% chance to drop a shell box; walk over it to gain
  **+8** reserve. Drops blink and expire after 30 s.
- Kill scoring: walker 10, shambler 15, screamer 25, plus a wave bonus of
  50 × wave. Your best score persists in `localStorage`.
- The flashlight follows your view; its battery lasts ~2 minutes of continuous
  use and flickers as it runs low.
- Blood sprays from every hit.
- When your health hits zero, the run ends — your score and wave are shown on
  the game-over screen — restart and go again.

## Project layout

```
index.html
src/main.js            entry point
src/styles.css         UI styling
src/game/              Game (loop/state), Input, Player, Zombie,
                       WaveManager, CollisionWorld, HUD, Screens,
                       WeaponBank, Axe, Shotgun, AmmoDrops, Flashlight,
                       AudioBank, Blood, Score
src/world/             City (procedural environment), Lighting
test/                  node:test logic tests + headless playthrough (verify-game.mjs)
docs/                  architecture + research notes
```

## Technical notes

- Procedural city: block grid with buildings, streets,
  alleys, streetlights, abandoned vehicles, barricades, falling snow.
- Night atmosphere: exponential fog, moonlight with dynamic shadows, a small
  pool of streetlights that follow the player, generated ambient audio.
- Performance: instanced/Points snow, bounded zombie count, light pooling,
  no per-frame allocations in hot loops, delta-time movement.

## Agent code navigation (dev tooling)

Two local, key-free indexers are wired into this repo for coding agents (see
`AGENTS.md` for usage guidance):

- **graft** — deterministic tree-sitter code graph, no model, no network:
  `npm run graft -- ask "..."`, `npm run graft -- skeleton src/game/Zombie.js`,
  `npm run graft -- callers setState`, `npm run graft -- grep "requestLock"`,
  `npm run graft-map`. Sub-second on this repo; refresh with `npm run graft-build`.
- **zg** (zvec-grep) — semantic search over code and docs using a local
  embedding model (16M params, CPU): `npm run zg -- query "how do zombies
  steer around obstacles"`; reindex with `npm run zg-index` (~10 s, model
  cached in git-ignored `.zvec-home/`).

Both index caches (`graft/`, `.zvec-grep/`, `.zvec-home/`) are git-ignored
and regenerable; they are never part of the game build.

## Verification

- `npm test` — unit tests for the pure game logic (collision, input, player,
  weapon, zombie steering, waves, city, lighting, HUD/Screens, audio).
- `npm run verify` — a headless playthrough of the **real** `Game` and its
  subsystems in Node (S1–S10: state machine, movement/collision, death/restart,
  weapons, zombie AI, wave cadence/scaling, a full 3-wave clear, scene budgets,
  deterministic ammo drops + pickup, flashlight toggle/battery + score
  increments). It exercises the game logic end-to-end but uses a stub renderer,
  so it does **not** test real WebGL rendering or pointer-lock aiming.
- `npm run build` — production build; confirms every module resolves and bundles.
- Real browser: open `http://localhost:5173` and click **START**. WebGL
  rendering, pointer-lock mouse aiming, and generated audio all require a
  desktop browser with hardware acceleration. `node tools/e2e-browser.mjs`
  automates the whole flow (title → START → gameplay → pause → resume →
  game-over → restart) and asserts there are no console or page errors; it
  needs a Playwright Chromium (`node node_modules/playwright-core/cli.js
  install chromium`).
