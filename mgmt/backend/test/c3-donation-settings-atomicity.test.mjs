// ============ CARRY-OVER C3 — the Donate page must never show a half-published set ============
//
// The seven `donation_*` settings ARE the page that tells people where to send money.
// Both mgmt frontends published them by calling the singular action seven times in a
// loop, and the server validated nothing. Proven on `main`:
//
//   * a failure on call 4 of 7 left `donation_upi_id = pay@newbank` live beside
//     `donation_account_number = 123456789012` and `donation_ifsc = GOOD0001234` — the
//     OLD bank. A transfer made from that page goes to an account the committee has left.
//   * `setPortalSetting(env, 'donation_upi_id', 'not a upi id at all')` was stored and
//     served. `money.ts` checks in the BROWSER; the retained React app checks nothing.
//
// These tests pin the three properties that close it:
//
//   1. ATOMICITY — one failing statement leaves every one of the seven values at its
//      previous state, not some of them;
//   2. VALIDATION BEFORE ANY WRITE — an invalid set changes nothing at all, so a typo
//      cannot go live and cannot half-go-live either;
//   3. the cross-field rule (an account number needs its IFSC) is enforced on the SET and
//      deliberately NOT on a single key, because the old loop necessarily passes through
//      that state and rejecting it per key would break a legitimate save.
//
// Run: node --test mgmt/backend/test/c3-donation-settings-atomicity.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { makeD1, schemaFor } from './helpers/stubs.mjs';
import {
  setPortalSetting, setPortalSettings, getPortalSetting, DONATION_SETTING_KEYS,
} from '../src/settings.js';

const SUPER = { name: 'USER0001', role: 'Superadmin' };
const ADMIN = { name: 'USER0002', role: 'Admin' };

// What the committee has published today.
const LIVE = Object.freeze({
  donation_upi_id: 'samiti@goodbank',
  donation_qr_url: 'https://r2.example/qr.png',
  donation_bank_account_name: 'Chhath Puja Samiti',
  donation_bank_name: 'Good Bank',
  donation_account_number: '123456789012',
  donation_ifsc: 'GOOD0001234',
  donation_whatsapp: '9876543210',
});

// The committee has changed bank.
const NEXT = Object.freeze({
  donation_upi_id: 'samiti@newbank',
  donation_qr_url: 'https://r2.example/qr-new.png',
  donation_bank_account_name: 'Chhath Puja Samiti',
  donation_bank_name: 'New Bank',
  donation_account_number: '999888777666',
  donation_ifsc: 'NEWB0009999',
  donation_whatsapp: '9000000000',
});

const makeEnv = () => ({ DB_CORE: makeD1(schemaFor('core.sql')) });

async function publishLive(env) {
  await setPortalSettings(env, { ...LIVE }, SUPER);
}

async function readAll(env) {
  const out = {};
  for (const key of Object.keys(DONATION_SETTING_KEYS)) out[key] = await getPortalSetting(env, key);
  return out;
}

// ------------------------------------------------------------------ 1. ATOMICITY

describe('C3: the set lands whole or not at all', () => {
  test('all seven values are published by one call', async () => {
    const env = makeEnv();
    await publishLive(env);
    assert.deepEqual(await readAll(env), LIVE);
  });

  test('a failure part-way through leaves EVERY value at its previous state', async () => {
    const env = makeEnv();
    await publishLive(env);

    // Fail the 4th statement of the batch — a dropped connection on a phone, which is how
    // this screen is actually used.
    const realBatch = env.DB_CORE.batch.bind(env.DB_CORE);
    env.DB_CORE.batch = async (stmts) => {
      const boom = { run: async () => { throw new Error('D1_ERROR: network dropped'); } };
      return realBatch([...stmts.slice(0, 3), boom, ...stmts.slice(4)]);
    };

    await assert.rejects(() => setPortalSettings(env, { ...NEXT }, SUPER), /network dropped/);

    // THE ASSERTION THAT FAILS ON `main`: not one value moved.
    assert.deepEqual(await readAll(env), LIVE,
      'the Donate page must still show exactly the previous details');
  });

  test('specifically, the new UPI id cannot go live beside the old account number', async () => {
    // Naming the exact `main` symptom, because "deepEqual on seven keys" does not say
    // out loud what the bug actually did to somebody's money.
    const env = makeEnv();
    await publishLive(env);
    const realBatch = env.DB_CORE.batch.bind(env.DB_CORE);
    env.DB_CORE.batch = async (stmts) => {
      const boom = { run: async () => { throw new Error('D1_ERROR: network dropped'); } };
      return realBatch([...stmts.slice(0, 3), boom, ...stmts.slice(4)]);
    };
    await assert.rejects(() => setPortalSettings(env, { ...NEXT }, SUPER));

    const upi = await getPortalSetting(env, 'donation_upi_id');
    const account = await getPortalSetting(env, 'donation_account_number');
    assert.ok(!(upi === NEXT.donation_upi_id && account === LIVE.donation_account_number),
      'a transfer from the Donate page would go to the bank the committee has left');
  });

  test('a first-time publish onto an empty table is also all-or-none', async () => {
    const env = makeEnv();
    const realBatch = env.DB_CORE.batch.bind(env.DB_CORE);
    env.DB_CORE.batch = async (stmts) => {
      const boom = { run: async () => { throw new Error('D1_ERROR: nope'); } };
      return realBatch([...stmts.slice(0, 2), boom, ...stmts.slice(3)]);
    };
    await assert.rejects(() => setPortalSettings(env, { ...LIVE }, SUPER));

    const stored = await readAll(env);
    assert.deepEqual(stored, Object.fromEntries(Object.keys(DONATION_SETTING_KEYS).map(k => [k, ''])),
      'nothing may be left behind from a failed first publish');
  });

  test('re-publishing the same set updates rather than duplicating rows', async () => {
    const env = makeEnv();
    await publishLive(env);
    await publishLive(env);
    const { n } = await env.DB_CORE
      .prepare(`SELECT COUNT(*) AS n FROM portal_settings WHERE "key" LIKE 'donation_%'`).first();
    assert.equal(n, 7, 'the UPSERT must update in place, not insert a second row per key');
  });
});

