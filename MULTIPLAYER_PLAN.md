# Multiplayer Plan — "Deadfall: Stockholm Afterdark" (8-player, server-hosted)

> Status: **design / planning only** — no implementation yet. This document is the
> roadmap for adding a server-hosted 8-player mode on top of the existing
> single-player game. It is intentionally concrete: every section maps to real
> files and functions in the current codebase.

---

## 1. Goal

Add a **server-hosted multiplayer mode** where up to **8 players** share one
live map (the existing Stockholm city) and fight shared waves of zombies
together, with per-player health, score, kills, and a lobby. The game is
hosted by a server that players connect to (not peer-to-peer).

Non-goals for this plan:
- No economies, trading, accounts, or anti-DDoS hardening (out of scope).
- Not a 100+ player battle-royale; the map and budgets are sized for ~8.

---

## 2. Architecture decision: server-authoritative

**Recommendation: a server-authoritative model over WebSockets.** The server
runs the authoritative simulation; clients send inputs and receive state
snapshots, then render.

Why this fits *this* codebase specifically:

1. **The game already runs headless in Node.** `Game` has a `headless` flag
   and an `env` object that stubs browser-only services (renderer, document,
   window, canvas factory). The complete gameplay logic (movement, collision,
   zombie AI, weapon hit detection, waves, score) already runs as real
   THREE objects in Node with no DOM. That means the server can literally
   reuse the simulation layer almost unchanged — the single biggest cost of a
   multiplayer retrofit is already paid.
2. **Combat is resolved deterministically at fire time.** Every weapon
   (`Pistol`, `Shotgun`, `Sword`, `Axe`) computes hits with pure math
   (range, arc, raycast against `CollisionWorld`) the instant `shoot()` /
   `swing()` is called. That is exactly what a server needs to authoritatively
   resolve damage, knockback, and kills.
3. **`CollisionWorld` is pure 2D math** (no THREE imports) — trivially runnable
   in Node, and it already provides `resolve`, `isWalkable`, and `castRay`
   (raycast is what bullets use to stop at walls).
4. **No `Math.random` in `src`** — the game is already deterministic (LCG /
   fixed seeds). That is a bonus: if we ever want lockstep, replays, or
   deterministic re-simulation for debugging, the foundation exists.

### Alternatives considered and rejected

| Approach | Why not |
|---|---|
| **Lockstep P2P** (all 8 clients run the identical sim, exchange only inputs) | Fragile to desync; the slowest client blocks everyone (barrier); one drop tears down the room; cheat-prone; hard to host. Not a good fit for "host on a server." |
| **Client-simulated, server only for combat** | Desync-prone; duplicates simulation logic; more moving parts; the server can't guarantee consistent world state. |
| **Server-authoritative** ✅ | Single source of truth, cheat-resistant for combat, reuses the existing headless sim, scales cleanly at 8 players, trivially hostable. |

---

## 3. Reuse map: what already exists, and where it lives

| Subsystem | File | Headless-safe? | Server role | Client role |
|---|---|---|---|---|
| Orchestrator / loop | `src/game/Game.js` | Yes (`headless` flag) | Reuse `step()`/`update()` as the authoritative tick | Reuse for local render + local prediction |
| Player controller | `src/game/Player.js` | Yes (pure math + THREE vecs) | Authoritative position/health/stamina | Local prediction, corrected by server |
| Zombies | `src/game/Zombie.js` | Yes (AI + damage are pure logic) | Authoritative AI, damage, `knockback`, death | Render interpolated state |
| Collision | `src/game/CollisionWorld.js` | Yes (pure 2D math) | `resolve`/`isWalkable`/`castRay` | (server resolves; client only renders) |
| Weapons (4) | `Pistol/Shotgun/Sword/Axe.js`, `WeaponBank.js` | Yes (hits are pure math) | Resolve hits, ammo, knockback | View model + effects from events |
| Waves | `src/game/WaveManager.js` | Yes | Drive spawns, wave counter, remaining | Render spawns + wave banner |
| Score | `src/game/Score.js` | Partial (localStorage is browser-only) | Per-player score, leaderboard | Show own + scoreboard |
| Blood / heads / drops | `Blood.js`, `DecapitatedHeadPool.js`, `AmmoDrops.js` | Partial (visual) | Trigger events (authoritative) | Render particles / meshes |
| City (collision + visuals) | `src/world/City.js` | Split: AABBs reusable, geometry visual | Register AABBs into `CollisionWorld` | Build & render geometry (shared map) |
| Lighting / sky / snow / dressing | `src/world/*` | Visual only | — (server needs no visuals) | Render locally |
| HUD / Screens / Input / Audio / PostFX | `src/game/{HUD,Screens,Input,AudioBank,PostFX}.js` | Browser only | — | Render / capture input / play audio |

