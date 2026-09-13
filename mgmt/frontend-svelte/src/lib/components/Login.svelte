<script lang="ts">
  // Ported from React Login.jsx — password login, 2FA branch, forgot-password
  // branch, and Google Identity Services sign-in. Same markup/classes/copy.
  import { onMount } from 'svelte';
  import { api, saveSession } from '$lib/api';
  import AppFooter from './AppFooter.svelte';
  import TwoFactorInput from './TwoFactorInput.svelte';
  import ForgotPassword from './ForgotPassword.svelte';
  import type { SessionUser } from '$lib/api';

  interface Props {
    onLogin: (u: SessionUser) => void;
  }
  let { onLogin }: Props = $props();

  const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  const GIS_SRC = 'https://accounts.google.com/gsi/client';

  let name = $state('');
  let password = $state('');
  let remember = $state(true);
  let error = $state('');
  let loading = $state(false);
  let googleLoading = $state(false);
  let googleBtnEl: HTMLDivElement | undefined = $state();

  let twoFA = $state<{ tempToken: string; remember: boolean } | null>(null);
  let twoFAError = $state('');
  let twoFAResetKey = $state(0);

  let forgot = $state(false);
  let resetDone = $state('');

  let gisPromise: Promise<void> | null = null;
  function loadGis(): Promise<void> {
    if (gisPromise) return gisPromise;
    gisPromise = new Promise((resolve, reject) => {
      if (window.google && window.google.accounts && window.google.accounts.id) return resolve();
      const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
      const onload = () => resolve();
      const onerror = () => { gisPromise = null; reject(new Error('Google sign-in could not load.')); };
      if (existing) {
        existing.addEventListener('load', onload);
        existing.addEventListener('error', onerror);
        return;
      }
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.defer = true;
      s.addEventListener('load', onload);
      s.addEventListener('error', onerror);
      document.head.appendChild(s);
    });
    return gisPromise;
  }

  function completeLogin(res: any, rememberNow: boolean) {
    saveSession(res, rememberNow);
    onLogin({ name: res.name, role: res.role });
  }

  async function submit(e: Event) {
    e.preventDefault();
    error = '';
    if (!name || !password) { error = 'Fill both fields'; return; }
    loading = true;
    try {
      const res: any = await api.login(name, password, remember);
      if (res && res.requires2FA) {
        twoFA = { tempToken: res.tempToken, remember };
        return;
      }
      completeLogin(res, remember);
    } catch (err) {
      error = (err as Error).message || 'Login failed';
    } finally {
      loading = false;
    }
  }

  async function submitTwoFA(code: string) {
    twoFAError = '';
    loading = true;
    try {
      const res: any = await api.verify2FA(twoFA!.tempToken, code);
      completeLogin(res, twoFA!.remember);
    } catch (err) {
      twoFAError = (err as Error).message || 'Invalid or expired code.';
      twoFAResetKey += 1;
    } finally {
      loading = false;
    }
  }

  function cancelTwoFA() {
    twoFA = null;
    twoFAError = '';
    password = '';
  }

  async function handleGoogleCredential(response: { credential: string }) {
    error = '';
    googleLoading = true;
    try {
      const rememberNow = remember;
      const res: any = await api.verifyGoogleLogin(response.credential, rememberNow);
      if (res && res.requires2FA) {
        twoFA = { tempToken: res.tempToken, remember: rememberNow };
        return;
      }
      saveSession(res, rememberNow);
      onLogin({ name: res.name, role: res.role });
    } catch (err) {
      error = (err as Error).message || 'Google sign-in failed';
    } finally {
      googleLoading = false;
    }
  }

  onMount(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;
    loadGis()
      .then(() => {
        if (cancelled || !window.google || !googleBtnEl) return;
        window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleCredential });
        window.google.accounts.id.renderButton(googleBtnEl, {
          theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', width: 300
        });
      })
      .catch(() => { if (!cancelled) error = 'Google sign-in could not load. Use your password instead.'; });
    return () => { cancelled = true; };
  });
</script>

<div style="max-width:400px; margin:15vh auto 0; padding:0 15px;">
  <div style="text-align:center; margin-bottom:20px;">
    <img src="/logo.svg" alt="Navyuvak Chhath Puja Samiti" width="88" height="88" style="width:88px; height:88px; display:block; margin:0 auto 8px;" />
    <h2>Committee Portal</h2>
  </div>

  {#if forgot}
    <ForgotPassword
      initialName={name}
      onCancel={() => (forgot = false)}
      onDone={(msg) => { forgot = false; resetDone = msg || 'Your password has been reset. Please sign in.'; password = ''; }}
    />
  {:else if twoFA}
    <div class="glass-card">
      <h3 style="margin-top:0;">Two-Factor Authentication</h3>
      <TwoFactorInput onSubmit={submitTwoFA} disabled={loading} error={twoFAError} resetKey={twoFAResetKey} />
      <button
        type="button"
        onclick={cancelTwoFA}
        disabled={loading}
        style="display:block; margin:16px auto 0; background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.82rem;"
      >
        ← Back to login
      </button>
    </div>
  {:else}
    <form class="glass-card" onsubmit={submit}>
      {#if resetDone}
        <div style="background:rgba(22,163,74,0.08); border:1px solid #16a34a33; border-radius:8px; padding:8px 10px; font-size:0.85rem; margin-bottom:12px;">
          {resetDone}
        </div>
      {/if}
      {#if error}<div class="error-banner">{error}</div>{/if}
      <div class="form-group">
        <label>Username / Mobile / Email</label>
        <input bind:value={name} autocomplete="username" placeholder="Username, Mobile, or Email" />
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" bind:value={password} autocomplete="current-password" />
      </div>
      <div class="form-group">
        <label style="display:flex; align-items:center; gap:6px;">
          <input type="checkbox" bind:checked={remember} />
          Keep me logged in for 30 days
        </label>
      </div>
      <button class="btn-submit" type="submit" disabled={loading || googleLoading}>
        {loading ? 'Signing in...' : 'Secure Login'}
      </button>

      <button
        type="button"
        onclick={() => { forgot = true; error = ''; resetDone = ''; }}
        style="display:block; margin:12px auto 0; background:none; border:none; color:var(--accent, #2563eb); cursor:pointer; font-size:0.85rem;"
      >
        Forgot password?
      </button>

      {#if GOOGLE_CLIENT_ID}
        <div style="display:flex; align-items:center; gap:10px; margin:16px 0 12px; color:var(--text-muted); font-size:0.8rem;">
          <span style="flex:1; height:1px; background:#e5e7eb;"></span>
          OR
          <span style="flex:1; height:1px; background:#e5e7eb;"></span>
        </div>
        <div style="display:flex; justify-content:center; min-height:44px;">
          {#if googleLoading}
            <span style="color:var(--text-muted); font-size:0.9rem;">Signing in with Google...</span>
          {:else}
            <div bind:this={googleBtnEl}></div>
          {/if}
        </div>
        <p style="font-size:0.72rem; color:var(--text-muted); text-align:center; margin:10px 0 0;">
          Use the Google account whose email is on your committee login.
        </p>
      {/if}
    </form>
  {/if}
</div>
<AppFooter compact />
