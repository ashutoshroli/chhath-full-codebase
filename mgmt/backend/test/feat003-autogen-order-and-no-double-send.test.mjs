// ============ FEAT-003 — the auto-generate order + no-double-send harness ============
//
// THE USER'S CRITICAL REQUIREMENT: for an auto-generated collection document the
// order must be generate the document -> template + message -> it goes out
// (WhatsApp then email), and nothing may break or double.
//
// Now that the fill is server-side (Render), that order is realised across TWO
// hops: processPendingJobs() DISPATCHES a docx_render job (nothing goes out yet —
// the PDF does not exist), and the render callback writes R2 + the generated_files
// index and THEN triggers WhatsApp then email. This suite pins:
//
//   1. a NEW-entry document job dispatches EXACTLY ONE docx_render job and sends
//      ZERO messages before the callback (nothing goes out before the document);
//   2. the render callback writes the document index FIRST, then WhatsApp, then
//      email — in that exact order;
//   3. a NEW entry results in EXACTLY ONE WhatsApp + ONE email; an EDIT sends none;
//   4. a job never double-runs and a duplicate callback never double-sends.
//
// It drives the REAL processPendingJobs / handleRenderCallback / triggerCollection*
// paths (no mocking of the domain logic), observing order via the actual DB writes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { processPendingJobs } from '../src/collectionQueue.js';
import { handleRenderCallback } from '../src/renderJobs.js';

const ISO = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

// A tiny in-memory R2 bucket so applyPdfConvertResult can write the PDF + index.
function makeR2() {
  const store = new Map();
  return { async put(key, bytes) { store.set(key, bytes); }, _store: store };
}

// Wrap every DB binding so each successful write is stamped with a global sequence
// number, letting a test assert the ORDER writes happened in across databases.
function orderRecorder() {
  const events = [];
  let seq = 0;
  const wrap = (db, label) => {
    const realPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      const stmt = realPrepare(sql);
      const realRun = stmt.run.bind(stmt);
      stmt.run = async (...a) => {
        const res = await realRun(...a);
        if (res && res.meta && res.meta.changes > 0) {
          if (/INSERT INTO generated_files/i.test(sql)) events.push({ seq: seq++, kind: 'document-indexed', label });
          else if (/INSERT INTO person_messages/i.test(sql)) events.push({ seq: seq++, kind: 'whatsapp', label });
          else if (/INSERT INTO email_messages/i.test(sql)) events.push({ seq: seq++, kind: 'email', label });
        }
        return res;
      };
      return stmt;
    };
    return db;
  };
  return { events, wrap };
}

