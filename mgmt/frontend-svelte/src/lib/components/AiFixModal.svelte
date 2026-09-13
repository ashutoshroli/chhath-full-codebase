<script lang="ts">
  // Ported from React AiFixModal.jsx — generates an AI fix for an error (polling
  // a Render job), previews the diff, and creates a PR on confirm.
  import { api, reportClientError } from '$lib/api';
  import Modal from './Modal.svelte';
  import DiffView from './DiffView.svelte';

  interface Props {
    error: any;
    onClose: () => void;
  }
  let { error, onClose }: Props = $props();

  const POLL_INTERVAL_MS = 2500;
  const POLL_TIMEOUT_MS = 3 * 60 * 1000;

  let loading = $state(true);
  let statusMsg = $state('Loading…');
  let errMsg = $state('');
  let result = $state<any>(null);
  let creating = $state(false);
  let pr = $state<any>(null);
  let guidance = $state('');
  let cancelled = false;

  async function pollRenderJob(jobId: string, isCancelled: () => boolean): Promise<any> {
    const start = Date.now();
    while (true) {
      if (isCancelled()) throw new Error('cancelled');
      if (Date.now() - start > POLL_TIMEOUT_MS) {
        throw new Error('This is taking longer than expected. It keeps running in the background — re-open "Fix using AI" shortly to see the result.');
      }
      let res: any;
      try {
        res = await api.getRenderJobStatus(jobId);
      } catch (e) {
        res = null;
      }
      const job = res && res.job;
      if (job && (job.status === 'completed' || job.status === 'failed')) return job;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  function resultFromFixRow(fix: any) {
    let files: any[] = [];
    try { files = fix.files_json ? JSON.parse(fix.files_json) : []; } catch (e) { files = []; }
    return {
      fixId: fix.fix_id,
      diff: fix.diff || '',
      reasoning: fix.reasoning || '',
      files,
      model: fix.model || '',
      tokens: { prompt: fix.prompt_tokens || 0, completion: fix.completion_tokens || 0 }
    };
  }

  async function pollGenerate(jobId: string, fixId: string, isCancelled: () => boolean) {
    statusMsg = 'Generating a fix with AI… this runs in the background and can take a little while.';
    const job = await pollRenderJob(jobId, isCancelled);
    if (isCancelled()) return;
    if (job.status === 'failed') {
      errMsg = job.error || 'The AI fix could not be generated.';
    } else {
      const r = job.result || {};
      result = { fixId, diff: r.diff, reasoning: r.reasoning, files: r.files, model: r.model, tokens: r.tokens };
    }
  }

  async function startFlow(force: boolean, guidanceText?: string) {
    const isCancelled = () => cancelled;
    loading = true;
    errMsg = '';
    result = null;
    pr = null;
    statusMsg = force ? 'Starting a new AI fix…' : 'Loading…';
    try {
      if (!force) {
        const latest: any = await api.getLatestAiFixForError(error.error_id);
        const fix = latest && latest.fix;
        if (fix && (fix.status === 'fix_generated' || fix.status === 'pr_created' || fix.status === 'ci_running' || fix.status === 'ci_failed' || fix.status === 'needs_manual_review')) {
          result = resultFromFixRow(fix);
          if (fix.status === 'pr_created' && fix.pr_number) {
            pr = { prNumber: fix.pr_number, prUrl: fix.pr_url, branch: fix.branch };
          }
          loading = false;
          return;
        }
        if (fix && fix.status === 'pending' && latest.jobId) {
          await pollGenerate(latest.jobId, fix.fix_id, isCancelled);
          if (!isCancelled()) loading = false;
          return;
        }
      }

      const start: any = await api.generateAiFix(error.error_id, force, force ? (guidanceText || '') : '');
      if (start && start.reused && !start.jobId) {
        const row: any = await api.getAiFix(start.fixId);
        result = resultFromFixRow(row);
        if (row.status === 'pr_created' && row.pr_number) {
          pr = { prNumber: row.pr_number, prUrl: row.pr_url, branch: row.branch };
        }
        loading = false;
        return;
      }
      if (start && start.jobId) {
        await pollGenerate(start.jobId, start.fixId, isCancelled);
      } else if (start) {
        result = start;
      }
    } catch (err) {
      if (isCancelled()) return;
      errMsg = (err as Error).message || 'Failed to generate a fix.';
      reportClientError('AiFixModal', 'startFlow failed', err as Error, { errorId: error.error_id, force: !!force });
    } finally {
      if (!isCancelled()) loading = false;
    }
  }

  // React: useEffect on [error.error_id].
  let lastErrId = '';
  $effect(() => {
    const id = error.error_id;
    if (id === lastErrId) return;
    lastErrId = id;
    cancelled = false;
    startFlow(false);
    return () => { cancelled = true; };
  });

  function moveToBackground() {
    cancelled = true;
    onClose();
  }

  function regenerate() {
    cancelled = false;
    startFlow(true, guidance.trim());
  }

  function confirmCreatePr() {
    if (!result) return;
    creating = true;
    errMsg = '';
    (async () => {
      try {
        const start: any = await api.createAiFixPr(result.fixId);
        if (start && start.alreadyCreated) {
          pr = { prNumber: start.prNumber, prUrl: start.prUrl, branch: start.branch };
          return;
        }
        if (start && start.jobId) {
          const job = await pollRenderJob(start.jobId, () => cancelled);
          if (cancelled) return;
          if (job.status === 'failed') {
            errMsg = job.error || 'Failed to create the pull request.';
          } else {
            const r = job.result || {};
            pr = { prNumber: r.prNumber, prUrl: r.prUrl, branch: r.branch };
          }
        } else if (start) {
          pr = { prNumber: start.prNumber, prUrl: start.prUrl, branch: start.branch };
        }
      } catch (err) {
        errMsg = (err as Error).message || 'Failed to create the pull request.';
        reportClientError('AiFixModal', 'createAiFixPr failed', err as Error, { fixId: result.fixId });
      } finally {
        creating = false;
      }
    })();
  }
</script>

<Modal open {onClose}>
  <h3 style="margin-top:0; margin-bottom:4px;">Fix using AI</h3>
  <p style="font-size:0.75rem; color:var(--text-muted); margin-top:0; margin-bottom:12px;">
    Error Ref: {error.error_id} · {error.source} · {error.page || '-'}
  </p>

  {#if loading}
    <div class="inline-spinner" style="padding:16px 0;">{statusMsg}</div>
    <div style="font-size:0.72rem; color:var(--text-muted); margin-bottom:8px;">
      You can move this to the background — it keeps running and you can re-open "Fix using AI" to see the result.
    </div>
  {/if}

  {#if !loading && errMsg}
    <div class="error-banner" style="margin-bottom:12px;">{errMsg}</div>
  {/if}

  {#if !loading && result}
    <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:10px; margin-bottom:12px;">
      <div style="font-size:0.75rem; font-weight:700; color:#075985; margin-bottom:4px;">AI reasoning</div>
      <div style="font-size:0.82rem; color:#0c4a6e; white-space:pre-wrap;">{result.reasoning || '(no summary provided)'}</div>
    </div>

    <div style="font-size:0.75rem; font-weight:700; margin-bottom:6px;">Proposed change (diff)</div>
    <DiffView diff={result.diff} />

    <div style="display:flex; flex-wrap:wrap; gap:12px; font-size:0.72rem; color:var(--text-muted); margin:10px 0;">
      <span>Model: {result.model}</span>
      <span>Tokens: {result.tokens ? `${result.tokens.prompt} in / ${result.tokens.completion} out` : 'n/a'}</span>
      <span>Files used: {(result.files || []).length ? result.files.map((f: any) => f.path).join(', ') : '(none — inferred from stack)'}</span>
    </div>

    {#if pr}
      <div style="background:#dcfce7; color:#166534; border-radius:8px; padding:10px 12px; font-size:0.82rem; margin-bottom:12px;">
        ✅ Pull request <strong>#{pr.prNumber}</strong> created on branch <code>{pr.branch}</code>.
        <a href={pr.prUrl} target="_blank" rel="noreferrer" style="color:#166534; font-weight:700;">Open PR on GitHub →</a>
        <div style="margin-top:4px; font-size:0.72rem;">Review the CI checks there before merging.</div>
      </div>
    {:else}
      <div style="background:#FEF3C7; color:#92400E; border-radius:8px; padding:8px 10px; font-size:0.78rem; margin-bottom:12px;">
        Review the diff above. On <strong>Confirm</strong>, a branch <code>fix/error-{error.error_id}</code> is created,
        the change is committed, and a pull request is opened for review (in the background). Nothing is merged automatically.
      </div>
    {/if}
  {/if}

  {#if !loading && (result || errMsg) && !pr}
    <div style="margin-bottom:12px;">
      <label style="display:block; font-size:0.72rem; color:var(--text-muted); margin-bottom:4px;">
        Optional: guide the next attempt (used when you press Re-generate)
      </label>
      <textarea
        bind:value={guidance}
        rows={2}
        maxlength={1000}
        placeholder="e.g. Don't hardcode the domain — read it from VITE_API_URL. Only change api.js."
        style="width:100%; font-size:0.8rem; font-family:inherit; padding:8px; border-radius:6px; border:1px solid #d1d5db; box-sizing:border-box;"
      ></textarea>
    </div>
  {/if}

  <div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">
    {#if loading}
      <button type="button" class="btn-submit" style="width:auto; background:#e0e7ff; color:#3730a3;" onclick={moveToBackground}>
        Move to background
      </button>
    {/if}
    {#if !loading && result && !pr}
      <button type="button" class="btn-submit" style="width:auto; background:#e5e7eb; color:#111;" onclick={regenerate} disabled={creating}>
        Re-generate
      </button>
    {/if}
    {#if !loading && errMsg}
      <button type="button" class="btn-submit" style="width:auto; background:#e5e7eb; color:#111;" onclick={regenerate}>
        Try again
      </button>
    {/if}
    {#if !loading && result && !pr}
      <button type="button" class="btn-submit" style="width:auto;" onclick={confirmCreatePr} disabled={creating}>
        {creating ? 'Creating PR…' : 'Confirm & create PR'}
      </button>
    {/if}
    <button type="button" class="btn-submit" style="width:auto; background:#e5e7eb; color:#111;" onclick={onClose}>
      {pr ? 'Done' : 'Close'}
    </button>
  </div>
</Modal>
