// One-off shortcut-icon generator: produces an OPAQUE 192x192 PNG for the PWA
// app-shortcut menu (Expenses/Loans/Committee/Downloads/Donate). Run with
// `node scripts/gen-shortcut-icon.mjs`. The generated PNG is the committed artifact.
//
// Why a separate asset (see the comment above `shortcuts` in vite.config.ts):
// the app `icons` are transparent RGBA (color type 6) so the launcher can
// composite them on its own tile. Android's long-press SHORTCUT sheet does NOT
// composite — it draws the icon as-is, so a transparent icon shows a blank white
// square. This asset is therefore fully OPAQUE: the diya artwork from
// static/icons/icon-192.png composited over the solid brand background (#F27A1A),
// re-encoded as a color-type-2 (RGB, no alpha channel) PNG.
//
// Dependency-free on purpose (no `sharp`): it decodes the existing icon-192.png
// with node:zlib and composites in-process so the build needs no extra install.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const iconsDir = resolve(root, 'static/icons');

// Solid brand background the diya sits on (manifest theme_color).
const BRAND = { r: 0xf2, g: 0x7a, b: 0x1a };

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readChunks(buf) {
  let off = 8;
  const chunks = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    chunks.push({ type, data });
    off += 12 + len;
  }
  return chunks;
}

// Decode a non-interlaced 8-bit RGBA (color type 6) PNG into raw RGBA pixels.
function decodeRGBA(buf) {
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`unexpected PNG format: bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  }
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = inflateSync(idat);
  const bpp = 4; // RGBA
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const rowStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[pos++];
      const a = x >= bpp ? out[rowStart + x - bpp] : 0;
      const b = y > 0 ? out[rowStart - stride + x] : 0;
      const c = y > 0 && x >= bpp ? out[rowStart - stride + x - bpp] : 0;
      let val;
      switch (filter) {
        case 0: val = rawByte; break;
        case 1: val = rawByte + a; break;
        case 2: val = rawByte + b; break;
        case 3: val = rawByte + ((a + b) >> 1); break;
        case 4: val = rawByte + paeth(a, b, c); break;
        default: throw new Error('bad filter ' + filter);
      }
      out[rowStart + x] = val & 0xff;
    }
  }
  return { width, height, rgba: out };
}

// Composite RGBA over the solid brand background -> opaque RGB pixels.
function flattenToRGB({ width, height, rgba }) {
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) {
    const alpha = rgba[i + 3] / 255;
    rgb[o] = Math.round(rgba[i] * alpha + BRAND.r * (1 - alpha));
    rgb[o + 1] = Math.round(rgba[i + 1] * alpha + BRAND.g * (1 - alpha));
    rgb[o + 2] = Math.round(rgba[i + 2] * alpha + BRAND.b * (1 - alpha));
  }
  return rgb;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// Encode opaque RGB (color type 2) PNG with per-row filter 0 (none).
function encodeRGB(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB (no alpha => opaque)
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const src = readFileSync(resolve(iconsDir, 'icon-192.png'));
const decoded = decodeRGBA(src);
const rgb = flattenToRGB(decoded);
const png = encodeRGB(decoded.width, decoded.height, rgb);
const outPath = resolve(iconsDir, 'icon-shortcut-192.png');
writeFileSync(outPath, png);
console.log('wrote', outPath, `${decoded.width}x${decoded.height} colorType=2 (opaque)`, png.length, 'bytes');
