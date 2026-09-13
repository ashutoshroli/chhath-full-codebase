<script lang="ts">
  // Ported from React ReportErrorButton.jsx — logs an error on mount to get an
  // errorId, then lets the user forward it to the Superadmin via WhatsApp.
  import { api } from '$lib/api';

  interface Props {
    page: string;
    message: string;
    stack?: string;
  }
  let { page, message, stack = '' }: Props = $props();

  let errorId = $state<string | null>(null);
  let sending = $state(false);
  let sent = $state(false);
  let logFailed = $state(false);

  // React: useEffect on [message, page] — log the error and capture its id.
  let lastKey = '';
  $effect(() => {
    const key = `${message}|${page}`;
    if (key === lastKey) return;
    lastKey = key;
    let alive = true;
    logFailed = false;
    api.logError('frontend', page, message, stack, {})
      .then((res: any) => {
        if (!alive) return;
        if (res && res.errorId) errorId = res.errorId;
        else logFailed = true;
      })
      .catch(() => { if (alive) logFailed = true; });
    return () => { alive = false; };
  });

  async function send() {
    if (!errorId) return;
    sending = true;
    try {
      await api.reportErrorToWhatsApp(errorId);
      sent = true;
    } catch (err) {
      alert((err as Error).message);
    } finally {
      sending = false;
    }
  }
</script>

{#if sent}
  <p style="color:var(--success); font-size:0.85rem; margin-top:10px;">✓ Report sent to Superadmin on WhatsApp.</p>
{:else if logFailed}
  <p style="color:var(--text-muted); font-size:0.8rem; margin-top:10px;">
    This error could not be recorded on the server (an internet or server problem).
    Please inform the Superadmin directly.
  </p>
{:else}
  <button
    type="button"
    class="btn-submit"
    style="background:#e5e7eb; color:#111; margin-top:10px;"
    onclick={send}
    disabled={!errorId || sending}
  >
    {sending ? 'Sending...' : !errorId ? 'Preparing...' : '📩 Report this to Superadmin'}
  </button>
{/if}
