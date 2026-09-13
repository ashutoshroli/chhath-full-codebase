<script lang="ts">
  // Ported from React QuickAddUser.jsx — quick modal to add a USERS record and
  // return its new id. Same behaviour (invalidate 'users' cache on success).
  import { api } from '$lib/api';
  import { invalidate } from '$lib/cache';
  import Modal from './Modal.svelte';
  import VillageInput from './VillageInput.svelte';

  interface Props {
    open: boolean;
    onClose: () => void;
    onCreated: (id: string) => void;
  }
  let { open, onClose, onCreated }: Props = $props();

  let form = $state<{ Name: string; Village: string }>({ Name: '', Village: '' });
  let saving = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    if (!form.Name) { alert('Name is required'); return; }
    saving = true;
    try {
      const res: any = await api.saveRecord('USERS', form);
      invalidate('users');
      form = { Name: '', Village: '' };
      onCreated(res.id);
      onClose();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      saving = false;
    }
  }
</script>

<Modal {open} onClose={onClose}>
  <h3 style="margin-bottom:15px;">Quick Add User</h3>
  <form onsubmit={submit}>
    <div class="form-group">
      <label>Name</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={form.Name} autofocus />
    </div>
    <div class="form-group">
      <label>Village</label>
      <VillageInput value={form.Village} onChange={(v) => (form = { ...form, Village: v })} />
    </div>
    <button class="btn-submit" disabled={saving}>{saving ? 'Saving...' : 'Add & Select'}</button>
  </form>
</Modal>