**Key takeaway:** the entire *logic* column is already Node-safe. The server
is mostly *glue* (network + tick loop) around code we already have and already
unit-test headlessly. The *visual* column stays 100% client-side, which is
correct for a game (the server never renders).

---

## 4. Server design

### 4.1 Authoritative core

Introduce a thin `Match` (working name) that owns the shared simulation, built
from the existing pieces. It is essentially `Game.update()` + the spawn/kill
bookkeeping, minus all rendering/HUD/screens/input/audio-visual concerns:

```
Match (Node, headless)
├── collision : CollisionWorld      (City AABBs registered once)
├── players   : Map<id, Player>     (up to 8; Player reused as-is)
├── zombies   : Zombie[]            (bounded by WaveManager)
├── weapons   : per-player WeaponBank
├── wave      : WaveManager
├── score     : per-player score table
├── blood/heads/drops : event sources (visuals emitted as events, not kept)
└── step(dt)  : runs player.update, weapon.update, zombie.update, waves,
                collision resolves, kill bookkeeping  ← mirrors Game.update()
```

Because `Game` already does exactly this in `update()` (`src/game/Game.js`
lines 348–384), the cleanest path is one of:
- **Option A (preferred):** refactor `Game.update()` into a reusable
  `updateWorld(dt, {players, zombies, ...})` core that both the single-player
  `Game` and the multi-player `Match` call. Low risk — the single-player path
  keeps working and stays covered by existing headless tests.
- **Option B:** `Match` composes the subsystems directly (duplicates the
  ~40-line update loop). Simpler to start, more duplication later.

### 4.2 Tick model

- **Simulation tick: 20 Hz** (`dt = 50 ms`), driven by a `setInterval` (or a
  monotonic-clock accumulator to drift-correct). This is smooth for zombie
  AI + melee arcs and cheap in Node.
- **Snapshot broadcast: 10 Hz** (every 2 ticks) to keep bandwidth low while
  still feeling responsive; remote entities are interpolated client-side.
- **Input ingest: continuous** (clients send inputs as they occur, up to
  ~30 Hz; the server applies the latest input state each tick).

### 4.3 Rooms

- A `Room` = one `Match` + a roster of up to **8** player slots.
- `server.js` (Node) runs an HTTP + WebSocket server:
  - Serves the built game (static files from `dist/`) so one origin hosts both
    the game and the socket. (Alternatively, the static build stays on gh-pages
    and the socket server is a separate host — see §10.)
  - `POST /room` or a `join` WebSocket message → assign a room id + player id.
  - Enforces the 8-player cap; rejects or queues overflow.
  - On disconnect: mark slot dead/spectating, run a short grace period, then
    drop the player from the sim.

### 4.4 Server-side validation (anti-cheat)

Because the server is authoritative, clients cannot inject damage directly.
Still, clamp inputs so a bad client can't poison the sim:
- Movement axes ∈ [-1, 1]; look deltas clamped to sane magnitudes per tick.
- Fire/reload/switch edges are booleans — no magnitude to abuse.
- Weapon fire rate / swing cooldown already enforced inside each weapon
  (`COOLDOWN`, `SWING_TIME`), so a client spamming `fire` can't exceed the
  weapon's real rate.
- Player position is authoritative (server integrates movement), so a client
  cannot teleport.

---

## 5. Network protocol

