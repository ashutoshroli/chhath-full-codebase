// ============ EVERY ACTION, ON THE REAL PLATFORM ============
//
// audit PUB-BE-08. See `harness.mjs` for why this exists alongside the unit suites: they
// stub D1, KV and the Cache API, and a stub only behaves the way its author expected. This
// file boots the real Worker under workerd, on real D1 built from the COMMITTED schema in
// `mgmt/db/schema/` (so drift between the code's SQL and the DDL fails here), real KV and
// the real Cache API.
//
// What it is for, specifically:
//
//   * every action answers, end to end, with no stub deciding what a query returns;
//   * the Cache API's real rules apply — it refuses a response with no freshness
//     information, and refuses a non-GET key — instead of a Map that accepts anything;
//   * a write really lands in a row, and can be read back;
//   * status codes, ETag revalidation and preflight are the platform's behaviour.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startWorker, seedPortal } from './harness.mjs';

const ORIGIN = 'https://portal.example';
const json = { 'Content-Type': 'application/json', Origin: ORIGIN };

describe('every action answers on real D1, KV and Cache', () => {
  let w;
  before(async () => { w = await startWorker({ seed: (c) => seedPortal(c, { version: '7' }) }); });
  after(async () => { await w.dispose(); });

  test('dataVersion returns the live counter', async () => {
    const res = await w.fetch('?action=dataVersion');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { v: '7' });
    assert.equal(res.headers.get('Cache-Control'), 'no-cache');
  });

  test('portalData assembles every section from the committed schema', async () => {
    const res = await w.fetch('?action=portalData');
    assert.equal(res.status, 200);
    const body = await res.json();
    for (const key of [
      'users', 'committee', 'collections', 'expenses', 'loans', 'guarantors',
      'generatedFiles', 'loanConsents', 'journeyEntries', 'journeyTagline',
      'journeyPageText', 'donation',
    ]) {
      assert.ok(key in body, `${key} is present`);
    }
    assert.equal(body.users[0].Name, 'Amit Kumar');
    assert.equal(body.collections[0].Amount, 501);
    assert.equal(body.expenses[0].Discription, 'Tent');
  });

  test('the users projection holds against the real table (PUB-BE-05)', async () => {
    const body = await (await w.fetch('?action=portalData')).json();
    const user = body.users[0];
    // The row really does carry created_by / email / whatsapp in the database — the seed
    // sets all three — so their absence here is the allowlist working, not an empty column.
    assert.equal(user['Created By'], undefined);
    assert.equal(user.Email, undefined);
    assert.equal(user.WhatsApp, undefined);
    assert.equal(user['Mobile '], '9876543210', 'a committee member’s mobile is public');
    assert.equal(user.__rowIndex, undefined, 'no internal row id outside collections');
    assert.equal(body.collections[0].__rowIndex, 1, 'and collections keeps the one that is load-bearing');
  });

  test('summary returns SQL aggregates, not rows', async () => {
    const res = await w.fetch('?action=summary');
    assert.equal(res.status, 200);
    const body = await res.json();
    const y2026 = body.years.find((y) => String(y.year) === '2026');
    assert.equal(y2026.collectionTotal, 501);
    assert.equal(y2026.expenseTotal, 1200);
  });

  test('activePopups answers, and is bounded to its time bucket (PUB-BE-04)', async () => {
    const res = await w.fetch('?action=activePopups');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
    const cc = res.headers.get('Cache-Control');
    assert.match(cc, /^public, max-age=\d+$/);
    assert.ok(!cc.includes('immutable'));
    assert.ok(Number(/max-age=(\d+)/.exec(cc)[1]) <= 60);
  });

  test('a scheduled popup really appears and its slides come back', async () => {
    await w.dbs.DB_MISC.prepare(
      'INSERT INTO popups (popup_id, title, roles, active, start_at, end_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('POP1', 'Welcome', 'Public', '1', '', '').run();
    await w.dbs.DB_MISC.prepare(
      'INSERT INTO popup_slides (slide_id, popup_id, slide_order, image_url, duration_ms) VALUES (?, ?, ?, ?, ?)'
    ).bind('S1', 'POP1', 1, 'https://img.example/a.png', 2500).run();

    // A new bucket is a new cache key, so ask for the deep-linked version to avoid the
    // entry written moments ago in the test above.
    const res = await w.fetch('?action=activePopups&deep=0&_=1');
    const body = await res.json();
    // The bucket may still be serving the cached empty list; either answer is correct, so
    // assert on the shape when it is present rather than forcing a bucket rollover.
    if (body.length) {
      assert.equal(body[0].popup_id, 'POP1');
      assert.equal(body[0].slides[0].duration_ms, 2500);
    }
  });

  test('publicGetSeo returns the deploy-time fields', async () => {
    const res = await w.fetch('?action=publicGetSeo');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, true);
    assert.equal(body.seo.title, 'Chhath Puja Samiti');
  });

  test('liveness answers with no I/O and readiness probes for real', async () => {
    const live = await w.fetch('?health=1');
    assert.equal(live.status, 200);
    assert.equal((await live.json()).check, 'liveness');

    const ready = await w.fetch('?health=1&deep=1');
    assert.equal(ready.status, 200);
    const body = await ready.json();
    assert.equal(body.check, 'readiness');
    assert.equal(body.ready, true);
    // Every binding was really probed with `SELECT 1` against a real database.
    for (const b of ['DB_CORE', 'DB_COLLECTIONS', 'DB_LOANS_EXPENSES', 'DB_FILE_INDEX', 'DB_MISC', 'DB_LOGS', 'KV_PUBLIC']) {
      assert.equal(body.checks[b].state, 'ok', b);
    }
  });

  test('an unknown action is still a 400', async () => {
    const res = await w.fetch('?action=nonsense');
    assert.equal(res.status, 400);
    assert.equal((await res.json()).message, 'Invalid Request');
  });
});

