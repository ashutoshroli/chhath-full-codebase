<script lang="ts">
  // Ported from React UserProfileModal.jsx — fetches getUserProfile(userId) and
  // renders user details, contributions, loans, committee history, guarantor list.
  import { api, fmt } from '$lib/api';
  import Modal from './Modal.svelte';

  interface Props {
    userId: string | null;
    onClose: () => void;
  }
  let { userId, onClose }: Props = $props();

  let data = $state<any>(null);
  let loading = $state(false);
  let error = $state('');

  let lastId: string | null = null;
  $effect(() => {
    const id = userId;
    if (id === lastId) return;
    lastId = id;
    if (!id) { data = null; return; }
    loading = true;
    error = '';
    data = null;
    api.getUserProfile(id)
      .then((d: any) => (data = d))
      .catch((err: Error) => (error = err.message))
      .finally(() => (loading = false));
  });

  function contribInfo(c: any) {
    const isResell = /^(true|1|yes)$/i.test((c.IsResell || '').toString().trim());
    const type = (c.Type || '1').toString();
    const isCash = type === '1' && !isResell;
    const typeLabel = isResell
      ? 'पुनर्विक्रय / Resell'
      : type === '2' ? 'सामान / Material' : type === '3' ? 'सेवा / Service' : '';
    return { isResell, type, isCash, typeLabel };
  }
</script>

<Modal open={!!userId} {onClose} title="Member profile">
  {#if loading}
    <div class="inline-spinner">Loading profile...</div>
  {/if}
  {#if error}
    <div role="alert" class="error-banner">{error}</div>
  {/if}
  {#if data}
    <h3 style="margin-bottom:10px;">{data.user.Name}</h3>
    <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:18px; line-height:1.6;">
      <div>User ID: {data.user.ID || userId || '-'}</div>
      <div>Village: {data.user.Village || '-'}</div>
      <div>Mobile: {data.user.Mobile || 'N/A'}</div>
      <div>Father's Name: {data.user["Father's Name"] || 'N/A'}</div>
      <div>Email: {data.user.Email || 'N/A'}</div>
      <div>WhatsApp: {data.user.WhatsApp || 'N/A'}</div>
      {#if data.user.Designation}<div>Designation: {data.user.Designation}</div>{/if}
    </div>

    <h4 style="margin-bottom:8px;">Contributions — Total: {fmt(data.totalContributed)}</h4>
    {#if data.contributions.length === 0}
      <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:15px;">No contributions found.</p>
    {:else}
      <div class="profile-box-grid" style="margin-bottom:18px;">
        {#each data.contributions as c, i (i)}
          {@const info = contribInfo(c)}
          <div class="profile-mini-box">
            {#if info.isCash}
              <strong style="color:var(--success);">{fmt(c.Amount)}</strong>
            {:else}
              <strong style="color:var(--text-main); font-size:0.85rem;" title={c.Detail || info.typeLabel}>
                {c.Detail ? c.Detail : info.typeLabel}
              </strong>
            {/if}
            <span>{c.Year}{info.isCash && c['Payment Mode'] ? ` (${c['Payment Mode']})` : (!info.isCash && info.typeLabel ? ` · ${info.typeLabel}` : '')}</span>
          </div>
        {/each}
      </div>
    {/if}

    <h4 style="margin-bottom:8px;">Loans Taken</h4>
    {#if data.loansTaken.length === 0}
      <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:15px;">No loans taken.</p>
    {:else}
      <div style="margin-bottom:18px;">
        {#each data.loansTaken as l, i (i)}
          <div style="font-size:0.85rem; padding:5px 0; border-bottom:1px dashed #e5e7eb; display:flex; justify-content:space-between;">
            <span>{l.Year} — {fmt(l.Amount)} @ {l['Intrest Rate'] || 0}% / {l.Tenure || 0}mo</span>
            <span class="badge {l.Status === 'Repaid' ? 'badge-ok' : 'badge-warn'}">{l.Status}</span>
          </div>
        {/each}
      </div>
    {/if}

    {#if data.committeeYears && data.committeeYears.length > 0}
      <h4 style="margin-bottom:8px;">Committee Membership History</h4>
      <div class="profile-box-grid" style="margin-bottom:18px;">
        {#each data.committeeYears as c, i (i)}
          <div class="profile-mini-box">
            <strong>{c['View Role'] || '—'}</strong>
            <span>{c.Year}</span>
          </div>
        {/each}
      </div>
    {/if}

    <h4 style="margin-bottom:8px;">Guarantor For</h4>
    {#if data.guarantorFor.length === 0}
      <p style="font-size:0.85rem; color:var(--text-muted);">Has not acted as a guarantor for anyone.</p>
    {:else}
      <div>
        {#each data.guarantorFor as g, i (i)}
          <div style="font-size:0.85rem; padding:5px 0; border-bottom:1px dashed #e5e7eb; display:flex; justify-content:space-between;">
            <span>{g.Year} — for {g.LoanerName} ({g.Amount != null ? fmt(g.Amount) : 'N/A'})</span>
            {#if g.Status}<span class="badge {g.Status === 'Repaid' ? 'badge-ok' : 'badge-warn'}">{g.Status}</span>{/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</Modal>