Transport: **WebSocket** (the `ws` package on Node). JSON messages for
clarity; can be switched to binary/flatbuffers later if bandwidth becomes an
issue (it won't at this scale).

### 5.1 Client → Server (input)

```
{ "t": "input", "pid": <playerId>, "tick": <clientTick>,
  "move": { "fwd": -1..1, "side": -1..1 },   // derived from WASD + yaw
  "sprint": bool,
  "look": { "dx": <yawDelta>, "dy": <pitchDelta> },  // accumulated since last send
  "fire": bool, "reload": bool,
  "jump": bool,
  "switch": 0..3 | null }
```

- `fwd`/`side` are computed client-side from the local yaw (same math as
  `Player.update`, `src/game/Player.js` lines 63–71) so the server only needs
  the final world-space direction — cheaper than raw key bits and resists
  keybind mismatches.
- `look.dx` drives authoritative yaw (needed so other players see your
  orientation); `look.dy` (pitch) is purely visual and can stay local, but
  sending it is cheap and keeps remote avatars' view plausible.

### 5.2 Server → Client (snapshot, ~10 Hz)

```
{ "t": "snap", "tick": <serverTick>,
  "players": [
    { "id", "x", "z", "y", "yaw", "pitch", "health", "stamina",
      "weapon": "axe|shotgun|pistol|sword", "ammo", "reserve",
      "swing": 0..1,            // current swing phase 0=rest,1=mid-strike (for anim)
      "dead": bool }
  ],
  "zombies": [
    { "id", "type", "x", "z", "health", "state": "idle|chase|attack|stagger|dead",
      "facing": yaw }
  ],
  "wave": n, "remaining": n,
  "score": { "<pid>": <points> },
  "kills": { "<pid>": <count> },
  "events": [
    { "k": "hit", "victim": zombieId|playerId, "by": pid, "dmg": n, "head": bool },
    { "k": "kill", "victim", "by", "type" },
    { "k": "death", "victim", "by" },
    { "k": "waveStart", "wave" }, { "k": "waveCleared", "wave" },
    { "k": "drop", "x", "z" }, { "k": "decapitate", "zombieId", "dir" }
  ] }
```

- Events are appended only when they happen since the last snapshot, so
  clients replay effects (blood, hit marker, kill feed, groans, banners).
- Zombie `state` maps to the existing pose machine in `Zombie.js` so the
  client can render the correct pose (idle/chase/attack/stagger/dead) instead
  of only interpolating position.

### 5.3 Bandwidth estimate (8 players, worst case)

- Per snapshot: 8 players × ~80 B + 24 zombies × ~60 B + events ≈ **~2 KB**.
- At 10 Hz → **~20 KB/s outbound per client**. Inbound (inputs) ≈ 30 Hz ×
  ~60 B ≈ **~2 KB/s**.
- Total per client ≈ **~25 KB/s** — well within a typical home connection and
  trivial for a Node server serving 8 sockets.

### 5.4 Client-side prediction & interpolation

- **Local player (self):** predict movement locally using the existing
  `Player.update` on the client (identical code), so there is no rubber-banding
  on your own stick. On each incoming snapshot, *reconcile*: lerp the
  predicted position toward the authoritative one over ~100 ms. Look
  (yaw/pitch) stays fully local.
- **Remote players & zombies:** interpolate between the last two snapshots
  (render ~100–150 ms in the past), using position + state. Melee swing
  animation is driven by the `swing` phase value, not by re-simulating.
- This is the standard "client-predict self, server-authoritative, interpolate
  others" pattern — it feels responsive while the server remains the truth.

---

## 6. Client changes (existing browser game → "client mode")

The browser game keeps rendering the city, lighting, sky, snow, HUD, and
audio. The changes are about *who simulates what*:

1. **`Game` gains a `netMode`** (single vs multi). In multi mode:
   - Stop calling authoritative `zombie.update` / `waveManager.update` /
     other-`player` logic locally for *shared* entities; instead consume
     snapshots.
   - Keep local `Player.update` for self-prediction.
   - Keep local weapon *view model* animation + effects, driven by events.
   - Keep local lighting/sky/city (they follow the local player, which is
     predicted).
2. **`NetClient` (new, browser):** owns the socket, captures input (reuses
   the existing `Input` data object), sends input messages, ingests snapshots,
   and drives prediction + interpolation.
3. **Remote player avatars (new, `RemotePlayer.js`):** the current game has no
   visible player body (first-person only). Each remote player needs a
   low-poly avatar (capsule + a simple limb hint + a weapon indicator + name
   tag). It is positioned/oriented from the snapshot and does not simulate AI.
   Budget: keep it to a few meshes per remote player (≤ ~10) so 8 avatars stay
   within the mesh budget.
4. **HUD additions:** per-player scoreboard (health bars for all 8), kill
   feed, wave banner (already exists in `Screens`), and a lobby/room screen.
5. **Lobby screen (new):** take a server URL + player name, join a room, show
   the roster, and start. This extends `Screens.js`.

Everything visual stays client-side; none of the server work touches rendering.

---

## 7. Determinism, fairness, edge cases

- **Determinism:** the sim is already LCG/fixed-seed. For MP we do *not* rely
  on lockstep (the server is the truth), but determinism still helps debugging
  (a given input sequence reproduces the same sim) and keeps zombie spawn
  patterns consistent across a match.
- **A player dies in MP:** they don't end the game for everyone. Options (pick
  one, default suggested):
  - **Spectate** the room until the wave/room ends (simplest), or
  - **Respawn** after a short delay if the match is wave-based (keeps 8
    players active).
  Suggested default: **respawn** on a wave-based match (keeps the 8-player
  premise meaningful), with a per-kill respawn cooldown; a true
  player-vs-player "last one alive" mode can be a later variant.
