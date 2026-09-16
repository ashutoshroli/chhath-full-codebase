<script lang="ts">
  // Ported from the TemplateList sub-component of React views/WhatsApp.jsx —
  // person/group/loan WhatsApp template CRUD. `kind` selects the api group and
  // whether contribution-type/doc-type controls are shown.
  import { api } from '$lib/api';
  import Modal from '$lib/components/Modal.svelte';
  import { isTruthyFlag } from '$lib/flags';
  import { newUid } from '$lib/a11y/uid';
  // audit PR-40: one prefix per instance, so `for`/`id` pairs cannot collide when a
  // component is mounted more than once on a screen.
  const uid = newUid();

  interface Props {
    kind: 'person' | 'group' | 'loan';
    loanType?: string;
    titleLabel?: string;
  }
  let { kind, loanType = '', titleLabel = '' }: Props = $props();

  const PLACEHOLDER_HINT = 'Placeholders: {Name} {NameHindi} {Amount} {Year} {PaymentMethod} {Village} {VillageHindi} {FatherName} {FatherNameHindi} {Detail}';
  const LOAN_PLACEHOLDER_HINTS: Record<string, string> = {
    consent_group: 'Placeholders: {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate} {Guarantor1} {Guarantor2} {Guarantor3} {LoanerConsentLink} {Guarantor1ConsentLink} {Guarantor2ConsentLink} {Guarantor3ConsentLink}',
    consent_personal_loaner: 'Placeholders: {Name} {NameHindi} {FatherName} {FatherNameHindi} {Village} {VillageHindi} {Amount} {Tenure} {InterestRate} {Guarantor1} {Guarantor2} {Guarantor3} {ConsentLink}',
    consent_personal_guarantor: 'Placeholders: {Name} {NameHindi} {FatherName} {FatherNameHindi} {Village} {VillageHindi} {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate} {ConsentLink}',
    consent_accepted_group: 'Sent to the WA group when anyone (loaner/guarantor) accepts. Placeholders: {Name} {NameHindi} {Role} {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate}',
    consent_accepted_loaner_personal: 'Sent personally to the loaner when anyone accepts. Placeholders: {Name} {NameHindi} {Role} {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate}',
    all_guarantors_accepted_loaner: 'Sent personally to the loaner once all three guarantors have accepted ("you may now accept"). Placeholders: {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate}',
    consent_verified_personal: 'Sent personally to the person once the Superadmin verifies. Placeholders: {Name} {NameHindi} {Role} {Amount} {Tenure} {InterestRate}',
    loan_passed_personal: "Sent personally to the loaner once everyone's consent is verified. Placeholders: {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate}",
    disbursement: 'Placeholders: {Name} {NameHindi} {Amount} {Tenure} {InterestRate} {CashAmount} {OnlineAmount} {TotalAmount}',
    otp: 'Placeholders: {OTP} {Name}'
  };
  const CONTRIBUTION_TYPES: [string, string][] = [['1', 'Cash (Money)'], ['2', 'Material (Item)'], ['3', 'Service (Work)']];
  const GROUP_CONTRIBUTION_TYPES: [string, string][] = [...CONTRIBUTION_TYPES, ['4', 'Resell (Item)']];
  const RESELL_PLACEHOLDER_HINT = 'Placeholders: {ItemName} {Amount} {Year}';
  const DOC_SUB_TYPES: [string, string][] = [['', 'Both (Receipt + Certificate)'], ['Receipt', 'Receipt Only'], ['Certificate', 'Certificate Only']];
  const FILE_DOC_TYPE_OPTIONS: [string, string][] = [['receipt', 'Receipt'], ['receipt_work', 'Work Receipt'], ['certificate', 'Certificate'], ['samaan', 'Material Receipt']];
  const DEFAULT_FILE_DOC_TYPE: Record<string, string> = { '1': 'receipt', '2': 'samaan', '3': 'receipt_work' };

  let hasContributionType = $derived(kind === 'person' || kind === 'group');
  let hint = $derived(kind === 'loan' ? (LOAN_PLACEHOLDER_HINTS[loanType] || PLACEHOLDER_HINT) : PLACEHOLDER_HINT);
  let contributionTypeOptions = $derived(kind === 'group' ? GROUP_CONTRIBUTION_TYPES : CONTRIBUTION_TYPES);

  function get() {
    if (kind === 'person') return api.getPersonTemplates();
    if (kind === 'group') return api.getGroupTemplates();
    return api.getLoanTemplates(loanType);
  }

  let rows = $state<any[] | null>(null);
  let loading = $state(true);
  let error = $state('');
  let showAdd = $state(false);
  let editing = $state<any>(null);
  let text = $state('');
  let messageType = $state('normal');
  let contributionType = $state('1');
  let docSubType = $state('');
  let hasFile = $state(false);
  let fileLink = $state('');
  let fileDocType = $state('');
  let saving = $state(false);

  function load() {
    loading = true;
    get().then((r: any) => (rows = r)).catch((err: Error) => (error = err.message)).finally(() => (loading = false));
  }
  // React: useEffect on [get] i.e. [kind, loanType].
  let lastKey = '__init__';
  $effect(() => {
    const key = `${kind}|${loanType}`;
    if (key === lastKey) return;
    lastKey = key;
    load();
  });

  function resetForm() {
    text = ''; messageType = 'normal'; contributionType = '1'; docSubType = '';
    hasFile = false; fileLink = ''; fileDocType = '';
  }
  function closeModal() { showAdd = false; editing = null; resetForm(); }

  function openEdit(r: any) {
    editing = r;
    text = r.text || '';
    messageType = r.message_type === 'priority' ? 'priority' : 'normal';
    const ct = String(parseInt(r.contribution_type, 10) || 1);
    contributionType = hasContributionType ? ct : '1';
    docSubType = r.doc_sub_type || '';
    const fdt = r.file_doc_type || '';
    const link = r.file_link || '';
    fileDocType = fdt;
    fileLink = link;
    hasFile = hasContributionType ? !!fdt : !!link;
    showAdd = true;
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!text.trim()) { alert('Please enter the template text'); return; }
    if (hasFile && hasContributionType && !fileDocType) { alert('Please select a Document Type, or turn off "Is this template have files?"'); return; }
    if (hasFile && !hasContributionType && !fileLink.trim()) { alert('Please enter the file link, or turn off "Is this template have files?"'); return; }
    saving = true;
    try {
      const link = (hasFile && !hasContributionType) ? fileLink.trim() : '';
      const fdt = (hasFile && hasContributionType) ? fileDocType : '';
      const dst = (hasContributionType && contributionType === '3') ? docSubType : '';
      if (editing) {
        if (hasContributionType) {
          if (kind === 'person') await api.updatePersonTemplate(editing.__rowIndex, text.trim(), undefined, messageType, contributionType, link, dst, fdt);
          else await api.updateGroupTemplate(editing.__rowIndex, text.trim(), undefined, messageType, contributionType, link, dst, fdt);
        } else {
          await api.updateLoanTemplate(editing.__rowIndex, text.trim(), undefined, messageType, link);
        }
      } else {
        if (hasContributionType) {
          if (kind === 'person') await api.addPersonTemplate(text.trim(), messageType, contributionType, link, dst, fdt);
          else await api.addGroupTemplate(text.trim(), messageType, contributionType, link, dst, fdt);
        } else {
          await api.addLoanTemplate(loanType, text.trim(), messageType, link);
        }
      }
      closeModal();
      load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      saving = false;
    }
  }

  async function toggleActive(r: any) {
    try {
      if (kind === 'person') await api.updatePersonTemplate(r.__rowIndex, undefined, !isTruthyFlag(r.active), undefined, undefined, undefined, undefined, undefined);
      else if (kind === 'group') await api.updateGroupTemplate(r.__rowIndex, undefined, !isTruthyFlag(r.active), undefined, undefined, undefined, undefined, undefined);
      else await api.updateLoanTemplate(r.__rowIndex, undefined, !isTruthyFlag(r.active), undefined, undefined);
      load();
    } catch (err) { alert((err as Error).message); }
  }
  async function cycleMessageType(r: any) {
    const next = r.message_type === 'priority' ? 'normal' : 'priority';
    try {
      if (kind === 'person') await api.updatePersonTemplate(r.__rowIndex, undefined, undefined, next, undefined, undefined, undefined, undefined);
      else if (kind === 'group') await api.updateGroupTemplate(r.__rowIndex, undefined, undefined, next, undefined, undefined, undefined, undefined);
      else await api.updateLoanTemplate(r.__rowIndex, undefined, undefined, next, undefined);
      load();
    } catch (err) { alert((err as Error).message); }
  }
  async function remove(r: any) {
    if (!confirm('Delete this template?')) return;
    try {
      if (kind === 'person') await api.deletePersonTemplate(r.__rowIndex);
      else if (kind === 'group') await api.deleteGroupTemplate(r.__rowIndex);
      else await api.deleteLoanTemplate(r.__rowIndex);
      load();
    } catch (err) { alert((err as Error).message); }
  }

  const labelOf = (opts: [string, string][], val: string) => (opts.find((t) => t[0] === val) || [])[1] || '';

  function onContributionChange(val: string) {
    contributionType = val;
    if (val !== '3') docSubType = '';
    if (hasFile) fileDocType = val === '3' ? (docSubType === 'Certificate' ? 'certificate' : 'receipt_work') : (DEFAULT_FILE_DOC_TYPE[val] || 'receipt');
  }
  function onDocSubChange(val: string) {
    docSubType = val;
    if (hasFile) fileDocType = val === 'Certificate' ? 'certificate' : 'receipt_work';
  }
  function onHasFileChange(checked: boolean) {
    hasFile = checked;
    if (checked && hasContributionType && !fileDocType) {
      fileDocType = contributionType === '3' ? (docSubType === 'Certificate' ? 'certificate' : 'receipt_work') : (DEFAULT_FILE_DOC_TYPE[contributionType] || 'receipt');
    }
  }

  let defaultTitle = $derived(titleLabel || (kind === 'person' ? 'Person' : 'Group'));
