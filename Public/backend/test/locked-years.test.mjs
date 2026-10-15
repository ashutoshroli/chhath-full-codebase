// ============ PUBLIC WORKER — WHICH YEARS ARE LOCKED ============
//
// The Superadmin locks a year in the management portal's "Lock Data" page. A locked year takes
// no more add/edit/delete, so its records are final — and the public decade page needs to know,
// because it tells visitors which years are "not final yet". Until now the public payload said
// nothing about it, so the page could only guess from the calendar.
//
// `portalData` now carries `lockedYears`: [2017, 2018, ...]. What this file pins:
//
//   * the years come back as sorted, de-duplicated WHOLE NUMBERS (the column is TEXT, so every
//     value arrives as a string, and a blank spreadsheet-era cell must not become NaN);
//   * only the year leaves the server — not who locked it or when;
//   * `[]` is an answer ("nothing is locked"), distinct from the key being absent, which the
//     frontend reads as "not told" and answers with its calendar rule. So the key is ALWAYS
//     present, including when nothing is locked and when the table does not exist;
//   * a read that FAILS is not turned into `[]`. That would tell visitors that no year is final
//     because of a D1 hiccup; the build falls back to the saved copy instead, like every section;
//   * a lock or an unlock reaches the payload when the data version moves (the mgmt Worker bumps
//     it after both), and costs one read per build — none on a cache hit.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';

const BASE = 'https://api.example/';

let queryLog = [];

/**
 * A D1 stub. `rows` maps a fragment of SQL to its answer — an object, or a function (so a test
 * can change the answer between requests, or make it throw). `version` serves the data-version
 * row, which is what keys the cache.
 */
function d1(rows = {}, { version = null } = {}) {
  return {
    prepare(sql) {
      const flat = sql.replace(/\s+/g, ' ').trim();
      let args = [];
      const answer = () => {
        queryLog.push({ sql: flat, args });
        if (version && flat.includes('FROM portal_settings') && flat.includes('key')) {
          return { results: [{ key: 'public_data_version', value: version() }] };
        }
        for (const [needle, value] of Object.entries(rows)) {
          if (flat.includes(needle)) return typeof value === 'function' ? value() : value;
        }
        return { results: [] };
      };
      const stmt = {
        bind: (...a) => { args = a; return stmt; },
        all: async () => answer(),
        first: async () => (answer().results || [])[0] || null,
        run: async () => answer(),
      };
      return stmt;
    },
  };
}

function kv() {
  const store = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    _store: store,
  };
}

function installCache() {
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(req) {
        const e = store.get(typeof req === 'string' ? req : req.url);
        return e ? new Response(e.body, { headers: e.headers }) : undefined;
      },
      async put(req, res) { store.set(req.url, { body: await res.text(), headers: Object.fromEntries(res.headers) }); },
    },
  };
  return store;
}

const OTHER_TABLES = {
  'FROM users': { results: [{ id: 1, id_code: 'U1', name: 'Amit', name_hindi: '', village: '', village_hindi: '', designation: '', designation_hindi: '', fathers_name: '', fathers_name_hindi: '', photo: '', mobile: '9' }] },
  'FROM committee_members': { results: [] },
  'FROM collections': { results: [{ id: 5, year: 2026, name: 'U1', amount: 100, detail: '', contribution_type: '1', certificate_or_receipt: '', is_resell: '0' }] },
  'FROM expenses': { results: [] },
  'FROM loans': { results: [] },
  'FROM loan_guarantors': { results: [] },
  'FROM loan_consents': { results: [] },
  'FROM generated_files': { results: [] },
};

/** `locked` is what `SELECT year FROM locked_years` answers: an object, or a function that may throw. */
function makeEnv({ locked = { results: [] }, version = () => '9' } = {}) {
  return {
    DB_CORE: d1({ ...OTHER_TABLES, 'FROM locked_years': locked }, { version }),
    DB_COLLECTIONS: d1(OTHER_TABLES),
    DB_LOANS_EXPENSES: d1(OTHER_TABLES),
    DB_FILE_INDEX: d1(OTHER_TABLES),
    DB_MISC: d1({}),
    DB_LOGS: d1(),
    KV_PUBLIC: kv(),
  };
}

const pending = [];
const ctx = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})) };
const get = (env) => worker.fetch(new Request(`${BASE}?action=portalData`, { method: 'GET' }), env, ctx);
const lockedReads = () => queryLog.filter((q) => q.sql.includes('FROM locked_years'));

beforeEach(() => { queryLog = []; pending.length = 0; installCache(); });

