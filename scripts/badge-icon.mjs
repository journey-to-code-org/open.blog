#!/usr/bin/env node
// Draw web/studio/icons/badge-96.png: the small monochrome picture Android shows in the status bar
// for a notification from the owner's blog (Studio R3, G27). A bell, white on transparent, 96 px,
// drawn from simple shapes with 4x4 anti-aliasing, so it is ours and can be drawn again any time:
//
//   node scripts/badge-icon.mjs
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const SIZE = 96;
const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(here, "web/studio/icons/badge-96.png");

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const inRoundRect = (x, y, left, top, right, bottom, r) => {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + r), right - r);
  const cy = Math.min(Math.max(y, top + r), bottom - r);
  return inCircle(x, y, cx, cy, r);
};

/** Whether a point is inside the bell: knob, dome, flared body, rim and clapper. */
function bell(x, y) {
  if (inCircle(x, y, 48, 15, 6)) return true;
  if (y <= 42 && inCircle(x, y, 48, 42, 23)) return true;
  if (y >= 42 && y <= 70) {
    const half = 23 + ((y - 42) / 28) * 10;
    if (Math.abs(x - 48) <= half) return true;
  }
  if (inRoundRect(x, y, 10, 66, 86, 75, 4)) return true;
  return inCircle(x, y, 48, 84, 7);
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  const row = y * (SIZE * 4 + 1);
  raw[row] = 0; // no filter
  for (let x = 0; x < SIZE; x++) {
    let hits = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (bell(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hits++;
    const at = row + 1 + x * 4;
    raw[at] = raw[at + 1] = raw[at + 2] = 255;
    raw[at + 3] = Math.round((hits / 16) * 255);
  }
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
};
const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
