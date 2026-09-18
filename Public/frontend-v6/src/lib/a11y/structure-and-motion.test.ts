// ====== PR-41 — page structure, a way past the chrome, tables, and motion ======
// @vitest-environment jsdom
//
// Five findings, each measured rather than assumed:
//
//  1. NO SKIP LINK anywhere. All five shells put a header, a language switcher, a theme picker
//     and a primary nav ahead of the content, so a keyboard or switch-access visitor Tabbed
//     through the lot on EVERY page before reaching what they came for (WCAG 2.4.1).
//
//  2. TEN PAGES HAD NO h1. The whole `classic` skin (8 of 8) plus Home in `aurora` and
//     `festival`. Without one, a screen reader gives the visitor no page name and heading
//     navigation lands nowhere. NOTE: my first count also blamed `premium`, wrongly — it has
//     h1s through the shared PageHeading component, which a grep for `<h1` in the skin folder
//     does not see. The test below counts the component too.
//
//  3. THE DECADE TABLE WAS NOT A TABLE. Three CSS-grid columns of <span>s, so "2019, 41,300, 63"
//     read as a flat run of numbers with no column association.
//
//  4. LiveScroll's rAF LOOP NEVER STOPPED. `step()` scheduled the next frame unconditionally and
//     then returned early when paused/hovered/hidden/reduced-motion — so it woke the browser 60
//     times a second for the life of the page, for no pixels changed.
//
//  5. `prefers-reduced-motion` WAS READ ONCE. A visitor who switches it on — which people with
//     vestibular disorders do precisely BECAUSE something is moving — kept the animation.
//
// One item from the plan is NOT here, deliberately: it lists a Festival `rgb(#hex)` bug. That is
// not present in the code. `--fest-banner-from/-to` are full colour values used with `var()`
// directly, exactly as their own comment in app.css documents, and nothing wraps them in `rgb()`.
// Either it was fixed earlier or the plan mis-recorded it; there was nothing to change, and
// inventing a fix would have been worse than saying so.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC = resolve(process.cwd(), 'src');
const SKINS = readdirSync(join(SRC, 'lib/skins')).filter((d) =>
  existsSync(join(SRC, 'lib/skins', d, 'Shell.svelte')));
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

// -------------------------------------------------------- 1. A WAY PAST THE CHROME

describe('PR-41: every shell offers a skip link', () => {
  it('there are five skins to check (guards against a vacuous pass)', () => {
    expect(SKINS.length).toBe(5);
  });

  for (const skin of SKINS) {
    it(`${skin} has a skip link pointing at its <main>`, () => {
      const shell = read(`lib/skins/${skin}/Shell.svelte`);
      expect(shell, 'no href="#main"').toMatch(/href="#main"/);
      // The target has to exist and be focusable, or the link moves the caret nowhere.
      expect(shell, '<main> must carry id="main"').toMatch(/<main[^>]*\bid="main"/);
      expect(shell, '<main> needs tabindex="-1" to accept programmatic focus').toMatch(/<main[^>]*tabindex="-1"/);
    });

    it(`${skin}'s skip link is hidden until focused`, () => {
      const shell = read(`lib/skins/${skin}/Shell.svelte`);
      const link = /<a[\s\S]*?href="#main"[\s\S]*?>/.exec(shell)![0];
      // Visible always would add furniture to every page; hidden always is a WCAG failure of
      // its own (2.4.1 wants it available to keyboard users).
      expect(link).toMatch(/\bsr-only\b/);
      expect(link).toMatch(/focus:not-sr-only/);
    });
  }
});

// --------------------------------------------------------- 2. ONE h1 PER PAGE

describe('PR-41: every page has exactly one h1', () => {
  const pagesOf = (skin: string) => {
    const dir = join(SRC, `lib/skins/${skin}/pages`);
    return readdirSync(dir).filter((f) => f.endsWith('.svelte'));
  };

  it('every skin has the same eight pages', () => {
    for (const skin of SKINS) expect(pagesOf(skin).length, skin).toBe(8);
  });

  for (const skin of SKINS) {
    it(`${skin}: no page is left without one`, () => {
      const missing = pagesOf(skin).filter((f) => {
        const src = read(`lib/skins/${skin}/pages/${f}`);
        // PageHeading renders the h1 for the page that uses it — a plain search for `<h1` in
        // the page file misses that and produces a false accusation. (DecadeBanner is NOT a
        // heading provider: it renders no h1, so pages that show it still need their own — the
        // default premium home now carries an sr-only <h1> directly.)
        return !/<h1\b/.test(src) && !src.includes('PageHeading');
      });
      expect(missing, `${skin} pages with no h1`).toEqual([]);
    });

    it(`${skin}: and no page declares two`, () => {
      for (const f of pagesOf(skin)) {
        const src = read(`lib/skins/${skin}/pages/${f}`);
        const own = (src.match(/<h1\b/g) || []).length;
        const viaComponent = src.includes('PageHeading') ? 1 : 0;
        expect(own + viaComponent, `${skin}/${f} declares ${own + viaComponent} h1s`).toBeLessThanOrEqual(1);
      }
    });
  }
});

// ------------------------------------------------------- 3. THE DECADE TABLE

