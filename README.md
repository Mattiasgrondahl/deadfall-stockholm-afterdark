# Deadfall: Stockholm Afterdark

A first-person zombie survival shooter set in a frozen, snow-covered Stockholm
after dark. Built with **Three.js** and **Vite**, 100% procedural (no external
assets, no backend). Survive the zombie waves, keep your magazine loaded, and
try to see the dawn.

## Play online

The game is deployed from the `gh-pages` branch — no install needed:

**https://mattiasgrondahl.github.io/deadfall-stockholm-afterdark/**

Open it in a desktop browser (Chrome or Firefox, hardware acceleration on) and
click **START**. Audio starts after the START click, per browser autoplay rules.

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
npm run pages      # production build with base /deadfall-stockholm-afterdark (GitHub Pages)
npm test           # node:test unit tests for pure game logic
npm run verify     # headless playthrough of the real game in Node (no browser)
node tools/e2e-browser.mjs   # real-browser E2E via Playwright Chromium (run with `npm run dev`)
node tools/e2e-faces.mjs     # E2E probe: face textures loaded in-browser (run with `npm run dev`)
node tools/e2e-walk.mjs      # E2E probe: two-frame walk-cycle check (run with `npm run dev`)
node tools/generate-zombie-faces.mjs  # regenerate the face textures (needs WanGP app running on :7860)
```

> To redeploy the online version: run `npm run pages`, replace the contents of
> the `gh-pages` branch with `dist/`, and push it — GitHub Pages republishes
> automatically.

## Controls

| Input | Action |
|---|---|
| W A S D | Move |
| Mouse | Look (pointer lock) |
| Shift | Sprint (drains stamina; the flashlight does not block it) |
| Space | Jump |
| C | Crouch (disables sprint) |
| Left mouse | Fire (current weapon) |
| R | Reload (firearms; melee weapons need no reload) |
| 1 | Switch to the axe |
| 2 | Switch to the shotgun |
| 3 | Switch to the pistol |
| 4 | Switch to the sword |
| 5 | Switch to the sniper |
| F | Flashlight on/off (battery drains, flickers when low; holding it burns stamina while you are not sprinting) |
| P / Esc | Pause / resume (Esc releases pointer lock) |
| M | Mute / unmute |
| N | Mute / unmute the music only (SFX stay audible) |

## Gameplay

- Survive escalating waves of four zombie types: walkers, shamblers, screamers
  and the brute boss (every 5th wave). Each type has its own idle groan,
  falling off with distance. Waves get tougher and more numerous; a cleared
  wave triggers a brief respite with a countdown and next-wave preview.
- Five weapons, switched with **1–5**: an **axe** (melee arc, unlimited
  swings), a **shotgun** (5-round magazine, 30 reserve, 6-pellet spread
  blast), a **pistol** (12-round magazine, 36 reserve), a **sword** (melee)
  and a **sniper** (5-round magazine, 20 reserve, high damage). Headshots
  deal double damage with firearms. The run starts with the shotgun.
- Killing a zombie has a ~55% chance to drop a shell box (**+8** shells) and
  an ~18% chance to drop a battery (**+35%** flashlight charge). Drops blink
  and expire after 30 s.
- Kill scoring: walker 10, shambler 15, screamer 25, brute 150, plus a wave
  bonus of 50 × wave. Your best score persists in `localStorage`.
- The flashlight follows your view; its battery lasts ~2 minutes of continuous
  use and flickers as it runs low. A dead battery cannot be switched back on —
  grab a battery pickup.
- Sprint burns stamina fast and refills when you stop; standing still with the
  flashlight on drains it slowly, so light and endurance trade off.
- Blood sprays from every hit.
- The title screen offers a **FRENZY** difficulty toggle: zombies run 2×
  faster and bodies take two pistol shots unless you land a headshot.
- When your health hits zero, the run ends — your score and wave are shown on
  the game-over screen — restart and go again.

## Audio & browser autoplay

All sound is synthesized in real time by WebAudio (`AudioBank`) — oscillators,
filtered noise bursts, and an LFO-driven ambient bed. No audio assets are
loaded or downloaded.

**Procedural music.** The soundtrack is generated, not streamed: three
distinct procedural tracks (`MusicEngine`) — **ambient** (slow, calm pad for
exploration), **combat** (driving pulse and minor riff), and **crisis**
(fastest, most urgent, for boss waves and high danger). A `MusicDirector`
picks the track from game state: early/cleared waves play ambient, combat
waves play combat, boss waves (every 5th) and high tension switch to crisis,
and pausing pauses the music while game-over and restart reset the playlist
safely. Switches crossfade over ~0.8 s so there are no clicks, and each track
loops its fixed pattern seamlessly. Track selection lives entirely in the
audio subsystem — never in `Game.js`. `musicState()` exposes the current
track and playlist for tests. **N** mutes only the music; **M** mutes
everything.

**Autoplay.** Browsers start a fresh `AudioContext` in the *suspended* state
until a user gesture happens; the game relies on that rule instead of fighting
it. The context is resumed lazily on the first sound call, and the first
sounds only ever follow your **START** click, an **Enter** press, or a
pointer-lock gesture. Consequences:

- In a browser with strict autoplay policy you will hear nothing until you
  click START — expected browser behaviour, not a bug. The game is fully
  playable without audio.
- Pausing stops the ambient bed; resuming restarts it after your gesture.
- Headless Node (unit tests, `npm run verify`) has no `AudioContext` at all:
  `ctx` stays `null` and every audio method is a no-op, so all logic runs
  without a real audio device.

**What you hear.** Ambient: a wind bed with LCG-scheduled gusts plus a
distant city hum/rumble. Feedback: weapon fire, reload, dry-fire (a rejected
shot clicks), per-type zombie groans (fall off over 30 m, at most 4 at once,
positioned around you), zombie attack and death, player damage, wave-cleared
chime, game-over sting, start/restart chime, ammo pickup, flashlight click,
and weapon switch. **M** mutes everything.

**Node budget.** The only persistent audio graph is the master gain, the
soft-clip limiter, and the 10-node ambient bed. Every one-shot voice is a
transient graph that stops itself when it ends, and the groan scheduler keeps
at most 4 concurrent voices, so audio nodes never grow without bound. A
soft-clip limiter after the master bends any over-driven mix (worst case
~1.9 before it) instead of hard-clipping.

## Project layout

```
index.html
src/main.js            entry point
src/styles.css         UI styling
src/game/              Game (loop/state), Input, Player, Zombie,
                       WaveManager, CollisionWorld, HUD, Screens,
                       WeaponBank, Axe, Shotgun, AmmoDrops, Flashlight,
                       AudioBank, Blood, Score, PostFX (optional bloom), ray
