// PWA app-shortcut icons must be OPAQUE.
//
// Bug: the five app-shortcuts (Expenses, Loans, Committee, Downloads, Donate) in
// vite.config.ts pointed at /icons/icon-192.png — a 192x192 RGBA PNG (color type
// 6) with a fully transparent background. The launcher composites the app icon on
// its own tile so it renders, but Android's long-press SHORTCUT sheet draws the
// icon as-is and a transparent icon shows a blank white square. The fix ships a
// dedicated OPAQUE asset (icon-shortcut-192.png, color type 2 RGB) and points every
// shortcut at it.
//
// This test is the guard: it fails if any shortcut is pointed back at the
// transparent icon-192.png, and if the shipped shortcut asset is not opaque.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const SHORTCUT_ICON = '/icons/icon-shortcut-192.png';
const TRANSPARENT_APP_ICON = '/icons/icon-192.png';

function pngHeader(buf: Buffer) {
  // IHDR fields at fixed offsets for a standard PNG.
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25], // 2 = RGB (no alpha => opaque), 6 = RGBA
    interlace: buf[28]
  };
}

describe('PWA app-shortcut icons', () => {
  it('ships an opaque shortcut icon asset (color type 2 RGB, no alpha channel)', () => {
    const buf = readFileSync(resolve(root, 'static', SHORTCUT_ICON.replace(/^\//, '')));
    const { width, height, bitDepth, colorType, interlace } = pngHeader(buf);
    expect(width).toBe(192);
    expect(height).toBe(192);
    expect(bitDepth).toBe(8);
    expect(interlace).toBe(0);
    // Color type 2 has no alpha channel at all, so the icon can never be
    // transparent — exactly what the Android shortcut sheet needs.
    expect(colorType).toBe(2);
  });

  it('the transparent app icon is RGBA (color type 6) — the reason it must NOT back a shortcut', () => {
    const buf = readFileSync(resolve(root, 'static', TRANSPARENT_APP_ICON.replace(/^\//, '')));
    expect(pngHeader(buf).colorType).toBe(6);
  });

  it('every shortcut in vite.config.ts points at the opaque asset, never the transparent app icon', () => {
    const config = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');

    // Isolate the shortcuts array so unrelated `icon-192.png` references (the app
    // `icons` array legitimately uses it) do not leak into this assertion.
    const match = config.match(/shortcuts:\s*\[([\s\S]*?)\]\s*\n\s*}/);
    expect(match, 'could not locate the shortcuts array in vite.config.ts').toBeTruthy();
    const shortcutsBlock = match![1];

    // All five shortcuts present and each carries the opaque asset.
    const iconRefs = [...shortcutsBlock.matchAll(/src:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(iconRefs).toHaveLength(5);
    for (const ref of iconRefs) {
      expect(ref).toBe(SHORTCUT_ICON);
    }
    // Prove-first: the transparent icon must not appear anywhere in the shortcuts.
    expect(shortcutsBlock).not.toContain(TRANSPARENT_APP_ICON);
    // Every shortcut declares purpose 'any' (plain square, not maskable).
    const purposes = [...shortcutsBlock.matchAll(/purpose:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(purposes).toHaveLength(5);
    for (const p of purposes) {
      expect(p).toBe('any');
    }
  });
});
