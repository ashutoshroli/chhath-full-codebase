// ============ PUBLIC WORKER — SCHEDULED POPUPS AND THEIR CACHE ============
//
// audit PUB-BE-04. `activePopups` is the one payload whose correct answer changes
// with the CLOCK rather than with the data version: eligibility is `start_at`/`end_at`
// versus now. It was nevertheless served `max-age=31536000, immutable` under an ETag
// of `activePopups-v<version>`, which does not change with time either — so a popup
// scheduled to open tomorrow was cached as "no popups" for a YEAR, and a popup that
// ended last night stayed cached as visible with revalidation answering 304.
//
// Also covered, from the same finding's additional observations:
//   * a malformed schedule stamp used to fail OPEN (shown immediately, forever)
//   * every slide of every popup was read on each rebuild, including popups that
//     were filtered out — D1 rows billed against a quota shared with mgmt

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';

const BASE = 'https://api.example/';
const VERSION = '9';

let prepared = [];

/** Minimal D1 stub. `rowsFor(sql, args)` decides what a statement returns. */
function d1(rowsFor = () => ({ results: [] })) {
  return {
    prepare(sql) {
      const flat = sql.replace(/\s+/g, ' ').trim();
      let args = [];
      const stmt = {
        bind: (...a) => { args = a; return stmt; },
        all: async () => { prepared.push({ sql: flat, args }); return rowsFor(flat, args); },
        first: async () => {
          prepared.push({ sql: flat, args });
          return (rowsFor(flat, args).results || [])[0] || null;
        },
        run: async () => { prepared.push({ sql: flat, args }); return { success: true }; },
      };
      return stmt;
    },
  };
}

function kv() {
  const map = new Map();
  return {
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async put(k, v) { map.set(k, v); },
  };
}

function installCache() {
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(req) {
        const entry = store.get(typeof req === 'string' ? req : req.url);
        return entry ? new Response(entry.body, { headers: entry.headers }) : undefined;
      },
      async put(req, res) {
        if (req.method && req.method !== 'GET') throw new Error('Cannot cache a non-GET request');
        store.set(req.url, { body: await res.text(), headers: Object.fromEntries(res.headers) });
      },
    },
  };
  return store;
}

const POPUP_COLS = 'popup_id, title, roles, active, start_at, end_at';
const isPopupQuery = (sql) => sql.includes('FROM popups');
const isSlideQuery = (sql) => sql.includes('FROM popup_slides');

/** An env whose `popups` table holds exactly `rows`, with one slide each. */
function envWithPopups(rows, slidesByPopup) {
  const slides = slidesByPopup || Object.fromEntries(
    rows.map((r, i) => [r.popup_id, [{
      slide_id: `S${i}`, popup_id: r.popup_id, slide_order: 1,
      image_url: `https://img.example/${r.popup_id}.png`,
      text: '', link_url: '', link_text: '', duration_ms: null,
    }]])
  );

  const misc = d1((sql, args) => {
    if (isPopupQuery(sql)) {
      // The Worker's pre-filter is SQL, so the stub applies the same two permissive
      // conditions rather than pretending every row comes back.
      return {
        results: rows.filter(r =>
          (r.roles || '').includes('Public')
          && ['1', 'true', 'yes'].includes((r.active == null ? '' : r.active).toString().trim().toLowerCase())),
      };
    }
    if (isSlideQuery(sql)) {
      const wanted = new Set(args);
      return { results: Object.entries(slides)
        .filter(([id]) => wanted.has(id))
        .flatMap(([, v]) => v) };
    }
    return { results: [] };
  });

  return {
    DB_CORE: d1(() => ({ results: [{ key: 'public_data_version', value: VERSION }] })),
    DB_COLLECTIONS: d1(),
    DB_LOANS_EXPENSES: d1(),
    DB_FILE_INDEX: d1(),
    DB_MISC: misc,
    DB_LOGS: d1(),
    KV_PUBLIC: kv(),
  };
}

const pending = [];
const ctx = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})) };

