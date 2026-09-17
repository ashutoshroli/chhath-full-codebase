// ====== PR-43 — announcements, orientation and the service worker ======
//
// THE ANNOUNCEMENT DEFECT. Suppression used ONE global timestamp:
//
//     const SEEN_KEY = 'cpm_public_v4_popup_seen_at';
//     if (Date.now() - stored < 24h) return;
//
// so it was not about a popup, it was about the popup FEATURE. Two consequences, both of which
// defeat the point of having announcements at all:
//
//   * the committee publishes one, a visitor sees it, and an hour later the committee publishes an
//     URGENT one — every visitor who saw the first is blind to the second for 24 hours;
//   * the committee EDITS one to correct a wrong date, and the correction reaches nobody who saw
//     the wrong version.
//
// Both are reproduced below against the old behaviour and then against the new.
//
// Two more items in this PR are configuration rather than logic and are asserted as such: the
// manifest locked the app to `orientation: 'portrait'` (WCAG 1.3.4, AA), and `sw.js` / `push-sw.js`
// had no Cache-Control at all, so how long a visitor stayed stuck on an old build was whatever the
// CDN felt like.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  contentHash, popupKey, wasSeenRecently, markSeen, SEEN_TTL_MS, _STORE_KEY,
} from './popupSuppression';

