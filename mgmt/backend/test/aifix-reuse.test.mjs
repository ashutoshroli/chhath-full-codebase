// ============ AI fix — reuse existing, don't spawn duplicate jobs ============
//
// Opening "Fix using AI" for the same error must REUSE the existing fix, not start
// a second Render job every time:
//   - a live 'pending' / 'fix_generated' / 'pr_created' fix is reused
//     (generateAiFix returns { reused:true, ... } and dispatches NOTHING);
//   - only force:true (the "Re-generate" button) starts a fresh job;
//   - a previous 'failed' fix does NOT block a fresh attempt;
//   - getLatestAiFixForError returns the newest fix, plus the live jobId while
//     it is still pending so the modal can resume polling.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { generateAiFix, getLatestAiFixForError, getAiFix } from '../src/aiFix.js';

const SUPER = { name: 'USER0001', role: 'Superadmin' };

function makeEnv() {
  const logs = makeD1(schemaFor('logs.sql'));
  logs.prepare('INSERT INTO error_log (error_id, source, message, created_at) VALUES (?,?,?,?)')
    .bind('ERR1', 'frontend', 'boom', '2026-01-01').run();
  return {
    DB_LOGS: logs,
    DB_MISC: makeD1(schemaFor('misc.sql')),
    GITHUB_TOKEN: 'gh-token',
    GITHUB_REPO: 'owner/repo',
    ANTHROPIC_API_KEY: 'anthropic-key', // provider resolution falls back to this
    RENDER_SERVICE_URL: 'https://render.example.test',
    RENDER_API_KEY: 'render-key',
  };
}

// Count Render dispatch POSTs so we can prove no duplicate job is created.
function stubDispatch() {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 202, json: async () => ({ renderJobId: 'r1' }) }; };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

const setStatus = (env, fixId, status) =>
  env.DB_LOGS.prepare('UPDATE ai_fixes SET status=? WHERE fix_id=?').bind(status, fixId).run();

test('the first generate dispatches exactly one job and creates a pending fix', async () => {
  const env = makeEnv();
  const { calls, restore } = stubDispatch();
  let res;
  try { res = await generateAiFix(env, 'ERR1', SUPER); } finally { restore(); }
  assert.equal(res.reused, undefined);
  assert.ok(res.fixId && res.fixId.startsWith('AIF'));
  assert.ok(res.jobId);
  assert.equal(calls.length, 1, 'exactly one Render dispatch');
  const { results } = await env.DB_LOGS.prepare('SELECT * FROM ai_fixes WHERE error_id=?').bind('ERR1').all();
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'pending');
});

test('a second generate REUSES the pending fix and dispatches nothing more', async () => {
  const env = makeEnv();
  let first;
  { const s = stubDispatch(); try { first = await generateAiFix(env, 'ERR1', SUPER); } finally { s.restore(); } }

  const { calls, restore } = stubDispatch();
  let second;
  try { second = await generateAiFix(env, 'ERR1', SUPER); } finally { restore(); }

  assert.equal(second.reused, true);
  assert.equal(second.fixId, first.fixId, 'same fix reused');
  assert.equal(second.status, 'pending');
  assert.ok(second.jobId, 'the live jobId is returned so the UI can resume polling');
  assert.equal(calls.length, 0, 'NO second Render dispatch');
  const { results } = await env.DB_LOGS.prepare('SELECT * FROM ai_fixes WHERE error_id=?').bind('ERR1').all();
  assert.equal(results.length, 1, 'no duplicate fix row');
});

test('a ready (fix_generated) fix is reused with no jobId (show it directly)', async () => {
  const env = makeEnv();
  let first;
  { const s = stubDispatch(); try { first = await generateAiFix(env, 'ERR1', SUPER); } finally { s.restore(); } }
  setStatus(env, first.fixId, 'fix_generated');

  const { calls, restore } = stubDispatch();
  let res;
  try { res = await generateAiFix(env, 'ERR1', SUPER); } finally { restore(); }
  assert.equal(res.reused, true);
  assert.equal(res.status, 'fix_generated');
  assert.equal(res.jobId, null, 'a ready fix needs no polling');
  assert.equal(calls.length, 0);
});

test('force:true starts a FRESH job even when a live fix exists', async () => {
  const env = makeEnv();
  let first;
  { const s = stubDispatch(); try { first = await generateAiFix(env, 'ERR1', SUPER); } finally { s.restore(); } }
  setStatus(env, first.fixId, 'fix_generated');

  const { calls, restore } = stubDispatch();
  let res;
  try { res = await generateAiFix(env, 'ERR1', SUPER, { force: true }); } finally { restore(); }
  assert.equal(res.reused, undefined);
  assert.notEqual(res.fixId, first.fixId, 'a new fix row');
  assert.equal(calls.length, 1, 'force dispatches a new job');
  const { results } = await env.DB_LOGS.prepare('SELECT * FROM ai_fixes WHERE error_id=?').bind('ERR1').all();
  assert.equal(results.length, 2);
});

test('a previous FAILED fix does not block a fresh attempt', async () => {
  const env = makeEnv();
  let first;
  { const s = stubDispatch(); try { first = await generateAiFix(env, 'ERR1', SUPER); } finally { s.restore(); } }
  setStatus(env, first.fixId, 'failed');

  const { calls, restore } = stubDispatch();
  let res;
  try { res = await generateAiFix(env, 'ERR1', SUPER); } finally { restore(); }
  assert.equal(res.reused, undefined, 'a failed fix is not reused');
  assert.notEqual(res.fixId, first.fixId);
  assert.equal(calls.length, 1);
});

test('getLatestAiFixForError returns the newest fix + live jobId while pending', async () => {
  const env = makeEnv();
  let first;
  { const s = stubDispatch(); try { first = await generateAiFix(env, 'ERR1', SUPER); } finally { s.restore(); } }

  const latest = await getLatestAiFixForError(env, 'ERR1', SUPER);
  assert.equal(latest.fix.fix_id, first.fixId);
  assert.equal(latest.fix.status, 'pending');
  assert.ok(latest.jobId, 'a pending fix exposes its live jobId');

  // Once ready, no jobId is needed.
  setStatus(env, first.fixId, 'fix_generated');
  const ready = await getLatestAiFixForError(env, 'ERR1', SUPER);
  assert.equal(ready.fix.status, 'fix_generated');
  assert.equal(ready.jobId, null);

  // The row is fetchable for direct rendering.
  const row = await getAiFix(env, SUPER, first.fixId);
  assert.equal(row.fix_id, first.fixId);
});

test('getLatestAiFixForError is empty for an error with no fix, and Superadmin-only', async () => {
  const env = makeEnv();
  const none = await getLatestAiFixForError(env, 'ERR1', SUPER);
  assert.equal(none.fix, null);
  assert.equal(none.jobId, null);
  await assert.rejects(() => getLatestAiFixForError(env, 'ERR1', { name: 'x', role: 'Admin' }), /Superadmin/);
});
