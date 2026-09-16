<script lang="ts">
  // Ported from the GroupInfoList sub-component of React views/WhatsApp.jsx —
  // manage WhatsApp group name/id records (add/edit/delete/toggle active).
  import { api } from '$lib/api';
  import Modal from '$lib/components/Modal.svelte';
  import { isTruthyFlag } from '$lib/flags';

  let rows = $state<any[] | null>(null);
  let loading = $state(true);
  let error = $state('');
  let showAdd = $state(false);
  let editing = $state<any>(null);
  let form = $state({ groupName: '', groupid: '' });
  let saving = $state(false);

  function load() {
    loading = true;
    api.getWhatsappGroups().then((r: any) => (rows = r)).catch((err: Error) => (error = err.message)).finally(() => (loading = false));
  }
  let loaded = false;
  $effect(() => { if (loaded) return; loaded = true; load(); });

  function closeModal() { showAdd = false; editing = null; form = { groupName: '', groupid: '' }; }

  function openEdit(r: any) {
    editing = r;
    form = { groupName: r.group_name, groupid: r.groupid };
    showAdd = true;
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!form.groupName.trim() || !form.groupid.trim()) { alert('Both Group Name and Group ID are required'); return; }
    saving = true;
    try {
      if (editing) await api.updateWhatsappGroup(editing.__rowIndex, form.groupName.trim(), form.groupid.trim(), undefined);
      else await api.addWhatsappGroup(form.groupName.trim(), form.groupid.trim());
      closeModal();
      load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      saving = false;
    }
  }

  async function toggleActive(r: any) {
    try { await api.updateWhatsappGroup(r.__rowIndex, undefined, undefined, !isTruthyFlag(r.active)); load(); }
    catch (err) { alert((err as Error).message); }
  }

  async function remove(r: any) {
    if (!confirm(`Delete ${r.group_name}?`)) return;
    try { await api.deleteWhatsappGroup(r.__rowIndex); load(); } catch (err) { alert((err as Error).message); }
  }
</script>

{#if loading}
  <div class="inline-spinner">Loading groups...</div>
{:else if error}
  <div class="error-banner">{error}</div>
{:else}
  {#if !rows || rows.length === 0}<div class="glass-card" style="text-align:center; padding:20px;">No groups have been added yet.</div>{/if}

  {#each rows || [] as r, i (r.__rowIndex ?? i)}
    {@const isActive = isTruthyFlag(r.active)}
    <div class="glass-card" style="padding:15px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; gap:10px;">
      <div>
        <strong>{r.group_name}</strong>
        <div style="font-size:0.8rem; color:var(--text-muted);">{r.groupid}</div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="badge {isActive ? 'badge-ok' : 'badge-warn'} toggle-switch" onclick={() => toggleActive(r)}>
          {isActive ? 'Active' : 'Inactive'}
        </span>
        <div class="row-actions">
          <button type="button" class="icon-btn" title="Edit" onclick={() => openEdit(r)}>
            <span class="material-icons-round" style="font-size:16px;">edit</span>
          </button>
          <button type="button" class="icon-btn icon-danger" title="Delete" onclick={() => remove(r)}>
            <span class="material-icons-round" style="font-size:16px;">delete</span>
          </button>
        </div>
      </div>
    </div>
  {/each}

  <button class="fab" onclick={() => (showAdd = true)}><span class="material-icons-round">add</span></button>

  <Modal open={showAdd} onClose={closeModal} labelledBy="dlg-groupinfolist-92-title">
    <h3 id="dlg-groupinfolist-92-title" style="margin-bottom:15px;">{editing ? 'Edit Group' : 'New Group'}</h3>
    <form onsubmit={submit}>
      <div class="form-group">
        <label>Group Name</label>
        <input value={form.groupName} oninput={(e) => (form = { ...form, groupName: (e.currentTarget as HTMLInputElement).value })} />
      </div>
      <div class="form-group">
        <label>Group ID</label>
        <input value={form.groupid} oninput={(e) => (form = { ...form, groupid: (e.currentTarget as HTMLInputElement).value })} placeholder="e.g. 1203630xxxx@g.us" />
      </div>
      <button class="btn-submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
    </form>
  </Modal>
{/if}
