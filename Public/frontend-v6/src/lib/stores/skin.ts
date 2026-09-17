import { derived, type Readable } from 'svelte/store';
import { themeId } from './theme';
import { skinIdForTheme, type SkinId } from '$lib/skins/skinMap';
import { isLazySkin, loadSkin } from '$lib/skins/registry';
import type { Skin, SkinPages, SkinShell } from '$lib/skins/types';

/** Which skin the selected theme maps to. Synchronous, cheap, SSR-safe. */
export const activeSkinId: Readable<SkinId> = derived(themeId, ($id) => skinIdForTheme($id));

/**
 * One piece of the active skin (its Shell, or one of its pages), with the
 * statically-imported DEFAULT skin's version as the value until — and unless —
 * a non-default skin's chunk arrives (audit PR-45).
 *
 * Four properties this shape gives us, all of which matter:
 *
 * 1. **Server rendering keeps working.** On the server `themeId` is always the
 *    default theme, so `isLazySkin` is false and the fallback is set
 *    SYNCHRONOUSLY. The prerendered HTML therefore still contains a fully
 *    rendered page, which is what the SEO work in PR-42 depends on. No
 *    `{#await}` skeleton, no empty body for crawlers.
 * 2. **A returning visitor never sees `undefined`.** Anyone who has used the
 *    theme gallery has their skin chosen before this store is even created, so
 *    the store's INITIAL value (third argument to `derived`) has to be the
 *    fallback — otherwise the layout would render `<undefined>` and the portal
 *    would be blank until the chunk landed.
 * 3. **No blank frame while a skin loads.** Nothing is set while the chunk is in
 *    flight, so the store keeps its previous value and the visitor keeps looking
 *    at a rendered portal rather than a hole. The cross-fade in the layout is
 *    keyed on the Shell that is actually rendered, so it fires when the swap
 *    really happens.
 * 4. **A late arrival cannot overwrite a newer choice.** If someone switches
 *    theme twice quickly, the first load's `then` is ignored via `live`.
 */
function lazySkinPart<T>(fallback: T, pick: (skin: Skin) => T): Readable<T> {
  return derived<Readable<SkinId>, T>(
    activeSkinId,
    ($id, set) => {
      if (!isLazySkin($id)) {
        set(fallback);
        return;
      }
      let live = true;
      void loadSkin($id).then(
        (skin) => {
          if (live) set(pick(skin));
        },
        () => {
          // The chunk did not arrive (offline, or a stale cached HTML pointing
          // at a hashed file that no longer exists). Staying on the default skin
          // is the right failure: the portal is fully usable, just not in the
          // chosen look. Swallowed rather than thrown because there is no
          // subscriber that could act on it.
        }
      );
      return () => {
        live = false;
      };
    },
    fallback
  );
}

/**
 * The Shell of the active skin, for the root layout.
 * `fallback` must be the DEFAULT skin's Shell, statically imported by the caller.
 */
export function skinShell(fallback: SkinShell): Readable<SkinShell> {
  return lazySkinPart(fallback, (skin) => skin.Shell);
}

/**
 * One page of the active skin, for that page's route.
 * `fallback` must be the DEFAULT skin's version of the SAME page, statically
 * imported by the route — that static import is what puts the page in the
 * route's own chunk instead of a shared one.
 */
export function skinPage<K extends keyof SkinPages>(
  page: K,
  fallback: SkinPages[K]
): Readable<SkinPages[K]> {
  return lazySkinPart(fallback, (skin) => skin.pages[page]);
}
