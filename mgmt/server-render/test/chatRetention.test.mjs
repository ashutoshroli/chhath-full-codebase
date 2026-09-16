// PR-32 — chat log retention.
//
// schema.sql shipped the retention policy as two commented-out DELETE statements under
// "OPTIONAL retention helper ... if you want to keep the free tier small". That framed a
// privacy commitment as housekeeping, and being a comment, nobody ran it — so every
// public question anyone had ever typed was still stored, alongside a pseudonym linking
// the conversation to a person.
//
// There is no Postgres in the environment this was written in, so the database is an
// INJECTED function and what is tested is every decision the sweep makes: whether to run
// at all, what the cutoff is, which statements in which order, how it bounds itself, and
// what it reports. The SQL text is asserted rather than executed — stated plainly here
// because it is the real limit of this suite.
//
// Run: node --test mgmt/server-render/test/chatRetention.test.mjs

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// config.js throws on a missing required var, so these come before the import that
// pulls it in — same pattern as the other suites here.
process.env.RENDER_API_KEY ||= 'k';
process.env.RENDER_WEBHOOK_SECRET ||= 'webhook-secret';
process.env.WORKER_WEBHOOK_URL ||= 'https://w.test/?render-webhook=1';
process.env.GITHUB_TOKEN ||= 'gh';
process.env.GITHUB_REPO ||= 'o/r';
process.env.ANTHROPIC_API_KEY ||= 'a';
process.env.DRIVE_OAUTH_CLIENT_ID ||= 'cid';
process.env.DRIVE_OAUTH_CLIENT_SECRET ||= 'csec';
process.env.DRIVE_OAUTH_REFRESH_TOKEN ||= 'rtok';

const {
  sweepChatRetention, sweepStatements, shouldSweep, markSwept, _resetSweepState,
  dayKey, SWEEP_BATCH, MAX_PASSES,
} = await import('../src/lib/chatRetention.js');
const { retentionDays, DEFAULT_CHAT_RETENTION_DAYS } = await import('../src/config.js');

/** A fake database that reports a fixed number of rows removed, then drains. */
function fakeDb(plan = []) {
  const calls = [];
  let i = 0;
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      const n = i < plan.length ? plan[i] : 0;
      i++;
      return { rowCount: n };
    },
  };
}

beforeEach(() => _resetSweepState());

describe('whether it runs at all', () => {
  test('0 days means keep everything, and is respected everywhere', async () => {
    // Disabling retention has to be a real choice, not a broken one: nothing should be
    // deleted and nothing should be reported as done.
    assert.equal(shouldSweep(Date.now(), 0), false);
    const db = fakeDb([100]);
    const r = await sweepChatRetention({ query: db.query, days: 0 });
    assert.equal(r.ran, false);
    assert.deepEqual(db.calls, [], 'nothing may be issued when retention is off');
  });

  test('no database means no sweep, not an empty success', async () => {
    const r = await sweepChatRetention({ query: null, days: 90 });
    assert.equal(r.ran, false);
    assert.equal(r.messages, 0);
  });

  test('at most once per UTC day, and a slept-through midnight is not punished', () => {
    const t1 = Date.parse('2026-09-16T10:00:00Z');
    assert.equal(shouldSweep(t1, 90), true);
    markSwept(t1);
    assert.equal(shouldSweep(t1, 90), false, 'twice in one day');
    assert.equal(shouldSweep(Date.parse('2026-09-16T23:59:00Z'), 90), false, 'still the same day');
    // A Render free instance sleeps through midnight. Comparing the day key rather than
    // running a timer means it sweeps on its next request instead of waiting another 24h.
    assert.equal(shouldSweep(Date.parse('2026-09-17T00:01:00Z'), 90), true);
  });

  test('the day key is UTC, not local', () => {
    assert.equal(dayKey(Date.parse('2026-09-16T23:30:00Z')), '2026-09-16');
    assert.equal(dayKey(Date.parse('2026-09-17T00:30:00Z')), '2026-09-17');
  });
});

