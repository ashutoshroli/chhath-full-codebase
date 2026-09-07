// audit L-13 / Q-4 — parity tests for helpers that are DELIBERATELY duplicated
// across the two Workers (mgmt + Public) because they have no shared source tree.
//
// This is the class of duplication that has ALREADY drifted in this repo: audit
// M-31 (#88) found two copies of isTruthyFlag disagreeing on 7 real values, which
// caused "Active but never shown" popup bugs in production. The copies carry a
// "keep in sync" comment, but a comment is not a check. These tests are the check.
//
// Approach: rather than add a test-only `export` to production files, each copy is
// read from its committed source, its function body extracted, and materialised
// with `new Function`. So the test exercises the REAL source of every copy and
// fails the moment any of them diverges behaviourally (textual differences like
// comment wording or reordered OR-branches are fine — only OUTPUT is asserted).
//
// Run: node --test mgmt/backend/test/l13-q4-helper-parity.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isTruthyFlag as mgmtBackendIsTruthyFlag } from '../src/flags.js';
import { parseAmt as mgmtParseAmt } from '../src/money.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..'); // repo root

// Pull a named `function <name>(...) { ... }` out of a source file and return it
// as a callable, so we can run the exact committed implementation of a copy that
// isn't exported. Balances braces to find the function end (the helpers here have
// no string/comment braces, so a simple brace count is exact).
function extractFn(relPath, fnName) {
  const src = readFileSync(join(ROOT, relPath), 'utf8');
  const sig = new RegExp(`function\\s+${fnName}\\s*\\(([^)]*)\\)\\s*\\{`);
  const m = sig.exec(src);
  assert.ok(m, `could not find function ${fnName} in ${relPath}`);
  const params = m[1];
  const bodyStart = m.index + m[0].length;
  let depth = 1;
  let i = bodyStart;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
  }
  const body = src.slice(bodyStart, i - 1);
  // eslint-disable-next-line no-new-func
  return new Function(params, body);
}

// Pull an arrow-const `export const <name> = (...) => ...;` implementation.
function extractArrowConst(relPath, name) {
  const src = readFileSync(join(ROOT, relPath), 'utf8');
  const re = new RegExp(`const\\s+${name}\\s*=\\s*(\\([^)]*\\)\\s*=>[^;]+);`);
  const m = re.exec(src);
  assert.ok(m, `could not find const ${name} in ${relPath}`);
  // eslint-disable-next-line no-new-func
  return new Function(`return (${m[1]});`)();
}

// ---------------------------------------------------------------------------
// isTruthyFlag — mgmt backend (imported), mgmt frontend, Public backend
// ---------------------------------------------------------------------------
const TRUTHY_CASES = [
  true, false, 1, 0, null, undefined,
  '1', '0', 'true', 'True', 'TRUE', ' true ', 'false', 'False',
  'yes', 'YES', ' yes ', 'no', '', '   ', 'y', 'n', 't', 'f',
  2, -1, 'active', 'x', '1.0',
];

test('isTruthyFlag: mgmt-frontend and Public-backend copies match the mgmt-backend source of truth', () => {
  const frontendCopy = extractFn('mgmt/frontend/src/flags.js', 'isTruthyFlag');
  const publicCopy = extractFn('Public/backend/src/index.js', 'isTruthyFlag');
  for (const v of TRUTHY_CASES) {
    const expected = mgmtBackendIsTruthyFlag(v);
    assert.equal(frontendCopy(v), expected, `mgmt-frontend isTruthyFlag disagrees on ${JSON.stringify(v)}`);
    assert.equal(publicCopy(v), expected, `Public-backend isTruthyFlag disagrees on ${JSON.stringify(v)}`);
  }
});

// ---------------------------------------------------------------------------
// parseStoredDate — mgmt backend (popups.js) and Public backend (index.js).
// Must agree or the two portals disagree about which popups are live.
// ---------------------------------------------------------------------------
const DATE_CASES = [
  '',
  '2026-08-22 14:31:00',      // legacy space form, treated as UTC
  '2026-08-22T14:31:00',      // ISO no zone -> UTC
  '2026-08-22T14:31:00Z',     // explicit UTC
  '2026-08-22T14:31:00+05:30',// explicit offset
  '2026-08-22',               // date only
  '2026-08-22 14:31:00+05:30',// space form WITH offset
  'not a date',
  '2026-13-45',               // invalid calendar
];

test('parseStoredDate: mgmt (popups.js) and Public (index.js) copies produce identical timestamps', () => {
  const mgmtCopy = extractFn('mgmt/backend/src/popups.js', 'parseStoredDate');
  const publicCopy = extractFn('Public/backend/src/index.js', 'parseStoredDate');
  for (const v of DATE_CASES) {
    const a = mgmtCopy(v);
    const b = publicCopy(v);
    const at = a === null ? null : a.getTime();
    const bt = b === null ? null : b.getTime();
    assert.equal(bt, at, `parseStoredDate disagrees on ${JSON.stringify(v)}: mgmt=${at} public=${bt}`);
  }
});

// ---------------------------------------------------------------------------
// parseAmt — mgmt backend is single-source (money.js). Public frontend keeps its
// own copy (separate deployment). Pin them to identical numeric output.
// ---------------------------------------------------------------------------
const AMT_CASES = [
  '', null, undefined, '0', '100', '1,00,000', '₹500', 'Rs. 250',
  '1234.56', '-50', 'abc', '12abc34', '  99  ', '1,234.50/-', '0.00',
];

test('parseAmt: Public-frontend copy matches the mgmt money.js source of truth', () => {
  const publicCopy = extractArrowConst('Public/frontend/script.js', 'parseAmt');
  for (const v of AMT_CASES) {
    assert.equal(publicCopy(v), mgmtParseAmt(v), `parseAmt disagrees on ${JSON.stringify(v)}`);
  }
});
