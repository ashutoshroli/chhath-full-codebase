// ====== AUDIT P0-11 — an expired session must return the app to Login ======
//
// The API layer called clearSession() when the server answered `authError`, which
// wiped token/expiry/user from storage. But nothing told the Svelte session store,
// so `$session` still held the user: the app stayed on the authenticated shell and
// every following action failed with the same error. The only ways out were a
// manual reload or the Log out button.
//
// api.ts now announces the expiry once (onAuthExpired) and the session store
// clears itself, which unmounts the shell and renders Login with a reason.

import { describe, it, expect, beforeEach, vi } from 'vitest';

class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
}

// A fetch that answers every action with the given payload.
function stubFetch(payload: unknown, status = 200) {
  const calls: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    return { status, json: async () => payload } as unknown as Response;
  }));
  return calls;
}

async function freshApi() {
  vi.stubGlobal('localStorage', new MemoryStorage() as unknown as Storage);
  vi.stubGlobal('sessionStorage', new MemoryStorage() as unknown as Storage);
  vi.stubGlobal('document', { cookie: '' } as unknown as Document);
  vi.stubGlobal('navigator', { onLine: true, userAgent: 'test' } as unknown as Navigator);
  vi.resetModules();
  return import('./api');
}

describe('onAuthExpired (audit P0-11)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fires when the server reports authError, and clears the stored session', async () => {
    const api = await freshApi();
    api.saveSession({ token: 't', expiresAt: Date.now() + 60_000, name: 'USER0001', role: 'Superadmin' }, true);
    expect(api.getSession()).not.toBeNull();

    const seen: string[] = [];
    api.onAuthExpired((m) => seen.push(m));
    stubFetch({ authError: true, message: 'Session expired, please login again' });

    await expect(api.api.getYears()).rejects.toThrow(/Session expired/);

    expect(seen).toEqual(['Session expired, please login again']);
    expect(api.getSession()).toBeNull();
  });

  it('fires only once for a burst of parallel requests', async () => {
    const api = await freshApi();
    api.saveSession({ token: 't', expiresAt: Date.now() + 60_000, name: 'USER0001', role: 'Superadmin' }, true);
    let count = 0;
    api.onAuthExpired(() => { count += 1; });
    stubFetch({ authError: true, message: 'Session expired' });

    await Promise.allSettled([api.api.getYears(), api.api.getUsers(), api.api.getLockedYears()]);

    expect(count).toBe(1);
  });

  it('also fires when the token has expired LOCALLY (no request is sent)', async () => {
    const api = await freshApi();
    api.saveSession({ token: 't', expiresAt: Date.now() - 1000, name: 'USER0001', role: 'Superadmin' }, true);
    const seen: string[] = [];
    api.onAuthExpired((m) => seen.push(m));
    const calls = stubFetch({ success: true });

    await expect(api.api.getYears()).rejects.toThrow(/Session expired/);

    expect(seen.length).toBe(1);
    expect(calls.length).toBe(0);
  });

  it('announces again after a fresh login', async () => {
    const api = await freshApi();
    const signIn = () => api.saveSession(
      { token: 't', expiresAt: Date.now() + 60_000, name: 'USER0001', role: 'Superadmin' }, true
    );
    let count = 0;
    api.onAuthExpired(() => { count += 1; });
    stubFetch({ authError: true, message: 'Session expired' });

    signIn();
    await expect(api.api.getYears()).rejects.toThrow();
    expect(count).toBe(1);

    api.resetAuthExpiredNotice();           // what session.login() does
    signIn();
    await expect(api.api.getYears()).rejects.toThrow();
    expect(count).toBe(2);
  });

  it('does NOT fire for an ordinary failed request', async () => {
    const api = await freshApi();
    api.saveSession({ token: 't', expiresAt: Date.now() + 60_000, name: 'USER0001', role: 'Superadmin' }, true);
    let count = 0;
    api.onAuthExpired(() => { count += 1; });
    stubFetch({ success: false, message: 'That year is locked' });

    await expect(api.api.getYears()).rejects.toThrow(/locked/);

    expect(count).toBe(0);
    expect(api.getSession()).not.toBeNull();
  });

  it('a throwing listener cannot break the request path', async () => {
    const api = await freshApi();
    api.saveSession({ token: 't', expiresAt: Date.now() + 60_000, name: 'USER0001', role: 'Superadmin' }, true);
    api.onAuthExpired(() => { throw new Error('listener blew up'); });
    stubFetch({ authError: true, message: 'Session expired' });

    // The caller still sees the auth error, not the listener's error.
    await expect(api.api.getYears()).rejects.toThrow(/Session expired/);
  });

  it('unsubscribing stops the notifications', async () => {
    const api = await freshApi();
    api.saveSession({ token: 't', expiresAt: Date.now() + 60_000, name: 'USER0001', role: 'Superadmin' }, true);
    let count = 0;
    const off = api.onAuthExpired(() => { count += 1; });
    off();
    stubFetch({ authError: true, message: 'Session expired' });

    await expect(api.api.getYears()).rejects.toThrow();

    expect(count).toBe(0);
  });
});

// ====== the tab the shell opens for a given hash + role (audit P0-11) ======
//
// This mirrors resolveAllowedTab() in routes/+page.svelte: an initial hash the
// role may not open (or an unknown one) must fall back to Home rather than
// rendering an empty shell.

const BASE_TAB_IDS = ['home', 'users', 'expenses', 'loans', 'committee'];
const ROLE_TOOL_TABS: Record<string, string[]> = {
  Superadmin: ['docxtemplates', 'backup', 'errorlog'],
  Admin: ['pdfexport'],
  Subadmin: []
};

function resolveAllowedTab(rawHash: string, role: string | undefined): string {
  const h = (rawHash || '').replace(/^#/, '').trim() || 'home';
  const allowed = new Set([...BASE_TAB_IDS, ...(role ? ROLE_TOOL_TABS[role] || [] : [])]);
  return allowed.has(h) ? h : 'home';
}

describe('resolveAllowedTab (audit P0-11)', () => {
  it('keeps a hash the role may open', () => {
    expect(resolveAllowedTab('#docxtemplates', 'Superadmin')).toBe('docxtemplates');
    expect(resolveAllowedTab('#loans', 'Subadmin')).toBe('loans');
  });

  it('falls back to home for a tool the role may NOT open', () => {
    // On main this left `tab = 'docxtemplates'` and the shell rendered nothing.
    expect(resolveAllowedTab('#docxtemplates', 'Admin')).toBe('home');
    expect(resolveAllowedTab('#backup', 'Subadmin')).toBe('home');
  });

  it('falls back to home for an unknown or empty hash', () => {
    expect(resolveAllowedTab('#garbage', 'Superadmin')).toBe('home');
    expect(resolveAllowedTab('', 'Superadmin')).toBe('home');
    expect(resolveAllowedTab('#', 'Superadmin')).toBe('home');
  });

  it('falls back to home when there is no role yet', () => {
    expect(resolveAllowedTab('#backup', undefined)).toBe('home');
    expect(resolveAllowedTab('#home', undefined)).toBe('home');
  });
});
