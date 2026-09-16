// ====== PR-40 / carry-over C7 — every field is named, every failure is heard ======
//
// This app carried 160 svelte-check warnings. 142 of them were
//     "A form label must be associated with a control"
// which is not a lint nicety: an unassociated label means a screen reader announces the input
// with NO NAME AT ALL, and tapping the label text does not focus the field — on a phone, where
// the labels are the biggest targets, that is most of the usability of a form.
//
// Separately, 57 error banners existed and only TWO of them were live regions. So an operator
// submitted a form, it failed, and nothing was announced: the message was painted on screen
// for someone who could not see it, and there was no other signal that the save had not
// happened.
//
// Both are fixed, and `--fail-on-warnings` is now switched on for this app so the next one
// fails CI instead of joining a pile nobody reads. This file guards the parts a flag cannot:
// that the ids are unique per instance, that suppressions stay explained, and that the count
// of silent error banners is zero.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(process.cwd());
const SRC = resolve(ROOT, 'src');

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return svelteFiles(full);
    return full.endsWith('.svelte') ? [full] : [];
  });
}
const files = () => svelteFiles(SRC).map((f) => ({ path: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));

// ------------------------------------------------------- 1. THE GATE IS CLOSED

describe('PR-40: the warning gate is on', () => {
  it('svelte-check runs with --fail-on-warnings', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.check, 'without this flag the 160 warnings just come back').toMatch(/--fail-on-warnings/);
  });
});

// ------------------------------------------- 2. THE IDS CANNOT COLLIDE

describe('PR-40: label ids are unique per component instance', () => {
  it('no label association uses a hard-coded id', () => {
    // A literal id is a trap: several of these components are mounted more than once on a
    // screen (TransliterateInput, VillageInput, list rows). Duplicate ids make `for=` bind to
    // the first match, so every copy after the first silently points at the WRONG field —
    // worse than no label, because it looks right.
    const hard: string[] = [];
    for (const { path, src } of files()) {
      for (const m of src.matchAll(/<label\b[^>]*\bfor="([^"{]+)"/g)) {
        // `dlg-…-title` ids come from PR-37 and name dialogs, not form fields.
        if (!/^dlg-/.test(m[1])) hard.push(`${path}: for="${m[1]}"`);
      }
    }
    expect(hard, 'derive the id from the uid prefix instead').toEqual([]);
  });

  it('every file that associates labels takes a uid', () => {
    const missing: string[] = [];
    for (const { path, src } of files()) {
      if (!/<label\b[^>]*for=\{`\$\{uid\}/.test(src)) continue;
      if (!/newUid\(\)/.test(src)) missing.push(path);
    }
    expect(missing, 'the `uid` in the markup has to come from somewhere').toEqual([]);
  });

  it('every `for` built from uid has a matching id in the same file', () => {
    const broken: string[] = [];
    for (const { path, src } of files()) {
      for (const m of src.matchAll(/<label\b[^>]*\bfor=\{`([^`]+)`\}/g)) {
        const expr = m[1];
        if (!src.includes(`id={\`${expr}\`}`)) broken.push(`${path}: for=\`${expr}\` has no matching id`);
      }
    }
    // A dangling `for` is announced as an unnamed field, and nothing reports the mistake.
    expect(broken).toEqual([]);
  });
});

// --------------------------------------- 3. FAILURES ARE ANNOUNCED

describe('PR-40: a failed save is heard, not just painted', () => {
  it('every error banner is a live region', () => {
    const silent: string[] = [];
    for (const { path, src } of files()) {
      for (const m of src.matchAll(/<\w+[^>]*class="error-banner"[^>]*>/g)) {
        // `alert` (assertive) for a failure that needs attention; `status` (polite) for a
        // notice that can wait for a pause, like "your session ended". Both are live regions;
        // neither is silence. My first version accepted only `alert` and flagged a deliberate
        // `status` as a defect.
        if (!/role="(alert|status)"|aria-live=/.test(m[0])) silent.push(`${path}: ${m[0].slice(0, 70)}`);
      }
    }
    expect(silent, 'an error nobody hears is an error nobody acted on').toEqual([]);
  });

  it('there are still plenty of them, so the check is not vacuous', () => {
    const total = files().reduce(
      (n, { src }) => n + (src.match(/class="error-banner"/g) || []).length, 0);
    expect(total, `expected ~57 error banners, found ${total}`).toBeGreaterThan(40);
  });
});

// --------------------------------- 4. SUPPRESSIONS STAY ARGUED FOR

describe('PR-40: every remaining suppression is explained', () => {
  it('each `state_referenced_locally` ignore carries its reason', () => {
    // Fourteen of these are deliberate: EDITABLE local state seeded once from a prop, where
    // `$derived` would wipe out whatever the operator had typed. That is a real decision, so
    // it has to be written down next to the code — a bare directive is indistinguishable from
    // giving up.
    const bare: string[] = [];
    for (const { path, src } of files()) {
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (!/svelte-ignore state_referenced_locally/.test(line)) return;
        const context = lines.slice(Math.max(0, i - 4), i).join('\n');
        if (!/audit PR-40/.test(context)) bare.push(`${path}:${i + 1}`);
      });
    }
    expect(bare, 'add the reason above the directive').toEqual([]);
  });
});
