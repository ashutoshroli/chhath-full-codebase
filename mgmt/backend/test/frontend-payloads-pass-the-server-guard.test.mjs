// ====== THE EDIT SCREENS MUST SURVIVE THE SERVER'S OWN GUARD (audit P0-09) ======
//
// Reported from the live portal: editing ANY record produced
//
//     "Created By" is set by the server and cannot be sent from the browser.
//     Please reload the page and try again
//
// and, on other screens, the same sentence about "ID" and "Sl. No.". Reloading could not
// help — the field was being sent by the code, not by a stale page — so the advice in the
// message was misleading on top of the failure.
//
// WHAT HAPPENED. #254 (the Svelte migration) wrote edit payloads that echo the row back,
// including `Created By`, `Sl. No.` and `ID`. #323 then added `assertNoServerOwnedFields`
// to the write paths, which rejects exactly those. Neither frontend was updated. From the
// moment #323 deployed, EVERY edit screen in BOTH mgmt apps was dead — and rolling back to
// the React app would not have helped, because it sends the same fields.
//
// WHY NOTHING CAUGHT IT. The backend tests for #323 assert that the guard REJECTS these
// fields, and they pass. The frontends were never checked against the guard. Two correct
// halves, one broken product. So this file does not re-test the guard: it takes the
// payload each view actually sends, from the view's own source, and runs it through the
// server's real `assertNoServerOwnedFields`. That is the only assertion that could have
// failed on `main`.
//
// It also pins the two things found while investigating:
//   * `final_repayment_date` was WRONGLY listed as server-owned. The operator types it, the
//     create path has always written it and the consent document reads it back, but the
//     EDIT path refused it — so it could be set once and never corrected.
//   * `saveLoanTransaction` never had the guard at all, so a crafted create could plant
//     `cash_amount` / `online_amount` and show money as paid out without the disbursement
//     workflow.
//
// Run: node --test mgmt/backend/test/frontend-payloads-pass-the-server-guard.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { assertNoServerOwnedFields, _serverOwnedFieldsFor } from '../src/validate.js';
import { COLUMN_ALIASES } from '../src/tableRegistry.js';
import { updateRecordByIdx } from '../src/crud.js';
import { saveLoanTransaction } from '../src/loans.js';

const SUPER = { name: 'USER0001', role: 'Superadmin' };

// mgmt sheet name -> D1 table, matching resolveSheet().
const TABLE_FOR_SHEET = {
  'COLLECTIONS': 'collections',
  'EXPENSES': 'expenses',
  'COMMITEE MEMBERS': 'committee_members',
  'LOANS': 'loans',
  'USERS': 'users',
  'LOAN GUARANTOR': 'loan_guarantors',
};

// ---------------------------------------------------------------- source reading

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// Every view that edits a record, in both apps. Listed explicitly so a NEW view cannot be
// added without appearing here — an auto-glob would silently cover nothing if the naming
// changed.
const VIEWS = [
  ['svelte', '../../frontend-svelte/src/lib/views/Home.svelte'],
  ['svelte', '../../frontend-svelte/src/lib/views/Expenses.svelte'],
  ['svelte', '../../frontend-svelte/src/lib/views/Committee.svelte'],
  ['svelte', '../../frontend-svelte/src/lib/views/Loans.svelte'],
  ['svelte', '../../frontend-svelte/src/lib/views/Users.svelte'],
  ['react', '../../frontend/src/views/Home.jsx'],
  ['react', '../../frontend/src/views/Expenses.jsx'],
  ['react', '../../frontend/src/views/Committee.jsx'],
  ['react', '../../frontend/src/views/Loans.jsx'],
  ['react', '../../frontend/src/views/Users.jsx'],
];

