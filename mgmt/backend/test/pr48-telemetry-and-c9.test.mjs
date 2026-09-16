// audit PR-48 (telemetry) and carry-over C9.
//
// This portal is built out of fail-open fallbacks and almost all of them are correct.
// `verifyToken` re-reads the live role on every authenticated request and, if that read
// throws, carries on with the cached session — because failing closed would log every
// admin out during a transient D1 blip.
//
// C9 was never "that trade is wrong". It is that the trade was **completely silent**. A
// deployment where the read had been throwing all day reported `status: 'ok'` and looked
// identical to a healthy one, while every demoted or deleted account carried on with the
// rights it used to have. Nobody would find out.
//
// So what is tested here is audibility: the fallback still happens, and now something
// says so, somewhere an operator already looks.
//
// Run: node --test mgmt/backend/test/pr48-telemetry-and-c9.test.mjs

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeKV, makeD1, schemaFor } from './helpers/stubs.mjs';
import {
  recordDegradation, degradationReport, degradationSeverity, degradationKey, dayKey,
  newRequestId, requestSummary, DEGRADATIONS, DEGRADATION_TTL_SECONDS,
  REVOCATION_ALERT_THRESHOLD,
} from '../src/telemetry.js';
import { healthCheck } from '../src/config.js';

const KIND = DEGRADATIONS.REVOCATION_CHECK;

describe('recording a degradation', () => {
  test('it counts, expires by itself, and is readable back', async () => {
    const env = { KV_SESSIONS: makeKV() };
    await recordDegradation(env, KIND, 'D1_ERROR: read failed');
    await recordDegradation(env, KIND);
    await recordDegradation(env, KIND);

    // Readable back is the whole difference from a log line.
    assert.deepEqual(await degradationReport(env), { [KIND]: 3 });
    // Keyed per UTC day, so it expires without any cleanup job.
    assert.match(degradationKey(KIND), new RegExp(`^tel:degraded:${KIND}:\\d{4}-\\d{2}-\\d{2}$`));
    assert.equal(DEGRADATION_TTL_SECONDS, 172800);
  });

  test('a kind that has not happened is ABSENT, not zero', async () => {
    const env = { KV_SESSIONS: makeKV() };
    await recordDegradation(env, KIND);
    const report = await degradationReport(env);
    // A clean report is empty, so anything present is worth reading. Reporting every
    // kind as 0 would make the interesting number hard to find.
    assert.deepEqual(Object.keys(report), [KIND]);
    assert.equal(report[DEGRADATIONS.RATE_LIMIT], undefined);
  });

  test('an unknown kind is refused rather than creating a counter nobody reads', async () => {
    const env = { KV_SESSIONS: makeKV() };
    assert.equal(await recordDegradation(env, 'typo-kind'), false);
    assert.deepEqual(await degradationReport(env), {});
  });

  test('observing a failure never becomes a second failure', async () => {
    // This is called from inside catch blocks whose whole job is to keep working when
    // something is already broken. If it could throw, it would make the fallback it
    // observes less reliable than before it was observed.
    const angry = { get: async () => { throw new Error('KV down'); }, put: async () => { throw new Error('KV down'); } };
    assert.equal(await recordDegradation({ KV_SESSIONS: angry }, KIND), false);
    assert.equal(await recordDegradation({}, KIND), false, 'no KV binding at all');
    assert.equal(await recordDegradation(null, KIND), false);
  });

  test('"could not check" is distinguished from "nothing wrong"', async () => {
    // A health report that says nothing is wrong because it could not look is exactly
    // the failure this module was written about.
    const angry = { get: async () => { throw new Error('KV down'); }, put: async () => {} };
    const r = await degradationReport({ KV_SESSIONS: angry });
    assert.equal(r.unavailable, true);
    assert.equal(degradationSeverity(r), 'unknown');
    assert.equal(degradationSeverity(await degradationReport({})).valueOf(), 'unknown');
  });
});

