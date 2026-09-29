import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { Flashlight } from '../src/game/Flashlight.js'

const DT = 1 / 60
function fakeAudio() {
  const calls = { click: 0 }
  return { flashlightClick: () => calls.click++, calls }
}
function makeFL(audio = fakeAudio()) {
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 400)
  const fl = new Flashlight(camera, audio)
  return { camera, fl, input: { flashlight: false }, audio }
}

test('starts off with a full battery; spot + target are camera children', () => {
  const { camera, fl } = makeFL()
  assert.equal(fl.on, false)
  assert.equal(fl.battery, 1)
  assert.equal(fl.spot.intensity, 0)
  assert.ok(camera.children.includes(fl.spot))
  assert.ok(camera.children.includes(fl.spot.target))
  fl.dispose()
  assert.ok(!camera.children.includes(fl.spot))
  assert.ok(!camera.children.includes(fl.spot.target))
})

test('F edge toggles on then off; edge consumed; click sounds play', () => {
  const { fl, input, audio } = makeFL()
  assert.equal(audio.calls.click, 0)
  input.flashlight = true
  fl.update(DT, input)
  assert.equal(input.flashlight, false) // edge consumed
  assert.equal(fl.on, true)
  assert.equal(fl.spot.intensity, 55)
  assert.equal(audio.calls.click, 1)
  input.flashlight = true
  fl.update(DT, input)
  assert.equal(fl.on, false)
  assert.equal(fl.spot.intensity, 0)
  assert.equal(audio.calls.click, 2)
  fl.dispose()
})

test('battery drains only while on (~1/120 per second)', () => {
  const { fl, input } = makeFL()
  input.flashlight = true
  fl.update(DT, input) // on (that frame also drains one dt)
  fl.update(60, input) // 60 s of use
  const expect = 1 - (60 + DT) / 120
  assert.ok(Math.abs(fl.battery - expect) < 1e-9, `battery ${fl.battery}`)
  input.flashlight = true // off
  fl.update(DT, input)
  const held = fl.battery
  fl.update(100, input) // 100 s off: no drain
  assert.equal(fl.battery, held)
  fl.dispose()
})

test('auto-off at zero battery', () => {
  const { fl, input } = makeFL()
  input.flashlight = true
  fl.update(DT, input)
  fl.battery = 0.05 // 6 s remaining
  let autoOffFrame = -1
  for (let i = 0; i < 600; i++) {
    fl.update(DT, input)
    if (!fl.on && autoOffFrame < 0) autoOffFrame = i
  }
  assert.ok(autoOffFrame >= 300 && autoOffFrame <= 420, `auto-off at frame ${autoOffFrame}`)
  assert.equal(fl.battery, 0)
  assert.equal(fl.spot.intensity, 0)
  fl.dispose()
})

test('flicker engages below 25% battery; schedule is deterministic', () => {
  const a = makeFL(), b = makeFL()
  a.fl.on = true; a.fl.battery = 0.2
  b.fl.on = true; b.fl.battery = 0.2
  const seqA = [], seqB = []
  for (let i = 0; i < 600; i++) {
    a.fl.update(DT, null)
    b.fl.update(DT, null)
    seqA.push(a.fl.spot.intensity)
    seqB.push(b.fl.spot.intensity)
  }
  assert.deepEqual(seqA, seqB) // identical LCG schedule
  const dims = seqA.filter(v => v < 55).length
  assert.ok(dims > 0, `no dim frames observed`)
  assert.ok(dims < 600, `flicker never recovers`)
  a.fl.dispose(); b.fl.dispose()
})

test('recharge restores battery and relights a dead light', () => {
  const { fl, input } = makeFL()
  fl.battery = 0.5
  fl.recharge(0.35)
  assert.equal(fl.battery, 0.85)
  fl.recharge(0.5) // clamps to full
  assert.equal(fl.battery, 1)
  fl.recharge(0)   // no-op on zero
  assert.equal(fl.battery, 1)
  fl.battery = 0
  fl.on = true
  fl.update(DT, input) // auto-off at empty
  assert.equal(fl.on, false)
  fl.recharge(0.2)
  input.flashlight = true
  fl.update(DT, input)
  assert.equal(fl.on, true) // a recharged battery relights
  fl.dispose()
})

test('dead battery cannot be relit; reset restores full state', () => {
  const { fl, input } = makeFL()
  fl.battery = 0
  fl.on = true
  fl.update(DT, input) // auto-off
  assert.equal(fl.on, false)
  input.flashlight = true
  fl.update(DT, input)
  assert.equal(fl.on, false) // no re-light with an empty battery
  fl.reset()
  assert.equal(fl.on, false)
  assert.equal(fl.battery, 1)
  assert.equal(fl.spot.intensity, 0)
  input.flashlight = true
  fl.update(DT, input)
  assert.equal(fl.on, true) // a fresh battery lights again
  fl.dispose()
})
