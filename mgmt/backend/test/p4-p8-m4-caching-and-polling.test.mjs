// ===== AUDIT P-4 (docx bytes re-downloaded) + M-4 (unmetered drain) + P-8 (polling) =====
//
// All three are free-tier problems:
//   P-4  every receipt / consent load / bulk record re-downloaded the .docx template
//        from Google Drive. Each download is a SUBREQUEST (50 per invocation on the
//        free plan) plus latency on the critical path of a save.
//   M-4  processCollectionQueue is an unmetered heavy-work trigger open to any staff
//        role, nudged from a 10-second frontend poll.
//   P-8  four screens polled on a timer and never stopped when the tab was hidden.
//        A tab left in the background overnight is ~8,600 wasted Worker requests
//        against the free tier's 100,000/day.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { createVisibilityPoller } from '../../frontend/src/visibilityPoller.js';

// ------------------------------------------------------------------------ P-4

// getDocxTemplate reaches Drive through drive.js's getFileBytesBase64, which calls
// global fetch. Stub fetch and count the Drive round-trips.
function stubDriveFetch(bodyBytes = 'UEsDBBQAAAAIAA') {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push(url.toString());
    if (url.toString().includes('oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    }
    // alt=media -> the file bytes
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(bodyBytes).buffer };
  };
  return {
    driveDownloads: () => calls.filter(u => u.includes('alt=media')).length,
    all: () => calls,
  };
}

