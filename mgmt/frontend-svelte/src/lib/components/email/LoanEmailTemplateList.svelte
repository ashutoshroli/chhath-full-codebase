<script lang="ts">
  // Ported from the LoanEmailTemplateList sub-component of React views/Email.jsx
  // — loan email templates CRUD (per loan type) with an optional file link.
  import { api } from '$lib/api';
  import Modal from '$lib/components/Modal.svelte';
  import { isTruthyFlag } from '$lib/flags';

  interface Props {
    loanType: string;
  }
  let { loanType }: Props = $props();

  const LOAN_PLACEHOLDER_HINTS: Record<string, string> = {
    consent_group: 'Placeholders: {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate} {Guarantor1} {Guarantor2} {Guarantor3} {LoanerConsentLink} {Guarantor1ConsentLink} {Guarantor2ConsentLink} {Guarantor3ConsentLink}',
    consent_personal_loaner: 'Placeholders: {Name} {NameHindi} {FatherName} {FatherNameHindi} {Village} {VillageHindi} {Amount} {Tenure} {InterestRate} {Guarantor1} {Guarantor2} {Guarantor3} {ConsentLink}',
    consent_personal_guarantor: 'Placeholders: {Name} {NameHindi} {FatherName} {FatherNameHindi} {Village} {VillageHindi} {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate} {ConsentLink}',
    consent_accepted_group: 'Placeholders: {Name} {NameHindi} {Role} {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate}',
    consent_accepted_loaner_personal: 'Placeholders: {Name} {NameHindi} {Role} {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate}',
    all_guarantors_accepted_loaner: 'Placeholders: {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate}',
    consent_verified_personal: 'Placeholders: {Name} {NameHindi} {Role} {Amount} {Tenure} {InterestRate}',
    loan_passed_personal: 'Placeholders: {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate}',
    disbursement: 'Placeholders: {Name} {NameHindi} {Amount} {Tenure} {InterestRate} {CashAmount} {OnlineAmount} {TotalAmount}',
    otp: 'Placeholders: {OTP} {Name}'
  };
  const PLACEHOLDER_HINT = 'Placeholders: {Name} {NameHindi} {Amount} {Year} {PaymentMethod} {Village} {VillageHindi} {FatherName} {FatherNameHindi} {Detail}';

  let hint = $derived(LOAN_PLACEHOLDER_HINTS[loanType] || PLACEHOLDER_HINT);

  let rows = $state<any[] | null>(null);
  let loading = $state(true);
  let error = $state('');
  let showAdd = $state(false);
  let editing = $state<any>(null);
  let subject = $state('');
  let text = $state('');
  let messageType = $state('normal');
  let hasFile = $state(false);
  let fileLink = $state('');
  let saving = $state(false);

  function load() {
    loading = true;
    api.getLoanEmailTemplates(loanType).then((r: any) => (rows = r)).catch((err: Error) => (error = err.message)).finally(() => (loading = false));
  }
  // React: useEffect on [loanType] (via load's useCallback dep).
  let lastType = '__init__';
  $effect(() => {
    if (loanType === lastType) return;
    lastType = loanType;
    load();
  });

  function resetForm() { subject = ''; text = ''; messageType = 'normal'; hasFile = false; fileLink = ''; }
  function closeModal() { showAdd = false; editing = null; resetForm(); }
  function openEdit(r: any) {
    editing = r;
    subject = r.subject || '';
    text = r.text || '';
    messageType = r.message_type === 'priority' ? 'priority' : 'normal';
    fileLink = r.file_link || '';
    hasFile = !!r.file_link;
    showAdd = true;
  }
  async function submit(e: Event) {
    e.preventDefault();
    if (!subject.trim()) { alert('Please enter the email subject'); return; }
    if (!text.trim()) { alert('Please enter the email body'); return; }
    if (hasFile && !fileLink.trim()) { alert('Please enter the file link, or turn off "Attach a file link?"'); return; }
    saving = true;
    try {
      const link = hasFile ? fileLink.trim() : '';
      if (editing) await api.updateLoanEmailTemplate(editing.__rowIndex, subject.trim(), text.trim(), undefined, messageType, link);
      else await api.addLoanEmailTemplate(loanType, subject.trim(), text.trim(), messageType, link);
      closeModal();
      load();
    } catch (err) { alert((err as Error).message); } finally { saving = false; }
  }
  async function toggleActive(r: any) {
    try { await api.updateLoanEmailTemplate(r.__rowIndex, undefined, undefined, !isTruthyFlag(r.active), undefined, undefined); load(); }
    catch (err) { alert((err as Error).message); }
  }
  async function cycleMessageType(r: any) {
    const next = r.message_type === 'priority' ? 'normal' : 'priority';
    try { await api.updateLoanEmailTemplate(r.__rowIndex, undefined, undefined, undefined, next, undefined); load(); }
    catch (err) { alert((err as Error).message); }
  }
  async function remove(r: any) {
    if (!confirm('Delete this loan email template?')) return;
    try { await api.deleteLoanEmailTemplate(r.__rowIndex); load(); } catch (err) { alert((err as Error).message); }
  }