- **Disconnection:** grace period (e.g., 5 s) then the slot is freed; their
  avatar is removed; their score remains for the match report.
- **Wave completion / match end:** when `WaveManager` reports all waves cleared
  (or a time cap), the server ends the match, broadcasts a final scoreboard
  (score + kills per player), and tears down the room.
- **Score in MP:** currently `Score` is a single-player localStorage counter.
  In MP, scoring is **per-player and server-authoritative**; the client-side
  localStorage high-score remains for solo play. A small leaderboard (per room
  or global) is a Phase-4+ nicety, not required to ship.

---

## 8. Performance & scaling

- **Server CPU:** at 20 Hz with ≤ 24 zombies and 8 players, the tick is a few
  hundred vector operations + AABB resolves + occasional raycasts. That is
  comfortably within a single Node core (well under 5 ms/tick in typical
  conditions). One Node process can run many rooms if needed.
- **Client GPU/CPU:** unchanged from single-player for the world; adding ≤ 8
  remote avatars (a few meshes each) is a small addition to the existing
  ≤ 600-mesh budget. Zombie count stays bounded by `WaveManager` (≤ 24).
- **Latency budget:** 20 Hz sim (50 ms) + one-way network (~30–80 ms on a home
  connection) + 100–150 ms interpolation buffer ≈ **~200–300 ms perceived
  latency** for remote entities — acceptable for a co-op horde game (not for
  competitive aim duels). Local prediction keeps your own feel tight.

---

## 9. Phased implementation plan

Each phase is independently shippable and testable headlessly where possible.

### Phase 0 — Extract the authoritative core (foundation, low risk)
- Refactor `Game.update()` into a reusable `updateWorld(dt, worldState)` that
  both single-player `Game` and the new `Match` call.
- Add headless unit tests that run `Match.step(dt)` over a scripted input
  sequence and assert expected positions/health/kill counts (reuses the
  existing headless-test pattern).
- **Exit criteria:** single-player still passes all existing tests; a headless
  `Match` simulates a 2-"player" scenario correctly with no DOM.

### Phase 1 — Server + 2 players, movement only (prove the netcode)
- `server/server.js`: HTTP (serves `dist/`) + WebSocket; a single room;
  fixed 20 Hz tick; `Match` with 2 players.
- `NetClient` (browser) in a debug build: sends movement/look, receives
  snapshots, renders a simple marker for the other player (no avatars yet).
- Local prediction + reconciliation for self; interpolation for remote.
- **Exit criteria:** two browsers on different machines (or localhost ports)
  see each other move smoothly; killing the server stops both cleanly.

### Phase 2 — Combat + zombies
- Server resolves weapon hits, knockback, blood/head events; zombies simulated
  authoritatively.
- Client renders zombies from snapshots (state-driven pose), plays hit/kill
  events (blood, hit marker, kill feed, groans).
- Remote player avatars added (capsule + weapon).
- **Exit criteria:** two players can kill shared zombies together; a melee
  swing and a gun shot land per server rules; zombie stagger/knockback is
  visible and consistent.

### Phase 3 — Waves, score, drops, match flow
- Server drives `WaveManager`, per-player score + kills, ammo drops, and
  match end (all waves cleared / time cap) with a final scoreboard.
- Respawn-on-death (or spectate) implemented.
- **Exit criteria:** a full 2–4 player match runs start → waves → end with a
  correct per-player scoreboard; deaths and respawns behave.

