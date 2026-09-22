// HUD v2 tests against a minimal fake DOM (the real HUD is browser-only;
// Game.js never constructs it in headless runs). Mirrors the fake pattern
// from input.test.mjs.
import assert from 'node:assert/strict'
import { HUD } from '../src/game/HUD.js'

function makeNode() {
  const classes = new Set() // shared store: className and classList stay in sync, as in a real DOM
  const n = {
    textContent: '',
    style: {},
    children: [],
    get className() { return [...classes].join(' ') },
    set className(v) { classes.clear(); for (const c of String(v).split(' ')) if (c) classes.add(c) },
    classList: {
      add(c) { classes.add(c) },
      remove(c) { classes.delete(c) },
      toggle(c, force) {
        const want = force === undefined ? !classes.has(c) : !!force
        if (want) classes.add(c); else classes.delete(c)
        return want
      },
      contains(c) { return classes.has(c) }
    },
    appendChild(c) { n.children.push(c); c.parent = n; return c },
    get firstChild() { return n.children[0] || null },
    removeChild(c) {
      const i = n.children.indexOf(c)
      if (i >= 0) n.children.splice(i, 1)
      return c
    },
    _listeners: {},
    addEventListener(ev, fn) { (n._listeners[ev] = n._listeners[ev] || []).push(fn) },
    removeEventListener(ev, fn) {
      if (n._listeners[ev]) n._listeners[ev] = n._listeners[ev].filter(f => f !== fn)
    },
    // Fire a registered listener (test helper for click handlers).
    _fire(ev, arg) { for (const f of (n._listeners[ev] || [])) f(arg) }
  }
  return n
}

function makeHUD() {
  const doc = { createElement: () => makeNode() }
  const hudRoot = makeNode(); hudRoot.ownerDocument = doc
  const fxRoot = makeNode(); fxRoot.ownerDocument = doc
  const hud = new HUD(hudRoot, fxRoot)
  return { hud, hudRoot }
}

function find(root, cls) {
  for (const c of root.children) {
    if (c.classList.contains(cls)) return c
    const r = find(c, cls)
    if (r) return r
  }
  return null
}

function fakeBank(currentName) {
  const mk = (name) => ({ name, ammo: 5, reserve: 30, isReloading: false, infiniteAmmo: name === 'axe' || name === 'sword' })
  const axe = mk('axe')
  const shotgun = mk('shotgun')
  const pistol = mk('pistol')
  const sword = mk('sword')
  return { axe, shotgun, pistol, sword, current: { axe, shotgun, pistol, sword }[currentName] || shotgun }
}

const fakePlayer = { health: 50, maxHealth: 100, stamina: 80 }

// --- bank mode: two slots, names, active highlight, infinite ammo ---
{
  const { hud, hudRoot } = makeHUD()
  const bank = fakeBank('shotgun')
  hud.update(fakePlayer, bank, { wave: 2, remaining: 7 })
  const slots = hudRoot.children
    .filter((c) => c.classList.contains('hud-weapons'))
    .flatMap((w) => w.children.filter((c) => c.classList.contains('weapon-slot')))
  assert.equal(slots.length, 4)
  assert.equal(slots[0].classList.contains('active'), false)
  assert.equal(slots[1].classList.contains('active'), true) // shotgun is current
  assert.equal(slots[2].classList.contains('active'), false)
  assert.equal(slots[3].classList.contains('active'), false)
  const names = slots.map((s) => find(s, 'weapon-name').textContent)
  const ammo = slots.map((s) => find(s, 'weapon-ammo').textContent)
  assert.deepEqual(names, ['axe', 'shotgun', 'pistol', 'sword'])
  assert.deepEqual(ammo, ['∞', '5 / 30', '5 / 30', '∞'])
  assert.equal(find(hudRoot, 'hud-ammo').classList.contains('hidden'), true) // legacy hidden
  assert.equal(hudRoot.children.find((c) => c.classList.contains('hud-battery')).classList.contains('hidden'), true)
  assert.equal(hudRoot.children.find((c) => c.classList.contains('hud-score')).classList.contains('hidden'), true)
  hud.dispose()
}

