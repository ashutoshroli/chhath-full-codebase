/**
 * Theme → Skin registry (lazy).
 *
 * Many themes share one skin (Sunrise / Warm Night / Midnight are all the
 * Premium layout in different palettes). The themeId → skinId mapping lives in
 * the pure, unit-tested `skinMap.ts`; this module turns a skin id into the
 * actual component bundle.
 *
 * WHY THE IMPORTS HERE ARE DYNAMIC (audit PR-45)
 * ----------------------------------------------
 * This module used to `import` all five skins statically and hold them in a
 * plain object. `stores/skin.ts` imports this module, the root layout imports
 * that store, and every route imports it too — so all five skins, and (via each
 * skin's barrel `index.ts`) all eight pages of each, sat on the critical path
 * of every single page. Measured on the build before this PR: 583-603 kB of
 * JavaScript on first load out of 622 kB total, i.e. a visitor opening one page
 * in one skin downloaded ~96% of the app. SvelteKit's per-route splitting was
 * working correctly; a barrel import upstream of the routes made it pointless.
 *
 * The DEFAULT skin is deliberately NOT in this table. It is imported statically
 * — by the root layout for its Shell, and by each route for that route's page —
 * because it is what the prerendered HTML contains: the theme is only known in
 * the browser (localStorage / device preference / random, see app.html), so the
 * server can only ever render the default. Routing the default skin through a
 * dynamic barrel here would (a) add a needless request for the common case and
 * (b) drag all eight of its pages back onto every route. Keeping it static
 * means the majority of visitors make NO extra request for their skin at all,
 * and the prerendered body keeps its real content (audit PR-42).
 *
 * `Exclude<SkinId, typeof DEFAULT_SKIN_ID>` is not decoration: if the default
 * skin is ever changed in `skinMap.ts`, this table stops type-checking until
 * the old default is given a loader here, so the two cannot silently disagree.
 */
import type { Skin } from './types';
import { DEFAULT_SKIN_ID, type SkinId } from './skinMap';

/** Every skin except the default one, which is statically imported instead. */
export type LazySkinId = Exclude<SkinId, typeof DEFAULT_SKIN_ID>;

const LOADERS: Record<LazySkinId, () => Promise<Skin>> = {
  classic: () => import('./classic').then((m) => m.classicSkin),
  slate: () => import('./slate').then((m) => m.slateSkin),
  aurora: () => import('./aurora').then((m) => m.auroraSkin),
  festival: () => import('./festival').then((m) => m.festivalSkin),
  'surya-ghat': () => import('./surya-ghat').then((m) => m.suryaGhatSkin)
};

/** Does this skin need fetching, or is it the statically-bundled default? */
export function isLazySkin(id: SkinId): id is LazySkinId {
  return id !== DEFAULT_SKIN_ID;
}

/**
 * Wrap a loader table so each id is fetched at most once.
 *
 * Sharing the promise is not an optimisation, it is a correctness requirement:
 * the root layout asks for the Shell and the active route asks for one page, and
 * if those were two independent loads they could settle in different frames —
 * painting the new Shell around the previous skin's page.
 *
 * A REJECTED load is dropped from the cache. Caching the rejection would mean a
 * visitor who tapped a theme while briefly offline could never get that theme
 * again for the life of the tab.
 *
 * Exported so the caching and the retry-after-failure behaviour can be tested
 * with a loader that fails on demand; real dynamic imports cannot be made to
 * fail from a test.
 */
export function createSkinCache<Id extends string>(
  loaders: Record<Id, () => Promise<Skin>>
): (id: Id) => Promise<Skin> {
  const inFlight = new Map<Id, Promise<Skin>>();
  return (id: Id) => {
    let pending = inFlight.get(id);
    if (!pending) {
      pending = loaders[id]().catch((err: unknown) => {
        inFlight.delete(id);
        throw err;
      });
      inFlight.set(id, pending);
    }
    return pending;
  };
}

/** Load a non-default skin (Shell + all of its pages) as one chunk. */
export const loadSkin: (id: LazySkinId) => Promise<Skin> = createSkinCache(LOADERS);

/** Test seam: the skin ids this module can fetch. */
export const LAZY_SKIN_IDS = Object.keys(LOADERS) as LazySkinId[];
