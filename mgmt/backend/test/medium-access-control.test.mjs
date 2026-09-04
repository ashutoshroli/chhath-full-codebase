// ============ AUDIT M-1..M-3, M-5..M-8, M-11 (+ H-7 guard) ============
//
// The Medium-severity access-control and input-validation batch. Individually
// small; together they are most of what is left between "the four Criticals are
// fixed" and "a Subadmin cannot read things they have no business reading".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { withApiKey, PermissionError } from '../src/auth.js';
import { getTemplates, getTemplate, getReceiptData, getCertificateData, getSamaanData } from '../src/templates.js';
import { getRecordsForDocType } from '../src/docxTemplates.js';
import { savePopup, getPopupWithSlides } from '../src/popups.js';
import { updateOwnProfile } from '../src/account.js';
import { getOrCreateFolder } from '../src/drive.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };
const ADMIN = { name: 'USER0002', role: 'Admin' };
const SUBADMIN = { name: 'USER0003', role: 'Subadmin' };
const ROLES = { Superadmin: SUPERADMIN, Admin: ADMIN, Subadmin: SUBADMIN };

function makeEnv() {
  const core = makeD1(schemaFor('core.sql'));
  for (const [code, name] of [['USER0001', 'Ram'], ['USER0002', 'Shyam'], ['USER0003', 'Gita']]) {
    core.prepare('INSERT INTO users (id_code, name, mobile, email, whatsapp) VALUES (?,?,?,?,?)')
      .bind(code, name, 9800000001, `${code.toLowerCase()}@b.test`, 9800000001).run();
  }
  // All three sat on the 2026 committee, so requireYearAccess passes for each and
  // the ROLE gate is the only thing under test.
  for (const name of ['USER0001', 'USER0002', 'USER0003']) {
    core.prepare('INSERT INTO committee_members (year, name) VALUES (?,?)').bind(2026, name).run();
  }

  const collections = makeD1(schemaFor('collections.sql'));
  collections.prepare('INSERT INTO collections (year, sl_no, name, amount, certificate_or_receipt) VALUES (?,?,?,?,?)')
    .bind(2026, 1, 'USER0001', 501, 'Receipt').run();

  const templates = makeD1(schemaFor('templates.sql'));
  templates.prepare('INSERT INTO receipt_templates (year, template_text, page_size) VALUES (?,?,?)')
    .bind(2026, 'Receipt for {{NAME}} — {{AMOUNT}}', 'A5').run();

  return {
    DB_CORE: core,
    DB_COLLECTIONS: collections,
    DB_TEMPLATES: templates,
    DB_MISC: makeD1(schemaFor('misc.sql')),
    DB_FILE_INDEX: makeD1(schemaFor('file_index.sql')),
    DB_LOANS_EXPENSES: makeD1(schemaFor('loans_expenses.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    KV_SESSIONS: makeKV(),
  };
}

const refuses = async (fn) => {
  const e = await Promise.resolve().then(fn).then(() => null, x => x);
  assert.ok(e, 'the call must be refused');
  return e;
};

// ============================================ M-1 / M-2: ROUTE-LEVEL GATES

// The six template read actions had NO role argument at all:
//     getReceiptTemplates: () => withAuth(env, req, () => tpl.getTemplates(...))
// Asserted structurally, because the gate lives in the router table rather than in
// the module, and that table is exactly where it kept being forgotten.
test('M-1: every template read action now names a role gate', () => {
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const ACTIONS = [
    'getReceiptTemplates', 'getReceiptTemplate',
    'getCertificateTemplates', 'getCertificateTemplate',
    'getSamaanTemplates', 'getSamaanTemplate',
  ];
  for (const action of ACTIONS) {
    const line = src.split('\n').find(l => l.trimStart().startsWith(`${action}: `));
    assert.ok(line, `${action} must still be routed`);
    assert.match(line, /require(Superadmin|AdminOrAbove|StaffRole)\(user\)/,
      `${action} has no role gate: ${line.trim()}`);
  }
});

// A handler written as `withAuth(env, req, () => ...)` takes no `user`, so it
// cannot possibly check a role itself. Six of those were the M-1 bug. The rest are
// fine, but only because of a coupling that is easy to break: they are all in
// CACHEABLE_ACTIONS, and the pre-cache block (index.js, the H-1 fix) applies
// requireStaffRole to every cacheable action before the cache is consulted.
//
// This test pins that coupling. If someone removes an action from
// CACHEABLE_ACTIONS — a perfectly reasonable performance decision — its only role
// check disappears with it, silently. That is the failure this catches.
test('M-1: every ungated handler is covered by the pre-cache role gate', () => {
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

  const cacheableBlock = src.slice(
    src.indexOf('const CACHEABLE_ACTIONS = {'),
    src.indexOf('};', src.indexOf('const CACHEABLE_ACTIONS = {'))
  );
  const cacheable = [...cacheableBlock.matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]);
  assert.ok(cacheable.length > 5, `parsed CACHEABLE_ACTIONS (${cacheable.length} entries)`);

  // The pre-cache gate must actually be there, or the argument above is void.
  const preCache = src.slice(src.indexOf('const cacheParamFn = CACHEABLE_ACTIONS[action]'));
  assert.match(preCache.slice(0, 2000), /requireStaffRole\(authedUser\)/,
    'the pre-cache role gate is what covers these actions — it must not be removed');

  const ungated = src.split('\n')
    .filter(l => /withAuth\(env, req, \(\) =>/.test(l) && /^\s+\w+:/.test(l))
    .map(l => l.trim().split(':')[0]);
  assert.ok(ungated.length > 0, 'sanity: some ungated handlers still exist');

  for (const action of ungated) {
    assert.ok(cacheable.includes(action),
      `${action} takes no \`user\` AND is not in CACHEABLE_ACTIONS, so nothing checks its role. `
      + 'Either add an explicit gate to the handler or put it back in CACHEABLE_ACTIONS.');
  }
});

test('M-2: getRecordsForDocType is Superadmin-only (it returns every contributor\'s MOBILE)', async () => {
  const env = makeEnv();

  for (const role of ['Admin', 'Subadmin']) {
    const e = await refuses(() => getRecordsForDocType(env, 'receipt', 2026, ROLES[role]));
    assert.equal(e.permission, true, `${role} -> 403`);
  }
  // On the baseline both of those RESOLVED, returning the year's full placeholder
  // set including MOBILE for every contributor.
  const ok = await getRecordsForDocType(env, 'receipt', 2026, SUPERADMIN);
  assert.ok(Array.isArray(ok), 'a Superadmin still gets the list');
});

// ================================================== M-3: STAFF, NOT SUPERADMIN

// These three are the counter-example, and the reason M-2 and M-3 got different
// gates: Home.jsx's receipt modal calls them for EVERY role, so raising them to
// Superadmin would break the Home screen for Admins and Subadmins.
test('M-3: the receipt/certificate/material readers are gated to staff, and still work for all three roles', async () => {
  const env = makeEnv();
  for (const fn of [getReceiptData, getCertificateData, getSamaanData]) {
    for (const role of ['Superadmin', 'Admin', 'Subadmin']) {
      const res = await fn(env, 1, 2026, ROLES[role]);
      assert.ok(res && typeof res === 'object', `${fn.name} must still work for ${role}`);
    }
    // A legacy free-text role is refused. USER0002 IS on the 2026 committee, so
    // requireYearAccess would let them through — the ROLE gate has to be what
    // stops them, otherwise this assertion passes for the wrong reason (it did,
    // against the baseline, when the name was not a committee member).
    const e = await refuses(() => fn(env, 1, 2026, { name: 'USER0002', role: 'Member' }));
    assert.equal(e.permission, true, `${fn.name} refuses an unknown role`);
    assert.match(e.message, /role \(Member\)/, 'refused by requireStaffRole, not by the year check');
  }
});

test('M-3 regression guard: the Superadmin-only template list is still Superadmin-only', async () => {
  const env = makeEnv();
  // getTemplates/getTemplate themselves take no user — the gate is in the router
  // (asserted above). Confirm they still return data so the gate is the only change.
  assert.ok(Array.isArray(await getTemplates(env, 'receipt')));
  assert.ok(await getTemplate(env, 'receipt', 2026));
});

// ============================================ M-6: API KEY TIMING / LENGTH LEAK

test('M-6: a correct API key is accepted, a wrong one is refused', async () => {
  const env = { WHATSAPP_QUEUE_API_KEY: 'the-real-queue-key-0123456789' };
  assert.equal(await withApiKey(env, { apiKey: 'the-real-queue-key-0123456789' }, () => 'ran'), 'ran');

  for (const bad of ['', undefined, null, 'x', 'the-real-queue-key-012345678', 'the-real-queue-key-01234567890']) {
    const e = await refuses(() => withApiKey(env, { apiKey: bad }, () => 'ran'));
    assert.equal(e.permission, true, `${JSON.stringify(bad)} -> 403`);
    assert.equal(e.message, 'Invalid API key', 'and the message never varies with the input');
  }
});

test('M-6: the compared values are a fixed length regardless of the supplied key', async () => {
  // The point of the fix. Previously both sides were hex-encoded PLAINTEXT, so the
  // comparison loop ran max(len(supplied), len(real)) times and an attacker could
  // time the endpoint to learn the real key's length before guessing its content.
  // Hashing first makes both sides 64 hex chars for any input.
  const sha256Hex = async (s) => {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
  };
  for (const key of ['a', 'x'.repeat(500), 'the-real-queue-key-0123456789']) {
    assert.equal((await sha256Hex(key)).length, 64, `${key.length}-char input -> 64 hex chars`);
  }

  const src = readFileSync(new URL('../src/auth.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export async function withApiKey'));
  assert.ok(/sha256Hex\(req\.apiKey/.test(body), 'the supplied key is hashed before comparison');
  assert.ok(!/charCodeAt/.test(body.slice(0, body.indexOf('return fn()'))),
    'the old hex-encode-the-plaintext path is gone');
});

test('M-6: a missing server-side key refuses everything (never opens)', async () => {
  const e = await refuses(() => withApiKey({}, { apiKey: 'anything' }, () => 'ran'));
  assert.equal(e.permission, true);
});

// ==================================================== M-7: POPUP ROLE TYPOS

test('M-7: a mistyped audience is rejected instead of silently hiding the popup', async () => {
  const env = makeEnv();
  for (const bad of ['SuperAdmin', 'admin', 'Superadmin,Editor', ['Admin', 'Moderator']]) {
    const e = await refuses(() => savePopup(env, null, 'Notice', bad, true, '', '', SUPERADMIN));
    assert.equal(e.expected, true, `${JSON.stringify(bad)} -> a user-facing 400`);
    assert.match(e.message, /Unknown audience/);
    assert.match(e.message, /Superadmin, Admin, Subadmin, Public/, 'the message lists what IS allowed');
  }
  assert.equal(
    await env.DB_MISC.prepare('SELECT COUNT(*) AS n FROM popups').first('n'), 0,
    'no popup was created by any of the rejected attempts'
  );
});

test('M-7: valid audiences are accepted, trimmed and de-duplicated', async () => {
  const env = makeEnv();
  const { popup_id: id } = await savePopup(env, null, 'Notice', ' Admin , Superadmin , Admin ', true, '', '', SUPERADMIN);
  const { popup } = await getPopupWithSlides(env, id, SUPERADMIN);
  assert.equal(popup.roles, 'Admin,Superadmin', 'trimmed and de-duplicated');

  // 'Public' is a valid audience even though it is not a login role — it is what
  // the anonymous portal matches on.
  const pub = await savePopup(env, null, 'Public notice', ['Public'], true, '', '', SUPERADMIN);
  assert.equal((await getPopupWithSlides(env, pub.popup_id, SUPERADMIN)).popup.roles, 'Public');

  // Empty stays empty and means "everyone", which both readers already rely on.
  const all = await savePopup(env, null, 'Everyone', '', true, '', '', SUPERADMIN);
  assert.equal((await getPopupWithSlides(env, all.popup_id, SUPERADMIN)).popup.roles, '');
});

test('M-7: an EDIT cannot smuggle a bad audience in either', async () => {
  const env = makeEnv();
  const { popup_id: id } = await savePopup(env, null, 'Notice', 'Admin', true, '', '', SUPERADMIN);
  await refuses(() => savePopup(env, id, 'Notice', 'Admn', true, '', '', SUPERADMIN));
  assert.equal((await getPopupWithSlides(env, id, SUPERADMIN)).popup.roles, 'Admin', 'the stored value is untouched');
});

// ================================================= M-8: PROFILE EMAIL VALIDATION

test('M-8: updateOwnProfile validates Email the way it already validated Mobile', async () => {
  const env = makeEnv();
  const me = { name: 'USER0001', role: 'Subadmin' };

  for (const bad of ['not-an-email', 'a@b', 'a b@c.test', '@b.test']) {
    const e = await refuses(() => updateOwnProfile(env, { Email: bad }, me));
    assert.equal(e.expected, true, `${bad} -> 400`);
    assert.match(e.message, /valid Email/);
  }
  // Baseline: every one of those was written straight into the column.
  assert.equal(
    await env.DB_CORE.prepare('SELECT email FROM users WHERE id_code = ?').bind('USER0001').first('email'),
    'user0001@b.test', 'the stored address is unchanged by the rejected attempts'
  );

  await updateOwnProfile(env, { Email: 'ram.kumar@example.test' }, me);
  assert.equal(
    await env.DB_CORE.prepare('SELECT email FROM users WHERE id_code = ?').bind('USER0001').first('email'),
    'ram.kumar@example.test', 'a valid address still saves'
  );
});

test('M-8: clearing the email is still allowed, and Mobile/WhatsApp rules are unchanged', async () => {
  const env = makeEnv();
  const me = { name: 'USER0001', role: 'Subadmin' };

  await updateOwnProfile(env, { Email: '' }, me);
  assert.equal(
    await env.DB_CORE.prepare('SELECT email FROM users WHERE id_code = ?').bind('USER0001').first('email'), '',
    'a blank email is a deliberate clear, not a validation failure'
  );

  const e = await refuses(() => updateOwnProfile(env, { Mobile: '12345' }, me));
  assert.match(e.message, /must be 10 digits/);
});

// ================================================ M-11: DRIVE SEARCH INJECTION

test('M-11: a folder name that could alter the Drive query is refused before any request', async () => {
  let driveCalls = 0;
  const env = {
    DRIVE_OAUTH_CLIENT_ID: 'x', DRIVE_OAUTH_CLIENT_SECRET: 'y', DRIVE_OAUTH_REFRESH_TOKEN: 'z',
    KV_SESSIONS: makeKV(),
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { driveCalls++; throw new Error('no network in tests'); };
  try {
    for (const bad of [
      "x' and '1'='1",                 // closes the quoted literal
      "y' or trashed=true and name='", // injects a clause
      'a'.repeat(81),                  // absurd length
      '',                              // empty
      'na/me',                         // path separator
    ]) {
      const e = await refuses(() => getOrCreateFolder(env, 'parent-id', bad));
      assert.match(e.message, /unsafe Drive folder name/, `${JSON.stringify(bad)} refused`);
      assert.match(e.userMessage, /Nothing was uploaded/, 'and the operator is told nothing happened');
    }
    assert.equal(driveCalls, 0, 'not one Drive request was issued for any of them');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('M-11: the names the app actually uses are all still allowed', async () => {
  const src = readFileSync(new URL('../src/drive.js', import.meta.url), 'utf8');
  const re = new RegExp(src.match(/const SAFE_DRIVE_FOLDER_NAME = (\/.*\/);/)[1].slice(1, -1));
  // Every literal/derived folder name in the codebase today.
  for (const good of ['2026', 'consent', 'receipts', 'Chhath Puja 2026', 'docx_templates', 'loan-consents', 'PDF (final)']) {
    assert.ok(re.test(good), `${good} must remain valid`);
  }
});

// ============================================ M-5: THE FABRICATED SUPERADMIN

test('M-5: the queue no longer runs jobs as a fabricated Superadmin', () => {
  const src = readFileSync(new URL('../src/collectionQueue.js', import.meta.url), 'utf8');
  const line = src.split('\n').find(l => l.includes('const systemUser ='));
  assert.ok(line, 'the system user is still constructed here');
  assert.ok(!/role: 'Superadmin'/.test(line),
    `the cron must not claim Superadmin: ${line.trim()}`);
  assert.match(line, /role: 'Subadmin'/, 'it claims the lowest role that satisfies requireStaffRole');
  assert.match(line, /system: true/, 'and keeps the marker a future gate can branch on');
});

// ============================================== H-7 GUARD (fixed earlier; keep it fixed)

test('H-7 guard: uploadFile is still gated to Admin or above', () => {
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const line = src.split('\n').find(l => l.trimStart().startsWith('uploadFile: '));
  assert.ok(line, 'the action still exists');
  assert.match(line, /requireAdminOrAbove\(user\)/,
    'without this, any authenticated caller can push arbitrary bytes to the committee Drive folder');
});