describe('PR-41: the decade figures are a table', () => {
  for (const skin of SKINS) {
    it(`${skin}: rows and columns are associated`, () => {
      const src = read(`lib/skins/${skin}/pages/Decade.svelte`);
      expect(src).toMatch(/role="table"/);
      expect(src, 'the table must be named').toMatch(/aria-labelledby="decade-table-h"/);
      expect(src).toMatch(/id="decade-table-h"/);
      expect((src.match(/role="row"/g) || []).length,
        'a header row and a data row').toBeGreaterThanOrEqual(2);
      expect((src.match(/role="columnheader"/g) || []).length,
        'year, total, contributors').toBe(3);
      expect((src.match(/role="cell"/g) || []).length).toBe(3);
    });

    it(`${skin}: the grid layout is untouched`, () => {
      // The whole reason for ARIA roles instead of real <table> markup: five skins I cannot look
      // at. If the grid classes have gone, the change was not the safe one it claims to be.
      const src = read(`lib/skins/${skin}/pages/Decade.svelte`);
      expect((src.match(/grid-cols-\[1fr_1\.4fr_1fr\]/g) || []).length).toBeGreaterThanOrEqual(2);
    });
  }
});

// -------------------------------------------------- 4 & 5. MOTION AND BATTERY

describe('PR-41: the live scroller stops when it should', () => {
  const SRC_TEXT = read('lib/components/LiveScroll.svelte');

  it('the rAF loop is guarded by a derived "should animate", not restarted unconditionally', () => {
    expect(SRC_TEXT, 'a derived gate is what lets the effect stop').toMatch(/let shouldAnimate = \$derived\(/);
    // The old shape scheduled the next frame as the FIRST statement, before any check.
    const effect = /\$effect\(\(\) => \{[\s\S]*?shouldAnimate[\s\S]*?\}\);/.exec(SRC_TEXT);
    expect(effect, 'no effect reads shouldAnimate').toBeTruthy();
    expect(effect![0]).toMatch(/if \(!browser \|\| !shouldAnimate\) return;/);
  });

  it('reduced-motion is a subscription, not a one-off read', () => {
    expect(SRC_TEXT, 'without a change listener the setting only applies on reload')
      .toMatch(/addEventListener\('change'/);
    // Old Safari has no addEventListener on MediaQueryList, and committee phones are old.
    expect(SRC_TEXT).toMatch(/addListener\?\.\(/);
  });

  it('tab visibility is tracked, because document.hidden is not reactive', () => {
    expect(SRC_TEXT).toMatch(/visibilitychange/);
  });

  it('the duplicated half of the track is inert, not merely aria-hidden', () => {
    // aria-hidden alone left the copies in the TAB ORDER: a keyboard user went through every
    // contributor twice, and half of them announced nothing.
    expect(SRC_TEXT).toMatch(/inert=\{isDuplicate\}/);
    expect(SRC_TEXT).toMatch(/aria-hidden=\{isDuplicate \? 'true' : undefined\}/);
  });

  it('the pause control is still there and still says which state it is in', () => {
    expect(SRC_TEXT).toMatch(/aria-pressed=\{userPaused\}/);
    expect(SRC_TEXT).toMatch(/userPaused \? \$tr\('play'\) : \$tr\('pause'\)/);
  });
});

// ----------------------------------------------------------- 6. SAFE AREA

describe('PR-41: the bottom nav clears the home-area inset', () => {
  for (const skin of SKINS) {
    it(`${skin}'s fixed bottom bar has safe-area padding`, () => {
      const shell = read(`lib/skins/${skin}/Shell.svelte`);
      const ownsBar = /fixed inset-x-0 bottom/.test(shell);
      if (!ownsBar) {
        // premium delegates to the shared BottomNav, which carries the inset itself. Asserting
        // that rather than skipping, so "it has no bar" cannot hide a missing one.
        expect(shell, `${skin} has no bar of its own, so it must use BottomNav`).toMatch(/BottomNav/);
        expect(read('lib/components/BottomNav.svelte')).toMatch(/env\(safe-area-inset-bottom\)/);
        return;
      }
      expect(shell, 'a bar pinned to bottom-0 sits under the iOS home indicator without this')
        .toMatch(/env\(safe-area-inset-bottom\)/);
    });
  }
});

// ------------------------------------------- 7. THE SKIP LINK ACTUALLY MOVES FOCUS

describe('PR-41: the skip link works, not just exists', () => {
  let host: HTMLDivElement;
  let app: ReturnType<typeof mount> | null = null;

  beforeEach(() => { document.body.innerHTML = ''; host = document.createElement('div'); document.body.appendChild(host); });
  afterEach(() => { if (app) { unmount(app); app = null; } });

  it('focusing #main from the link is possible because main takes tabindex="-1"', () => {
    // A behavioural check on the mechanism rather than on a mounted shell: the shells need
    // stores, routing and a theme to mount, and what can actually go wrong here is a <main>
    // that refuses programmatic focus.
    host.innerHTML = `<a href="#main">skip</a><main id="main" tabindex="-1">content</main>`;
    const main = host.querySelector('main')!;
    main.focus();
    expect(document.activeElement, 'without tabindex="-1" this stays on <body>').toBe(main);
  });

  it('a <main> WITHOUT tabindex cannot take focus — which is why the attribute is asserted above', () => {
    host.innerHTML = `<main id="nope">content</main>`;
    const main = host.querySelector('main')!;
    main.focus();
    expect(document.activeElement).not.toBe(main);
  });
});
