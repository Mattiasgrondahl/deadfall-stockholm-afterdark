import * as THREE from 'three'
import { Input } from './Input.js'
import { Player } from './Player.js'
import { CollisionWorld } from './CollisionWorld.js'
import { City } from '../world/City.js'
import { Lighting } from '../world/Lighting.js'
import { Sky } from '../world/sky.js'
import { WeaponBank } from './WeaponBank.js'
import { AmmoDrops, SHELLS_PER_DROP } from './AmmoDrops.js'
import { Flashlight } from './Flashlight.js'
import { Score } from './Score.js'
import { Blood } from './Blood.js'
import { Zombie } from './Zombie.js'
import { WaveManager } from './WaveManager.js'
import { HUD } from './HUD.js'
import { Screens } from './Screens.js'
import { AudioBank } from './AudioBank.js'

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
    this.quality = 'high'
    this._lastTime = -1

    this.renderer = this.headless ? new StubRenderer() : null
    this.env = this.headless
      ? { document: null, window: null, canvasFactory: fakeCanvasFactory }
      : { document: document, window: window, canvasFactory: () => document.createElement('canvas') }

    // Plain input data object (see class comment).
    this.inputState = {
      forward: false, back: false, left: false, right: false, sprint: false,
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
    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 400)
    this.camera.position.set(0, 1.7, 12)
  }

  resize() {
    if (!this.renderer || !this.env.window) return
    const w = this.env.window.innerWidth
    const h = this.env.window.innerHeight
    this.renderer.setSize(w, h)
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
    this.player.setOnDeath(() => this.onPlayerDeath())
    // WIRING:CITY (task B): collision starts clean; City registers its own AABBs
    this.collision.clear()
    this.city = new City(this.scene, this.collision, this.env)
    // WIRING:LIGHTING
    this.lighting = new Lighting(this.scene, this.city, this.renderer, this.quality)
    // WIRING:SKY (V2P-1)
    this.sky = new Sky(this.scene)
    // WIRING:AUDIO
    this.audio = new AudioBank()
    if (this.player) this.player.audio = this.audio
    if (this.input) this.input.on('mute', () => this.audio.toggleMuted())
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
      onWaveStart: (w) => { if (this.screens) this.screens.showBanner('WAVE ' + w) },
      onWaveCleared: (w) => { if (this.screens) this.screens.showBanner('WAVE ' + w + ' CLEARED'); if (this.audio) this.audio.playWaveCleared?.(w) },
      spawnZombie: (type, x, z) => this.spawnZombie(type, x, z)
    })
    // WIRING:SCORE (V9)
    this.score = new Score(this.env, () => this.waveManager ? this.waveManager.wave : 1)
    // WIRING:BLOOD (V10)
    this.blood = new Blood(this.scene)
    if (this.weapon) { this.weapon.shotgun.blood = this.blood; this.weapon.axe.blood = this.blood }
    // WIRING:UI (browser only; headless keeps hud/screens null)
    if (this.env.document) {
      this.hud = new HUD(this.env.document.getElementById('hud-root'), this.env.document.getElementById('fx-root'))
      this.screens = new Screens(this.env.document.getElementById('screens-root'), this)
      if (this.flashlight) this.hud.flashlight = this.flashlight // V7: reveals the battery box
      if (this.score) this.hud.score = this.score // V9: reveals the score box
    }
    // V5P-1: weapon hit -> HUD marker (no-op headless: hud is null there)
    if (this.weapon) this.weapon.onHit = () => { if (this.hud) this.hud.hitMarker() }
    // V5P-2: player damage -> HUD directional feedback (no-op headless: hud is null there)
    if (this.player) this.player._onDamaged = (n, s) => { if (this.hud) this.hud.dmgFeedback(n, s) }
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
  }

  /** Title or gameover -> fresh PLAYING run. */
  startGame() {
    if (this.state === GameState.PLAYING) return
    // WIRING:RESET (owned by task A, extended by later tasks)
    if (this.player) this.player.reset()
    if (this.weapon) this.weapon.reset()
    for (const z of this.zombies) z.dispose()
    this.zombies = []
    this.kills = 0
    if (this.drops) this.drops.clear()
    if (this.flashlight) this.flashlight.reset()
    if (this.score) this.score.reset()
    if (this.blood) this.blood.clear()
    if (this.hud) this.hud.clearMarker()
    this.timeInGame = 0
    if (this.waveManager) this.waveManager.reset()
    this.setState(GameState.PLAYING)
    if (this.input && !this.input.locked()) this.input.requestLock()
    if (this.audio) { this.audio.startAmbient(); this.audio.playStart?.() }
    if (this.screens) this.screens.showGameplay()
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

  /** Per-frame update, only while playing. dt is clamped. */
  update(dt) {
    // WIRING:UPDATE
    if (this.player && !this.player.isDead) this.player.update(dt)
    if (this.weapon) this.weapon.update(dt, this.player)
    // WIRING:BLOOD (V10)
    if (this.blood) this.blood.update(dt)
    // WIRING:FLASH (V7)
    if (this.flashlight) this.flashlight.update(dt, this.inputState)
    // WIRING:ZOMBIES
    for (const z of this.zombies) z.update(dt, this.player, this.zombies, this.collision, this.audio)
    // remove finished corpses
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i]
      if (z.isDead && !z._killCounted) { z._killCounted = true; this.kills++; if (this.hud) this.hud.killMarker(); if (this.score) this.score.addKill(z.type, this.waveManager ? this.waveManager.wave : 1); if (this.drops && this.drops.maybeSpawn(z.position.x, z.position.z)) this.audio?.drop?.() }
      if (z.deadAndGone) {
        this.zombies.splice(i, 1)
        z.dispose()
      } else if (z.isDead && z.deathTimer >= 5) {
        z.deadAndGone = true
      }
    }
    // WIRING:GROANS (V8)
    if (this.audio) this.audio.updateGroans(dt, this.zombies, this.player ? this.player.position : this.camera.position, this.player ? this.player.yaw : 0)
    // WIRING:DROPS
    if (this.drops) this.drops.update(dt, this.player, () => {
      if (this.weapon) this.weapon.shotgun.reserve += SHELLS_PER_DROP
      if (this.audio) this.audio.pickup?.()
    })
    // WIRING:WAVES
    if (this.waveManager) this.waveManager.update(dt, this)
    // WIRING:LIGHTING
    if (this.lighting) this.lighting.update(this.player ? this.player.position : this.camera.position)
    if (this.sky) this.sky.update(this.player ? this.player.position : this.camera.position)
    if (this.city) this.city.update(this.player ? this.player.position : this.camera.position, dt)
  }

  /** Spawn a zombie (used by WaveManager and debug). */
  spawnZombie(type, x, z) {
    // WIRING:SPAWN (owned by task D: create zombie, push into this.zombies, return it)
    const wave = this.waveManager ? this.waveManager.wave : 1
    const zombie = new Zombie(this.scene, type, x, z, wave)
    this.zombies.push(zombie)
    return zombie
  }

  render() {
    if (this.renderer && this.scene) this.renderer.render(this.scene, this.camera)
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
