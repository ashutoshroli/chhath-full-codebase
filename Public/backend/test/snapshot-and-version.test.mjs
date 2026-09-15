// ============ PUBLIC WORKER — THE SAFETY NET AND THE VERSION IT IS KEYED ON ============
//
// Two findings from the same area, both about a failure that is invisible until the
// moment it matters.
//
// 1. The last-known-good snapshot lived in TWO KV keys — the body and "which version the
//    body is for" — written together with `Promise.all` inside `ctx.waitUntil`, so
//    nothing ever observed the result. KV has no transactions. If the VERSION write
//    landed and the BODY write did not, the pair claims the previous body is current,
//    and because the writer skips whenever the recorded version already matches, it is
//    never corrected. The safety net then holds the wrong data permanently, and this is
//    discovered during the D1 outage it exists for.
//
//    Its size guard also compared `body.length` — UTF-16 code units — against a limit
//    expressed in BYTES, while this payload is full of Devanagari at three UTF-8 bytes
//    per code unit. It under-counted by up to 3x on exactly the data it protects.
//
// 2. `getDataVersion` answered `'0'` when the read FAILED, and `'0'` is a perfectly
//    valid version that this Worker builds its whole cache identity out of. So a D1
//    hiccup cached whatever it managed to build under the key `v=0` with an ETag of
//    `…-v0`, and every later failure produced that same identity — serving the one bad
//    build back as a cache hit, indefinitely.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';

const BASE = 'https://api.example/';

function d1(rows = {}, { fail = false } = {}) {
  return {
    prepare(sql) {
      const flat = sql.replace(/\s+/g, ' ').trim();
      let args = [];
      const answer = () => {
        for (const [needle, value] of Object.entries(rows)) {
          if (flat.includes(needle)) return value;
        }
        return { results: [] };
      };
      const boom = async () => { throw new Error('D1_ERROR: network error'); };
      const stmt = {
        bind: (...a) => { args = a; return stmt; },
        all: fail ? boom : async () => answer(),
        first: fail ? boom : async () => (answer().results || [])[0] || null,
        run: fail ? boom : async () => ({ success: true }),
      };
      return stmt;
    },
  };
}

/** A KV stub that records writes and can be told to fail specific keys. */
function kv({ failKeys = [] } = {}) {
  const store = new Map();
  const puts = [];
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v, opts) {
      puts.push({ key: k, value: v, opts });
      if (failKeys.some((f) => k.includes(f))) throw new Error('KV_ERROR: value too large');
      store.set(k, String(v));
    },
    async delete(k) { store.delete(k); },
    _store: store,
    _puts: () => puts,
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

const PORTAL_TABLES = {
  'FROM users': { results: [{ id: 1, id_code: 'U1', name: 'Amit', name_hindi: 'अमित', village: 'Baragaon', village_hindi: 'बड़गाँव', designation: 'Member', designation_hindi: 'सदस्य', fathers_name: 'Ram', fathers_name_hindi: 'राम', photo: '', mobile: '9' }] },
  'FROM committee_members': { results: [{ id: 1, year: 2026, name: 'U1', view_role: 'T', view_role_hindi: 'क' }] },
  'FROM collections': { results: [{ id: 5, year: 2026, name: 'U1', amount: 100, detail: '', contribution_type: '1', certificate_or_receipt: '', is_resell: '0' }] },
  'FROM expenses': { results: [] },
  'FROM loans': { results: [] },
  'FROM loan_guarantors': { results: [] },
  'FROM loan_consents': { results: [] },
  'FROM generated_files': { results: [] },
};

function makeEnv({ version = '9', kvOpts = {}, coreFails = false } = {}) {
  const core = coreFails
    ? d1({}, { fail: true })
    : d1({ 'FROM portal_settings': { results: [{ key: 'public_data_version', value: version }] }, ...PORTAL_TABLES });
  return {
    DB_CORE: core,
    DB_COLLECTIONS: d1(PORTAL_TABLES),
    DB_LOANS_EXPENSES: d1(PORTAL_TABLES),
    DB_FILE_INDEX: d1(PORTAL_TABLES),
    DB_MISC: d1(),
    DB_LOGS: d1(),
    KV_PUBLIC: kv(kvOpts),
  };
}

