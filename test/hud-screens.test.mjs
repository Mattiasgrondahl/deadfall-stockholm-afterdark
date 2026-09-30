// Focused tests for HUD.js and Screens.js, driven by a minimal fake DOM
// (element + document stubs). No real browser is involved.
import assert from 'node:assert'
import { HUD } from '../src/game/HUD.js'
import { Screens, randomPlayerName, randomRoomCode } from '../src/game/Screens.js'
import { Score } from '../src/game/Score.js'
import { VERSION } from '../src/version.js'

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
    insertBefore(child, ref) {
      if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1)
      const i = ref ? el.children.indexOf(ref) : -1
      child.parentNode = el
      if (i < 0) el.children.push(child); else el.children.splice(i, 0, child)
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
    mode: 'survival',
    _myTeam: 'lovis',
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
  assert.strictEqual(healthValue.textContent, '100%', 'health shown as a percentage')
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
  // v6 visuals (7): the damage flash is suppressed while the low-health frame
  // is on, so the two red layers never stack. The drop still registers — on
  // the breathing low-health frame instead.
  assert.strictEqual(vig.style.opacity, '0', 'no vignette while the low-health frame is on')
  const lowOp = parseFloat(low.style.opacity)
  assert(lowOp > 0 && lowOp <= 0.75, 'low-health frame pulses within bounds')
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
  hud.clearMarker()
  hud.hitMarker('head')                                 // headshot variant
  assert(marker.classList.contains('headshot'))
  assert(!marker.classList.contains('kill'))
  hud.killMarker('head')                                // headshot kill keeps amber + red
  assert(marker.classList.contains('kill'))
  assert(marker.classList.contains('headshot'))
  hud.killMarker('body')                                // body kill drops the amber
  assert(!marker.classList.contains('headshot'))
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
  // v3: the title screen stamps the game version (single source of truth in
  // src/version.js), rendered via textContent so it is XSS-safe.
  const verEl = find(title, 'version')
  assert(verEl, 'title screen shows a version element')
  assert.strictEqual(verEl.textContent, 'v' + VERSION, 'version label matches src/version.js')
  assert.strictEqual(find(title, 'controls-grid').children.length, 14) // Phase 1 + v15 B-next control
  const btns = []
  const collectBtns = (el) => { for (const c of el.children) { if (c.classList.contains('btn')) btns.push(c); collectBtns(c) } }
  collectBtns(title)
  assert.deepStrictEqual(btns.map(b => b.textContent), ['SETTINGS', 'START', 'JOIN CO-OP'])
  // other screens are hidden
  assert(!screenWithText(screensRoot, 'PAUSED').classList.contains('visible'))
  assert(!screenWithText(screensRoot, 'YOU DIED').classList.contains('visible'))
  // HUD is hidden while on the title screen
  assert(!hudRoot.classList.contains('visible'))
  screens.dispose()
}
{
  // v8: the difficulty picker is a single-choice control — exactly one option
  // carries the 'on' (selected) class at a time, so the active mode is
  // unmistakable. NIGHTMARE no longer also lights up FRENZY.
  const doc = makeDocument()
  const hud = new HUD(doc.createElement('div'), doc.createElement('div'))
  const game = makeGame(doc, hud)
  const screensRoot = doc.createElement('div')
  const screens = new Screens(screensRoot, game)
  const title = screenWithText(screensRoot, 'DEADFALL')
  const toggles = []
  const collect = (el) => { for (const c of el.children) { if (c.classList.contains('toggle')) toggles.push(c); collect(c) } }
  collect(title)
  const byName = (t) => toggles.find((b) => b.textContent === t)
  const night = byName('NIGHT'), frenzy = byName('FRENZY'), nightmare = byName('NIGHTMARE')
  assert.ok(night && frenzy && nightmare, 'all three difficulty toggles exist')
  // CTF added a MODE row (SURVIVAL / CAPTURE THE FLAG) with its own single-choice
  // 'on' state, so scope the difficulty assertions to the three difficulty buttons.
  const DIFF = new Set(['NIGHT', 'FRENZY', 'NIGHTMARE'])
  const onCount = () => toggles.filter((b) => DIFF.has(b.textContent) && b.classList.contains('on')).length
  // Default load: FRENZY is the shipped default and is the only selected option.
  assert.equal(frenzy.classList.contains('on'), true, 'frenzy selected by default')
  assert.equal(onCount(), 1, 'exactly one option selected on load')
  // Picking NIGHTMARE selects ONLY nightmare (frenzy no longer double-lights).
  nightmare.click()
  assert.equal(game.difficulty, 'nightmare', 'game difficulty set')
  assert.equal(nightmare.classList.contains('on'), true, 'nightmare selected')
  assert.equal(frenzy.classList.contains('on'), false, 'frenzy NOT lit when nightmare chosen')
  assert.equal(onCount(), 1, 'still exactly one selected')
  // Picking NIGHT clears the others.
  night.click()
  assert.equal(game.difficulty, 'normal')
  assert.equal(night.classList.contains('on'), true)
  assert.equal(onCount(), 1, 'night is the sole selection')
  screens.dispose()
}
{
  // CTF: the MODE picker is a single-choice control (SURVIVAL default vs CAPTURE
  // THE FLAG) and sets game.mode.
  const doc = makeDocument()
  const hud = new HUD(doc.createElement('div'), doc.createElement('div'))
  const game = makeGame(doc, hud)
  const screensRoot = doc.createElement('div')
  const screens = new Screens(screensRoot, game)
  const title = screenWithText(screensRoot, 'DEADFALL')
  const toggles = []
  const collect = (el) => { for (const c of el.children) { if (c.classList.contains('toggle')) toggles.push(c); collect(c) } }
  collect(title)
  const byName = (t) => toggles.find((b) => b.textContent === t)
  const survival = byName('SURVIVAL'), ctf = byName('CAPTURE THE FLAG')
  assert.ok(survival && ctf, 'both mode toggles exist')
  assert.equal(game.mode, 'survival', 'survival is the default mode')
  assert.equal(survival.classList.contains('on'), true, 'survival selected by default')
  const MODE = new Set(['SURVIVAL', 'CAPTURE THE FLAG'])
  const onCount = () => toggles.filter((b) => MODE.has(b.textContent) && b.classList.contains('on')).length
  assert.equal(onCount(), 1, 'exactly one mode selected on load')
  ctf.click()
  assert.equal(game.mode, 'ctf', 'game mode set to ctf')
  assert.equal(ctf.classList.contains('on'), true, 'ctf selected')
  assert.equal(survival.classList.contains('on'), false, 'survival not lit when ctf chosen')
  assert.equal(onCount(), 1, 'still exactly one mode selected')
  survival.click()
  assert.equal(game.mode, 'survival')
  // CTF TEAM picker: LOVISEDAL / KRAGSTALUND single-choice toggles that set
  // game._myTeam. They live in a row hidden until CTF is selected.
  const lovis = byName('LOVISEDAL'), krag = byName('KRAGSTALUND')
  assert.ok(lovis && krag, 'both team toggles exist')
  assert.equal(game._myTeam, 'lovis', 'lovis is the default side')
  assert.equal(lovis.classList.contains('on'), true, 'lovis selected by default')
  const TEAM = new Set(['LOVISEDAL', 'KRAGSTALUND'])
  const teamOn = () => toggles.filter((b) => TEAM.has(b.textContent) && b.classList.contains('on')).length
  assert.equal(teamOn(), 1, 'exactly one team selected on load')
  krag.click()
  assert.equal(game._myTeam, 'krag', 'clicking KRAGSTALUND sets the side')
  assert.equal(krag.classList.contains('on'), true, 'krag selected')
  assert.equal(lovis.classList.contains('on'), false, 'lovis not lit when krag chosen')
  assert.equal(teamOn(), 1, 'still exactly one team selected')
  // The team row is hidden in survival and revealed when CTF is chosen.
  assert.equal(screens._teamRow.classList.contains('hidden'), true, 'team row hidden in survival')
  ctf.click()
  assert.equal(screens._teamRow.classList.contains('hidden'), false, 'team row shown in ctf')
  screens.dispose()
}
{
  // CTF: HUD.setCtf drives the scoreboard + carrier line from a snapshot ctf block.
  const doc = makeDocument()
  const hud = new HUD(doc.createElement('div'), doc.createElement('div'))
  const box = hud._ctfBox
  assert.ok(box.classList.contains('hidden'), 'ctf box hidden by default')
  hud.setCtf({ scores: { lovis: 2, krag: 1 }, flags: { lovis: { carrier: null, dropped: null }, krag: { carrier: 'me', dropped: null } } }, 'lovis')
  assert.equal(box.classList.contains('hidden'), false, 'ctf box shown when fed')
  assert.equal(hud._ctfLovis.textContent, 'LOVISEDAL 2 / 3', 'lovis score row')
  assert.equal(hud._ctfKrag.textContent, 'KRAGSTALUND 1 / 3', 'krag score row')
  assert.equal(hud._ctfCarrier.textContent, 'YOU CARRY THE FLAG — GET HOME!', 'carrier line: I carry the enemy flag')
  hud.setCtf({ scores: { lovis: 2, krag: 1 }, flags: { lovis: { carrier: 'x', dropped: null }, krag: { carrier: null, dropped: null } } }, 'lovis')
  assert.equal(hud._ctfCarrier.textContent, 'ENEMY HAS YOUR FLAG', 'carrier line: enemy has my flag')
  hud.setCtf(null, 'lovis')
  assert.equal(box.classList.contains('hidden'), true, 'null hides the ctf box (survival)')
}
{
  const doc = makeDocument()
  const hud = new HUD(doc.createElement('div'), doc.createElement('div'))
  const game = makeGame(doc, hud)
  const screensRoot = doc.createElement('div')
  const screens = new Screens(screensRoot, game)
  let startCalls = 0
  game.startGame = () => startCalls++
  const startButtons = []
  const collectStart = (el) => { for (const c of el.children) { if (c.classList.contains('btn') && c.textContent === 'START') startButtons.push(c); collectStart(c) } }
  collectStart(screenWithText(screensRoot, 'DEADFALL'))
  startButtons[0].click()   // START
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

{
  // Hosted high score: the title label follows the async GET /api/highscore
  // result through Score's _onBestChange hook, and dispose reverses the hook.
  const doc = makeDocument()
  const hud = new HUD(doc.createElement('div'), doc.createElement('div'))
  const game = makeGame(doc, hud)
  game.score = { best: 100, _onBestChange: null }
  const screensRoot = doc.createElement('div')
  const screens = new Screens(screensRoot, game)
  const title = screenWithText(screensRoot, 'DEADFALL')
  assert.strictEqual(find(title, 'highscore').textContent, 'HIGH SCORE: 100')
  game.score.best = 900
  game.score._onBestChange()
  assert.strictEqual(find(title, 'highscore').textContent, 'HIGH SCORE: 900', 'late hosted best refreshes the label')
  screens.dispose()
  assert.strictEqual(game.score._onBestChange, null, 'dispose clears the callback')
}

{
  // V5P-2: directional damage edge glow + amount-scaled vignette
  const { hudRoot, fxRoot } = makeHUDWorld()
  const hud = new HUD(hudRoot, fxRoot)
  const vig = find(fxRoot, 'fx-damage')
  const edge = find(fxRoot, 'fx-dmg-edge')
  const player = { health: 100, maxHealth: 100, stamina: 100, position: { x: 0, z: 0 }, yaw: 0 }
  const weapon = { ammo: 5, reserve: 30, isReloading: false }
  const wave = { wave: 1, remaining: 5 }
  let now = 0
  hud._now = () => now // fake clock, 16 ms per step
  const step = () => { now += 16; hud.update(player, weapon, wave) }
  step() // baseline, no damage yet
  hud.dmgFeedback(10, { position: { x: 0, z: -5 } }) // in front (yaw 0 faces -Z)
  step()
  assert.strictEqual(edge.style.transform, 'rotate(0.0deg)')
  assert(parseFloat(vig.style.opacity) > 0, 'vignette fires on hit')
  const opFront = parseFloat(vig.style.opacity)
  hud.dmgFeedback(30, { position: { x: 0, z: -5 } }) // bigger hit -> stronger
  step()
  assert(parseFloat(vig.style.opacity) > opFront, 'peak scales with damage')
  hud.dmgFeedback(10, { position: { x: 5, z: 0 } }) // from the right
  step()
  assert.strictEqual(edge.style.transform, 'rotate(90.0deg)')
  hud.dmgFeedback(10, { position: { x: 0, z: 5 } }) // from behind
  step()
  assert.strictEqual(edge.style.transform, 'rotate(180.0deg)')
  hud.dmgFeedback(10, 'zombie') // position-less source: no rotation change
  step()
  assert.strictEqual(edge.style.transform, 'rotate(180.0deg)')
  assert(parseFloat(vig.style.opacity) > 0)
  for (let i = 0; i < 60; i++) { player.health = 100; step() } // decay to rest
  assert.strictEqual(vig.style.opacity, '0')
  assert.strictEqual(edge.style.opacity, '0')
  hud.dispose()
}

{
  // V5P-4: Enter resumes from pause; pause + game-over gain dim 'or press Enter' hints
  const doc = makeDocument()
  const hud = new HUD(doc.createElement('div'), doc.createElement('div'))
  const game = makeGame(doc, hud)
  const screensRoot = doc.createElement('div')
  const screens = new Screens(screensRoot, game)
  // (1) Enter while paused re-locks the pointer (resumes gameplay)
  let locks = 0
  game.state = 'paused'
  game.input = { requestLock: () => { locks++ } }
  screens.showPause()
  doc.emit('keydown', { key: 'Enter' })
  assert.strictEqual(locks, 1)
  // (2) pause screen holds exactly two tagline elements
  const pause = screenWithText(screensRoot, 'PAUSED')
  const tags = []
  const collect = (el) => {
    for (const c of el.children) {
      if (c.classList.contains('tagline')) tags.push(c)
      collect(c)
    }
  }
  collect(pause)
  assert.strictEqual(tags.length, 2)
  assert.strictEqual(tags[0].textContent, 'click to resume')
  assert.strictEqual(tags[1].textContent, 'or press Enter')
  // (3) game-over gains the dim restart hint; stat line format is unchanged
  screens.showGameOver({ wave: 3, kills: 5, score: 100, best: 235, record: false })
  const over = screenWithText(screensRoot, 'YOU DIED')
  assert.strictEqual(find(over, 'stat').textContent, 'Wave 3 — 5 kills — 100 pts')
  const hint = find(over, 'tagline')
  assert(hint && hint.classList.contains('dim'))
  assert.strictEqual(hint.textContent, 'or press Enter to restart')
  screens.dispose()
}

// ---- v6 visuals (7): damage vignette severity + non-obscuring frame ------
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const CSS = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8')
// Parse the two radial gradients the HUD layers use, and evaluate the ramp at
// a normalized radius t (0 = center, 1 = the ellipse's own rim).
function gradStops(sel) {
  const m = CSS.match(new RegExp('\\.' + sel + '\\s*\\{[^}]*radial-gradient\\(ellipse at center,(.*?)\\);', 's'))
  assert.ok(m, '.' + sel + ' keeps a radial-gradient(ellipse at center, ...)')
  return [...m[1].matchAll(/rgba\([^)]*?,\s*([\d.]+)\)\s+([\d.]+)%/g)]
    .map((g) => [parseFloat(g[2]) / 100, parseFloat(g[1])])
}
function gradAlpha(stops, t) {
  if (t <= stops[0][0]) return stops[0][1]
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, a0] = stops[i], [p1, a1] = stops[i + 1]
    if (t <= p1) return a0 + (a1 - a0) * ((t - p0) / (p1 - p0 || 1))
  }
  return stops[stops.length - 1][1]
}
{
  // The damage vignette must be strictly peripheral: fully clear through the
  // central band where a 10-30 m zombie appears, and its rim alpha capped so
  // the outer ring cannot push a 30 m walker under the C >= 0.90 gate.
  const st = gradStops('fx-damage')
  assert.strictEqual(st[0][1], 0, 'gradient starts at zero alpha')
  assert.ok(st[0][0] >= 0.60, `clear disc reaches t=${st[0][0]} >= 0.60 (covers the central 40% band)`)
  assert.ok(st[st.length - 1][1] <= 0.35, `rim alpha ${st[st.length - 1][1]} <= 0.35`)
  assert.strictEqual(gradAlpha(st, 0.4), 0, 'center 40% band stays clear')
  // Screen fraction above 5% effective alpha at the worst hook peak (0.55):
  // alpha(t) * 0.55 > 0.05 requires alpha > 0.0909. The ellipse covers
  // t0^2 of the screen below t0, so the tinted ring is 1 - t0^2.
  let t0 = 0
  while (t0 < 1 && gradAlpha(st, t0) <= 0.05 / 0.55) t0 += 0.001
  assert.ok(1 - t0 * t0 <= 0.40, `tinted fraction ${(1 - t0 * t0).toFixed(3)} <= 0.40 of the screen`)
}
{
  // The persistent low-health frame must breathe, not sit at full strength.
  const st = gradStops('fx-lowhealth')
  assert.strictEqual(st[0][1], 0, 'low-health gradient starts at zero alpha')
  assert.ok(st[0][0] >= 0.55, `clear disc reaches t=${st[0][0]} >= 0.55`)
  assert.ok(st[st.length - 1][1] <= 0.32, `rim alpha ${st[st.length - 1][1]} <= 0.32`)
  const { hudRoot, fxRoot } = makeHUDWorld()
  const hud = new HUD(hudRoot, fxRoot)
  const low = find(fxRoot, 'fx-lowhealth')
  const player = { health: 25, maxHealth: 100, stamina: 100 }
  const weapon = { ammo: 5, reserve: 30, isReloading: false }
  const wave = { wave: 1, remaining: 5 }
  let now = 0
  hud._now = () => now
  const ops = []
  for (let i = 0; i < 120; i++) { now += 16; hud.update(player, weapon, wave); ops.push(parseFloat(low.style.opacity)) }
  const lo = Math.min(...ops), hi = Math.max(...ops)
  assert.ok(lo >= 0.20 && hi <= 0.80, `pulse stays inside [0.25, 0.75]: got [${lo.toFixed(3)}, ${hi.toFixed(3)}]`)
  assert.ok(hi - lo >= 0.30, `pulse breathes (range ${(hi - lo).toFixed(3)} >= 0.30)`)
  // Deterministic: a second HUD driven on the same clock produces the same
  // curve (no Math.random anywhere in the pulse).
  const w2 = makeHUDWorld()
  const hud2 = new HUD(w2.hudRoot, w2.fxRoot)
  const low2 = find(w2.fxRoot, 'fx-lowhealth')
  let now2 = 0
  hud2._now = () => now2
  const ops2 = []
  for (let i = 0; i < 120; i++) { now2 += 16; hud2.update(player, weapon, wave); ops2.push(parseFloat(low2.style.opacity)) }
  assert.deepStrictEqual(ops2, ops)
  hud.dispose(); hud2.dispose()
}
{
  // Headless-safe: no document means HUD is never constructed by Game.js; the
  // class itself only touches ownerDocument, and update() with a null player
  // stays a no-op without throwing.
  const hud = new HUD(makeDocument().createElement('div'), makeDocument().createElement('div'))
  hud.update(null, null, null)
  hud.dmgFeedback(20, 'zombie')
  hud.update(null, null, null)
  hud.dispose()
}

