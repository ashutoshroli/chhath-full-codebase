// ============ A JOB RUNS ONCE, AND NOT FOREVER ============
//
// audit Render/offload #3 and #5.
//
// `/jobs` accepted a job, answered `202`, and fire-and-forgot it, recording nothing:
//
//     res.status(202).json({ accepted: true, jobId });
//     (async () => { const result = await handler(payload); await postResult(...); })();
//
// The Worker's reconciler re-dispatches a row stuck in `dispatched` after ten minutes — and
// "stuck" means "we have not heard back", not "it stopped". A slow Claude call or a large Drive
// batch is still running. So the redispatch ran the whole job AGAIN, alongside the original:
// for `ai_pr_create` that is **two GitHub pull requests**; for the PDF paths, two Drive
// conversions and two R2 objects.
//
// #344 fixed the Worker side. This is the half that has to be here: the second dispatch must
// recognise that the first is in flight and do nothing.
//
// And nothing bounded a job in time or number — a provider that never answered held a job
// forever, on a free-tier instance with one CPU.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.RENDER_API_KEY ||= 'k';
process.env.RENDER_WEBHOOK_SECRET ||= 'k';
process.env.WORKER_WEBHOOK_URL ||= 'https://w.test/?render-webhook=1';
process.env.GITHUB_TOKEN ||= 'gh';
process.env.GITHUB_REPO ||= 'o/r';
process.env.ANTHROPIC_API_KEY ||= 'a';
process.env.DRIVE_OAUTH_CLIENT_ID ||= 'cid';
process.env.DRIVE_OAUTH_CLIENT_SECRET ||= 'csec';
process.env.DRIVE_OAUTH_REFRESH_TOKEN ||= 'rtok';
process.env.JOBS_MAX_CONCURRENT = '2';

const { claim, release, stateOf, runningCount, withDeadline, _reset } =
  await import('../src/lib/jobClaims.js');
const { config } = await import('../src/config.js');

beforeEach(() => _reset());

describe('a redispatch of a running job does not run it again', () => {
  test('the second claim on the same jobId is refused as a duplicate', () => {
    assert.equal(claim('J1', 'ai_pr_create').ok, true);
    const second = claim('J1', 'ai_pr_create');
    // THE finding. Without this, the ten-minute redispatch opened a second pull request.
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'duplicate');
    assert.equal(second.state.status, 'running');
    assert.equal(second.state.kind, 'ai_pr_create');
  });

  test('a duplicate arriving just AFTER completion is still refused', () => {
    claim('J2', 'ai_pr_create');
    release('J2', 'completed');
    // The Worker may already have had the callback in flight when it decided to re-dispatch.
    const again = claim('J2', 'ai_pr_create');
    assert.equal(again.ok, false);
    assert.equal(again.reason, 'duplicate');
    assert.equal(again.state.status, 'completed');
  });

  test('a failed job also reports its outcome rather than re-running', () => {
    claim('J3', 'ai_fix_generate');
    release('J3', 'failed', 'model refused');
    const again = claim('J3', 'ai_fix_generate');
    assert.equal(again.reason, 'duplicate');
    assert.equal(again.state.status, 'failed');
    assert.match(again.state.error, /model refused/);
  });

  test('a finished claim is forgotten eventually, so ids are not retained forever', () => {
    const t0 = Date.parse('2026-09-15T10:00:00Z');
    claim('J4', 'ai_fix_generate', t0);
    release('J4', 'completed', null, t0);
    // Still remembered a minute later.
    assert.equal(claim('J4', 'ai_fix_generate', t0 + 60_000).reason, 'duplicate');
    // Swept an hour later — the map must not grow without bound.
    assert.equal(claim('J4', 'ai_fix_generate', t0 + 3600_000).ok, true);
  });

  test('a different jobId is unaffected', () => {
    assert.equal(claim('A', 'ai_fix_generate').ok, true);
    assert.equal(claim('B', 'ai_fix_generate').ok, true);
    assert.equal(runningCount(), 2);
  });

  test('an unknown job has no state', () => {
    assert.equal(stateOf('never-seen'), null);
  });
});

