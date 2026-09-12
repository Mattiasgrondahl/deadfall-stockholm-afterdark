// Focused tests for HUD.js and Screens.js, driven by a minimal fake DOM
// (element + document stubs). No real browser is involved.
import assert from 'node:assert'
import { HUD } from '../src/game/HUD.js'
import { Screens } from '../src/game/Screens.js'

// ---- fake DOM ---------------------------------------------------------
function makeElement(ownerDoc, tag = 'div') {
  const el = {
    tagName: tag,
    ownerDocument: ownerDoc,
    children: [],
    parentNode: null,
    style: {},
    _listeners: {},
    _classes: new Set(),
    _ownText: '',
    get firstChild() { return this.children[0] || null },
    // className and classList stay in sync, like the real DOM.
    get className() { return [...this._classes].join(' ') },
    set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)) },
    // textContent mirrors the real DOM: own text plus all descendant text.
    get textContent() {
      return this._ownText + this.children.reduce((acc, c) => acc + c.textContent, '')
    },
    set textContent(v) { this._ownText = v },
    classList: {
      add(...cs) { for (const c of cs) el._classes.add(c) },
      remove(...cs) { for (const c of cs) el._classes.delete(c) },
      toggle(c, force) {
        const has = el._classes.has(c)
        const want = force === undefined ? !has : !!force
        if (want) el._classes.add(c); else el._classes.delete(c)
        return want
      },
      contains(c) { return el._classes.has(c) }
    },
    appendChild(child) {
      if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1)
      child.parentNode = el
      el.children.push(child)
      return child
    },
    removeChild(child) {
      const i = el.children.indexOf(child)
      if (i >= 0) el.children.splice(i, 1)
      child.parentNode = null
      return child
    },
    addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn) },
    removeEventListener(type, fn) {
      const l = el._listeners[type] || []
      const i = l.indexOf(fn)
      if (i >= 0) l.splice(i, 1)
    },
    click() { for (const fn of [...(el._listeners.click || [])]) fn({}) },
    dispatch(type, evt = {}) { for (const fn of [...(el._listeners[type] || [])]) fn(evt) }
  }
  return el
}

function makeDocument() {
  const doc = {
    _byId: {},
    _listeners: {},
    pointerLockElement: null,
    createElement: (tag) => makeElement(doc, tag),
    getElementById: (id) => doc._byId[id] || null,
    addEventListener(type, fn) { (doc._listeners[type] = doc._listeners[type] || []).push(fn) },
    removeEventListener(type, fn) {
      const l = doc._listeners[type] || []
      const i = l.indexOf(fn)
      if (i >= 0) l.splice(i, 1)
    },
    exitPointerLock() { doc.pointerLockElement = null; doc.emit('pointerlockchange') },
    emit(type, evt = {}) { for (const fn of [...(doc._listeners[type] || [])]) fn(evt) }
  }
  return doc
}

// DFS: first descendant whose classList contains `cls`.
function find(root, cls) {
  for (const c of root.children) {
    if (c.classList.contains(cls)) return c
    const f = find(c, cls)
    if (f) return f
  }
  return null
}
// First .screen child of `root` that contains an element with exact `text`.
function screenWithText(root, text) {
  const has = (el) => el.textContent === text || el.children.some(has)
  for (const s of root.children) if (s.classList.contains('screen') && has(s)) return s
  return null
}

function makeHUDWorld() {
  const doc = makeDocument()
  return { doc, hudRoot: doc.createElement('div'), fxRoot: doc.createElement('div') }
}

function makeGame(doc, hud) {
  return {
    state: 'title',
    kills: 0,
    hud,
    waveManager: { wave: 1, remaining: 5 },
    player: { health: 100, maxHealth: 100, stamina: 100 },
    weapon: { ammo: 12, reserve: 60, isReloading: false },
    input: { requestLock() {} },
    startGame() {}
  }
}