// ---- v6 visuals (8): wave / danger indicators ------------------------
// Real WaveManager numbers: wave 1 total = 8, cap = min(8 + wave, 18),
// intermission = 3 s after wave 1 (intermissionFor), next-wave preview from
// the WaveManager getter itself.
function fakeWave(o) {
  return Object.assign({ wave: 1, remaining: 0, intermission: 0, cap: 9, nextWavePreview: null }, o)
}
{
  // Intermission: countdown + composition preview + next total + cap.
  const { hudRoot } = makeHUDWorld()
  const hud = new HUD(hudRoot, makeDocument().createElement('div'))
  const waveBox = find(hudRoot, 'hud-wave')
  const waveValue = find(waveBox, 'hud-value')
  const waveSub = find(waveBox, 'hud-wave-sub')
  const threat = find(hudRoot, 'hud-threat')
  const threatSub = find(hudRoot, 'hud-threat-sub')
  const preview = { wave: 2, total: 11, walker: 9, shambler: 2, screamer: 0, boss: false }
  const w = fakeWave({ wave: 1, remaining: 0, intermission: 3.0, cap: 9, nextWavePreview: preview })
  hud.update({ health: 100, maxHealth: 100, stamina: 100 }, null, w)
  assert.strictEqual(waveValue.textContent, 'WAVE 1')
  assert.strictEqual(waveSub.textContent, 'in 3s — 2 shamblers, 9 walkers', 'countdown + composition from nextWavePreview')
  assert.strictEqual(threat.textContent, 'next: 11', 'next-wave total')
  assert.strictEqual(threatSub.textContent, 'cap 9')
  assert(!waveSub.classList.contains('imminent'))
  w.intermission = 1.4
  hud.update(null, null, w)
  assert.strictEqual(waveSub.textContent, 'in 2s — 2 shamblers, 9 walkers', 'countdown tracks intermission')
  assert(waveSub.classList.contains('imminent'), 'last 2 s highlighted')
  w.intermission = 0
  w.nextWavePreview = null
  w.remaining = 6
  hud.update(null, null, w)
  assert.strictEqual(waveSub.textContent, '', 'preview cleared when the intermission ends')
  assert(!waveSub.classList.contains('imminent'))
  assert.strictEqual(threat.textContent, 'left: 6')
  // v7: the "room N/cap" headroom line is hidden except at the cap, so a
  // non-danger frame shows an empty sub-line.
  assert.strictEqual(threatSub.textContent, '', 'room headroom line hidden')
  assert(!threat.classList.contains('danger'))
  w.remaining = 8
  hud.update(null, null, w)
  assert.strictEqual(threatSub.textContent, 'CAP 8/9', 'cap pressure readout')
  assert(threat.classList.contains('danger'))
  hud.dispose()
}
{
  // Wave-5 boss: `remaining` counts the brute, but the brute never counts
  // against the spawn cap — the danger test must exclude it.
  const { hudRoot } = makeHUDWorld()
  const hud = new HUD(hudRoot, makeDocument().createElement('div'))
  const threat = find(hudRoot, 'hud-threat')
  const threatSub = find(hudRoot, 'hud-threat-sub')
  const w = fakeWave({ wave: 5, remaining: 14, cap: 13 })
  hud.boss = { isDead: false }
  hud.update(null, null, w)
  assert.strictEqual(threat.textContent, 'left: 14', 'boss still counted in left')
  assert.strictEqual(threatSub.textContent, 'CAP 13/13', 'boss excluded from cap pressure (13, not 14)')
  assert(threat.classList.contains('danger'))
  hud.boss = null
  hud.update(null, null, w)
  assert.strictEqual(threatSub.textContent, 'CAP 14/13', 'boss dead -> full remaining applies')
  hud.dispose()
}
{
  // No extra per-frame DOM writes: the sub-lines are written only when their
  // string changes (the pre-existing wave/threat writes stay as they were).
  const { hudRoot } = makeHUDWorld()
  const hud = new HUD(hudRoot, makeDocument().createElement('div'))
  const waveBox = find(hudRoot, 'hud-wave')
  const waveSub = find(waveBox, 'hud-wave-sub')
  const threatSub = find(hudRoot, 'hud-threat-sub')
  const preview = { wave: 2, total: 11, walker: 9, shambler: 2, screamer: 0, boss: false }
  const w = fakeWave({ wave: 1, remaining: 0, intermission: 3.0, cap: 9, nextWavePreview: preview })
  hud.update(null, null, w)
  waveSub.textContent = 'SENTINEL'
  for (let i = 0; i < 30; i++) hud.update(null, null, w)
  assert.strictEqual(waveSub.textContent, 'SENTINEL', 'unchanged preview line is not rewritten')
  // Once the value changes again, the write resumes.
  w.intermission = 2.0
  hud.update(null, null, w)
  assert.notStrictEqual(waveSub.textContent, 'SENTINEL', 'a changed value is written again')
  // In the fighting branch the gate applies to the cap line: 'cap 9' is
  // written every frame during the intermission (by design), but the
  // room/CAP line is written only when it changes.
  w.intermission = 0
  w.nextWavePreview = null
  w.remaining = 4
  hud.update(null, null, w)
  const roomText = threatSub.textContent
  threatSub.textContent = 'SENTINEL'
  for (let i = 0; i < 30; i++) hud.update(null, null, w)
  assert.strictEqual(threatSub.textContent, 'SENTINEL', 'unchanged cap line is not rewritten')
  w.remaining = 8
  hud.update(null, null, w)
  assert.strictEqual(threatSub.textContent, 'CAP 8/9', 'a changed cap line is written again')
  assert.notStrictEqual(threatSub.textContent, roomText)
  hud.dispose()
}
{
  // Composition is taken verbatim from nextWavePreview: an injected
  // composition must appear exactly as the getter reports it.
  const { hudRoot } = makeHUDWorld()
  const hud = new HUD(hudRoot, makeDocument().createElement('div'))
  const waveSub = find(find(hudRoot, 'hud-wave'), 'hud-wave-sub')
  const w = fakeWave({ wave: 4, intermission: 4.5, cap: 12, nextWavePreview: { wave: 5, total: 20, walker: 8, shambler: 4, screamer: 8, boss: true } })
  hud.update(null, null, w)
  assert.strictEqual(waveSub.textContent, 'in 5s — 4 shamblers, 8 screamers, 8 walkers, BOSS')
  hud.dispose()
}
{
  // Headless-safe: a plain object without intermission/cap/preview degrades
  // to the old readouts and never throws.
  const { hudRoot } = makeHUDWorld()
  const hud = new HUD(hudRoot, makeDocument().createElement('div'))
  const threat = find(hudRoot, 'hud-threat')
  const threatSub = find(hudRoot, 'hud-threat-sub')
  hud.update(null, null, { wave: 1, remaining: 5 })
  assert.strictEqual(threat.textContent, 'left: 5')
  assert.strictEqual(threatSub.textContent, '', 'no cap data -> no cap line')
  hud.update(null, null, null)
  hud.dispose()
}
{
  // No stray full-screen tint layers beyond the sanctioned set: the fx root
  // holds the three pre-existing layers plus the v28 R2 frost vignette (an
  // intentional health-driven frost rim), and the new readouts live in the HUD
  // root. (v28 R2 supersedes the round-47 "exactly 3" rule.)
  const { hudRoot, fxRoot } = makeHUDWorld()
  const hud = new HUD(hudRoot, fxRoot)
  const fxClasses = fxRoot.children.map((c) => c.className)
  assert.strictEqual(fxRoot.children.length, 4, 'fx layers: damage + dmg-edge + lowhealth + frost')
  assert.deepStrictEqual(fxClasses, ['fx-damage', 'fx-dmg-edge', 'fx-lowhealth', 'fx-frost'])
  assert(find(hudRoot, 'hud-wave-sub'))
  assert(find(hudRoot, 'hud-threat-sub'))
  hud.dispose()
}

