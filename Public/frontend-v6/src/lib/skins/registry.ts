import type { Skin } from './types'; import { DEFAULT_SKIN_ID,type SkinId } from './skinMap';
export type LazySkinId=Exclude<SkinId,typeof DEFAULT_SKIN_ID>;
const LOADERS:Record<LazySkinId,()=>Promise<Skin>>={classic:()=>import('./classic').then(m=>m.classicSkin),slate:()=>import('./slate').then(m=>m.slateSkin),aurora:()=>import('./aurora').then(m=>m.auroraSkin),festival:()=>import('./festival').then(m=>m.festivalSkin),'kinetic-archive':()=>import('./kinetic-archive').then(m=>m.kineticArchiveSkin)};
export function isLazySkin(id:SkinId):id is LazySkinId{return id!==DEFAULT_SKIN_ID}
export function createSkinCache<Id extends string>(loaders:Record<Id,()=>Promise<Skin>>){const inFlight=new Map<Id,Promise<Skin>>();return(id:Id)=>{let p=inFlight.get(id);if(!p){p=loaders[id]().catch(e=>{inFlight.delete(id);throw e});inFlight.set(id,p)}return p}}
export const loadSkin:(id:LazySkinId)=>Promise<Skin>=createSkinCache(LOADERS);export const LAZY_SKIN_IDS=Object.keys(LOADERS) as LazySkinId[];
