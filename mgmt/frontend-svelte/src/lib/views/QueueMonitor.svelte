<script lang="ts">
  // Ported from React views/QueueMonitor.jsx — Superadmin view of all background
  // PDF/WhatsApp jobs with status counts, filters, retry, and 10s polling.
  import { api } from '$lib/api';
  import { startPolling } from '$lib/polling';

  const STATUS_FILTERS = [
    { id: '', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'processing', label: 'Processing' },
    { id: 'failed', label: 'Failed' },
    { id: 'done', label: 'Done' }
  ];

  const STATUS_COLOR: Record<string, string> = {
    pending: '#1d4ed8',
    processing: '#1d4ed8',
    done: '#16a34a',
    failed: '#b91c1c'
  };

  function fmtTime(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }

  let data = $state<any>(null);
  let loading = $state(true);
  let error = $state('');
  let status = $state('');
  let retrying = $state<string | null>(null);
  let notice = $state('');

  async function load(showSpinner = false) {
    if (showSpinner) loading = true;
    error = '';
    try {
      const res: any = await api.getQueueJobsForSuperadmin(status || undefined, 200);
      data = res;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  $effect(() => startPolling(() => load(false), 10000));

  // React: useEffect on [status].
  let lastStatus = '__init__';
  $effect(() => {
    if (status === lastStatus) return;
    lastStatus = status;
    load(true);
  });

  async function retry(jobId: string) {
    retrying = jobId;
    notice = '';
    try {
      await api.retryQueueJob(jobId);
      notice = `Job ${jobId} re-queued. It will process shortly.`;
      await load(false);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      retrying = null;
    }
  }

  let counts = $derived((data && data.counts) || { pending: 0, processing: 0, done: 0, failed: 0 });
  let maxAttempts = $derived((data && data.maxAttempts) || 3);
  let jobs = $derived((data && data.jobs) || []);

  const COUNT_CARDS = [
    { key: 'pending', label: 'Pending', color: '#1d4ed8', bg: '#eff6ff' },
    { key: 'processing', label: 'Processing', color: '#1d4ed8', bg: '#eff6ff' },
    { key: 'done', label: 'Done', color: '#16a34a', bg: '#f0fdf4' },
    { key: 'failed', label: 'Failed', color: '#b91c1c', bg: '#fef2f2' }
  ];
</script>

<h2 style="margin-bottom:6px;">Queue Monitor</h2>
<p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:15px;">
  Background jobs for every user — PDF generation and WhatsApp messaging that
  run after a collection is saved. Failed or stuck jobs can be retried here.
  This view refreshes automatically every 10 seconds.
</p>

<div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:15px;">
  {#each COUNT_CARDS as c (c.key)}
    <div style="background:{c.bg}; color:{c.color}; border-radius:10px; padding:10px 16px; min-width:90px; text-align:center;">
      <div style="font-size:1.4rem; font-weight:700;">{counts[c.key] || 0}</div>
      <div style="font-size:0.78rem;">{c.label}</div>
    </div>
  {/each}
</div>

<div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:15px;">
  {#each STATUS_FILTERS as f (f.id)}
    <button
      onclick={() => (status = f.id)}
      style="padding:6px 14px; border-radius:20px; font-size:0.82rem; cursor:pointer; border:1px solid {status === f.id ? 'var(--primary-saffron)' : '#d1d5db'}; background:{status === f.id ? 'var(--primary-saffron)' : '#fff'}; color:{status === f.id ? '#fff' : '#374151'};"
    >
      {f.label}
    </button>
  {/each}
</div>

{#if notice}
  <div style="background:#DCFCE7; color:#166534; border-radius:8px; padding:10px 12px; font-size:0.85rem; margin-bottom:15px;">
    {notice}
  </div>
{/if}
{#if error}<div role="alert" class="error-banner">{error}</div>{/if}
{#if loading && !data}<div class="inline-spinner">Loading...</div>{/if}

{#if data}
  <div class="glass-card" style="padding:0; overflow-x:auto;">
    {#if jobs.length === 0}
      <div style="text-align:center; padding:20px; color:var(--text-muted);">No jobs match this filter.</div>
    {:else}
      <table style="width:100%; min-width:760px; border-collapse:collapse; font-size:0.82rem;">
        <thead>
          <tr style="text-align:left; color:var(--text-muted);">
            <th style="padding:8px 10px; white-space:nowrap;">User</th>
            <th style="padding:8px 10px; white-space:nowrap;">Document</th>
            <th style="padding:8px 10px; white-space:nowrap;">Year</th>
            <th style="padding:8px 10px; white-space:nowrap;">Status</th>
            <th style="padding:8px 10px; white-space:nowrap;">Attempts</th>
            <th style="padding:8px 10px; white-space:nowrap;">Created</th>
            <th style="padding:8px 10px; white-space:nowrap;">Error</th>
            <th style="padding:8px 10px; white-space:nowrap;">Action</th>
          </tr>
        </thead>
        <tbody>
          {#each jobs as j (j.job_id)}
            <tr style="border-top:1px solid #f0f0f0;">
              <td style="padding:8px 10px; white-space:nowrap;">{j.created_by || '—'}</td>
              <td style="padding:8px 10px; white-space:nowrap;">{j.doc_type || '(no document)'}</td>
              <td style="padding:8px 10px; white-space:nowrap;">{j.year || '—'}</td>
              <td style="padding:8px 10px; white-space:nowrap;">
                <span style="color:{STATUS_COLOR[j.status] || '#374151'}; font-weight:600;">{j.status}</span>
              </td>
              <td style="padding:8px 10px; white-space:nowrap;">{j.attempts || 0} / {maxAttempts}</td>
              <td style="padding:8px 10px; white-space:nowrap;">{fmtTime(j.created_at)}</td>
              <td style="padding:8px 10px; color:#b91c1c; max-width:260px;" title={j.last_error || ''}>
                {j.last_error ? j.last_error.slice(0, 120) : ''}
              </td>
              <td style="padding:8px 10px; white-space:nowrap;">
                {#if j.status !== 'done'}
                  <button
                    class="btn-submit"
                    style="width:auto; padding:5px 12px; background:var(--primary-saffron);"
                    disabled={retrying === j.job_id}
                    onclick={() => retry(j.job_id)}
                  >
                    {retrying === j.job_id ? 'Retrying...' : 'Retry'}
                  </button>
                {:else}
                  <span style="color:var(--text-muted);">—</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
{/if}