const popupReq = (query = '', headers = {}) =>
  new Request(`${BASE}?action=activePopups${query}`, { method: 'GET', headers });

const iso = (ms) => new Date(ms).toISOString();

let realNow;
function freezeTime(ms) {
  realNow = Date.now;
  Date.now = () => ms;
}

let cacheStore;
beforeEach(() => { prepared = []; pending.length = 0; cacheStore = installCache(); });
afterEach(() => { if (realNow) { Date.now = realNow; realNow = undefined; } });

// A round bucket boundary keeps the arithmetic in the assertions obvious.
const T0 = 1789000000000 - (1789000000000 % 60000); // aligned to a 60s bucket

describe('a scheduled popup is not cached past its own schedule (PUB-BE-04)', () => {
  test('a popup that opens later is NOT served, and that answer is not immutable', async () => {
    freezeTime(T0);
    const env = envWithPopups([{
      popup_id: 'POP1', title: 'Chhath Puja', roles: 'Public', active: '1',
      start_at: iso(T0 + 10 * 60 * 1000), end_at: '',
    }]);

    const res = await worker.fetch(popupReq(`&v=${VERSION}`), env, ctx);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [], 'it has not opened yet');

    const cc = res.headers.get('Cache-Control');
    // THE defect: passing the current ?v= used to earn
    // `public, max-age=31536000, immutable`, so this "no popups" answer outlived the
    // popup's entire scheduled run in every visitor's browser.
    assert.ok(!cc.includes('immutable'), `must not be immutable, got: ${cc}`);
    assert.ok(!cc.includes('stale-while-revalidate'),
      'nor may a client keep showing it after expiry');
    const maxAge = Number(/max-age=(\d+)/.exec(cc)[1]);
    assert.ok(maxAge >= 1 && maxAge <= 60, `bounded to one bucket, got ${maxAge}`);
  });

  test('the same popup IS served once its start time has passed', async () => {
    const start = T0 + 10 * 60 * 1000;
    const row = {
      popup_id: 'POP1', title: 'Chhath Puja', roles: 'Public', active: '1',
      start_at: iso(start), end_at: '',
    };

    freezeTime(T0);
    const before = await (await worker.fetch(popupReq(), envWithPopups([row]), ctx)).json();
    assert.deepEqual(before, [], 'before the window');

    freezeTime(start + 1000);
    const after = await (await worker.fetch(popupReq(), envWithPopups([row]), ctx)).json();
    assert.equal(after.length, 1, 'inside the window');
    assert.equal(after[0].popup_id, 'POP1');
  });

  test('an expired popup stops being served, and its ETag no longer validates', async () => {
    const end = T0 + 60 * 1000;
    const row = {
      popup_id: 'POP1', title: 'Ends soon', roles: 'Public', active: '1',
      start_at: '', end_at: iso(end),
    };
    const env = envWithPopups([row]);

    freezeTime(T0);
    const live = await worker.fetch(popupReq(), env, ctx);
    const liveEtag = live.headers.get('ETag');
    assert.equal((await live.json()).length, 1, 'live while inside the window');

    // A client that revalidates with the ETag it was given, after the popup ended.
    freezeTime(end + 30 * 1000);
    const revalidated = await worker.fetch(
      popupReq('', { 'If-None-Match': liveEtag }), envWithPopups([row]), ctx);

    // Before: the ETag was `activePopups-v<version>` with no time component, so this
    // returned 304 and the browser kept showing an expired popup indefinitely.
    assert.notEqual(revalidated.status, 304,
      'a stale validator must not be able to keep an expired popup on screen');
    assert.equal(revalidated.status, 200);
    assert.deepEqual(await revalidated.json(), [], 'and the popup is gone');
    assert.notEqual(revalidated.headers.get('ETag'), liveEtag, 'the validator moved on');
  });

  test('within one bucket the answer is a cache hit; a new bucket rebuilds', async () => {
    const row = {
      popup_id: 'POP1', title: 'Live', roles: 'Public', active: '1', start_at: '', end_at: '',
    };
    const env = envWithPopups([row]);

    freezeTime(T0);
    await worker.fetch(popupReq(), env, ctx);
    await Promise.all(pending);
    const afterFirst = prepared.filter(p => isPopupQuery(p.sql)).length;
    assert.equal(afterFirst, 1, 'the first request builds');

    // Ten more requests in the same bucket.
    for (let i = 0; i < 10; i++) {
      freezeTime(T0 + i * 1000);
      await worker.fetch(popupReq(), env, ctx);
    }
    assert.equal(prepared.filter(p => isPopupQuery(p.sql)).length, afterFirst,
      'every request inside the bucket is served from the edge, with no popup query');

    freezeTime(T0 + 61 * 1000); // next bucket
    await worker.fetch(popupReq(), env, ctx);
    assert.equal(prepared.filter(p => isPopupQuery(p.sql)).length, afterFirst + 1,
      'the new bucket is a new key, so it rebuilds exactly once');
  });

  test('the client max-age lands every visitor on the same bucket boundary', async () => {
    const env = envWithPopups([]);
    for (const offset of [0, 15, 45, 59]) {
      freezeTime(T0 + offset * 1000);
      const res = await worker.fetch(popupReq(), env, ctx);
      const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('Cache-Control'))[1]);
      assert.equal(maxAge, 60 - offset, `at +${offset}s the answer expires with the bucket`);
    }
  });

  test('a data version bump still invalidates immediately, bucket or not', async () => {
    freezeTime(T0);
    const row = { popup_id: 'POP1', title: 'A', roles: 'Public', active: '1', start_at: '', end_at: '' };

    const env = envWithPopups([row]);
    const first = await worker.fetch(popupReq(), env, ctx);
    await Promise.all(pending);

    // Same clock, new version: a different key and a different validator.
    const bumped = envWithPopups([row]);
    bumped.DB_CORE = d1(() => ({ results: [{ key: 'public_data_version', value: '10' }] }));
    const second = await worker.fetch(popupReq(), bumped, ctx);

    assert.notEqual(second.headers.get('ETag'), first.headers.get('ETag'));
    assert.equal(prepared.filter(p => isPopupQuery(p.sql)).length, 2, 'rebuilt for the new version');
  });
});

