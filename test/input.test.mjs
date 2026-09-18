// Focused tests for the browser Input adapter, driven by a minimal fake DOM.
import assert from 'node:assert'
import { Input } from '../src/game/Input.js'

const freshState = () => ({
  forward: false, back: false, left: false, right: false, sprint: false,
  turnX: 0, turnY: 0, fire: false, reload: false, pause: false,
  switch1: false, switch2: false, switch3: false, switch4: false, flashlight: false
})

function makeEnv() {
  function target(store) {
    return {
      addEventListener(e, fn) { (store[e] = store[e] || []).push(fn) },
      removeEventListener(e, fn) {
        const l = store[e] || []
        const i = l.indexOf(fn)
        if (i >= 0) l.splice(i, 1)
      },
      emit(e, evt = {}) { for (const fn of [...(store[e] || [])]) fn(evt) }
    }
  }
  const document = target({})
  const win = target({})
  document.pointerLockElement = null
  document.exitPointerLock = () => {
    document.pointerLockElement = null
    document.emit('pointerlockchange')
  }
  const canvas = {
    requestPointerLock() {
      document.pointerLockElement = canvas
      document.emit('pointerlockchange')
    }
  }
  return { document, window: win, canvas }
}

function makeInput(env) {
  const st = freshState()
  const game = { env: { document: env.document, window: env.window, canvasFactory: () => env.canvas }, canvas: env.canvas }
  const input = new Input(game, st)
  input.attach()
  return { input, st }
}

const key = (env, code, type, repeat = false) => env.window.emit(type, { code, repeat })
const mouse = (env, type, evt = {}) => env.document.emit(type, evt)

// --- movement keys (incl. both shift keys) ---
{
  const env = makeEnv(); const { input, st } = makeInput(env)
  key(env, 'KeyW', 'keydown')
  assert.strictEqual(st.forward, true); assert.strictEqual(input.isDown('w'), true)
  key(env, 'KeyW', 'keyup')
  assert.strictEqual(st.forward, false); assert.strictEqual(input.isDown('w'), false)
  key(env, 'KeyA', 'keydown'); assert.strictEqual(st.left, true)
  key(env, 'KeyS', 'keydown'); assert.strictEqual(st.back, true)
  key(env, 'KeyD', 'keydown'); assert.strictEqual(st.right, true)
  key(env, 'ShiftRight', 'keydown')
  assert.strictEqual(st.sprint, true); assert.strictEqual(input.isDown('shift'), true)
  key(env, 'ShiftLeft', 'keydown'); assert.strictEqual(st.sprint, true)
  key(env, 'ShiftRight', 'keyup'); assert.strictEqual(st.sprint, true) // ShiftLeft still held
  key(env, 'ShiftLeft', 'keyup'); assert.strictEqual(st.sprint, false)
  input.dispose()
}

// --- pointer lock + look accumulation ---
{
  const env = makeEnv(); const { input, st } = makeInput(env)
  let locks = 0, unlocks = 0
  input.on('lock', () => locks++)
  input.on('unlock', () => unlocks++)
  assert.strictEqual(input.locked(), false)
  env.canvas.requestPointerLock()
  assert.strictEqual(input.locked(), true); assert.strictEqual(locks, 1)
  mouse(env, 'mousemove', { movementX: 30, movementY: -20, clientX: 30, clientY: -20 })
  mouse(env, 'mousemove', { movementX: 10, movementY: 10, clientX: 40, clientY: -10 })
  assert.strictEqual(st.turnX, 40); assert.strictEqual(st.turnY, -10)
  env.document.exitPointerLock()
  assert.strictEqual(input.locked(), false); assert.strictEqual(unlocks, 1)
  mouse(env, 'mousemove', { movementX: 99, movementY: 99, clientX: 139, clientY: 89 })
  assert.strictEqual(st.turnX, 40); assert.strictEqual(st.turnY, -10) // ignored while unlocked
  env.canvas.requestPointerLock()
  assert.strictEqual(locks, 2) // edge fires again on re-lock
  const look = input.consumeLook()
  assert.strictEqual(look.dx, 40); assert.strictEqual(look.dy, -10)
  assert.strictEqual(st.turnX, 0); assert.strictEqual(st.turnY, 0)
  input.dispose()
}