describe('the years in the payload', () => {
  test('are sorted, de-duplicated whole numbers, whatever order and type the column hands back', async () => {
    // TEXT column: '2019' is a string. A bare number and a repeat are tolerated too.
    const env = makeEnv({ locked: { results: [{ year: '2019' }, { year: '2017' }, { year: 2018 }, { year: '2017' }] } });
    const body = await (await get(env)).json();
    assert.deepEqual(body.lockedYears, [2017, 2018, 2019]);
    assert.ok(body.lockedYears.every((y) => typeof y === 'number'), 'numbers, not strings');
  });

  test('read a year the way mgmt reads it to enforce the lock (parseInt), and drop what is not a year', async () => {
    const env = makeEnv({
      locked: {
        results: [
          { year: '2017' }, { year: ' 2018 ' }, // padding is tolerated, as parseInt tolerates it
          { year: '' }, { year: null }, { year: undefined }, // blank cells from the spreadsheet days
          { year: 'abc' }, { year: '0' }, { year: '-5' }, // not a year
        ],
      },
    });
    const body = await (await get(env)).json();
    assert.deepEqual(body.lockedYears, [2017, 2018]);
    assert.ok(!JSON.stringify(body.lockedYears).includes('null'), 'no NaN/null sneaks in');
  });

  test('say nothing about who locked a year or when', async () => {
    const env = makeEnv({
      locked: {
        results: [{ year: '2017', lockedby: 'Priya Superadmin', lockedat: '2026-10-15T09:30:00.000Z' }],
      },
    });
    const text = await (await get(env)).text();
    assert.ok(!text.includes('Priya'), 'the name of the admin who locked it is not public');
    assert.ok(!text.includes('2026-10-15T09:30'), 'nor is the moment');
    assert.deepEqual(JSON.parse(text).lockedYears, [2017]);

    // And the query asks for the year and nothing else, so a column added later cannot ship itself.
    const [read] = lockedReads();
    assert.match(read.sql, /^SELECT year FROM locked_years$/);
    assert.ok(!/lockedby|lockedat|\*/i.test(read.sql));
  });
});

describe('nothing locked is an answer, not a gap', () => {
  test('an empty table gives an empty list — the key is present', async () => {
    const body = await (await get(makeEnv())).json();
    assert.ok('lockedYears' in body, 'present, so the frontend can tell "none locked" from "not told"');
    assert.deepEqual(body.lockedYears, []);
  });

  test('a database without the table gives an empty list, and the rest of the portal is untouched', async () => {
    const env = makeEnv({
      locked: () => { throw new Error('D1_ERROR: no such table: locked_years: SQLITE_ERROR'); },
    });
    const res = await get(env);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body.lockedYears, []);
    assert.equal(body.stale, undefined, 'a live build, not the saved copy');
    assert.equal(body.users[0].Name, 'Amit');
    assert.equal(body.collections[0].Amount, 100);
  });

  test('a read that FAILS is not reported as "nothing is locked" — the saved copy is served instead', async () => {
    const env = makeEnv({
      locked: () => { throw new Error('D1_ERROR: D1 DB reset because its code was updated.'); },
    });
    env.KV_PUBLIC._store.set('pub:snapshot:portalData:v2', JSON.stringify({
      version: '8',
      savedAt: '2026-09-01T00:00:00.000Z',
      data: { users: [{ Name: 'Saved' }], lockedYears: [2017] },
    }));

    const body = await (await get(env)).json();
    assert.equal(body.stale, true, 'a degraded copy, marked as one');
    assert.deepEqual(body.lockedYears, [2017], 'with the answer it had when it was saved');
    assert.equal(body.users[0].Name, 'Saved');
  });
});

describe('a lock and an unlock reach the payload', () => {
  test('when the data version moves — which the mgmt Worker does after both', async () => {
    let version = '9';
    let rows = [{ year: '2017' }];
    const env = makeEnv({ version: () => version, locked: () => ({ results: rows }) });

    assert.deepEqual((await (await get(env)).json()).lockedYears, [2017]);

    rows = [{ year: '2017' }, { year: '2018' }]; // locked 2018 …
    version = '10'; //                            … and the counter moved
    assert.deepEqual((await (await get(env)).json()).lockedYears, [2017, 2018]);

    rows = [{ year: '2018' }]; //                 unlocked 2017
    version = '11';
    assert.deepEqual((await (await get(env)).json()).lockedYears, [2018]);

    rows = [];
    version = '12';
    assert.deepEqual((await (await get(env)).json()).lockedYears, []);
  });

  test('at the price of ONE read per build, and none on a cache hit', async () => {
    const env = makeEnv({ locked: { results: [{ year: '2017' }] } });

    await get(env);
    await Promise.all(pending); // the cache write is a waitUntil
    assert.equal(lockedReads().length, 1, 'one extra read for the build');

    const again = await (await get(env)).json();
    assert.equal(lockedReads().length, 1, 'the second request was served from the edge cache');
    assert.deepEqual(again.lockedYears, [2017]);
  });
});