describe('when it should actually alarm anybody', () => {
  test('a few failures are the blip the fallback exists for', () => {
    assert.equal(degradationSeverity({}), 'ok');
    assert.equal(degradationSeverity({ [KIND]: 1 }), 'ok');
    assert.equal(degradationSeverity({ [KIND]: REVOCATION_ALERT_THRESHOLD - 1 }), 'ok');
  });

  test('a sustained failure means the check has stopped running', () => {
    assert.equal(degradationSeverity({ [KIND]: REVOCATION_ALERT_THRESHOLD }), 'degraded');
    assert.equal(degradationSeverity({ [KIND]: 5000 }), 'degraded');
  });

  test('the non-security kinds are reported but never degrade the status', () => {
    // A rate limiter that could not count is a cost problem; retention skipping a table
    // is a storage problem. Both belong in the report. Neither should page anyone at
    // 2am, and a signal that cries wolf gets muted — which is how the property stops
    // being watched at all.
    assert.equal(degradationSeverity({ [DEGRADATIONS.RATE_LIMIT]: 100000 }), 'ok');
    assert.equal(degradationSeverity({ [DEGRADATIONS.RETENTION]: 500 }), 'ok');
    assert.equal(degradationSeverity({ [DEGRADATIONS.DATA_VERSION]: 500 }), 'ok');
  });
});

describe('the health endpoint is where it surfaces', () => {
  // A FULLY config-complete env. That matters: `healthCheck` reports 'degraded' when
  // config is incomplete too, so a half-built env would make the assertions below pass
  // (or fail) for the wrong reason. The first draft of this suite did exactly that — the
  // "a handful must not turn it red" test failed on missing config while looking like a
  // threshold bug.
  const okEnv = () => ({
    DB_CORE: makeD1(schemaFor('core.sql')),
    DB_COLLECTIONS: makeD1(), DB_LOANS_EXPENSES: makeD1(), DB_TEMPLATES: makeD1(),
    DB_FILE_INDEX: makeD1(), DB_WHATSAPP_INDEX: makeD1(), DB_LOGS: makeD1(), DB_MISC: makeD1(),
    KV_SESSIONS: makeKV(),
    PASSWORD_SALT: 's',
    CONSENT_BASE_URL: 'https://portal.example/consent',
  });

  test('the env this suite uses is genuinely healthy, or nothing below means anything', async () => {
    const report = await healthCheck(okEnv());
    assert.equal(report.configOk, true, `config incomplete: ${JSON.stringify(report.missing)}`);
    assert.equal(report.status, 'ok');
  });

  test('a healthy deployment reports an empty degradations block', async () => {
    const report = await healthCheck(okEnv());
    assert.deepEqual(report.degradations, {}, 'nothing degraded today');
  });

  test('a handful of revocation failures is reported without turning the status red', async () => {
    const env = okEnv();
    for (let i = 0; i < 3; i++) await recordDegradation(env, KIND);
    const report = await healthCheck(env);

    // Visible...
    assert.equal(report.degradations[KIND], 3);
    // ...but not alarming, because this is the transient case the fallback is for.
    assert.notEqual(report.status, 'degraded');
  });

  test('a sustained revocation failure turns the deployment DEGRADED', async () => {
    // THE POINT OF C9. Before this, an operator (and the uptime monitor reading this
    // endpoint) could not tell this deployment from a healthy one — while demoted and
    // deleted accounts kept working.
    const env = okEnv();
    for (let i = 0; i < REVOCATION_ALERT_THRESHOLD; i++) await recordDegradation(env, KIND);
    const report = await healthCheck(env);

    assert.equal(report.degradations[KIND], REVOCATION_ALERT_THRESHOLD);
    assert.equal(report.status, 'degraded');
    // And it is degraded for the RIGHT reason — the dependency checks are all fine, so
    // this cannot be mistaken for a database being down.
    assert.equal(report.checks.d1_core, 'ok');
    assert.equal(report.checks.kv_sessions, 'ok');
  });

  test('the report never carries a secret, only names and counts', async () => {
    const env = okEnv();
    await recordDegradation(env, KIND, 'D1_ERROR: connection to secret-host failed');
    const report = await healthCheck(env);
    // The `detail` argument goes to a console line, never into the readable report — the
    // health endpoint is reachable without the health token for its summary.
    assert.ok(!JSON.stringify(report).includes('secret-host'));
    assert.ok(!JSON.stringify(report).includes('PASSWORD_SALT="s"'));
  });
});

