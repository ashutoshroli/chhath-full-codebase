// @vitest-environment jsdom
/**
 * The lazy skin loaders, against the REAL skin modules (audit PR-45).
 *
 * The critical-path test proves the skins are off the first-load graph. This one
 * proves they are still reachable and still complete — a split that drops a page
 * would be a worse bug than the weight it saves, and the compiler cannot see it
 * any more now that the barrel imports are gone.
 */
import { describe, it, expect } from 'vitest';
import {
  LAZY_SKIN_IDS,
  createSkinCache,
  isLazySkin,
  loadSkin,
  type LazySkinId
} from './registry';
import type { Skin } from './types';
import { DEFAULT_SKIN_ID, THEME_SKIN_ID, skinIdForTheme, type SkinId } from './skinMap';

/** The eight pages every skin must provide (mirrors SkinPages in types.ts). */
const PAGE_IDS = [
  'Home',
  'Expenses',
  'Loans',
  'Committee',
  'Downloads',
  'Decade',
  'Donate',
  'Verify'
].sort();

const ALL_SKIN_IDS = [...new Set(Object.values(THEME_SKIN_ID))].sort();

describe('which skins are lazy', () => {
  it('covers every skin except the default one', () => {
    expect([...LAZY_SKIN_IDS].sort()).toEqual(ALL_SKIN_IDS.filter((id) => id !== DEFAULT_SKIN_ID));
  });

  it('the default skin is not lazy — it is statically bundled and prerendered', () => {
    expect(isLazySkin(DEFAULT_SKIN_ID)).toBe(false);
  });

  it('every other skin is lazy', () => {
    for (const id of ALL_SKIN_IDS) {
      if (id === DEFAULT_SKIN_ID) continue;
      expect(isLazySkin(id as SkinId), id).toBe(true);
    }
  });

  it('every theme maps to a skin that is either the default or loadable', () => {
    // A theme mapping to a skin with no loader would leave those visitors stuck
    // on the default skin forever, silently.
    for (const theme of Object.keys(THEME_SKIN_ID)) {
      const skin = skinIdForTheme(theme);
      const ok = skin === DEFAULT_SKIN_ID || LAZY_SKIN_IDS.includes(skin as LazySkinId);
      expect(ok, `${theme} -> ${skin}`).toBe(true);
    }
  });
});

describe('loading a lazy skin', () => {
  for (const id of LAZY_SKIN_IDS) {
    // Generous timeout: the first of these compiles a skin's Shell and all eight
    // of its pages from source, which is exactly the work this PR moved off the
    // critical path.
    it(`${id} resolves to a complete skin`, { timeout: 30_000 }, async () => {
      const skin = await loadSkin(id);
      expect(skin.id).toBe(id);
      expect(typeof skin.Shell).toBe('function');
      expect(Object.keys(skin.pages).sort()).toEqual(PAGE_IDS);
      for (const page of PAGE_IDS) {
        expect(typeof skin.pages[page as keyof typeof skin.pages], `${id}.${page}`).toBe('function');
      }
    });
  }

  it('is fetched once, not once per asker', () => {
    // The root layout asks for the Shell and the route asks for a page. If those
    // were two requests they could also resolve in different frames, painting the
    // new Shell around the old page.
    const first = loadSkin('aurora');
    expect(loadSkin('aurora')).toBe(first);
  });

  it('gives every skin a distinct Shell', { timeout: 30_000 }, async () => {
    const shells = await Promise.all(LAZY_SKIN_IDS.map((id) => loadSkin(id).then((s) => s.Shell)));
    expect(new Set(shells).size).toBe(LAZY_SKIN_IDS.length);
  });
});

describe('the load cache', () => {
  const skin = (id: string) => ({ id, Shell: () => undefined, pages: {} }) as unknown as Skin;

  it('calls a loader once, however many times it is asked', async () => {
    let calls = 0;
    const load = createSkinCache({
      a: () => {
        calls += 1;
        return Promise.resolve(skin('a'));
      }
    });
    const first = load('a');
    expect(load('a')).toBe(first);
    await first;
    await load('a');
    expect(calls).toBe(1);
  });

  it('does not cache a failure — a theme picked while offline is not lost forever', async () => {
    let attempt = 0;
    const load = createSkinCache({
      a: () => {
        attempt += 1;
        return attempt === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(skin('a'));
      }
    });
    await expect(load('a')).rejects.toThrow('offline');
    await expect(load('a')).resolves.toHaveProperty('id', 'a');
    expect(attempt).toBe(2);
  });
});
