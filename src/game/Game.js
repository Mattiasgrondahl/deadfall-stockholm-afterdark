import * as THREE from 'three'
import { Input } from './Input.js'
import { Player } from './Player.js'
import { CollisionWorld } from './CollisionWorld.js'
import { City } from '../world/City.js'
import { Lighting } from '../world/Lighting.js'
import { Sky } from '../world/sky.js'
import { bakeSkyEnvironment } from '../world/envmap.js'
import { WeaponBank } from './WeaponBank.js'
import { AmmoDrops, SHELLS_PER_DROP, BULLETS_PER_DROP } from './AmmoDrops.js'
import { Flashlight } from './Flashlight.js'
import { Score } from './Score.js'
import { Blood } from './Blood.js'
import { BulletHoles } from './BulletHoles.js'
import { Lamps } from './Lamps.js'
import { GlassShards } from './GlassShards.js'
import { DecapitatedHeadPool } from './DecapitatedHeadPool.js'
import { Zombie, DIFFICULTY } from './Zombie.js'
import { WaveManager } from './WaveManager.js'
import { updateWorld } from './WorldCore.js'
import { HUD } from './HUD.js'
import { Screens } from './Screens.js'
import { AudioBank } from './AudioBank.js'
import { PostFX } from './PostFX.js'
import { Settings } from './Settings.js'

// Soundtrack mp3s (YuE2 hard-rock zombie songs), served from public/. Resolved
// against Vite's BASE_URL in the browser; the AudioBank no-ops headless.
const ASSET_BASE = (typeof document !== 'undefined' ? ((import.meta.env?.BASE_URL || '').replace(/\/$/, '') + '/') : '')
// Per-level music: one track per boss-cycle (a "level" = every 5 waves). The
// set cycles, so each level starts on a different song and the list repeats
// once exhausted. Tracks are resolved against the asset base.
const LEVEL_TRACKS = [
  ASSET_BASE + 'assets/audio/soundtrack.mp3',
  ASSET_BASE + 'assets/audio/soundtrack2.mp3'
]
// Known true length of each track (seconds). Some browsers misreport an mp3's
// `duration` and fire `ended` early, so the loop is driven off this explicit
// length instead of the element's unreliable `duration`.
const LEVEL_TRACK_SECONDS = 120

export const GameState = Object.freeze({
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAMEOVER: 'gameover'
})

/** No-op renderer for headless (Node) runs. Satisfies every renderer call
 *  the game makes; never touches a GL context. */
class StubRenderer {
  constructor() {
    this.info = { render: { calls: 0, triangles: 0 }, memory: {} }
    this.shadowMap = { enabled: false, type: 0 }
    this.toneMapping = 0
  }
  render() { this.info.render.calls++ }
  setPixelRatio() {}
  setSize() {}
  setAnimationLoop() {}
  dispose() {}
}

/**
 * Central game orchestrator: owns the loop, the state machine, and every
 * subsystem. Browser-facing services live in `env` (renderer, document,
 * window); in headless mode (Node tests) those are stubs while the scene,
 * camera, and every entity remain real THREE objects — so the complete
 * gameplay logic runs without a browser.
 *
 * Input is a plain data object (`inputState`). The browser `Input` adapter
 * writes into it (keys, look deltas, fire edges); headless tests write it
 * directly. Movement/look/fire never read the DOM.
 */
export class Game {
  constructor(opts = {}) {
    this.headless = !!opts.headless
    this.canvas = opts.canvas || null
    this.state = GameState.TITLE
    // Persistent player settings (volumes, sensitivity, FOV, quality, reduced
    // motion). Constructed before any subsystem so Lighting/Player/AudioBank/
    // Screens all start from the stored values. Headless keeps defaults.
    this.settings = new Settings(this.headless ? null : { localStorage: window.localStorage })
    this.quality = this.settings.get('quality')
    // Difficulty preset (see DIFFICULTY in Zombie.js): 'normal' is the
    // shipped baseline; 'frenzy' = 2x zombie speed + flat 50 HP (2-shot kill
    // unless headshot). Screens can reassign it on the title screen.
    this.difficulty = DIFFICULTY[opts.difficulty] ? opts.difficulty : 'normal'
    this._lastTime = -1

    this.renderer = this.headless ? new StubRenderer() : null
    this.env = this.headless
      ? { document: null, window: null, canvasFactory: fakeCanvasFactory }
      : { document: document, window: window, canvasFactory: () => document.createElement('canvas') }

    // Reduced motion: default the setting from the OS media query (browser
    // only; headless keeps the default false).
    if (!this.headless && window.matchMedia) {
      try {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) this.settings.set('reducedMotion', true)
      } catch (err) { /* matchMedia unavailable -> keep default */ }
    }

