<script lang="ts">
  // Ported from React views/ConsentReview.jsx — Superadmin review of accepted/
  // declined consents: photo/signature/geo/device evidence + approve/reject.
  import { api, fmt } from '$lib/api';
  import { driveImageUrl, driveImgOnError } from '$lib/driveUrl';

  const VERIFICATION_BADGE: Record<string, string> = {
    pending: 'badge-pending', verified: 'badge-ok', rejected: 'badge-warn'
  };
  const VERIFICATION_LABEL: Record<string, string> = {
    pending: 'Pending Verification', verified: 'Verified', rejected: 'Rejected'
  };

  let rows = $state<any[] | null>(null);
  let loading = $state(true);
  let error = $state('');
  let busyId = $state<string | null>(null);
  let remarksById = $state<Record<string, string>>({});
  let filter = $state('all');

  function load() {
    loading = true;
    api.getConsentsForReview()
      .then((r: any) => (rows = r))
      .catch((err: Error) => (error = err.message))
      .finally(() => (loading = false));
  }

  let loaded = false;
  $effect(() => {
    if (loaded) return;
    loaded = true;
    load();
  });

  async function decide(consentId: string, status: string) {
    busyId = consentId;
    error = '';
    try {
      await api.setConsentVerification(consentId, status, remarksById[consentId] || '');
      load();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busyId = null;
    }
  }

  let filtered = $derived((rows || []).filter((r) => filter === 'all' || r.status === filter));
</script>

<h2 style="margin-bottom:15px;">Consent Review</h2>
{#if error}<div role="alert" class="error-banner">{error}</div>{/if}

<div class="subtabs" style="margin-bottom:15px;">
  {#each [['all', 'All'], ['accepted', 'Accepted'], ['declined', 'Declined']] as [val, lbl] (val)}
    <button class="subtab-btn {filter === val ? 'active' : ''}" onclick={() => (filter = val)}>{lbl}</button>
  {/each}
</div>

{#if loading}<div class="inline-spinner">Loading...</div>{/if}
{#if !loading && filtered.length === 0}<div style="text-align:center; padding:20px;">No records found.</div>{/if}

{#if !loading}
  {#each filtered as r (r.consent_id)}
    <div class="glass-card" style="padding:15px; margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
        <div>
          <strong>{r.personName}</strong>{r.personNameHindi ? ` (${r.personNameHindi})` : ''}
          <div style="font-size:0.8rem; color:var(--text-muted);">
            {r.role === 'loaner' ? 'Loan Receiver' : 'Guarantor'} — Loan: {r.loanerName} ({fmt(r.loanAmount)}, {r.loanYear})
          </div>
          <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">
            Responded: {r.responded_at ? new Date(r.responded_at).toLocaleString('en-IN') : '-'}
          </div>
        </div>
        <span class="badge {r.status === 'accepted' ? 'badge-ok' : 'badge-warn'}">{r.status === 'accepted' ? 'Accepted' : 'Declined'}</span>
      </div>

      {#if r.status === 'declined'}
        <div style="background:#FEF3C7; color:#92400E; padding:10px; border-radius:8px; font-size:0.85rem; margin-top:10px;">
          <strong>Decline Remarks:</strong> {r.decline_remarks || '-'}
        </div>
      {/if}

      {#if r.status === 'accepted'}
        <div style="display:flex; gap:12px; margin-top:12px; flex-wrap:wrap;">
          {#if r.photo_url}
            <div>
              <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:4px;">Photo</div>
              <a href={r.photo_url} target="_blank" rel="noreferrer">
                <img src={driveImageUrl(r.photo_url, 400)} onerror={driveImgOnError(r.photo_url, 400)} alt="The consenting person, captured at the moment of signing" style="width:100px; height:100px; object-fit:cover; border-radius:8px; border:1px solid #eee;" />
              </a>
            </div>
          {/if}
          {#if r.signature_url}
            <div>
              <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:4px;">Signature</div>
              <a href={r.signature_url} target="_blank" rel="noreferrer">
                <img src={driveImageUrl(r.signature_url, 400)} onerror={driveImgOnError(r.signature_url, 400)} alt="Signature" style="width:140px; height:100px; object-fit:contain; border-radius:8px; border:1px solid #eee; background:#fff;" />
              </a>
            </div>
          {/if}
        </div>

        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:10px;">
          Device: {r.device_id ? r.device_id.slice(0, 12) + '...' : '-'} | IP: {r.ip_address || '-'}
          {#if r.geo_lat && r.geo_lng}
            | <a href={`https://maps.google.com/?q=${r.geo_lat},${r.geo_lng}`} target="_blank" rel="noreferrer">Location ({r.geo_accuracy ? Math.round(r.geo_accuracy) + 'm accuracy' : 'view'})</a>
          {/if}
        </div>

        <div style="margin-top:12px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span class="badge {VERIFICATION_BADGE[r.verification_status] || 'badge-pending'}">
            {VERIFICATION_LABEL[r.verification_status] || 'Pending Verification'}
          </span>
          {#if r.verification_status && r.verification_status !== 'pending'}
            <span style="font-size:0.75rem; color:var(--text-muted);">
              by {r.verified_by} on {r.verified_at ? new Date(r.verified_at).toLocaleDateString('en-IN') : ''}{r.verification_remarks ? ` — "${r.verification_remarks}"` : ''}
            </span>
          {/if}
        </div>

        {#if !r.verification_status || r.verification_status === 'pending'}
          <div style="margin-top:10px;">
            <input
              placeholder="Remarks (optional)"
              value={remarksById[r.consent_id] || ''}
              oninput={(e) => (remarksById = { ...remarksById, [r.consent_id]: (e.currentTarget as HTMLInputElement).value })}
              style="margin-bottom:8px;"
            />
            <div style="display:flex; gap:8px;">
              <button class="btn-submit" style="width:auto; padding:8px 16px; background:var(--success);" onclick={() => decide(r.consent_id, 'verified')} disabled={busyId === r.consent_id}>
                Approve
              </button>
              <button class="btn-submit" style="width:auto; padding:8px 16px; background:var(--danger);" onclick={() => decide(r.consent_id, 'rejected')} disabled={busyId === r.consent_id}>
                Reject
              </button>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  {/each}
{/if}
