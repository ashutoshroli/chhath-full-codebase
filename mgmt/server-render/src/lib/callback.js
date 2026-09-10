import { config } from '../config.js';

// POST a job RESULT back to the Worker's ?render-webhook route. Authenticated with
// RENDER_WEBHOOK_SECRET (distinct from the inbound X-Render-Api-Key), sent both as
// the X-Render-Signature header AND appended as ?render-webhook=<secret> so either
// check on the Worker side works. Never throws — returns { ok }.
export async function postResult({ jobId, status, result, error, renderJobId }) {
  const base = config.workerWebhookUrl;
  // Ensure the secret is present as a query param too (Worker accepts either).
  let url = base;
  if (!/[?&]render-webhook=/.test(url)) {
    url += (url.includes('?') ? '&' : '?') + 'render-webhook=' + encodeURIComponent(config.renderWebhookSecret);
  }
  const body = { jobId, status };
  if (result !== undefined) body.result = result;
  if (error !== undefined) body.error = error;
  if (renderJobId !== undefined) body.renderJobId = renderJobId;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Render-Signature': config.renderWebhookSecret,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`[callback] Worker returned HTTP ${resp.status}: ${text.slice(0, 200)}`);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error('[callback] failed to reach Worker:', e && e.message);
    return { ok: false };
  }
}
