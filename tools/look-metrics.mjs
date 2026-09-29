// look-metrics.mjs — quantitative visual metrics for game screenshots (no vision model needed).
// Usage: node tools/look-metrics.mjs [file.png ...]   (defaults to .research/look/*.png)
import sharp from 'sharp';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const WS = process.cwd();
const files = process.argv.slice(2);
let targets = files.length ? files : readdirSync(path.join(WS, '.research', 'look')).filter(f => f.endsWith('.png')).map(f => path.join(WS, '.research', 'look', f)).sort();

function stats(name, buf, w, h) {
  // buf: raw RGB, row-major, w*h*3
  let sumR = 0, sumG = 0, sumB = 0, sumY = 0, sumSat = 0;
  let y2 = 0;
  let bright = 0, dark = 0;
  let skyY = 0, skyN = 0;          // top 30%
  let groundY = 0, groundN = 0;    // bottom 70%
  let lap = 0, lapN = 0;           // Laplacian on Y (detail proxy)
  const Y = (i) => 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
  for (let y = 0; y < h; y++) {
    const sky = y < h * 0.3;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const r = buf[i], g = buf[i + 1], b = buf[i + 2];
      sumR += r; sumG += g; sumB += b;
      const Yv = Y(i);
      sumY += Yv; y2 += Yv * Yv;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sumSat += (mx - mn);
      if (Yv > 200) bright++;
      if (Yv < 16) dark++;
      if (sky) { skyY += Yv; skyN++; } else { groundY += Yv; groundN++; }
      // 4-neighbor Laplacian on Y (interior pixels only)
      if (x > 0 && x < w - 1 && y > 0 && y < h - 1) {
        const c = Y(i), l = Y(i - 3 * w), rt = Y(i + 3 * w), u = Y(i - 3), d = Y(i + 3);
        const v = 4 * c - l - rt - u - d;
        lap += v * v; lapN++;
      }
    }
  }
  const n = w * h;
  const meanY = sumY / n;
  const stdY = Math.sqrt(Math.max(0, y2 / n - meanY * meanY));
  return {
    file: name,
    px: `${w}x${h}`,
    meanY: round1(meanY),
    stdY: round1(stdY),
    colorTemp: round2((sumR - sumB) / n / 255),   // + warm / - cool
    sat: round1(sumSat / n),
    brightFrac: round3(bright / n),
    darkFrac: round3(dark / n),
    skyMeanY: round1(skyY / skyN),
    groundMeanY: round1(groundY / groundN),
    skyGroundDelta: round1(skyY / skyN - groundY / groundN),
    detail: round1(lap / lapN),
  };
}
const round1 = v => Math.round(v * 10) / 10;
const round2 = v => Math.round(v * 100) / 100;
const round3 = v => Math.round(v * 1000) / 1000;

const rows = [];
for (const f of targets) {
  const meta = await sharp(f).metadata();
  const data = await sharp(f).raw().toBuffer();
  rows.push(stats(path.basename(f), data, meta.width, meta.height));
}
const cols = ['file', 'px', 'meanY', 'stdY', 'colorTemp', 'sat', 'brightFrac', 'darkFrac', 'skyMeanY', 'groundMeanY', 'skyGroundDelta', 'detail'];
console.log(cols.join('\t'));
for (const r of rows) console.log(cols.map(c => r[c]).join('\t'));
