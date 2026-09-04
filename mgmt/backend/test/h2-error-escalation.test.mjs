// ============ AUDIT H-2 — error escalation has never worked ============
//
// reportErrorToWhatsApp() filtered committee rows on `m.Role`, but
// committee_members has NO `role` column (it is `view_role`, surfaced by
// fromColumnRow as 'View Role'). The filter therefore always produced an empty
// array and every call threw
//     'No Superadmin WhatsApp/Mobile number is registered in USERS.'
// regardless of whether a number was on file. The "Report this to Superadmin"
// button on the PUBLIC Consent and Announce pages has never delivered anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { reportErrorToWhatsApp } from '../src/errorLog.js';

function makeEnv({ committeeRole = 'Superadmin', withCommittee = true, withLogin = true, mobile = 9876543210 } = {}) {
  const core = makeD1(schemaFor('core.sql'));
  const logs = makeD1(schemaFor('logs.sql'));
  const whatsapp = makeD1(schemaFor('whatsapp_index.sql'));

  core.prepare('INSERT INTO users (id_code, name, village, mobile, whatsapp) VALUES (?,?,?,?,?)')
    .bind('USER0001', 'Committee Head', 'Shaharpura', mobile, null).run();
  core.prepare('INSERT INTO users (id_code, name, village, mobile) VALUES (?,?,?,?)')
    .bind('USER0009', 'Ordinary Member', 'Gardih', 9111111111).run();

  if (withCommittee) {
    core.prepare('INSERT INTO committee_members (year, name, view_role) VALUES (?,?,?)')
      .bind(2026, 'USER0001', committeeRole).run();
    // A non-Superadmin committee member must NOT be messaged.
    core.prepare('INSERT INTO committee_members (year, name, view_role) VALUES (?,?,?)')
      .bind(2026, 'USER0009', 'Member').run();
  }
  if (withLogin) {
    core.prepare('INSERT INTO login_users (name, password, role, updated_at) VALUES (?,?,?,?)')
      .bind('USER0001', 'pbkdf2$x', 'Superadmin', '2026-01-01').run();
  }

  logs.prepare('INSERT INTO error_log (error_id, source, page, message, created_at, reported) VALUES (?,?,?,?,?,?)')
    .bind('ERRTEST1', 'frontend', 'Consent', 'Camera permission denied', '2026-09-04T10:00:00Z', '0').run();

  return { DB_CORE: core, DB_LOGS: logs, DB_WHATSAPP_INDEX: whatsapp, KV_SESSIONS: makeKV() };
}

const queued = async (env) => {
  const { results } = await env.DB_WHATSAPP_INDEX
    .prepare('SELECT mobileno, message, message_type FROM person_messages').all();
  return results;
};

// ------------------------------------------------------------------- THE BUG

test('H-2: an error report is actually delivered to the Superadmin', async () => {
  const env = makeEnv();
  const res = await reportErrorToWhatsApp(env, 'ERRTEST1');
  assert.equal(res.success, true);
  assert.equal(res.sentTo, 1, 'exactly one recipient');

  const msgs = await queued(env);
  assert.equal(msgs.length, 1, 'a WhatsApp message must be queued');
  assert.equal(msgs[0].mobileno, '919876543210', 'normalised to 91XXXXXXXXXX');
  assert.equal(msgs[0].message_type, 'priority');
  assert.match(msgs[0].message, /ERRTEST1/, 'the message carries the error reference');
  assert.match(msgs[0].message, /Camera permission denied/);

  const row = await env.DB_LOGS.prepare("SELECT reported FROM error_log WHERE error_id = 'ERRTEST1'").first();
  assert.equal(String(row.reported), '1', 'the row is claimed so it cannot double-send');
});

test('H-2: the View Role match tolerates casing and stray whitespace', async () => {
  for (const role of ['Superadmin', 'superadmin', 'SUPERADMIN', '  Superadmin  ', 'SuperAdmin']) {
    const env = makeEnv({ committeeRole: role, withLogin: false });
    const res = await reportErrorToWhatsApp(env, 'ERRTEST1');
    assert.equal(res.sentTo, 1, `View Role "${role}" must be recognised`);
  }
});

test('H-2: a non-Superadmin committee member is never messaged', async () => {
  const env = makeEnv({ committeeRole: 'Treasurer', withLogin: false });
  // No committee row says Superadmin and there is no login fallback -> refuse
  // loudly rather than message the wrong person.
  await assert.rejects(() => reportErrorToWhatsApp(env, 'ERRTEST1'),
    /No Superadmin WhatsApp\/Mobile number is registered/);
  assert.equal((await queued(env)).length, 0, 'nobody may be messaged');
});

