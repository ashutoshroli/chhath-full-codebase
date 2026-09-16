<script lang="ts">
  // Ported from React QuickAddUser.jsx — quick modal to add a USERS record and
  // return its new id. Same behaviour (invalidate 'users' cache on success).
  import { api } from '$lib/api';
  import { invalidate } from '$lib/cache';
  import Modal from './Modal.svelte';
  import VillageInput from './VillageInput.svelte';
  import { newUid } from '$lib/a11y/uid';
  // audit PR-40: one prefix per instance, so `for`/`id` pairs cannot collide when a
  // component is mounted more than once on a screen.
  const uid = newUid();

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

<Modal {open} onClose={onClose} labelledBy="dlg-quickadduser-37-title">
  <h3 id="dlg-quickadduser-37-title" style="margin-bottom:15px;">Quick Add User</h3>
  <form onsubmit={submit}>
    <div class="form-group">
      <label for={`${uid}-f1`}>Name</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id={`${uid}-f1`} bind:value={form.Name} autofocus />
    </div>
    <div class="form-group">
      <label for={`${uid}-village1`}>Village</label>
      <VillageInput id={`${uid}-village1`} value={form.Village} onChange={(v) => (form = { ...form, Village: v })} />
    </div>
    <button class="btn-submit" disabled={saving}>{saving ? 'Saving...' : 'Add & Select'}</button>
  </form>
</Modal>