// Returns the text of the balanced {...} literal starting at `from`.
function braceBlockAt(src, from) {
  const start = src.indexOf('{', from);
  if (start < 0) return null;
  let depth = 0, quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

// Top-level keys of an object-literal text, plus the names of any `...spread`.
function keysOf(block) {
  const body = block.slice(1, -1);
  const keys = [];
  const spreads = [];
  let depth = 0, quote = null, token = '';
  const flush = () => { token = ''; };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      token += c;
      if (c === '\\') { token += body[++i]; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; token += c; continue; }
    if ('{[('.includes(c)) { depth++; token += c; continue; }
    if ('}])'.includes(c)) { depth--; token += c; continue; }
    if (c === ',' && depth === 0) {
      const t = token.trim();
      if (t.startsWith('...')) spreads.push(t.slice(3).trim());
      flush();
      continue;
    }
    if (c === ':' && depth === 0) {
      const t = token.trim();
      const m = t.match(/^(['"])(.*)\1$/);
      keys.push(m ? m[2] : t);
      // Skip this property's value; the next top-level comma resets us.
      let d = 0, q = null;
      for (i++; i < body.length; i++) {
        const ch = body[i];
        if (q) { if (ch === '\\') { i++; continue; } if (ch === q) q = null; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
        if ('{[('.includes(ch)) d++;
        else if ('}])'.includes(ch)) d--;
        else if (ch === ',' && d === 0) break;
      }
      flush();
      continue;
    }
    token += c;
  }
  const t = token.trim();
  if (t.startsWith('...')) spreads.push(t.slice(3).trim());
  return { keys, spreads };
}

// Resolves `...name` against an object literal declared in the same file, following nested
// spreads — the reactive form objects are built as `{ ...BLANK }`, so one level resolves to
// nothing useful. Throws rather than skipping: an unresolved spread, or one that resolves to
// an empty key list, would make this whole file prove nothing.
function resolveSpread(src, name, where, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);

  // Every declaration/assignment of `name` that is an object literal. All of them are
  // merged: a view may set the shape in `BLANK`, again in a reset, and again in `openEdit`,
  // and the payload can carry keys from any of them.
  const patterns = [
    new RegExp(`(?:const|let|var)\\s+${name}\\s*(?::[^=]+?)?=\\s*\\$state\\s*(?:<[^>]*>)?\\s*\\(`, 'g'),
    new RegExp(`(?:const|let|var)\\s+${name}\\s*(?::[^=]+?)?=\\s*(?=\\{)`, 'g'),
    new RegExp(`\\b${name}\\s*=\\s*(?=\\{)`, 'g'),
    new RegExp(`\\bset${name[0].toUpperCase()}${name.slice(1)}\\s*\\(\\s*(?=\\{)`, 'g'),
  ];

  const out = new Set();
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src))) {
      const block = braceBlockAt(src, m.index + m[0].length);
      if (!block) continue;
      const { keys, spreads } = keysOf(block);
      for (const k of keys) out.add(k);
      for (const s of spreads) for (const k of resolveSpread(src, s, where, seen)) out.add(k);
    }
  }
  if (!out.size) {
    throw new Error(
      `could not resolve spread "...${name}" in ${where} — extend the resolver rather than `
      + 'letting this file pass on an empty key list');
  }
  return [...out];
}

// All (sheet, keys) pairs a file sends to a given api method.
function payloadsFor(src, method, where) {
  const out = [];
  const call = `api.${method}(`;
  let at = 0;
  while ((at = src.indexOf(call, at)) >= 0) {
    const after = at + call.length;
    const sheet = (src.slice(after, after + 60).match(/^\s*['"]([^'"]+)['"]/) || [])[1];
    const block = braceBlockAt(src, after);
    if (!block) { at = after; continue; }
    const { keys, spreads } = keysOf(block);
    const all = [...keys];
    for (const s of spreads) {
      // `BLANK`-style constants and the reactive form objects both resolve; anything else
      // raises, on purpose.
      for (const k of resolveSpread(src, s, where)) all.push(k);
    }
    out.push({ sheet, keys: all });
    at = after;
  }
  return out;
}

// --------------------------------------------------- 1. THE ASSERTION THAT MATTERED

describe('every edit payload the frontends send passes the server guard', () => {
  for (const [app, rel] of VIEWS) {
    test(`${app}: ${rel.split('/').pop()}`, () => {
      const src = read(rel);
      const payloads = payloadsFor(src, 'updateRecord', rel);
      assert.ok(payloads.length >= 1, `no updateRecord call found in ${rel} — the extractor or the view changed`);

      for (const { sheet, keys } of payloads) {
        const table = TABLE_FOR_SHEET[sheet];
        assert.ok(table, `unknown sheet "${sheet}" in ${rel}`);
        assert.ok(keys.length >= 1, `no payload keys extracted for ${sheet} in ${rel}`);

        const payload = Object.fromEntries(keys.map((k) => [k, '']));
        // THE ASSERTION THAT FAILS ON `main`, for all ten call sites.
        assertNoServerOwnedFields(table, payload, { aliases: COLUMN_ALIASES[table] || {} });
      }
    });
  }

  test('the create payloads pass their guards too (saveLoan now has one)', () => {
    for (const [app, rel] of VIEWS) {
      const src = read(rel);
      for (const { keys } of payloadsFor(src, 'saveLoan', rel)) {
        assertNoServerOwnedFields('loans', Object.fromEntries(keys.map((k) => [k, ''])),
          { aliases: COLUMN_ALIASES.loans });
      }
      assert.ok(app, 'app label used');
    }
  });
});

