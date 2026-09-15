// ====== AUDIT P0-08 — the view cache must not outlive the account ======
//
// The localStorage mirror was hydrated into memory at MODULE LOAD, before anything
// knew who was signed in, and its keys were generic ('users', 'loginusers',
// 'home:2026', …). clearSession() removed only the token/user keys, so the cached
// rows survived a sign-out and the NEXT account on that browser could be served
// the previous account's Users / Login Management / finance data.
//
// Now: hydration is deferred until setCacheIdentity() confirms the mirror belongs
// to the account signing in, purgeCache() wipes both layers, and the most
// sensitive views are never written to disk at all.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// A minimal localStorage for the Node test environment.
class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  _raw() { return this.map; }
}

const LS_KEY = 'cpm_mgmt_viewcache_v1';

// Each test gets a fresh module instance, because the cache keeps module state.
async function freshCache(storage = new MemoryStorage()) {
  vi.stubGlobal('localStorage', storage as unknown as Storage);
  vi.resetModules();
  const mod = await import('./cache');
  return { mod, storage };
}

/** What a signed-in session looks like to the cache. */
const ALICE = 'USER0001|Superadmin';
const BOB = 'USER0002|Subadmin';

describe('cache identity (audit P0-08)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads nothing before an identity is set', async () => {
    const { mod, storage } = await freshCache();
    // A mirror left behind by a previous session, with a matching data version.
    storage.setItem(LS_KEY, JSON.stringify({
      version: '7', identity: ALICE,
      entries: { 'home:2026': { value: [{ Amount: 100 }], time: Date.now() } }
    }));

    // Re-import with that mirror already present: nothing is hydrated yet.
    const again = await freshCache(storage);
    expect(again.mod.getCached('home:2026')).toBeUndefined();
    expect(again.mod._cacheSize()).toBe(0);
    expect(again.mod._cacheIdentity()).toBeNull();
  });

  it('hydrates the mirror only for the SAME account', async () => {
    const { storage } = await freshCache();
    storage.setItem(LS_KEY, JSON.stringify({
      version: '7', identity: ALICE,
      entries: { 'home:2026': { value: [{ Amount: 100 }], time: Date.now() } }
    }));

    const { mod } = await freshCache(storage);
    const hydrated = mod.setCacheIdentity(ALICE);

    expect(hydrated).toBe(true);
    expect(mod.getCached('home:2026')).toEqual([{ Amount: 100 }]);
    expect(mod._cacheIdentity()).toBe(ALICE);
  });

  it('purges the mirror for a DIFFERENT account', async () => {
    const { storage } = await freshCache();
    storage.setItem(LS_KEY, JSON.stringify({
      version: '7', identity: ALICE,
      entries: { 'home:2026': { value: [{ Amount: 100 }], time: Date.now() } }
    }));

    const { mod } = await freshCache(storage);
    const hydrated = mod.setCacheIdentity(BOB);

    // On `main` Bob is served Alice's rows straight out of localStorage.
    expect(hydrated).toBe(false);
    expect(mod.getCached('home:2026')).toBeUndefined();
    expect(storage.getItem(LS_KEY)).toBeNull();
    expect(mod._cacheIdentity()).toBe(BOB);
  });

  it('treats a changed ROLE as a different account', async () => {
    const { storage } = await freshCache();
    storage.setItem(LS_KEY, JSON.stringify({
      version: '7', identity: 'USER0001|Superadmin',
      entries: { 'home:2026': { value: [1], time: Date.now() } }
    }));

    const { mod } = await freshCache(storage);
    // Same person, demoted: what they were allowed to see has changed.
    expect(mod.setCacheIdentity('USER0001|Admin')).toBe(false);
    expect(mod.getCached('home:2026')).toBeUndefined();
  });

  it('setCacheIdentity(null) leaves an empty cache', async () => {
    const { mod } = await freshCache();
    mod.setCacheIdentity(ALICE);
    mod.setDataVersion('7');
    mod.setCached('years', ['2026']);
    expect(mod.getCached('years')).toEqual(['2026']);

    expect(mod.setCacheIdentity(null)).toBe(false);
    expect(mod.getCached('years')).toBeUndefined();
    expect(mod._cacheIdentity()).toBeNull();
  });
});

