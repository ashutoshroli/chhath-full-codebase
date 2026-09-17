// ============ WHICH ANNOUNCEMENT HAS THIS VISITOR ALREADY SEEN? (audit PR-43) ============
//
// The popup used ONE global timestamp for "seen":
//
//     const SEEN_KEY = 'cpm_public_v4_popup_seen_at';
//     if (Date.now() - stored < 24h) return;   // show nothing
//
// So the suppression was not about a popup at all — it was about the popup FEATURE. Two
// consequences, both of which defeat the point of an announcement:
//
//   * the committee publishes an announcement, a visitor sees it, and an hour later the
//     committee publishes an URGENT one. Every visitor who saw the first is blind to the second
//     for 24 hours.
//   * the committee EDITS an announcement to correct a wrong date or a wrong time. Everybody who
//     saw the wrong version is suppressed, so the correction reaches nobody.
//
// Suppression is now per announcement AND per revision.
//
// WHY A CONTENT HASH FOR THE REVISION. The API (`?action=activePopups`) returns `popup_id`,
// `title` and `slides` and no revision or updated_at field, so there is nothing authoritative to
// key on. Hashing the content the visitor would actually SEE is the honest substitute: if what
// they would see is unchanged, they have seen it; if any of it changed, they have not. It also
// means an edit does not need a backend change to be noticed.

const STORE_KEY = 'cpm_public_v4_popup_seen';
export const SEEN_TTL_MS = 24 * 60 * 60 * 1000;
/** Keep the record small — a committee runs a handful of announcements, not thousands. */
const MAX_ENTRIES = 40;

export interface SeenRecord { [key: string]: number }

/**
 * A stable 32-bit hash of a string, as 8 hex characters.
 *
 * FNV-1a: tiny, dependency-free and deterministic. Not a security hash and does not need to be —
 * the only question it answers is "is this the same announcement text as last time", where a
 * collision costs one suppressed popup, not a vulnerability.
 */
export function contentHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** What the visitor would see, reduced to a key: the announcement's identity plus its content. */
export function popupKey(popup: { popup_id?: unknown; title?: unknown; slides?: unknown }): string {
  const id = (popup?.popup_id ?? '').toString().trim() || 'unknown';
  // Only the fields that are rendered. A field the visitor cannot see changing must not re-open
  // a popup they have already dismissed.
  const visible = JSON.stringify({ title: popup?.title ?? '', slides: popup?.slides ?? [] });
  return `${id}:${contentHash(visible)}`;
}

function read(storage: Pick<Storage, 'getItem'> | undefined): SeenRecord {
  try {
    const raw = storage?.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: SeenRecord = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const n = typeof v === 'number' ? v : parseInt(String(v), 10);
      if (Number.isFinite(n)) out[k] = n;
    }
    return out;
  } catch {
    // A corrupt or unavailable store must mean "show the announcement", never "throw". Failing
    // the other way would hide announcements, which is the thing this file exists to prevent.
    return {};
  }
}

/** True when this exact announcement, in this exact revision, was seen inside the window. */
export function wasSeenRecently(
  storage: Pick<Storage, 'getItem'> | undefined,
  popup: Parameters<typeof popupKey>[0],
  now: number = Date.now(),
): boolean {
  const at = read(storage)[popupKey(popup)];
  if (!Number.isFinite(at)) return false;
  // A clock that has moved backwards (timezone fix, manual change) must not suppress for ever.
  if (at > now) return false;
  return now - at < SEEN_TTL_MS;
}

/** Records this revision as seen, and prunes expired and excess entries. */
export function markSeen(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined,
  popup: Parameters<typeof popupKey>[0],
  now: number = Date.now(),
): SeenRecord {
  const current = read(storage);
  current[popupKey(popup)] = now;

  // Drop anything past the window; it can never suppress again.
  for (const [k, at] of Object.entries(current)) {
    if (now - at >= SEEN_TTL_MS) delete current[k];
  }
  // Then cap the size, newest kept. Without this, an edited-every-day announcement would grow
  // the record without limit — localStorage is a few megabytes and shared with the rest of the app.
  const entries = Object.entries(current).sort((a, b) => b[1] - a[1]).slice(0, MAX_ENTRIES);
  const pruned: SeenRecord = Object.fromEntries(entries);

  try {
    storage?.setItem(STORE_KEY, JSON.stringify(pruned));
  } catch {
    /* a full or blocked store just means this visitor sees it again — acceptable */
  }
  return pruned;
}

/** Test-only helper: the key used in localStorage. */
export const _STORE_KEY = STORE_KEY;
