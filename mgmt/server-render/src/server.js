// Chhath mgmt — Render offload service.
// Runs long-running AI fix generation + PR creation offloaded from the Cloudflare
// Worker, and calls back to the Worker with the result. See README.md.

import express from 'express';
import { config } from './config.js';
import { jobsRouter } from './routes/jobs.js';

const app = express();
app.use(express.json({ limit: '1mb' })); // payloads carry references + small text (error/diff), never big blobs

// Health check — NO auth. Used by the Worker's health probe and, importantly, by
// an EXTERNAL uptime monitor (UptimeRobot) pinging every ~5 min to keep the free
// tier from spinning down. Fast, no secrets.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'chhath-server-render' });
});

// Job intake (auth-gated inside the router).
app.use('/', jobsRouter);

// Fallback 404.
app.use((req, res) => res.status(404).json({ success: false, message: 'Not found' }));

app.listen(config.port, () => {
  console.log(`chhath-server-render listening on :${config.port}`);
});
