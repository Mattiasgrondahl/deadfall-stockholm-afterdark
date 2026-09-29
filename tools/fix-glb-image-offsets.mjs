// tools/fix-glb-image-offsets.mjs — repair the 8-byte image bufferView misalignment
// produced by the Blender glTF export in finish-bake-rig.py.
//
// Every image bufferView in walker-final.glb (and walker.glb / walker-rigged.glb)
// starts 8 bytes BEFORE the actual image data: the first 8 bytes are junk and the
// real PNG/WEBP signature begins at +8. GLTFLoader therefore hands the decoder a
// corrupt image (missing the 8-byte signature) -> SwiftShader's GL process crashes
// the first time a skinned mesh renders. Fix: shift each image bufferView's
// byteOffset +8 and byteLength -8 so it points exactly at the image bytes.
//
// Usage: node tools/fix-glb-image-offsets.mjs <in.glb> <out.glb>
import fs from 'node:fs'

const [inPath, outPath] = process.argv.slice(2)
if (!inPath || !outPath) { console.error('usage: fix-glb-image-offsets.mjs <in.glb> <out.glb>'); process.exit(2) }

const buf = fs.readFileSync(inPath)
if (buf.slice(0, 4).toString('ascii') !== 'glTF') { console.error('not a GLB'); process.exit(2) }
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'))

const PNG = '89504e470d0a1a0a', WEBP = '52494646', JPEG = 'ffd8ffe0', JPEG2 = 'ffd8ffe1'
let fixed = 0
for (const img of json.images || []) {
  const bv = json.bufferViews[img.bufferView]
  const start = 20 + jsonLen + bv.byteOffset
  const sig0 = buf.slice(start, start + 8).toString('hex')
  const sig8 = buf.slice(start + 8, start + 16).toString('hex')
  const isImg = (s) => s.startsWith(PNG) || s.startsWith(WEBP) || s.startsWith(JPEG) || s.startsWith(JPEG2)
  if (!isImg(sig0) && isImg(sig8)) {
    bv.byteOffset += 8
    bv.byteLength -= 8
    fixed++
    console.log(`fixed ${img.name || 'image'}: offset +8, len -8 (sig@8=${sig8.slice(0,8)})`)
  } else if (isImg(sig0)) {
    console.log(`ok ${img.name || 'image'}: already aligned (sig@0=${sig0.slice(0,8)})`)
  } else {
    console.log(`WARN ${img.name || 'image'}: no signature at +0 or +8 (sig@0=${sig0} sig@8=${sig8})`)
  }
}
if (!fixed) console.log('no image bufferViews needed fixing')

// The BIN chunk header sits right after the ORIGINAL (padded) JSON chunk.
const binHeaderStart = 20 + jsonLen
const binLen = buf.readUInt32LE(binHeaderStart)
const binStart = binHeaderStart + 8
// Re-serialize and pad to the SAME length as the original JSON chunk so the BIN
// chunk stays byte-for-byte at its original offset (no re-padding shift).
const jsonStr = JSON.stringify(json)
const jsonBuf = Buffer.from(jsonStr, 'utf8')
if (jsonBuf.length > jsonLen) { console.error('re-serialized JSON grew past original chunk; cannot keep BIN in place'); process.exit(3) }
const jsonPadded = Buffer.alloc(jsonLen, 0x20) // space-padded to original length
jsonBuf.copy(jsonPadded)
const total = buf.length
const out = Buffer.from(buf) // start from original, overwrite JSON chunk in place
out.writeUInt32LE(jsonLen, 12); out.write('JSON', 16, 'ascii')
jsonPadded.copy(out, 20)
// BIN chunk header + data are unchanged (same offsets), so nothing else to write.
fs.writeFileSync(outPath, out)
console.log(`wrote ${outPath}: ${fixed} image(s) fixed, ${out.length} bytes`)