// ------------------------------------------------- 2. THE EXTRACTOR IS NOT VACUOUS

describe('the extractor actually reads the payloads', () => {
  test('it finds an updateRecord call in all ten views', () => {
    const found = VIEWS.filter(([, rel]) => payloadsFor(read(rel), 'updateRecord', rel).length > 0);
    assert.equal(found.length, 10, `expected 10 views with an edit call, found ${found.length}`);
  });

  test('it reads the real keys, spreads resolved', () => {
    // Home sends Year plus the `payload` const it builds just above the call.
    const home = payloadsFor(read('../../frontend-svelte/src/lib/views/Home.svelte'), 'updateRecord', 'Home.svelte');
    const keys = home[0].keys;
    assert.equal(home[0].sheet, 'COLLECTIONS');
    for (const expected of ['Year', 'Name', 'Amount', 'Payment Mode', 'Is Resell']) {
      assert.ok(keys.includes(expected), `expected ${expected} among ${keys.join(', ')}`);
    }
    // Users spreads its reactive `form`, which must resolve to the real field list.
    const users = payloadsFor(read('../../frontend-svelte/src/lib/views/Users.svelte'), 'updateRecord', 'Users.svelte');
    assert.ok(users[0].keys.includes('Mobile'), `form did not resolve: ${users[0].keys.join(', ')}`);
  });

  test('a payload carrying a server-owned field really would fail this test', () => {
    // A control: if the guard or the extractor were toothless, everything above would pass
    // for the wrong reason.
    assert.throws(
      () => assertNoServerOwnedFields('collections', { Year: '', 'Created By': 'x' },
        { aliases: COLUMN_ALIASES.collections }),
      /set by the server/);
    assert.throws(
      () => assertNoServerOwnedFields('users', { ID: 'USER0001' }, { aliases: COLUMN_ALIASES.users }),
      /set by the server/);
  });
});

// ------------------------------- 3. final_repayment_date IS THE OPERATOR'S FIELD

function loanEnv() {
  const core = makeD1(schemaFor('core.sql'));
  const le = makeD1(schemaFor('loans_expenses.sql'));
  const collections = makeD1(schemaFor('collections.sql'));
  for (const [code, name] of [['USER0002', 'Ram'], ['USER0003', 'Shyam'], ['USER0004', 'Gita'], ['USER0005', 'Sita']]) {
    core.prepare('INSERT INTO users (id_code, name, mobile, whatsapp) VALUES (?,?,?,?)')
      .bind(code, name, 9800000001, 9800000001).run();
  }
  collections.prepare('INSERT INTO collections (year, name, amount) VALUES (?,?,?)')
    .bind(2026, 'USER0002', 1000000).run();
  return {
    DB_CORE: core,
    DB_LOANS_EXPENSES: le,
    DB_COLLECTIONS: collections,
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    DB_WHATSAPP_INDEX: makeD1(schemaFor('whatsapp_index.sql')),
    KV_SESSIONS: makeKV(),
    CONSENT_BASE_URL: 'https://portal.test',
  };
}

const GUARANTORS = () => [{ Guarantor: 'USER0003' }, { Guarantor: 'USER0004' }, { Guarantor: 'USER0005' }];
const LOAN = (over = {}) => ({
  Year: 2026, Name: 'USER0002', Amount: 50000, 'Intrest Rate': 12, Tenure: 1, ...over,
});

