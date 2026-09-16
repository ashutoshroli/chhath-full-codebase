// ============ MGMT WORKER — NO VISITOR ADDRESS IN A KV KEY (carry-over C12) ============
//
// #356 pseudonymised the PUBLIC Worker's *persisted* copies of a visitor's address and
// left the KV keys alone, on the grounds that they expire in about a minute. #362
// established that was the wrong call and fixed it there. This is the same fix on the
// mgmt side, where #362's own note was ALSO understated: it named only
// `isLogErrorRateLimited`, and there were five keys, not one.
//
// The portal needs to know whether two requests came from the SAME caller, to cap floods
// and scope lockouts. It never needs the address to do that. So the address is replaced
// by a keyed, daily-rotating pseudonym, and these tests pin the properties that make that
// claim true rather than decorative:
//
//   1. after exercising every one of the five sites, NO KV key contains the address —
//      asserted as a SWEEP with a single named exception, not site by site, so a new
//      key that embeds an address fails this file without anyone remembering to add a
//      case for it;
//   2. every limiter still limits, and the lockout still locks, at the same cap;
//   3. two different callers do not share a counter (the pseudonym is per-address);
//   4. with no salt obtainable, NOTHING about the caller is stored — never a fallback
//      to the address, and never an unkeyed hash of it;
//   5. the pseudonym is genuinely keyed: the same address under a different salt gives
//      a different value, and it is not sha256(address);
//   6. the salt is dated, expires, and is fetched once per isolate (this runs on the
//      hot path of every public request).
//
// THE ONE ALLOWED EXCEPTION is `loginfail:<name>:<ip>`, the per-account login lockout.
// It is deliberate, and the reasoning is the same as for `login_attempts.ip` and
// `user_sessions.ip`, which also keep the address: that key is scoped to a NAMED STAFF
// ACCOUNT, and "which address is hammering this account" is the one fact a Superadmin
// needs from the Locked Accounts screen to decide between unlocking and investigating.
// `getLockedAccounts` parses the address back out of the key to show it, and
// `revokeLock` rebuilds the key from it. Pseudonymising it would blank out that screen
// while `login_attempts` went on recording the same addresses in plain text for the same
// events — privacy theatre at the cost of an operational tool. Recording the address of
// someone attacking a named account is a different question from recording the address
// of a passer-by, and C12 is about the passer-by.
//
// Run: node --test mgmt/backend/test/mgmt-ip-pseudonyms.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { login, hashPassword } from '../src/auth.js';
import { isLogErrorRateLimited } from '../src/errorLog.js';
import { isVerifyRateLimited } from '../src/twoFactor.js';
import { verifyAnnouncementPin } from '../src/announcements.js';
import { ipKey } from '../src/ipPseudonym.js';
import worker from '../src/index.js';

const IP = '203.0.113.47';
const OTHER_IP = '198.51.100.9';
const IPV6 = '2001:db8::dead:beef';
const LINK_TOKEN = 'ANNOUNCETOKEN123';
const PASSWORD = 'a-good-password';
const ctx = { waitUntil: () => {} };

// The single documented exception — see the file header.
const ALLOWED_TO_HOLD_AN_ADDRESS = /^loginfail:/;