// ---- v6 visuals (9): screen/HUD readability -------------------------
// Michelson contrast of every text element against its ACTUAL composited
// background: .screen rgba(4,6,12,0.78) over --bg #05070c, then .panel
// rgba(10,14,24,0.82) over that. sRGB->linear first, alpha compositing in
// linear light. Threshold: 0.60 for text over the dark panel (defensible
// floor for small UI text on near-black), 0.30 for bare HUD text over a
// bright snow-lit scene (reduced by the existing text-shadow).
{
  const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const l2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
  const over = (fg, a, bg) => { const f = fg.map(s2l), b = bg.map(s2l); return b.map((v, i) => l2s(a * f[i] + (1 - a) * v)) }
  const lum = (rgb) => { const p = rgb.map(s2l); return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2] }
  const C = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) - Math.min(la, lb)) / (Math.max(la, lb) + Math.min(la, lb)) }
  const tok = (name) => { const m = CSS.match(new RegExp('--' + name + ':\\s*(#[0-9a-f]{6})')); assert.ok(m, '--' + name + ' token present'); return m[1] }
  const BG = hex('#05070c')
  const SCREEN = over(hex('#04060c'), 0.78, BG)
  const PANEL = over(hex('#0a0e18'), 0.82, SCREEN)
  const LIT = hex('#dde1ea') // snow-lit scene behind bare HUD text
  const ink = hex(tok('ink')), inkDim = hex(tok('ink-dim')), banner = hex(tok('banner'))
  const danger = hex(tok('danger')), warn = hex(tok('warn')), accent = hex(tok('accent'))
  const ammo = hex(tok('ammo'))
  const panel = (fg, op = 1) => C(over(fg, op, PANEL), PANEL)
  // Every text on title/pause/settings/game-over clears 0.60 over the panel.
  assert.ok(panel(ink) >= 0.60, 'body ink on panel C=' + panel(ink).toFixed(3))
  assert.ok(panel(inkDim) >= 0.60, 'ink-dim on panel C=' + panel(inkDim).toFixed(3))
  assert.ok(panel(banner) >= 0.60, 'banner on panel C=' + panel(banner).toFixed(3))
  assert.ok(panel(danger) >= 0.60, 'danger (YOU DIED / record) on panel C=' + panel(danger).toFixed(3))
  assert.ok(panel(warn) >= 0.60, 'warn (high score) on panel C=' + panel(warn).toFixed(3))
  assert.ok(panel(accent) >= 0.60, 'accent (subtitle / keys) on panel C=' + panel(accent).toFixed(3))
  assert.ok(panel(ink, 0.85) >= 0.60, 'difficulty label (ink@0.85) C=' + panel(ink, 0.85).toFixed(3))
  // v8: the SELECTED difficulty option is a solid accent fill with dark ink text
  // — it must stay readable (high contrast) over the accent background, and the
  // fill must clearly separate it from the dim unselected options.
  const SEL_TEXT = hex('#0b1220')
  assert.ok(C(SEL_TEXT, accent) >= 0.60, 'selected-difficulty text on accent fill C=' + C(SEL_TEXT, accent).toFixed(3))
  assert.ok(C(accent, PANEL) >= 0.30, 'accent fill stands out from the panel C=' + C(accent, PANEL).toFixed(3))
  assert.ok(panel(inkDim, 0.8) >= 0.60, 'weapon name (ink-dim@0.8) C=' + panel(inkDim, 0.8).toFixed(3))
  assert.ok(panel(inkDim, 0.85) >= 0.60, 'tagline.dim (ink-dim@0.85) C=' + panel(inkDim, 0.85).toFixed(3))
  // The lines the player must act on are the clearest thing on their screen.
  assert.ok(panel(banner) >= panel(danger), 'RESTART/START banner >= YOU DIED danger')
  assert.ok(panel(banner) >= panel(inkDim), 'stat line (banner) > secondary text')
  // Every HUD cluster (health, stamina, weapons, battery, score, wave, threat,
  // threat-sub) now sits on a panel backing, so all HUD text is measured over
  // the panel at the 0.60 floor — nothing reads directly off the snow-lit
  // scene. The snow-lit ground color (0x93a9c2) is kept as the documented
  // worst-case backdrop for reference.
  const SNOW = hex('#93a9c2')
  assert.ok(panel(inkDim) >= 0.60, 'hud-label ink-dim over its panel C=' + panel(inkDim).toFixed(3))
  assert.ok(panel(ink) >= 0.60, 'hud-value ink over its panel C=' + panel(ink).toFixed(3))
  assert.ok(C(ink, SNOW) >= 0.30, 'ink over bare snow scene C=' + C(ink, SNOW).toFixed(3))
  const rule = (sel) => { const m = CSS.match(new RegExp('\\.' + sel + '\\s*\\{([^}]*)\\}', 's')); assert.ok(m, '.' + sel + ' rule present'); return m[1] }
  const allRules = (sel) => [...CSS.matchAll(new RegExp('\\.' + sel + '\\s*\\{([^}]*)\\}', 'gs'))].map((m) => m[1]).join('\n')
  for (const sel of ['hud-threat', 'hud-threat-sub']) {
    const b = allRules(sel)
    assert.ok(/background:\s*var\(--panel\)/.test(b), '.' + sel + ' has a panel backing')
    assert.ok(/border:\s*1px solid var\(--panel-edge\)/.test(b), '.' + sel + ' has a panel border')
  }
  // Narrow screens must not shrink action text below legibility.
  const media = CSS.match(/@media \(max-width: 560px\)\s*\{([\s\S]*)\}/)
  assert.ok(media, 'narrow-screen block present')
  const mv = media[1]
  const size = (sel) => { const m = mv.match(new RegExp('\\.' + sel + '[^\\n]*\\{[^}]*font-size:\\s*(\\d+)px')); return m ? parseInt(m[1], 10) : null }
  assert.ok(size('hud-value') >= 20, 'hud-value stays >= 20px on narrow screens')
  assert.ok(size('weapon-ammo') >= 20, 'weapon-ammo stays >= 20px on narrow screens')
  assert.ok(size('hud-music-btn') >= 12, 'music button stays >= 12px on narrow screens')
}

