// ====== PR-39 — AA contrast, computed from the stylesheet, and a visible focus ring ======
//
// Contrast is arithmetic, not judgement, so it belongs in CI rather than in a review comment.
// This test reads the REAL token values out of styles.css and computes WCAG 2.1 ratios for the
// pairs the app actually renders. Nine of them failed before this PR:
//
//   --text-muted on the #f3f4f6 panels        4.39   (need 4.5)
//   --primary-saffron as text on white        2.77   links, active tab, active nav
//   white text on --primary-saffron           2.77   the FAB and the submit button
//   --danger as text on white                 3.76
//   white text on --danger                    3.76   .btn-danger
//   --success as text on white                2.53   19 call sites
//   --warning as text on white                2.14
//   --danger on the pale red icon panel       3.08
//   --primary-saffron as a focus ring         2.77   (need 3 for non-text, 1.4.11)
//
// THE BRAND FILL IS UNCHANGED. #F27A1A is the committee's colour. Where it failed as TEXT the
// fix is a darker text-only variant; where white text on it failed, the LABEL darkened rather
// than the fill, because the identity is the colour, not the label. Both options were computed
// before choosing: darkening the fill to #B85D14 would also have passed, and was rejected.
//
// Separately: `outline: none` was set on EVERY text input and select, so a keyboard user had no
// indication of where focus was (2.4.7) — and nothing replaced it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contrastRatio, ratio2dp, parseColor, AA_TEXT, AA_NON_TEXT } from './contrast';

const CSS = readFileSync(resolve(process.cwd(), 'src/lib/styles.css'), 'utf8');

/** The declared value of a custom property, read from the stylesheet rather than hard-coded. */
function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(CSS);
  expect(m, `--${name} is not declared in styles.css`).toBeTruthy();
  return m![1].trim();
}

const T = {
  saffron: () => token('primary-saffron'),
  saffronText: () => token('saffron-text'),
  focusRing: () => token('focus-ring'),
  textMain: () => token('text-main'),
  textMuted: () => token('text-muted'),
  success: () => token('success'),
  danger: () => token('danger'),
  warning: () => token('warning'),
  saffronLight: () => token('saffron-light'),
  cardWhite: () => token('card-white'),
  offwhite: () => token('bg-offwhite'),
};
const PANEL = '#f3f4f6';   // .stat-box, .profile-mini-box, .icon-btn
const PALE_RED = '#FEE2E2';