// ---- HUD --------------------------------------------------------------
{
  const { hudRoot, fxRoot } = makeHUDWorld()
  const hud = new HUD(hudRoot, fxRoot)
  // constructor builds every expected region
  assert(find(hudRoot, 'hud-health'))
  assert(find(hudRoot, 'hud-stamina'))
  assert(find(hudRoot, 'hud-wave'))
  assert(find(hudRoot, 'hud-ammo'))
  assert(find(hudRoot, 'crosshair'))
  assert(find(fxRoot, 'fx-damage'))
  assert(find(fxRoot, 'fx-lowhealth'))
  hud.dispose()
}
{
  const { hudRoot } = makeHUDWorld()
  const hud = new HUD(hudRoot, makeDocument().createElement('div'))
  const healthBox = find(hudRoot, 'hud-health')
  const healthFill = find(healthBox, 'bar-fill')
  const healthValue = find(healthBox, 'hud-value')
  const waveValue = find(find(hudRoot, 'hud-wave'), 'hud-value')
  const threat = find(hudRoot, 'hud-threat')
  const ammoValue = find(find(hudRoot, 'hud-ammo'), 'hud-value')
  const player = { health: 100, maxHealth: 100, stamina: 100 }
  const weapon = { ammo: 12, reserve: 60, isReloading: false }
  const wave = { wave: 3, remaining: 2 }
  hud.update(player, weapon, wave)
  assert.strictEqual(healthFill.style.width, '100%')
  assert.strictEqual(healthValue.textContent, '100')
  assert.strictEqual(waveValue.textContent, 'WAVE 3')
  assert.strictEqual(threat.textContent, 'left: 2')
  assert.strictEqual(ammoValue.textContent, '12 / 60')
  hud.dispose()
}
{
  const { hudRoot, fxRoot } = makeHUDWorld()
  const hud = new HUD(hudRoot, fxRoot)
  const healthBox = find(hudRoot, 'hud-health')
  const low = find(fxRoot, 'fx-lowhealth')
  const vig = find(fxRoot, 'fx-damage')
  const player = { health: 100, maxHealth: 100, stamina: 100 }
  const weapon = { ammo: 12, reserve: 60, isReloading: false }
  const wave = { wave: 1, remaining: 5 }
  hud.update(player, weapon, wave)         // baseline, health 100
  player.health = 20                      // 20% -> low + a damage drop
  hud.update(player, weapon, wave)
  assert(healthBox.classList.contains('critical'))
  assert(low.classList.contains('on'))
  assert(parseFloat(vig.style.opacity) > 0)   // vignette flashed on the drop
  hud.dispose()
}
{
  const { hudRoot } = makeHUDWorld()
  const hud = new HUD(hudRoot, makeDocument().createElement('div'))
  const ammoBox = find(hudRoot, 'hud-ammo')
  const player = { health: 100, maxHealth: 100, stamina: 100 }
  const weapon = { ammo: 0, reserve: 60, isReloading: true }
  hud.update(player, weapon, { wave: 1, remaining: 5 })
  assert(ammoBox.classList.contains('reloading'))
  assert(ammoBox.classList.contains('empty'))
  assert.strictEqual(find(ammoBox, 'hud-value').textContent, '0 / 60')
  hud.dispose()
}
{
  const { hudRoot, fxRoot } = makeHUDWorld()
  const hud = new HUD(hudRoot, fxRoot)
  hud.update(null, null, null)             // all-null must not throw
  hud.show(); assert(hudRoot.classList.contains('visible'))
  hud.hide(); assert(!hudRoot.classList.contains('visible'))
  assert(hudRoot.children.length > 0)
  hud.dispose()
  assert.strictEqual(hudRoot.children.length, 0)
  assert.strictEqual(fxRoot.children.length, 0)
}
{
  // V5P-1: hit marker + kill confirmation
  const { hudRoot } = makeHUDWorld()
  const hud = new HUD(hudRoot, makeDocument().createElement('div'))
  const marker = find(hudRoot, 'hit-marker')
  assert(marker)
  assert(!marker.classList.contains('show'))            // hidden at rest
  hud.hitMarker()
  assert(marker.classList.contains('show'))
  assert(marker.classList.contains('hit'))
  assert(!marker.classList.contains('kill'))
  hud.killMarker()
  assert(marker.classList.contains('kill'))
  assert(!marker.classList.contains('hit'))             // kill overrides hit
  hud.update(null, null, null)
  hud._lastNow = hud._now() - 1000                     // simulate 1 s of frames
  hud.update(null, null, null)
  assert(!marker.classList.contains('show'))            // decayed out
  hud.clearMarker()
  hud.hitMarker()
  assert(marker.classList.contains('show'))             // re-trigger works
  hud.dispose()
  assert.strictEqual(hudRoot.children.length, 0)        // marker removed on dispose
}

