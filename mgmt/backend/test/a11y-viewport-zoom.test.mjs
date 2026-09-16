// audit PR-39 (slice) — no page may stop a visitor zooming. WCAG 2.1 SC 1.4.4.
//
// `maximum-scale=1.0, user-scalable=no` in a viewport meta tag disables pinch-zoom.
// On this portal that is not a styling preference — the people using it are committee
// members reading contribution tables and loan amounts on a phone, and the ones most
// likely to need to zoom are the ones least likely to know how to work around a page
// that refuses to.
//
// WHY THIS IS A TEST AND NOT JUST A FIX. The block was in the ORIGINAL public
// frontend, and it survived being carried into `frontend-v3`, then into the mgmt
// React SPA, then into the mgmt SvelteKit app. It was dropped somewhere around the
// v4 public rewrite — by accident, not decision, because nothing ever said it must
// not come back. Every one of those was a hand-written `index.html`/`app.html`, and
// the next new app will be too. So the guarantee belongs in CI, checked against
// EVERY such file in the tree, including ones that do not exist yet.
//
// WHY IT LIVES IN mgmt/backend/test. It is a whole-repository invariant, and this is
// the suite that already reaches outside its own package to assert them — the
// migration matrix reads `mgmt/db/`, and h6-upload-size-caps scans `src/` for call
// sites. Putting it in one frontend's own tests would only ever check that frontend,
// which is exactly the failure mode above.
//
// Run: node --test mgmt/backend/test/a11y-viewport-zoom.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Ask git rather than walking the tree: it gives exactly the TRACKED files and skips
// node_modules, build/ and .svelte-kit/ for free — a generated copy of a fixed
// template is not a defect, and editing one would be meaningless.
function trackedHtmlEntrypoints() {
  const out = execFileSync('git', ['ls-files', '*.html'], { cwd: REPO, encoding: 'utf8' });
  return out.split('\n')
    .map((f) => f.trim())
    .filter(Boolean)
    // The page shells: Vite's index.html and SvelteKit's src/app.html.
    .filter((f) => /(^|\/)(index|app)\.html$/.test(f))
    .filter((f) => !f.includes('node_modules'));
}

function viewportOf(rel) {
  const html = readFileSync(join(REPO, rel), 'utf8');
  const tag = html.match(/<meta[^>]*name=["']viewport["'][^>]*>/i);
  if (!tag) return null;
  const content = tag[0].match(/content=["']([^"']*)["']/i);
  return content ? content[1] : '';
}

describe('no page disables zoom', () => {
  const files = trackedHtmlEntrypoints();

  test('the scan finds the app shells it is supposed to check', () => {
    // A regex that quietly matched nothing would make every assertion below pass.
    assert.ok(files.length >= 5, `only found ${files.length} shells: ${files.join(', ')}`);
    for (const expected of [
      'Public/frontend-v6/src/app.html',      // the live public portal
      'mgmt/frontend-svelte/src/app.html',    // the live mgmt SvelteKit app
      'mgmt/frontend/index.html',             // the retained mgmt React SPA
    ]) {
      assert.ok(files.includes(expected), `${expected} was not scanned`);
    }
  });

  test('no viewport meta blocks pinch-zoom, in any app shell', () => {
    const offenders = [];
    for (const f of files) {
      const content = viewportOf(f);
      if (content == null) continue; // no viewport tag at all is not this test's business
      // Both spellings matter: `user-scalable=no` refuses the gesture outright, and
      // `maximum-scale=1` caps it so the gesture does nothing. Either one fails 1.4.4.
      if (/user-scalable\s*=\s*(no|0)/i.test(content)) offenders.push(`${f}: user-scalable`);
      const max = content.match(/maximum-scale\s*=\s*([0-9.]+)/i);
      // 2 is the smallest cap that still permits the 200% zoom 1.4.4 requires.
      if (max && parseFloat(max[1]) < 2) offenders.push(`${f}: maximum-scale=${max[1]}`);
    }
    assert.deepEqual(offenders, [], `these shells stop a visitor zooming:\n  ${offenders.join('\n  ')}`);
  });

  test('the shells still declare a responsive viewport', () => {
    // Removing the zoom block must not turn into removing the whole tag, which would
    // make every page render at desktop width on a phone — a worse mobile bug than
    // the one being fixed.
    //
    // This assertion is deliberately UNCONDITIONAL. It was originally written to skip
    // files with no viewport tag, which meant deleting the tag outright passed the
    // whole suite while this comment claimed to prevent exactly that. Every tracked
    // shell has one today, so there is nothing to grandfather: a shell with no
    // viewport tag is a defect, and a NEW shell that forgets one now fails here
    // rather than shipping.
    for (const f of files) {
      const content = viewportOf(f);
      assert.notEqual(content, null, `${f} has no viewport meta tag at all`);
      assert.match(content, /width\s*=\s*device-width/i, `${f} lost width=device-width`);
      assert.match(content, /initial-scale\s*=\s*1/i, `${f} lost initial-scale=1`);
    }
  });
});
