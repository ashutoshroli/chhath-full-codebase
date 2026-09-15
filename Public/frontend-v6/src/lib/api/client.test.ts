// ====== AUDIT PUB-FE-01 — cached data must never look like live data ======
//
// Two problems, one theme: the portal could not tell where its own data came from.
//
//  1. Every usable response was stamped `savedAt: now()` and treated as fresh. The
//     service worker was configured NetworkFirst with a 6s timeout and a 24h cache,
//     so when the network missed that deadline workbox replayed a cached 200 — and
//     the client could not distinguish it from a live response. A transparency
//     portal then showed yesterday's contributions under a brand-new "last
//     updated" time, with no stale badge. (The SW rule is now NetworkOnly, so the
//     one cache that remains is ours and its age is known.)
//
//  2. `fetch` had no deadline and nothing deduped concurrent loads. The root
//     layout, the reconnect handler and the visibility handler could each start a
//     load, and whichever finished LAST won — even if it was the oldest request.
//
// PortalResult now carries `source: 'network' | 'snapshot' | 'empty'`, `savedAt` is
// only ever set by a real network response, requests time out, and one load is
// shared.

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

const SNAPSHOT_KEY = 'cpm_public_portalData_v4';

/** A payload `isUsable()` accepts: at least one collections row. */
const payload = (amount = 500) => ({
  collections: [{ Year: 2026, Name: 'USER0001', Amount: amount }],
  users: [],
  expenses: [],
  loans: [],
  generatedFiles: []
});

async function freshClient(storage = new MemoryStorage()) {
  vi.stubGlobal('localStorage', storage as unknown as Storage);
  vi.stubGlobal('location', { pathname: '/', search: '' } as unknown as Location);
  vi.stubGlobal('navigator', { userAgent: 'test', onLine: true } as unknown as Navigator);
  vi.resetModules();
  const mod = await import('./client');
  return { mod, storage };
}

/** Answers dataVersion then portalData; `portalBody` may be a thrower. */
function stubApi({
  version = '7',
  portal = payload(),
  portalFails = false,
  delayMs = 0
}: { version?: string; portal?: unknown; portalFails?: boolean; delayMs?: number } = {}) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = url.toString();
    calls.push(u);
    if (u.includes('dataVersion')) {
      return { ok: true, status: 200, json: async () => ({ v: version }) } as unknown as Response;
    }
    if (u.includes('logError')) return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    if (delayMs) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, delayMs);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }
    if (portalFails) throw new Error('network down');
    return { ok: true, status: 200, json: async () => portal } as unknown as Response;
  }));
  return calls;
}

describe('loadPortalData provenance (audit PUB-FE-01)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('marks a real network response as source=network and not stale', async () => {
    const { mod } = await freshClient();
    stubApi();

    const res = await mod.loadPortalData();

    expect(res.source).toBe('network');
    expect(res.stale).toBe(false);
    expect(res.savedAt).toBeGreaterThan(0);
    expect(res.version).toBe('7');
  });

  it('falls back to the saved copy as source=snapshot AND keeps its original age', async () => {
    const storage = new MemoryStorage();
    // A snapshot written eight hours ago.
    const eightHoursAgo = Date.now() - 8 * 60 * 60 * 1000;
    storage.setItem(SNAPSHOT_KEY, JSON.stringify({ savedAt: eightHoursAgo, version: '6', data: payload(100) }));

    const { mod } = await freshClient(storage);
    stubApi({ portalFails: true });

    const res = await mod.loadPortalData();

    expect(res.source).toBe('snapshot');
    expect(res.stale).toBe(true);
    // THE BUG: on main this became Date.now(), so eight-hour-old figures were
    // presented with a "just updated" timestamp and no stale badge.
    expect(res.savedAt).toBe(eightHoursAgo);
    expect(res.data.collections[0].Amount).toBe(100);
  });

  it('reports a cold failure as source=empty with savedAt 0', async () => {
    const { mod } = await freshClient();
    stubApi({ portalFails: true });

    const res = await mod.loadPortalData();

    expect(res.source).toBe('empty');
    expect(res.stale).toBe(true);
    expect(res.savedAt).toBe(0);
    expect(res.data.collections).toEqual([]);
  });

  it('honours the backend saying its own payload is stale', async () => {
    const { mod } = await freshClient();
    // The Worker serves a last-known-good KV snapshot when D1 is unavailable.
    stubApi({ portal: { ...payload(), stale: true } });

    const res = await mod.loadPortalData();

    expect(res.source).toBe('network');
    expect(res.stale).toBe(true);
  });

  it('writes a snapshot whose savedAt is the network fetch time', async () => {
    const { mod, storage } = await freshClient();
    stubApi();

    const res = await mod.loadPortalData();
    const stored = JSON.parse(storage.getItem(SNAPSHOT_KEY)!);

    expect(stored.savedAt).toBe(res.savedAt);
    expect(stored.version).toBe('7');
  });
});

describe('request deadline (audit PUB-FE-01)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('aborts a stalled request and falls back instead of hanging forever', async () => {
    const storage = new MemoryStorage();
    storage.setItem(SNAPSHOT_KEY, JSON.stringify({ savedAt: 111, version: '5', data: payload(42) }));
    const { mod } = await freshClient(storage);
    // Stalls far longer than the client's deadline.
    stubApi({ delayMs: mod.REQUEST_TIMEOUT_MS + 5_000 });

    vi.useFakeTimers();
    const pending = mod.loadPortalData();
    await vi.advanceTimersByTimeAsync(mod.REQUEST_TIMEOUT_MS + 100);
    const res = await pending;
    vi.useRealTimers();

    expect(res.source).toBe('snapshot');
    expect(res.savedAt).toBe(111);
  }, 20_000);

  it('exposes a sane deadline', async () => {
    const { mod } = await freshClient();
    expect(mod.REQUEST_TIMEOUT_MS).toBeGreaterThan(1_000);
    expect(mod.REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});

describe('one load at a time (audit PUB-FE-01)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shares one in-flight request between concurrent callers', async () => {
    const { mod } = await freshClient();
    const calls = stubApi({ delayMs: 20 });

    // The layout, the reconnect handler and the visibility handler all ask at once.
    const [a, b, c] = await Promise.all([
      mod.loadPortalData(),
      mod.loadPortalData(),
      mod.loadPortalData()
    ]);

    expect(a).toBe(b);
    expect(b).toBe(c);
    const portalCalls = calls.filter((u) => u.includes('portalData'));
    expect(portalCalls.length).toBe(1);
  });

  it('serves the in-memory result without refetching, and force bypasses it', async () => {
    const { mod } = await freshClient();
    const calls = stubApi();

    await mod.loadPortalData();
    await mod.loadPortalData();
    expect(calls.filter((u) => u.includes('portalData')).length).toBe(1);

    await mod.loadPortalData({ force: true });
    expect(calls.filter((u) => u.includes('portalData')).length).toBe(2);
  });
});