const pending = [];
const ctx = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})) };
const get = (env, query = '?action=portalData') =>
  worker.fetch(new Request(`${BASE}${query}`, { method: 'GET' }), env, ctx);

beforeEach(() => { pending.length = 0; installCache(); });

describe('the snapshot is one value that cannot be half-written', () => {
  test('a snapshot write is a single KV put carrying its own version', async () => {
    const env = makeEnv();
    await get(env);
    await Promise.all(pending);

    const snapshotPuts = env.KV_PUBLIC._puts().filter((p) => p.key.includes('snapshot'));
    // Before: two puts — the body and a separate ":version" key — with no transaction
    // between them and nothing observing either.
    assert.equal(snapshotPuts.length, 1, 'one put, so there is no partial state to land in');

    const stored = JSON.parse(snapshotPuts[0].value);
    assert.equal(stored.version, '9', 'the version travels INSIDE the value');
    assert.ok(stored.savedAt, 'and so does when it was saved');
    assert.ok(stored.data.users.length, 'along with the payload itself');
  });

  test('the version and the body can never disagree, because they are one write', async () => {
    const env = makeEnv();
    await get(env);
    await Promise.all(pending);
    const keys = [...env.KV_PUBLIC._store.keys()].filter((k) => k.includes('snapshot'));
    assert.deepEqual(keys, ['pub:snapshot:portalData:v2']);
    // The v1 ":version" key is not written at all any more, so it cannot be left
    // pointing at a body that was never stored.
    assert.ok(!keys.some((k) => k.endsWith(':version')));
  });

  test('a second request at the same version does not write again', async () => {
    const env = makeEnv();
    await get(env);
    await Promise.all(pending);
    const after = env.KV_PUBLIC._puts().filter((p) => p.key.includes('snapshot')).length;

    installCache(); // force a rebuild rather than an edge hit
    await get(env);
    await Promise.all(pending);
    assert.equal(env.KV_PUBLIC._puts().filter((p) => p.key.includes('snapshot')).length, after,
      'the KV write budget is ~1000/day and shared; one write per real data change');
  });

  test('a failed snapshot write is recorded instead of vanishing', async () => {
    const env = makeEnv({ kvOpts: { failKeys: ['snapshot'] } });
    const logged = [];
    env.DB_LOGS = {
      prepare(sql) {
        const flat = sql.replace(/\s+/g, ' ').trim();
        let args = [];
        const stmt = {
          bind: (...a) => { args = a; return stmt; },
          all: async () => { if (/^INSERT/i.test(flat)) logged.push(args); return { results: [] }; },
          first: async () => null,
          run: async () => { if (/^INSERT/i.test(flat)) logged.push(args); return { success: true }; },
        };
        return stmt;
      },
    };

    const res = await get(env);
    assert.equal(res.status, 200, 'snapshotting must never affect the response');
    await Promise.all(pending);

    // Before: the rejected put was passed to waitUntil inside a bare catch, so the
    // safety net silently stopped existing and nobody found out until D1 was down.
    const text = JSON.stringify(logged);
    assert.match(text, /Snapshot write FAILED/);
    assert.match(text, /KV_ERROR/);
  });
});

describe('the size guard counts bytes, not code units', () => {
  test('a Devanagari-heavy payload is measured in UTF-8 bytes', async () => {
    // One string of 8 million Devanagari characters: 8M UTF-16 code units, but 24 MB of
    // UTF-8 — inside the old guard's 20 MB and past KV's 25 MB hard limit.
    const env = makeEnv();
    env.DB_CORE = d1({
      'FROM portal_settings': { results: [{ key: 'public_data_version', value: '9' }] },
      'FROM users': { results: [{ id: 1, id_code: 'U1', name: 'x', name_hindi: 'अ'.repeat(8_000_000), village: '', village_hindi: '', designation: '', designation_hindi: '', fathers_name: '', fathers_name_hindi: '', photo: '', mobile: '' }] },
      'FROM committee_members': { results: [] },
    });

    const res = await get(env);
    assert.equal(res.status, 200, 'the response is unaffected either way');
    await Promise.all(pending);

    const snapshotPuts = env.KV_PUBLIC._puts().filter((p) => p.key.includes('snapshot'));
    assert.equal(snapshotPuts.length, 0,
      'refused before the put, because 8M Devanagari characters are 24 MB of UTF-8');
  });

  test('an ordinary payload is still snapshotted', async () => {
    const env = makeEnv();
    await get(env);
    await Promise.all(pending);
    assert.equal(env.KV_PUBLIC._puts().filter((p) => p.key.includes('snapshot')).length, 1);
  });
});