describe('a schedule that cannot be read fails closed (PUB-BE-04)', () => {
  const junk = ['22/08/2026', 'tomorrow', '2026-13-45', 'not a date'];

  for (const bad of junk) {
    test(`a malformed start_at (${bad}) does not go live`, async () => {
      freezeTime(T0);
      const env = envWithPopups([{
        popup_id: 'POP1', title: 'Typo', roles: 'Public', active: '1', start_at: bad, end_at: '',
      }]);
      const body = await (await worker.fetch(popupReq(), env, ctx)).json();
      // Before: parseStoredDate returned null for junk exactly as it does for an
      // empty value, so the window check was skipped and the popup showed at once —
      // and, having no readable end either, never stopped.
      assert.deepEqual(body, [], 'an unreadable schedule must not be served');
    });
  }

  test('a malformed end_at does not go live either', async () => {
    freezeTime(T0);
    const env = envWithPopups([{
      popup_id: 'POP1', title: 'Typo', roles: 'Public', active: '1',
      start_at: iso(T0 - 60000), end_at: 'whenever',
    }]);
    assert.deepEqual(await (await worker.fetch(popupReq(), env, ctx)).json(), []);
  });

  test('an EMPTY stamp still means unbounded, which is not the same as unreadable', async () => {
    freezeTime(T0);
    const env = envWithPopups([{
      popup_id: 'POP1', title: 'Always on', roles: 'Public', active: '1', start_at: '', end_at: null,
    }]);
    const body = await (await worker.fetch(popupReq(), env, ctx)).json();
    assert.equal(body.length, 1, 'a popup with no schedule at all runs indefinitely');
  });

  test('the legacy space-separated stamp is still read as UTC', async () => {
    freezeTime(T0);
    const stamp = iso(T0 - 3600 * 1000).replace('T', ' ').replace(/\.\d+Z$/, '');
    const env = envWithPopups([{
      popup_id: 'POP1', title: 'Legacy row', roles: 'Public', active: '1',
      start_at: stamp, end_at: '',
    }]);
    assert.equal((await (await worker.fetch(popupReq(), env, ctx)).json()).length, 1,
      'the migrated format must keep working — it is not "malformed"');
  });
});

