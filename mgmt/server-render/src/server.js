// Chhath mgmt — Render offload service.
// Runs long-running AI fix generation + PR creation offloaded from the Cloudflare
// Worker, and calls back to the Worker with the result. See README.md.

import express from 'express';
import { config } from './config.js';
import { jobsRouter } from './routes/jobs.js';
import { publicChatRouter } from './routes/publicChat.js';
import { MAX_REQUEST_BYTES, MAX_CHAT_REQUEST_BYTES } from './lib/batchContract.js';

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

// Fallback 404.
app.use((req, res) => res.status(404).json({ success: false, message: 'Not found' }));

app.listen(config.port, () => {
  console.log(`chhath-server-render listening on :${config.port}`);
});
