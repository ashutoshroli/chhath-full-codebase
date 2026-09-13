<script lang="ts">
  // Ported from React LoanConsentModal.jsx — shows per-loan consent records,
  // resend/replace-guarantor (superadmin), and cash/online disbursement (admin+).
  import { api } from '$lib/api';
  import { invalidate } from '$lib/cache';
  import Modal from './Modal.svelte';
  import SearchableSelect from './SearchableSelect.svelte';
  import { isSuperadmin, isAdminOrAbove } from '$lib/permissions';

  interface Props {
    loan: any;
    open: boolean;
    onClose: () => void;
    role: string;
    contributorOptions: any[];
    onChanged?: (() => void) | null;
  }
  let { loan, open, onClose, role, contributorOptions, onChanged = null }: Props = $props();

  const STATUS_LABEL: Record<string, string> = { pending: 'Pending', accepted: 'Accepted', declined: 'Declined', replaced: 'Replaced' };
  const STATUS_BADGE: Record<string, string> = { pending: 'badge-warn', accepted: 'badge-ok', declined: 'badge-danger', replaced: 'badge-warn' };

  let consents = $state<any[] | null>(null);
  let loading = $state(true);
  let error = $state('');
  let busyId = $state<string | null>(null);
  let replacingId = $state<string | null>(null);
  let newGuarantor = $state('');
  let showDisburseForm = $state(false);
  let cashAmount = $state('');
  let onlineAmount = $state('');

  let loanId = $derived(loan && loan['Loan ID']);

  function load() {
    if (!loanId) return;
    loading = true;
    api.getLoanConsents(loanId)
      .then((c: any) => (consents = c))
      .catch((err: Error) => (error = err.message))
      .finally(() => (loading = false));
  }

  // React: useEffect on [open, loanId] -> load when open
  let lastKey = '';
  $effect(() => {
    const key = `${open}|${loanId}`;
    if (key === lastKey) return;
    lastKey = key;
    if (open) load();
  });

  async function resend(consentId: string) {
    busyId = consentId;
    error = '';
    try {
      await api.resendConsent(consentId);
      load();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busyId = null;
    }
  }

  function startReplace(consentId: string) { replacingId = consentId; newGuarantor = ''; }

  async function confirmReplace(consentId: string) {
    if (!newGuarantor) { alert('Please select a new guarantor'); return; }
    busyId = consentId;
    error = '';
    try {
      await api.replaceGuarantor(loanId, consentId, newGuarantor);
      replacingId = null;
      load();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busyId = null;
    }
  }

  async function disburse() {
    const cash = parseFloat(cashAmount) || 0;
    const online = parseFloat(onlineAmount) || 0;
    const amt = parseFloat(loan && (loan.Amount ?? loan['Amount'])) || 0;
    if (cash <= 0 && online <= 0) { alert('Please enter at least one amount — Cash or Online.'); return; }
    if (Math.abs((cash + online) - amt) > 0.01) { alert(`Total (₹${cash + online}) must equal the loan amount ₹${amt}. Adjust the Cash / Online split.`); return; }
    if (!confirm(`Disburse: Cash ₹${cash} + Online ₹${online} = Total ₹${cash + online}. Confirm?`)) return;
    busyId = 'disburse';
    error = '';
    try {
      await api.markLoanDisbursed(loanId, cash, online);
      invalidate('loans:');
      onChanged && onChanged();
      onClose();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busyId = null;
    }
  }

  let visibleConsents = $derived((consents || []).filter((c) => c.status !== 'replaced'));
  let canDisburse = $derived(isAdminOrAbove(role) && loan && loan['Loan Status'] === 'Approved');
  let loanAmount = $derived(parseFloat(loan && (loan.Amount ?? loan['Amount'])) || 0);
  let disburseTotal = $derived((parseFloat(cashAmount) || 0) + (parseFloat(onlineAmount) || 0));
  let disburseMatches = $derived(Math.abs(disburseTotal - loanAmount) <= 0.01);
</script>

