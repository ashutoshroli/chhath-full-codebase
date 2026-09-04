// ======== AUDIT H-17 / H-18 — the on-stage Announce screen ========
//
// H-17: the PIN-failure lockout was keyed on the LINK TOKEN alone
//       (`'announcepinfail:' + token`). The token IS the shared URL — WhatsApped
//       around the committee and read off a phone on stage. So any holder of the
//       link could type five wrong PINs and lock the announce screen for
//       EVERYBODY for fifteen minutes, from anywhere, needing no credential.
//       During a live announcement that is a denial of service on the event.
//       Also: the PIN was not required to be numeric despite the message saying
//       "digits", and the plaintext PIN was echoed back in the create response.
//
// H-18: markAnnounced read the counter and then wrote `count + 1` — but the
//       announce screen is used by several people at once on one link, which is
//       its whole purpose. It also reported success for an item that did not
//       exist, and never checked that the item belonged to the session's year.
//       reannounceAll used `session.year` raw, so a year that round-tripped
//       through KV as a string matched nothing and the reset silently did
//       nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import {
  generateAnnouncementLink, verifyAnnouncementPin, markAnnounced, reannounceAll,
} from '../src/announcements.js';

const ADMIN = { name: 'USER0001', role: 'Superadmin' };
const PIN = '135790';

