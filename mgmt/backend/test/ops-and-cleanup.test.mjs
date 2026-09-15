// ======== AUDIT L-12, L-14, L-15, M-36, M-37, and the dead-code removals ========

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { dayNamesOf } from '../src/settings.js';
import publicWorker from '../../../Public/backend/src/index.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// ==================== L-12: the two day names came from DIFFERENT clocks

// `en` was formatted in Asia/Kolkata; `hi` was indexed by d.getDay(), which is the
// LOCAL weekday — and a Cloudflare Worker runs in UTC. So any timestamp from 18:30
// UTC onwards is already the next day in IST and the two names disagreed by one.
//
// These land on loan consent documents (FINAL_REPAYMENT_DAY_NAME,
// NAHAY_KHAY_DAY_NAME, CHHATH_MORNING_ARGHYA_DAY_NAME, DIWALI_NEXT_DAY_DAY_NAME)
// that the loaner and three guarantors sign. "Monday / रविवार" is not cosmetic.
const OLD_WEEKDAY_HI = ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];
const oldDayNames = (dateStr) => {
  const d = new Date(dateStr);
  return {
    en: d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' }),
    hi: OLD_WEEKDAY_HI[d.getDay()],
  };
};

const EN_TO_HI = {
  Sunday: 'रविवार', Monday: 'सोमवार', Tuesday: 'मंगलवार', Wednesday: 'बुधवार',
  Thursday: 'गुरुवार', Friday: 'शुक्रवार', Saturday: 'शनिवार',
};

test('L-12 proof: the OLD implementation disagreed with itself after 18:30 UTC', () => {
  // 2026-10-25 is a Sunday in UTC; 20:00 UTC is 01:30 IST on Monday the 26th.
  const broken = oldDayNames('2026-10-25T20:00:00Z');
  assert.equal(broken.en, 'Monday', 'the English name was already IST-correct');
  assert.equal(broken.hi, 'रविवार', 'while the Hindi name was still the UTC day');
  assert.notEqual(EN_TO_HI[broken.en], broken.hi, 'i.e. the document said Monday / Sunday');
});

