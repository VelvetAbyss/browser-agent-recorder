// Generate the extension icon set (16/32/48/128 + 512 store master) with no
// image dependencies — renders a rounded emerald square with a white "record"
// dot at 4x supersampling and encodes PNG via Node's built-in zlib.
//
// Run: node scripts/generate-icons.mjs   (output: public/icons/icon-*.png)
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const SS = 4; // supersampling factor for anti-aliasing
const EMERALD = [4, 120, 87];
const WHITE = [255, 255, 255];

// --- CRC32 (PNG chunk checksum) ---
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// Rounded-rect signed test: distance pushed to 0 inside.
function inRoundedRect(px, py, x0, y0, x1, y1, r) {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const dx = Math.max(x0 + r - px, 0, px - (x1 - r));
  const dy = Math.max(y0 + r - py, 0, py - (y1 - r));
  return dx * dx + dy * dy <= r * r;
}

function renderIcon(size) {
  const hi = size * SS;
  const margin = hi * 0.04;
  const radius = hi * 0.22;
  const cx = hi / 2;
  const cy = hi / 2;
  const dotR = hi * 0.26;
  const out = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const hx = x * SS + sx + 0.5;
          const hy = y * SS + sy + 0.5;
          if (!inRoundedRect(hx, hy, margin, margin, hi - margin, hi - margin, radius)) continue;
          const inDot = (hx - cx) ** 2 + (hy - cy) ** 2 <= dotR * dotR;
          const [pr, pg, pb] = inDot ? WHITE : EMERALD;
          r += pr;
          g += pg;
          b += pb;
          a += 255;
        }
      }
      const samples = SS * SS;
      const idx = (y * size + x) * 4;
      // Average straight RGBA; covered samples carry their colour, uncovered
      // contribute transparency only.
      const covered = a / 255;
      out[idx] = covered ? Math.round(r / covered) : 0;
      out[idx + 1] = covered ? Math.round(g / covered) : 0;
      out[idx + 2] = covered ? Math.round(b / covered) : 0;
      out[idx + 3] = Math.round(a / samples);
    }
  }
  return encodePng(size, size, out);
}

await mkdir(outDir, { recursive: true });
for (const size of [16, 32, 48, 128, 512]) {
  await writeFile(join(outDir, `icon-${size}.png`), renderIcon(size));
  console.log(`wrote public/icons/icon-${size}.png`);
}