{#if !loanId}
  <Modal {open} {onClose}>
    <p style="padding:20px;">This is an older loan (predates the Consent system) — no consent record is available.</p>
  </Modal>
{:else}
  <Modal {open} {onClose}>
    <h3 style="margin-bottom:5px;">Loan Status</h3>
    <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:15px;">
      Loan ID: {loanId} — <strong>{loan['Loan Status'] || 'Created'}</strong>
    </p>

    {#if error}<div class="error-banner" style="margin-bottom:10px;">{error}</div>{/if}
    {#if loading}<div class="inline-spinner">Loading...</div>{/if}

    {#if !loading}
      {#each visibleConsents as c (c.consent_id)}
        <div class="glass-card" style="padding:12px; margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong>{c.personName}</strong>{c.personNameHindi ? ` (${c.personNameHindi})` : ''}
              <div style="font-size:0.75rem; color:var(--text-muted);">{c.role === 'loaner' ? 'Loan Receiver' : 'Guarantor'} — Sent {c.send_count}/5</div>
            </div>
            <span class="badge {STATUS_BADGE[c.status] || 'badge-warn'}">{STATUS_LABEL[c.status] || c.status}</span>
          </div>

          {#if isSuperadmin(role) && c.status !== 'accepted'}
            <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
              <button
                type="button"
                class="btn-submit"
                style="width:auto; padding:6px 12px; font-size:0.8rem;"
                onclick={() => resend(c.consent_id)}
                disabled={busyId === c.consent_id || parseInt(c.send_count) >= 5}
              >
                {parseInt(c.send_count) >= 5 ? 'Max reached' : 'Resend'}
              </button>
              {#if c.role === 'guarantor'}
                <button
                  type="button"
                  class="btn-submit"
                  style="width:auto; padding:6px 12px; font-size:0.8rem; background:#e5e7eb; color:#111;"
                  onclick={() => startReplace(c.consent_id)}
                >
                  Change Guarantor
                </button>
              {/if}
            </div>
          {/if}

          {#if replacingId === c.consent_id}
            <div style="margin-top:10px; background:#f9fafb; padding:10px; border-radius:8px;">
              <label style="font-size:0.8rem; display:block; margin-bottom:6px;">New Guarantor</label>
              <SearchableSelect options={contributorOptions || []} value={newGuarantor} onChange={(v) => (newGuarantor = v)} />
              <div style="display:flex; gap:8px; margin-top:8px;">
                <button type="button" class="btn-submit" style="width:auto; padding:6px 12px; font-size:0.8rem;" onclick={() => confirmReplace(c.consent_id)} disabled={busyId === c.consent_id}>Confirm</button>
                <button type="button" class="btn-submit" style="width:auto; padding:6px 12px; font-size:0.8rem; background:#e5e7eb; color:#111;" onclick={() => (replacingId = null)}>Cancel</button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    {/if}

    {#if canDisburse && !showDisburseForm}
      <button class="btn-submit" style="margin-top:10px;" onclick={() => (showDisburseForm = true)}>
        Mark as Disbursed
      </button>
    {/if}

    {#if canDisburse && showDisburseForm}
      <div class="glass-card" style="padding:12px; margin-top:10px;">
        <p style="font-size:0.85rem; margin-top:0; margin-bottom:8px;">
          Sanctioned loan amount: <strong>₹{loanAmount}</strong> — Cash + Online must add up to exactly this.
        </p>
        <label style="font-size:0.8rem;">Cash Amount (₹)</label>
        <input type="number" min="0" class="input-field" bind:value={cashAmount} placeholder="0" />
        <label style="font-size:0.8rem; margin-top:8px; display:block;">Online Amount (₹)</label>
        <input type="number" min="0" class="input-field" bind:value={onlineAmount} placeholder="0" />
        <p style="font-size:0.8rem; margin-top:6px; color:{disburseMatches ? 'var(--text-main)' : 'var(--danger)'};">
          Total: ₹{disburseTotal}{disburseMatches ? ' ✓' : ` — must equal ₹${loanAmount}`}
        </p>
        <div style="display:flex; gap:8px; margin-top:10px;">
          <button class="btn-submit" style="width:auto;" onclick={disburse} disabled={busyId === 'disburse' || !disburseMatches}>
            {busyId === 'disburse' ? 'Marking...' : 'Confirm Disburse'}
          </button>
          <button type="button" class="btn-submit" style="width:auto; background:#e5e7eb; color:#111;" onclick={() => (showDisburseForm = false)}>Cancel</button>
        </div>
      </div>
    {/if}
  </Modal>
{/if}