test('L-12: the two names now always agree, across the whole IST offset window', () => {
  const mismatches = [];
  // Every hour of a day, plus the boundary either side of 18:30 UTC.
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 29, 30, 31, 59]) {
      const iso = `2026-10-25T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
      const { en, hi } = dayNamesOf(iso);
      if (EN_TO_HI[en] !== hi) mismatches.push(`${iso}: ${en} / ${hi}`);
    }
  }
  assert.deepEqual(mismatches, [], 'no hour may produce a mismatched pair');
});

test('L-12: and the OLD implementation fails that same sweep', () => {
  let broken = 0;
  for (let h = 0; h < 24; h++) {
    const iso = `2026-10-25T${String(h).padStart(2, '0')}:00:00Z`;
    const { en, hi } = oldDayNames(iso);
    if (EN_TO_HI[en] !== hi) broken++;
  }
  // 18:30 UTC onwards -> 6 whole hours of every day produced a wrong document.
  assert.equal(broken, 5, 'the old code was wrong for 5 of the 24 hourly samples');
});

test('L-12 regression guard: ordinary date strings are unchanged, and junk is still empty', () => {
  assert.deepEqual(dayNamesOf('2026-10-25'), { en: 'Sunday', hi: 'रविवार' });
  assert.deepEqual(dayNamesOf('2026-11-15'), { en: 'Sunday', hi: 'रविवार' });
  assert.deepEqual(dayNamesOf(''), { en: '', hi: '' });
  assert.deepEqual(dayNamesOf('not-a-date'), { en: '', hi: '' });
  assert.deepEqual(dayNamesOf(null), { en: '', hi: '' });
});

// ============================ M-36 / M-37: the Public Worker health endpoint
//
// CONTRACT CHANGE (audit PUB-BE-03): `?health=1` used to be a single endpoint
// answering two different questions, and it paid six D1 round-trips plus a KV read
// to answer either of them. It is now split, so these assertions moved with it:
//
//   ?health=1            LIVENESS — "is the process up?". ZERO I/O: binding
//                        presence is a synchronous property of `env`. 503 +
//                        `missingRequired: [...]` when a required binding is absent.
//   ?health=1&deep=1     READINESS — "can it reach its dependencies?". Probes each
//   (or ?health=ready)   binding and reports `{state, required, consequence}`. A
//                        REQUIRED failure is 503; an OPTIONAL one is 200 +
//                        `degraded: true`. D1 error TEXT is redacted (it echoes
//                        table and column names) and written to error_log instead.
//
// The M-36 / M-37 intent is unchanged and still asserted below: a monitor must not
// read a healthy deployment as DOWN, and a partially bound deployment must not
// serve silently wrong data invisibly. Only which endpoint answers has changed.

const healthReq = () => new Request('https://public.test/?health=1', { method: 'GET' });
const readyReq = () => new Request('https://public.test/?health=1&deep=1', { method: 'GET' });
const noopCtx = { waitUntil: () => {} };

function publicEnv() {
  return {
    DB_CORE: makeD1(schemaFor('core.sql')),
    DB_COLLECTIONS: makeD1(schemaFor('collections.sql')),
    DB_LOANS_EXPENSES: makeD1(schemaFor('loans_expenses.sql')),
    DB_FILE_INDEX: makeD1(schemaFor('file_index.sql')),
    DB_MISC: makeD1(schemaFor('misc.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    KV_PUBLIC: makeKV(),
  };
}

test('M-36: a fully bound deployment answers 200, not the 400 a monitor reads as DOWN', async () => {
  const res = await publicWorker.fetch(healthReq(), publicEnv(), noopCtx);
  const body = await res.json();

  // Before: `/` and any unknown action returned {"status":false,...} with HTTP 400,
  // so the only thing an uptime monitor could poll always looked broken.
  assert.equal(res.status, 200);
  assert.equal(body.status, true, 'kept so monitors already watching this URL keep working');
  assert.equal(body.healthy, true);
  assert.equal(body.check, 'liveness');
  assert.equal(body.worker, 'chhath-public-api');
  assert.deepEqual(body.missingRequired, [], 'nothing required is absent');
  assert.equal(res.headers.get('Cache-Control'), 'no-store', 'a monitor must never get a cached answer');
});

test('M-36: the deep probe is what reports every dependency, required and optional', async () => {
  const res = await publicWorker.fetch(readyReq(), publicEnv(), noopCtx);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.check, 'readiness');
  assert.equal(body.ready, true);
  assert.equal(body.degraded, false);
  for (const b of ['DB_CORE', 'DB_COLLECTIONS', 'DB_LOANS_EXPENSES', 'DB_FILE_INDEX', 'DB_MISC', 'DB_LOGS', 'KV_PUBLIC']) {
    assert.equal(body.checks[b].state, 'ok', `${b} probed`);
  }
  // Which failures may page someone is part of the contract, not a detail.
  for (const b of ['DB_CORE', 'DB_COLLECTIONS', 'DB_LOANS_EXPENSES', 'DB_FILE_INDEX']) {
    assert.equal(body.checks[b].required, true, `${b} is required`);
  }
  for (const b of ['DB_MISC', 'DB_LOGS', 'KV_PUBLIC']) {
    assert.equal(body.checks[b].required, false, `${b} is optional`);
  }
});

test('M-37: a missing REQUIRED binding is 503 and names the binding', async () => {
  const env = publicEnv();
  delete env.DB_COLLECTIONS;
  const res = await publicWorker.fetch(healthReq(), env, noopCtx);
  const body = await res.json();

  assert.equal(res.status, 503, 'a monitor must be able to page on this');
  assert.equal(body.healthy, false);
  // Binding NAMES are in the committed wrangler.toml, so naming the missing one
  // leaks nothing — and liveness reaches this verdict with no I/O at all.
  assert.deepEqual(body.missingRequired, ['DB_COLLECTIONS']);
});

test('M-37: a silently-degrading binding is reported WITHOUT paging anyone', async () => {
  const env = publicEnv();
  delete env.DB_MISC;   // popups vanish — getActivePublicPopups returns [] by design
  delete env.KV_PUBLIC; // the rate limiter and D1 budget guard both fail OPEN
  const res = await publicWorker.fetch(readyReq(), env, noopCtx);
  const body = await res.json();

  // This is the M-37 case: a partially bound deployment serves happily and silently
  // WRONG, and none of it shows up in a normal response.
  assert.equal(res.status, 200, 'the portal still renders, so this must not be a hard failure');
  assert.equal(body.ready, true);
  assert.equal(body.degraded, true, 'but it must be visible');
  assert.equal(body.checks.DB_MISC.state, 'missing');
  assert.equal(body.checks.DB_MISC.required, false);
  assert.match(body.checks.DB_MISC.consequence, /popups will not appear/,
    'a degraded feature must say what it actually costs');
  assert.equal(body.checks.KV_PUBLIC.state, 'missing');
  assert.match(body.checks.KV_PUBLIC.consequence, /fail open/);
});

test('M-37: a binding that is present but broken is an error, not "ok"', async () => {
  const env = publicEnv();
  env.DB_CORE = { prepare: () => { throw new Error('D1_ERROR: connection reset by peer'); } };
  const res = await publicWorker.fetch(readyReq(), env, noopCtx);
  const raw = await res.text();
  const body = JSON.parse(raw);

  assert.equal(res.status, 503, 'a REQUIRED dependency failing is a hard failure');
  assert.equal(body.ready, false);
  assert.equal(body.checks.DB_CORE.state, 'error');
  // PUB-BE-03: the STATE is public, the D1 message is not — SQLite echoes table,
  // column and database names. The text goes to error_log instead.
  assert.ok(!raw.includes('connection reset'),
    'an anonymous caller must never be handed raw D1 error text');
  assert.match(body.detail, /redacted/);
});

test('M-37: the legacy KV_SESSIONS fallback is reported as such, not as fully configured', async () => {
  const env = publicEnv();
  delete env.KV_PUBLIC;
  env.KV_SESSIONS = makeKV(); // an older deployment, before the H-4 namespace split
  const res = await publicWorker.fetch(readyReq(), env, noopCtx);
  const body = await res.json();
  assert.equal(body.checks.KV_PUBLIC.state, 'ok', 'it does work');
  assert.match(body.checks.KV_PUBLIC.note, /legacy KV_SESSIONS fallback/,
    'working-but-on-the-old-shared-namespace must not look identical to done');
});

test('M-36: the health check runs BEFORE the rate limiter', async () => {
  const env = publicEnv();
  const req = () => new Request('https://public.test/?health=1', {
    method: 'GET', headers: { 'CF-Connecting-IP': '203.0.113.7' },
  });
  // A monitor polling every minute must not be able to rate-limit itself into a
  // false alarm. 200 requests is far past PUB_RL_MAX (60/min).
  for (let i = 0; i < 200; i++) {
    const res = await publicWorker.fetch(req(), env, noopCtx);
    if (res.status !== 200) {
      assert.fail(`health check was rate limited after ${i} requests (status ${res.status})`);
    }
  }
});

test('M-36 regression guard: an unknown action still returns the 400 it always did', async () => {
  const res = await publicWorker.fetch(
    new Request('https://public.test/?action=nonsense', { method: 'GET' }), publicEnv(), noopCtx);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).message, 'Invalid Request');
});

// ============================================== DEAD CODE ACTUALLY REMOVED

test('L-2..L-5, L-8: the dead exports are gone, and nothing referenced them', () => {
  const wa = read('../src/whatsapp.js');
  assert.ok(!/export function renderTemplate\(/.test(wa), 'L-2: renderTemplate removed');
  assert.match(wa, /renderTemplateChecked/, 'and the replacement is still there');

  const tpl = read('../src/templates.js');
  assert.ok(!/export async function ensureSeedTemplate/.test(tpl), 'L-3: ensureSeedTemplate removed');

  const dd = read('../src/dropdownLists.js');
  assert.ok(!/export const DROPDOWN_LIST_SEED/.test(dd), 'L-4: seed data removed from application code');

  const api = read('../../frontend/src/api.js');
  assert.ok(!/^\s*uploadFile:/m.test(api), 'L-5: api.uploadFile removed');

  const cp = read('../src/consentPlaceholders.js');
  assert.ok(!/export const DOCUMENTED_GUARANTOR_SLOTS/.test(cp), 'L-8: un-exported');
  assert.match(cp, /const DOCUMENTED_GUARANTOR_SLOTS = 3;/, 'but still used internally');
});

test('L-1 is WITHDRAWN: requireStaffRole is imported AND used', () => {
  // The report listed this as an unused import. It is not — it gates getUsers and
  // several other reads (the H-1 work added those). Asserted so the "cleanup" is
  // never actually performed.
  const src = read('../src/index.js');
  assert.match(src, /^import \{[^}]*requireStaffRole[^}]*\} from '\.\/auth\.js';/m, 'imported');
  const uses = (src.match(/requireStaffRole\(/g) || []).length;
  assert.ok(uses >= 3, `used ${uses} times — removing the import would break the build`);
});

test('L-14 / L-15: the misleading comments are fixed', () => {
  const src = read('../src/index.js');

  // L-14: the actor/device/IP block described buildLogContext but sat above
  // summarizePayload.
  const summaryIdx = src.indexOf('function summarizePayload');
  const ctxIdx = src.indexOf('function buildLogContext');
  const blockIdx = src.indexOf('The error_log table has no columns for actor/device/IP');
  assert.ok(blockIdx > summaryIdx, 'the block no longer precedes summarizePayload');
  assert.ok(blockIdx < ctxIdx, 'and now precedes buildLogContext, which it describes');

  // L-15: the comment named two variables no code reads.
  const stale = src.slice(src.indexOf('audit L-15'), src.indexOf('audit L-15') + 600);
  assert.match(stale, /read by NO code/, 'the correction is explicit');
  assert.match(stale, /DRIVE_OAUTH_CLIENT_ID/, 'and names the variables that ARE read');
});

test('L-16 is already done: the Drive token key is namespaced', () => {
  assert.match(read('../src/account.js'), /const DRIVE_TOKEN_KEY = 'drive:access_token';/);
});
