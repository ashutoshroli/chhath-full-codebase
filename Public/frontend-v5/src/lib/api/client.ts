/**
 * Read-only API client for the Chhath public Cloudflare Worker.
 *
 * Flow (mirrors the existing frontends, plus an intelligent client cache):
 *   1. GET ?action=dataVersion -> { v }         (cheap, cache-busting token)
 *   2. GET ?action=portalData&v=<v>             (full payload; ETag-cached at edge)
 *   3. On success: keep in memory + persist a localStorage snapshot.
 *   4. On failure/offline: fall back to the snapshot and mark it `stale`.
 *
 * The BACKEND IS UNCHANGED — this only reads the documented actions.
 */
import { config, apiUrl } from '$lib/config';
import { parsePortalData, isUsable, EMPTY_PORTAL_DATA, type PortalData } from './schema';

const SNAPSHOT_KEY = 'cpm_public_portalData_v4';
const VERSION_KEY = 'cpm_public_dataVersion_v4';
const MEMORY_TTL_MS = 60_000; // serve in-memory result without refetch for 1 min

export interface PortalResult {
  data: PortalData;
  /** true when served from a saved copy because the network failed/offline. */
  stale: boolean;
  /** epoch ms when this data was fetched/saved. */
  savedAt: number;
  /** the data version token this payload corresponds to (best effort). */
  version: string;
}

interface MemoryCache {
  result: PortalResult;
  fetchedAt: number;
}
let memory: MemoryCache | null = null;

function now() {
  return Date.now();
}

function readSnapshot(): PortalResult | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; version?: string; data?: unknown };
    const data = parsePortalData(parsed?.data);
    if (!data) return null;
    return { data, stale: true, savedAt: parsed.savedAt || 0, version: parsed.version || '' };
  } catch {
    return null;
  }
}

function writeSnapshot(result: PortalResult) {
  try {
    const payload = JSON.stringify({
      savedAt: result.savedAt,
      version: result.version,
      data: result.data
    });
    // Guard against pathological sizes (matches the existing 4MB cap intent).
    if (payload.length > 4_000_000) return;
    localStorage.setItem(SNAPSHOT_KEY, payload);
    if (result.version) localStorage.setItem(VERSION_KEY, result.version);
  } catch {
    /* storage disabled / quota — non-fatal */
  }
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init?.headers || {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchDataVersion(): Promise<string> {
  try {
    const vr = (await fetchJson(apiUrl('dataVersion'))) as { v?: unknown } | null;
    return vr && vr.v != null ? vr.v.toString() : '';
  } catch {
    return '';
  }
}

export interface LoadOptions {
  /** Bypass the in-memory TTL (used by the manual Refresh action). */
  force?: boolean;
}

/**
 * Load the portal data. Never throws: on any failure it returns the best
 * available snapshot (marked stale), or an empty-but-valid payload as a last
 * resort so the UI can render its empty states rather than crashing.
 */
export async function loadPortalData(opts: LoadOptions = {}): Promise<PortalResult> {
  // 1) Fresh-enough in-memory result.
  if (!opts.force && memory && now() - memory.fetchedAt < MEMORY_TTL_MS) {
    return memory.result;
  }

  try {
    const version = await fetchDataVersion();
    const vq = version ? `&v=${encodeURIComponent(version)}` : '';
    const raw = await fetchJson(apiUrl('portalData', vq));
    const data = parsePortalData(raw);

    if (!data || !isUsable(data)) {
      throw new Error('portalData returned no usable data');
    }

    const backendStale = data.stale === true;
    const result: PortalResult = {
      data,
      stale: backendStale,
      savedAt: now(),
      version
    };
    memory = { result, fetchedAt: now() };
    writeSnapshot({ ...result, stale: false }); // snapshot is authoritative, not stale
    return result;
  } catch (err) {
    reportError('portalData load failed', err);
    const snap = readSnapshot();
    if (snap) {
      memory = { result: snap, fetchedAt: now() };
      return snap;
    }
    // Cold failure: valid empty payload so the UI shows empty/error states.
    return { data: EMPTY_PORTAL_DATA, stale: true, savedAt: 0, version: '' };
  }
}

/** Popups are optional; failures are silent (feature simply doesn't show). */
export async function loadActivePopups(): Promise<unknown> {
  try {
    return await fetchJson(apiUrl('activePopups'));
  } catch {
    return [];
  }
}

/** Best-effort, deduped, fire-and-forget error reporting to the Worker. */
const reported = new Set<string>();
export function reportError(message: string, err?: unknown, extra?: Record<string, unknown>) {
  try {
    const msg = (message || '').toString().slice(0, 500);
    if (reported.has(msg)) return;
    reported.add(msg);
    const body = JSON.stringify({
      page: typeof location !== 'undefined' ? location.pathname + location.search : '',
      message: msg,
      stack: err instanceof Error && err.stack ? err.stack.slice(0, 2000) : '',
      context: JSON.stringify({
        ua: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 150) : '',
        ...(extra || {})
      }).slice(0, 500)
    });
    // Keep the request alive across navigations; ignore all failures.
    void fetch(apiUrl('logError'), { method: 'POST', body, keepalive: true }).catch(() => {});
  } catch {
    /* never let error reporting throw */
  }
}

export const chatUrl = config.renderChatUrl;
export const mgmtLoginUrl = config.mgmtLoginUrl;
