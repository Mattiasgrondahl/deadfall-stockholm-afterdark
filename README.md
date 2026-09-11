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
| Left mouse | Fire |
| R | Reload |
| P / Esc | Pause / resume (Esc releases pointer lock) |
| M | Mute / unmute |

## Gameplay

- Survive escalating waves of three zombie types: walkers, shamblers, screamers.
- Headshots deal double damage. The magazine holds 12 rounds; reserve holds 60.
- Waves get tougher and more numerous (health scales, count grows). A cleared
  wave triggers a brief respite before the next one.
- When your health hits zero, the run ends — restart and go again.

## Project layout

```
index.html
src/main.js            entry point
src/styles.css         UI styling
src/game/              Game (loop/state), Input, Player, Weapon, Zombie,
                       WaveManager, CollisionWorld, Audio, HUD, Screens
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

## Verification

- `npm test` — unit tests for the pure game logic (collision, input, player,
  weapon, zombie steering, waves, city, lighting, HUD/Screens, audio).
- `npm run verify` — a headless playthrough of the **real** `Game` and its
  subsystems in Node (S1–S8: state machine, movement/collision, death/restart,
  weapon, zombie AI, wave cadence/scaling, a full 3-wave clear, scene budgets).
  It exercises the game logic end-to-end but uses a stub renderer, so it does
  **not** test real WebGL rendering or pointer-lock aiming.
- `npm run build` — production build; confirms every module resolves and bundles.
- Real browser: open `http://localhost:5173` and click **START**. WebGL
  rendering, pointer-lock mouse aiming, and generated audio all require a
  desktop browser with hardware acceleration. `node tools/e2e-browser.mjs`
  automates the whole flow (title → START → gameplay → pause → resume →
  game-over → restart) and asserts there are no console or page errors; it
  needs a Playwright Chromium (`node node_modules/playwright-core/cli.js
  install chromium`).