describe('only eligible popups are read (PUB-BE-04)', () => {
  test('slides are fetched for the eligible popups only', async () => {
    freezeTime(T0);
    const rows = [
      { popup_id: 'LIVE', title: 'Live', roles: 'Public', active: '1', start_at: '', end_at: '' },
      { popup_id: 'OFF', title: 'Inactive', roles: 'Public', active: '0', start_at: '', end_at: '' },
      { popup_id: 'MGMT', title: 'Internal', roles: 'Admin', active: '1', start_at: '', end_at: '' },
      { popup_id: 'LATER', title: 'Scheduled', roles: 'Public', active: '1',
        start_at: iso(T0 + 3600 * 1000), end_at: '' },
    ];
    const env = envWithPopups(rows);

    const body = await (await worker.fetch(popupReq(), env, ctx)).json();
    assert.deepEqual(body.map(p => p.popup_id), ['LIVE']);

    const slideQueries = prepared.filter(p => isSlideQuery(p.sql));
    assert.equal(slideQueries.length, 1);
    // Before: an unconditional `SELECT ... FROM popup_slides` read every slide of
    // every popup, including the three that were filtered out. D1 bills rows read,
    // against a quota shared with the management API.
    assert.deepEqual(slideQueries[0].args, ['LIVE'],
      'bound to the eligible popup ids, not left unbounded');
  });

  test('no eligible popup means no slide query at all', async () => {
    freezeTime(T0);
    const env = envWithPopups([
      { popup_id: 'OFF', title: 'Inactive', roles: 'Public', active: '0', start_at: '', end_at: '' },
    ]);
    assert.deepEqual(await (await worker.fetch(popupReq(), env, ctx)).json(), []);
    assert.equal(prepared.filter(p => isSlideQuery(p.sql)).length, 0);
  });

  test('the popup pre-filter is applied in SQL, not after reading the table', async () => {
    freezeTime(T0);
    const env = envWithPopups([]);
    await worker.fetch(popupReq(), env, ctx);
    const q = prepared.find(p => isPopupQuery(p.sql));
    assert.match(q.sql, /WHERE/, 'the table is no longer read unconditionally');
    assert.match(q.sql, /roles LIKE/);
    // The 'True' written by the sheet migration must still match: `active = 1` alone
    // was the original bug, since TEXT affinity makes it match '1' and nothing else.
    assert.match(q.sql, /lower\(trim\(active\)\)/);
    assert.match(q.sql, new RegExp(POPUP_COLS.replace(/, /g, ', ')),
      'and it still selects only the columns the payload needs');
  });

  test('slides keep their order even though they arrive in chunks', async () => {
    freezeTime(T0);
    const rows = [{ popup_id: 'P', title: 'T', roles: 'Public', active: '1', start_at: '', end_at: '' }];
    const env = envWithPopups(rows, {
      P: [
        { slide_id: 'c', popup_id: 'P', slide_order: 3, image_url: 'c', text: '', link_url: '', link_text: '', duration_ms: 2000 },
        { slide_id: 'a', popup_id: 'P', slide_order: 1, image_url: 'a', text: '', link_url: '', link_text: '', duration_ms: null },
        { slide_id: 'b', popup_id: 'P', slide_order: 2, image_url: 'b', text: '', link_url: '', link_text: '', duration_ms: 999 },
      ],
    });
    const body = await (await worker.fetch(popupReq(), env, ctx)).json();
    assert.deepEqual(body[0].slides.map(s => s.slide_id), ['a', 'b', 'c']);
    // Unchanged normalisation: missing -> 5000, below the floor -> 1000.
    assert.deepEqual(body[0].slides.map(s => s.duration_ms), [5000, 1000, 2000]);
  });
});