### Phase 4 — 8-player rooms + lobby + polish
- Enforce 8-player cap; lobby/room screen (server URL + name + roster).
- Full scoreboard UI, kill feed, player health bars, disconnection handling.
- Prediction tuning (reconcile smoothing, interpolation buffer) against real
  network conditions.
- **Exit criteria:** 8 concurrent players in one room with stable 20 Hz sim,
  lobby join/leave, and a clean match report.

### Phase 5 — Hosting & deployment
- Deploy the Node server (see §10). The static game build can live on the same
  origin (server serves `dist/`) or remain on gh-pages with the socket server
  on a separate host (the client then just needs the server URL, which the
  lobby asks for).
- Provide a `package.json` script (e.g., `npm run server`) and a README section
  on running it locally and on a host.

---

## 10. Hosting options

- **Single origin (recommended):** one Node server serves both the static
  `dist/` build and the WebSocket on the same host. Easiest for players (one
  URL), and `server.js` can `fs`-serve the built files.
- **Separate hosts:** keep the game on GitHub Pages (gh-pages branch, as today)
  and host only the socket server elsewhere. The lobby's "server URL" field
  handles this; no code changes beyond the lobby. Downside: players must know
  the server URL and cross-origin WebSocket must be allowed (CORS is not an
  issue for WebSocket, but the server must accept the origin).
- **Where to host the server:** a small VPS, or a platform that runs a
  long-lived Node process (e.g., Railway / Render / Fly.io, or a home machine
  with a public IP + port). GitHub Actions / Pages cannot run a persistent
  WebSocket server, so the server needs a real always-on host.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Desync / rubber-banding on the local player | Client prediction + smooth reconciliation (lerp over ~100 ms); server clamps inputs; fixed 20 Hz tick. |
| Server CPU with many rooms / 24 zombies | 20 Hz is cheap; cap zombies at the existing budget; profile `Match.step`; can raise tick to 15 Hz if needed. |
| Remote entity jitter at high latency | Interpolation buffer (~100–150 ms); extrapolate short gaps; drop to 15 Hz snapshots only if bandwidth forces it. |
| A bad/cheating client poisons the room | Server-authoritative combat + input clamps; weapon cooldowns enforced server-side; position is integrated, not trusted. |
| Refactor of `Game.update()` breaks single-player | Do it in Phase 0 behind the existing headless tests; keep the single-player path as the reference. |
| No visible player body today | Add a cheap `RemotePlayer` avatar in Phase 2 (few meshes, within budget). |
| Long-lived server hosting cost/complexity | Phase 5 offers the separate-host option (game stays on Pages); document a minimal VPS setup. |

---

## 12. Open questions (to decide before Phase 3)

1. **Death handling:** respawn-on-delay vs spectate vs "last one alive"? (Suggested: respawn for wave-based co-op.)
2. **Match structure:** endless waves with a time cap, or a fixed wave count, or player-vs-player after waves clear?
3. **Scoring/leaderboard:** per-room only, or a persistent global leaderboard (would need server-side storage)?
4. **Room count / concurrent rooms on one server:** single room per server instance, or a room list the lobby browses?
5. **Max players:** 8 is the target — confirm the mesh/triangle budget still holds with 8 avatars + 24 zombies + city (run `sceneStats` in a headless multi-match to verify).

---

## 13. Suggested file-level TODO list (for when implementation starts)

- `src/game/WorldCore.js` (new): the extracted authoritative update loop
  (Phase 0).
- `src/net/protocol.js` (new): message schemas + constants (Phase 1).
- `src/net/Match.js` (new): server-side room + simulation (Phase 1/2).
- `server/server.js` (new): HTTP + WebSocket server, rooms, tick loop (Phase 1).
- `src/net/NetClient.js` (new): browser socket, input capture, prediction,
  interpolation (Phase 1).
- `src/game/RemotePlayer.js` (new): remote player avatar (Phase 2).
- `src/game/Screens.js` (edit): lobby/room + scoreboard screens (Phase 4).
- `src/game/HUD.js` (edit): per-player health, kill feed (Phase 3/4).
- `src/game/Game.js` (edit): `netMode` switch, consume snapshots in multi mode
  (Phase 1–2).
- `package.json` (edit): `server` script (Phase 5).
- `README.md` (edit): how to run the server + join a room (Phase 5).
