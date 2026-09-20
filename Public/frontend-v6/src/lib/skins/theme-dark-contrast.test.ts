/**
 * Guard against the "light text on a white card" regression on the two
 * festival-skin DARK themes (`festival-dark`, `heritage-serif-dark`).
 *
 * Root cause it guards: the generic `:root.dark { --surface-bg: 255 255 255 }`
 * rule (specificity 0,2,0) used to override each festival-dark theme block,
 * which declared its intended DARK opaque surface with a bare attribute
 * selector `[data-theme='festival-dark']` (specificity 0,1,0). Because <html>
 * carries BOTH `data-theme` AND the `dark` class, --surface-bg resolved to
 * WHITE while --fest-ink stayed a light cream — so the festival skin's opaque
 * cards (fest.ts CARD = bg-[rgb(var(--surface-bg))]) rendered light text on a
 * white card. The fix raises ONLY those two blocks to `:root[data-theme=...]`
 * (specificity 0,2,0) so, being later in source order, they win.
 *
 * This is a source-scan test (no DOM / jsdom needed): the browser-computed
 * behaviour was verified during diagnosis; this locks the CSS shape so the
 * pairing can't silently regress.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../app.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../app.html', import.meta.url), 'utf8');

const DARK_THEME_IDS = ['festival-dark', 'heritage-serif-dark'] as const;

/** Average of the three ints in an `rgb triplet` string like "42 20 24". */
function tripletAverage(triplet: string): number {
  const ints = triplet.trim().split(/\s+/).map((n) => Number.parseInt(n, 10));
  expect(ints).toHaveLength(3);
  ints.forEach((n) => expect(Number.isFinite(n)).toBe(true));
  return (ints[0] + ints[1] + ints[2]) / 3;
}

/**
 * Pull the `{ ... }` body of the token block for a given `:root[data-theme=id]`
 * selector out of app.css. Robust to whitespace around the selector/brace.
 */
function tokenBlockFor(id: string): string {
  const re = new RegExp(`:root\\[data-theme='${id}'\\]\\s*\\{([^}]*)\\}`);
  const match = css.match(re);
  expect(match, `expected a :root[data-theme='${id}'] { ... } token block in app.css`).not.toBeNull();
  return match![1];
}

/** Value string after a `--var:` declaration inside a block body. */
function cssVar(blockBody: string, name: string): string {
  const re = new RegExp(`${name}\\s*:\\s*([^;]+);`);
  const match = blockBody.match(re);
  expect(match, `expected ${name} inside the token block`).not.toBeNull();
  return match![1];
}

describe('festival-skin dark themes stay specificity-hardened', () => {
  for (const id of DARK_THEME_IDS) {
    it(`${id} token block uses the :root[...] selector (beats :root.dark)`, () => {
      expect(css).toContain(`:root[data-theme='${id}']`);
    });
  }
});

describe('festival-skin dark themes pair a DARK surface with LIGHT ink', () => {
  for (const id of DARK_THEME_IDS) {
    it(`${id}: --surface-bg is dark and --fest-ink is light`, () => {
      const body = tokenBlockFor(id);
      const surface = tripletAverage(cssVar(body, '--surface-bg'));
      const ink = tripletAverage(cssVar(body, '--fest-ink'));
      // Dark opaque card, light text — never light-on-light.
      expect(surface).toBeLessThan(128);
      expect(ink).toBeGreaterThan(128);
    });
  }
});

describe('app.html no-flash DARK map', () => {
  for (const id of DARK_THEME_IDS) {
    it(`sets the \`dark\` class for ${id}`, () => {
      const darkMatch = html.match(/var DARK\s*=\s*\{([^}]*)\}/);
      expect(darkMatch, 'expected a DARK map in the no-flash script').not.toBeNull();
      expect(darkMatch![1]).toContain(`'${id}'`);
    });
  }
});