// --- edge flags: fire / reload / pause, repeat suppression, stale-edge clearing
{
  const env = makeEnv(); const { input, st } = makeInput(env)
  env.canvas.requestPointerLock()
  mouse(env, 'mousedown', { button: 0 })
  assert.strictEqual(st.fire, true)
  st.fire = false // consumer (Weapon) acted
  mouse(env, 'mousedown', { button: 0 })
  assert.strictEqual(st.fire, false) // repeat while held does not re-set
  mouse(env, 'mouseup', { button: 0 })
  assert.strictEqual(st.fire, false)
  mouse(env, 'mousedown', { button: 0 })
  assert.strictEqual(st.fire, true)
  mouse(env, 'mouseup', { button: 0 })
  assert.strictEqual(st.fire, false) // released before consumer -> no stale edge
  key(env, 'KeyR', 'keydown'); assert.strictEqual(st.reload, true)
  st.reload = false // consumer (Weapon) acted
  key(env, 'KeyR', 'keydown', true); assert.strictEqual(st.reload, false) // repeat suppressed
  key(env, 'KeyR', 'keyup'); assert.strictEqual(st.reload, false)
  key(env, 'KeyP', 'keydown'); assert.strictEqual(st.pause, true)
  st.pause = false // consumer (Game.step) acted
  key(env, 'KeyP', 'keydown', true); assert.strictEqual(st.pause, false) // repeat suppressed
  key(env, 'KeyP', 'keyup'); assert.strictEqual(st.pause, false)
  key(env, 'Escape', 'keydown'); assert.strictEqual(st.pause, true)
  key(env, 'Escape', 'keyup'); assert.strictEqual(st.pause, false)
  input.dispose()
}

// --- mute edge fires once per press; on/off
{
  const env = makeEnv(); const { input } = makeInput(env)
  let mutes = 0
  const cb = () => mutes++
  input.on('mute', cb)
  key(env, 'KeyM', 'keydown'); assert.strictEqual(mutes, 1)
  key(env, 'KeyM', 'keydown', true); assert.strictEqual(mutes, 1) // repeat ignored
  key(env, 'KeyM', 'keyup')
  key(env, 'KeyM', 'keydown'); assert.strictEqual(mutes, 2) // new press edge
  input.off('mute', cb)
  key(env, 'KeyM', 'keydown'); assert.strictEqual(mutes, 2) // unsubscribed
  input.dispose()
}

// --- v2 edges: flashlight toggle, weapon switch 1/2, repeat suppression, stale clear
{
  const env = makeEnv(); const { input, st } = makeInput(env)
  key(env, 'KeyF', 'keydown'); assert.strictEqual(st.flashlight, true)
  st.flashlight = false // consumer (Flashlight) acted
  key(env, 'KeyF', 'keydown', true); assert.strictEqual(st.flashlight, false) // repeat suppressed
  key(env, 'KeyF', 'keyup'); assert.strictEqual(st.flashlight, false)
  key(env, 'Digit1', 'keydown'); assert.strictEqual(st.switch1, true)
  st.switch1 = false // consumer (WeaponBank) acted
  key(env, 'Digit1', 'keydown', true); assert.strictEqual(st.switch1, false) // repeat suppressed
  key(env, 'Digit1', 'keyup'); assert.strictEqual(st.switch1, false)
  key(env, 'Digit1', 'keydown'); assert.strictEqual(st.switch1, true) // new press edge
  key(env, 'Digit1', 'keyup'); assert.strictEqual(st.switch1, false)
  key(env, 'Digit2', 'keydown'); assert.strictEqual(st.switch2, true)
  key(env, 'Digit2', 'keyup'); assert.strictEqual(st.switch2, false)
  key(env, 'Digit3', 'keydown'); assert.strictEqual(st.switch3, true)
  st.switch3 = false // consumer (WeaponBank) acted
  key(env, 'Digit3', 'keydown', true); assert.strictEqual(st.switch3, false) // repeat suppressed
  key(env, 'Digit3', 'keyup'); assert.strictEqual(st.switch3, false)
  key(env, 'Digit3', 'keydown'); assert.strictEqual(st.switch3, true) // new press edge
  key(env, 'Digit3', 'keyup'); assert.strictEqual(st.switch3, false)
  key(env, 'Digit4', 'keydown'); assert.strictEqual(st.switch4, true)
  key(env, 'Digit4', 'keyup'); assert.strictEqual(st.switch4, false)
  input.dispose()
  assert.strictEqual(st.switch1, false); assert.strictEqual(st.switch2, false)
  assert.strictEqual(st.switch3, false); assert.strictEqual(st.switch4, false)
  assert.strictEqual(st.flashlight, false)
}

// --- headless safety + dispose removes listeners
{
  const st = freshState()
  const game = { env: { document: null, window: null, canvasFactory: () => null }, canvas: null }
  const input = new Input(game, st)
  input.attach() // must be a no-op
  assert.strictEqual(input.locked(), false)
  input.requestLock() // must be a no-op
  const env = makeEnv(); const { input: i2, st: st2 } = makeInput(env)
  i2.dispose()
  key(env, 'KeyW', 'keydown'); assert.strictEqual(st2.forward, false)
  mouse(env, 'mousedown', { button: 0 }); assert.strictEqual(st2.fire, false)
}

console.log('input OK')