describe('concurrency is bounded', () => {
  test('past the cap a claim is refused so the Worker can fall back', () => {
    assert.equal(claim('C1', 'pdf_convert').ok, true);
    assert.equal(claim('C2', 'pdf_convert').ok, true);
    const third = claim('C3', 'pdf_convert');
    // A free-tier instance has one CPU and 512 MB; there was no ceiling at all before.
    assert.equal(third.ok, false);
    assert.equal(third.reason, 'at-capacity');
  });

  test('a finished job frees the slot', () => {
    claim('C1', 'pdf_convert');
    claim('C2', 'pdf_convert');
    release('C1', 'completed');
    assert.equal(runningCount(), 1);
    assert.equal(claim('C3', 'pdf_convert').ok, true);
  });

  test('releasing an unknown id is harmless', () => {
    release('nope', 'completed');
    assert.equal(runningCount(), 0);
  });
});

describe('a job cannot hold its slot forever', () => {
  test('work that overruns is rejected with an actionable message', async () => {
    const never = () => new Promise(() => {});
    await assert.rejects(
      () => withDeadline(never, 30, 'ai_pr_create (J9)'),
      (e) => {
        assert.equal(e.deadline, true);
        assert.match(e.message, /deadline/);
        // It does NOT claim to have stopped the work — see the note in jobClaims.js. Telling
        // an operator "it may still be running, check before re-running" is the truth;
        // "cancelled" would not be.
        assert.match(e.message, /may still be running/);
        assert.match(e.message, /duplicate work/);
        return true;
      }
    );
  });

  test('work that finishes in time resolves normally', async () => {
    const v = await withDeadline(async () => 'done', 1000, 'x');
    assert.equal(v, 'done');
  });

  test('a real failure is passed through, not masked as a timeout', async () => {
    await assert.rejects(
      () => withDeadline(async () => { throw new Error('drive said no'); }, 1000, 'x'),
      /drive said no/
    );
  });

  test('the deadline sits just under the Worker’s reconcile window', () => {
    // The Worker re-dispatches after 10 minutes of silence. A job that is going to fail should
    // say so BEFORE that, or the redispatch races the original — which is the whole finding.
    const WORKER_STUCK_MS = 10 * 60 * 1000;
    assert.ok(config.jobDeadlineMs < WORKER_STUCK_MS,
      `${config.jobDeadlineMs} must be under the Worker's ${WORKER_STUCK_MS}`);
    assert.ok(config.jobDeadlineMs > 5 * 60 * 1000, 'but long enough for a slow model or a PDF batch');
  });
});

describe('the route uses all three', () => {
  const src = readFileSync(new URL('../src/routes/jobs.js', import.meta.url), 'utf8');
  const handler = src.slice(src.indexOf("jobsRouter.post('/jobs'"));

  test('it claims BEFORE answering 202 and before running anything', () => {
    const beforeAck = handler.slice(0, handler.indexOf('res.status(202).json({ accepted: true, jobId })'));
    assert.match(beforeAck, /claim\(jobId, kind\)/);
  });

  test('a duplicate is answered 202 with the existing state, not an error', () => {
    // The Worker asked for this job and it IS running. A 4xx/5xx would make it park a
    // perfectly healthy job.
    assert.match(handler, /duplicate: true, state: verdict\.state/);
    assert.match(handler, /accepted: true, jobId, duplicate: true/);
  });

  test('at capacity it answers 503 so the Worker can fall back', () => {
    assert.match(handler, /at-capacity/);
    assert.match(handler, /503/);
  });

  test('the handler runs under the deadline and the claim is released on both paths', () => {
    assert.match(handler, /withDeadline\(\(\) => handler\(payload \|\| \{\}\), config\.jobDeadlineMs/);
    assert.match(handler, /release\(jobId, 'completed'\)/);
    assert.match(handler, /release\(jobId, 'failed', message\)/);
  });

  test('the fire-and-forget run is no longer unrecorded', () => {
    // The exact shape the finding described.
    assert.ok(!/const result = await handler\(payload \|\| \{\}\);/.test(handler),
      'the unbounded, unclaimed call must be gone');
  });
});