describe('PR-39: the token palette meets AA where it is used as text', () => {
  type ColorSource = string | (() => string);
  const cases: [string, ColorSource, ColorSource, number][] = [
    ['--text-main on a card', T.textMain, '#FFFFFF', AA_TEXT],
    ['--text-main on the page background', T.textMain, '#F8F9FA', AA_TEXT],
    ['--text-muted on a card', T.textMuted, '#FFFFFF', AA_TEXT],
    ['--text-muted on the page background', T.textMuted, '#F8F9FA', AA_TEXT],
    ['--text-muted on the #f3f4f6 panels', T.textMuted, PANEL, AA_TEXT],
    ['--saffron-text on a card', T.saffronText, '#FFFFFF', AA_TEXT],
    ['--saffron-text on the #f3f4f6 panels', T.saffronText, PANEL, AA_TEXT],
    ['--saffron-text on --saffron-light (desktop active nav)', T.saffronText, '#FFEDD5', AA_TEXT],
    ['--danger as text on a card', T.danger, '#FFFFFF', AA_TEXT],
    ['white label on --danger (.btn-danger)', '#FFFFFF', T.danger, AA_TEXT],
    ['--success as text on a card', T.success, '#FFFFFF', AA_TEXT],
    ['--warning as text on a card', T.warning, '#FFFFFF', AA_TEXT],
    ['--text-main label on the saffron fill (.fab, .btn-submit)', T.textMain, T.saffron, AA_TEXT],
  ];

  for (const [name, fg, bg, need] of cases) {
    it(`${name} >= ${need}`, () => {
      const f = typeof fg === 'function' ? fg() : fg;
      const b = typeof bg === 'function' ? bg() : bg;
      const r = ratio2dp(contrastRatio(f, b));
      expect(r, `${f} on ${b} is ${r}`).toBeGreaterThanOrEqual(need);
    });
  }

  it('the focus ring passes the 3:1 that 1.4.11 asks of a non-text indicator', () => {
    for (const bg of ['#FFFFFF', T.offwhite(), PANEL]) {
      const r = ratio2dp(contrastRatio(T.focusRing(), bg));
      expect(r, `ring ${T.focusRing()} on ${bg} is ${r}`).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  });

  it('the badge and banner pairs written as literals still pass', () => {
    // These were already compliant; asserted so a later "tidy-up" of the palette cannot quietly
    // break the one part that was right.
    const pairs: [string, string][] = [
      ['#065F46', '#D1FAE5'], // badge-ok
      ['#991B1B', '#FEE2E2'], // badge-warn, error-banner, icon-danger
      ['#92400E', '#FEF3C7'], // badge-pending
    ];
    for (const [fg, bg] of pairs) {
      expect(ratio2dp(contrastRatio(fg, bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe('PR-39: the brand fill was not repainted to get there', () => {
  it('--primary-saffron is still the committee colour', () => {
    expect(parseColor(T.saffron())).toEqual(parseColor('#F27A1A'));
  });

  it('...and is never used as text, because as text it is 2.77 on white', () => {
    const r = ratio2dp(contrastRatio(T.saffron(), '#FFFFFF'));
    expect(r).toBeLessThan(AA_TEXT); // the reason --saffron-text exists

    // `(?<![-\w])` matters: without it this also matches the tail of `background-color:` and
    // `accent-color:`, and my first version reported three fills and a border as text uses.
    const asText = CSS.split('\n')
      .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
      .filter((line) => /(?<![-\w])color:\s*var\(--primary-saffron\)/.test(line));
    expect(asText.map((l) => l.trim().slice(0, 80)),
      'use var(--saffron-text) for text; the fill token fails AA as text').toEqual([]);
  });
});

describe('PR-39: the rollback target cannot reintroduce the failures', () => {
  // mgmt/frontend is the retained React app and has NO test suite of its own — its only CI gate
  // is the build and a bundle-size budget. It carries a near-identical stylesheet, so a rollback
  // would have restored all nine failing pairs and the missing focus ring. Same reasoning as
  // C3, where the server had to validate because that app validated nothing.
  const REACT = readFileSync(resolve(process.cwd(), '../frontend/styles.css'), 'utf8');
  const reactToken = (name: string) => {
    const m = new RegExp(`--${name}:\\s*([^;]+?)\\s*(?:;|/\\*)`).exec(REACT);
    expect(m, `--${name} is not declared in the React stylesheet`).toBeTruthy();
    return m![1].trim();
  };

  it('its palette carries the same measured values', () => {
    for (const name of ['primary-saffron', 'saffron-text', 'focus-ring', 'text-muted', 'success', 'danger', 'warning']) {
      expect(parseColor(reactToken(name)), `--${name} differs between the two apps`)
        .toEqual(parseColor(token(name)));
    }
  });

  it('its text pairs meet AA', () => {
    for (const [fg, bg] of [
      [reactToken('text-muted'), PANEL],
      [reactToken('saffron-text'), '#FFFFFF'],
      [reactToken('danger'), '#FFFFFF'],
      [reactToken('success'), '#FFFFFF'],
      ['#FFFFFF', reactToken('danger')],
      [reactToken('text-main'), reactToken('primary-saffron')],
    ] as [string, string][]) {
      expect(ratio2dp(contrastRatio(fg, bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('it has a focus ring and no bare outline suppression', () => {
    expect(REACT).toMatch(/:focus-visible\s*\{[^}]*var\(--focus-ring\)/);
    const killers = REACT.split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
      .filter((l) => /outline:\s*(none|0)\b/.test(l) && !/:focus-visible/.test(l));
    expect(killers.map((l) => l.trim().slice(0, 70))).toEqual([]);
  });
});

describe('PR-39: the public portal ring clears 3:1 on both offsets', () => {
  const PUBLIC_CSS = readFileSync(
    resolve(process.cwd(), '../../Public/frontend-v6/src/app.css'), 'utf8');
  const BRAND = { 500: '#F27A1A', 600: '#D3630F', 700: '#A94D0C' };

  it('the ring is brand-600, not brand-500', () => {
    const m = /:focus-visible\s*\{\s*@apply([^;]+);/.exec(PUBLIC_CSS);
    expect(m, 'no :focus-visible ring in the public app').toBeTruthy();
    expect(m![1]).toMatch(/ring-brand-600/);
    expect(m![1], 'brand-500 is 2.77 against white — present but unfindable').not.toMatch(/ring-brand-500\b/);
  });

  it('brand-600 is chosen because its WORST case is the best available', () => {
    // The arithmetic, so the choice is reproducible rather than a preference. The ring has to
    // work on a white offset (light themes) AND on the dark ink offset, so what matters is the
    // WORSE of the two, not the better:
    //
    //   brand-500  2.77 / 6.82  -> worst 2.77, fails 1.4.11 on every light theme
    //   brand-600  3.77 / 5.01  -> worst 3.77   <- chosen
    //   brand-700  5.59 / 3.38  -> worst 3.38, passes, but with less headroom
    //
    // I first wrote this test asserting brand-700 FAILED on the dark ink. It does not: 3.38 is
    // above 3. Both 600 and 700 are compliant; 600 wins on the worst case, which is the number
    // that decides whether a real user can find the ring.
    const worst = (c: string) => Math.min(
      ratio2dp(contrastRatio(c, '#FFFFFF')),
      ratio2dp(contrastRatio(c, '#0b1020')),
    );
    expect(worst(BRAND[500]), 'brand-500 is why this PR exists').toBeLessThan(AA_NON_TEXT);
    expect(worst(BRAND[600])).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(worst(BRAND[700])).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(worst(BRAND[600]), 'if this stops being the best worst case, revisit the choice')
      .toBeGreaterThan(worst(BRAND[700]));
  });
});

describe('PR-39: focus is visible again', () => {
  it('no rule kills the outline without replacing it', () => {
    const killers = CSS.split('\n')
      .map((line, i) => ({ line, i: i + 1 }))
      // Skip comments — the explanation of this very fix contains the string it looks for, and
      // my first version failed on its own documentation.
      .filter(({ line }) => !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
      .filter(({ line }) => /outline:\s*(none|0)\b/.test(line))
      .filter(({ line }) => !/:focus-visible/.test(line));
    // `outline: none` on every input and select is what made keyboard focus invisible.
    expect(killers.map(({ line, i }) => `${i}: ${line.trim().slice(0, 80)}`)).toEqual([]);
  });

  it('a :focus-visible ring is declared, with an offset so it is not swallowed by the border', () => {
    const block = /:focus-visible\s*\{([^}]+)\}/.exec(CSS);
    expect(block, 'no :focus-visible rule at all').toBeTruthy();
    expect(block![1]).toMatch(/outline:\s*\d+px/);
    expect(block![1]).toMatch(/var\(--focus-ring\)/);
    expect(block![1]).toMatch(/outline-offset/);
  });

  it('engines without :focus-visible still get a ring', () => {
    expect(CSS, 'the @supports fallback is what covers older WebViews on committee phones')
      .toMatch(/@supports not selector\(:focus-visible\)/);
  });
});