describe('purgeCache (audit P0-08)', () => {
  it('clears memory and the persisted mirror', async () => {
    const { mod, storage } = await freshCache();
    mod.setCacheIdentity(ALICE);
    mod.setDataVersion('7');
    mod.setCached('home:2026', [{ Amount: 100 }]);
    expect(storage.getItem(LS_KEY)).toBeTruthy();

    mod.purgeCache();

    expect(mod.getCached('home:2026')).toBeUndefined();
    expect(mod._cacheSize()).toBe(0);
    expect(storage.getItem(LS_KEY)).toBeNull();
    expect(storage.getItem('cpm_mgmt_viewcache_version')).toBeNull();
  });

  it('a purge then a new identity starts from empty', async () => {
    const { mod } = await freshCache();
    mod.setCacheIdentity(ALICE);
    mod.setDataVersion('7');
    mod.setCached('years', ['2026']);

    mod.purgeCache();                 // what clearSession() now does
    mod.setCacheIdentity(BOB);        // the next account signs in

    expect(mod.getCached('years')).toBeUndefined();
  });
});

describe('sensitive views are never written to disk (audit P0-08)', () => {
  it('keeps PII/security views in memory only', async () => {
    const { mod, storage } = await freshCache();
    mod.setCacheIdentity(ALICE);
    mod.setDataVersion('7');

    for (const key of ['users', 'loginusers', 'committee:All', 'auditLogs', 'sessions', 'errorLog:1']) {
      mod.setCached(key, [{ Mobile: '9876543210', Email: 'a@b.test' }]);
      // usable in this tab…
      expect(mod.getCached(key), `${key} should be cached in memory`).toBeTruthy();
    }

    const raw = storage.getItem(LS_KEY);
    // …but nothing personal reached localStorage.
    if (raw) {
      expect(raw).not.toContain('9876543210');
      expect(raw).not.toContain('a@b.test');
      const mirror = JSON.parse(raw);
      for (const key of Object.keys(mirror.entries || {})) {
        expect(['users', 'loginusers', 'committee:All', 'auditLogs', 'sessions', 'errorLog:1'])
          .not.toContain(key);
      }
    }
  });

  it('still mirrors ordinary views', async () => {
    const { mod, storage } = await freshCache();
    mod.setCacheIdentity(ALICE);
    mod.setDataVersion('7');
    mod.setCached('years', ['2026', '2025']);

    const mirror = JSON.parse(storage.getItem(LS_KEY)!);
    expect(mirror.identity).toBe(ALICE);
    expect(mirror.version).toBe('7');
    expect(mirror.entries.years.value).toEqual(['2026', '2025']);
  });
});

describe('data-version invalidation still works (regression guard)', () => {
  it('a changed version clears the cache', async () => {
    const { mod } = await freshCache();
    mod.setCacheIdentity(ALICE);
    mod.setDataVersion('7');
    mod.setCached('years', ['2026']);

    expect(mod.setDataVersion('8')).toBe(false);
    expect(mod.getCached('years')).toBeUndefined();
  });

  it('the same version keeps it', async () => {
    const { storage } = await freshCache();
    storage.setItem(LS_KEY, JSON.stringify({
      version: '7', identity: ALICE,
      entries: { years: { value: ['2026'], time: Date.now() } }
    }));

    const { mod } = await freshCache(storage);
    mod.setCacheIdentity(ALICE);
    expect(mod.setDataVersion('7')).toBe(true);
    expect(mod.getCached('years')).toEqual(['2026']);
  });

  it('invalidate(prefix) still removes matching keys', async () => {
    const { mod } = await freshCache();
    mod.setCacheIdentity(ALICE);
    mod.setDataVersion('7');
    mod.setCached('home:2026', [1]);
    mod.setCached('years', ['2026']);

    mod.invalidate('home:');

    expect(mod.getCached('home:2026')).toBeUndefined();
    expect(mod.getCached('years')).toEqual(['2026']);
  });
});