// ---- Screens ----------------------------------------------------------
{
  const doc = makeDocument()
  const hudRoot = doc.createElement('div'); const fxRoot = doc.createElement('div')
  const hud = new HUD(hudRoot, fxRoot)
  const game = makeGame(doc, hud)
  const screensRoot = doc.createElement('div')
  const screens = new Screens(screensRoot, game)
  // constructor shows the title screen immediately
  const title = screenWithText(screensRoot, 'DEADFALL')
  assert(title.classList.contains('visible'))
  assert(find(title, 'game-title'))
  assert(find(title, 'tagline'))
  assert.strictEqual(find(title, 'controls-grid').children.length, 8) // v2 adds F + 1/2 rows
  assert.strictEqual(find(title, 'btn').textContent, 'START')
  // other screens are hidden
  assert(!screenWithText(screensRoot, 'PAUSED').classList.contains('visible'))
  assert(!screenWithText(screensRoot, 'YOU DIED').classList.contains('visible'))
  // HUD is hidden while on the title screen
  assert(!hudRoot.classList.contains('visible'))
  screens.dispose()
}
{
  const doc = makeDocument()
  const hud = new HUD(doc.createElement('div'), doc.createElement('div'))
  const game = makeGame(doc, hud)
  const screensRoot = doc.createElement('div')
  const screens = new Screens(screensRoot, game)
  let startCalls = 0
  game.startGame = () => startCalls++
  find(screenWithText(screensRoot, 'DEADFALL'), 'btn').click()   // START
  assert.strictEqual(startCalls, 1)
  // game-over RESTART also calls startGame
  screens.showGameOver({ wave: 2, kills: 7 })
  find(screenWithText(screensRoot, 'YOU DIED'), 'btn').click()   // RESTART
  assert.strictEqual(startCalls, 2)
  screens.dispose()
}
{
  const doc = makeDocument()
  const hud = new HUD(doc.createElement('div'), doc.createElement('div'))
  const game = makeGame(doc, hud)
  const screensRoot = doc.createElement('div')
  const screens = new Screens(screensRoot, game)
  screens.showGameOver({ wave: 4, kills: 12 })
  const over = screenWithText(screensRoot, 'YOU DIED')
  assert(over.classList.contains('visible'))
  assert.strictEqual(find(over, 'stat').textContent, 'Wave 4 — 12 kills — 0 pts')
  screens.dispose()
}
{
  const doc = makeDocument()
  const hud = new HUD(doc.createElement('div'), doc.createElement('div'))
  const game = makeGame(doc, hud)
  const screensRoot = doc.createElement('div')
  const screens = new Screens(screensRoot, game)
  screens.showBanner('WAVE 1 CLEARED')
  const banner = find(screensRoot, 'banner')
  assert.strictEqual(banner.textContent, 'WAVE 1 CLEARED')
  assert(banner.classList.contains('show'))
  if (screens._bannerTimer) { clearTimeout(screens._bannerTimer); screens._bannerTimer = 0 }
  screens.dispose()
}
{
  const doc = makeDocument()
  const hudRoot = doc.createElement('div'); const fxRoot = doc.createElement('div')
  const hud = new HUD(hudRoot, fxRoot)
  const game = makeGame(doc, hud)
  const screensRoot = doc.createElement('div')
  const screens = new Screens(screensRoot, game)
  // pointer lock lost while paused -> pause screen
  game.state = 'paused'
  doc.pointerLockElement = null
  doc.emit('pointerlockchange')
  assert(screenWithText(screensRoot, 'PAUSED').classList.contains('visible'))
  // pointer lock regained while playing -> gameplay (screens hidden, HUD shown)
  game.state = 'playing'
  doc.pointerLockElement = {}
  doc.emit('pointerlockchange')
  for (const s of screensRoot.children) if (s.classList.contains('screen')) assert(!s.classList.contains('visible'))
  assert(hudRoot.classList.contains('visible'))
  // pause overlay click re-locks the pointer
  let locks = 0
  game.input = { requestLock: () => locks++ }
  game.state = 'paused'
  screens.showPause()
  screenWithText(screensRoot, 'PAUSED').click()
  assert.strictEqual(locks, 1)
  screens.dispose()
}
{
  const doc = makeDocument()
  const hud = new HUD(doc.createElement('div'), doc.createElement('div'))
  const game = makeGame(doc, hud)
  const screensRoot = doc.createElement('div')
  const screens = new Screens(screensRoot, game)
  let starts = 0
  game.startGame = () => starts++
  game.state = 'title';  doc.emit('keydown', { key: 'Enter' }); assert(starts === 1)
  game.state = 'playing'; doc.emit('keydown', { key: 'Enter' }); assert(starts === 1) // ignored
  game.state = 'gameover'; doc.emit('keydown', { key: 'Enter' }); assert(starts === 2)
  screens.dispose()
}

{
  // V9: title shows the stored high score; game-over shows score + record line
  const doc = makeDocument()
  const hud = new HUD(doc.createElement('div'), doc.createElement('div'))
  const game = makeGame(doc, hud)
  game.score = { value: 235, best: 235 }
  const screensRoot = doc.createElement('div')
  const screens = new Screens(screensRoot, game)
  const title = screenWithText(screensRoot, 'DEADFALL')
  assert.strictEqual(find(title, 'highscore').textContent, 'HIGH SCORE: 235')
  screens.showGameOver({ wave: 3, kills: 9, score: 235, best: 235, record: true })
  const over = screenWithText(screensRoot, 'YOU DIED')
  assert.strictEqual(find(over, 'stat').textContent, 'Wave 3 — 9 kills — 235 pts')
  assert.strictEqual(find(over, 'record').textContent, 'NEW HIGH SCORE — 235')
  // no record -> line stays empty
  screens.showGameOver({ wave: 3, kills: 5, score: 100, best: 235, record: false })
  assert.strictEqual(find(over, 'record').textContent, '')
  screens.dispose()
}

console.log('hud-screens OK')