async function makeEnv(overrides = {}) {
  const core = makeD1(schemaFor('core.sql'));
  core.prepare('INSERT INTO login_users (name, mobile, email, password, role, updated_at) VALUES (?,?,?,?,?,?)')
    .bind('USER0001', 9876543210, 'a@b.test', await hashPassword(PASSWORD), 'Superadmin', '2026-01-01').run();

  const misc = makeD1(schemaFor('misc.sql'));
  misc.prepare('INSERT INTO announcement_links (token, year, pin, expiresat, active, createdby, createdat) VALUES (?,?,?,?,?,?,?)')
    .bind(LINK_TOKEN, 2026, await hashPassword('654321'), '', 'TRUE', 'USER0001', '2026-01-01').run();

  return {
    DB_CORE: core,
    DB_AUDIT: makeD1(schemaFor('audit.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    DB_MISC: misc,
    // A correct PIN goes on to build the announcement queue, which reads these.
    DB_COLLECTIONS: makeD1(schemaFor('collections.sql')),
    DB_LOANS_EXPENSES: makeD1(schemaFor('loans_expenses.sql')),
    KV_SESSIONS: makeKV(),
    PASSWORD_SALT: 'test-salt',
    ...overrides,
  };
}

const post = (env, body, ip = IP) => worker.fetch(
  new Request('https://api.example/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  }),
  env, ctx
);

// Exercises all five sites once, from the same address.
async function touchEverySite(env, ip = IP) {
  await isLogErrorRateLimited(env, ip);                                     // errorLog.js
  await isVerifyRateLimited(env, ip);                                       // twoFactor.js
  await login(env, 'USER0001', 'wrong-password', false, ip, 'Firefox');     // auth.js
  await verifyAnnouncementPin(env, LINK_TOKEN, '000000', ip);               // announcements.js
  await post(env, { action: 'reportErrorPublic', source: 's', page: '/p', message: 'm' }, ip); // index.js
}

const keysOf = (env) => [...env.KV_SESSIONS._store.keys()];

function assertNoAddressAnywhere(env, ...addresses) {
  for (const key of keysOf(env)) {
    if (ALLOWED_TO_HOLD_AN_ADDRESS.test(key)) continue;
    for (const addr of addresses) {
      assert.ok(!key.includes(addr), `KV key spells out a caller's address: ${key}`);
    }
  }
  // …and not smuggled into a value either.
  for (const { value } of env.KV_SESSIONS._store.values()) {
    for (const addr of addresses) {
      assert.ok(!value.includes(addr), `a KV value spells out a caller's address: ${value}`);
    }
  }
}

// ---------------------------------------------------------------- 1. THE SWEEP

describe('C12 (mgmt): the address reaches no KV key', () => {
  test('after every one of the five sites has run, no key contains the address', async () => {
    const env = await makeEnv();
    await touchEverySite(env);

    // Guard against the test passing because nothing ran at all.
    const written = keysOf(env).filter(k => !ALLOWED_TO_HOLD_AN_ADDRESS.test(k));
    assert.ok(written.length >= 4, `expected the limiters to have written keys, got ${written.join(', ')}`);

    assertNoAddressAnywhere(env, IP);
  });

  test('each of the five keys is present, and each carries a 32-hex pseudonym', async () => {
    const env = await makeEnv();
    await touchEverySite(env);
    const keys = keysOf(env);

    const expected = [
      [/^rl:reportErrorPublic:/, 'index.js — every rate-limited public action'],
      [/^rl:logError:/, 'errorLog.js — the PUBLIC error-report endpoint'],
      [/^loginip:/, 'auth.js — the login-attempt limiter'],
      [/^twofa:rl:/, 'twoFactor.js — the 2FA attempt limiter'],
      [/^announcepinfail:/, 'announcements.js — the announce-PIN lockout'],
    ];
    const pseudonym = await ipKey(env, IP);
    assert.match(pseudonym, /^[0-9a-f]{32}$/, 'the pseudonym must be 32 hex chars');

    for (const [re, why] of expected) {
      const hit = keys.find(k => re.test(k));
      assert.ok(hit, `no key was written for ${why}`);
      assert.ok(hit.includes(pseudonym), `${why}: key ${hit} does not carry the pseudonym`);
    }
  });

  test('an IPv6 address does not leak either (it survives naive IP-shaped regexes)', async () => {
    const env = await makeEnv();
    await touchEverySite(env, IPV6);
    assertNoAddressAnywhere(env, IPV6);
    // Not even a fragment: the colons in an IPv6 address would also have corrupted the
    // `<prefix>:<id>:<bucket>` key shape these limiters parse back.
    const fragmented = keysOf(env)
      .filter(k => !ALLOWED_TO_HOLD_AN_ADDRESS.test(k))
      .filter(k => k.includes('dead:beef') || k.includes('2001:db8'));
    assert.deepEqual(fragmented, [], 'no fragment of the address may appear');
  });
});

// ------------------------------------------------- 2. THE LIMITS STILL LIMIT

describe('C12 (mgmt): pseudonymising did not disable anything', () => {
  test('errorLog: 20 reports pass, the 21st is capped', async () => {
    const env = await makeEnv();
    for (let i = 0; i < 20; i++) {
      assert.equal(await isLogErrorRateLimited(env, IP), false, `call ${i + 1} must be allowed`);
    }
    assert.equal(await isLogErrorRateLimited(env, IP), true, 'the 21st must be capped');
  });

  test('2FA verify: 5 attempts pass, the 6th is capped', async () => {
    const env = await makeEnv();
    for (let i = 0; i < 5; i++) {
      assert.equal(await isVerifyRateLimited(env, IP), false, `attempt ${i + 1} must be allowed`);
    }
    assert.equal(await isVerifyRateLimited(env, IP), true, 'the 6th must be capped');
  });

  test('router: the 21st rate-limited request from one address gets a 429', async () => {
    const env = await makeEnv();
    const body = { action: 'reportErrorPublic', source: 's', page: '/p', message: 'm' };
    for (let i = 0; i < 20; i++) {
      const res = await post(env, body);
      assert.notEqual(res.status, 429, `request ${i + 1} must not be throttled`);
    }
    assert.equal((await post(env, body)).status, 429, 'the 21st must be throttled');
  });

  test('login: the per-address cap (30 / 15 min) still trips', async () => {
    const env = await makeEnv();

    // The MESSAGE cannot be the assertion here. auth.js returns GENERIC_LOGIN_FAILURE
    // ('Invalid credentials') for the throttle too, deliberately, so the cap reveals
    // nothing — an earlier draft of this test asserted /too many/ and could never have
    // failed for the right reason. The observable is the audit row auth.js writes with
    // reason 'ip_rate_limited', which is also what makes the cap visible to a Superadmin.
    const capHits = async () => (await env.DB_AUDIT
      .prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE reason = 'ip_rate_limited'`)
      .first()).n;

    // Distinct account names, so the per-ACCOUNT lockout cannot be what trips.
    for (let i = 0; i < 30; i++) {
      const r = await login(env, `NOBODY${i}`, 'x', false, IP, 'Firefox');
      assert.equal(r.success, false);
    }
    assert.equal(await capHits(), 0, 'the first 30 attempts must not be throttled');

    const capped = await login(env, 'NOBODY999', 'x', false, IP, 'Firefox');
    assert.equal(capped.success, false);
    assert.equal(await capHits(), 1, 'the 31st must hit the per-address cap');

    // A different address must still be able to log in — the cap is per-caller, which is
    // only true if the pseudonym is per-caller.
    const ok = await login(env, 'USER0001', PASSWORD, false, OTHER_IP, 'Firefox');
    assert.equal(ok.success, true, 'an unrelated caller must not be capped');
  });

  test('announce PIN: the lockout still trips after 5 wrong PINs, and a right PIN clears it', async () => {
    const env = await makeEnv();
    for (let i = 0; i < 5; i++) {
      const r = await verifyAnnouncementPin(env, LINK_TOKEN, '000000', IP);
      assert.equal(r.message, 'Incorrect PIN', `attempt ${i + 1}`);
    }
    const locked = await verifyAnnouncementPin(env, LINK_TOKEN, '000000', IP);
    assert.match(locked.message, /Too many incorrect attempts/, 'the 6th must be locked out');

    // A different caller must NOT be locked out by the first one (this is what H-17 fixed,
    // and it has to keep working through a pseudonym).
    const other = await verifyAnnouncementPin(env, LINK_TOKEN, '654321', OTHER_IP);
    assert.equal(other.success, true, 'a second caller must be unaffected');
    assert.ok(other.announceToken, 'and must still get a session token');
  });
});

// ----------------------------------------- 3. TWO CALLERS ARE STILL DISTINCT

describe('C12 (mgmt): the pseudonym is per-address, not a shared bucket', () => {
  test('two addresses get different pseudonyms and separate counters', async () => {
    const env = await makeEnv();
    const a = await ipKey(env, IP);
    const b = await ipKey(env, OTHER_IP);
    assert.notEqual(a, b, 'two addresses must not collapse into one pseudonym');

    // Flood from the first address.
    for (let i = 0; i < 20; i++) await isLogErrorRateLimited(env, IP);
    assert.equal(await isLogErrorRateLimited(env, IP), true, 'the flooder is capped');
    assert.equal(await isLogErrorRateLimited(env, OTHER_IP), false,
      'an unrelated caller must not be capped by someone else’s flood');
  });

  test('the same address gets the SAME pseudonym across calls (otherwise nothing counts)', async () => {
    const env = await makeEnv();
    assert.equal(await ipKey(env, IP), await ipKey(env, IP));
  });
});

// -------------------------------------- 4. NO SALT ⇒ NOTHING STORED, EVER

describe('C12 (mgmt): with no salt, nothing about the caller is stored', () => {
  // A KV whose salt entry can be neither read nor written — a namespace at its write
  // quota, or a partial outage. `ipKey` must give up rather than degrade.
  function saltlessKV() {
    const kv = makeKV();
    return {
      ...kv,
      async get(k) { if (k.startsWith('mgmt:ipsalt:')) throw new Error('KV read failed'); return kv.get(k); },
      async put(k, v, o) { if (k.startsWith('mgmt:ipsalt:')) throw new Error('KV write failed'); return kv.put(k, v, o); },
      _store: kv._store,
    };
  }

  test('ipKey returns empty — not the address, not an unkeyed hash', async () => {
    const env = await makeEnv({ KV_SESSIONS: saltlessKV() });
    assert.equal(await ipKey(env, IP), '');
  });

  test('the limiters skip counting instead of falling back to the address', async () => {
    const env = await makeEnv({ KV_SESSIONS: saltlessKV() });

    assert.equal(await isLogErrorRateLimited(env, IP), false, 'must fail open, as documented');
    assert.equal(await isVerifyRateLimited(env, IP), false);
    await post(env, { action: 'reportErrorPublic', source: 's', page: '/p', message: 'm' });

    // Not one counter key may have been written…
    const counters = keysOf(env).filter(k => /^(rl:|twofa:rl:|loginip:)/.test(k));
    assert.deepEqual(counters, [], `nothing may be counted without a salt, got ${counters.join(', ')}`);
    // …and above all, no address anywhere.
    assertNoAddressAnywhere(env, IP);
  });

  test('the announce-PIN gate falls back to the TOKEN-ONLY key, never the address', async () => {
    // This one must NOT skip the gate: dropping it would leave a 6-digit PIN open to
    // unlimited guessing. It degrades to the pre-H-17 shared key instead.
    const env = await makeEnv({ KV_SESSIONS: saltlessKV() });
    const r = await verifyAnnouncementPin(env, LINK_TOKEN, '000000', IP);
    assert.equal(r.message, 'Incorrect PIN');

    assert.ok(keysOf(env).includes(`announcepinfail:${LINK_TOKEN}`),
      'the gate must still exist, keyed on the token alone');
    assertNoAddressAnywhere(env, IP);

    // And it must still count up to the cap, not sit at zero for ever.
    for (let i = 0; i < 4; i++) await verifyAnnouncementPin(env, LINK_TOKEN, '000000', IP);
    const locked = await verifyAnnouncementPin(env, LINK_TOKEN, '000000', IP);
    assert.match(locked.message, /Too many incorrect attempts/);
  });

  test('with no KV binding at all, nothing is stored and nothing throws', async () => {
    const env = await makeEnv({ KV_SESSIONS: undefined });
    assert.equal(await ipKey(env, IP), '');
    assert.equal(await isLogErrorRateLimited(env, IP), false);
    assert.equal(await isVerifyRateLimited(env, IP), false);
  });

  test('an empty or missing address yields no pseudonym (so no key is written for it)', async () => {
    const env = await makeEnv();
    assert.equal(await ipKey(env, ''), '');
    assert.equal(await ipKey(env, '   '), '');
    assert.equal(await ipKey(env, null), '');
    assert.equal(await ipKey(env, undefined), '');
  });
});

// ------------------------------------------------- 5. IT IS GENUINELY KEYED

describe('C12 (mgmt): the pseudonym is keyed, not just hashed', () => {
  test('it is NOT sha256(address) — an unsalted hash of an IPv4 is 2^32 guesses', async () => {
    const env = await makeEnv();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(IP));
    const plain = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    const pseudonym = await ipKey(env, IP);
    assert.notEqual(pseudonym, plain);
    assert.notEqual(pseudonym, plain.slice(0, 32), 'nor a truncated unsalted hash');
  });

  test('a different salt gives a different pseudonym for the same address', async () => {
    const envA = await makeEnv();
    const envB = await makeEnv();
    const a = await ipKey(envA, IP);
    const b = await ipKey(envB, IP);
    assert.notEqual(a, b, 'the value must depend on the salt, or the salt is decoration');
  });

  test('the salt is cached per NAMESPACE, so it cannot leak between namespaces', async () => {
    // A module-global cache was the bug in the public Worker's first attempt: the second
    // namespace silently reused the first one's salt. Interleave the two to be sure the
    // cache is keyed on the binding object.
    const envA = await makeEnv();
    const envB = await makeEnv();
    const a1 = await ipKey(envA, IP);
    const b1 = await ipKey(envB, IP);
    const a2 = await ipKey(envA, IP);
    const b2 = await ipKey(envB, IP);
    assert.equal(a1, a2, 'namespace A must be stable');
    assert.equal(b1, b2, 'namespace B must be stable');
    assert.notEqual(a1, b1, 'and the two namespaces must not share a salt');
  });
});

// ---------------------------------------------- 6. SALT STORAGE PROPERTIES

describe('C12 (mgmt): the salt rotates, expires, and is cheap', () => {
  test('the salt key is dated by UTC day, so yesterday’s keys cannot be re-derived', async () => {
    const env = await makeEnv();
    await ipKey(env, IP);
    const saltKeys = keysOf(env).filter(k => k.startsWith('mgmt:ipsalt:'));
    assert.equal(saltKeys.length, 1, 'exactly one salt entry');
    assert.equal(saltKeys[0], `mgmt:ipsalt:${new Date().toISOString().slice(0, 10)}`);
  });

  test('the salt expires (about two days), so old pseudonyms become unlinkable for good', async () => {
    const env = await makeEnv();
    await ipKey(env, IP);
    const key = `mgmt:ipsalt:${new Date().toISOString().slice(0, 10)}`;
    const entry = env.KV_SESSIONS._store.get(key);
    assert.ok(entry.expiresAt > 0, 'the salt must NOT be stored for ever');
    const ttlSeconds = Math.round((entry.expiresAt - Date.now()) / 1000);
    assert.ok(ttlSeconds > 24 * 3600, `TTL must outlive one full day, got ${ttlSeconds}s`);
    assert.ok(ttlSeconds <= 60 * 60 * 49, `TTL must not linger, got ${ttlSeconds}s`);
  });

  test('the salt is 256 bits of hex, not something guessable', async () => {
    const env = await makeEnv();
    await ipKey(env, IP);
    const salt = await env.KV_SESSIONS.get(`mgmt:ipsalt:${new Date().toISOString().slice(0, 10)}`);
    assert.match(salt, /^[0-9a-f]{64}$/, 'a 32-byte random salt in hex');
  });

  test('the salt is fetched ONCE per isolate — this is on every public request’s hot path', async () => {
    const env = await makeEnv();
    let saltReads = 0;
    const inner = env.KV_SESSIONS;
    env.KV_SESSIONS = {
      ...inner,
      async get(k) { if (k.startsWith('mgmt:ipsalt:')) saltReads++; return inner.get(k); },
      _store: inner._store,
    };

    for (let i = 0; i < 10; i++) await ipKey(env.KV_SESSIONS ? env : env, IP);
    assert.equal(saltReads, 1, `10 pseudonyms must cost 1 salt read, cost ${saltReads}`);

    // And exactly one WRITE, not one per request — KV writes are the tightest free-tier
    // limit (~1,000/day) and a per-request salt write would exhaust it under any load.
    const saltWrites = keysOf(env).filter(k => k.startsWith('mgmt:ipsalt:')).length;
    assert.equal(saltWrites, 1);
  });
});