describe('a version that could not be read is not a version', () => {
  test('portalData serves the saved copy rather than inventing v=0', async () => {
    // Seed a snapshot, then break D1 entirely.
    const warm = makeEnv();
    await get(warm);
    await Promise.all(pending);
    const saved = warm.KV_PUBLIC._store.get('pub:snapshot:portalData:v2');

    const broken = makeEnv({ coreFails: true });
    broken.KV_PUBLIC._store.set('pub:snapshot:portalData:v2', saved);

    const res = await get(broken);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.stale, true, 'and it is labelled a saved copy, not passed off as live');
    assert.ok(body.savedAt, 'with the age the frontend shows (PUB-FE-01)');
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  });

  test('with no saved copy, the answer is an explicit 503 — never a v=0 payload', async () => {
    const res = await get(makeEnv({ coreFails: true }));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.unavailable, true);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.equal(res.headers.get('ETag'), null, 'nothing cacheable can be keyed on an unknown version');
  });

  test('a failed version read cannot poison the edge cache', async () => {
    const cacheStore = installCache();
    await get(makeEnv({ coreFails: true }));
    // Before: the build ran with version '0', so its (possibly empty) payload was stored
    // under `…?v=0` and every later failure was served that same entry as a cache HIT.
    assert.equal([...cacheStore.keys()].length, 0, 'nothing was written to the edge cache');
    assert.ok(![...cacheStore.keys()].some((k) => k.includes('v=0')));
  });

  for (const action of ['dataVersion', 'summary', 'activePopups']) {
    test(`${action} reports unavailable instead of answering with version 0`, async () => {
      const res = await get(makeEnv({ coreFails: true }), `?action=${action}`);
      assert.equal(res.status, 503, 'an unreadable version is not version zero');
      assert.equal((await res.json()).unavailable, true);
    });
  }

  test('a genuinely absent counter row IS version 0, and still works', async () => {
    // A fresh deployment the mgmt Worker has never bumped. This is the one case where
    // '0' is the truth, and it must not be confused with a failure.
    const env = makeEnv();
    env.DB_CORE = d1({ 'FROM portal_settings': { results: [] }, ...PORTAL_TABLES });
    const res = await get(env, '?action=dataVersion');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { v: '0' });
  });
});

describe('an older deployment keeps its safety net', () => {
  test('a v1 snapshot pair is still read when there is no v2 value', async () => {
    const env = makeEnv({ coreFails: true });
    env.KV_PUBLIC._store.set('pub:snapshot:portalData', JSON.stringify({ users: [{ Name: 'From v1' }] }));
    env.KV_PUBLIC._store.set('pub:snapshot:portalData:version', '8');

    const res = await get(env);
    assert.equal(res.status, 200, 'the old value must not be orphaned by the format change');
    const body = await res.json();
    assert.equal(body.stale, true);
    assert.equal(body.users[0].Name, 'From v1');
  });

  test('a v2 value wins over a v1 pair', async () => {
    const env = makeEnv({ coreFails: true });
    env.KV_PUBLIC._store.set('pub:snapshot:portalData', JSON.stringify({ users: [{ Name: 'From v1' }] }));
    env.KV_PUBLIC._store.set('pub:snapshot:portalData:version', '8');
    env.KV_PUBLIC._store.set('pub:snapshot:portalData:v2', JSON.stringify({
      version: '9', savedAt: '2026-09-15T00:00:00.000Z', data: { users: [{ Name: 'From v2' }] },
    }));

    const body = await (await get(env)).json();
    assert.equal(body.users[0].Name, 'From v2');
    assert.equal(body.savedAt, '2026-09-15T00:00:00.000Z');
  });

  test('a corrupt snapshot value is ignored rather than served', async () => {
    const env = makeEnv({ coreFails: true });
    env.KV_PUBLIC._store.set('pub:snapshot:portalData:v2', 'not json');
    const res = await get(env);
    assert.equal(res.status, 503, 'unreadable is unavailable, not a payload');
  });
});