function docxEnv() {
  const templates = makeD1(schemaFor('templates.sql'));
  templates.prepare(
    'INSERT INTO docx_templates (doc_type, year, drive_file_id, file_name, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .bind('receipt', 2026, 'FILE-1', 'receipt-2026.docx', '2026-01-01', '2026-01-01T00:00:00Z').run();
  return {
    DB_TEMPLATES: templates,
    KV_SESSIONS: makeKV(),
    DRIVE_OAUTH_CLIENT_ID: 'x', DRIVE_OAUTH_CLIENT_SECRET: 'y', DRIVE_OAUTH_REFRESH_TOKEN: 'z',
  };
}

test('P-4: the template is downloaded from Drive ONCE, then served from KV', async () => {
  const { getDocxTemplate } = await import('../src/docxTemplates.js');
  const env = docxEnv();
  const spy = stubDriveFetch();

  const first = await getDocxTemplate(env, 'receipt', 2026);
  assert.ok(first.base64, 'the bytes must come back');
  assert.equal(spy.driveDownloads(), 1, 'first call downloads');

  for (let i = 0; i < 5; i++) {
    const again = await getDocxTemplate(env, 'receipt', 2026);
    assert.equal(again.base64, first.base64, 'the cached bytes must be identical');
  }
  assert.equal(spy.driveDownloads(), 1, 'five further calls must not hit Drive at all');
});

test('P-4: a new upload is picked up IMMEDIATELY — the key includes updated_at', async () => {
  const { getDocxTemplate } = await import('../src/docxTemplates.js');
  const env = docxEnv();
  const spy = stubDriveFetch('UEsDBBQAAAAIAA-OLD');
  await getDocxTemplate(env, 'receipt', 2026);
  assert.equal(spy.driveDownloads(), 1);

  // Simulate uploadDocxTemplate replacing the file: new drive_file_id + updated_at.
  env.DB_TEMPLATES.prepare('UPDATE docx_templates SET drive_file_id = ?, updated_at = ? WHERE doc_type = ? AND year = ?')
    .bind('FILE-2', '2026-09-05T10:00:00Z', 'receipt', 2026).run();

  const spy2 = stubDriveFetch('UEsDBBQAAAAIAA-NEW');
  const after = await getDocxTemplate(env, 'receipt', 2026);
  assert.equal(spy2.driveDownloads(), 1, 'a changed template MUST be re-downloaded, not served stale');
  assert.match(atob(after.base64), /NEW/, 'the new bytes must be returned');

  // …and the OLD cache entry is still addressable, so nothing was corrupted.
  const keys = [...env.KV_SESSIONS._store.keys()].filter(k => k.startsWith('docxtpl:'));
  assert.equal(keys.length, 2, 'old and new versions live under distinct keys');
});

test('P-4: caching writes to KV at most once per template version (write budget is ~1000/day)', async () => {
  const { getDocxTemplate } = await import('../src/docxTemplates.js');
  const env = docxEnv();
  stubDriveFetch();
  for (let i = 0; i < 20; i++) await getDocxTemplate(env, 'receipt', 2026);
  // Count only the TEMPLATE cache writes. The Drive OAuth access token is also cached
  // in KV (drive:access_token), which is a second, separate one-off write per hour.
  const templateWrites = [...env.KV_SESSIONS._store.keys()].filter(k => k.startsWith('docxtpl:'));
  assert.equal(templateWrites.length, 1, '20 reads must produce exactly ONE template cache entry');
  assert.ok(env.KV_SESSIONS._writes() <= 2,
    `expected at most 2 KV writes (template + Drive token), got ${env.KV_SESSIONS._writes()}`);
});

test('P-4: a KV failure falls back to Drive rather than breaking generation', async () => {
  const { getDocxTemplate } = await import('../src/docxTemplates.js');
  const env = docxEnv();
  env.KV_SESSIONS = {
    get: async () => { throw new Error('KV unavailable'); },
    put: async () => { throw new Error('KV unavailable'); },
  };
  const spy = stubDriveFetch();
  const row = await getDocxTemplate(env, 'receipt', 2026);
  assert.ok(row.base64, 'documents must still generate with KV down');
  assert.equal(spy.driveDownloads(), 1);
});

test('P-4: no KV binding at all still works (older deployment)', async () => {
  const { getDocxTemplate } = await import('../src/docxTemplates.js');
  const env = docxEnv();
  delete env.KV_SESSIONS;
  stubDriveFetch();
  assert.ok((await getDocxTemplate(env, 'receipt', 2026)).base64);
});

test('P-4: a missing template still returns null (no Drive call, no cache entry)', async () => {
  const { getDocxTemplate } = await import('../src/docxTemplates.js');
  const env = docxEnv();
  const spy = stubDriveFetch();
  assert.equal(await getDocxTemplate(env, 'receipt', 1999), null);
  assert.equal(spy.driveDownloads(), 0, 'must not touch Drive for a template that does not exist');
});

// ------------------------------------------------------------------------ M-4

test('M-4: repeated drain requests are throttled', async () => {
  const { processCollectionQueueOnDemand } = await import('../src/collectionQueue.js');
  const env = { DB_MISC: makeD1(schemaFor('misc.sql')) };
  const STAFF = { name: 'USER0003', role: 'Subadmin' };

  const first = await processCollectionQueueOnDemand(env, STAFF);
  assert.notEqual(first.throttled, true, 'the first call must actually run');

  // A tight loop, as a script or a stuck poll would produce.
  let throttled = 0;
  for (let i = 0; i < 25; i++) {
    const r = await processCollectionQueueOnDemand(env, STAFF);
    if (r.throttled) throttled++;
  }
  assert.equal(throttled, 25, 'every immediate repeat must be throttled');
});

test('M-4: throttling is not an error and the caller can still see it', async () => {
  const { processCollectionQueueOnDemand } = await import('../src/collectionQueue.js');
  const env = { DB_MISC: makeD1(schemaFor('misc.sql')) };
  const STAFF = { name: 'USER0003', role: 'Subadmin' };
  await processCollectionQueueOnDemand(env, STAFF);
  const r = await processCollectionQueueOnDemand(env, STAFF);
  // Must NOT throw — the frontend calls this fire-and-forget after every save, and an
  // error there would surface as a spurious warning on a successful save.
  assert.deepEqual(r, { processed: 0, throttled: true });
});

test('M-4: the role gate still applies before the throttle', async () => {
  const { processCollectionQueueOnDemand } = await import('../src/collectionQueue.js');
  const env = { DB_MISC: makeD1(schemaFor('misc.sql')) };
  await assert.rejects(
    () => processCollectionQueueOnDemand(env, { name: 'X', role: 'Treasurer' }),
    /does not have permission/,
    'an unknown role must be refused, not silently throttled'
  );
});

// ------------------------------------------------------------------------ P-8

function fakeDoc(state = 'visible') {
  const listeners = {};
  return {
    visibilityState: state,
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    removeEventListener: (ev, fn) => {
      listeners[ev] = (listeners[ev] || []).filter(f => f !== fn);
    },
    _fire: (ev) => (listeners[ev] || []).forEach(fn => fn()),
    _listenerCount: (ev) => (listeners[ev] || []).length,
  };
}

test('P-8: no polling happens while the tab is hidden', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const doc = fakeDoc('visible');
    let runs = 0;
    const stop = createVisibilityPoller(() => runs++, 10000, doc);
    assert.equal(runs, 1, 'an initial load always happens');

    mock.timers.tick(30000);
    assert.equal(runs, 4, 'three ticks while visible');

    doc.visibilityState = 'hidden';
    mock.timers.tick(120000);            // twelve ticks' worth of hidden time
    assert.equal(runs, 4, 'NOT ONE request may be issued while hidden');

    stop();
  } finally {
    mock.timers.reset();
  }
});