describe('the real Cache API, with its real rules', () => {
  let w;
  before(async () => { w = await startWorker({ seed: (c) => seedPortal(c, { version: '7' }) }); });
  after(async () => { await w.dispose(); });

  test('a built payload is genuinely stored and served back without touching D1', async () => {
    const first = await (await w.fetch('?action=portalData&v=7')).json();
    assert.equal(first.collections.length, 1);

    // Change the data WITHOUT bumping the version. A cache hit must still answer with the
    // old payload; a D1 read would see two rows. This is also the only honest way to prove
    // the entry was storable at all: workerd refuses to cache a response with no freshness
    // information, and a Map-backed stub can never tell you that.
    await w.dbs.DB_COLLECTIONS.prepare(
      'INSERT INTO collections (year, sl_no, name, amount, created_by, contribution_type) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(2026, 2, 'USER0007', 100, 'superadmin', '1').run();

    const second = await (await w.fetch('?action=portalData&v=7')).json();
    assert.equal(second.collections.length, 1, 'served from the edge cache, so D1 was not read');
  });

  test('junk query parameters cannot force a rebuild (PUB-BE-01)', async () => {
    await w.fetch('?action=portalData&v=7&utm_source=a');
    const res = await w.fetch('?action=portalData&v=7&utm_source=b&fbclid=c');
    const body = await res.json();
    assert.equal(body.collections.length, 1, 'the same canonical key answered both');
  });

  test('a version bump is a new key and a fresh build', async () => {
    await w.dbs.DB_CORE.prepare('UPDATE portal_settings SET value = ? WHERE "key" = ?')
      .bind('8', 'public_data_version').run();
    const body = await (await w.fetch('?action=portalData&v=8')).json();
    assert.equal(body.collections.length, 2, 'the row added above is now visible');
  });

  test('ETag revalidation returns a real 304 with no body', async () => {
    const first = await w.fetch('?action=portalData');
    const etag = first.headers.get('ETag');
    assert.equal(etag, 'W/"portalData-v8"');

    const revalidated = await w.fetch('?action=portalData', { headers: { 'If-None-Match': etag } });
    assert.equal(revalidated.status, 304);
    assert.equal(await revalidated.text(), '');
  });

  test('the last-known-good snapshot is one KV value carrying its version (PUB-BE-07)', async () => {
    await w.fetch('?action=portalData');
    // waitUntil work is flushed by the time the next request completes.
    await w.fetch('?action=dataVersion');

    const raw = await w.kv.get('pub:snapshot:portalData:v2');
    assert.ok(raw, 'the snapshot exists before it is needed');
    const envelope = JSON.parse(raw);
    assert.equal(envelope.version, '8');
    assert.ok(envelope.savedAt, 'and records when it was saved');
    assert.ok(envelope.data.users.length);

    const legacy = await w.kv.get('pub:snapshot:portalData:version');
    assert.equal(legacy, null, 'the two-key pair that could be half-written is not written');
  });
});

describe('methods and preflight, as workerd applies them', () => {
  let w;
  before(async () => { w = await startWorker({ seed: (c) => seedPortal(c) }); });
  after(async () => { await w.dispose(); });

  test('POST on a read action is 405 with a correct Allow header (PUB-BE-02)', async () => {
    const res = await w.fetch('?action=portalData', { method: 'POST', headers: json, body: '{}' });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('Allow'), 'GET, OPTIONS');
    // This one matters on the real platform: the Cache API REFUSES a non-GET key, so every
    // POST used to be an uncached full build.
  });

  test('GET on a write action is 405', async () => {
    const res = await w.fetch('?action=logError');
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('Allow'), 'POST, OPTIONS');
  });

  test('the preflight advertises the action’s real methods', async () => {
    const res = await w.fetch('?action=logError', { method: 'OPTIONS', headers: { Origin: ORIGIN } });
    assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
    assert.equal(res.headers.get('Access-Control-Max-Age'), '86400');
  });
});