// --- switching moves the active highlight; reload + empty flags follow ---
{
  const { hud, hudRoot } = makeHUD()
  const bank = fakeBank('shotgun')
  hud.update(fakePlayer, bank, null)
  let slots = hudRoot.children.filter((c) => c.classList.contains('hud-weapons')).flatMap((w) => w.children.filter((c) => c.classList.contains('weapon-slot')))
  assert.equal(slots[0].classList.contains('active'), false)
  bank.current = bank.axe
  bank.shotgun.isReloading = true
  bank.shotgun.ammo = 0
  hud.update(fakePlayer, bank, null)
  slots = hudRoot.children.filter((c) => c.classList.contains('hud-weapons')).flatMap((w) => w.children.filter((c) => c.classList.contains('weapon-slot')))
  assert.equal(slots[0].classList.contains('active'), true) // axe now current
  assert.equal(slots[1].classList.contains('active'), false)
  assert.equal(slots[1].classList.contains('reloading'), true)
  assert.equal(slots[1].classList.contains('empty'), true)
  assert.equal(slots[0].classList.contains('empty'), false) // axe is infinite
  bank.current = bank.pistol
  hud.update(fakePlayer, bank, null)
  slots = hudRoot.children.filter((c) => c.classList.contains('hud-weapons')).flatMap((w) => w.children.filter((c) => c.classList.contains('weapon-slot')))
  assert.equal(slots[2].classList.contains('active'), true) // pistol now current
  assert.equal(slots[0].classList.contains('active'), false)
  assert.equal(slots[3].classList.contains('active'), false) // sword stays passive
  hud.dispose()
}

// --- legacy single-weapon path still works (non-bank weapon) ---
{
  const { hud, hudRoot } = makeHUD()
  const weapon = { name: 'rifle', ammo: 3, reserve: 10, isReloading: false }
  hud.update(fakePlayer, weapon, null)
  const legacy = find(hudRoot, 'hud-ammo')
  assert.equal(legacy.classList.contains('hidden'), false)
  assert.equal(legacy.children[0].textContent, '3 / 10')
  assert.equal(legacy.classList.contains('reloading'), false)
  const weaponsRoot = hudRoot.children.find((c) => c.classList.contains('hud-weapons'))
  assert.equal(weaponsRoot.children.filter((c) => c.classList.contains('weapon-slot')).every((s) => s.classList.contains('hidden')), true)
  weapon.isReloading = true
  hud.update(fakePlayer, weapon, null)
  assert.equal(legacy.classList.contains('reloading'), true)
  hud.dispose()
}

// --- battery bar tracks flashlight; low flag under 25%; hidden when unwired ---
{
  const { hud, hudRoot } = makeHUD()
  hud.flashlight = { battery: 0.5, enabled: true }
  hud.update(fakePlayer, fakeBank('shotgun'), null)
  const box = hudRoot.children.find((c) => c.classList.contains('hud-battery'))
  assert.equal(box.classList.contains('hidden'), false)
  assert.equal(box.classList.contains('low'), false)
  const fill = find(box, 'bar-fill')
  assert.equal(fill.style.width, '50%')
  hud.flashlight.battery = 0.2
  hud.update(fakePlayer, fakeBank('shotgun'), null)
  assert.equal(box.classList.contains('low'), true)
  assert.equal(fill.style.width, '20%')
  hud.flashlight = null
  hud.update(fakePlayer, fakeBank('shotgun'), null)
  assert.equal(box.classList.contains('hidden'), true)
  hud.dispose()
}

// --- score box tracks score tracker; hidden when unwired ---
{
  const { hud, hudRoot } = makeHUD()
  hud.update(fakePlayer, fakeBank('shotgun'), null)
  assert.equal(hudRoot.children.find((c) => c.classList.contains('hud-score')).classList.contains('hidden'), true)
  hud.score = { value: 125 }
  hud.update(fakePlayer, fakeBank('shotgun'), null)
  const box = hudRoot.children.find((c) => c.classList.contains('hud-score'))
  assert.equal(box.classList.contains('hidden'), false)
  assert.equal(box.children[1].textContent, '125')
  hud.score.value = 175
  hud.update(fakePlayer, fakeBank('shotgun'), null)
  assert.equal(box.children[1].textContent, '175')
  hud.dispose()
}

// --- music-mute button: click toggles label + fires the callback; setMusicMuted
//     reflects external state (N-key) without re-firing the callback ---
{
  const { hud, hudRoot } = makeHUD()
  const btn = hudRoot.children.find((c) => c.classList.contains('hud-music-btn'))
  assert.ok(btn, 'music button mounted')
  assert.equal(btn.textContent, '♪ Music: On', 'starts un-muted')
  let fired = null
  hud.onToggleMusic = (muted) => { fired = muted }
  btn._fire('click')
  assert.equal(btn.textContent, '♪ Music: Off', 'click mutes + relabels')
  assert.equal(btn.classList.contains('muted'), true, 'muted class applied')
  assert.equal(fired, true, 'callback fired with muted=true')
  btn._fire('click')
  assert.equal(btn.textContent, '♪ Music: On', 'second click unmutes')
  assert.equal(fired, false, 'callback fired with muted=false')
  // setMusicMuted reflects external state (N-key) and does NOT re-fire.
  fired = 'untouched'
  hud.setMusicMuted(true)
  assert.equal(btn.textContent, '♪ Music: Off', 'setMusicMuted relabels')
  assert.equal(fired, 'untouched', 'setMusicMuted does not fire the callback')
  hud.dispose()
}

console.log('hud OK')
