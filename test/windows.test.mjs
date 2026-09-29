// Focused tests for the shootable-window system (v26): pane placement over lit
// facade cells, break-on-hit dimming the glass, glass voice + shard burst, and
// the shootable AABB blocking bullets but not player movement. Headless-safe.
import assert from 'node:assert'
import * as THREE from 'three'
import { addWindows, Windows } from '../src/world/Windows.js'

function mkCol() {
  return {
    aabbs: [],
    addAABB(minX, minZ, maxX, maxZ, h) { this.aabbs.push({ minX, minZ, maxX, maxZ, height: h }) }
  }
}

// ---- addWindows: places panes on lit cells, registers shootable AABBs ------
{
  const col = mkCol()
  const group = new THREE.Group()
  const buildings = [
    { mesh: { position: { x: 0, z: 0 } }, w: 8, d: 8, h: 20, variant: 0 },
    { mesh: { position: { x: 24, z: 0 } }, w: 6, d: 6, h: 12, variant: 3 }
  ]
  const data = addWindows(group, col, buildings)
  assert.ok(data.windows.length > 0, 'lit windows produce panes')
  assert.equal(data.mesh.count, data.windows.length, 'instanced count matches pane count')
  assert.equal(col.aabbs.length, data.windows.length, 'one AABB per pane')
  assert.ok(data.aabbs.every(a => a.shootable === true), 'every window AABB is shootable')
  // Panes sit within the building footprint band and above the ground floor.
  for (const w of data.windows) {
    assert.ok(w.y >= 2, `pane above ground floor (y=${w.y})`)
    assert.ok(w.y <= 20, `pane within wall height (y=${w.y})`)
  }
  // A short building (<4 m) carries no window grid.
  const short = addWindows(new THREE.Group(), mkCol(), [{ mesh: { position: { x: 0, z: 0 } }, w: 4, d: 4, h: 3, variant: 0 }])
  assert.equal(short.windows.length, 0, 'a too-short building gets no panes')
}

// ---- Windows.hitAt: breaks + dims + fires glass voice + shards -------------
{
  const col = mkCol()
  const data = addWindows(new THREE.Group(), col, [{ mesh: { position: { x: 0, z: 0 } }, w: 8, d: 8, h: 20, variant: 0 }])
  const w = new Windows(data)
  let glass = 0, shards = 0
  w.audio = { glassBreak: () => { glass++ } }
  w.shards = { burst: (x, y, z) => { shards++ } }
  const win = data.windows[0]
  const hit = w.hitAt(win.x, win.y, win.z)
  assert.strictEqual(hit, win, 'hitAt returns the broken window')
  assert.strictEqual(win.broken, true, 'window marked broken')
  assert.strictEqual(w.brokenCount(), 1, 'brokenCount tracks the break')
  assert.strictEqual(glass, 1, 'glassBreak voice fired once')
  assert.strictEqual(shards, 1, 'shard burst fired once')
  // Re-hitting a broken window does nothing (glass already gone).
  assert.strictEqual(w.hitAt(win.x, win.y, win.z), null, 'broken window not re-broken')
  // A hit far from any window misses.
  assert.strictEqual(w.hitAt(999, 5, 999), null, 'no window at that point')
  // A shot well above or below the pane row is a wall, not glass.
  const w2 = new Windows(addWindows(new THREE.Group(), mkCol(), [{ mesh: { position: { x: 0, z: 0 } }, w: 8, d: 8, h: 20, variant: 0 }]))
  const win2 = w2.windows[0]
  assert.strictEqual(w2.hitAt(win2.x, 25, win2.z), null, 'a shot above the whole wall misses every pane')
  // reset restores every broken pane.
  w.reset()
  assert.strictEqual(w.brokenCount(), 0, 'reset clears the broken count')
  assert.strictEqual(win.broken, false, 'reset un-breaks the window')
  w.dispose(); w2.dispose()
}

// ---- empty / no-data manager is safe ---------------------------------------
{
  const w = new Windows(null)
  assert.strictEqual(w.hitAt(0, 5, 0), null, 'no windows -> no hit')
  assert.strictEqual(w.brokenCount(), 0)
  w.dispose()
}

console.log('windows OK')