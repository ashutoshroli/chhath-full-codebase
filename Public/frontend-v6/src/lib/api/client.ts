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

/** Where a payload actually came from (audit PUB-FE-01). */
export type PortalSource = 'network' | 'snapshot' | 'empty';

export interface PortalResult {
  data: PortalData;
  /** true when served from a saved copy because the network failed/offline. */
  stale: boolean;
  /**
   * epoch ms when this data was FETCHED FROM THE NETWORK.
   *
   * audit PUB-FE-01: this used to be stamped with `now()` on every successful
   * parse, so a payload replayed from a saved copy claimed to be current. It is
   * only ever set by a real network response now, and a snapshot keeps the
   * timestamp of the fetch that produced it — which is what lets the UI show a
   * truthful "last updated" and a stale badge.
   */
  savedAt: number;
  /** the data version token this payload corresponds to (best effort). */
  version: string;
  /** provenance of this payload; never inferred from `stale` alone. */
  source: PortalSource;
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
    return {
      data,
      stale: true,
      // The age of the ORIGINAL fetch, not of this read — see PortalResult.savedAt.
      savedAt: parsed.savedAt || 0,
      version: parsed.version || '',
      source: 'snapshot'
    };
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

/**
 * How long any single portal request may take before we give up and fall back to
 * the saved copy (audit PUB-FE-01). Without this, `fetch` had no deadline at all:
 * a connection that accepts and then stalls left the UI on its skeletons for as
 * long as the browser kept the socket open.
 */
export const REQUEST_TIMEOUT_MS = 12_000;

async function fetchJson(url: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(init?.headers || {}) }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Timed out after ${timeoutMs}ms for ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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

  // audit PUB-FE-01: one load at a time. The root layout starts a load while the
  // reconnect and visibility handlers can each start another, and every page
  // shares this one store — so the same payload was being fetched two or three
  // times over, and whichever response happened to land LAST won, even if it was
  // the oldest request. Callers now share the in-flight promise; a `force` refresh
  // deliberately supersedes it (the visitor asked for new data).
  if (!opts.force && inFlight) return inFlight;

  const request = runLoad();
  inFlight = request;
  try {
    return await request;
  } finally {
    // Only clear if a newer load has not already replaced it.
    if (inFlight === request) inFlight = null;
  }
}

let inFlight: Promise<PortalResult> | null = null;

async function runLoad(): Promise<PortalResult> {
  try {
    const version = await fetchDataVersion();
    const vq = version ? `&v=${encodeURIComponent(version)}` : '';
    const raw = await fetchJson(apiUrl('portalData', vq));
    const data = parsePortalData(raw);

    if (!data || !isUsable(data)) {
      throw new Error('portalData returned no usable data');
    }

    // The Worker itself can tell us it served a last-known-good KV snapshot
    // because D1 was unavailable — that is stale data even though the request
    // succeeded, so it must not be presented as live.
    const backendStale = data.stale === true;
    const result: PortalResult = {
      data,
      stale: backendStale,
      savedAt: now(),
      version,
      source: 'network'
    };
    memory = { result, fetchedAt: now() };
    // The snapshot records the network fetch it came from: same savedAt, and
    // `stale: false` because on disk it is simply "the last good payload" — it is
    // marked stale when it is READ back (see readSnapshot).
    writeSnapshot({ ...result, stale: false });
    return result;
  } catch (err) {
    reportError('portalData load failed', err);
    const snap = readSnapshot();
    if (snap) {
      // Cache the snapshot in memory too, but keep its ORIGINAL savedAt so the UI
      // can say how old the data really is.
      memory = { result: snap, fetchedAt: now() };
      return snap;
    }
    // Cold failure: valid empty payload so the UI shows empty/error states.
    return { data: EMPTY_PORTAL_DATA, stale: true, savedAt: 0, version: '', source: 'empty' };
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
    // `Content-Type: application/json` is required by the Worker (audit PUB-BE-06) and
    // is not cosmetic: without it this is a CORS *simple request*, which skips the
    // preflight, which is what let any page on the internet write to `error_log`.
    // Declaring JSON forces the preflight the origin allow-list is enforced in.
    //
    // The cost is one extra round-trip before an unload-time report, which the
    // Worker's `Access-Control-Max-Age: 86400` amortises across a browsing session.
    // A report lost at unload is a report lost; a writable log is a broken log.
    void fetch(apiUrl('logError'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true
    }).catch(() => {});
  } catch {
    /* never let error reporting throw */
  }
}

export const chatUrl = config.renderChatUrl;
export const mgmtLoginUrl = config.mgmtLoginUrl;
