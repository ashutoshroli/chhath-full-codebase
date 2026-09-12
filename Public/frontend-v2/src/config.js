
export const DEFAULTS = Object.freeze({
  PUBLIC_API_BASE: 'https://chhath-public-worker.shaharpura.com',
  PUBLIC_RENDER_CHAT_URL: 'https://chhath-server-render.onrender.com/public-chat',
  PUBLIC_MGMT_LOGIN_URL: 'https://mgmt-chhath.shaharpura.com/',
  PUBLIC_SITE_URL: 'https://chhath.shaharpura.com',
});

export function resolveConfig(env) {
  const e = env || {};
  const pick = (key) => {
    const v = e[key];
    return (v === undefined || v === null || String(v).trim() === '')
      ? DEFAULTS[key]
      : String(v);
  };
  return {
    apiBase: pick('PUBLIC_API_BASE'),
    renderChatUrl: pick('PUBLIC_RENDER_CHAT_URL'),
    mgmtLoginUrl: pick('PUBLIC_MGMT_LOGIN_URL'),
    siteUrl: pick('PUBLIC_SITE_URL'),
  };
}

const runtimeEnv =
  (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};

const resolved = resolveConfig(runtimeEnv);

export const apiBase = resolved.apiBase;
export const renderChatUrl = resolved.renderChatUrl;
export const mgmtLoginUrl = resolved.mgmtLoginUrl;
export const siteUrl = resolved.siteUrl;

export default resolved;
