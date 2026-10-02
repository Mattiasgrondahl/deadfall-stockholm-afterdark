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
    // Minimal descendant query by class — enough for the crosshair bar lookup.
    querySelectorAll(sel) {
      const cls = String(sel).replace(/^\./, '').trim()
      const out = []
      const walk = (node) => {
        for (const c of node.children) {
          if (c.classList.contains(cls)) out.push(c)
          walk(c)
        }
      }
      walk(n)
      return out
    },
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
  const sniper = mk('sniper')
  return { axe, shotgun, pistol, sword, sniper, current: { axe, shotgun, pistol, sword, sniper }[currentName] || shotgun }
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
  assert.equal(slots.length, 5)
  assert.equal(slots[0].classList.contains('active'), false)
  assert.equal(slots[1].classList.contains('active'), true) // shotgun is current
  assert.equal(slots[2].classList.contains('active'), false)
  assert.equal(slots[3].classList.contains('active'), false)
  assert.equal(slots[4].classList.contains('active'), false)
  const names = slots.map((s) => find(s, 'weapon-name').textContent)
  const ammo = slots.map((s) => find(s, 'weapon-ammo').textContent)
  assert.deepEqual(names, ['axe', 'shotgun', 'pistol', 'sword', 'sniper'])
  assert.deepEqual(ammo, ['∞', '5 / 30', '5 / 30', '∞', '5 / 30'])
  assert.equal(find(hudRoot, 'hud-ammo').classList.contains('hidden'), true) // legacy hidden
  assert.equal(hudRoot.children.find((c) => c.classList.contains('hud-battery')).classList.contains('hidden'), true)
  assert.equal(hudRoot.children.find((c) => c.classList.contains('hud-score')).classList.contains('hidden'), true)
  // HP bar shows the percentage of max health (health 50 / max 100 -> "50%").
  const healthBox = hudRoot.children.find((c) => c.classList.contains('hud-health'))
  const healthBar = healthBox.children[1] // the .bar wrapper holding the fill
  assert.equal(healthBar.children[0].style.width, '50%', 'health fill width tracks pct')
  assert.equal(healthBox.children[2].textContent, '50%', 'HP bar displays the percentage')
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

// --- v7: kill + headshot counters track wired getters; hidden when unwired ---
{
  const { hud, hudRoot } = makeHUD()
  hud.update(fakePlayer, fakeBank('shotgun'), null)
  const stats = hudRoot.children.find((c) => c.classList.contains('hud-stats'))
  assert.equal(stats.classList.contains('hidden'), true, 'stats hidden until both getters wired')
  let kills = 47, heads = 12
  hud.kills = () => kills
  hud.headshots = () => heads
  hud.update(fakePlayer, fakeBank('shotgun'), null)
  assert.equal(stats.classList.contains('hidden'), false, 'stats shown once wired')
  assert.equal(stats.children[0].textContent, 'KILLS 47')
  assert.equal(stats.children[1].textContent, 'HEADSHOTS 12')
  kills = 50; heads = 13
  hud.update(fakePlayer, fakeBank('shotgun'), null)
  assert.equal(stats.children[0].textContent, 'KILLS 50', 'kill counter tracks the getter')
  assert.equal(stats.children[1].textContent, 'HEADSHOTS 13', 'headshot counter tracks the getter')
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

// --- v37 R4: crosshair spread follows the current weapon, hides when scoped ---
{
  const { hud, hudRoot } = makeHUD()
  const ch = find(hudRoot, 'crosshair')
  assert.ok(ch, 'crosshair mounted')
  const bars = ch.children.filter((c) => c.classList.contains('ch-bar'))
  assert.equal(bars.length, 4, 'four crosshair bars')
  // A wide-spread weapon (shotgun) opens the gap beyond the 10 px base.
  const wide = fakeBank('shotgun')
  wide.current.spread = 0.3
  hud.update(fakePlayer, wide, null)
  const top = bars.find((c) => c.classList.contains('top'))
  const gapOf = (t) => { const m = /translate\(-50%,\s*(-\d+)px\)/.exec(t); return m ? -parseInt(m[1], 10) : 0 }
  const wideGap = gapOf(top.style.transform)
  assert.ok(wideGap > 16, 'wide spread opens the gap past the base: ' + top.style.transform)
  // A tight-spread weapon pulls the bars back in.
  const tight = fakeBank('pistol')
  tight.current.spread = 0.02
  hud.update(fakePlayer, tight, null)
  const tightGap = gapOf(top.style.transform)
  assert.ok(tightGap < wideGap, 'low spread pulls the bars in: ' + top.style.transform)
  // Scoped sniper hides the whole crosshair (the scope reticle replaces it).
  const scoped = fakeBank('sniper')
  scoped.current.spread = 0.01
  scoped.current.scoped = true
  hud.update(fakePlayer, scoped, null)
  assert.equal(ch.classList.contains('hidden'), true, 'crosshair hidden while scoped')
  hud.dispose()
}

// --- v37 R4: stamina bar gains the .low pulse class below 25% ---
{
  const { hud, hudRoot } = makeHUD()
  const box = find(hudRoot, 'hud-stamina')
  assert.ok(box, 'stamina box mounted')
  hud.update({ health: 100, maxHealth: 100, stamina: 10 }, fakeBank('shotgun'), null)
  assert.equal(box.classList.contains('low'), true, 'low stamina marks the box')
  hud.update({ health: 100, maxHealth: 100, stamina: 90 }, fakeBank('shotgun'), null)
  assert.equal(box.classList.contains('low'), false, 'healthy stamina clears the class')
  hud.dispose()
}

console.log('hud OK')
