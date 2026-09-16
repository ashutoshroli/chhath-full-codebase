<script lang="ts">
  // Ported from React views/Committee.jsx — list committee members for a year,
  // add/edit/delete (COMMITEE MEMBERS sheet), same cache invalidation.
  import { api } from '$lib/api';
  import { createViewData, type ViewData } from '$lib/viewData';
  import { invalidate } from '$lib/cache';
  import Modal from '$lib/components/Modal.svelte';
  import RowActions from '$lib/components/RowActions.svelte';
  import TransliterateInput from '$lib/components/TransliterateInput.svelte';
  import { canAddView } from '$lib/permissions';

  interface Props {
    year: string;
    users: any[];
    role: string;
    editable: boolean;
  }
  let { year, users, role, editable }: Props = $props();

  const VIEW_ROLE_SUGGESTIONS = ['President', 'Vice President', 'Secretary', 'Treasurer', 'Member'];
  const BLANK = { Name: '', 'View Role': '', 'View Role (Hindi)': '' };

  // Re-create the year-scoped view whenever `year` changes (matches useViewData deps).
  let view = $state<ViewData<any[]>>(createViewData(`committee:${year}`, () => api.getCommittee(year)));
  let lastYear = year;
  $effect(() => {
    if (year !== lastYear) {
      lastYear = year;
      view = createViewData(`committee:${year}`, () => api.getCommittee(year));
    }
  });
  let vs = $state({ data: undefined as any, list: [] as any[], loading: true, error: '' });
  $effect(() => {
    const unsub = view.subscribe((v) => (vs = v as any));
    return unsub;
  });

  let showAdd = $state(false);
  let form = $state<any>({ ...BLANK });
  let saving = $state(false);
  let editing = $state<any>(null);

  let userMap = $derived.by(() => {
    const m: Record<string, any> = {};
    (users || []).forEach((u) => (m[u.ID] = u));
    return m;
  });

  function closeModal() {
    showAdd = false;
    editing = null;
    form = { ...BLANK };
  }
  function openEdit(r: any) {
    editing = r;
    form = { Name: r.Name, 'View Role': r['View Role'] || '', 'View Role (Hindi)': r['View Role (Hindi)'] || '' };
    showAdd = true;
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!form.Name) { alert('Fill all fields'); return; }
    saving = true;
    try {
      if (editing) {
        // `Created By` is not sent: the server owns it and rejects it (see Home.svelte).
        // Omitting it keeps the stored value — the UPDATE only sets the keys it receives.
        await api.updateRecord('COMMITEE MEMBERS', editing.__rowIndex, {
          Year: editing.Year,
          Name: form.Name,
          'View Role': form['View Role'],
          'View Role (Hindi)': form['View Role (Hindi)']
        });
      } else {
        await api.saveRecord('COMMITEE MEMBERS', { Year: year === 'All' ? new Date().getFullYear() : year, ...form });
      }
      invalidate('committee:');
      closeModal();
      view.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      saving = false;
    }
  }

  async function remove(r: any) {
    if (!confirm(`Delete ${r.Name}'s committee membership?`)) return;
    try {
      await api.deleteRecord('COMMITEE MEMBERS', r.__rowIndex);
      invalidate('committee:');
      view.refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }
</script>

{#if vs.loading}
  <div class="inline-spinner">Loading committee...</div>
{:else if vs.error}
  <div class="error-banner">{vs.error}</div>
{:else}
  <h2 style="margin-bottom:15px;">Active Committee</h2>
  {#if !vs.data || vs.data.length === 0}
    <div class="glass-card" style="text-align:center; padding:20px;">No committee on record.</div>
  {/if}
  {#each vs.data || [] as r, i (r.__rowIndex ?? i)}
    {@const u = userMap[r.Name] || { Name: r.Name ? `${r.Name} (not in Users)` : 'Unknown', Mobile: 'N/A', Village: 'N/A' }}
    <div class="glass-card" style="padding:15px; margin-bottom:12px; display:flex; gap:15px; align-items:center;">
      <div style="width:50px; height:50px; border-radius:50%; background:var(--saffron-light); color:var(--primary-saffron); display:flex; align-items:center; justify-content:center; font-weight:bold; flex-shrink:0;">
        {(u.Name?.[0] || '?').toUpperCase()}
      </div>
      <div style="flex-grow:1;">
        <div style="display:flex; justify-content:space-between;">
          <strong>{u.Name}</strong>
          <span class="badge" style="background:#f3f4f6; color:#374151;">{r.Year}</span>
        </div>
        {#if r['View Role']}
          <div class="role-select-badge" style="display:inline-block; margin-bottom:4px;">
            {r['View Role']}{r['View Role (Hindi)'] ? ` (${r['View Role (Hindi)']})` : ''}
          </div>
        {/if}
        <div style="font-size:0.8rem; color:var(--text-muted);">{u.Mobile || 'N/A'} | {u.Village || 'N/A'}</div>
      </div>
      <RowActions {role} disabled={!editable} onEdit={() => openEdit(r)} onDelete={() => remove(r)} />
    </div>
  {/each}

  {#if editable && canAddView(role, 'committee')}
    <button class="fab" onclick={() => (showAdd = true)}><span class="material-icons-round">add</span></button>
  {/if}

  <Modal open={showAdd} onClose={closeModal} labelledBy="dlg-committee-134-title">
    <h3 id="dlg-committee-134-title" style="margin-bottom:15px;">{editing ? 'Edit Committee Member' : 'Add Committee Member'}</h3>
    <form onsubmit={submit}>
      <div class="form-group">
        <label>User</label>
        <select bind:value={form.Name}>
          <option value="" disabled>-- Select --</option>
          {#each users || [] as u (u.ID)}
            <option value={u.ID}>{u.Name}</option>
          {/each}
        </select>
      </div>
      <TransliterateInput
        label="View Role (public designation — shown to everyone)"
        placeholder="e.g. President, Secretary, Member"
        listId="view-role-suggestions"
        value={{ en: form['View Role'], hi: form['View Role (Hindi)'] }}
        onChange={({ en, hi }) => (form = { ...form, 'View Role': en, 'View Role (Hindi)': hi })}
      />
      <datalist id="view-role-suggestions">
        {#each VIEW_ROLE_SUGGESTIONS as v}<option value={v}></option>{/each}
      </datalist>
      <p style="font-size:0.75rem; color:var(--text-muted); margin-top:-8px; margin-bottom:12px;">
        Login (Role + Password) is now managed from the "Login Management" page.
      </p>
      <button class="btn-submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
    </form>
  </Modal>
{/if}
