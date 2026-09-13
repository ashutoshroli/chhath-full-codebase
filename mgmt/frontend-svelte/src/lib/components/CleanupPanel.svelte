<script lang="ts">
  // Ported from React CleanupPanel.jsx — Superadmin-only panel to preview/delete
  // old or all records from a target table (used by Email + WhatsApp logs).
  import { api } from '$lib/api';
  import { isSuperadmin } from '$lib/permissions';

  interface Props {
    target: string;
    label: string;
    role: string;
    hasStatus?: boolean;
    onDone?: (() => void) | null;
  }
  let { target, label, role, hasStatus = false, onDone = null }: Props = $props();

  let mode = $state('olderThan');
  let days = $state('30');
  let count = $state<number | null>(null);
  let busy = $state(false);
  let error = $state('');

  async function preview() {
    error = '';
    count = null;
    busy = true;
    try {
      const r: any = await api.cleanupPreview(target, mode, mode === 'olderThan' ? days : undefined);
      count = r.count;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function run() {
    const desc = mode === 'all' ? 'ALL records' : mode === 'olderThan' ? `records older than ${days} day(s)` : `${mode} records`;
    if (!confirm(`Delete ${desc} from ${label}? This cannot be undone.`)) return;
    error = '';
    busy = true;
    try {
      const r: any = await api.cleanupData(target, mode, mode === 'olderThan' ? days : undefined);
      count = null;
      alert(`Removed ${r.removed} record(s) from ${label}.`);
      onDone && onDone();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

{#if isSuperadmin(role)}
  <div class="glass-card" style="padding:14px; margin-top:12px; border:1px solid #fde68a; background:#fffbeb;">
    <strong style="display:block; margin-bottom:8px;">🧹 Clean up {label}</strong>
    {#if error}<div class="error-banner" style="margin-bottom:8px;">{error}</div>{/if}
    <div class="form-group" style="margin-bottom:8px;">
      <label style="font-size:0.8rem;">What to delete</label>
      <select value={mode} onchange={(e) => { mode = (e.currentTarget as HTMLSelectElement).value; count = null; }}>
        <option value="olderThan">Keep last N days (delete older)</option>
        {#if hasStatus}<option value="sent">Only Sent</option>{/if}
        {#if hasStatus}<option value="failed">Only Failed</option>{/if}
        <option value="all">Everything (All)</option>
      </select>
    </div>
    {#if mode === 'olderThan'}
      <div class="form-group" style="margin-bottom:8px;">
        <label style="font-size:0.8rem;">Keep last (days)</label>
        <input type="number" min="0" value={days} oninput={(e) => { days = (e.currentTarget as HTMLInputElement).value; count = null; }} style="width:120px;" />
      </div>
    {/if}
    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
      <button type="button" class="btn-submit" style="width:auto; background:#e5e7eb; color:#111;" onclick={preview} disabled={busy}>
        {busy ? '...' : 'Preview count'}
      </button>
      <button type="button" class="btn-submit" style="width:auto; background:var(--danger, #dc2626);" onclick={run} disabled={busy}>
        {busy ? 'Working...' : 'Delete'}
      </button>
      {#if count !== null}<span style="font-size:0.85rem; color:var(--text-muted);">{count} record(s) match</span>{/if}
    </div>
  </div>
{/if}
