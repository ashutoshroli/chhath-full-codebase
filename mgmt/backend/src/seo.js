// SEO / social link-preview settings.
//
// A Superadmin edits, in the management portal, the title / description /
// keywords / preview image shown for BOTH portals when their links are shared
// (WhatsApp, Facebook, X) or indexed by search engines. Those values are stored
// in portal_settings (core DB) and served to the frontends' build step, which
// bakes them into each portal's index.html at deploy time.
//
// WHY A REBUILD (and not client-side injection): social crawlers read only the
// initial HTML and never run JavaScript, so the only reliable way to change a
// link preview is to change the served HTML. After saving, the Superadmin
// presses "Publish", which calls the Vercel Deploy Hooks stored here and the
// portals rebuild with the new values.

import { requireSuperadmin, ValidationError } from './auth.js';
import { getPortalSetting, setPortalSetting } from './settings.js';
import { base64ToBytes, sniffImageMime } from './base64.js';
import { r2Available, putToR2, keyForSeo } from './r2.js';
import { uploadFileToDrive } from './account.js';

const MAX_SEO_IMAGE_BYTES = 8 * 1024 * 1024;

// portal_settings keys owned by this module. Grouped by portal.
const SEO_KEYS = {
  public: {
    title: 'seo_public_title',
    description: 'seo_public_description',
    keywords: 'seo_public_keywords',
    image: 'seo_public_image',
  },
  mgmt: {
    title: 'seo_mgmt_title',
    description: 'seo_mgmt_description',
    image: 'seo_mgmt_image',
  },
};

// Vercel Deploy Hook URLs (one per portal) are stored as settings too, so the
// Superadmin can paste them in without a redeploy of the Worker.
const DEPLOY_HOOK_KEYS = {
  public: 'seo_deploy_hook_public',
  mgmt: 'seo_deploy_hook_mgmt',
};

// ---- Read ----

// Returns the full settings object for the management UI (Superadmin only).
export async function getSeoSettings(env, user) {
  requireSuperadmin(user);
  return readAllSeo(env);
}

// Plain read with no auth — used by the PUBLIC endpoint below and by the public
// Worker's own build feed. Never returns the deploy-hook URLs.
export async function readAllSeo(env) {
  const [
    pTitle, pDesc, pKeywords, pImage,
    mTitle, mDesc, mImage,
    hookPublic, hookMgmt,
  ] = await Promise.all([
    getPortalSetting(env, SEO_KEYS.public.title),
    getPortalSetting(env, SEO_KEYS.public.description),
    getPortalSetting(env, SEO_KEYS.public.keywords),
    getPortalSetting(env, SEO_KEYS.public.image),
    getPortalSetting(env, SEO_KEYS.mgmt.title),
    getPortalSetting(env, SEO_KEYS.mgmt.description),
    getPortalSetting(env, SEO_KEYS.mgmt.image),
    getPortalSetting(env, DEPLOY_HOOK_KEYS.public),
    getPortalSetting(env, DEPLOY_HOOK_KEYS.mgmt),
  ]);
  return {
    public: { title: pTitle || '', description: pDesc || '', keywords: pKeywords || '', image: pImage || '' },
    mgmt: { title: mTitle || '', description: mDesc || '', image: mImage || '' },
    // Booleans only — the Superadmin sees whether a hook is configured, never the
    // secret URL itself echoed back to the browser.
    deployHooks: { publicConfigured: !!hookPublic, mgmtConfigured: !!hookMgmt },
  };
}

// ---- Write ----