describe('the per-request line', () => {
  test('a request id is short, hex, and different each time', () => {
    const a = newRequestId();
    assert.match(a, /^[0-9a-f]{8}$/);
    const many = new Set(Array.from({ length: 200 }, newRequestId));
    assert.ok(many.size > 190, `ids collided too often: ${many.size}/200`);
  });

  test('the shape is stable and omits what it does not know', () => {
    // A log format that drifts is a log nothing can parse, so the shape is pinned.
    assert.equal(
      requestSummary({ requestId: 'ab12cd34', action: 'getUsers', method: 'POST', status: 200, ms: 41.6, cache: 'HIT', rowsRead: 12, bytesIn: 90, bytesOut: 4096, user: 'ashutosh' }),
      '[req] rid=ab12cd34 action=getUsers method=POST status=200 ms=42 cache=HIT rows=12 in=90 out=4096 user=ashutosh'
    );
    // Absent fields are omitted rather than emitted as null, so a line stays readable.
    assert.equal(requestSummary({ requestId: 'ff00ff00' }), '[req] rid=ff00ff00');
    assert.equal(requestSummary({}), '[req] rid=-');
  });

  test('it carries a name, never a token or a session id', () => {
    // This line goes to a log that is read casually and retained. "Who did it" is
    // answered by the name; a token in a log is a credential in a log.
    const line = requestSummary({ requestId: 'a', user: 'ashutosh', action: 'saveRecord' });
    assert.match(line, /user=ashutosh/);
    assert.ok(!/token/i.test(line));
  });

  test('a degraded request says so on its own line', () => {
    // So the request that ran on a cached role can be found later, not just counted.
    const line = requestSummary({ requestId: 'a', action: 'getUsers', degraded: KIND });
    assert.match(line, new RegExp(`degraded=${KIND}`));
  });

  test('a zero is reported, not dropped', () => {
    // `rows=0` is a real and interesting answer — a cache hit that read nothing. Using
    // truthiness here would have hidden exactly the case worth seeing.
    const line = requestSummary({ requestId: 'a', status: 0, ms: 0, rowsRead: 0, bytesOut: 0 });
    assert.match(line, /status=0/);
    assert.match(line, /ms=0/);
    assert.match(line, /rows=0/);
    assert.match(line, /out=0/);
  });
});

describe('C9 — the fallback still happens, and is now counted', () => {
  test('a failing role re-check keeps the session AND records the degradation', async () => {
    // Reproduces C9's exact situation: the KV session is valid, the live role read
    // throws. The request must still succeed (that is the availability trade) and the
    // system must now admit it.
    const { verifyToken, issueSession } = await import('../src/auth.js');
    const env = {
      KV_SESSIONS: makeKV(),
      DB_CORE: { prepare: () => ({ bind: () => ({ first: async () => { throw new Error('D1_ERROR: read failed'); } }) }) },
      DB_AUDIT: makeD1(schemaFor('audit.sql')),
      PASSWORD_SALT: 's',
    };
    const issued = await issueSession(env, { name: 'ashutosh', role: 'Superadmin' }, { remember: false });
    const token = issued && (issued.token || issued);

    const user = await verifyToken(env, token);

    // The trade is intact: a D1 blip does not log an admin out.
    assert.ok(user, 'the cached session must survive a failing re-check');
    assert.equal(user.name, 'ashutosh');
    // And it is no longer silent.
    const report = await degradationReport(env);
    assert.equal(report[KIND], 1, 'the failing revocation check was not recorded');
  });
});