    // Plain input data object (see class comment).
    this.inputState = {
      forward: false, back: false, left: false, right: false, sprint: false, crouch: false,
      turnX: 0, turnY: 0,      // accumulated look deltas, consumed per frame
      fire: false,             // edge flag, consumed by Weapon
      reload: false,
      pause: false
    }

    // Subsystems (set in initSubsystems):
    this.input = null
    this.player = null
    this.weapon = null
    this.city = null
    this.lighting = null
    this.audio = null
    this.hud = null
    this.screens = null
    this.waveManager = null
    this.collision = null
    // State-transition listeners (Screens syncs its overlays through these).
    this._stateListeners = []
    // Live wave-5 boss (HUD bar target); null outside the boss fight.
    this._boss = null

    // Live entity lists (zombies live here; bounded by WaveManager).
    this.zombies = []
    this.kills = 0
    this.timeInGame = 0
    this._fps = 60

    this.debug = {
      state: () => this.state,
      playerPos: () => this.player ? this.player.position.clone() : null,
      health: () => this.player ? this.player.health : 0,
      stamina: () => this.player ? this.player.stamina : 0,
      ammo: () => this.weapon ? this.weapon.ammo : 0,
      reserve: () => this.weapon ? this.weapon.reserve : 0,
      wave: () => this.waveManager ? this.waveManager.wave : 0,
      zombiesAlive: () => this.zombies.filter(z => !z.isDead).length,
      zombiesRemaining: () => this.waveManager ? this.waveManager.remaining : 0,
      kills: () => this.kills,
      setPlayerPos: (x, z) => { if (this.player) this.player.position.set(x, 1.7, z) },
      setPlayerHealth: (n) => { if (this.player) this.player.health = Math.max(0, Math.min(this.player.maxHealth, n)) },
      damagePlayer: (n) => { if (this.player) this.player.damage(n, 'debug') },
      shootOnce: () => { if (this.weapon) return this.weapon.shoot() },
      reloadWeapon: () => { if (this.weapon) return this.weapon.reload() },
      setInput: (partial) => Object.assign(this.inputState, partial),
      spawnZombie: (type, x, z) => this.spawnZombie(type, x, z),
      killAllZombies: () => {
        for (const z of this.zombies) if (!z.isDead) z.damage(z.health + 10)
      },
      forceWaveClear: () => { if (this.waveManager) this.waveManager.forceClear(this) },
      resetRun: () => {
        // Force a clean run from any state (headless harness only).
        if (this.state === GameState.PLAYING || this.state === GameState.PAUSED) {
          for (const z of this.zombies) z.dispose()
          this.zombies = []
          this.setState(GameState.GAMEOVER)
        }
        this.startGame()
      },
      step: (dt) => this.step(dt),
      frameStats: () => this.rendererStats(),
      sceneStats: () => this.sceneStats()
    }
  }

  /** One manual frame (headless playthroughs); also the per-frame body. */
  step(dt) {
    const d = Math.min(Math.max(dt, 0), 0.1)
    // Pause edge is state-independent: P/Escape must work from PAUSED too.
    if (this.inputState.pause) {
      this.inputState.pause = false
      this.togglePause()
    }
    this.timeInGame += d
    if (this.state === GameState.PLAYING) this.update(d)
    this.render()
    // WIRING:HUD (owned by task F)
    if (this.state === GameState.PLAYING && this.hud) {
      this.hud.update(this.player, this.weapon, this.waveManager)
    }
    return d
  }

  /** Browser frame driven by the renderer animation loop. */
  tick() {
    const now = performance.now()
    const dt = this._lastTime < 0 ? 0 : Math.min((now - this._lastTime) / 1000, 0.1)
    this._lastTime = now
    this.step(dt)
    if (dt > 0) this._fps = this._fps * 0.9 + (1 / dt) * 0.1
  }

  start() {
    // Create the scene/camera first so resize() (below) can set the camera
    // aspect; setupRenderer/resize are browser-only.
    this.setupScene()
    if (!this.headless) {
      this.setupRenderer()
      this.resize()
      this.env.window.addEventListener('resize', () => this.resize())
    }
    this.initSubsystems()
    if (!this.headless) this.renderer.setAnimationLoop(() => this.tick())
    else this.render() // build the scene graph once so stats are valid
  }

  setupRenderer() {
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        powerPreference: 'high-performance'
      })
    } catch (err) {
      console.warn('WebGL antialias failed, retrying plain:', err)
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false })
    }
    this.renderer.setPixelRatio(Math.min(this.env.window.devicePixelRatio || 1, 2))
  }

  setupScene() {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x060912)
    this.scene.fog = new THREE.FogExp2(0x0b1020, 0.022)
    // Far plane 520: the sky dome (r=420), starfield (r=400) and the distant
    // skyline silhouettes (360-400 m) must all sit inside it, or they are
    // clipped away and the sky falls back to the flat scene.background color.
    // Fog erases everything past ~300 m anyway, so the extra range costs
    // nothing visible.
    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 520)
    this.camera.position.set(0, 1.7, 12)
  }

  resize() {
    if (!this.renderer || !this.env.window) return
    const w = this.env.window.innerWidth
    const h = this.env.window.innerHeight
    this.renderer.setSize(w, h)
    if (this.postfx) this.postfx.setSize(w, h)
    // Camera is created in setupScene(); guard so an early resize (before the
    // camera exists) sizes the renderer without throwing.
    if (this.camera) {
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
    }
  }

  /** Create every subsystem exactly once. Owned by task A; later tasks only fill WIRING regions. */
  initSubsystems() {
    // WIRING:INPUT (task A)
    if (!this.headless && this.env.document && this.canvas) {
      this.input = new Input(this, this.inputState)
      this.input.attach()
      this.input.on('unlock', () => this.handleUnlock())
      this.input.on('lock', () => { if (this.state === GameState.PAUSED) this.setState(GameState.PLAYING) })
      // Pointer lock is requested on the START/Enter gesture (startGame), not
      // at page load — browsers reject a lock request without a user gesture.
    }
    // WIRING:PLAYER (task A)
    this.collision = new CollisionWorld(180, 180)
    this.player = new Player(this.camera, this.inputState, this.collision, this.audio)
    this.player.sensMult = this.settings.get('sensitivity')
    this.player.setOnDeath(() => this.onPlayerDeath())
    // WIRING:CITY (task B): collision starts clean; City registers its own AABBs
    this.collision.clear()
    this.city = new City(this.scene, this.collision, this.env)
    // WIRING:LIGHTING
    this.lighting = new Lighting(this.scene, this.city, this.renderer, this.quality)
    // WIRING:SKY (V2P-1)
    this.sky = new Sky(this.scene)
    // WIRING:ENV (V3P-9): IBL environment map baked once from the game's own
    // sky (gradient dome + moon + skyline silhouettes). Gives every standard
    // material a soft ambient sheen and sky reflections consistent with what
    // the player sees. One-shot cost at init; no per-frame cost. Headless no-op
    // (StubRenderer is not a WebGLRenderer) and returns null there.
    this.envMap = bakeSkyEnvironment(this.renderer, this.sky, this.scene, { intensity: 0.5 })
    // WIRING:POSTFX (V2P-10b): restrained bloom; no-op headless (StubRenderer)
    this.postfx = new PostFX(this.scene, this.camera, this.renderer, { strength: 0.25 })
    // WIRING:AUDIO
    this.audio = new AudioBank()
    this.audio.attachSettings(this.settings)
    if (this.player) this.player.audio = this.audio
    if (this.input) this.input.on('mute', () => this.audio.toggleMuted())
    // N toggles ONLY the soundtrack; keep the HUD button label in sync.
    if (this.input) this.input.on('musicMute', () => {
      if (!this.audio) return
      this.audio.toggleMusicMuted()
      if (this.hud) this.hud.setMusicMuted(this.audio._musicMuted)
    })
    // WIRING:WEAPON
    this.weapon = new WeaponBank(this.scene, this.camera, this.collision, this.audio)
    this.weapon.getZombies = () => this.zombies
    this.weapon.inputState = this.inputState
    // WIRING:DROPS (V6)
    this.drops = new AmmoDrops(this.scene, this.audio)
    // WIRING:FLASH (V7)
    this.flashlight = new Flashlight(this.camera, this.audio)
    // WIRING:WAVES
    this.waveManager = new WaveManager(this.scene, this.city.getSpawnPoints(), this.collision, this.audio, {
      onWaveStart: (w) => {
        if (this.screens) this.screens.showBanner('WAVE ' + w)
        // A new boss-cycle (a "level") begins every 5 waves (waves 1, 6, 11...).
        // Switch to that level's track so each level has its own song.
        if (this.audio && (w - 1) % 5 === 0) {
          this.audio.playLevelMusic(LEVEL_TRACKS, Math.floor((w - 1) / 5), LEVEL_TRACK_SECONDS)
        }
      },
      onWaveCleared: (w) => { if (this.screens) this.screens.showBanner('WAVE ' + w + ' CLEARED'); if (this.audio) this.audio.playWaveCleared?.(w) },
      spawnZombie: (type, x, z) => this.spawnZombie(type, x, z),
      onBossIncoming: () => { if (this.screens) this.screens.showBanner('SOMETHING HUGE IS COMING') },
      onBossSpawn: () => { if (this.screens) this.screens.showBanner('THE BRUTE') }
    })
    // WIRING:SCORE (V9)
    this.score = new Score(this.env, () => this.waveManager ? this.waveManager.wave : 1)
    // WIRING:BLOOD (V10) — every weapon sprays blood
    this.blood = new Blood(this.scene)
    // WIRING:BULLETHOLES — gun shots that hit a wall leave a scorch decal.
    this.bulletHoles = new BulletHoles(this.scene)
    // WIRING:LAMPS — shootable streetlamps that break dark and relight after 60 s.
    this.glassShards = new GlassShards(this.scene)
    this.lamps = new Lamps(this.city ? this.city.lamps : [])
    this.lamps.audio = this.audio
    this.lamps.shards = this.glassShards
    if (this.weapon) {
      this.weapon.shotgun.blood = this.blood
      this.weapon.axe.blood = this.blood
      this.weapon.pistol.blood = this.blood
      this.weapon.sword.blood = this.blood
      this.weapon.sniper.blood = this.blood
      this.weapon.shotgun.bulletHoles = this.bulletHoles
      this.weapon.pistol.bulletHoles = this.bulletHoles
      this.weapon.sniper.bulletHoles = this.bulletHoles
      this.weapon.shotgun.lamps = this.lamps
      this.weapon.pistol.lamps = this.lamps
      this.weapon.sniper.lamps = this.lamps
      // WIRING:DECAPITATE (Task E): a fatal headshot spawns a rolling
      // severed head (shared geometry/materials; pool caps at 3).
      this.headPool = new DecapitatedHeadPool(this.scene)
      this.weapon.onDecapitate = (z, dir) => { if (this.headPool) this.headPool.spawn(z, dir) }
    }
    // WIRING:UI (browser only; headless keeps hud/screens null)
    if (this.env.document) {
      this.hud = new HUD(this.env.document.getElementById('hud-root'), this.env.document.getElementById('fx-root'))
      this.screens = new Screens(this.env.document.getElementById('screens-root'), this)
      if (this.flashlight) this.hud.flashlight = this.flashlight // V7: reveals the battery box
      if (this.score) this.hud.score = this.score // V9: reveals the score box
      // Music-mute button: toggles ONLY the soundtrack (SFX stay audible).
      if (this.hud) this.hud.onToggleMusic = (muted) => { if (this.audio) this.audio.setMusicMuted(muted) }
      // Reflect the persisted music-mute state on the HUD button at boot.
      if (this.hud && this.audio) this.hud.setMusicMuted(this.audio._musicMuted)
    }
    // V5P-1: weapon hit -> HUD marker (no-op headless: hud is null there).
    // Weapons pass 'head' | 'body' so a headshot marker reads differently.
    if (this.weapon) this.weapon.onHit = (kind) => { if (this.hud) this.hud.hitMarker(kind) }
    // V5P-2: player damage -> HUD directional feedback (no-op headless: hud is null there)
    if (this.player) this.player._onDamaged = (n, s) => { if (this.hud) this.hud.dmgFeedback(n, s) }
    // WIRING:WORLDCORE (Phase 0, MULTIPLAYER_PLAN §9): state of the shared
    // authoritative core, passed to updateWorld() every frame. ws.zombies is
    // this.zombies (same array), so the core's corpse removal and the wave
    // spawner operate on the live list. onKill / onDropPickup do exactly what
    // the inline update() loop used to (kill counter, HUD marker, score,
    // drop pickup + audio); `by` (the killer's id) is ignored in solo play.
    this._ws = {
      players: [{ id: 'p1', player: this.player, weapon: this.weapon, inputState: this.inputState }],
      zombies: this.zombies,
      collision: this.collision,
      wave: this.waveManager,
      drops: this.drops,
      audio: this.audio,
      onKill: (z) => {
        this.kills++
        if (this.hud) this.hud.killMarker()
        if (this.score) this.score.addKill(z.type, this.waveManager ? this.waveManager.wave : 1)
      },
      onDropPickup: (d) => {
        if (this.weapon) {
          if (d && d.kind === 'bullets') this.weapon.pistol.reserve += BULLETS_PER_DROP
          else this.weapon.shotgun.reserve += SHELLS_PER_DROP
        }
        if (this.audio) this.audio.pickup?.()
      }
    }
    // WIRING:SETTINGS — push the stored settings into every subsystem and
    // re-apply live when the player changes one (pause menu / title).
    this.applySettings()
    this._settingsOff = this.settings.onChange((key) => this.applySettings(key))
  }

  /**
   * Apply settings to the live subsystems. `onlyKey` (optional) limits the
   * fan-out to the subsystems that read that key; undefined applies all.
   */
  applySettings(onlyKey) {
    const s = this.settings.values
    if (!onlyKey || onlyKey === 'quality') {
      this.quality = s.quality
      if (this.lighting) this.lighting.setQuality(s.quality === 'high' ? 'high' : 'low')
      if (this.postfx) this.postfx.setEnabled(s.quality === 'high')
    }
    if (!onlyKey || onlyKey === 'sensitivity') {
      if (this.player) this.player.sensMult = s.sensitivity
    }
    if (!onlyKey || onlyKey === 'fov') {
      if (this.weapon && this.weapon.sniper) this.weapon.sniper.setBaseFov(s.fov)
      else if (this.camera && !(this.weapon && this.weapon.sniper && this.weapon.sniper.scoped)) {
        this.camera.fov = s.fov
        this.camera.updateProjectionMatrix()
      }
    }
    if (!onlyKey || onlyKey === 'reducedMotion') {
      if (this.hud) this.hud.setReducedMotion(s.reducedMotion)
      if (this.postfx) this.postfx.setGrainEnabled(!s.reducedMotion)
    }
    if (!onlyKey || onlyKey === 'flashlightEffects') {
      if (this.flashlight) this.flashlight.setEffectsEnabled(s.flashlightEffects)
    }
    if (!onlyKey || onlyKey === 'musicMuted') {
      // Keep the HUD music button label in sync with the stored state. The
      // label follows the setting; the audio bus follows it via its own
      // settings listener, so no audio call is needed here (calling
      // setMusicMuted would re-persist and re-emit, looping forever).
      if (this.hud) this.hud.setMusicMuted(s.musicMuted)
    }
  }

  setState(next) {
    if (this.state === next) return
    const prev = this.state
    this.state = next
    // WIRING:STATE_TRANSITIONS (screens + pointer lock, owned by task A; F extends)
    console.debug('state', prev, '->', next)
    // Pause releases the pointer lock; re-locking (the 'lock' event above)
    // resumes the game. GAMEOVER lock release happens in onPlayerDeath().
    if (next === GameState.PAUSED && this.input && this.input.locked() && this.env.document) {
      this.env.document.exitPointerLock()
    }
    // Phase 1: notify Screens (and any other state listener) so the visible
    // overlay always matches the state — even when pointer lock never engaged.
    for (const cb of this._stateListeners) {
      try { cb(next, prev) } catch (err) { /* a bad listener must not break the transition */ }
    }
  }

  /** Subscribe to state transitions (next, prev) -> void. Returns an off fn. */
  onStateChange(cb) {
    this._stateListeners.push(cb)
    return () => this.offStateChange(cb)
  }

  offStateChange(cb) {
    const i = this._stateListeners.indexOf(cb)
    if (i >= 0) this._stateListeners.splice(i, 1)
  }

  /** Title or gameover -> fresh PLAYING run. */
  startGame() {
    if (this.state === GameState.PLAYING) return
    // WIRING:RESET (owned by task A, extended by later tasks)
    if (this.player) this.player.reset()
    if (this.weapon) this.weapon.reset()
    for (const z of this.zombies) z.dispose()
    this.zombies = []
    // WIRING:WORLDCORE (Phase 0): this reassignment breaks the constructor-time
    // alias, so rebind the shared core's live zombie list to the new array.
    if (this._ws) this._ws.zombies = this.zombies
    this.kills = 0
    if (this.drops) this.drops.clear()
    if (this.flashlight) this.flashlight.reset()
    if (this.score) this.score.reset()
    if (this.blood) this.blood.clear()
    if (this.bulletHoles) this.bulletHoles.clear()
    if (this.glassShards) this.glassShards.clear()
    if (this.lamps) this.lamps.reset()
    if (this.headPool) this.headPool.clear()
    if (this.hud) { this.hud.clearMarker(); this.hud.boss = null }
    this._boss = null
    this.timeInGame = 0
    if (this.waveManager) this.waveManager.reset()
    this.setState(GameState.PLAYING)
    if (this.input && !this.input.locked()) this.input.requestLock()
    if (this.audio) { this.audio.startAmbient(); this.audio.playStart?.(); this.audio.playLevelMusic(LEVEL_TRACKS, 0, LEVEL_TRACK_SECONDS) }
    if (this.screens) this.screens.showGameplay()
    if (this.difficulty !== 'normal' && this.screens) {
      this.screens.showBanner('FRENZY — they run 2× faster; bodies take 2, headshots kill')
    }
  }

  togglePause() {
    if (this.state === GameState.PLAYING) this.setState(GameState.PAUSED)
    else if (this.state === GameState.PAUSED) {
      if (this.input && !this.input.locked()) {
        // Browser: re-acquire the pointer lock; the 'lock' event
        // (PAUSED -> PLAYING) and Screens._onLockChange then hide the pause
        // overlay and restore the HUD, keeping game state and lock in sync.
        this.input.requestLock()
      } else {
        // Headless (no input) or already locked: transition directly.
        this.setState(GameState.PLAYING)
      }
    }
  }

  /** Pointer lock was lost (Esc): auto-pause during gameplay. */
  handleUnlock() {
    if (this.state === GameState.PLAYING) this.setState(GameState.PAUSED)
  }

  onPlayerDeath() {
    this.setState(GameState.GAMEOVER)
    if (this.input && this.input.locked() && this.env.document) this.env.document.exitPointerLock()
    if (this.audio) this.audio.stopAmbient()
    const record = this.score ? this.score.newRecord() : false
    if (this.screens) this.screens.showGameOver({
      wave: this.waveManager ? this.waveManager.wave : 0,
      kills: this.kills,
      score: this.score ? this.score.value : 0,
      best: this.score ? this.score.best : 0,
      record
    })
  }

  /** Per-frame update, only while playing. dt is clamped.
   *  The shared authoritative core (player, weapon, zombies, kills,
   *  drops, waves) now runs through WorldCore.updateWorld — the same
   *  code path the server-side Match uses (Phase 0, MULTIPLAYER_PLAN §9).
   *  Client-only systems (blood, decap-head pool, flashlight, groans,
   *  lighting, sky, city) stay here, around the core. */
  update(dt) {
    // WIRING:VISUAL-PRE (client-side only; these ran before the sim in the
    // pre-refactor update — they animate purely visual state)
    // WIRING:BLOOD (V10)
    if (this.blood) this.blood.update(dt)
    // WIRING:DECAPITATE (Task E)
    if (this.headPool) this.headPool.update(dt)
    // WIRING:LAMPS — advance relight timers + shard animation.
    if (this.lamps) this.lamps.update(dt)
    if (this.glassShards) this.glassShards.update(dt)
    // WIRING:FLASH (V7)
    if (this.flashlight) this.flashlight.update(dt, this.inputState)
    // WIRING:UPDATE — the shared authoritative core (see WorldCore.js):
    // player + weapon, zombie AI, kill bookkeeping, drops, waves.
    updateWorld(dt, this._ws)
    // WIRING:GROANS (V8)
    if (this.audio) this.audio.updateGroans(dt, this.zombies, this.player ? this.player.position : this.camera.position, this.player ? this.player.yaw : 0)
    // Boss HUD: the bar tracks the live boss while it stands; it clears when
    // the brute dies (the corpse is still in the list for a few seconds).
    if (this._boss && this._boss.isDead) this._boss = null
    if (this.hud) this.hud.boss = this._boss || null
    // WIRING:LIGHTING
    if (this.lighting) this.lighting.update(this.player ? this.player.position : this.camera.position)
    // dt drives the star twinkle clock (deterministic: accumulated game time).
    if (this.sky) this.sky.update(this.player ? this.player.position : this.camera.position, dt)
    if (this.city) this.city.update(this.player ? this.player.position : this.camera.position, dt)
  }

  /** Spawn a zombie (used by WaveManager and debug). */
  spawnZombie(type, x, z) {
    // WIRING:SPAWN (owned by task D: create zombie, push into this.zombies, return it)
    const wave = this.waveManager ? this.waveManager.wave : 1
    const zombie = new Zombie(this.scene, type, x, z, wave, this.difficulty)
    this.zombies.push(zombie)
    // The wave-5 boss owns the HUD boss bar for as long as it is alive.
    if (zombie.isBoss) this._boss = zombie
    return zombie
  }

  render() {
    if (!this.renderer || !this.scene) return
    if (this.postfx && this.postfx.enabled) this.postfx.render()
    else this.renderer.render(this.scene, this.camera)
  }

  rendererStats() {
    return { fps: this._fps, calls: this.renderer ? this.renderer.info.render.calls : 0, tris: this.renderer ? this.renderer.info.render.triangles : 0 }
  }

  /** Counts in the live scene graph (headless-safe: pure object traversal). */
  sceneStats() {
    let meshes = 0, points = 0, lights = 0, groups = 0
    if (this.scene) {
      this.scene.traverse((o) => {
        if (o.isMesh || o.isSprite) meshes++
        else if (o.isPoints) points++
        else if (o.isLight) lights++
        else if (o.isGroup || (o.isObject3D && o.children.length)) groups++
      })
    }
    return { meshes, points, lights, groups, zombies: this.zombies.length }
  }
}

/** Fake HTML canvas factory for headless (Node) runs. Procedural code
 *  (e.g. City's facade textures) gets `env.canvasFactory()` instead of
 *  document.createElement('canvas'). The 2d context is a no-op proxy;
 *  CanvasTexture stores the canvas but never uploads it because the stub
 *  renderer never renders. */
function fakeCanvasFactory() {
  const noop = () => {}
  const c = { width: 256, height: 256, style: {} }
  c.getContext = (kind) => (kind === '2d' ? new Proxy({}, { get: (t, k) => (typeof k === 'string' ? noop : undefined) }) : null)
  return c
}
