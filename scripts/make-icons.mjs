// Draws the Screen Drop mark and writes every icon size Tauri asks for.
// No image dependencies: PNG is deflate + a couple of chunks, and .ico happily
// wraps PNG payloads.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");
mkdirSync(OUT, { recursive: true });

const INK = [11, 13, 18, 255]; // near-black ground
const BLUE = [130, 150, 255, 255]; // the accent that runs through the whole app
const BONE = [234, 230, 220, 255];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // no per-row filter
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Signed distance to a rounded rectangle — gives us clean antialiased edges. */
function roundedRectSdf(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function blend(dst, i, color, alpha) {
  if (alpha <= 0) return;
  const a = Math.min(1, alpha);
  for (let c = 0; c < 3; c++) dst[i + c] = Math.round(dst[i + c] * (1 - a) + color[c] * a);
  dst[i + 3] = Math.max(dst[i + 3], Math.round(255 * a));
}

/**
 * The mark: three stacked screens receding into the distance, with the front one
 * lit. Reads as "many screens, one frame" at 256px and as a bright blue tile at 16.
 */
function draw(size) {
  const s = size / 512;
  const px = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const d = roundedRectSdf(x + 0.5, y + 0.5, size / 2, size / 2, size / 2, size / 2, 96 * s);
      const cover = Math.min(1, Math.max(0, 0.5 - d));
      px[i] = INK[0];
      px[i + 1] = INK[1];
      px[i + 2] = INK[2];
      px[i + 3] = Math.round(255 * cover);
    }
  }

  // Back two screens: same shape, offset up-left, dimmed.
  const plates = [
    { dx: -54, dy: -54, w: 150, h: 96, color: BONE, alpha: 0.16 },
    { dx: -27, dy: -27, w: 150, h: 96, color: BONE, alpha: 0.34 },
  ];
  for (const plate of plates) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (px[i + 3] === 0) continue;
        const d = roundedRectSdf(
          x + 0.5,
          y + 0.5,
          size / 2 + plate.dx * s,
          size / 2 + plate.dy * s,
          plate.w * s,
          plate.h * s,
          14 * s,
        );
        const edge = Math.min(1, Math.max(0, 0.5 - d));
        const ring = Math.min(1, Math.max(0, 1 - Math.abs(d) / (7 * s)));
        blend(px, i, plate.color, ring * plate.alpha * 2);
        blend(px, i, plate.color, edge * plate.alpha * 0.18);
      }
    }
  }

  // Front screen: solid blue, the one that is on air.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (px[i + 3] === 0) continue;
      const d = roundedRectSdf(x + 0.5, y + 0.5, size / 2 + 30 * s, size / 2 + 30 * s, 150 * s, 96 * s, 16 * s);
      blend(px, i, BLUE, Math.min(1, Math.max(0, 0.5 - d)));
    }
  }

  return png(size, px);
}

function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dir = [];
  for (const { size, data } of entries) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    dir.push(e);
  }
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]);
}

const sizes = [16, 32, 48, 64, 128, 256, 512];
const rendered = new Map(sizes.map((size) => [size, draw(size)]));

writeFileSync(join(OUT, "32x32.png"), rendered.get(32));
writeFileSync(join(OUT, "128x128.png"), rendered.get(128));
writeFileSync(join(OUT, "128x128@2x.png"), rendered.get(256));
writeFileSync(join(OUT, "icon.png"), rendered.get(512));
writeFileSync(
  join(OUT, "icon.ico"),
  ico([16, 32, 48, 64, 128, 256].map((size) => ({ size, data: rendered.get(size) }))),
);

console.log(`wrote ${sizes.length} renders into ${OUT}`);
