// @vitest-environment jsdom
/**
 * How the skin stores behave while a chunk is in flight (audit PR-45).
 *
 * Making the skins lazy introduces a state that did not exist before: "the
 * visitor's skin is chosen but has not arrived yet". Everything that can go
 * wrong with this feature lives in that gap — a blank frame, an empty
 * prerendered page, a stale skin winning a race, an offline visitor stuck with
 * nothing. The loader is mocked here so those moments can actually be held
 * still and inspected; `skins/lazy.test.ts` covers the real modules.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

const h = vi.hoisted(() => {
  interface Deferred {
    promise: Promise<unknown>;
    resolve: (skin: unknown) => void;
    reject: (err: unknown) => void;
  }
  const pending = new Map<string, Deferred>();
  const calls: string[] = [];
  return { pending, calls };
});

vi.mock('$lib/skins/registry', () => ({
  isLazySkin: (id: string) => id !== 'premium',
  LAZY_SKIN_IDS: ['classic', 'slate', 'aurora', 'festival'],
  loadSkin: (id: string) => {
    h.calls.push(id);
    let existing = h.pending.get(id);
    if (!existing) {
      let resolve!: (v: unknown) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<unknown>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      existing = { promise, resolve, reject };
      h.pending.set(id, existing);
    }
    return existing.promise;
  }
}));

import { skinShell, skinPage, activeSkinId } from './skin';
import { themeId } from './theme';
import type { SkinShell } from '$lib/skins/types';

/** Stand-in components: identity is all these tests compare. */
const fake = (name: string) => Object.assign(() => undefined, { fakeName: name });
const DEFAULT_SHELL = fake('premium/Shell') as unknown as SkinShell;
const DEFAULT_HOME = fake('premium/Home') as never;

function skinFor(id: string) {
  return {
    id,
    Shell: fake(`${id}/Shell`),
    pages: {
      Home: fake(`${id}/Home`),
      Expenses: fake(`${id}/Expenses`),
      Loans: fake(`${id}/Loans`),
      Committee: fake(`${id}/Committee`),
      Downloads: fake(`${id}/Downloads`),
      Decade: fake(`${id}/Decade`),
      Donate: fake(`${id}/Donate`),
      Verify: fake(`${id}/Verify`)
    }
  };
}

/** Let queued promise callbacks run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

/**
 * Subscribe, and drop the subscription when the test ends. A leaked subscriber
 * is not cosmetic here: these stores only load a skin WHILE subscribed, so a
 * store left alive by an earlier test reacts to this test's theme changes and
 * makes its own load requests. (The first version of this file leaked, and the
 * "one request between the layout and the route" assertion saw six.)
 */
const unsubs: Array<() => void> = [];
function sub<T>(store: { subscribe: (fn: (v: T) => void) => () => void }, fn?: (v: T) => void) {
  unsubs.push(store.subscribe((v) => fn?.(v)));
  return store;
}

beforeEach(() => {
  h.pending.clear();
  h.calls.length = 0;
  themeId.select('sunrise'); // maps to the default skin
});

afterEach(() => {
  while (unsubs.length) unsubs.pop()!();
});

describe('activeSkinId', () => {
  it('follows the selected theme', () => {
    expect(get(activeSkinId)).toBe('premium');
    themeId.select('aurora');
    expect(get(activeSkinId)).toBe('aurora');
    themeId.select('slate-dark');
    expect(get(activeSkinId)).toBe('slate');
  });
});

describe('the default skin needs no loading', () => {
  it('a subscriber gets the fallback synchronously — this is what prerendering renders', () => {
    const seen: unknown[] = [];
    sub(skinShell(DEFAULT_SHELL), (v) => seen.push(v));
    // Synchronously, on the FIRST notification. Anything later means the server
    // would render an empty shell and PR-42's crawler content would be gone.
    expect(seen[0]).toBe(DEFAULT_SHELL);
  });

  it('does not ask the network for a skin that is already in the bundle', () => {
    sub(skinShell(DEFAULT_SHELL));
    sub(skinPage('Home', DEFAULT_HOME));
    expect(h.calls).toEqual([]);
  });
});

describe('a returning visitor whose saved theme is NOT the default skin', () => {
  it('gets the default component as the very first value, not undefined', () => {
    // This is the common case for anyone who has ever used the theme gallery:
    // app.html reads their saved theme before first paint, so the store is
    // CREATED with a lazy skin already selected and nothing loaded yet. If the
    // first value were undefined, the layout would try to render `<undefined>`
    // and the whole portal would be a blank page until the chunk landed.
    themeId.select('aurora');
    const seen: unknown[] = [];
    sub(skinShell(DEFAULT_SHELL), (v) => seen.push(v));
    expect(seen).toEqual([DEFAULT_SHELL]);
    expect(seen[0]).not.toBeUndefined();
  });

  it('gets the default page as the very first value too', () => {
    themeId.select('festival');
    const seen: unknown[] = [];
    sub(skinPage('Verify', DEFAULT_HOME), (v) => seen.push(v));
    expect(seen).toEqual([DEFAULT_HOME]);
  });
});

