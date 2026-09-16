// Chhath mgmt — Render offload service.
// Runs long-running AI fix generation + PR creation offloaded from the Cloudflare
// Worker, and calls back to the Worker with the result. See README.md.

import express from 'express';
import { config } from './config.js';
import { jobsRouter } from './routes/jobs.js';
import { publicChatRouter } from './routes/publicChat.js';
import { MAX_REQUEST_BYTES, MAX_CHAT_REQUEST_BYTES } from './lib/batchContract.js';
import { sweepChatRetention, shouldSweep, markSwept } from './lib/chatRetention.js';
import { query as neonQuery, isConfigured as isNeonConfigured } from './lib/neon.js';
import { timingSafeEqual } from 'node:crypto';

const app = express();

// ============ BODY LIMITS ARE PER ROUTE, AND DERIVED ============
//
// audit Render/offload #1. There used to be ONE global parser —
// `express.json({ limit: '1mb' })` — under a comment saying payloads "carry references +
// small text (error/diff), never big blobs". That is true of the AI jobs and simply false
// of `pdf_convert_batch`, which carries up to twenty base64 `.docx` files. A real bulk run
// is over 1 MB, so body-parser rejected it BEFORE the router ever saw it, the Worker's
// dispatch failed, and the Worker fell back to converting the whole batch ITSELF — which
// is exactly the CPU and subrequest limit this service exists to stay under. One wrong
// number turned a working offload into a Worker-killing fallback.
//
// One global limit was also the wrong shape: it forced the same allowance on an
// authenticated job intake that legitimately carries megabytes and on an anonymous
// browser endpoint that carries one short question.
//
// So each router gets its own, and both come from the shared contract rather than being
// written here — the parser and the contract cannot drift apart again.
const jobsBodyParser = express.json({ limit: MAX_REQUEST_BYTES });
// TIGHTER than the old global 1 MB: this is the only browser-facing route, and a question
// is 16 KB at the outside.
const chatBodyParser = express.json({ limit: MAX_CHAT_REQUEST_BYTES });

// Health check — NO auth. Used by the Worker's health probe and, importantly, by
// an EXTERNAL uptime monitor (UptimeRobot) pinging every ~5 min to keep the free
// tier from spinning down. Fast, no secrets.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'chhath-server-render' });
});

// Public chatbot — the ONE browser-facing endpoint (its own CORS/origin +
// rate-limit guards live inside the router; NO X-Render-Api-Key).
app.use('/', chatBodyParser, publicChatRouter);

// Job intake (auth-gated inside the router).
app.use('/', jobsBodyParser, jobsRouter);

// ============ CHAT LOG RETENTION (PR-32) ============
//
// What is stored is the visitor's own words plus a pseudonym linking a conversation to a
// person. schema.sql described pruning it as "optional ... if you want to keep the free
// tier small", in two commented-out DELETE statements — so the retention window existed
// as an intention and nothing enforced it.
//
// Reachable two ways on purpose, because neither alone is enough:
//
//   * OPPORTUNISTICALLY, below, at most once per UTC day per instance. Fired without
//     being awaited, so it never delays a response. Best-effort by nature: a Render free
//     instance that has spun down may miss a day.
//   * ON DEMAND via POST /retention, for a scheduled caller or a person who needs it to
//     have definitely happened, and who wants to see the counts.
app.use((req, res, next) => {
  next(); // never let retention sit in front of a response
  if (!shouldSweep()) return;
  markSwept();
  sweepChatRetention({ query: neonQuery })
    .then((r) => { if (r.ran && (r.messages || r.sessions)) console.log('[retention] swept', r); })
    .catch((e) => console.warn('[retention] sweep failed:', e && e.message));
});

// Authenticated, and reports what it did. Uses the same shared secret as the Worker
// callbacks, compared in constant time — a retention trigger is a bulk delete, so an
// anonymous caller must not be able to time-probe the comparison.
app.post('/retention', async (req, res) => {
  const presented = (req.get('X-Render-Signature') || '').toString();
  const expected = config.renderWebhookSecret || '';
  const ok = expected.length > 0
    && presented.length === expected.length
    && timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
  if (!ok) return res.status(403).json({ success: false, message: 'Forbidden' });

  if (!(await isNeonConfigured())) {
    // Distinguished from "nothing to delete": a report of zero from a service with no
    // database is the kind of clean answer that hides a broken deployment.
    return res.status(503).json({ success: false, message: 'No chat database configured', retention: null });
  }
  try {
    const result = await sweepChatRetention({ query: neonQuery });
    return res.json({ success: true, retention: result });
  } catch (e) {
    return res.status(500).json({ success: false, message: (e && e.message) || 'Retention sweep failed' });
  }
});

// Fallback 404.
app.use((req, res) => res.status(404).json({ success: false, message: 'Not found' }));

app.listen(config.port, () => {
  console.log(`chhath-server-render listening on :${config.port}`);
});
