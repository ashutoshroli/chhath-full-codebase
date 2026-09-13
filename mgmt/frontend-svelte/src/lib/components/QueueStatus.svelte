<script lang="ts">
  // Ported from React QueueStatus.jsx — polls the background PDF/WhatsApp queue
  // (20s), auto-kicks processing when work is waiting, shows an expandable pill.
  import { api } from '$lib/api';
  import { startPolling } from '$lib/polling';

  interface Props {
    refreshKey?: number;
  }
  let { refreshKey = undefined }: Props = $props();

  const QUEUE_POLL_MS = 20000;

  let counts = $state<any>(null);
  let open = $state(false);
  let recent = $state<any[]>([]);
  let kicked = false;

  async function load() {
    try {
      const res: any = await api.getCollectionQueueStatus();
      if (res && res.counts) {
        counts = res.counts;
        recent = res.recent || [];
        const waiting = (res.counts.pending || 0) + (res.counts.processing || 0);
        if (waiting > 0 && !kicked) {
          kicked = true;
          api.processCollectionQueue().catch(() => {}).finally(() => {
            setTimeout(() => { kicked = false; }, 15000);
          });
        }
      }
    } catch (e) { /* ignore */ }
  }

  $effect(() => startPolling(load, QUEUE_POLL_MS));

  // React: reload shortly after refreshKey changes.
  let lastKey: number | undefined = undefined;
  $effect(() => {
    const key = refreshKey;
    if (key === undefined) return;
    if (key === lastKey) return;
    lastKey = key;
    const t = setTimeout(load, 1500);
    return () => clearTimeout(t);
  });

  let pending = $derived(counts ? (counts.pending || 0) + (counts.processing || 0) : 0);
  let failed = $derived(counts ? counts.failed || 0 : 0);
</script>

{#if counts && !(pending === 0 && failed === 0)}
  <div style="margin:10px 0;">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      onclick={() => (open = !open)}
      style="display:inline-flex; align-items:center; gap:10px; cursor:pointer; padding:6px 12px; border-radius:20px; font-size:0.82rem; background:{failed > 0 ? '#fef2f2' : '#eff6ff'}; border:1px solid {failed > 0 ? '#fecaca' : '#bfdbfe'}; color:{failed > 0 ? '#b91c1c' : '#1d4ed8'};"
      title="Background PDF/WhatsApp queue"
    >
      <span class="material-icons-round" style="font-size:18px;">
        {pending > 0 ? 'sync' : (failed > 0 ? 'error_outline' : 'check_circle')}
      </span>
      {#if pending > 0}<span>{pending} in queue</span>{/if}
      {#if failed > 0}<span>{failed} failed</span>{/if}
      <span class="material-icons-round" style="font-size:16px;">{open ? 'expand_less' : 'expand_more'}</span>
    </div>

    {#if open}
      <div class="glass-card" style="padding:10px; margin-top:8px; font-size:0.78rem; max-width:520px;">
        <div style="margin-bottom:6px; color:var(--text-muted);">
          Pending: {counts.pending || 0} · Processing: {counts.processing || 0} · Done: {counts.done || 0} · Failed: {counts.failed || 0}
        </div>
        {#if recent.length > 0}
          <table style="width:100%; border-collapse:collapse;">
            <tbody>
              {#each recent.slice(0, 8) as j (j.job_id)}
                <tr style="border-top:1px solid #f0f0f0;">
                  <td style="padding:3px 4px;">{j.doc_type || '—'} {j.year}</td>
                  <td style="padding:3px 4px;">
                    <span style="color:{j.status === 'failed' ? '#b91c1c' : (j.status === 'done' ? '#16a34a' : '#1d4ed8')};">
                      {j.status}
                    </span>
                  </td>
                  <td style="padding:3px 4px; color:#b91c1c;">{j.last_error ? j.last_error.slice(0, 60) : ''}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    {/if}
  </div>
{/if}
