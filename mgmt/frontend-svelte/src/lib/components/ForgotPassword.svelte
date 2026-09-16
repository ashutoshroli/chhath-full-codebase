<script lang="ts">
  // Ported from React ForgotPassword.jsx — request code -> reset flow, same
  // error codes (NOT_FOUND / NO_EMAIL / RATE_LIMITED) and copy.
  import { api } from '$lib/api';
  import { newUid } from '$lib/a11y/uid';
  // audit PR-40: one prefix per instance, so `for`/`id` pairs cannot collide when a
  // component is mounted more than once on a screen.
  const uid = newUid();

  interface Props {
    initialName?: string;
    onCancel: () => void;
    onDone: (msg: string) => void;
  }
  let { initialName = '', onCancel, onDone }: Props = $props();

  let step = $state<'request' | 'reset'>('request');
  // audit PR-40: deliberate one-time capture. This is EDITABLE local state seeded from a
  // prop; making it `$derived` would discard whatever the operator has typed every time the
  // parent re-rendered. The prop is re-read where it genuinely needs to be (see the $effect).
  // svelte-ignore state_referenced_locally
  let name = $state(initialName);
  let code = $state('');
  let newPassword = $state('');
  let confirm = $state('');
  let error = $state('');
  let info = $state('');
  let loading = $state(false);

  async function requestCode(e: Event) {
    e.preventDefault();
    error = '';
    if (!name.trim()) { error = 'Enter your username, mobile, or email.'; return; }
    loading = true;
    try {
      const res: any = await api.requestPasswordReset(name.trim());
      info = (res && res.message) || 'A 6-digit reset code has been sent.';
      step = 'reset';
    } catch (e2) {
      const err = e2 as any;
      if (err && err.code === 'NOT_FOUND') {
        error = 'No account found with that username, mobile, or email.';
      } else if (err && err.code === 'NO_EMAIL') {
        error = 'This account has no email on file. Contact a committee admin to reset your password.';
      } else if (err && err.code === 'RATE_LIMITED') {
        const secs = Number(err.retryAfterSeconds) || 0;
        const mins = Math.max(1, Math.ceil(secs / 60));
        error = err.message || `Too many reset requests. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
      } else {
        error = (err && err.message) || 'Could not start password reset.';
      }
    } finally {
      loading = false;
    }
  }

  async function doReset(e: Event) {
    e.preventDefault();
    error = '';
    if (!code.trim()) { error = 'Enter the 6-digit code from your email.'; return; }
    if (!newPassword) { error = 'Enter a new password.'; return; }
    if (newPassword !== confirm) { error = 'The two passwords do not match.'; return; }
    loading = true;
    try {
      const res: any = await api.resetPassword(name.trim(), code.trim(), newPassword);
      onDone((res && res.message) || 'Your password has been reset. Please sign in.');
    } catch (e2) {
      error = (e2 as Error).message || 'Could not reset the password.';
    } finally {
      loading = false;
    }
  }
</script>

<div class="glass-card">
  <h3 style="margin-top:0;">Reset your password</h3>
  {#if error}<div role="alert" class="error-banner">{error}</div>{/if}
  {#if info && step === 'reset'}
    <div style="background:rgba(22,163,74,0.08); border:1px solid #16a34a33; border-radius:8px; padding:8px 10px; font-size:0.82rem; margin-bottom:12px;">
      {info}
    </div>
  {/if}

  {#if step === 'request'}
    <form onsubmit={requestCode}>
      <div class="form-group">
        <label for={`${uid}-f1`}>Username / Mobile / Email</label>
        <!-- svelte-ignore a11y_autofocus -->
        <input id={`${uid}-f1`} bind:value={name} autocomplete="username" placeholder="Username, Mobile, or Email" autofocus />
      </div>
      <p style="font-size:0.78rem; color:var(--text-muted); margin:0 0 12px;">
        We'll email a 6-digit reset code to the address on your account. If you have no email on file, contact a committee admin.
      </p>
      <button class="btn-submit" type="submit" disabled={loading}>{loading ? 'Sending…' : 'Send reset code'}</button>
    </form>
  {:else}
    <form onsubmit={doReset}>
      <div class="form-group">
        <label for={`${uid}-f2`}>6-digit code</label>
        <!-- svelte-ignore a11y_autofocus -->
        <input id={`${uid}-f2`}
          value={code}
          oninput={(e) => (code = (e.currentTarget as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6))}
          inputmode="numeric"
          autocomplete="one-time-code"
          placeholder="000000"
          maxlength="6"
          autofocus
          style="letter-spacing:0.3em; text-align:center; font-size:1.2rem;"
        />
      </div>
      <div class="form-group">
        <label for={`${uid}-f3`}>New password</label>
        <input id={`${uid}-f3`} type="password" bind:value={newPassword} autocomplete="new-password" />
      </div>
      <div class="form-group">
        <label for={`${uid}-f4`}>Confirm new password</label>
        <input id={`${uid}-f4`} type="password" bind:value={confirm} autocomplete="new-password" />
      </div>
      <p style="font-size:0.75rem; color:var(--text-muted); margin:0 0 12px;">
        Use at least 8 characters. Superadmin accounts need 12+ with an uppercase letter, a lowercase letter and a number.
      </p>
      <button class="btn-submit" type="submit" disabled={loading}>{loading ? 'Resetting…' : 'Reset password'}</button>
      <button
        type="button"
        onclick={() => { step = 'request'; error = ''; }}
        disabled={loading}
        style="display:block; margin:10px auto 0; background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.82rem;"
      >
        ← Didn't get a code? Try again
      </button>
    </form>
  {/if}

  <button
    type="button"
    onclick={onCancel}
    disabled={loading}
    style="display:block; margin:16px auto 0; background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.82rem;"
  >
    ← Back to login
  </button>
</div>