// --------------------------------------------------- 2. VALIDATION BEFORE ANY WRITE

describe('C3: an invalid set is rejected before anything is written', () => {
  const cases = [
    ['donation_upi_id', 'not a upi id at all', /UPI ID does not look right/],
    ['donation_upi_id', 'samiti@', /UPI ID does not look right/],
    ['donation_account_number', 'ABCD-typo', /account number must be 6–20 digits/],
    ['donation_account_number', '12345', /account number must be 6–20 digits/],
    ['donation_ifsc', '!!!', /IFSC code does not look right/],
    ['donation_ifsc', 'GOOD1001234', /IFSC code does not look right/],   // 5th char must be 0
    ['donation_whatsapp', '98765', /must be exactly 10 digits/],
    ['donation_whatsapp', '+919876543210', /must be exactly 10 digits/],
  ];

  for (const [key, bad, expected] of cases) {
    test(`rejects ${key} = ${JSON.stringify(bad)}, and changes nothing`, async () => {
      const env = makeEnv();
      await publishLive(env);
      await assert.rejects(() => setPortalSettings(env, { ...NEXT, [key]: bad }, SUPER), expected);
      assert.deepEqual(await readAll(env), LIVE, 'a rejected set must not partially apply');
    });
  }

  test('a blank field is allowed — a committee may publish only UPI, or only bank details', async () => {
    const env = makeEnv();
    await setPortalSettings(env, {
      donation_upi_id: 'samiti@goodbank',
      donation_account_number: '',
      donation_ifsc: '',
      donation_whatsapp: '',
    }, SUPER);
    assert.equal(await getPortalSetting(env, 'donation_upi_id'), 'samiti@goodbank');
  });

  test('the cross-field rule is enforced on the SET: an account number needs its IFSC', async () => {
    const env = makeEnv();
    await assert.rejects(
      () => setPortalSettings(env, { donation_account_number: '123456789012', donation_ifsc: '' }, SUPER),
      /account number needs its IFSC/);
    await assert.rejects(
      () => setPortalSettings(env, { donation_account_number: '', donation_ifsc: 'GOOD0001234' }, SUPER),
      /IFSC code needs the account number/);
  });

  test('...and deliberately NOT on a single key, or the old loop could never save', async () => {
    // A loop writing seven keys one at a time NECESSARILY passes through
    // "account set, IFSC not yet". Applying the pair rule per key would reject the
    // committee's own legitimate save half-way through, which is worse than the gap.
    const env = makeEnv();
    await setPortalSetting(env, 'donation_account_number', '123456789012', SUPER);
    assert.equal(await getPortalSetting(env, 'donation_account_number'), '123456789012');
  });

  test('the singular action still format-checks — the React app has no check of its own', async () => {
    const env = makeEnv();
    await assert.rejects(() => setPortalSetting(env, 'donation_upi_id', 'not a upi id at all', SUPER),
      /UPI ID does not look right/);
    assert.equal(await getPortalSetting(env, 'donation_upi_id'), '',
      'the invalid value must not be stored');
  });

  test('non-donation settings are untouched by donation validation', async () => {
    const env = makeEnv();
    await setPortalSettings(env, {
      journey_tagline_en: 'Ten years of Chhath',
      journey_tagline_hi: 'छठ के दस वर्ष',
    }, SUPER);
    assert.equal(await getPortalSetting(env, 'journey_tagline_en'), 'Ten years of Chhath');
  });
});

// ------------------------------------------------------------- 3. SHAPE AND AUTH

