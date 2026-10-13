<script lang="ts">
  // "Mark as Repaid" — ported from React components/LoanRepaidModal.jsx. Same shape as
  // the disbursement form in LoanConsentModal: a Cash and an Online amount that together
  // must equal EXACTLY what is owed (loan + interest). No partial repayment. The server
  // recomputes the amount due and re-checks everything.
  import { api } from '$lib/api';
  import Modal from '$lib/components/Modal.svelte';
  import { todayIST } from '$lib/istTime';
  import { loanTotalDue } from '$lib/loanDue';
  import { newUid } from '$lib/a11y/uid';

  interface Props {
    loan: any;
    open: boolean;
    onClose: () => void;
    onDone?: () => void;
  }
  let { loan, open, onClose, onDone }: Props = $props();
  const uid = newUid();

  let cash = $state('');
  let online = $state('');
  let date = $state(todayIST());
  let busy = $state(false);

  // Reset the form each time it opens.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) { cash = ''; online = ''; date = todayIST(); }
    wasOpen = open;
  });

  let due = $derived(loanTotalDue(loan?.Amount, loan?.['Intrest Rate'] || loan?.['Interest Rate'], loan?.Tenure));
  let total = $derived(Math.round(((parseFloat(cash) || 0) + (parseFloat(online) || 0)) * 100) / 100);
  let matches = $derived(Math.abs(total - due.total) <= 0.01);
  const today = todayIST();

  async function submit() {
    const c = parseFloat(cash) || 0;
    const o = parseFloat(online) || 0;
    if (c < 0 || o < 0) { alert('Cash and Online amounts cannot be negative.'); return; }
    if (!matches) { alert(`Cash + Online (₹${total}) must equal the full amount due ₹${due.total}. Partial repayment is not allowed.`); return; }
    if (!date) { alert('Please enter the repayment date.'); return; }
    if (!confirm(`Mark as Repaid: Cash ₹${c} + Online ₹${o} = Total ₹${total} on ${date}. Confirm?`)) return;
    busy = true;
    try {
      const res: any = await api.markLoanRepaid(loan['Loan ID'], c, o, date);
      if (res && res.messageWarning) alert(res.messageWarning);
      onDone?.();
      onClose();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      busy = false;
    }
  }
</script>

<Modal {open} {onClose} labelledBy={`${uid}-title`}>
  <h3 id={`${uid}-title`} style="margin-bottom:8px;">Mark as Repaid</h3>
  <p style="font-size:0.85rem; margin-top:0; margin-bottom:12px;">
    Loan <strong>₹{due.principal}</strong> + Interest <strong>₹{due.interest}</strong> = Total due <strong>₹{due.total}</strong>
    <br />
    <span style="color:var(--text-muted);">Cash + Online must add up to exactly this. Partial repayment is not allowed.</span>
  </p>
  <div class="form-group">
    <label for={`${uid}-date`}>Repayment Date</label>
    <input id={`${uid}-date`} type="date" class="input-field" max={today} bind:value={date} />
  </div>
  <div class="form-group">
    <label for={`${uid}-cash`}>Cash Amount (₹)</label>
    <input id={`${uid}-cash`} type="number" min="0" class="input-field" placeholder="0" bind:value={cash} />
  </div>
  <div class="form-group">
    <label for={`${uid}-online`}>Online Amount (₹)</label>
    <input id={`${uid}-online`} type="number" min="0" class="input-field" placeholder="0" bind:value={online} />
  </div>
  <p style="font-size:0.85rem; margin-top:6px; color:{matches ? 'var(--text-main)' : 'var(--danger)'};">
    Total: ₹{total}{matches ? ' ✓' : ` — must equal ₹${due.total}`}
  </p>
  <div style="display:flex; gap:8px; margin-top:10px;">
    <button class="btn-submit" style="width:auto;" onclick={submit} disabled={busy || !matches || !date}>
      {busy ? 'Saving...' : 'Confirm Repaid'}
    </button>
    <button type="button" class="btn-submit" style="width:auto; background:#e5e7eb; color:#111;" onclick={onClose}>Cancel</button>
  </div>
</Modal>