describe('a non-default skin', () => {
  it('keeps showing the default until the chunk arrives, then swaps once', async () => {
    const seen: unknown[] = [];
    const store = skinShell(DEFAULT_SHELL);
    sub(store, (v) => seen.push(v));
    expect(seen).toEqual([DEFAULT_SHELL]);

    themeId.select('aurora');
    // Still the default: no blank frame, no flash of nothing.
    expect(get(store)).toBe(DEFAULT_SHELL);
    expect(seen).toEqual([DEFAULT_SHELL]);

    const aurora = skinFor('aurora');
    h.pending.get('aurora')!.resolve(aurora);
    await settle();

    expect(get(store)).toBe(aurora.Shell);
    expect(seen).toEqual([DEFAULT_SHELL, aurora.Shell]);
  });

  it('resolves the Shell and the page from the same skin, off one request', async () => {
    const shell = skinShell(DEFAULT_SHELL);
    const page = skinPage('Home', DEFAULT_HOME);
    sub(shell);
    sub(page);

    themeId.select('festival');
    expect(h.calls).toEqual(['festival', 'festival']); // both asked
    expect(h.pending.size).toBe(1); // one promise between them

    const festival = skinFor('festival');
    h.pending.get('festival')!.resolve(festival);
    await settle();

    expect(get(shell)).toBe(festival.Shell);
    expect(get(page)).toBe(festival.pages.Home);
  });

  it('gives each route its own page, not whichever page asked first', async () => {
    const home = skinPage('Home', DEFAULT_HOME);
    const verify = skinPage('Verify', DEFAULT_HOME);
    sub(home);
    sub(verify);
    themeId.select('slate-dark');
    const slate = skinFor('slate');
    h.pending.get('slate')!.resolve(slate);
    await settle();
    expect(get(home)).toBe(slate.pages.Home);
    expect(get(verify)).toBe(slate.pages.Verify);
  });

  it('returns to the default synchronously when a default-skin theme is chosen', async () => {
    const store = skinShell(DEFAULT_SHELL);
    sub(store);
    themeId.select('aurora');
    h.pending.get('aurora')!.resolve(skinFor('aurora'));
    await settle();
    expect(get(store)).not.toBe(DEFAULT_SHELL);

    themeId.select('midnight'); // -> premium
    expect(get(store)).toBe(DEFAULT_SHELL); // no await: it is already loaded
  });
});

describe('races and failures', () => {
  it('a slow earlier skin cannot overwrite a newer choice', async () => {
    const store = skinShell(DEFAULT_SHELL);
    sub(store);

    themeId.select('aurora');
    themeId.select('festival');

    const festival = skinFor('festival');
    const aurora = skinFor('aurora');
    // Festival (what the visitor actually wants) lands first; aurora — abandoned
    // two clicks ago — arrives afterwards and must be ignored.
    h.pending.get('festival')!.resolve(festival);
    await settle();
    h.pending.get('aurora')!.resolve(aurora);
    await settle();

    expect(get(store)).toBe(festival.Shell);
  });

  it('switching away and back still ends on the chosen skin', async () => {
    const store = skinShell(DEFAULT_SHELL);
    sub(store);
    themeId.select('aurora');
    themeId.select('sunrise');
    themeId.select('aurora');
    h.pending.get('aurora')!.resolve(skinFor('aurora'));
    await settle();
    expect((get(store) as unknown as { fakeName: string }).fakeName).toBe('aurora/Shell');
  });

  it('a chunk that never arrives leaves a usable portal on the default skin', async () => {
    const store = skinShell(DEFAULT_SHELL);
    sub(store);
    themeId.select('classic-light');
    h.pending.get('classic')!.reject(new Error('offline'));
    await settle();
    // Not a crash, not an empty screen: the wrong LOOK is the acceptable failure.
    expect(get(store)).toBe(DEFAULT_SHELL);
  });

  it('a visitor who was offline when they picked a theme can get it later', async () => {
    const store = skinShell(DEFAULT_SHELL);
    sub(store);
    themeId.select('classic-light');
    h.pending.get('classic')!.reject(new Error('offline'));
    await settle();
    expect(get(store)).toBe(DEFAULT_SHELL);

    // Back online, they select it again. The registry's own retry behaviour is
    // asserted against real code in skins/lazy.test.ts; what matters here is that
    // the store asks again rather than sitting on the failure.
    h.pending.delete('classic');
    themeId.select('sunrise');
    themeId.select('classic-light');
    const classic = skinFor('classic');
    h.pending.get('classic')!.resolve(classic);
    await settle();
    expect(get(store)).toBe(classic.Shell);
  });
});
