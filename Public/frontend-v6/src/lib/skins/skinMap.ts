/** Theme to complete skin mapping. */
export type SkinId='premium'|'classic'|'slate'|'aurora'|'festival'|'surya-ghat'|'kinetic-archive';
export const DEFAULT_SKIN_ID='premium' satisfies SkinId;
export const THEME_SKIN_ID:Record<string,SkinId>={sunrise:'premium','warm-night':'premium',midnight:'premium','classic-light':'classic','slate-light':'slate','slate-dark':'slate',aurora:'aurora',festival:'festival','neon-noir':'aurora','cyber-lime':'aurora','sunset-vapor':'aurora','mint-frost':'aurora','executive-pro':'slate','midnight-glass':'aurora','pastel-zen':'premium','heritage-serif':'festival','festival-dark':'festival','heritage-serif-dark':'festival','surya-ghat':'surya-ghat','kinetic-archive':'kinetic-archive'};
export function skinIdForTheme(themeId:string|null|undefined):SkinId{return(themeId&&THEME_SKIN_ID[themeId])||DEFAULT_SKIN_ID}