function makeEnv() {
  return {
    DB_MISC: makeD1(schemaFor('misc.sql')),
    DB_COLLECTIONS: makeD1(schemaFor('collections.sql')),
    DB_CORE: makeD1(schemaFor('core.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    KV_SESSIONS: makeKV(),
  };
}

const IP_A = '203.0.113.10';
const IP_B = '198.51.100.20';

async function makeLink(env, year = 2026) {
  const res = await generateAnnouncementLink(env, year, PIN, null, ADMIN);
  return res.token;
}

async function seedCollections(env, year, n) {
  const ids = [];
  for (let i = 1; i <= n; i++) {
    const r = await env.DB_COLLECTIONS
      .prepare('INSERT INTO collections (year, sl_no, name, amount, announced, announcedcount) VALUES (?,?,?,?,?,?)')
      .bind(year, i, `Donor ${i}`, 100 * i, '0', 0).run();
    ids.push(r.meta.last_row_id);
  }
  return ids;
}

const countOf = async (env, id) => parseInt(
  await env.DB_COLLECTIONS.prepare('SELECT announcedcount FROM collections WHERE id = ?').bind(id).first('announcedcount')
) || 0;

// ============================================ H-17.1 THE LOCKOUT DoS

test('H-17: one device burning its attempts does NOT lock anybody else out', async () => {
  const env = makeEnv();
  const token = await makeLink(env);

  // A hostile (or just clumsy) link-holder exhausts their five attempts.
  for (let i = 0; i < 5; i++) {
    const r = await verifyAnnouncementPin(env, token, '000000', IP_A);
    assert.equal(r.success, false);
    assert.equal(r.message, 'Incorrect PIN', `attempt ${i + 1} is a plain rejection`);
  }
  const locked = await verifyAnnouncementPin(env, token, '000000', IP_A);
  assert.match(locked.message, /Too many incorrect attempts from this device/);
  assert.match(locked.message, /15 minutes/, 'the message says how long');

  // THE ASSERTION THAT FAILS ON `main`: the announcer on stage, on a different
  // device, is locked out there too.
  const onStage = await verifyAnnouncementPin(env, token, PIN, IP_B);
  assert.equal(onStage.success, true, 'the real announcer can still get in');
  assert.ok(onStage.announceToken, 'and gets a working session');
  assert.equal(onStage.year, 2026);
});

test('H-17 proof: the OLD token-only key locks every device at once', async () => {
  const env = makeEnv();
  const token = await makeLink(env);

  // Replay what `main` did: one counter for the whole link.
  const oldLockKey = 'announcepinfail:' + token;
  for (let i = 0; i < 5; i++) {
    const fails = parseInt((await env.KV_SESSIONS.get(oldLockKey)) || '0');
    await env.KV_SESSIONS.put(oldLockKey, String(fails + 1), { expirationTtl: 900 });
  }
  const fails = parseInt(await env.KV_SESSIONS.get(oldLockKey));
  assert.equal(fails, 5, 'five failures from ONE device...');

  // ...and under the old key that value is what EVERY other device would read,
  // because nothing in the key distinguishes them. The new key does:
  assert.equal(await env.KV_SESSIONS.get(`announcepinfail:${token}:${IP_B}`), null,
    'the on-stage device has its own, untouched counter');
});

test('H-17: the per-device counter is cleared on a successful PIN', async () => {
  const env = makeEnv();
  const token = await makeLink(env);
  await verifyAnnouncementPin(env, token, 'wrong1', IP_A);
  await verifyAnnouncementPin(env, token, 'wrong2', IP_A);
  assert.equal(await env.KV_SESSIONS.get(`announcepinfail:${token}:${IP_A}`), '2');

  const ok = await verifyAnnouncementPin(env, token, PIN, IP_A);
  assert.equal(ok.success, true);
  assert.equal(await env.KV_SESSIONS.get(`announcepinfail:${token}:${IP_A}`), null,
    'a fumbled-then-correct entry does not leave the device half-locked');
});

test('H-17: with no edge IP available the gate still applies (falls back, never opens)', async () => {
  const env = makeEnv();
  const token = await makeLink(env);
  for (let i = 0; i < 5; i++) await verifyAnnouncementPin(env, token, '000000', '');
  const locked = await verifyAnnouncementPin(env, token, '000000', '');
  assert.match(locked.message, /Too many incorrect attempts/, 'local dev / odd proxy is gated, not ungated');
  assert.equal(await env.KV_SESSIONS.get('announcepinfail:' + token), '5', 'via the token-only key');
});

test('H-17: brute force from one device still costs at most 5 KV writes per window', async () => {
  const env = makeEnv();
  const token = await makeLink(env);
  const before = env.KV_SESSIONS._writeOps();

  for (let i = 0; i < 25; i++) await verifyAnnouncementPin(env, token, '000000', IP_A);

  // 25 attempts, but only the first 5 get past the gate and write. KV writes are
  // the tightest free-tier limit (~1,000/day), so this bound matters.
  assert.equal(env.KV_SESSIONS._writeOps() - before, 5);
});

// ================================== H-17.2 NUMERIC PIN, AND NO PIN ECHO

test('H-17: the PIN must be digits — the message always claimed it had to be', async () => {
  const env = makeEnv();
  await assert.rejects(() => generateAnnouncementLink(env, 2026, 'chhath', null, ADMIN),
    /must be digits only/);
  await assert.rejects(() => generateAnnouncementLink(env, 2026, '12 34 56', null, ADMIN),
    /must be digits only/);
  await assert.rejects(() => generateAnnouncementLink(env, 2026, '1234', null, ADMIN),
    /at least 6 digits/, 'the length rule still fires first');

  const ok = await generateAnnouncementLink(env, 2026, '  135790  ', null, ADMIN);
  assert.equal(ok.success, true, 'a padded numeric PIN is accepted and trimmed');
  assert.equal((await verifyAnnouncementPin(env, ok.token, '135790', IP_A)).success, true);
});

test('H-17: the create response no longer carries the plaintext PIN', async () => {
  const env = makeEnv();
  const res = await generateAnnouncementLink(env, 2026, PIN, null, ADMIN);

  assert.equal(res.pin, undefined, 'the live PIN does not travel back');
  assert.ok(!JSON.stringify(res).includes(PIN), 'and is nowhere in the body');
  assert.ok(res.token, 'the token — which is what the caller needs — is still returned');

  // It was stored hashed, not in the clear, before and after.
  const stored = await env.DB_MISC.prepare('SELECT pin FROM announcement_links WHERE token = ?').bind(res.token).first('pin');
  assert.ok(!stored.includes(PIN));
  assert.equal((await verifyAnnouncementPin(env, res.token, PIN, IP_A)).success, true, 'and still verifies');
});

test('H-17 regression guard: revoked and expired links are still refused', async () => {
  const env = makeEnv();
  const revoked = await makeLink(env);
  await env.DB_MISC.prepare('UPDATE announcement_links SET active = 0 WHERE token = ?').bind(revoked).run();
  const r1 = await verifyAnnouncementPin(env, revoked, PIN, IP_A);
  assert.equal(r1.success, false);
  assert.equal(r1.expired, true);

  const expired = await generateAnnouncementLink(env, 2026, PIN, '2020-01-01T00:00:00.000Z', ADMIN);
  const r2 = await verifyAnnouncementPin(env, expired.token, PIN, IP_A);
  assert.equal(r2.expired, true);

  const r3 = await verifyAnnouncementPin(env, 'not-a-real-token', PIN, IP_A);
  assert.equal(r3.message, 'This link is not valid');
});

// ============================== H-18.1 THE COUNTER IS NOW ATOMIC

async function announceSession(env, year = 2026) {
  const token = await makeLink(env, year);
  const r = await verifyAnnouncementPin(env, token, PIN, IP_A);
  assert.equal(r.success, true);
  return r.announceToken;
}

test('H-18: five simultaneous taps on one item produce five increments', async () => {
  const env = makeEnv();
  const [id] = await seedCollections(env, 2026, 1);
  const at = await announceSession(env);

  // Several announcers on the shared link tapping the same row at once. Without
  // awaiting between calls, every read happens before any write — which on `main`
  // collapsed all five into ONE increment.
  await Promise.all([1, 2, 3, 4, 5].map(() => markAnnounced(env, at, id, 'collection')));

  assert.equal(await countOf(env, id), 5, 'the count must not under-report announcements');
});

test('H-18 proof: the OLD read-then-write counter collapses five taps into one', async () => {
  const env = makeEnv();
  const [id] = await seedCollections(env, 2026, 1);

  const oldMark = async () => {
    const row = await env.DB_COLLECTIONS.prepare('SELECT announcedcount FROM collections WHERE id = ?').bind(id).first();
    const currentCount = row ? (parseInt(row.announcedcount) || 0) : 0;
    await env.DB_COLLECTIONS.prepare('UPDATE collections SET announced = 1, announcedcount = ? WHERE id = ?')
      .bind(currentCount + 1, id).run();
    return currentCount + 1;
  };
  const reported = await Promise.all([1, 2, 3, 4, 5].map(oldMark));

  assert.deepEqual(reported, [1, 1, 1, 1, 1], 'all five callers were told "announced once"');
  assert.equal(await countOf(env, id), 1, 'and the stored count only moved by one');
});

test('H-18: the returned count is the value actually stored', async () => {
  const env = makeEnv();
  const [id] = await seedCollections(env, 2026, 1);
  const at = await announceSession(env);

  assert.equal((await markAnnounced(env, at, id, 'collection')).announcedCount, 1);
  assert.equal((await markAnnounced(env, at, id, 'collection')).announcedCount, 2);
  assert.equal(await countOf(env, id), 2);

  const flag = await env.DB_COLLECTIONS.prepare('SELECT announced FROM collections WHERE id = ?').bind(id).first('announced');
  assert.equal(flag, '1', "the flag is stored as the TEXT '1' the column holds, so isTruthyFlag reads it");
});

test('H-18: a NULL starting count increments to 1 rather than to NaN', async () => {
  const env = makeEnv();
  const r = await env.DB_COLLECTIONS
    .prepare('INSERT INTO collections (year, name, announcedcount) VALUES (?,?,NULL)').bind(2026, 'Legacy').run();
  const at = await announceSession(env);
  assert.equal((await markAnnounced(env, at, r.meta.last_row_id, 'collection')).announcedCount, 1);
});

test('H-18: custom announcements increment atomically too', async () => {
  const env = makeEnv();
  await env.DB_MISC.prepare(
    'INSERT INTO custom_announcements (id_code, year, texthindi, announced, announcedcount, "order") VALUES (?,?,?,?,?,?)'
  ).bind('CA-1', 2026, 'नमस्ते', '0', 0, 1).run();
  const at = await announceSession(env);

  await Promise.all([1, 2, 3].map(() => markAnnounced(env, at, 'CA-1', 'custom')));
  const n = await env.DB_MISC.prepare('SELECT announcedcount FROM custom_announcements WHERE id_code = ?')
    .bind('CA-1').first('announcedcount');
  assert.equal(parseInt(n), 3);
});

// ====================== H-18.2 A MISSING ITEM NO LONGER REPORTS SUCCESS

test('H-18: marking an item that does not exist is an error, not a silent success', async () => {
  const env = makeEnv();
  const at = await announceSession(env);

  // On `main` both of these returned { success: true, announcedCount: 1 } while
  // updating nothing at all, so the screen ticked an item off that was never
  // recorded as announced.
  for (const [id, type] of [[9999, 'collection'], ['CA-nope', 'custom']]) {
    const e = await markAnnounced(env, at, id, type).then(() => null, x => x);
    assert.ok(e, `${type} ${id} must be refused`);
    assert.equal(e.expected, true, 'as a user-facing message (400), not a logged 500');
    assert.match(e.message, /Item not found/);
  }
});

// ============================ H-18.3 THE SESSION'S YEAR IS ENFORCED

test('H-18: a 2025 announce link cannot mark 2026 items announced', async () => {
  const env = makeEnv();
  const [id2026] = await seedCollections(env, 2026, 1);
  const at2025 = await announceSession(env, 2025);

  // On `main` the UPDATE addressed the row by id alone, so this succeeded — and
  // reannounceAll (which IS year-scoped) could then never reset it.
  const e = await markAnnounced(env, at2025, id2026, 'collection').then(() => null, x => x);
  assert.ok(e, 'refused');
  assert.match(e.message, /Item not found/);
  assert.equal(await countOf(env, id2026), 0, 'the other year\'s row is untouched');
});

// ================== H-18.4 reannounceAll ACTUALLY RESETS (THE YEAR COERCION)

// NOTE: this one is a REGRESSION GUARD, not a fix — it passes before and after.
// I originally believed a year stored as the string '2026' would fail to match a
// REAL column and make the reset a silent no-op. That is wrong: SQLite applies the
// column's affinity to the comparison operand, so '2026' matches 2026.0. Verified
// directly against node:sqlite. The guard stays because parseInt() must not change
// that behaviour; the real defect is the empty/NULL year, covered further down.
test('H-18 guard: reannounceAll still resets when the stored year is a string', async () => {
  const env = makeEnv();
  const ids = await seedCollections(env, 2026, 3);
  await env.DB_MISC.prepare(
    'INSERT INTO custom_announcements (id_code, year, texthindi, announced, announcedcount, "order") VALUES (?,?,?,?,?,?)'
  ).bind('CA-1', 2026, 'नमस्ते', '1', 2, 1).run();

  const at = await announceSession(env);
  for (const id of ids) await markAnnounced(env, at, id, 'collection');
  assert.equal(await countOf(env, ids[0]), 1);

  // The year arriving from KV as a STRING, which announcement_links.year (a REAL
  // column bound from a form field) can yield.
  const raw = JSON.parse(await env.KV_SESSIONS.get('announce:' + at));
  await env.KV_SESSIONS.put('announce:' + at, JSON.stringify({ ...raw, year: '2026' }));

  const res = await reannounceAll(env, at, 'All');
  assert.equal(res.success, true);

  for (const id of ids) assert.equal(await countOf(env, id), 0, 'every collection really was reset');
  const c = await env.DB_MISC.prepare('SELECT announced, announcedcount FROM custom_announcements WHERE id_code = ?')
    .bind('CA-1').first();
  assert.equal(parseInt(c.announcedcount), 0);
});

test('H-18: reannounceAll leaves other years alone', async () => {
  const env = makeEnv();
  const y2026 = await seedCollections(env, 2026, 2);
  const y2025 = await seedCollections(env, 2025, 2);
  const at = await announceSession(env, 2026);
  for (const id of y2026) await markAnnounced(env, at, id, 'collection');

  // Mark 2025's rows directly (a 2026 session may no longer touch them).
  for (const id of y2025) {
    await env.DB_COLLECTIONS.prepare("UPDATE collections SET announced = '1', announcedcount = 4 WHERE id = ?")
      .bind(id).run();
  }

  await reannounceAll(env, at, 'All');
  for (const id of y2026) assert.equal(await countOf(env, id), 0);
  for (const id of y2025) assert.equal(await countOf(env, id), 4, '2025 is untouched');
});

// THIS is the real year defect. `announcement_links.year` is nullable, so a link
// created with a blank year puts `year: null` into the KV session, and
// `WHERE year = NULL` matches nothing — every comparison with NULL is NULL. On
// `main` "Reannounce all" then reset ZERO rows and still returned success: the
// operator saw the action confirmed while the list stayed fully announced, with no
// way to discover why.
test('H-18: a session with an empty/NULL year is refused, not silently a no-op', async () => {
  const env = makeEnv();
  const ids = await seedCollections(env, 2026, 2);
  const at = await announceSession(env);
  for (const id of ids) await markAnnounced(env, at, id, 'collection');

  for (const badYear of [null, '', undefined]) {
    await env.KV_SESSIONS.put('announce:' + at, JSON.stringify({ year: badYear, linkToken: 'x' }));
    const e = await reannounceAll(env, at, 'All').then(() => null, x => x);
    assert.ok(e, `year ${JSON.stringify(badYear)} must be refused, not reported as done`);
    assert.equal(e.expected, true, 'a user-facing message (400), not a logged 500');
    assert.match(e.message, /no year/);
    // ...and the operator's data is left exactly as it was, not half-reset.
    assert.equal(await countOf(env, ids[0]), 1);

    await assert.rejects(() => markAnnounced(env, at, ids[0], 'collection'), /no year/);
  }
});

test('H-18 regression guard: an expired announce session is still rejected', async () => {
  const env = makeEnv();
  const at = await announceSession(env);
  await env.KV_SESSIONS.delete('announce:' + at);

  for (const call of [
    () => markAnnounced(env, at, 1, 'collection'),
    () => reannounceAll(env, at, 'All'),
  ]) {
    const e = await call().then(() => null, x => x);
    assert.equal(e.announceSessionExpired, true, 'mapped to the PIN re-entry prompt, not a generic error');
  }
});

// ============================================================ FREE TIER

test('H-18: markAnnounced still costs two D1 statements', async () => {
  const env = makeEnv();
  const [id] = await seedCollections(env, 2026, 1);
  const at = await announceSession(env);

  let statements = 0;
  const real = env.DB_COLLECTIONS.prepare.bind(env.DB_COLLECTIONS);
  env.DB_COLLECTIONS.prepare = (sql) => { statements++; return real(sql); };

  await markAnnounced(env, at, id, 'collection');
  // Before: SELECT count + UPDATE = 2. After: UPDATE (inline +1) + SELECT = 2.
  assert.equal(statements, 2, 'the removed read pays for the read-back');
});