test('H-2: falls back to the Superadmin LOGIN when no committee row is tagged', async () => {
  // Without this fallback, a committee list that simply never uses the word
  // "Superadmin" in View Role leaves escalation with no recipient — the exact
  // silent failure being fixed. A login row is the authoritative definition.
  const env = makeEnv({ withCommittee: false, withLogin: true });
  const res = await reportErrorToWhatsApp(env, 'ERRTEST1');
  assert.equal(res.sentTo, 1, 'the login fallback must find the Superadmin');
  assert.equal((await queued(env))[0].mobileno, '919876543210');
});

test('H-2: a genuinely missing number still fails loudly, and does not mark the row reported', async () => {
  const env = makeEnv({ mobile: null, withLogin: true });
  await assert.rejects(() => reportErrorToWhatsApp(env, 'ERRTEST1'),
    /No Superadmin WhatsApp\/Mobile number is registered/);
  const row = await env.DB_LOGS.prepare("SELECT reported FROM error_log WHERE error_id = 'ERRTEST1'").first();
  assert.equal(String(row.reported), '0', 'the row must stay unreported so it can be retried');
});

test('H-2: an invalid or REAL-mangled number is rejected, not dialled', async () => {
  for (const mobile of [5876543210, 987654321, 0]) {
    const env = makeEnv({ mobile });
    await assert.rejects(() => reportErrorToWhatsApp(env, 'ERRTEST1'), /No Superadmin/);
  }
  // …but a REAL-affinity artefact of a VALID number must still work: this column
  // is REAL, so a stored 9876543210 can read back as 9876543210.0.
  const env = makeEnv({ mobile: 9876543210.0 });
  const res = await reportErrorToWhatsApp(env, 'ERRTEST1');
  assert.equal(res.sentTo, 1);
  assert.equal((await queued(env))[0].mobileno, '919876543210', 'the .0 artefact must be stripped');
});

test('H-2: duplicate recipients are de-duplicated', async () => {
  const env = makeEnv();
  // The same person tagged Superadmin in three different years.
  for (const year of [2024, 2025]) {
    env.DB_CORE.prepare('INSERT INTO committee_members (year, name, view_role) VALUES (?,?,?)')
      .bind(year, 'USER0001', 'Superadmin').run();
  }
  const res = await reportErrorToWhatsApp(env, 'ERRTEST1');
  assert.equal(res.sentTo, 1, 'one number, not three messages');
  assert.equal((await queued(env)).length, 1);
});

test('H-2: an already-reported error is not sent twice', async () => {
  const env = makeEnv();
  await reportErrorToWhatsApp(env, 'ERRTEST1');
  const second = await reportErrorToWhatsApp(env, 'ERRTEST1');
  assert.equal(second.alreadyReported, true);
  assert.equal((await queued(env)).length, 1, 'still exactly one message');
});

test('H-2: an unknown errorId is refused', async () => {
  const env = makeEnv();
  await assert.rejects(() => reportErrorToWhatsApp(env, 'NOPE'), /Error record not found/);
  await assert.rejects(() => reportErrorToWhatsApp(env, ''), /errorId required/);
});

// -------------------------------------------------------- FREE-TIER: NO SCANS

test('H-2: escalation no longer scans the whole users/committee tables', async () => {
  // This endpoint is UNAUTHENTICATED. It used to read every users row and every
  // committee row into memory to find a handful of numbers, which any anonymous
  // caller could trigger against the shared D1 daily row-read budget.
  const env = makeEnv();
  for (let i = 0; i < 2000; i++) {
    env.DB_CORE.prepare('INSERT INTO users (id_code, name, village, mobile) VALUES (?,?,?,?)')
      .bind(`USER${1000 + i}`, `Member ${i}`, 'Shaharpura', 9000000000 + i).run();
  }
  const sqls = [];
  const realPrepare = env.DB_CORE.prepare;
  env.DB_CORE.prepare = (sql) => { sqls.push(sql.replace(/\s+/g, ' ').trim()); return realPrepare(sql); };

  const res = await reportErrorToWhatsApp(env, 'ERRTEST1');
  assert.equal(res.sentTo, 1, 'still finds the right recipient among 2000+ members');

  // No unbounded read of either table.
  for (const sql of sqls) {
    assert.ok(!/^SELECT \* FROM users ORDER BY id ASC$/i.test(sql), `full users scan: ${sql}`);
    assert.ok(!/^SELECT \* FROM committee_members ORDER BY id ASC$/i.test(sql), `full committee scan: ${sql}`);
  }
  // The users lookup must be a bounded IN (...) by id_code.
  assert.ok(sqls.some(s => /FROM users WHERE id_code IN \(/i.test(s)),
    `expected a bounded IN (...) lookup, got:\n${sqls.join('\n')}`);
  assert.ok(sqls.length <= 4, `expected at most 4 queries, got ${sqls.length}:\n${sqls.join('\n')}`);
});