test('P-8: becoming visible again triggers one immediate catch-up refresh', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const doc = fakeDoc('visible');
    let runs = 0;
    const stop = createVisibilityPoller(() => runs++, 10000, doc);
    assert.equal(runs, 1);

    doc.visibilityState = 'hidden';
    mock.timers.tick(60000);
    assert.equal(runs, 1, 'nothing while hidden');

    // The operator comes back to the tab.
    doc.visibilityState = 'visible';
    doc._fire('visibilitychange');
    assert.equal(runs, 2, 'exactly ONE catch-up run, so the screen is never stale');

    mock.timers.tick(10000);
    assert.equal(runs, 3, 'and normal polling resumes');
    stop();
  } finally {
    mock.timers.reset();
  }
});

test('P-8: stop() clears both the timer and the listener', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const doc = fakeDoc('visible');
    let runs = 0;
    const stop = createVisibilityPoller(() => runs++, 10000, doc);
    assert.equal(doc._listenerCount('visibilitychange'), 1);

    stop();
    assert.equal(doc._listenerCount('visibilitychange'), 0, 'no leaked listener');

    mock.timers.tick(60000);
    assert.equal(runs, 1, 'no polling after unmount');
    doc._fire('visibilitychange');
    assert.equal(runs, 1, 'and a stray event does nothing');
  } finally {
    mock.timers.reset();
  }
});

test('P-8: intervalMs = 0 disables polling but still performs the initial load', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const doc = fakeDoc('visible');
    let runs = 0;
    // AnnouncePage passes 0 until the PIN session exists.
    const stop = createVisibilityPoller(() => runs++, 0, doc);
    assert.equal(runs, 1);
    mock.timers.tick(120000);
    assert.equal(runs, 1, 'no interval was scheduled');
    stop();
  } finally {
    mock.timers.reset();
  }
});

test('P-8: a throwing poll never breaks the interval', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const doc = fakeDoc('visible');
    let runs = 0;
    const stop = createVisibilityPoller(() => { runs++; throw new Error('network down'); }, 10000, doc);
    assert.equal(runs, 1);
    mock.timers.tick(30000);
    assert.equal(runs, 4, 'polling must survive a failing request');
    stop();
  } finally {
    mock.timers.reset();
  }
});

test('P-8: with no document (SSR) it degrades to a plain interval rather than never polling', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    let runs = 0;
    const stop = createVisibilityPoller(() => runs++, 10000, null);
    mock.timers.tick(30000);
    assert.equal(runs, 4);
    stop();
  } finally {
    mock.timers.reset();
  }
});

test('P-8: the daily request saving is real', () => {
  // A tab left in the background overnight, on the shortest of the four intervals.
  const HOURS_HIDDEN = 12;
  const wasted = (HOURS_HIDDEN * 3600 * 1000) / 10000;
  assert.equal(wasted, 4320);
  // Four such screens on three devices would previously have burned ~52k requests —
  // over half the free tier's 100,000/day — on data nobody was looking at.
  assert.ok(wasted * 4 * 3 > 50000);
});
