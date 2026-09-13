<script lang="ts">
  // Ported from React views/Loans.jsx — surplus loan distribution for a year:
  // list loans + guarantors, issue new loan (receiver + 3 guarantors from that
  // year's contributors, budget check), edit terms, delete, consent modal.
  import { api, fmt } from '$lib/api';
  import { createViewData, type ViewData } from '$lib/viewData';
  import { invalidate } from '$lib/cache';
  import Modal from '$lib/components/Modal.svelte';
  import SearchableSelect from '$lib/components/SearchableSelect.svelte';
  import RowActions from '$lib/components/RowActions.svelte';
  import { canAddView } from '$lib/permissions';
  import { createDropdownList } from '$lib/dropdownList';
  import LoanConsentModal from '$lib/components/LoanConsentModal.svelte';

  interface Props {
    year: string;
    users: any[];
    committee: any[];
    role: string;
    editable: boolean;
  }
  let { year, users, committee, role, editable }: Props = $props();

  const BLANK = { receiver: '', g1: '', g2: '', g3: '', Amount: '', Rate: '', Tenure: '', FinalRepaymentDate: '', Status: 'Active' };

  // Year-scoped loans view (matches useViewData deps [year]).
  let view = $state<ViewData<any>>(createViewData(`loans:${year}`, () => api.getLoans(year)));
  let lastYear = year;
  $effect(() => {
    if (year !== lastYear) {
      lastYear = year;
      view = createViewData(`loans:${year}`, () => api.getLoans(year));
    }
  });
  let vs = $state({ data: undefined as any, loading: true, error: '' });
  $effect(() => view.subscribe((v) => (vs = v as any)));

  // Loan Status dropdown list.
  const statusList = createDropdownList('Loan Status');
  let statusOptions = $state<any[]>([]);
  $effect(() => statusList.subscribe((s) => (statusOptions = s.options)));
  const statusHindiOf = (v: string) => statusList.hindiOf(v);

  let showAdd = $state(false);
  let form = $state<any>({ ...BLANK });
  let saving = $state(false);
  let contributorIds = $state<Set<string> | null>(null);
  let contribLoading = $state(false);
  let editing = $state<any>(null);
  let statusLoan = $state<any>(null);
  let available = $state<number | null>(null);

  // Budget available when opening the add form (not editing) — matches deps [showAdd, editing, year].
  let budgetKey = '';
  $effect(() => {
    const key = `${showAdd}|${!!editing}|${year}`;
    if (key === budgetKey) return;
    budgetKey = key;
    if (!showAdd || editing) { available = null; return; }
    const loanYear = String(year === 'All' ? new Date().getFullYear() : year);
    api.getLoanBudget(loanYear)
      .then((r: any) => (available = r && typeof r.available === 'number' ? r.available : null))
      .catch(() => (available = null));
  });

  let userMap = $derived.by(() => {
    const m: Record<string, any> = {};
    (users || []).forEach((u) => (m[u.ID] = u));
    return m;
  });

  let committeeIds = $derived(new Set((committee || []).map((c) => c.Name)));

  // Contributor id set for the year (matches deps [year]).
  let contribYear = '';
  $effect(() => {
    if (year === contribYear) return;
    contribYear = year;
    contribLoading = true;
    api.getYearContributors(year)
      .then((ids: string[]) => (contributorIds = new Set(ids)))
      .finally(() => (contribLoading = false));
  });

  let contributorOptions = $derived.by(() => {
    if (!contributorIds) return [];
    return (users || [])
      .filter((u) => contributorIds!.has(u.ID))
      .map((u) => ({ value: u.ID, label: u.Name, sub: u.Village }));
  });

  function closeModal() {
    showAdd = false;
    editing = null;
    form = { ...BLANK };
  }

  function openEdit(loan: any) {
    editing = loan;
    form = {
      receiver: loan.Name, g1: '', g2: '', g3: '',
      Amount: loan.Amount, Rate: loan['Intrest Rate'] || loan['Interest Rate'] || '',
      Tenure: loan.Tenure || '', FinalRepaymentDate: loan['Final Repayment Date'] || '',
      Status: loan.Status || 'Active'
    };
    showAdd = true;
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (editing) {
      if (!form.Amount) { alert('Amount is required'); return; }
      saving = true;
      try {
        await api.updateRecord('LOANS', editing.__rowIndex, {
          Year: editing.Year, Name: editing.Name, Amount: form.Amount,
          'Intrest Rate': form.Rate, Tenure: form.Tenure,
          'Final Repayment Date': form.FinalRepaymentDate, Status: form.Status,
          'Created By': editing['Created By']
        });
        invalidate('loans:');
        closeModal();
        view.refresh();
      } catch (err) {
        alert((err as Error).message);
      } finally {
        saving = false;
      }
      return;
    }

    const { receiver, g1, g2, g3, Amount, FinalRepaymentDate } = form;
    if (!receiver || !g1 || !g2 || !g3) { alert('Select Receiver and all 3 Guarantors'); return; }
    if (new Set([receiver, g1, g2, g3]).size !== 4) { alert('Receiver and Guarantors must all be different'); return; }
    if ([g1, g2, g3].some((g) => committeeIds.has(g))) { alert('Rule Violation: A Committee Member cannot be a Guarantor'); return; }
    if (!Amount) { alert('Amount is required'); return; }
    if (!FinalRepaymentDate) { alert('Final Repayment Date is required'); return; }
    if (available !== null && (parseFloat(Amount) || 0) > available + 0.01) {
      alert(`This loan (₹${parseFloat(Amount) || 0}) exceeds what is still available to lend this year: ₹${Math.max(0, Math.round(available * 100) / 100)}.`);
      return;
    }
    saving = true;
    try {
      const loanYear = year === 'All' ? new Date().getFullYear() : year;
      await api.saveLoan(
        { Year: loanYear, Name: receiver, Amount, 'Intrest Rate': form.Rate, Tenure: form.Tenure, 'Final Repayment Date': FinalRepaymentDate, Status: 'Active' },
        [g1, g2, g3].map((g) => ({ Year: loanYear, Loaner: receiver, Guarantor: g }))
      );
      invalidate('loans:');
      closeModal();
      view.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      saving = false;
    }
  }

  async function removeLoan(loan: any) {
    if (!confirm('Delete this loan and all its guarantors? This action cannot be undone.')) return;
    try {
      await api.deleteLoan(loan.__rowIndex, loan.Year, loan.Name, loan['Loan ID']);
      invalidate('loans:');
      view.refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  let loans = $derived(vs.data?.loans || []);
  let guarantors = $derived(vs.data?.guarantors || []);

  function guarsFor(loan: any) {
    return loan['Loan ID']
      ? guarantors.filter((g: any) => (g['Loan ID'] || '').toString().trim() === loan['Loan ID'].toString().trim())
      : guarantors.filter((g: any) => parseInt(g.Year) === parseInt(loan.Year) && g.Loaner === loan.Name);
  }
</script>

{#if vs.loading}
  <div class="inline-spinner">Loading loans...</div>
{:else if vs.error}
  <div class="error-banner">{vs.error}</div>
{:else}
  <h2 style="margin-bottom:15px;">Surplus Loan Distribution</h2>

  {#if loans.length === 0}
    <div class="glass-card" style="text-align:center; padding:20px;">Not Distributed Yet</div>
  {/if}

  {#each loans as loan, idx ((loan['Loan ID'] || '').toString().trim() || loan.__rowIndex || idx)}
    {@const uReceiver = userMap[loan.Name] || { Name: loan.Name ? `${loan.Name} (not in Users)` : 'Unknown' }}
    {@const guars = guarsFor(loan)}
    <div class="glass-card" style="background:#FFFBEB; border-color:#FCD34D;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
        <h3 style="color:#92400E;">Surplus Loan {year === 'All' ? `(${loan.Year})` : ''}</h3>
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <span class="badge {loan.Status === 'Repaid' ? 'badge-ok' : 'badge-warn'}">{loan.Status || 'Active'}{statusHindiOf(loan.Status || 'Active') ? ` (${statusHindiOf(loan.Status || 'Active')})` : ''}</span>
          {#if loan['Loan ID']}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
              class="badge {loan['Loan Status'] === 'Disbursed' ? 'badge-ok' : loan['Loan Status'] === 'Approved' ? 'badge-pending' : 'badge-warn'}"
              style="cursor:pointer;"
              onclick={() => (statusLoan = loan)}
            >
              {loan['Loan Status'] || 'Created'} 🔗
            </span>
          {/if}
          <RowActions {role} disabled={!editable} onEdit={() => openEdit(loan)} onDelete={() => removeLoan(loan)} />
        </div>
      </div>
      <div style="background:white; padding:15px; border-radius:8px; border:1px solid #FDE68A; margin-bottom:15px;">
        <div style="font-size:0.8rem; color:var(--text-muted);">Receiver</div>
        <div style="font-size:1.3rem; font-weight:bold; margin-bottom:10px;">{uReceiver.Name}</div>
        <div class="grid-3">
          <div><span style="font-size:0.75rem;">Amount</span><br /><strong>{fmt(loan.Amount)}</strong></div>
          <div><span style="font-size:0.75rem;">Int. Rate</span><br /><strong>{loan['Intrest Rate'] || loan['Interest Rate'] || '0'}%</strong></div>
          <div><span style="font-size:0.75rem;">Tenure</span><br /><strong>{loan.Tenure || '0'} Mo</strong></div>
        </div>
      </div>
      <h4 style="margin-bottom:10px; color:#92400E;">Guarantors</h4>
      {#if guars.length === 0}<p>No guarantors on record.</p>{/if}
      {#each guars as g, gi (gi)}
        {@const uG = userMap[g.Guarantor] || { Name: g.Guarantor ? `${g.Guarantor} (not in Users)` : 'Unknown' }}
        <div class="glass-card" style="padding:15px; margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between;">
            <strong>{uG.Name}</strong>
            <span class="badge badge-ok">Village: {uG.Village || '-'}</span>
          </div>
        </div>
      {/each}
    </div>
  {/each}

  {#if editable && canAddView(role, 'loans')}
    <button class="fab" onclick={() => (showAdd = true)}><span class="material-icons-round">add</span></button>
  {/if}

  <Modal open={showAdd} onClose={closeModal}>
    <h3 style="margin-bottom:5px;">{editing ? 'Edit Loan Terms' : 'Issue Loan'}</h3>
    {#if !editing}
      <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:15px;">
        Receiver and Guarantors can only be selected from {year === 'All' ? new Date().getFullYear() : year}'s contributors.
      </p>
    {/if}
    {#if editing}
      <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:15px;">
        Receiver: <strong>{userMap[editing.Name]?.Name || editing.Name}</strong> (the receiver/guarantors cannot be changed here — only the terms can be edited)
      </p>
    {/if}
    {#if contribLoading && !editing}<div class="inline-spinner">Loading contributors...</div>{/if}
    {#if editing || !contribLoading}
      <form onsubmit={submit}>
        {#if !editing}
          <div class="form-group">
            <label>Receiver</label>
            <SearchableSelect options={contributorOptions} value={form.receiver} onChange={(v) => (form = { ...form, receiver: v })} />
          </div>
        {/if}
        <div class="form-group">
          <label>Amount</label>
          <input type="number" value={form.Amount} oninput={(e) => (form = { ...form, Amount: (e.currentTarget as HTMLInputElement).value })} />
          {#if !editing && available !== null}
            <div style="font-size:0.78rem; margin-top:4px; color:{((parseFloat(form.Amount) || 0) > available + 0.01) ? 'var(--danger)' : 'var(--text-muted)'};">
              Available to lend this year: ₹{Math.max(0, Math.round(available * 100) / 100)}{(parseFloat(form.Amount) || 0) > available + 0.01 ? ' — this loan exceeds it' : ''}
            </div>
          {/if}
        </div>
        <div class="form-group">
          <label>Interest Rate (%)</label>
          <input type="number" step="0.1" value={form.Rate} oninput={(e) => (form = { ...form, Rate: (e.currentTarget as HTMLInputElement).value })} />
        </div>
        <div class="form-group">
          <label>Tenure (Months)</label>
          <input type="number" value={form.Tenure} oninput={(e) => (form = { ...form, Tenure: (e.currentTarget as HTMLInputElement).value })} />
        </div>
        <div class="form-group">
          <label>Final Repayment Date</label>
          <input type="date" value={form.FinalRepaymentDate} oninput={(e) => (form = { ...form, FinalRepaymentDate: (e.currentTarget as HTMLInputElement).value })} />
        </div>
        {#if editing}
          <div class="form-group">
            <label>Status</label>
            <select bind:value={form.Status}>
              {#each statusOptions as s (s['English Value'])}
                <option value={s['English Value']}>
                  {s['English Value']}{s['Hindi Label'] ? ` (${s['Hindi Label']})` : ''}
                </option>
              {/each}
            </select>
          </div>
        {/if}
        {#if !editing}
          {#each [['g1', 1], ['g2', 2], ['g3', 3]] as [key, i] (key)}
            <div class="form-group">
              <label>Guarantor {i}</label>
              <SearchableSelect options={contributorOptions} value={form[key as string]} onChange={(v) => (form = { ...form, [key as string]: v })} />
            </div>
          {/each}
        {/if}
        <button class="btn-submit" disabled={saving}>{saving ? 'Saving...' : (editing ? 'Save Changes' : 'Issue Loan')}</button>
      </form>
    {/if}
  </Modal>

  <LoanConsentModal
    loan={statusLoan || {}}
    open={!!statusLoan}
    onClose={() => (statusLoan = null)}
    {role}
    {contributorOptions}
    onChanged={() => view.refresh()}
  />
{/if}