/** A minimal in-memory Storage, so the tests do not need a DOM. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    _map: map,
  };
}

const ANNOUNCE_A = { popup_id: 'CA-001', title: 'Aarti at 6pm', slides: [{ text: 'Ghat 1' }] };
const ANNOUNCE_B = { popup_id: 'CA-002', title: 'Route changed', slides: [{ text: 'Use the east gate' }] };
const ANNOUNCE_A_EDITED = { popup_id: 'CA-001', title: 'Aarti at 7pm', slides: [{ text: 'Ghat 1' }] };

const NOW = 1_800_000_000_000;

describe('PR-43: seeing one announcement does not hide the next', () => {
  let store: ReturnType<typeof fakeStorage>;
  beforeEach(() => { store = fakeStorage(); });

  it('a second, different announcement still shows', () => {
    markSeen(store, ANNOUNCE_A, NOW);
    expect(wasSeenRecently(store, ANNOUNCE_A, NOW + 1000)).toBe(true);
    // THE ASSERTION THAT FAILS ON `main`: one timestamp suppressed everything.
    expect(wasSeenRecently(store, ANNOUNCE_B, NOW + 1000),
      'an urgent announcement must reach someone who saw an earlier one').toBe(false);
  });

  it('an EDITED announcement counts as unseen', () => {
    markSeen(store, ANNOUNCE_A, NOW);
    expect(wasSeenRecently(store, ANNOUNCE_A_EDITED, NOW + 1000),
      'a correction must reach the people who saw the wrong version').toBe(false);
  });

  it('but the SAME announcement stays suppressed for the window, then returns', () => {
    markSeen(store, ANNOUNCE_A, NOW);
    expect(wasSeenRecently(store, ANNOUNCE_A, NOW + SEEN_TTL_MS - 1)).toBe(true);
    expect(wasSeenRecently(store, ANNOUNCE_A, NOW + SEEN_TTL_MS)).toBe(false);
  });

  it('a change the visitor cannot see does NOT re-open it', () => {
    // Otherwise any backend field churn would nag people who have already dismissed it.
    markSeen(store, ANNOUNCE_A, NOW);
    const sameToTheEye = { ...ANNOUNCE_A, internal_updated_at: 'later', some_flag: true };
    expect(wasSeenRecently(store, sameToTheEye, NOW + 1000)).toBe(true);
  });
});

describe('PR-43: the revision key', () => {
  it('is stable for identical content and different for changed content', () => {
    expect(popupKey(ANNOUNCE_A)).toBe(popupKey({ ...ANNOUNCE_A }));
    expect(popupKey(ANNOUNCE_A)).not.toBe(popupKey(ANNOUNCE_A_EDITED));
    expect(popupKey(ANNOUNCE_A)).not.toBe(popupKey(ANNOUNCE_B));
  });

  it('starts with the announcement id, so the record is readable', () => {
    expect(popupKey(ANNOUNCE_A).startsWith('CA-001:')).toBe(true);
  });

  it('a slide edit changes it, not just the title', () => {
    const slideEdited = { ...ANNOUNCE_A, slides: [{ text: 'Ghat 2' }] };
    expect(popupKey(slideEdited)).not.toBe(popupKey(ANNOUNCE_A));
  });

  it('a missing id still produces a usable key rather than throwing', () => {
    expect(popupKey({} as never)).toMatch(/^unknown:[0-9a-f]{8}$/);
  });

  it('the hash is deterministic and 8 hex chars', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'));
    expect(contentHash('abc')).toMatch(/^[0-9a-f]{8}$/);
    expect(contentHash('abc')).not.toBe(contentHash('abd'));
  });
});

describe('PR-43: the record cannot grow or corrupt its way into hiding announcements', () => {
  it('expired entries are pruned on write', () => {
    const store = fakeStorage();
    markSeen(store, ANNOUNCE_A, NOW);
    const after = markSeen(store, ANNOUNCE_B, NOW + SEEN_TTL_MS + 1);
    expect(Object.keys(after)).toEqual([popupKey(ANNOUNCE_B)]);
  });

  it('the record is capped, so a daily-edited announcement cannot grow it without limit', () => {
    const store = fakeStorage();
    let out = {};
    for (let i = 0; i < 60; i++) {
      out = markSeen(store, { popup_id: `CA-${i}`, title: `t${i}`, slides: [] }, NOW + i);
    }
    expect(Object.keys(out).length).toBeLessThanOrEqual(40);
  });

  it('corrupt storage means SHOW the announcement, never throw and never hide', () => {
    for (const bad of ['not json', '[]', 'null', '{"k":"NaN"}']) {
      const store = fakeStorage({ [_STORE_KEY]: bad });
      expect(() => wasSeenRecently(store, ANNOUNCE_A, NOW)).not.toThrow();
      expect(wasSeenRecently(store, ANNOUNCE_A, NOW)).toBe(false);
    }
  });

  it('a storage that throws is treated as empty', () => {
    const hostile = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(wasSeenRecently(hostile, ANNOUNCE_A, NOW)).toBe(false);
    expect(() => markSeen(hostile, ANNOUNCE_A, NOW)).not.toThrow();
  });

  it('a clock that jumped backwards does not suppress for ever', () => {
    const store = fakeStorage();
    markSeen(store, ANNOUNCE_A, NOW);
    // The device's clock is corrected to an earlier time; the stored stamp is now in the future.
    expect(wasSeenRecently(store, ANNOUNCE_A, NOW - 60_000)).toBe(false);
  });

  it('no storage at all (SSR) is safe', () => {
    expect(wasSeenRecently(undefined, ANNOUNCE_A, NOW)).toBe(false);
    expect(() => markSeen(undefined, ANNOUNCE_A, NOW)).not.toThrow();
  });
});

describe('PR-43: the component asks about THIS announcement, after fetching it', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/lib/components/AnnouncementPopup.svelte'), 'utf8');

  it('the single global timestamp key is gone', () => {
    expect(src, 'the old key suppressed the whole feature').not.toContain('cpm_public_v4_popup_seen_at');
  });

  it('the check happens after the popup is fetched, not before', () => {
    // The order matters and I got it wrong first: the old code could check before fetching only
    // because it was suppressing indiscriminately. Asking "have you seen THIS one?" before the
    // fetch means asking about `null`, which is always false — the popup would show every time.
    const fetchAt = src.indexOf('await loadActivePopups()');
    const checkAt = src.indexOf('wasSeenRecently(localStorage, p)');
    expect(fetchAt).toBeGreaterThan(-1);
    expect(checkAt, 'the seen-check must exist and use the fetched popup').toBeGreaterThan(fetchAt);
  });
});

describe('PR-43: the installed app is not locked to one orientation', () => {
  const cfg = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');

  it("the manifest no longer pins orientation to 'portrait'", () => {
    // WCAG 1.3.4 (AA): content must not be restricted to a single display orientation. A phone
    // clamped to a wheelchair arm is often fixed in landscape.
    expect(cfg).not.toMatch(/orientation:\s*'portrait'/);
    expect(cfg).toMatch(/orientation:\s*'any'/);
  });
});

describe('PR-43: a service worker is never cached', () => {
  const vercel = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'));

  it('sw.js / push-sw.js / workbox-*.js are must-revalidate', () => {
    const rule = vercel.headers.find((h: { source: string }) => /sw\|push-sw\|workbox/.test(h.source));
    expect(rule, 'without this the CDN decides how long a visitor stays on an old build').toBeTruthy();
    const cc = rule.headers.find((x: { key: string }) => x.key === 'Cache-Control');
    expect(cc.value).toMatch(/max-age=0/);
    expect(cc.value).toMatch(/must-revalidate/);
  });

  it('and that rule sits ABOVE the long-lived asset rules', () => {
    // Vercel applies the first matching rule; below the immutable rule it would never fire.
    const sources: string[] = vercel.headers.map((h: { source: string }) => h.source);
    const swIndex = sources.findIndex((s) => /sw\|push-sw\|workbox/.test(s));
    const immutableIndex = sources.findIndex((s) => s.includes('_app/immutable'));
    const assetIndex = sources.findIndex((s) => s.includes('webmanifest'));
    expect(swIndex).toBeGreaterThan(-1);
    expect(swIndex, 'ordering is the whole mechanism here').toBeLessThan(assetIndex);
    expect(immutableIndex, 'immutable only matches /_app/immutable, so it cannot shadow sw.js')
      .toBeLessThan(swIndex);
  });
});