</script>

{#if loading}
  <div class="inline-spinner">Loading templates...</div>
{:else if error}
  <div role="alert" class="error-banner">{error}</div>
{:else}
  <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:12px;">{hint}</div>

  {#if !rows || rows.length === 0}<div class="glass-card" style="text-align:center; padding:20px;">No templates yet.</div>{/if}

  {#each rows || [] as r, i (r.__rowIndex ?? i)}
    {@const isActive = isTruthyFlag(r.active)}
    {@const isPriority = r.message_type === 'priority'}
    {@const ct = String(parseInt(r.contribution_type, 10) || 1)}
    <div class="glass-card" style="padding:15px; margin-bottom:10px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
        <p style="margin:0; flex-grow:1;">{r.text}</p>
        <button type="button" class="btn-bare badge {isActive ? 'badge-ok' : 'badge-warn'} toggle-switch"
          aria-pressed={isActive} onclick={() => toggleActive(r)}>
          {isActive ? 'Active' : 'Inactive'}
        </button>
      </div>
      <div style="display:flex; gap:6px; margin-top:8px; align-items:center; flex-wrap:wrap;">
        <button type="button" class="btn-bare badge {isPriority ? 'badge-warn' : 'badge-pending'}"
          aria-pressed={isPriority} onclick={() => cycleMessageType(r)} title="Tap to toggle Normal/Priority">
          {isPriority ? '⚡ Priority' : 'Normal'}
        </button>
        {#if hasContributionType}
          <span class="badge" style="background:#f3f4f6; color:#374151;">
            {labelOf(contributionTypeOptions, ct) || 'Cash (Money)'}{ct === '3' && r.doc_sub_type ? ` — ${r.doc_sub_type}` : ''}
          </span>
        {/if}
        {#if r.file_doc_type}
          <span class="badge" style="background:#DBEAFE; color:#1E40AF;" title="The recipient's own file is auto-attached">
            📎 Auto: {labelOf(FILE_DOC_TYPE_OPTIONS, r.file_doc_type) || r.file_doc_type}
          </span>
        {:else if r.file_link}
          <span class="badge" style="background:#DBEAFE; color:#1E40AF;" title={r.file_link}>📎 File attached</span>
        {/if}
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

  <Modal open={showAdd} onClose={closeModal} labelledBy="dlg-watemplatelist-230-title">
    <h3 id="dlg-watemplatelist-230-title" style="margin-bottom:15px;">{editing ? 'Edit' : 'New'} {defaultTitle} Template</h3>
    <form onsubmit={submit}>
      <div class="form-group">
        <label for={`${uid}-f1`}>Message Text</label>
        <textarea id={`${uid}-f1`} rows={5} bind:value={text} placeholder={contributionType === '4' ? RESELL_PLACEHOLDER_HINT : hint} style="width:100%; padding:10px; border-radius:8px; border:1px solid #ddd;"></textarea>
      </div>
      {#if hasContributionType && contributionType === '4'}
        <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:8px;">{RESELL_PLACEHOLDER_HINT}</div>
      {/if}
      <div class="form-group">
        <label for={`${uid}-f2`}>Message Type</label>
        <select id={`${uid}-f2`} bind:value={messageType}>
          <option value="normal">Normal</option>
          <option value="priority">Priority</option>
        </select>
      </div>
      {#if hasContributionType}
        <div class="form-group">
          <label for={`${uid}-f3`}>Contribution Type</label>
          <select id={`${uid}-f3`} value={contributionType} onchange={(e) => onContributionChange((e.currentTarget as HTMLSelectElement).value)}>
            {#each contributionTypeOptions as [val, lbl] (val)}<option value={val}>{lbl}</option>{/each}
          </select>
        </div>
      {/if}
      {#if hasContributionType && contributionType === '3'}
        <div class="form-group">
          <label for={`${uid}-f4`}>Document Type</label>
          <select id={`${uid}-f4`} value={docSubType} onchange={(e) => onDocSubChange((e.currentTarget as HTMLSelectElement).value)}>
            {#each DOC_SUB_TYPES as [val, lbl] (val)}<option value={val}>{lbl}</option>{/each}
          </select>
        </div>
      {/if}
      <label style="display:flex; align-items:center; gap:8px; margin:10px 0; cursor:pointer;">
        <input type="checkbox" checked={hasFile} onchange={(e) => onHasFileChange((e.currentTarget as HTMLInputElement).checked)} />
        Is this template have files?
      </label>
      {#if hasFile}
        {#if hasContributionType}
          <div class="form-group">
            <label for={`${uid}-f5`}>File to Attach</label>
            <select id={`${uid}-f5`} bind:value={fileDocType}>
              {#each FILE_DOC_TYPE_OPTIONS as [val, lbl] (val)}<option value={val}>{lbl}</option>{/each}
            </select>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">
              That recipient's own {labelOf(FILE_DOC_TYPE_OPTIONS, fileDocType)} will be auto-attached — no need to enter a link manually.
            </div>
          </div>
        {:else}
          <div class="form-group">
            <label for={`${uid}-f6`}>File Link (public download URL)</label>
            <input id={`${uid}-f6`} bind:value={fileLink} placeholder="https://drive.google.com/... or any public link" />
          </div>
        {/if}
      {/if}
      <button class="btn-submit" disabled={saving}>{saving ? 'Saving...' : (editing ? 'Update' : 'Save')}</button>
    </form>
  </Modal>
{/if}
