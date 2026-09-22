/** Lazy theme → skin registry. The default premium skin stays statically bundled. */
import type { Skin } from './types';
import { DEFAULT_SKIN_ID, type SkinId } from './skinMap';

export type LazySkinId = Exclude<SkinId, typeof DEFAULT_SKIN_ID>;

const LOADERS: Record<LazySkinId, () => Promise<Skin>> = {
  classic: () => import('./classic').then((m) => m.classicSkin),
  slate: () => import('./slate').then((m) => m.slateSkin),
  aurora: () => import('./aurora').then((m) => m.auroraSkin),
  festival: () => import('./festival').then((m) => m.festivalSkin),
  'surya-ghat': () => import('./surya-ghat').then((m) => m.suryaGhatSkin)
};

export function isLazySkin(id: SkinId): id is LazySkinId { return id !== DEFAULT_SKIN_ID; }

export function createSkinCache<Id extends string>(loaders: Record<Id, () => Promise<Skin>>): (id: Id) => Promise<Skin> {
  const inFlight = new Map<Id, Promise<Skin>>();
  return (id: Id) => {
    let pending = inFlight.get(id);
    if (!pending) {
      pending = loaders[id]().catch((err: unknown) => { inFlight.delete(id); throw err; });
      inFlight.set(id, pending);
    }
    return pending;
  };
}

export const loadSkin: (id: LazySkinId) => Promise<Skin> = createSkinCache(LOADERS);
export const LAZY_SKIN_IDS = Object.keys(LOADERS) as LazySkinId[];