describe('final_repayment_date is the operator’s field, not the server’s', () => {
  test('it is no longer listed as server-owned', () => {
    assert.ok(!_serverOwnedFieldsFor('loans').includes('final_repayment_date'),
      'the create path writes it from the client and nothing on the server ever sets it');
  });

  test('create writes it AND edit can correct it — the whole point', async () => {
    const env = loanEnv();
    await saveLoanTransaction(env, LOAN({ 'Final Repayment Date': '2027-03-01', Status: 'Active' }), GUARANTORS(), SUPER);
    const created = await env.DB_LOANS_EXPENSES
      .prepare('SELECT id, final_repayment_date FROM loans ORDER BY id DESC LIMIT 1').first();
    assert.equal(created.final_repayment_date, '2027-03-01');

    // THE ASSERTION THAT FAILS ON `main`: the correction was refused. The payload mirrors
    // what Loans.svelte actually sends (validatePayload requires Name on a loan edit).
    await updateRecordByIdx(env, 'LOANS', created.id, {
      Year: 2026, Name: 'USER0002', Amount: 50000, 'Intrest Rate': 12, Tenure: 1,
      'Final Repayment Date': '2027-04-01', Status: 'Active',
    }, SUPER);
    const edited = await env.DB_LOANS_EXPENSES
      .prepare('SELECT final_repayment_date FROM loans WHERE id = ?').bind(created.id).first();
    assert.equal(edited.final_repayment_date, '2027-04-01', 'the operator must be able to fix a wrong date');
  });

  test('the columns that ARE server-owned are still refused on edit', async () => {
    const env = loanEnv();
    for (const key of ['Cash Amount', 'Online Amount', 'Loan Status', 'Created By', 'Loan ID']) {
      await assert.rejects(
        () => updateRecordByIdx(env, 'LOANS', 1, { Year: 2026, Name: 'USER0002', [key]: 'x' }, SUPER),
        /set by the server/, `${key} must still be refused`);
    }
  });
});

// ----------------------------------- 4. THE LOAN CREATE PATH HAS THE GUARD NOW

describe('the loan create path applies the same guard as every other write', () => {
  test('a crafted create can no longer plant cash_amount / online_amount', async () => {
    const env = loanEnv();
    // Proven on `main`: this stored cash_amount=30000 and online_amount=20000, so a loan
    // showed money as paid out without ever being Approved, let alone disbursed.
    await assert.rejects(
      () => saveLoanTransaction(env, LOAN({ cash_amount: 30000, online_amount: 20000 }), GUARANTORS(), SUPER),
      /set by the server/);
    const { n } = await env.DB_LOANS_EXPENSES.prepare('SELECT COUNT(*) AS n FROM loans').first();
    assert.equal(n, 0, 'nothing may be written when the payload is refused');
  });

  test('and cannot re-attribute the row or preset its status', async () => {
    const env = loanEnv();
    for (const over of [{ created_by: 'SOMEONE-ELSE' }, { loan_status: 'Disbursed' }, { loan_id: 'LN-mine' }, { id: 1 }]) {
      await assert.rejects(() => saveLoanTransaction(env, LOAN(over), GUARANTORS(), SUPER), /set by the server/,
        `${Object.keys(over)[0]} must be refused`);
    }
  });

  test('a guarantor payload is guarded too', async () => {
    const env = loanEnv();
    const g = GUARANTORS();
    g[1].created_by = 'SOMEONE-ELSE';
    await assert.rejects(() => saveLoanTransaction(env, LOAN(), g, SUPER), /set by the server/);
  });

  test('the ORDINARY create still works, and the server stamps its own three columns', async () => {
    // The guard runs before the server assigns Created By / Loan ID / Loan Status, so it
    // must not have broken the normal path.
    const env = loanEnv();
    const res = await saveLoanTransaction(env, LOAN({ 'Final Repayment Date': '2027-03-01', Status: 'Active' }), GUARANTORS(), SUPER);
    assert.equal(res.success, true);
    const row = await env.DB_LOANS_EXPENSES
      .prepare('SELECT created_by, loan_status, loan_id, cash_amount, online_amount FROM loans ORDER BY id DESC LIMIT 1').first();
    assert.equal(row.created_by, 'USER0001', 'stamped from the session');
    assert.equal(row.loan_status, 'Created');
    assert.match(row.loan_id || '', /.+/, 'a loan id was allocated');
    assert.ok(!row.cash_amount, 'no money is recorded as paid out at create time');
    assert.ok(!row.online_amount);
    const { n } = await env.DB_LOANS_EXPENSES.prepare('SELECT COUNT(*) AS n FROM loan_guarantors').first();
    assert.equal(n, 3, 'all three guarantors are still written');
  });
});
