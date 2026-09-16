<script lang="ts">
  // Ported from React views/Users.jsx — registered-users list with search,
  // add/edit/delete (USERS sheet), row click opens the profile modal.
  import { api } from '$lib/api';
  import { invalidate } from '$lib/cache';
  import Modal from '$lib/components/Modal.svelte';
  import RowActions from '$lib/components/RowActions.svelte';
  import VillageInput from '$lib/components/VillageInput.svelte';
  import TransliterateInput from '$lib/components/TransliterateInput.svelte';
  import UserProfileModal from '$lib/components/UserProfileModal.svelte';
  import { canAddView } from '$lib/permissions';

  interface Props {
    users: any[];
    loading: boolean;
    error: string;
    onRefresh: () => void;
    role: string;
  }
  let { users, loading, error, onRefresh, role }: Props = $props();

  const BLANK = {
    Name: '', 'Name (Hindi)': '',
    Village: '', 'Village (Hindi)': '',
    "Father's Name": '', "Father's Name (Hindi)": '',
    Mobile: '', Designation: '', 'Designation (Hindi)': '',
    Email: '', WhatsApp: '',
    Photo: '',
  };

  // Reads a File as a base64 data URL (the backend strips the data: prefix).
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Could not read the selected file.'));
      reader.readAsDataURL(file);
    });
  }

  let search = $state('');
  let showAdd = $state(false);
  let form = $state<any>({ ...BLANK });
  let saving = $state(false);
  let editing = $state<any>(null);
  let viewingUserId = $state<string | null>(null);
  let uploadingPhoto = $state(false);

  let filtered = $derived(
    (users || []).filter((u) =>
      u.Name.toLowerCase().includes(search.toLowerCase()) ||
      (u.ID || '').toLowerCase().includes(search.toLowerCase())
    )
  );

  function closeModal() {
    showAdd = false;
    editing = null;
    form = { ...BLANK };
  }

  function openEdit(u: any) {
    editing = u;
    form = {
      Name: u.Name, 'Name (Hindi)': u['Name (Hindi)'] || '',
      Village: u.Village || '', 'Village (Hindi)': u['Village (Hindi)'] || '',
      "Father's Name": u["Father's Name"] || '', "Father's Name (Hindi)": u["Father's Name (Hindi)"] || '',
      Mobile: u.Mobile || '', Designation: u.Designation || '', 'Designation (Hindi)': u['Designation (Hindi)'] || '',
      Email: u.Email || '', WhatsApp: u.WhatsApp || '',
      Photo: u.Photo || '',
    };
    showAdd = true;
  }

  async function onPickPhoto(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files && input.files[0];
    input.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Please choose an image file.'); return; }
    uploadingPhoto = true;
    try {
      const dataUrl = await fileToBase64(file);
      const res: any = await api.uploadUserPhoto(dataUrl, file.name, editing ? editing.ID : '');
      form = { ...form, Photo: res.url || res.photo || '' };
    } catch (err) {
      alert((err as Error).message);
    } finally {
      uploadingPhoto = false;
    }
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!form.Name) { alert('Name is required'); return; }
    if (form.Mobile && form.Mobile.length !== 10) { alert('Mobile number must be 10 digits'); return; }
    if (form.WhatsApp && form.WhatsApp.length !== 10) { alert('WhatsApp number must be 10 digits'); return; }
    saving = true;
    try {
      if (editing) {
        // `ID` is not sent: it is the member id the server allocates, and sending it back
        // would be a request to REWRITE it — which is why the server rejects it. The row
        // to edit is identified by `__rowIndex`, so the id is not needed here.
        await api.updateRecord('USERS', editing.__rowIndex, { ...form });
      } else {
        await api.saveRecord('USERS', form);
      }
      invalidate('users');
      closeModal();
      onRefresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      saving = false;
    }
  }

  async function remove(u: any) {
    if (!confirm(`Delete ${u.Name}? This action cannot be undone.`)) return;
    try {
      await api.deleteRecord('USERS', u.__rowIndex);
      invalidate('users');
      onRefresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }
</script>

{#if loading}
  <div class="inline-spinner">Loading users...</div>
{:else if error}
  <div class="error-banner">{error}</div>
{:else}
  <h2 style="margin-bottom:15px;">Registered Users</h2>
  <input placeholder="Search by name or ID..." style="margin-bottom:15px;" bind:value={search} />
  <div class="glass-card">
    {#if filtered.length === 0}
      <div style="text-align:center; padding:20px;">No users found.</div>
    {/if}
    {#each filtered as u (u.ID)}
      <div class="data-row">
        <button type="button" class="btn-bare" onclick={() => (viewingUserId = u.ID)}
          style="display:block; text-align:left;" aria-label="Open the profile of {u.Name}">
          <strong style="display:block;">{u.Name}{u['Name (Hindi)'] ? ` (${u['Name (Hindi)']})` : ''}</strong>
          <span style="font-size:0.8rem; color:var(--text-muted);">{u.Village || '-'} | {u.Mobile || 'N/A'}</span>
        </button>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="badge" style="background:#f3f4f6; color:#374151;">{u.Designation || 'Member'}</span>
          <RowActions {role} onEdit={() => openEdit(u)} onDelete={() => remove(u)} />
        </div>
      </div>
    {/each}
  </div>

  {#if canAddView(role, 'users')}
    <button class="fab" onclick={() => (showAdd = true)}><span class="material-icons-round">add</span></button>
  {/if}

  <Modal open={showAdd} onClose={closeModal} labelledBy="dlg-users-161-title">
    <h3 id="dlg-users-161-title" style="margin-bottom:15px;">{editing ? 'Edit User' : 'Add User'}</h3>
    <form onsubmit={submit}>
      <div class="form-group" style="display:flex; align-items:center; gap:14px;">
        {#if form.Photo}
          <img src={form.Photo} alt="Profile preview" style="width:64px; height:64px; border-radius:50%; object-fit:cover; border:1px solid var(--border, #ddd);" />
        {:else}
          <div style="width:64px; height:64px; border-radius:50%; display:grid; place-items:center; background:#e5e7eb; color:#6b7280; font-weight:700; font-size:1.4rem;">
            {(form.Name || '?').trim().charAt(0).toUpperCase() || '?'}
          </div>
        {/if}
        <div>
          <label style="display:block; margin-bottom:4px;">Profile Photo</label>
          <input type="file" accept="image/*" onchange={onPickPhoto} disabled={uploadingPhoto} />
          {#if uploadingPhoto}<span style="font-size:0.8rem; color:var(--text-muted); margin-left:8px;">Uploading...</span>{/if}
          {#if form.Photo && !uploadingPhoto}
            <button type="button" class="btn-link" style="margin-left:8px; font-size:0.8rem;" onclick={() => (form = { ...form, Photo: '' })}>Remove</button>
          {/if}
        </div>
      </div>

      <TransliterateInput
        label="Name"
        value={{ en: form.Name, hi: form['Name (Hindi)'] }}
        onChange={({ en, hi }) => (form = { ...form, Name: en, 'Name (Hindi)': hi })}
      />

      <div class="form-group">
        <label>Village</label>
        <VillageInput
          value={form.Village}
          hiValue={form['Village (Hindi)']}
          onChange={(en, hi) => (form = { ...form, Village: en, 'Village (Hindi)': hi })}
        />
      </div>

      <TransliterateInput
        label="Father's Name"
        value={{ en: form["Father's Name"], hi: form["Father's Name (Hindi)"] }}
        onChange={({ en, hi }) => (form = { ...form, "Father's Name": en, "Father's Name (Hindi)": hi })}
      />

      <div class="form-group">
        <label>Mobile</label>
        <input
          value={form.Mobile}
          maxlength={10}
          inputmode="numeric"
          placeholder="10 digit number"
          oninput={(e) => (form = { ...form, Mobile: (e.currentTarget as HTMLInputElement).value.replace(/\D/g, '').slice(0, 10) })}
        />
      </div>

      <TransliterateInput
        label="Designation"
        value={{ en: form.Designation, hi: form['Designation (Hindi)'] }}
        onChange={({ en, hi }) => (form = { ...form, Designation: en, 'Designation (Hindi)': hi })}
      />

      <div class="form-group">
        <label>Email</label>
        <input value={form.Email} oninput={(e) => (form = { ...form, Email: (e.currentTarget as HTMLInputElement).value })} />
      </div>

      <div class="form-group">
        <label>WhatsApp</label>
        <input
          value={form.WhatsApp}
          maxlength={10}
          inputmode="numeric"
          placeholder="10 digit number"
          oninput={(e) => (form = { ...form, WhatsApp: (e.currentTarget as HTMLInputElement).value.replace(/\D/g, '').slice(0, 10) })}
        />
      </div>

      <button class="btn-submit" disabled={saving || uploadingPhoto}>{saving ? 'Saving...' : 'Save'}</button>
    </form>
  </Modal>

  <UserProfileModal userId={viewingUserId} onClose={() => (viewingUserId = null)} />
{/if}
