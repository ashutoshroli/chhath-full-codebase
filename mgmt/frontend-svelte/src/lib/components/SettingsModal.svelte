<script lang="ts">
  // Ported from React SettingsModal.jsx — edit own contact info, change password,
  // manage 2FA (TwoFactorSettings), and view/revoke active device sessions.
  import { api, clearSession } from '$lib/api';
  import Modal from './Modal.svelte';
  import TwoFactorSettings from './TwoFactorSettings.svelte';

  interface Props {
    open: boolean;
    onClose: () => void;
    userId: string;
  }
  let { open, onClose, userId }: Props = $props();

  function timeAgo(iso: string): string {
    if (!iso) return '';
    const then = Date.parse(iso);
    if (isNaN(then)) return '';
    const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h} hr ago`;
    const d = Math.floor(h / 24); return `${d} day${d > 1 ? 's' : ''} ago`;
  }

  let profile = $state({ Mobile: '', Email: '', WhatsApp: '' });
  let loading = $state(false);
  let loadError = $state('');
  let saving = $state(false);

  let pwForm = $state({ current: '', next: '', confirm: '' });
  let pwSaving = $state(false);
  let pwError = $state('');
  let pwMsg = $state('');

  let sessions = $state<any[]>([]);
  let sessLoading = $state(false);
  let sessError = $state('');
  let sessBusy = $state(false);

  function loadSessions() {
    sessLoading = true;
    sessError = '';
    api.getMySessions()
      .then((d: any) => (sessions = d.sessions || []))
      .catch((err: Error) => (sessError = err.message))
      .finally(() => (sessLoading = false));
  }

  // React: useEffect on [open, userId].
  let lastKey = '';
  $effect(() => {
    const key = `${open}|${userId}`;
    if (key === lastKey) return;
    lastKey = key;
    if (!open || !userId) return;
    pwError = ''; pwMsg = '';
    loading = true;
    api.getUserProfile(userId)
      .then((d: any) => (profile = { Mobile: d.user.Mobile || '', Email: d.user.Email || '', WhatsApp: d.user.WhatsApp || '' }))
      .catch((err: Error) => (loadError = err.message))
      .finally(() => (loading = false));
    loadSessions();
  });

  function afterMaybeSelfLogout(wasCurrent: boolean) {
    if (wasCurrent) { clearSession(); window.location.reload(); }
  }

  async function logoutDevice(s: any) {
    if (!confirm('Log this device out?')) return;
    sessBusy = true;
    try {
      const res: any = await api.revokeSession(s.id);
      if (res && res.wasCurrent) return afterMaybeSelfLogout(true);
      loadSessions();
    } catch (err) { alert((err as Error).message); }
    finally { sessBusy = false; }
  }

  async function logoutAllOthers() {
    if (!confirm('Log out of every OTHER device? This device stays signed in.')) return;
    sessBusy = true;
    try {
      await api.revokeAllOtherSessions();
      loadSessions();
    } catch (err) { alert((err as Error).message); }
    finally { sessBusy = false; }
  }

  async function saveProfile(e: Event) {
    e.preventDefault();
    if (profile.Mobile && profile.Mobile.length !== 10) { alert('Mobile number must be 10 digits'); return; }
    if (profile.WhatsApp && profile.WhatsApp.length !== 10) { alert('WhatsApp number must be 10 digits'); return; }
    saving = true;
    try {
      await api.updateOwnProfile(profile);
      alert('Profile updated successfully.');
    } catch (err) {
      alert((err as Error).message);
    } finally {
      saving = false;
    }
  }

  function setPw(patch: Partial<typeof pwForm>) { pwForm = { ...pwForm, ...patch }; pwError = ''; pwMsg = ''; }

  async function savePassword(e: Event) {
    e.preventDefault();
    pwError = ''; pwMsg = '';
    if (!pwForm.current || !pwForm.next || !pwForm.confirm) { pwError = 'Please fill in all fields.'; return; }
    if (pwForm.next !== pwForm.confirm) { pwError = 'The new passwords do not match.'; return; }
    pwSaving = true;
    try {
      const res: any = await api.changePassword(pwForm.current, pwForm.next);
      pwMsg = (res && res.message) || 'Password changed successfully.';
      pwForm = { current: '', next: '', confirm: '' };
    } catch (err) {
      pwError = (err as Error).message;
    } finally {
      pwSaving = false;
    }
  }

  let otherSessionsCount = $derived(sessions.filter((s) => !s.isCurrent).length);
</script>

<Modal {open} {onClose} title="Settings">
  {#if loadError}
    <div class="error-banner">
      Profile failed to load: {loadError} — please refresh the page before saving,
      otherwise your mobile/email/WhatsApp may be lost.
    </div>
  {/if}
  <h3 style="margin-bottom:15px;">Settings</h3>
  {#if loading}<div class="inline-spinner">Loading...</div>{/if}

  {#if !loading}
    <form onsubmit={saveProfile} style="margin-bottom:28px;">
      <div class="form-group">
        <label>Mobile</label>
        <input value={profile.Mobile} maxlength={10} inputmode="numeric" placeholder="10 digit number" oninput={(e) => (profile = { ...profile, Mobile: (e.currentTarget as HTMLInputElement).value.replace(/\D/g, '').slice(0, 10) })} />
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" value={profile.Email} oninput={(e) => (profile = { ...profile, Email: (e.currentTarget as HTMLInputElement).value })} />
      </div>
      <div class="form-group">
        <label>WhatsApp</label>
        <input value={profile.WhatsApp} maxlength={10} inputmode="numeric" placeholder="10 digit number" oninput={(e) => (profile = { ...profile, WhatsApp: (e.currentTarget as HTMLInputElement).value.replace(/\D/g, '').slice(0, 10) })} />
      </div>
      <button class="btn-submit" disabled={saving}>{saving ? 'Saving...' : 'Save Contact Info'}</button>
    </form>

    <h4 style="margin-bottom:10px;">Change Password</h4>
    <form onsubmit={savePassword}>
      <div class="form-group">
        <label>Current Password</label>
        <input type="password" value={pwForm.current} oninput={(e) => setPw({ current: (e.currentTarget as HTMLInputElement).value })} />
      </div>
      <div class="form-group">
        <label>New Password</label>
        <input type="password" value={pwForm.next} oninput={(e) => setPw({ next: (e.currentTarget as HTMLInputElement).value })} />
      </div>
      <div class="form-group">
        <label>Confirm New Password</label>
        <input type="password" value={pwForm.confirm} oninput={(e) => setPw({ confirm: (e.currentTarget as HTMLInputElement).value })} />
      </div>
      {#if pwError}<div style="color:#b91c1c; font-size:0.82rem; margin-bottom:10px;" role="alert">{pwError}</div>{/if}
      {#if pwMsg}<div style="color:#166534; font-size:0.82rem; margin-bottom:10px;" role="status">{pwMsg}</div>{/if}
      <button class="btn-submit" disabled={pwSaving}>{pwSaving ? 'Saving...' : 'Change Password'}</button>
    </form>

    <TwoFactorSettings />

    <h4 style="margin:28px 0 6px;">Active Devices</h4>
    <p style="font-size:0.82rem; color:var(--text-muted); margin-bottom:10px;">
      Everywhere you are currently logged in. Log out any device you don't recognise.
    </p>
    {#if sessError}<div class="error-banner" style="margin-bottom:10px;">Could not load devices: {sessError}</div>{/if}
    {#if sessLoading}<div class="inline-spinner">Loading...</div>{/if}
    {#if !sessLoading && sessions.length === 0 && !sessError}
      <div style="font-size:0.85rem; color:var(--text-muted);">No active devices found.</div>
    {/if}
    {#each sessions as s (s.id)}
      {#if !sessLoading}
        <div style="border:1px solid var(--border, #e2e2e2); border-radius:10px; padding:10px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <div style="min-width:0;">
            <div style="font-weight:600; font-size:0.9rem; overflow-wrap:anywhere;">
              {s.device || 'Unknown device'} {#if s.isCurrent}<span style="color:var(--success); font-size:0.75rem;">· this device</span>{/if}
            </div>
            <div style="font-size:0.78rem; color:var(--text-muted);">
              IP {s.ip || '—'} · signed in {timeAgo(s.createdAt)} · active {timeAgo(s.lastSeenAt)}
            </div>
          </div>
          {#if !s.isCurrent}
            <button type="button" class="btn-danger" disabled={sessBusy} style="white-space:nowrap; font-size:0.8rem; padding:6px 10px;" onclick={() => logoutDevice(s)}>
              Log out
            </button>
          {/if}
        </div>
      {/if}
    {/each}
    {#if !sessLoading && otherSessionsCount > 0}
      <button type="button" class="btn-danger" disabled={sessBusy} style="margin-top:6px; font-size:0.82rem;" onclick={logoutAllOthers}>
        Log out of all other devices
      </button>
    {/if}
  {/if}
</Modal>