src/world/             City (procedural environment), cityDressing, Lighting,
                       sky, snow
test/                  node:test logic tests + headless playthrough (verify-game.mjs)
docs/                  architecture + research notes
```

## Technical notes

- Procedural city: block grid with buildings, streets,
  alleys, streetlights, abandoned vehicles, barricades, falling snow.
- Night atmosphere: exponential fog, moonlight with dynamic shadows, a small
  pool of streetlights that follow the player, generated ambient audio.
- Zombie faces: each zombie type wears a face texture (960×960 JPEG in
  `public/assets/faces/`, generated with Z-Image + a personal-likeness LoRA via
  the local WanGP app; regenerate with `tools/generate-zombie-faces.mjs`). The
  face is a small plane nested under the head using one shared material per
  type; it loads async in the browser and falls back to the flat head color in
  headless runs or if the load fails. Corpses lose the face on death.
- Walk cycle: a deterministic per-zombie phase (fixed-seed LCG) drives the
  arms and legs in opposite phase, synchronized with the body bob; corpses
  reset to the rest pose.
- Performance: instanced/Points snow, bounded zombie count, light pooling,
  no per-frame allocations in hot loops, delta-time movement. An optional
  restrained bloom pass (EffectComposer + UnrealBloomPass, strength 0.25,
  full resolution) runs after the scene render; it is disabled automatically
  in headless runs, costs ~1 ms/frame, and leaves all documented budgets
  intact.

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

## Multiplayer (server-authoritative co-op)

Up to 8 players share one room over WebSockets (see `MULTIPLAYER_PLAN.md`).
The server owns the simulation (20 Hz tick) and broadcasts 10 Hz snapshots;
clients predict their own movement and interpolate everyone else.

- **Run the server:** `npm run server` (defaults to `PORT=8080`). It serves the
  built `dist/` over HTTP **and** the WebSocket on the same origin at `/ws`
  (single-origin hosting). Build first with `npm run build`, or point it at a
  dev build.
- **Join a room:** a client opens a `WebSocket` to `ws://<host>:8080/ws`, sends
  a `hello` frame, receives a `welcome` with its assigned `pid`, then streams
  `input` frames and consumes `snap` frames. `src/net/NetClient.js` implements
  this; `src/net/protocol.js` defines the wire schemas.
- **Headless netcode tests:** `test/server-room.test.mjs`,
  `test/net-client.test.mjs`, `test/match-flow.test.mjs`, and
  `test/remote-player.test.mjs` (8-player mesh budget) run the whole server +
  client + match-flow path without a browser.
- **Hosting:** GitHub Pages cannot run a persistent WebSocket server, so the
  socket server needs an always-on host (a small VPS, Railway/Render/Fly, or a
  home machine with a public port). The static game can stay on Pages while the
  server runs elsewhere — the client just needs the server URL.