{
  // v3 T6: named high score render + XSS safety + T6b co-op field helpers.
  const doc = makeDocument()
  const hud = new HUD(doc.createElement('div'), doc.createElement('div'))
  const game = makeGame(doc, hud)
  // Real Score so setName sanitizes + clamps exactly as production does.
  const score = new Score({ localStorage: null }, () => 1)
  score.best = 235
  score.bestName = 'Ana'
  game.score = score
  const screensRoot = doc.createElement('div')
  const screens = new Screens(screensRoot, game)
  const title = screenWithText(screensRoot, 'DEADFALL')
  const hs = find(title, 'highscore')
  assert.strictEqual(hs.textContent, 'HIGH SCORE: Ana — 235', 'named record shows NAME — SCORE')
  // A new solo record is attributed to the typed name via score.setName.
  let started = 0
  game.startGame = () => { started++ }
  const soloInput = find(title, 'mp-row') // first mp-row is the PLAYER name row
  // find the input among the row's children
  const nameInput = soloInput.children.find((c) => String(c.tagName).toLowerCase() === 'input')
  nameInput.value = '  <img src=x onerror=alert(1)>  '
  // START routes through _startSolo -> score.setName (sanitized by Score) then startGame.
  screens._startSolo()
  assert.strictEqual(started, 1, 'START starts a solo run')
  assert.strictEqual(game.score.name, 'img srcx onerroralert1', 'name sanitized: markup + disallowed chars stripped, clamped to 24')
  // XSS safety: the record holder name is rendered via textContent only — the
  // high-score element gains NO child markup nodes from it (zero markup nodes).
  game.score.bestName = '<img src=x onerror=alert(1)>'
  screens.showTitle()
  assert.strictEqual(hs.children.length, 0, 'name added as text, not markup nodes')
  assert.ok(hs.textContent.includes('<img'), 'hostile payload survives as inert text')
  // T6b: co-op room + name fields each carry a short helper description.
  const mpRows = []
  const collectRows = (el) => { for (const c of el.children) { if (c.classList.contains('mp-row')) mpRows.push(c); collectRows(c) } }
  collectRows(title)
  const coopRow = mpRows.find((r) => r.children.some((c) => c.classList && c.classList.contains('difficulty-label') && c.textContent === 'CO-OP'))
  assert.ok(coopRow, 'co-op row present')
  // v11: the co-op row now carries only the room-code helper (the name field was
  // merged into the PLAYER row). The room helper still describes the shared room.
  const helperTexts = coopRow.children.filter((c) => c.classList.contains('tagline')).map((c) => c.textContent)
  assert.ok(helperTexts.some((t) => /shared game name/i.test(t)), 'room-code helper describes the shared room')
  // The single name field now covers both modes: its helper mentions the high
  // score and other players (co-op).
  const nameHelper = soloInput.children.filter((c) => c.classList.contains('tagline')).map((c) => c.textContent)
  assert.ok(nameHelper.some((t) => /high score/i.test(t)), 'name helper mentions the high score')
  assert.ok(nameHelper.some((t) => /other players|co-op/i.test(t)), 'name helper mentions co-op players')
  screens.dispose()
}

