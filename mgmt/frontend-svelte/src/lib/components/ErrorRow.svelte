<script lang="ts">
  // Ported from the ErrorRow sub-component of React views/ErrorLog.jsx — one
  // logged error with expandable stack/context, AI-status badge, and actions
  // (Fix using AI / Report to WhatsApp).
  import { isTruthyFlag } from '$lib/flags';

  interface Props {
    r: any;
    onReport: (errorId: string) => void;
    onAiFix: (r: any) => void;
    busy: boolean;
    aiFix: any;
  }
  let { r, onReport, onAiFix, busy, aiFix }: Props = $props();

  const SOURCE_COLORS: Record<string, { bg: string; fg: string }> = {
    backend: { bg: '#FEE2E2', fg: '#991B1B' },
    frontend: { bg: '#DBEAFE', fg: '#1E40AF' },
    auth: { bg: '#FEF3C7', fg: '#92400E' },
    'whatsapp-queue': { bg: '#DCFCE7', fg: '#166534' },
    'whatsapp-loans': { bg: '#DCFCE7', fg: '#166534' },
    'whatsapp-template': { bg: '#DCFCE7', fg: '#166534' }
  };
  function badgeStyle(source: string): string {
    const c = SOURCE_COLORS[source] || { bg: '#F3F4F6', fg: '#374151' };
    return `background:${c.bg}; color:${c.fg};`;
  }

  const AI_STATUS: Record<string, { label: string; bg: string; fg: string }> = {
    pending: { label: 'AI: pending', bg: '#F3F4F6', fg: '#374151' },
    fix_generated: { label: 'AI: fix generated', bg: '#DBEAFE', fg: '#1E40AF' },
    pr_created: { label: 'AI: PR created', bg: '#E0E7FF', fg: '#3730A3' },
    ci_running: { label: 'AI: CI running', bg: '#FEF3C7', fg: '#92400E' },
    ci_passed: { label: 'AI: CI passed — ready to merge', bg: '#DCFCE7', fg: '#166534' },
    ci_failed: { label: 'AI: CI failed (retrying)', bg: '#FEE2E2', fg: '#991B1B' },
    merged: { label: 'AI: merged', bg: '#DCFCE7', fg: '#166534' },
    needs_manual_review: { label: 'AI: needs manual review', bg: '#FEE2E2', fg: '#991B1B' },
    failed: { label: 'AI: failed', bg: '#FEE2E2', fg: '#991B1B' }
  };

  let open = $state(false);
  let hasDetails = $derived(!!(r.stack || r.context));

  let aiBadge = $derived.by(() => {
    if (!aiFix || !aiFix.status) return null;
    const s = AI_STATUS[aiFix.status] || { label: `AI: ${aiFix.status}`, bg: '#F3F4F6', fg: '#374151' };
    const attempts = aiFix.attempts ? ` (${aiFix.attempts}/3)` : '';
    return { ...s, label: s.label + attempts, prUrl: aiFix.pr_url, prNumber: aiFix.pr_number };
  });
</script>

<div class="glass-card" style="padding:12px; margin-bottom:10px;">
  <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">
    <span class="badge" style={badgeStyle(r.source)}>{r.source}</span>
    <span style="font-size:0.75rem; color:var(--text-muted);">
      {r.created_at ? new Date(r.created_at).toLocaleString('en-IN') : ''}
    </span>
  </div>
  <p style="font-size:0.85rem; margin:6px 0; word-break:break-word;"><strong>Page:</strong> {r.page || '-'}</p>
  <p style="font-size:0.85rem; margin:6px 0; word-break:break-word;">{r.message}</p>

  {#if hasDetails}
    <button type="button" onclick={() => (open = !open)} style="background:none; border:none; padding:0; cursor:pointer; color:var(--primary-saffron); font-size:0.75rem; text-decoration:underline;">
      {open ? 'Hide details' : 'View stack / context'}
    </button>
  {/if}
  {#if open}
    <pre style="margin-top:8px; background:#f9fafb; border:1px solid #eee; border-radius:8px; padding:10px; font-size:0.7rem; white-space:pre-wrap; word-break:break-word; max-height:260px; overflow-y:auto;">{r.context ? `context: ${r.context}\n\n` : ''}{r.stack || '(no stack trace was recorded)'}</pre>
  {/if}

  <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; gap:8px; flex-wrap:wrap;">
    <span style="font-size:0.7rem; color:var(--text-muted); display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap;">
      Ref: {r.error_id || '(missing)'}
      {#if aiBadge}
        {#if aiBadge.prUrl}
          <a href={aiBadge.prUrl} target="_blank" rel="noreferrer" style="text-decoration:none;" title={`PR #${aiBadge.prNumber || ''}`}>
            <span class="badge" style="background:{aiBadge.bg}; color:{aiBadge.fg};">{aiBadge.label}</span>
          </a>
        {:else}
          <span class="badge" style="background:{aiBadge.bg}; color:{aiBadge.fg};">{aiBadge.label}</span>
        {/if}
      {/if}
    </span>
    {#if isTruthyFlag(r.reported)}
      <span style="font-size:0.75rem; color:var(--success);">✓ Reported</span>
    {:else if !r.error_id}
      <span style="font-size:0.7rem; color:var(--text-muted);">Old record (Ref missing) — cannot be reported</span>
    {:else}
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn-submit" style="width:auto; padding:4px 10px; font-size:0.75rem; background:#111827;" onclick={() => onAiFix(r)} title="Generate a fix with AI and preview the diff">
          🤖 Fix using AI
        </button>
        <button class="btn-submit" style="width:auto; padding:4px 10px; font-size:0.75rem;" onclick={() => onReport(r.error_id)} disabled={busy}>
          {busy ? 'Sending...' : 'Report to WhatsApp'}
        </button>
      </div>
    {/if}
  </div>
</div>
