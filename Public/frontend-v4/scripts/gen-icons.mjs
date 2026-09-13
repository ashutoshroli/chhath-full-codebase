// One-off icon generator: rasterizes static/logo.svg into the PWA PNG icons
// referenced by vite.config.ts's manifest. Run with `node scripts/gen-icons.mjs`.
// sharp is used ad-hoc (not a committed dependency); the generated PNGs are the
// committed artifacts.
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const svg = readFileSync(resolve(root, 'static/logo.svg'));
const outDir = resolve(root, 'static/icons');
mkdirSync(outDir, { recursive: true });

const BRAND = { r: 242, g: 122, b: 26 };

async function plain(size) {
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toFile(resolve(outDir, `icon-${size}.png`));
}

async function maskable(size) {
  // Maskable: logo at ~72% within a solid brand-tinted rounded field (safe zone).
  const inner = Math.round(size * 0.72);
  const logo = await sharp(svg, { density: 384 }).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: { ...BRAND, alpha: 1 } }
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(resolve(outDir, `icon-${size}-maskable.png`));
}

await plain(192);
await plain(512);
await plain(180); // apple-touch
await maskable(512);
console.log('icons generated in', outDir);
