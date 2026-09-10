/**
 * Generates the toolbar icons as PNGs, so the repo carries no binary assets we
 * can't reproduce. Run with `npm run icons`.
 *
 * A rounded square in the accent colour with a white check mark, rasterized
 * with 3x supersampling so the 16px icon doesn't turn to mush.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'icons');
const SIZES = [16, 32, 48, 128];
const ACCENT = [79, 70, 229];
const GLYPH = [255, 255, 255];
const SAMPLES = 3;

// Check mark as a polyline in unit coordinates.
const STROKE = [
  [0.26, 0.53],
  [0.43, 0.7],
  [0.75, 0.32],
];

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const size of SIZES) {
    writeFileSync(join(OUT_DIR, `icon-${size}.png`), encodePng(size, size, renderIcon(size)));
    console.log(`wrote icon-${size}.png`);
  }
}

/**
 * @param {number} size
 * @returns {Uint8Array} RGBA pixels, row-major.
 */
function renderIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const radius = size * 0.24;
  const strokeWidth = size * 0.115;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let bg = 0;
      let glyph = 0;

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = x + (sx + 0.5) / SAMPLES;
          const py = y + (sy + 0.5) / SAMPLES;
          if (insideRoundedRect(px, py, size, radius)) bg += 1;
          if (distanceToStroke(px / size, py / size) * size <= strokeWidth / 2) glyph += 1;
        }
      }

      const total = SAMPLES * SAMPLES;
      const bgAlpha = bg / total;
      // The glyph only exists where the tile does, so clip it to the tile.
      const glyphAlpha = Math.min(glyph / total, bgAlpha);

      const offset = (y * size + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        pixels[offset + c] = Math.round(ACCENT[c] * (1 - glyphAlpha / Math.max(bgAlpha, 1e-6)) + GLYPH[c] * (glyphAlpha / Math.max(bgAlpha, 1e-6)));
      }
      pixels[offset + 3] = Math.round(bgAlpha * 255);
    }
  }

  return pixels;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {number} radius
 * @returns {boolean}
 */
function insideRoundedRect(x, y, size, radius) {
  const dx = Math.max(radius - x, 0, x - (size - radius));
  const dy = Math.max(radius - y, 0, y - (size - radius));
  return Math.hypot(dx, dy) <= radius;
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {number} Distance in unit space to the check-mark polyline.
 */
function distanceToStroke(x, y) {
  let best = Infinity;
  for (let i = 0; i < STROKE.length - 1; i += 1) {
    best = Math.min(best, distanceToSegment(x, y, STROKE[i], STROKE[i + 1]));
  }
  return best;
}

/**
 * @param {number} px
 * @param {number} py
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function distanceToSegment(px, py, a, b) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = px - a[0];
  const wy = py - a[1];
  const lengthSq = vx * vx + vy * vy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / lengthSq));
  return Math.hypot(px - (a[0] + t * vx), py - (a[1] + t * vy));
}

/* PNG encoding ------------------------------------------------------------ */

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba
 * @returns {Buffer}
 */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter type 0 (None)
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, rowStart + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * @param {string} type
 * @param {Buffer} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * @param {Buffer} buffer
 * @returns {number}
 */
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Runs last so the CRC table above is initialised before the first chunk.
main();