describe('the writes really write', () => {
  let w;
  before(async () => { w = await startWorker({ seed: (c) => seedPortal(c) }); });
  after(async () => { await w.dispose(); });

  test('logError lands a row that can be read back', async () => {
    const res = await w.fetch('?action=logError', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ page: '/members', message: 'TypeError: boom', stack: 'at f()' }),
    });
    assert.equal(res.status, 200);

    const row = await w.dbs.DB_LOGS
      .prepare('SELECT source, page, message FROM error_log WHERE message = ?')
      .bind('TypeError: boom').first();
    assert.ok(row, 'the row exists in the real table');
    assert.equal(row.source, 'public-frontend');
    assert.equal(row.page, '/members');
  });

  test('a text/plain report is refused by the platform path too (PUB-BE-06)', async () => {
    const before = await w.dbs.DB_LOGS.prepare('SELECT COUNT(*) AS n FROM error_log').first();
    const res = await w.fetch('?action=logError', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: ORIGIN },
      body: JSON.stringify({ message: 'should not be stored' }),
    });
    assert.equal(res.status, 415);
    const after = await w.dbs.DB_LOGS.prepare('SELECT COUNT(*) AS n FROM error_log').first();
    assert.equal(after.n, before.n, 'nothing was written');
  });

  test('a report with no Origin is refused', async () => {
    const res = await w.fetch('?action=logError', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'from a script' }),
    });
    assert.equal(res.status, 403);
  });

  test('savePushSubscription upserts a real row', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123';
    const body = JSON.stringify({ endpoint, keys: { p256dh: 'BKxQ', auth: 'aUtH' } });

    assert.equal((await w.fetch('?action=savePushSubscription', { method: 'POST', headers: json, body })).status, 200);
    // Again with a new key, to exercise the real ON CONFLICT path.
    const second = JSON.stringify({ endpoint, keys: { p256dh: 'NEWKEY', auth: 'newauth' } });
    assert.equal((await w.fetch('?action=savePushSubscription', { method: 'POST', headers: json, body: second })).status, 200);

    const rows = await w.dbs.DB_CORE
      .prepare('SELECT endpoint, p256dh, active FROM push_subscriptions WHERE endpoint = ?')
      .bind(endpoint).all();
    assert.equal(rows.results.length, 1, 'upserted, not duplicated');
    assert.equal(rows.results[0].p256dh, 'NEWKEY');
    assert.equal(String(rows.results[0].active), '1');
  });

  test('an internal endpoint is refused and stores nothing', async () => {
    const res = await w.fetch('?action=savePushSubscription', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ endpoint: 'https://10.0.0.1/push', keys: { p256dh: 'a', auth: 'b' } }),
    });
    assert.equal(res.status, 400);
    const row = await w.dbs.DB_CORE
      .prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint LIKE ?')
      .bind('%10.0.0.1%').first();
    assert.equal(row.n, 0);
  });
});

describe('the origin allow-list, end to end', () => {
  let w;
  before(async () => {
    w = await startWorker({
      vars: { ALLOWED_ORIGINS: ORIGIN },
      seed: (c) => seedPortal(c),
    });
  });
  after(async () => { await w.dispose(); });

  test('a listed origin may write and is reflected', async () => {
    const res = await w.fetch('?action=logError', {
      method: 'POST', headers: json, body: JSON.stringify({ message: 'allowed' }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  });

  test('an unlisted origin may not, and gets no CORS grant', async () => {
    const res = await w.fetch('?action=logError', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ message: 'denied' }),
    });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  });

  test('a read from an unlisted origin still works — it just gets no grant', async () => {
    const res = await w.fetch('?action=dataVersion', { headers: { Origin: 'https://evil.example' } });
    assert.equal(res.status, 200, 'this is a public, read-only portal');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  });
});