// Saves the settings a Superadmin submitted. `payload` mirrors the shape of
// getSeoSettings. Deploy-hook URLs are only overwritten when a non-empty value
// is supplied, so leaving the field blank keeps the existing hook.
export async function saveSeoSettings(env, payload, user) {
  requireSuperadmin(user);
  const p = payload || {};
  const pub = p.public || {};
  const mgmt = p.mgmt || {};
  const hooks = p.deployHooks || {};

  const writes = [
    setPortalSetting(env, SEO_KEYS.public.title, str(pub.title), user),
    setPortalSetting(env, SEO_KEYS.public.description, str(pub.description), user),
    setPortalSetting(env, SEO_KEYS.public.keywords, str(pub.keywords), user),
    setPortalSetting(env, SEO_KEYS.public.image, str(pub.image), user),
    setPortalSetting(env, SEO_KEYS.mgmt.title, str(mgmt.title), user),
    setPortalSetting(env, SEO_KEYS.mgmt.description, str(mgmt.description), user),
    setPortalSetting(env, SEO_KEYS.mgmt.image, str(mgmt.image), user),
  ];
  // Only touch a deploy-hook setting when the Superadmin actually typed a URL.
  if (typeof hooks.publicUrl === 'string' && hooks.publicUrl.trim()) {
    writes.push(setPortalSetting(env, DEPLOY_HOOK_KEYS.public, validateHookUrl(hooks.publicUrl), user));
  }
  if (typeof hooks.mgmtUrl === 'string' && hooks.mgmtUrl.trim()) {
    writes.push(setPortalSetting(env, DEPLOY_HOOK_KEYS.mgmt, validateHookUrl(hooks.mgmtUrl), user));
  }
  await Promise.all(writes);
  return { success: true };
}

// Uploads the link-preview image and returns its public URL. Reuses the same
// validation as popup images (magic-number sniff, size cap, HEIC guard) so a
// non-image or an iPhone HEIC can never become a broken preview. R2 preferred,
// Drive as the fallback.
export async function uploadSeoImage(env, base64, fileName, user) {
  requireSuperadmin(user);
  if (!base64) throw ValidationError('An image is required.');

  const bytes = base64ToBytes(base64, { label: 'Image', maxBytes: MAX_SEO_IMAGE_BYTES });
  const sniffed = sniffImageMime(bytes);
  if (!sniffed) {
    throw ValidationError('This file is not an image (JPG, PNG, GIF or WebP is required).');
  }
  if (sniffed === 'image/heic') {
    throw ValidationError(
      'The iPhone HEIC format does not display in browsers. Save the photo as JPG and ' +
      'upload it (iPhone: Settings > Camera > Formats > Most Compatible).'
    );
  }

  const ext = sniffed.split('/')[1].replace('jpeg', 'jpg');
  const safeName = (fileName || '').toString().trim().replace(/[^\w.\-]+/g, '_').slice(0, 80)
    || `preview_${Date.now()}.${ext}`;

  if (r2Available(env)) {
    const key = keyForSeo(safeName);
    const imageUrl = await putToR2(env, key, bytes, sniffed);
    return { success: true, imageUrl, url: imageUrl };
  }
  const res = await uploadFileToDrive(env, base64, safeName, sniffed);
  const imageUrl = res.directUrl || res.url;
  return { success: true, imageUrl, url: imageUrl };
}

// ---- Publish (rebuild) ----

// Calls the configured Vercel Deploy Hook(s) so the portal(s) rebuild and pick
// up the freshly saved SEO settings. `target` is 'public', 'mgmt' or 'both'.
export async function triggerRebuild(env, target, user) {
  requireSuperadmin(user);
  const want = target === 'public' || target === 'mgmt' ? [target] : ['public', 'mgmt'];
  const results = {};
  for (const portal of want) {
    const url = await getPortalSetting(env, DEPLOY_HOOK_KEYS[portal]);
    if (!url) {
      results[portal] = { triggered: false, reason: 'No deploy hook configured' };
      continue;
    }
    try {
      const res = await fetch(url, { method: 'POST' });
      results[portal] = { triggered: res.ok, status: res.status };
    } catch (err) {
      results[portal] = { triggered: false, reason: (err && err.message) || 'Request failed' };
    }
  }
  const anyTriggered = Object.values(results).some((r) => r.triggered);
  return { success: anyTriggered, results };
}

// ---- helpers ----

function str(v) {
  return v == null ? '' : v.toString().slice(0, 5000);
}

// A deploy hook must be an https://api.vercel.com/... URL. Reject anything else
// so this setting can never be turned into a server-side request forgery vector.
function validateHookUrl(raw) {
  const url = raw.toString().trim();
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    throw ValidationError('The deploy hook must be a valid URL.');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.vercel.com') {
    throw ValidationError('The deploy hook must be an https://api.vercel.com/... URL from Vercel.');
  }
  return url;
}
