
export const DEFAULT_GTM_ID = 'GTM-N6BF7NP7';

export function resolveGtmId(env) {
  const e = env || {};
  const v = e.PUBLIC_GTM_ID;
  return (v === undefined || v === null || String(v).trim() === '')
    ? DEFAULT_GTM_ID
    : String(v).trim();
}
