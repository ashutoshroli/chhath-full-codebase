<script lang="ts">
  // Ported from the EmailTemplateList sub-component of React views/Email.jsx —
  // collection email templates CRUD with contribution/doc-type + auto file link.
  import { api } from '$lib/api';
  import Modal from '$lib/components/Modal.svelte';
  import { isTruthyFlag } from '$lib/flags';
  import { newUid } from '$lib/a11y/uid';
  // audit PR-40: one prefix per instance, so `for`/`id` pairs cannot collide when a
  // component is mounted more than once on a screen.
  const uid = newUid();

  const CONTRIBUTION_TYPES: [string, string][] = [['1', 'Cash (Money)'], ['2', 'Material (Item)'], ['3', 'Service (Work)']];
  const DOC_SUB_TYPES: [string, string][] = [['', 'Both (Receipt + Certificate)'], ['Receipt', 'Receipt Only'], ['Certificate', 'Certificate Only']];
  const FILE_DOC_TYPE_OPTIONS: [string, string][] = [['receipt', 'Receipt'], ['receipt_work', 'Work Receipt'], ['certificate', 'Certificate'], ['samaan', 'Material Receipt']];
  const DEFAULT_FILE_DOC_TYPE: Record<string, string> = { '1': 'receipt', '2': 'samaan', '3': 'receipt_work' };

  const hint = 'Placeholders (subject + body): {Name} {NameHindi} {Amount} {Year} {PaymentMethod} {Village} {VillageHindi} {FatherName} {FatherNameHindi} {Detail}';

  let rows = $state<any[] | null>(null);
  let loading = $state(true);
  let error = $state('');
  let showAdd = $state(false);
  let editing = $state<any>(null);
  let subject = $state('');
  let text = $state('');
  let messageType = $state('normal');
  let contributionType = $state('1');
  let docSubType = $state('');
  let hasFile = $state(false);
  let fileDocType = $state('');
  let saving = $state(false);

  function load() {
    loading = true;
    api.getEmailTemplates().then((r: any) => (rows = r)).catch((err: Error) => (error = err.message)).finally(() => (loading = false));
  }
  let loaded = false;
  $effect(() => { if (loaded) return; loaded = true; load(); });

  function resetForm() {
    subject = ''; text = ''; messageType = 'normal'; contributionType = '1';
    docSubType = ''; hasFile = false; fileDocType = '';
  }
  function closeModal() { showAdd = false; editing = null; resetForm(); }

  function openEdit(r: any) {
    editing = r;
    subject = r.subject || '';
    text = r.text || '';
    messageType = r.message_type === 'priority' ? 'priority' : 'normal';
    contributionType = String(parseInt(r.contribution_type, 10) || 1);
    docSubType = r.doc_sub_type || '';
    fileDocType = r.file_doc_type || '';
    hasFile = !!r.file_doc_type;
    showAdd = true;
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!subject.trim()) { alert('Please enter the email subject'); return; }
    if (!text.trim()) { alert('Please enter the email body'); return; }
    if (hasFile && !fileDocType) { alert('Please select a Document Type, or turn off "Attach the generated document?"'); return; }
    saving = true;
    try {
      const fdt = hasFile ? fileDocType : '';
      const dst = contributionType === '3' ? docSubType : '';
      if (editing) {
        await api.updateEmailTemplate(editing.__rowIndex, subject.trim(), text.trim(), undefined, messageType, contributionType, '', dst, fdt);
      } else {
        await api.addEmailTemplate(subject.trim(), text.trim(), messageType, contributionType, '', dst, fdt);
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
    try { await api.updateEmailTemplate(r.__rowIndex, undefined, undefined, !isTruthyFlag(r.active), undefined, undefined, undefined, undefined, undefined); load(); }
    catch (err) { alert((err as Error).message); }
  }
  async function cycleMessageType(r: any) {
    const next = r.message_type === 'priority' ? 'normal' : 'priority';
    try { await api.updateEmailTemplate(r.__rowIndex, undefined, undefined, undefined, next, undefined, undefined, undefined, undefined); load(); }
    catch (err) { alert((err as Error).message); }
  }
  async function remove(r: any) {
    if (!confirm('Delete this email template?')) return;
    try { await api.deleteEmailTemplate(r.__rowIndex); load(); } catch (err) { alert((err as Error).message); }
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
    if (checked && !fileDocType) {
      fileDocType = contributionType === '3' ? (docSubType === 'Certificate' ? 'certificate' : 'receipt_work') : (DEFAULT_FILE_DOC_TYPE[contributionType] || 'receipt');
    }
  }
</script>

{#if loading}
  <div class="inline-spinner">Loading email templates...</div>
{:else if error}
  <div role="alert" class="error-banner">{error}</div>
{:else}
  <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:12px;">{hint}</div>

  {#if !rows || rows.length === 0}<div class="glass-card" style="text-align:center; padding:20px;">No email templates yet.</div>{/if}

  {#each rows || [] as r, i (r.__rowIndex ?? i)}
    {@const isActive = isTruthyFlag(r.active)}
    {@const isPriority = r.message_type === 'priority'}
    {@const ct = String(parseInt(r.contribution_type, 10) || 1)}
    {@const label = labelOf(CONTRIBUTION_TYPES, ct) || 'Cash (Money)'}
    <div class="glass-card" style="padding:15px; margin-bottom:10px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
        <div style="flex-grow:1;">
          <strong style="display:block; margin-bottom:4px;">✉️ {r.subject}</strong>
          <p style="margin:0; white-space:pre-wrap;">{r.text}</p>
        </div>
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
        <span class="badge" style="background:#f3f4f6; color:#374151;">
          {label}{ct === '3' && r.doc_sub_type ? ` — ${r.doc_sub_type}` : ''}
        </span>
        {#if r.file_doc_type}
          <span class="badge" style="background:#DBEAFE; color:#1E40AF;" title="The recipient's own file link is added to the email">
            📎 Auto: {labelOf(FILE_DOC_TYPE_OPTIONS, r.file_doc_type) || r.file_doc_type}
          </span>
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

  <Modal open={showAdd} onClose={closeModal} labelledBy="dlg-emailtemplatelist-164-title">
    <h3 id="dlg-emailtemplatelist-164-title" style="margin-bottom:15px;">{editing ? 'Edit' : 'New'} Email Template</h3>
    <form onsubmit={submit}>
      <div class="form-group">
        <label for={`${uid}-f1`}>Subject</label>
        <input id={`${uid}-f1`} bind:value={subject} placeholder="e.g. Thank you {'{Name}'} — receipt for {'{Year}'}" style="width:100%;" />
      </div>
      <div class="form-group">
        <label for={`${uid}-f2`}>Email Body</label>
        <textarea id={`${uid}-f2`} rows={6} bind:value={text} placeholder={hint} style="width:100%; padding:10px; border-radius:8px; border:1px solid #ddd;"></textarea>
      </div>
      <div class="form-group">
        <label for={`${uid}-f3`}>Message Type</label>
        <select id={`${uid}-f3`} bind:value={messageType}>
          <option value="normal">Normal</option>
          <option value="priority">Priority</option>
        </select>
      </div>
      <div class="form-group">
        <label for={`${uid}-f4`}>Contribution Type</label>
        <select id={`${uid}-f4`} value={contributionType} onchange={(e) => onContributionChange((e.currentTarget as HTMLSelectElement).value)}>
          {#each CONTRIBUTION_TYPES as [val, lbl] (val)}<option value={val}>{lbl}</option>{/each}
        </select>
      </div>
      {#if contributionType === '3'}
        <div class="form-group">
          <label for={`${uid}-f5`}>Document Type</label>
          <select id={`${uid}-f5`} value={docSubType} onchange={(e) => onDocSubChange((e.currentTarget as HTMLSelectElement).value)}>
            {#each DOC_SUB_TYPES as [val, lbl] (val)}<option value={val}>{lbl}</option>{/each}
          </select>
        </div>
      {/if}
      <label style="display:flex; align-items:center; gap:8px; margin:10px 0; cursor:pointer;">
        <input type="checkbox" checked={hasFile} onchange={(e) => onHasFileChange((e.currentTarget as HTMLInputElement).checked)} />
        Attach the generated document (as a download link)?
      </label>
      {#if hasFile}
        <div class="form-group">
          <label for={`${uid}-f6`}>Document to Attach</label>
          <select id={`${uid}-f6`} bind:value={fileDocType}>
            {#each FILE_DOC_TYPE_OPTIONS as [val, lbl] (val)}<option value={val}>{lbl}</option>{/each}
          </select>
          <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">
            The recipient's own {labelOf(FILE_DOC_TYPE_OPTIONS, fileDocType)} download link is added to the email body.
          </div>
        </div>
      {/if}
      <button class="btn-submit" disabled={saving}>{saving ? 'Saving...' : (editing ? 'Update' : 'Save')}</button>
    </form>
  </Modal>
{/if}