</script>

{#if loading}
  <div class="inline-spinner">Loading loan email templates...</div>
{:else if error}
  <div class="error-banner">{error}</div>
{:else}
  <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:12px;">{hint}</div>
  {#if !rows || rows.length === 0}<div class="glass-card" style="text-align:center; padding:20px;">No loan email templates yet for this type.</div>{/if}
  {#each rows || [] as r, i (r.__rowIndex ?? i)}
    {@const isActive = isTruthyFlag(r.active)}
    {@const isPriority = r.message_type === 'priority'}
    <div class="glass-card" style="padding:15px; margin-bottom:10px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
        <div style="flex-grow:1;">
          <strong style="display:block; margin-bottom:4px;">✉️ {r.subject}</strong>
          <p style="margin:0; white-space:pre-wrap;">{r.text}</p>
        </div>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="badge {isActive ? 'badge-ok' : 'badge-warn'} toggle-switch" onclick={() => toggleActive(r)}>
          {isActive ? 'Active' : 'Inactive'}
        </span>
      </div>
      <div style="display:flex; gap:6px; margin-top:8px; align-items:center; flex-wrap:wrap;">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="badge {isPriority ? 'badge-warn' : 'badge-pending'}" style="cursor:pointer;" onclick={() => cycleMessageType(r)} title="Tap to toggle Normal/Priority">
          {isPriority ? '⚡ Priority' : 'Normal'}
        </span>
        {#if r.file_link}<span class="badge" style="background:#DBEAFE; color:#1E40AF;" title={r.file_link}>📎 File link</span>{/if}
      </div>
      <div class="row-actions" style="margin-top:10px; display:flex; gap:8px;">
        <button type="button" class="icon-btn" title="Edit" onclick={() => openEdit(r)}>
          <span class="material-icons-round" style="font-size:16px;">edit</span>
        </button>
        <button type="button" class="icon-btn icon-danger" title="Delete" onclick={() => remove(r)}>
          <span class="material-icons-round" style="font-size:16px;">delete</span>
        </button>
      </div>
    </div>
  {/each}
  <button class="fab" onclick={() => { editing = null; resetForm(); showAdd = true; }}><span class="material-icons-round">add</span></button>
  <Modal open={showAdd} onClose={closeModal} labelledBy="dlg-loanemailtemplatelist-134-title">
    <h3 id="dlg-loanemailtemplatelist-134-title" style="margin-bottom:15px;">{editing ? 'Edit' : 'New'} Loan Email Template</h3>
    <form onsubmit={submit}>
      <div class="form-group">
        <label>Subject</label>
        <input bind:value={subject} placeholder="e.g. Loan consent for {'{LoanerName}'}" style="width:100%;" />
      </div>
      <div class="form-group">
        <label>Email Body</label>
        <textarea rows={6} bind:value={text} placeholder={hint} style="width:100%; padding:10px; border-radius:8px; border:1px solid #ddd;"></textarea>
      </div>
      <div class="form-group">
        <label>Message Type</label>
        <select bind:value={messageType}>
          <option value="normal">Normal</option>
          <option value="priority">Priority</option>
        </select>
      </div>
      <label style="display:flex; align-items:center; gap:8px; margin:10px 0; cursor:pointer;">
        <input type="checkbox" bind:checked={hasFile} />
        Attach a file link?
      </label>
      {#if hasFile}
        <div class="form-group">
          <label>File Link (public URL)</label>
          <input bind:value={fileLink} placeholder="https://... any public link" />
        </div>
      {/if}
      <button class="btn-submit" disabled={saving}>{saving ? 'Saving...' : (editing ? 'Update' : 'Save')}</button>
    </form>
  </Modal>
{/if}