{
  // v6: the title screen renders a TOP 10 leaderboard from score.top, and the
  // name inputs are prefilled with a random handle instead of "player".
  const doc = makeDocument()
  const hud = new HUD(doc.createElement('div'), doc.createElement('div'))
  const game = makeGame(doc, hud)
  const score = new Score({ localStorage: null }, () => 1)
  score.best = 900
  score.bestName = 'Zed'
  score.top = [{ name: 'Zed', score: 900 }, { name: 'Ana', score: 500 }, { name: 'Kai', score: 120 }]
  game.score = score
  const screensRoot = doc.createElement('div')
  const screens = new Screens(screensRoot, game)
  const title = screenWithText(screensRoot, 'DEADFALL')
  const board = find(title, 'highscore-board')
  assert.ok(board, 'title screen has a leaderboard')
  assert.ok(board.textContent.includes('TOP 10'), 'board has a heading')
  const rows = board.children.filter((c) => c.classList.contains('board-row'))
  assert.strictEqual(rows.length, 10, 'exactly ten rows')
  assert.ok(rows[0].textContent.includes('Zed') && rows[0].textContent.includes('900'), 'rank 1 filled')
  assert.ok(rows[1].textContent.includes('Ana') && rows[1].textContent.includes('500'), 'rank 2 filled')
  assert.ok(rows[2].textContent.includes('Kai'), 'rank 3 filled')
  assert.ok(!rows[3].textContent.includes('Zed'), 'empty rank 4 has no stale name')
  // v4 UI: the board is reparented out of the centered panel and pinned to the
  // title overlay (a direct child of the .screen), not inside the .panel.
  assert.strictEqual(board.parentNode, title, 'v4 UI: board is a direct child of the title overlay')
  // v4 UI: empty ranks are pre-populated with a random handle + score 0 so the
  // board always reads as a full top-10.
  const r3name = rows[3].children[1].textContent
  const r3score = rows[3].children[2].textContent
  assert.ok(/\S/.test(r3name), 'v4 UI: empty rank 4 pre-filled with a random name')
  assert.strictEqual(r3score, '0', 'v4 UI: empty rank 4 pre-filled with score 0')
  assert.ok(/\S \S/.test(r3name), 'v4 UI: pre-filled name is an "Adjective Noun" handle')
  // textContent-only: a hostile name adds no markup nodes to the row.
  score.top = [{ name: '<img src=x>', score: 5 }]
  screens._renderBoard()
  const r0 = rows[0]
  assert.strictEqual(r0.children.length, 3, 'rank cell keeps only rank/name/score spans')
  assert.ok(r0.textContent.includes('<img'), 'hostile name survives as inert text')
  // Random name prefill: the single merged name input no longer holds "player".
  const nameInputs = []
  const collectInputs = (el) => { for (const c of el.children) { if (String(c.tagName).toLowerCase() === 'input') nameInputs.push(c); collectInputs(c) } }
  collectInputs(title)
  const nameFields = nameInputs.filter((c) => c.placeholder === 'your name')
  assert.strictEqual(nameFields.length, 1, 'v11: the two name fields are merged into one')
  const soloName = nameFields[0]
  assert.ok(soloName, 'a name input exists')
  assert.notStrictEqual(soloName.value, 'player', 'default name replaced by a random handle')
  assert.ok(/\S \S/.test(soloName.value), 'random handle is "Adjective Noun"')
  // Deterministic: randomPlayerName with a fixed seed is stable.
  assert.strictEqual(randomPlayerName(1234), randomPlayerName(1234), 'seeded name is deterministic')
  // v7: the co-op room input is prefilled with a random zombie-themed room code
  // instead of the shared "default", so a fresh session lands in its own room.
  const roomInput = nameInputs.find((c) => c.placeholder === 'room code')
  assert.ok(roomInput, 'a room-code input exists')
  assert.notStrictEqual(roomInput.value, 'default', 'default room replaced by a random code')
  assert.ok(/^[A-Z]+_[A-Z]+_\d{2}$/.test(roomInput.value), `room code is WORD_WORD_NN (${roomInput.value})`)
  // Deterministic + zombie-themed: seeded codes are stable and use the word list.
  assert.strictEqual(randomRoomCode(1234), randomRoomCode(1234), 'seeded room code is deterministic')
  assert.ok(/^[A-Z]+_[A-Z]+_\d{2}$/.test(randomRoomCode(99)), 'seeded code matches the shape')
  // v4 UI: both inputs are capped at 24 chars and filter disallowed characters
  // live on input (only a-z 0-9 space _ ! ? survive).
  assert.strictEqual(soloName.maxLength, 24, 'v4 UI: name input maxLength is 24')
  assert.strictEqual(roomInput.maxLength, 24, 'v4 UI: room input maxLength is 24')
  soloName.value = 'a<b>c(x)/d!e?f_1 2'
  soloName.dispatch('input')
  assert.strictEqual(soloName.value, 'abcxd!e?f_1 2', 'v4 UI: name input strips disallowed chars on input')
  screens.dispose()
}
{
  // v15: co-op end-game scoreboard — showGameOver with a per-player scoreboard
  // fills the end board (winner first, star on the winner) and names the winner;
  // a single-player run (no scoreboard) hides it.
  const doc = makeDocument()
  const hud = new HUD(doc.createElement('div'), doc.createElement('div'))
  const game = makeGame(doc, hud)
  const screensRoot = doc.createElement('div')
  const screens = new Screens(screensRoot, game)
  screens.showGameOver({
    wave: 3, kills: 12, score: 400, best: 400, record: false,
    scoreboard: [
      { id: 'p0', name: 'Ada', score: 400, kills: 30, playerKills: 1, deaths: 2, headshots: 8 },
      { id: 'p1', name: 'Bo', score: 150, kills: 10, playerKills: 0, deaths: 1, headshots: 0 }
    ],
    winner: 'p0'
  })
  const over = screenWithText(screensRoot, 'YOU DIED')
  const board = find(over, 'mp-end-board')
  assert.ok(board.classList.contains('visible'), 'co-op scoreboard is shown')
  assert.strictEqual(find(over, 'mp-end-title').textContent, 'WINNER — Ada', 'winner named')
  const rows = board.children.filter((c) => c.classList.contains('mp-end-row') && !c.classList.contains('mp-end-head'))
  const winnerCells = rows[0].children.map((c) => c.textContent)
  assert.strictEqual(winnerCells[0], 'Ada ★', 'winner row first + starred')
  assert.deepStrictEqual(winnerCells.slice(1), ['30', '1', '2', '8', '400'], 'zombies/playerKills/deaths/headshots/score')
  const loserCells = rows[1].children.map((c) => c.textContent)
  assert.strictEqual(loserCells[0], 'Bo', 'second row is the other player')
  assert.deepStrictEqual(loserCells.slice(1), ['10', '0', '1', '0', '150'], 'loser stats')
  // Single-player run: no scoreboard -> board hidden, cells cleared.
  screens.showGameOver({ wave: 2, kills: 5, score: 100 })
  assert.ok(!find(over, 'mp-end-board').classList.contains('visible'), 'board hidden without a scoreboard')
  screens.dispose()
}

console.log('hud-screens OK')