describe('C3: the action refuses what it cannot safely write', () => {
  test('only a Superadmin may write settings', async () => {
    const env = makeEnv();
    await assert.rejects(() => setPortalSettings(env, { ...LIVE }, ADMIN));
    await assert.rejects(() => setPortalSettings(env, { ...LIVE }, null));
    assert.deepEqual(await readAll(env), Object.fromEntries(
      Object.keys(DONATION_SETTING_KEYS).map(k => [k, ''])), 'nothing written');
  });

  test('a missing, empty or wrong-typed payload is a 400, not a crash', async () => {
    const env = makeEnv();
    for (const bad of [undefined, null, {}, [], 'donation_upi_id=x', 42]) {
      await assert.rejects(() => setPortalSettings(env, bad, SUPER), (e) => {
        assert.ok(e.expected || e.validationError, `must be a user-facing 400, got: ${e.message}`);
        return true;
      });
    }
  });

  test('an object value is refused rather than stored as "[object Object]"', async () => {
    const env = makeEnv();
    await assert.rejects(() => setPortalSettings(env, { donation_bank_name: { a: 1 } }, SUPER),
      /must be text, not an object/);
  });
});

// --------------------------------------------------- 4. THE RULES MUST NOT DRIFT

describe('C3: the browser check and the server check stay in step', () => {
  // They cannot share a module — one is TypeScript in a Vite app, the other runs in
  // workerd — so drift is guarded rather than prevented. The dangerous direction is the
  // SERVER being more permissive, since the server is the authority.
  const literals = (src) => Object.fromEntries(
    [...src.matchAll(/^const (UPI_RE|IFSC_RE|ACCOUNT_RE|TEN_DIGITS) = (\/.*\/);$/gm)]
      .map(m => [m[1], m[2]])
  );

  test('all four patterns are byte-identical in money.ts and settings.js', () => {
    const money = literals(readFileSync(new URL('../../frontend-svelte/src/lib/money.ts', import.meta.url), 'utf8'));
    const server = literals(readFileSync(new URL('../src/settings.js', import.meta.url), 'utf8'));

    assert.equal(Object.keys(money).length, 4, `expected 4 patterns in money.ts, found ${Object.keys(money)}`);
    assert.deepEqual(server, money,
      'the server must not be more permissive than the browser — it is the authority');
  });
});

// ------------------------------------------------------- 5. THE ACTION IS REACHABLE

describe('C3: the action is wired, in both frontends and in the router', () => {
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

  test('neither DonationSettings view loops over the singular action any more', () => {
    for (const rel of [
      '../../frontend-svelte/src/lib/views/DonationSettings.svelte',
      '../../frontend/src/views/DonationSettings.jsx',
    ]) {
      const src = read(rel);
      assert.ok(src.includes('api.setPortalSettings('), `${rel} must use the atomic action`);
      assert.ok(!/await api\.setPortalSetting\(/.test(src),
        `${rel} still awaits the SINGULAR action — that is the partial-publish bug`);
    }
  });

  test('both api clients expose it', () => {
    assert.match(read('../../frontend-svelte/src/lib/api.ts'), /setPortalSettings:/);
    assert.match(read('../../frontend/src/api.js'), /setPortalSettings:/);
  });

  test('it is declared mutating — which is what makes CSRF apply to it', async () => {
    // Not just the Q-8 drift guard: EXPECTED_MUTATING_ACTIONS is the set the CSRF
    // double-submit check consults (index.js, `usingCookieAuth && EXPECTED_MUTATING_ACTIONS
    // .has(action)`), so an omitted write action is UNPROTECTED on a cookie session rather
    // than merely unclassified. Read the live Set, not the source text.
    const { EXPECTED_MUTATING_ACTIONS, READ_ONLY_ACTIONS } = await import('../src/index.js');
    assert.ok(EXPECTED_MUTATING_ACTIONS.has('setPortalSettings'),
      'setPortalSettings must be in EXPECTED_MUTATING_ACTIONS or CSRF does not apply to it');
    assert.ok(!READ_ONLY_ACTIONS.has('setPortalSettings'),
      'it is a write: being read-only would also suppress the public data-version bump');
    // And the CSRF check must still be the thing that consults it.
    assert.match(read('../src/index.js'),
      /usingCookieAuth && EXPECTED_MUTATING_ACTIONS\.has\(action\)/,
      'the CSRF gate no longer reads this set — the reasoning above is stale');
  });

  test('the router registers it and audits it', () => {
    const src = read('../src/index.js');
    assert.match(src, /^ {6}setPortalSettings: \(\) => withAuth\(env, req, async \(user\) => \{$/m,
      'must be a 6-space-indented handler taking `user` (see q8 + medium-access-control)');
    // Changing where the committee's money arrives is exactly the kind of change someone
    // will later need to trace. The old singular action logged nothing.
    const handler = src.slice(src.indexOf('setPortalSettings: () =>'));
    assert.match(handler.slice(0, 900), /logActivity\(env, \{/,
      'a change to the donation details must leave an activity-log row');
  });
});
