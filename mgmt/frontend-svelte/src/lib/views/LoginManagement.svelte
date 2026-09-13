<script lang="ts">
  // Ported from React views/LoginManagement.jsx — manage portal logins (add/edit/
  // delete). Superadmin can manage all roles; others can only add a Subadmin.
  import { api } from '$lib/api';
  import { createViewData, type ViewData } from '$lib/viewData';
  import { invalidate } from '$lib/cache';
  import Modal from '$lib/components/Modal.svelte';
  import RowActions from '$lib/components/RowActions.svelte';

  interface Props {
    users: any[];
    role: string;
  }
  let { users, role }: Props = $props();

  const ROLES = ['Superadmin', 'Admin', 'Subadmin'];
  const BLANK = { userId: '', password: '', role: '', mobile: '', email: '' };

  let isSuperadmin = $derived(role === 'Superadmin');

  const view: ViewData<any[]> = createViewData('loginusers', () => api.getLoginUsers());
  let vs = $state({ data: undefined as any, loading: true, error: '' });
  $effect(() => view.subscribe((v) => (vs = v as any)));

  let showAdd = $state(false);
  let form = $state<any>(role === 'Superadmin' ? { ...BLANK } : { ...BLANK, role: 'Subadmin' });
  let saving = $state(false);
  let editing = $state<any>(null);

  function blankForm() { return isSuperadmin ? { ...BLANK } : { ...BLANK, role: 'Subadmin' }; }

  function closeModal() { showAdd = false; editing = null; form = blankForm(); }

  function openEdit(r: any) {
    if (!isSuperadmin) return;
    editing = r;
    form = { userId: r.Name, password: '', role: r.Role, mobile: r.Mobile || '', email: r.Email || '' };
    showAdd = true;
  }

  function selectUser(userId: string) {
    const u = (users || []).find((x) => x.ID === userId);
    form = { ...form, userId, mobile: form.mobile || (u && u.Mobile) || '', email: form.email || (u && u.Email) || '' };
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!form.userId || !form.role || (!editing && !form.password)) { alert('Fill all fields'); return; }
    if (!isSuperadmin && form.role !== 'Subadmin') { alert('You can only add a Subadmin login.'); return; }
    if (!/^\d{10}$/.test(form.mobile.trim())) { alert('Mobile number must be 10 digits.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { alert('Please enter a valid email.'); return; }
    saving = true;
    try {
      if (editing) {
        await api.updateLoginUser(editing.__rowIndex, form.password, form.role, form.mobile.trim(), form.email.trim());
      } else {
        await api.addLoginUser(form.userId, form.password, form.role, form.mobile.trim(), form.email.trim());
      }
      invalidate('loginusers');
      closeModal();
      view.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      saving = false;
    }
  }

  async function remove(r: any) {
    if (!isSuperadmin) return;
    if (!confirm(`Delete ${r.personName}'s login?`)) return;
    try {
      await api.deleteLoginUser(r.__rowIndex);
      invalidate('loginusers');
      view.refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  let usedIds = $derived(new Set((vs.data || []).map((r: any) => r.Name)));
</script>

{#if vs.loading}
  <div class="inline-spinner">Loading...</div>
{:else if vs.error}
  <div class="error-banner">{vs.error}</div>
{:else}
  <h2 style="margin-bottom:5px;">Login Management</h2>
  <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:15px;">
    {isSuperadmin
      ? 'This is where who can log in and what their role is gets decided. The Committee Members tab is only for public designation.'
      : 'Only existing logins are shown here (read-only). You can add a new Subadmin login — edit/delete can only be done by a Superadmin.'}
  </p>
  {#if !vs.data || vs.data.length === 0}<div class="glass-card" style="text-align:center; padding:20px;">No logins have been added yet.</div>{/if}
  {#each vs.data || [] as r, i (r.__rowIndex ?? i)}
    <div class="glass-card" style="padding:15px; margin-bottom:12px; display:flex; gap:15px; align-items:center;">
      <div style="flex-grow:1;">
        <strong>{r.personName}</strong>
        <div style="font-size:0.8rem; color:var(--text-muted);">{r.personVillage || 'N/A'}</div>
        <div style="font-size:0.75rem; color:var(--text-muted);">{r.Mobile || 'No mobile'} {r.Email ? `| ${r.Email}` : ''}</div>
        <span class="badge" style="background:#f3f4f6; color:#374151; margin-top:4px; display:inline-block;">{r.Role}</span>
      </div>
      {#if isSuperadmin}
        <RowActions role="Superadmin" disabled={false} onEdit={() => openEdit(r)} onDelete={() => remove(r)} />
      {/if}
    </div>
  {/each}

  <button class="fab" onclick={() => (showAdd = true)}><span class="material-icons-round">add</span></button>

  <Modal open={showAdd} onClose={closeModal}>
    <h3 style="margin-bottom:15px;">{editing ? 'Edit Login' : (isSuperadmin ? 'Add Login' : 'Add Subadmin Login')}</h3>
    <form onsubmit={submit}>
      <div class="form-group">
        <label>User</label>
        <select value={form.userId} disabled={!!editing} onchange={(e) => selectUser((e.currentTarget as HTMLSelectElement).value)}>
          <option value="" disabled>-- Select --</option>
          {#each users || [] as u (u.ID)}
            <option value={u.ID} disabled={!editing && usedIds.has(u.ID)}>{u.Name}</option>
          {/each}
        </select>
      </div>
      <div class="form-group">
        <label>Mobile</label>
        <input value={form.mobile} oninput={(e) => (form = { ...form, mobile: (e.currentTarget as HTMLInputElement).value.replace(/\D/g, '').slice(0, 10) })} placeholder="10 digit mobile" />
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" value={form.email} oninput={(e) => (form = { ...form, email: (e.currentTarget as HTMLInputElement).value })} placeholder="name@example.com" />
      </div>
      <div class="form-group">
        <label>Role</label>
        {#if isSuperadmin}
          <select value={form.role} onchange={(e) => (form = { ...form, role: (e.currentTarget as HTMLSelectElement).value })}>
            <option value="" disabled>-- Select --</option>
            {#each ROLES as r (r)}<option value={r}>{r}</option>{/each}
          </select>
        {:else}
          <input value="Subadmin" disabled />
        {/if}
      </div>
      <div class="form-group">
        <label>Password{editing ? ' — leave blank to keep unchanged' : ''}</label>
        <input type="password" value={form.password} oninput={(e) => (form = { ...form, password: (e.currentTarget as HTMLInputElement).value })} />
      </div>
      <button class="btn-submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
    </form>
  </Modal>
{/if}
