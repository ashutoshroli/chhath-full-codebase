// ====== PR-38 — every control is a control (audit: real buttons, named targets) ======
//
// Seventeen things in this app were clickable `<span>` or `<div>` elements: the
// Active/Inactive and Normal/Priority badges in four list components, the row edit/delete
// icons, the slide reorder arrows, the attachment remove, the template remove, the warning
// dismiss, and two whole rows that open a person's profile.
//
// A clickable `<div>` is not reachable by Tab, does not fire on Enter or Space, and is not
// announced as anything. Every one of those seventeen was mouse-only — and each carried a
// pair of `<!-- svelte-ignore a11y_click_events_have_key_events -->` comments, which is the
// compiler telling you exactly this and being told to be quiet.
//
// This file is a structural rule, not a behavioural test: the point is that no NEW one
// appears. Behaviour for the interesting case (the combobox) is proven by mounting it in
// SearchableSelect.test.ts.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC = resolve(process.cwd(), 'src');

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return svelteFiles(full);
    return full.endsWith('.svelte') ? [full] : [];
  });
}

const files = () => svelteFiles(SRC).map((f) => ({ path: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));

describe('PR-38: nothing but a control handles a click', () => {
  /**
   * The name of the element that actually OWNS this attribute.
   *
   * Checking "the line contains onclick AND the line contains <span>" is wrong, and I had it
   * wrong first: `<button class="fab" onclick={...}><span class="material-icons-round">add`
   * puts both on one line, so fourteen perfectly good buttons were reported as offenders.
   * Walk back to the `<` that opens the tag the attribute sits in.
   */
  function owningTag(src: string, attrIndex: number): string {
    for (let i = attrIndex; i >= 0; i--) {
      if (src[i] === '>') return ''; // we left the tag before finding its start
      if (src[i] === '<') {
        const m = /^<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(src.slice(i, i + 40));
        return m ? m[1] : '';
      }
    }
    return '';
  }

  const NON_CONTROLS = new Set(['div', 'span', 'li', 'td', 'tr', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

  it('no <span>/<div>/<li>/<td> carries an onclick', () => {
    const offenders: string[] = [];
    for (const { path, src } of files()) {
      for (const m of src.matchAll(/\bonclick=/g)) {
        const tag = owningTag(src, m.index!);
        if (!NON_CONTROLS.has(tag)) continue;
        const line = src.slice(0, m.index).split('\n').length;
        const text = src.split('\n')[line - 1].trim();
        // A backdrop is the documented exception: it exists to be clicked past, the dialog it
        // covers is already keyboard-dismissable with Escape, and making it a <button> would
        // put a huge unnamed control in the tab order ahead of the dialog's own contents.
        if (/modal-overlay/.test(text)) continue;
        // The combobox options are role="option" in a listbox driven from the input by
        // aria-activedescendant — the ARIA 1.2 pattern. They are controls; they are simply not
        // <button>s, which is what that pattern requires.
        if (path.endsWith('SearchableSelect.svelte') && /role="option"|choose\(o\)/.test(text)) continue;
        offenders.push(`${path}:${line}  ${text.slice(0, 90)}`);
      }
    }
    expect(offenders, 'a clickable non-control is invisible to Tab, Enter and screen readers').toEqual([]);
  });

  it('the svelte-ignore comments that papered over it are gone', () => {
    // These two suppressions are how the problem stayed invisible for so long. Any that
    // remain should be a deliberate, explained exception — not a default.
    const remaining: string[] = [];
    for (const { path, src } of files()) {
      const n = (src.match(/svelte-ignore a11y_click_events_have_key_events/g) || []).length;
      if (n) remaining.push(`${path} (${n})`);
    }
    // Exactly two survive, both deliberate and both explained where they sit:
    //
    //   Modal.svelte          the backdrop. It exists to be clicked past; the dialog it covers
    //                         is keyboard-dismissable with Escape (PR-37), and making the
    //                         backdrop a <button> would put a huge unnamed control in the tab
    //                         order ahead of the dialog's own contents.
    //   SearchableSelect      the options are role="option" in a listbox driven from the input
    //                         by aria-activedescendant. Per-option key handlers would be
    //                         wrong: the ARIA 1.2 combobox pattern puts them on the input, and
    //                         PR-38 does exactly that.
    //
    // Listing them explicitly rather than allowing "a few" means a new suppression has to be
    // argued for here, in writing, before this test will pass again.
    expect(remaining.sort()).toEqual([
      'lib/components/Modal.svelte (1)',
      'lib/components/SearchableSelect.svelte (1)',
    ]);
  });

  it('every icon-only control has an accessible name that is not the icon ligature', () => {
    // `<button class="material-icons-round">delete</button>` is "named" by the ligature text,
    // so a screen reader says "delete" and the name breaks the day the icon font fails to
    // load. An explicit aria-label is both clearer and durable.
    const unnamed: string[] = [];
    for (const { path, src } of files()) {
      for (const m of src.matchAll(/<button\b[^>]*class="[^"]*material-icons-round[^"]*"[^>]*>/g)) {
        if (!/aria-label=/.test(m[0])) unnamed.push(`${path}: ${m[0].slice(0, 90)}`);
      }
    }
    expect(unnamed).toEqual([]);
  });

  it('the bare-button reset exists, so a converted control did not change appearance', () => {
    const css = readFileSync(resolve(SRC, 'lib/styles.css'), 'utf8');
    expect(css).toMatch(/\.btn-bare\s*\{/);
    // WCAG 2.5.8 (AA) is 24px. 2.5.5's 44px is AAA and is deliberately deferred — see the
    // comment in styles.css.
    expect(css).toMatch(/min-height:\s*24px/);
  });
});
