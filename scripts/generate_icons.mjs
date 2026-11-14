import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT_DIR = process.cwd();
const BUILD_DIR = path.join(ROOT_DIR, 'build');
fs.mkdirSync(BUILD_DIR, { recursive: true });

// Precompute CRC32 table for PNG chunks
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePngRgba(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type 0
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function renderWindTerminalIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);

  const bgR = 9, bgG = 12, bgB = 16;
  const borderR = 34, borderG = 40, borderB = 50;
  const orangeR = 255, orangeG = 136, orangeB = 0;

  const topBarH = Math.max(2, Math.round(size * 0.095));
  const strokeHalf = Math.max(1.2, size * 0.056);

  // W polyline control points normalized to size
  const pts = [
    [size * 0.175, size * 0.285],
    [size * 0.345, size * 0.775],
    [size * 0.500, size * 0.455],
    [size * 0.655, size * 0.775],
    [size * 0.825, size * 0.285],
  ];

  // Subtle corner grid crosshair thickness
  const borderPx = Math.max(1, Math.round(size / 64));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = bgR;
      let g = bgG;
      let b = bgB;

      // Top Wind accent bar
      if (y < topBarH) {
        r = orangeR;
        g = orangeG;
        b = orangeB;
      } else if (
        x < borderPx ||
        x >= size - borderPx ||
        y >= size - borderPx
      ) {
        // Sharp 1px-scaled Wind frame border (0 rounded corners)
        r = borderR;
        g = borderG;
        b = borderB;
      }

      // Compute minimum distance from pixel center to the W segments
      const cx = x + 0.5;
      const cy = y + 0.5;
      let minDist = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const d = distToSegment(
          cx,
          cy,
          pts[i][0],
          pts[i][1],
          pts[i + 1][0],
          pts[i + 1][1]
        );
        if (d < minDist) minDist = d;
      }

      // Crisp square cap cut at top and bottom of W glyph
      if (cy >= size * 0.23 && cy <= size * 0.83) {
        const alpha = Math.max(0, Math.min(1, strokeHalf + 0.6 - minDist));
        if (alpha > 0) {
          r = Math.round(r * (1 - alpha) + orangeR * alpha);
          g = Math.round(g * (1 - alpha) + orangeG * alpha);
          b = Math.round(b * (1 - alpha) + orangeB * alpha);
        }
      }

      const idx = (y * size + x) * 4;
      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = 255;
    }
  }

  return encodePngRgba(size, size, rgba);
}

function encodeIcoFromPngs(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Icon type
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;

  entries.forEach((entry, idx) => {
    const base = idx * 16;
    const dimByte = entry.size >= 256 ? 0 : entry.size;
    dir[base] = dimByte; // Width (0 = 256)
    dir[base + 1] = dimByte; // Height (0 = 256)
    dir[base + 2] = 0; // Color count
    dir[base + 3] = 0; // Reserved
    dir.writeUInt16LE(1, base + 4); // Planes
    dir.writeUInt16LE(32, base + 6); // Bits per pixel
    dir.writeUInt32LE(entry.png.length, base + 8);
    dir.writeUInt32LE(offset, base + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

const png512 = renderWindTerminalIcon(512);
const png256 = renderWindTerminalIcon(256);
const png128 = renderWindTerminalIcon(128);
const png48 = renderWindTerminalIcon(48);
const png32 = renderWindTerminalIcon(32);
const png16 = renderWindTerminalIcon(16);

const icoBuffer = encodeIcoFromPngs([
  { size: 16, png: png16 },
  { size: 32, png: png32 },
  { size: 48, png: png48 },
  { size: 128, png: png128 },
  { size: 256, png: png256 },
]);

fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), png512);
fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), icoBuffer);
fs.writeFileSync(path.join(BUILD_DIR, 'tray.png'), png32);

console.log(
  `[ICONS] Generated build/icon.png (${png512.length}B), build/icon.ico (${icoBuffer.length}B), build/tray.png (${png32.length}B)`
);
