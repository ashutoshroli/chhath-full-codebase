<script lang="ts">
  // Ported from React views/Expenses.jsx — expenses ledger for a year with
  // add/edit/delete (EXPENSES sheet); invalidates expenses: and home: caches.
  import { api, fmt } from '$lib/api';
  import { createViewData, type ViewData } from '$lib/viewData';
  import { invalidate } from '$lib/cache';
  import { createDropdownList } from '$lib/dropdownList';
  import Modal from '$lib/components/Modal.svelte';
  import RowActions from '$lib/components/RowActions.svelte';
  import TransliterateInput from '$lib/components/TransliterateInput.svelte';
  import { canAddView } from '$lib/permissions';
  import { checkMoney } from '$lib/money';

  interface Props { year: string; role: string; editable: boolean; }
  let { year, role, editable }: Props = $props();

  const BLANK = { Discription: '', 'Discription (Hindi)': '', Amount: '', Category: 'Other' };

  let view = $state<ViewData<any[]>>(createViewData(`expenses:${year}`, () => api.getExpenses(year)));
  let lastYear = year;
  $effect(() => {
    if (year !== lastYear) {
      lastYear = year;
      view = createViewData(`expenses:${year}`, () => api.getExpenses(year));
    }
  });
  let vs = $state({ data: undefined as any, list: [] as any[], loading: true, error: '' });
  $effect(() => view.subscribe((v) => (vs = v as any)));

  const categoryList = createDropdownList('Category');
  let categoryOptions = $state<any[]>([]);
  $effect(() => categoryList.subscribe((s) => (categoryOptions = s.options)));
  const categoryHindiOf = (v: string) => categoryList.hindiOf(v);

  let showAdd = $state(false);
  let form = $state<any>({ ...BLANK });
  let saving = $state(false);
  let editing = $state<any>(null);

  function closeModal() {
    showAdd = false;
    editing = null;
    form = { ...BLANK };
  }
  function openEdit(r: any) {
    editing = r;
    form = {
      Discription: r.Discription,
      'Discription (Hindi)': r['Discription (Hindi)'] || '',
      Amount: r.Amount,
      Category: r.Category || 'Other'
    };
    showAdd = true;
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!form.Discription) { alert('Fill all fields'); return; }
    // audit P0-09: a NEGATIVE expense inflates the yearly surplus, and the surplus
    // is what the lending budget is derived from. Same rules as the backend.
    const amount = checkMoney(form.Amount, 'Amount');
    if (!amount.ok) { alert(amount.message); return; }
    saving = true;
    try {
      if (editing) {
        // `Created By` is not sent: the server owns it and rejects it (see Home.svelte).
        await api.updateRecord('EXPENSES', editing.__rowIndex, {
          Year: editing.Year,
          Discription: form.Discription,
          'Discription (Hindi)': form['Discription (Hindi)'],
          Amount: form.Amount,
          Category: form.Category
        });
      } else {
        await api.saveRecord('EXPENSES', { Year: year === 'All' ? new Date().getFullYear() : year, ...form });
      }
      invalidate('expenses:');
      invalidate('home:');
      closeModal();
      view.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      saving = false;
    }
  }

  async function remove(r: any) {
    if (!confirm('Delete this expense entry?')) return;
    try {
      await api.deleteRecord('EXPENSES', r.__rowIndex);
      invalidate('expenses:');
      invalidate('home:');
      view.refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }
</script>

{#if vs.loading}
  <div class="inline-spinner">Loading expenses...</div>
{:else if vs.error}
  <div class="error-banner">{vs.error}</div>
{:else}
  <h2 style="margin-bottom:15px;">Expenses Ledger</h2>
  <div class="glass-card">
    {#if !vs.data || vs.data.length === 0}
      <div style="text-align:center; padding:20px;">No expenses recorded.</div>
    {/if}
    {#each vs.data || [] as r, i (r.__rowIndex ?? i)}
      <div class="data-row">
        <div>
          <strong style="display:block;">{r.Discription} {#if year === 'All'}<span style="color:var(--primary-saffron); font-size:0.75rem;">[{r.Year}]</span>{/if}</strong>
          {#if r.Category}<span style="font-size:0.8rem; color:var(--text-muted);">{r.Category}{categoryHindiOf(r.Category) ? ` (${categoryHindiOf(r.Category)})` : ''}</span>{/if}
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <strong style="color:var(--danger);">-{fmt(r.Amount)}</strong>
          <RowActions {role} disabled={!editable} onEdit={() => openEdit(r)} onDelete={() => remove(r)} />
        </div>
      </div>
    {/each}
  </div>

  {#if editable && canAddView(role, 'expenses')}
    <button class="fab" onclick={() => (showAdd = true)}><span class="material-icons-round">add</span></button>
  {/if}

  <Modal open={showAdd} onClose={closeModal} labelledBy="dlg-expenses-129-title">
    <h3 id="dlg-expenses-129-title" style="margin-bottom:15px;">{editing ? 'Edit Expense' : 'Add Expense'}</h3>
    <form onsubmit={submit}>
      <TransliterateInput
        label="Description"
        value={{ en: form.Discription, hi: form['Discription (Hindi)'] }}
        onChange={({ en, hi }) => (form = { ...form, Discription: en, 'Discription (Hindi)': hi })}
      />
      <div class="form-group">
        <label>Amount</label>
        <input type="number" min="0.01" step="0.01" bind:value={form.Amount} />
      </div>
      <div class="form-group">
        <label>Category</label>
        <select bind:value={form.Category}>
          {#each categoryOptions as c (c['English Value'])}
            <option value={c['English Value']}>{c['English Value']}{c['Hindi Label'] ? ` (${c['Hindi Label']})` : ''}</option>
          {/each}
        </select>
      </div>
      <button class="btn-submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
    </form>
  </Modal>
{/if}