function makeEnv() {
  const core = makeD1(schemaFor('core.sql'));
  const collections = makeD1(schemaFor('collections.sql'));
  const templates = makeD1(schemaFor('templates.sql'));
  const wa = makeD1(schemaFor('whatsapp_index.sql'));
  const fileIndex = makeD1(schemaFor('file_index.sql'));

  // A contributor with a mobile AND an email so BOTH channels can queue.
  core.prepare('INSERT INTO users (id_code, name, mobile, whatsapp, email) VALUES (?,?,?,?,?)')
    .bind('USER0009', 'Ram Kumar', 7282032146, 7282032146, 'ram@example.com').run();
  // The committed collection row (audit P0-03 source of truth): id 5, ₹100, type 1.
  collections.prepare(
    'INSERT INTO collections (id, year, sl_no, name, amount, payment_mode, contribution_type, certificate_or_receipt, created_by, is_resell) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(5, 2026, 5, 'USER0009', 100, 'Cash', 1, 'Receipt', 'USER0001', 'FALSE').run();
  // A DOCX template for receipt/2026 so getDocxTemplate resolves bytes (base64 is
  // opaque to the Worker; it is only forwarded to Render). We prime the KV cache
  // with the bytes so getDocxTemplate returns them WITHOUT a Drive round-trip
  // (Drive OAuth is not configured in tests) — this is the exact cache path the
  // 7-day KV cache serves in production.
  const TPL_UPDATED = ISO();
  templates.prepare('INSERT INTO docx_templates (doc_type, year, drive_file_id, file_name, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .bind('receipt', 2026, 'FILE1', 'receipt-2026.docx', ISO(), TPL_UPDATED).run();
  const kv = makeKV();
  // Cache key = `docxtpl:${drive_file_id}:${updated_at}` (see getDocxTemplate).
  kv.put(`docxtpl:FILE1:${TPL_UPDATED}`, 'UEsDBBQ_TEMPLATE_BYTES');
  // The receipt text template (so getReceiptData builds placeholders).
  templates.prepare('INSERT INTO receipt_templates (year, template_text, page_size, created_at, updated_at) VALUES (?,?,?,?,?)')
    .bind(2026, 'Receipt {NAME} {AMOUNT}', 'A5', ISO(), ISO()).run();
  // A person WhatsApp template + an email template for contribution type 1.
  wa.prepare('INSERT INTO person_message_templates (template_id, text, active, created_at, message_type, contribution_type, doc_sub_type, file_doc_type) VALUES (?,?,?,?,?,?,?,?)')
    .bind('WTPL1', 'Thank you {Name}', '1', ISO(), 'normal', 1, '', 'receipt').run();
  wa.prepare('INSERT INTO email_message_templates (template_id, subject, text, active, created_at, message_type, contribution_type, doc_sub_type, file_doc_type) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind('ETPL1', 'Receipt {Name}', 'Thanks {Name}', '1', ISO(), 'normal', 1, '', 'receipt').run();

  const rec = orderRecorder();
  return {
    env: {
      DB_MISC: makeD1(schemaFor('misc.sql')),
      DB_CORE: core,
      DB_COLLECTIONS: collections,
      DB_TEMPLATES: templates,
      DB_WHATSAPP_INDEX: rec.wrap(wa, 'wa'),
      DB_FILE_INDEX: rec.wrap(fileIndex, 'idx'),
      DB_LOGS: makeD1(schemaFor('logs.sql')),
      KV_SESSIONS: kv,
      R2_FILES: makeR2(),
      R2_PUBLIC_BASE: 'https://files.example.test',
      RENDER_SERVICE_URL: 'https://render.example.test',
      RENDER_API_KEY: 'k',
      RENDER_WEBHOOK_SECRET: 's',
      GETIMG_TEMPLATE_B64: 'UEsDBBQ',
    },
    events: rec.events,
  };
}

// Seed a collection job row directly (skips enqueue; enqueue authority is covered
// by p0-collection-enqueue-authority.test.mjs). filled_base64 is '' — the new,
// reference-only shape.
async function seedCollectionJob(env, over = {}) {
  const row = {
    job_id: 'CJOB-1', status: 'pending', doc_type: 'receipt', year: '2026',
    row_index: 5, record_id: 'receipt-2026-5', is_new_entry: 1,
    payload: JSON.stringify({ Year: 2026, Name: 'USER0009', Amount: 100, 'Contribution Type': 1, 'Payment Mode': 'Cash', 'Is Resell': 'FALSE' }),
    filled_base64: '', file_name: '', created_by: 'USER0001', attempts: 0, created_at: ISO(), claimed_at: null, ...over,
  };
  await env.DB_MISC.prepare(
    `INSERT INTO collection_jobs (job_id, status, doc_type, year, row_index, record_id, is_new_entry,
       payload, filled_base64, file_name, created_by, attempts, created_at, claimed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(row.job_id, row.status, row.doc_type, row.year, row.row_index, row.record_id, row.is_new_entry,
    row.payload, row.filled_base64, row.file_name, row.created_by, row.attempts, row.created_at, row.claimed_at).run();
  return row.job_id;
}

// Capture the docx_render dispatch that processPendingJobs POSTs to Render, and ack
// it like the real service (202). Returns the captured dispatch bodies.
function captureDispatch() {
  const posted = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    let body = {};
    try { body = JSON.parse((opts && opts.body) || '{}'); } catch (e) { body = {}; }
    posted.push(body);
    return { ok: true, status: 202, json: async () => ({ accepted: true }), text: async () => '' };
  };
  return { posted, restore: () => { globalThis.fetch = orig; } };
}

// The render_jobs row processPendingJobs created (so we can call the callback).
const renderJobId = (env) => env.DB_MISC.prepare("SELECT job_id FROM render_jobs WHERE kind='docx_render' ORDER BY id DESC LIMIT 1").first('job_id');
const countRender = (env) => env.DB_MISC.prepare("SELECT COUNT(*) n FROM render_jobs WHERE kind='docx_render'").first('n');
const countWhatsapp = (env) => env.DB_WHATSAPP_INDEX.prepare('SELECT COUNT(*) n FROM person_messages').first('n');
const countEmail = (env) => env.DB_WHATSAPP_INDEX.prepare('SELECT COUNT(*) n FROM email_messages').first('n');
const countIndex = (env) => env.DB_FILE_INDEX.prepare('SELECT COUNT(*) n FROM generated_files').first('n');

// The Render result for a completed docx_render: PDF bytes + name.
const RENDER_RESULT = { pdfBase64: Buffer.from('%PDF-1.4 fake').toString('base64'), fileName: 'receipt-NCS-2026-5.pdf', report: { missingTags: [], missingImages: [] } };

// ======================================================= 1. DISPATCH, NOTHING SENT YET

test('a NEW-entry document job dispatches ONE docx_render and sends NOTHING before the callback', async () => {
  const { env } = makeEnv();
  await seedCollectionJob(env);
  const cap = captureDispatch();
  try {
    const res = await processPendingJobs(env);
    assert.equal(res.processed, 1, 'the job was claimed and run');
  } finally { cap.restore(); }

  // Exactly one docx_render dispatched, carrying template bytes + fill data.
  assert.equal(await countRender(env), 1, 'exactly one render job dispatched');
  assert.equal(cap.posted.length, 1, 'exactly one POST to Render');
  assert.equal(cap.posted[0].kind, 'docx_render');
  assert.ok(cap.posted[0].payload.templateBase64, 'template bytes travel in the dispatch (Render has no D1)');
  assert.ok(cap.posted[0].payload.data, 'server-built fill data travels in the dispatch');
  assert.equal(cap.posted[0].payload.recordId, 'receipt-2026-5', 'the DERIVED recordId (P0-03)');

  // NOTHING has gone out: the document does not exist yet.
  assert.equal(await countIndex(env), 0, 'no document indexed before the callback');
  assert.equal(await countWhatsapp(env), 0, 'no WhatsApp before the document exists');
  assert.equal(await countEmail(env), 0, 'no email before the document exists');
});

// ================================================ 2. THE CALLBACK: ORDER + ONE OF EACH

test('the render callback generates the document FIRST, then WhatsApp, then email — exactly once each', async () => {
  const { env, events } = makeEnv();
  await seedCollectionJob(env);
  const cap = captureDispatch();
  try { await processPendingJobs(env); } finally { cap.restore(); }

  const rjId = await renderJobId(env);
  const out = await handleRenderCallback(env, { jobId: rjId, status: 'completed', result: RENDER_RESULT });
  assert.equal(out.applied, true, 'the callback applied the result');

  // Exactly one of each side effect.
  assert.equal(await countIndex(env), 1, 'the document is indexed exactly once');
  assert.equal(await countWhatsapp(env), 1, 'exactly one WhatsApp message');
  assert.equal(await countEmail(env), 1, 'exactly one email');

  // …and in the required ORDER: document -> WhatsApp -> email.
  const order = events.map(e => e.kind);
  assert.deepEqual(order, ['document-indexed', 'whatsapp', 'email'],
    `the order must be generate -> WhatsApp -> email, got: ${order.join(' -> ')}`);

  // The message carries the PUBLIC PDF link — proof it went out AFTER the document.
  const waLink = await env.DB_WHATSAPP_INDEX.prepare('SELECT file_link FROM person_messages ORDER BY id DESC LIMIT 1').first('file_link');
  assert.match(waLink, /^https:\/\/files\.example\.test\//, 'WhatsApp attaches the generated PDF link');
  const emLink = await env.DB_WHATSAPP_INDEX.prepare('SELECT file_link FROM email_messages ORDER BY id DESC LIMIT 1').first('file_link');
  assert.match(emLink, /^https:\/\/files\.example\.test\//, 'the email attaches the same generated PDF link');
});

// ===================================================== 3. AN EDIT SENDS NOTHING

test('an EDIT (is_new_entry = 0) generates the document but sends NO WhatsApp and NO email', async () => {
  const { env } = makeEnv();
  await seedCollectionJob(env, { is_new_entry: 0 });
  const cap = captureDispatch();
  try { await processPendingJobs(env); } finally { cap.restore(); }

  const rjId = await renderJobId(env);
  await handleRenderCallback(env, { jobId: rjId, status: 'completed', result: RENDER_RESULT });

  assert.equal(await countIndex(env), 1, 'the document is still (re)generated on an edit');
  assert.equal(await countWhatsapp(env), 0, 'an edit must never send WhatsApp');
  assert.equal(await countEmail(env), 0, 'an edit must never send email');
});

// ================================================ 4. NO DOUBLE-SEND ON A DUPLICATE CALLBACK

test('a duplicate render callback does NOT double-generate or double-send', async () => {
  const { env } = makeEnv();
  await seedCollectionJob(env);
  const cap = captureDispatch();
  try { await processPendingJobs(env); } finally { cap.restore(); }

  const rjId = await renderJobId(env);
  // Two callbacks race (Render retry / double webhook / reconcile) — the atomic
  // claim (MGMT-BE-02) must let exactly one apply the side effect.
  const [a, b] = await Promise.all([
    handleRenderCallback(env, { jobId: rjId, status: 'completed', result: RENDER_RESULT }),
    handleRenderCallback(env, { jobId: rjId, status: 'completed', result: RENDER_RESULT }),
  ]);
  const applied = [a, b].filter(r => r.applied);
  assert.equal(applied.length, 1, 'exactly one callback applies the result');

  assert.equal(await countIndex(env), 1, 'the document is indexed once, not twice');
  assert.equal(await countWhatsapp(env), 1, 'one WhatsApp, never two');
  assert.equal(await countEmail(env), 1, 'one email, never two');
});

// ==================== 6. NO DOCUMENT -> NO MESSAGE (the order/no-blank-link invariant)
//
// A callback can report status:'completed' yet carry NO usable document: Render's
// result is missing pdfBase64 (or recordId), or R2 is not configured. In that case
// applyPdfConvertResult writes NOTHING and returns no publicLink. The invariant the
// whole feature protects — nothing goes out before/without the document — means we
// must NOT send a WhatsApp/email announcing a receipt that does not exist with a
// blank link. Instead the job must FAIL so it surfaces for retry (same as a failed
// dispatch), consistent with never sending a blank-link message.

test('a completed docx_render callback with NO pdfBase64 writes NO index and sends NO WhatsApp and NO email', async () => {
  const { env } = makeEnv();
  await seedCollectionJob(env);
  const cap = captureDispatch();
  try { await processPendingJobs(env); } finally { cap.restore(); }

  const rjId = await renderJobId(env);
  // status 'completed' but the result carries no document bytes at all.
  const out = await handleRenderCallback(env, {
    jobId: rjId, status: 'completed',
    result: { fileName: 'receipt-NCS-2026-5.pdf', report: { missingTags: [], missingImages: [] } },
  });

  // The callback claim ran (applied), but the side-effect FAILED the job because
  // there is no document — so the render_jobs row records the failure for retry.
  const status = await env.DB_MISC.prepare('SELECT status FROM render_jobs WHERE job_id = ?').bind(rjId).first('status');
  assert.equal(status, 'failed', 'a completed-but-empty result must FAIL the job, not silently pass');

  // The invariant: nothing was written and NOTHING went out.
  assert.equal(await countIndex(env), 0, 'no document indexed when the result has no PDF bytes');
  assert.equal(await countWhatsapp(env), 0, 'NO WhatsApp may be sent without a document');
  assert.equal(await countEmail(env), 0, 'NO email may be sent without a document');
});

test('a completed docx_render callback with R2 absent writes NO index and sends NO WhatsApp and NO email', async () => {
  const { env } = makeEnv();
  // Remove R2 so applyPdfConvertResult cannot store the PDF (returns { error }).
  delete env.R2_FILES;
  delete env.R2_PUBLIC_BASE;
  await seedCollectionJob(env);
  const cap = captureDispatch();
  try { await processPendingJobs(env); } finally { cap.restore(); }

  const rjId = await renderJobId(env);
  const out = await handleRenderCallback(env, { jobId: rjId, status: 'completed', result: RENDER_RESULT });

  const status = await env.DB_MISC.prepare('SELECT status FROM render_jobs WHERE job_id = ?').bind(rjId).first('status');
  assert.equal(status, 'failed', 'with R2 unconfigured the document cannot be stored, so the job must FAIL');

  assert.equal(await countIndex(env), 0, 'no document indexed when R2 is absent');
  assert.equal(await countWhatsapp(env), 0, 'NO WhatsApp may be sent without a stored document');
  assert.equal(await countEmail(env), 0, 'NO email may be sent without a stored document');
});

// ============================================ 5. THE JOB ITSELF NEVER DOUBLE-DISPATCHES

test('a second drain does NOT dispatch the render job again (P0-04 claim)', async () => {
  const { env } = makeEnv();
  await seedCollectionJob(env);
  const cap = captureDispatch();
  try {
    await processPendingJobs(env);   // claims + dispatches
    await processPendingJobs(env);   // the job is now 'done' — nothing to claim
  } finally { cap.restore(); }
  assert.equal(await countRender(env), 1, 'the collection job dispatched exactly one render job');
  assert.equal(cap.posted.length, 1, 'and POSTed to Render exactly once');
});