describe('what it deletes, and in what order', () => {
  test('messages first, then sessions — and the order is the point', () => {
    const [msgs, sessions] = sweepStatements(90);

    assert.match(msgs[0], /DELETE FROM chat_messages/);
    assert.match(msgs[0], /created_at < now\(\) - \$1::interval/);
    assert.match(sessions[0], /DELETE FROM chat_sessions/);
    assert.match(sessions[0], /last_seen_at < now\(\) - \$1::interval/);
    assert.deepEqual(msgs[1], ['90 days']);
    assert.deepEqual(sessions[1], ['90 days']);
  });

  test('the sweep issues them in that order, every pass', async () => {
    // Sessions LAST because deleting one cascades to its messages. Reversing it would
    // leave old messages alive inside young, still-active sessions — the rows retention
    // exists to remove.
    const db = fakeDb([5, 3, 0, 0]);
    await sweepChatRetention({ query: db.query, days: 90 });
    assert.equal(db.calls.length, 4, 'two statements per pass, two passes');
    assert.match(db.calls[0].sql, /chat_messages/);
    assert.match(db.calls[1].sql, /chat_sessions/);
    assert.match(db.calls[2].sql, /chat_messages/);
    assert.match(db.calls[3].sql, /chat_sessions/);
  });

  test('the interval is a bound parameter, not string-built into the SQL', () => {
    // `days` comes from an environment variable. Interpolating it would be an injection
    // point in a statement whose whole job is to delete rows.
    const [msgs] = sweepStatements(30);
    assert.ok(!msgs[0].includes('30'), 'the day count must not appear in the SQL text');
    assert.deepEqual(msgs[1], ['30 days']);
  });

  test('a fractional or hostile day count cannot reach the interval', () => {
    assert.deepEqual(sweepStatements(90.7)[0][1], ['90 days']);
    // Defence in depth. The config layer already refuses anything unparseable, so this
    // cannot arrive in practice — but the interval is a string that ends up in a DELETE,
    // and "it cannot happen" is not a property worth relying on there.
    const weird = sweepStatements('7 days; DROP TABLE chat_messages')[0][1][0];
    assert.ok(!/DROP/i.test(weird), `the interval must not carry SQL: ${weird}`);
  });

  test('a misspelled CHAT_RETENTION_DAYS falls back to the default, NOT to "keep for ever"', () => {
    // The trap this avoids: `parseInt('ninety') || 0` is 0, and 0 means keep everything.
    // A one-character typo would have switched retention off while looking healthy.
    assert.equal(retentionDays(''), DEFAULT_CHAT_RETENTION_DAYS, 'unset takes the default');
    assert.equal(retentionDays(undefined), DEFAULT_CHAT_RETENTION_DAYS);
    assert.equal(retentionDays('ninety'), DEFAULT_CHAT_RETENTION_DAYS, 'a typo must not mean for ever');
    assert.equal(retentionDays('-5'), DEFAULT_CHAT_RETENTION_DAYS, 'negative is not a window');
    // And keeping everything stays possible — it just has to be typed.
    assert.equal(retentionDays('0'), 0);
    assert.equal(retentionDays('30'), 30);
    assert.equal(retentionDays('30.9'), 30);
  });

  test('each statement is bounded, so a first run on a huge table is not an outage', () => {
    const [msgs, sessions] = sweepStatements(90);
    assert.match(msgs[0], new RegExp(`LIMIT ${SWEEP_BATCH}`));
    assert.match(sessions[0], new RegExp(`LIMIT ${SWEEP_BATCH}`));
    // Postgres has no `DELETE ... LIMIT`, so the batch is chosen by ctid — its physical
    // row identifier — which needs no sortable key.
    assert.match(msgs[0], /ctid IN \(/);
  });
});

describe('what it reports', () => {
  test('the counts are what the database actually removed', async () => {
    const db = fakeDb([10, 4, 2, 1, 0, 0]);
    const r = await sweepChatRetention({ query: db.query, days: 90 });
    assert.equal(r.ran, true);
    assert.equal(r.messages, 12);   // 10 + 2
    assert.equal(r.sessions, 5);    // 4 + 1
    assert.equal(r.passes, 3);      // the third pass drained
    assert.equal(r.truncated, false);
  });

  test('it stops after one pass when there is nothing to remove', async () => {
    const db = fakeDb([0, 0]);
    const r = await sweepChatRetention({ query: db.query, days: 90 });
    assert.equal(r.passes, 1);
    assert.equal(db.calls.length, 2);
  });

  test('hitting the ceiling is REPORTED, not looped away', async () => {
    // A table nobody has pruned in months will not drain in one invocation. Looping
    // until empty would make the first run unbounded; the honest answer is to do a
    // bounded amount and say more remains.
    const db = fakeDb(new Array(MAX_PASSES * 2).fill(SWEEP_BATCH));
    const r = await sweepChatRetention({ query: db.query, days: 90 });
    assert.equal(r.passes, MAX_PASSES);
    assert.equal(r.truncated, true, 'must say that more is left');
    assert.equal(db.calls.length, MAX_PASSES * 2, 'and must not exceed its ceiling');
  });

  test('a failing query propagates — silent retention is no retention', async () => {
    // Unlike the chat logging helpers, which swallow errors so a log failure never
    // breaks an answer, this must NOT. Retention that quietly fails looks exactly like
    // retention that is working.
    const boom = async () => { throw new Error('connection terminated'); };
    await assert.rejects(() => sweepChatRetention({ query: boom, days: 90 }), /connection terminated/);
  });

  test('a successful sweep marks the day, so the next request does not repeat it', async () => {
    const now = Date.parse('2026-09-16T08:00:00Z');
    const db = fakeDb([1, 0, 0, 0]);
    assert.equal(shouldSweep(now, 90), true);
    await sweepChatRetention({ query: db.query, days: 90, now });
    assert.equal(shouldSweep(now, 90), false);
  });
});
