import { login, loginWithGoogle, doLogout, withAuth, withApiKey, verifyToken, requireSuperadmin, requireAdminOrAbove, requireStaffRole, getLockedYearsSet, lockYear, unlockYear, getMySessions, revokeSession, revokeAllOtherSessions, getUserSessions, revokeUserSession, getLoginAttempts, getLockedAccounts, revokeLock, revokeAllLocks } from './auth.js';
import { getSheetDataAsJSON, saveRecord, updateRecordByIdx, deleteRecordByIdx } from './crud.js';
import { importCsvRows } from './csvImport.js';
import { parseCookies, buildSessionCookies, buildClearCookies, SESSION_COOKIE, CSRF_COOKIE, CSRF_HEADER } from './cookies.js';
import { getYears, addYear, getHomeData, getLoansData, getExpensesData, getCommitteeData, getUserHistory, getYearContributors, getUserProfile } from './views.js';
import { getLoginUsers, addLoginUser, updateLoginUser, deleteLoginUser, updateOwnProfile, changePassword, uploadFileToDrive } from './account.js';
import { getDropdownList, getAllDropdownLists, addDropdownListItem, updateDropdownListItem, deleteDropdownListItem } from './dropdownLists.js';
import { getFestivalDates, saveFestivalDates, getPortalSetting, setPortalSetting, getConsentPageTemplate, updateConsentPageTemplate } from './settings.js';
import * as seo from './seo.js';
import * as wa from './whatsapp.js';
import { logError, reportErrorToWhatsApp, getErrorLog, reportErrorPublic, isLogErrorRateLimited } from './errorLog.js';
import { logActivity, getActivityLog, logWarn, logErrorAt } from './logger.js';
import * as popups from './popups.js';
import * as announce from './announcements.js';
import * as loans from './loans.js';
import * as tpl from './templates.js';
import * as docx from './docxTemplates.js';
import * as storage from './storage.js';
import * as backup from './backup.js';
import * as cq from './collectionQueue.js';
import * as email from './email.js';
import * as officialMail from './officialMail.js';
import { cleanupData, cleanupPreview } from './cleanup.js';
import { generateAiFix, getAiFixes, getAiFix, createAiFixPr } from './aiFix.js';
import { verifyGithubSignature, handleCheckSuiteEvent } from './aiFixCi.js';
import { getAiProviders, saveAiProvider, deleteAiProvider, setDefaultAiProvider, testAiProvider } from './aiConfig.js';
import { bumpDataVersion, getDataVersion } from './dataVersion.js';
import { healthCheck } from './config.js';
import { runRetentionSweep, shouldSweepNow } from './retention.js';

// Actions that only READ — after any OTHER successful action we bump the public
// data-version counter so the Public portal's ETag changes and cached copies are
// revalidated. Keeping the READ list (rather than a WRITE list) is the safe
// default: a new action that isn't listed here is treated as a write and simply
// causes one extra (harmless) public revalidation. Anything that can change data
// the public portal renders MUST NOT be added here.
//
// audit Q-8 — the report asked to INVERT this to an allowlist of writes. That was
// NOT done, and deliberately: for THIS use (deciding whether to bump the public
// data-version) the read-list is the fail-SAFE default. A forgotten READ costs one
// harmless extra revalidation; a forgotten WRITE — the dangerous case — is
// impossible, because "write" is the default. Inverting would flip that: a forgotten
// write would then NOT bump the version and the public portal would serve STALE data
// under a matching ETag. So the fix for the real Q-8 risk ("a new action is silently
// misclassified") is not inversion but a DRIFT GUARD: `READ_ONLY_ACTIONS` and
// `EXPECTED_MUTATING_ACTIONS` are exported and a test (see q8-action-classification)
// asserts every handler the router actually exposes is consciously listed in exactly
// one of the two. A new action that nobody classified fails CI instead of silently
// taking a default.
export const READ_ONLY_ACTIONS = new Set([
  'logout',
  'getYears', 'getUsers', 'getCommittee', 'getHome', 'getExpenses', 'getLoans', 'getLoanBudget',
  'getDataVersion',
  'getUserHistory', 'getUserProfile', 'getYearContributors', 'getLockedYears',
  'getLoginUsers',
  'getPersonTemplates', 'getGroupTemplates', 'getWhatsappGroups', 'getMessageLog',
  'getDropdownList', 'getAllDropdownLists',
  'getConsentByToken', 'getLoanConsents', 'getConsentsForReview',
  'getFestivalDates', 'getPortalSetting', 'getConsentPageTemplate',
  'getReceiptTemplates', 'getReceiptTemplate', 'getReceiptData',
  'getCertificateTemplates', 'getCertificateTemplate', 'getCertificateData',
  'getSamaanTemplates', 'getSamaanTemplate', 'getSamaanData',
  'getDocxTemplates', 'getDocxTemplate', 'getDocxTemplateForDoc', 'getDocxTemplatePublic',
  'getRecordsForDocType', 'getGeneratedFilesForYear', 'searchUsersByVillageAndName', 'getPersonDownloads',
  'getStorageOverview',
  'exportBackup',
  'getCollectionQueueStatus', 'getQueueJobsForSuperadmin',
  'getPopups', 'getPopupWithSlides', 'getActivePopups', 'previewPublicPopups',
  'reportErrorToWhatsApp', 'reportErrorPublic', 'getErrorLog',
  'getAiFixes', 'getAiFix',
  // AI Management: getAiProviders reads; testAiProvider makes an external ping but
  // writes no data (so it's read-only for the version-bump classifier).
  'getAiProviders', 'testAiProvider',
  'getActivityLog', 'getLoginAttempts', 'getLockedAccounts', 'getMySessions', 'getUserSessions',
  'getLoanTemplates',
  'getPendingMessages', 'getStuckMessages',
  'getEmailTemplates', 'getStuckEmails', 'getLoanEmailTemplates', 'getEmailLog',
  'listOfficialEmails', 'getOfficialEmail', 'cleanupPreview',
  'whatsappDiagnostic',
  'getAnnouncementLinks', 'getCustomAnnouncements', 'getAnnouncementQueue',
  'publicGetSeo', 'getSeoSettings',
  // OTP request/verify only touch consent-flow state, not public-portal data.
  'requestConsentOtp', 'verifyConsentOtp', 'verifyAnnouncementPin',
]);

// audit Q-8 — the EXPLICIT list of every router action that DOES change data (or
// otherwise must be treated as a write). This is not consulted at runtime — the
// runtime rule is still "not in READ_ONLY_ACTIONS => bump the version", which stays
// fail-safe. Its only job is to make classification a CONSCIOUS act: the drift-guard
// test asserts that the router's actual handler keys are exactly
// READ_ONLY_ACTIONS ∪ EXPECTED_MUTATING_ACTIONS, with no overlap and nothing left
// unclassified. Add a new action here (or to READ_ONLY_ACTIONS) or CI fails.
export const EXPECTED_MUTATING_ACTIONS = new Set([
  // auth / session mutations
  'login', 'verifyGoogleLogin', 'changePassword', 'updateOwnProfile',
  'revokeSession', 'revokeAllOtherSessions', 'revokeUserSession',
  'revokeLock', 'revokeAllLocks',
  // login-user management
  'addLoginUser', 'updateLoginUser', 'deleteLoginUser',
  // years
  'lockYear', 'unlockYear', 'addYear',
  // generic CRUD
  'saveRecord', 'updateRecord', 'deleteRecord',
  // collections queue / announce
  'queueCollectionMessages', 'importCsvRows', 'enqueueCollectionJob',
  'processCollectionQueue', 'retryQueueJob', 'markAnnounced', 'reannounceAll',
  // loans
  'saveLoan', 'deleteLoan', 'markLoanDisbursed', 'replaceGuarantor',
  // consent flow mutations
  'resendConsent', 'respondConsent', 'setConsentVerification', 'setPortalSetting',
  'updateConsentPageTemplate',
  // festival dates / portal settings
  'saveFestivalDates',
  // dropdown lists
  'addDropdownListItem', 'updateDropdownListItem', 'deleteDropdownListItem',
  // whatsapp groups + templates
  'addWhatsappGroup', 'updateWhatsappGroup', 'deleteWhatsappGroup',
  'addGroupTemplate', 'updateGroupTemplate', 'deleteGroupTemplate',
  'addPersonTemplate', 'updatePersonTemplate', 'deletePersonTemplate',
  'addLoanTemplate', 'updateLoanTemplate', 'deleteLoanTemplate',
  'resendMessage', 'updateMessageStatus',
  // email (Resend) templates + queue
  'addEmailTemplate', 'updateEmailTemplate', 'deleteEmailTemplate', 'resendEmail',
  'addLoanEmailTemplate', 'updateLoanEmailTemplate', 'deleteLoanEmailTemplate',
  // official mailbox (send/reply/mark-read; inbound is the public webhook route above)
  'sendOfficialEmail', 'replyOfficialEmail', 'markOfficialEmailRead',
  'cleanupData',
  // AI auto-fix — generateAiFix inserts an ai_fixes row; createAiFixPr commits +
  // opens a PR and updates the row. Both are writes (getAiFixes/getAiFix are
  // reads in READ_ONLY_ACTIONS).
  'generateAiFix', 'createAiFixPr',
  // logError is now authenticated (Fix #1 security hardening) and writes to
  // error_log; it belongs here. The unauthenticated public variant is
  // reportErrorPublic in READ_ONLY_ACTIONS.
  'logError',
  // AI Management: these write the ai_providers table.
  'saveAiProvider', 'deleteAiProvider', 'setDefaultAiProvider',
  // announcements
  'addCustomAnnouncement', 'updateCustomAnnouncement', 'deleteCustomAnnouncement',
  'generateAnnouncementLink', 'revokeAnnouncementLink',
  // docx / receipt / certificate / samaan templates (uploads + copies + saves)
  'uploadDocxTemplate', 'copyDocxTemplate', 'deleteDocxTemplate',
  'saveReceiptTemplate', 'copyReceiptTemplate', 'deleteReceiptTemplate',
  'saveCertificateTemplate', 'copyCertificateTemplate', 'deleteCertificateTemplate',
  'saveSamaanTemplate', 'copySamaanTemplate', 'deleteSamaanTemplate',
  // popups
  'savePopup', 'savePopupSlides', 'deletePopup', 'uploadPopupImage',
  // seo
  'saveSeoSettings', 'uploadSeoImage',
  // files / drive / backup / rebuild
  'uploadFile', 'moveYearToDrive', 'restoreBackup', 'triggerRebuild',
  // pdf conversion (writes generated files to the index / drive)
  'convertDocxToPdf', 'convertDocxToPdfBulk', 'convertDocxToPdfPublic',
]);

// ============ RESPONSE CACHE (Phase 2 scalability) ============
//
// Goal: let the mgmt API serve hundreds of req/sec without hammering D1, by
// caching the responses of a SMALL, EXPLICIT set of read actions whose data is
// SHARED (identical for every caller) and changes rarely.
//
// SAFETY — why this cannot leak one admin's data to another:
//   * Only the actions in CACHEABLE_ACTIONS below are cached. Every one returns
//     data that is the SAME for any caller (year aggregates, the users list, a
//     given person's history/profile keyed by that person's id, config lists).
//     Nothing session-specific, nothing role-filtered, no personal/Superadmin-only
//     list is cached.
//   * The cache is consulted ONLY AFTER withAuth has verified the session (see the
//     dispatch below). Auth/permission is never served from cache — a logged-out
//     or wrong-role caller never reaches the cache read.
//   * The cache key includes the action, its distinguishing params, AND the global
//     data-version counter. Any write bumps that counter (bumpDataVersion), so a
//     data change instantly makes every old key unreachable — stale data is
//     impossible. A short TTL is a second safety net.
//   * If a cached action ever needed role-dependent output, its key MUST include
//     the role. None currently do (that's why they're in the list), so role is not
//     part of the key today.
//
// Each entry maps action -> a function that returns the cache-key param string
// from the request (or '' when the action takes no distinguishing param). An
// action NOT in this map is never cached.
const CACHEABLE_ACTIONS = {
  getYears: () => '',
  getUsers: () => '',
  getAllDropdownLists: () => '',
  getDropdownList: (req) => `type=${req.type || ''}`,
  getHome: (req) => `year=${req.year || ''}`,
  getLoans: (req) => `year=${req.year || ''}`,
  getExpenses: (req) => `year=${req.year || ''}`,
  getCommittee: (req) => `year=${req.year || ''}`,
  getYearContributors: (req) => `year=${req.year || ''}`,
  getFestivalDates: (req) => `year=${req.year || ''}`,
  getUserHistory: (req) => `userId=${req.userId || ''}`,
  getUserProfile: (req) => `userId=${req.userId || ''}`,
};
const MGMT_CACHE_TTL_SECONDS = 300; // 5 min — a safety net; version bumps are the primary invalidation.

// Reads a cached response for (action, param) at the current data-version, or null.
// Fails OPEN (returns null -> caller hits D1) on any KV problem, so caching can
// never take the API down or serve something impossible.
async function mgmtCacheGet(env, action, param, version) {
  try {
    if (!env || !env.KV_SESSIONS) return null;
    const raw = await env.KV_SESSIONS.get(`mgmtcache:${action}:${param}:v${version}`);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

// Stores a successful response. Best-effort (never throws). Only called for
// results that are NOT an explicit {success:false}.
async function mgmtCachePut(env, action, param, version, result) {
  try {
    if (!env || !env.KV_SESSIONS) return;
    await env.KV_SESSIONS.put(
      `mgmtcache:${action}:${param}:v${version}`,
      JSON.stringify(result),
      { expirationTtl: MGMT_CACHE_TTL_SECONDS }
    );
  } catch (e) { /* best effort */ }
}

// SECURITY (audit S5): actions reachable WITHOUT a session token (the public
// consent + announcement pages, error reporting, and the external WhatsApp queue
// key endpoints). These get a per-IP rate limit since there is no login/role gate
// in front of them. Authenticated actions are intentionally NOT listed — they are
// protected by the session + role checks, and login/OTP already have their own
// dedicated attempt caps in auth.js / loans.js.
const RATE_LIMITED_ACTIONS = new Set([
  'login', 'verifyGoogleLogin',
  // FIX #1: logError is now authenticated; only reportErrorPublic (the
  // unauthenticated fallback for pre-login errors) needs the rate limit here.
  // logError's own per-IP check is inside errorLog.js (isLogErrorRateLimited).
  'reportErrorPublic', 'reportErrorToWhatsApp',
  'getConsentByToken', 'requestConsentOtp', 'verifyConsentOtp', 'respondConsent',
  'getDocxTemplatePublic', 'convertDocxToPdfPublic',
  // Announcements: only the PIN CHECK is rate-limited (it guards a 6-digit PIN on
  // a WhatsApp-shared link against brute force). The post-unlock announce actions
  // — getAnnouncementQueue / markAnnounced / reannounceAll — are deliberately NOT
  // limited: they run only after the correct PIN is entered (a trusted operator on
  // stage), and rapid-fire announcing legitimately fires them many times a minute.
  // Capping them at 20/min produced spurious 429s mid-ceremony. They are still
  // token-gated (a valid announce token is required) and their D1 cost is tiny
  // (markAnnounced = 2 statements), so leaving them uncapped is safe here.
  'verifyAnnouncementPin',
  'publicGetSeo',
]);

// Fixed-window per-IP+action counter in KV. RATE_LIMIT_MAX requests per
// RATE_LIMIT_WINDOW_SECONDS. Best-effort: any KV error means "not limited" so a
// KV outage can never take the whole API offline (fail open).
const RATE_LIMIT_WINDOW_SECONDS = 60;
// Tightened 40 -> 20 per IP per minute (hardening A). These are UNAUTHENTICATED /
// public actions (login, OTP, consent, error reporting); no real human hits any
// of them 20+ times a minute, but a flood script does — capping this narrows the
// window in which a single IP can burn D1's free-tier daily row quota (which, on
// the shared account, would take the whole portal — mgmt included — offline).
const RATE_LIMIT_MAX = 20;
async function isRateLimited(env, ip, action) {
  if (!env || !env.KV_SESSIONS) {
    // Audit 4.3: make the fail-open condition VISIBLE. Without a KV binding the
    // per-IP limits on all public actions silently disappear; log it (best
    // effort) so an operator can notice a mis-wired deployment instead of
    // discovering it only during an attack.
    ctxWaitLog(env, 'backend', 'isRateLimited', 'KV_SESSIONS binding missing — public rate limiting is DISABLED (failing open).');
    return false;
  }
  const bucket = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000));
  const key = `rl:${action}:${ip}:${bucket}`;
  const current = parseInt((await env.KV_SESSIONS.get(key)) || '0', 10) || 0;
  if (current >= RATE_LIMIT_MAX) return true;
  // TTL slightly longer than the window so the key self-expires.
  await env.KV_SESSIONS.put(key, String(current + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS + 5 });
  return false;
}

// Small fire-and-forget logger for fail-open notices (no ctx here, so best-effort).
function ctxWaitLog(env, source, page, message) {
  try { logError(env, source, page, message, '', ''); } catch (e) { /* never throw from a limiter */ }
}

// CORS origin handling.
//
// This API used to answer every request with `Access-Control-Allow-Origin: *`.
// Auth tokens travel in the request BODY (not cookies), so this was not a direct
// CSRF hole, but a wildcard still lets any site on the internet script the API
// from a victim's browser. If ALLOWED_ORIGINS is configured (comma-separated
// list of exact origins), we echo back the caller's Origin only when it's on the
// list; otherwise we fall back to '*' so an un-configured deployment keeps
// working exactly as before.
// Returns the value to send in Access-Control-Allow-Origin, or null when no ACAO
// header should be sent at all.
//
// SECURITY (audit 4.2 + 1.5):
//   * This is the MGMT API — it mutates financial data. It must NOT fall open to
//     '*' when ALLOWED_ORIGINS is unset (a fresh/misconfigured deploy would then
//     be scriptable from any site on the internet). When nothing is configured we
//     return null (no ACAO) so a browser blocks cross-origin reads by default.
//     An explicit "*" in ALLOWED_ORIGINS is still honoured for operators who want
//     it, but it is now a deliberate opt-in, never the default.
//   * An UNKNOWN origin gets null (header omitted), not list[0]. Echoing a
//     mismatched-but-valid origin was harmless (the browser still blocks) but
//     misleading; omitting the header is the correct "deny".
function allowedOrigin(request, env) {
  const configured = (env && env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.toString() : '').trim();
  if (!configured) return null; // fail CLOSED — no wildcard default for the mgmt API
  const list = configured.split(',').map(s => s.trim()).filter(Boolean);
  if (list.includes('*')) return '*'; // explicit, deliberate opt-in only
  const origin = (request.headers.get('Origin') || '').trim();
  return origin && list.includes(origin) ? origin : null; // unknown origin -> no ACAO
}

function corsHeaders(request, env, extra) {
  const origin = allowedOrigin(request, env);
  const headers = { ...(extra || {}) };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    // When we echo a specific origin (not '*'), caches must vary on Origin.
    if (origin !== '*') headers['Vary'] = 'Origin';
    // audit H-12/M-10: allow the browser to send/receive the session + CSRF
    // cookies on cross-origin requests. Credentials CANNOT be combined with a
    // wildcard ACAO, so only advertise them when we echoed a specific origin
    // (ALLOWED_ORIGINS is set — the deliberate, non-wildcard case).
    if (origin !== '*') headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

function jsonOut(obj, request, env, status, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: corsHeaders(request, env, { 'Content-Type': 'application/json', ...(extraHeaders || {}) }),
  });
}

// Maps a thrown error to an HTTP status code (audit 3.1: the API used to answer
// EVERYTHING — validation, auth, unknown action, internal exceptions — with 200,
// so infra-level monitoring / retries / WAF rules could not tell success from
// failure. The JSON body is unchanged so the frontend keeps working; only the
// status line now reflects reality.)
//   AuthError            -> 401 (session expired / not logged in)
//   PermissionError      -> 403 (wrong role, bad API key)
//   ValidationError      -> 400 (user-facing message: bad input, not found, ...)
//   announceSessionExpired -> 401
//   anything else        -> 500 (a real, unexpected server error)
function httpStatusForError(err) {
  if (!err) return 500;
  if (err.authError || err.announceSessionExpired) return 401;
  // PermissionError sets authError=false + expected=true.
  if (err.expected && err.authError === false) {
    // Distinguish a role/API-key denial (403) from a plain validation message
    // (400). Both are ValidationError/PermissionError shaped; use the message as
    // the only available signal, defaulting validation-style to 400.
    return err.permission ? 403 : 400;
  }
  return 500;
}

// Compact, human-readable summary of a CRUD action for the activity log — a few
// meaningful fields (Year/Name/Amount/etc.) rather than the whole payload.
function summarizePayload(sheet, payload, extra) {
  try {
    const p = payload || {};
    const pick = ['Year', 'Name', 'Amount', 'Sl. No.', 'Category', 'Discription', 'Loan ID', 'Payment Mode'];
    const parts = [];
    for (const k of pick) {
      if (p[k] !== undefined && p[k] !== null && p[k].toString().trim() !== '') {
        parts.push(`${k}=${p[k].toString().slice(0, 40)}`);
      }
    }
    if (extra && extra.id) parts.push(`id=${extra.id}`);
    if (extra && extra.rowIndex != null) parts.push(`row#${extra.rowIndex}`);
    return `${sheet || ''}: ${parts.join(', ')}`.slice(0, 900);
  } catch (e) { return (sheet || '').toString(); }
}

// FIX #3: Sanitize user-supplied log fields to prevent stored XSS.
// Strips HTML tags and dangerous characters. Used in the logError handler.
function sanitizeForLog(v, maxLen) {
  if (v === undefined || v === null) return '';
  return v.toString()
    .replace(/<[^>]*>/g, '')      // strip HTML tags
    .replace(/[<>"'`]/g, '')      // remove remaining dangerous characters
    .slice(0, maxLen);
}
// Detect active XSS payloads before they reach storage.
function hasXss(v) {
  if (!v) return false;
  const s = v.toString();
  return /<script/i.test(s) || /javascript:|onerror\s*=|onload\s*=|on\w+\s*=/i.test(s);
}

// The error_log table has no columns for actor/device/IP, and api.js was already
// computing all three on every request only to throw them away. They're folded
// into the existing `context` column so "which admin, on which device" is finally
// answerable from the Error Log screen.
//
// SECURITY (audit S7): clientIp/deviceId are CLIENT-supplied and therefore
// spoofable. We keep the client's self-reported IP only as a labelled hint
// (`clientIpReported`) and record the server-observed Cloudflare edge IP
// (`clientIp`, from CF-Connecting-IP) as the authoritative value.
function buildLogContext(req) {
  const extra = {
    deviceId: req.deviceId || '',
    deviceInfo: (req.deviceInfo || '').toString().slice(0, 200),
    // The server-observed Cloudflare edge IP — the only value a client cannot forge.
    clientIp: req.serverIp || '',
    // audit H-13: `clientIpReported` used to carry the browser's own idea of its
    // public IP, fetched from api.ipify.org. That lookup has been removed (it leaked
    // every admin's IP to a third party, delayed the first request of each page
    // load, and was discarded server-side anyway). The field is still emitted, but
    // only when a legacy cached bundle actually sends one — note it read
    // `req.clientIp`, which line ~190 had ALREADY overwritten with the edge IP, so
    // the two were always identical and the label was misleading.
    ...(req.clientIpReported ? { clientIpReported: req.clientIpReported.toString().slice(0, 60) } : {}),
  };
  const supplied = req.context;
  if (!supplied) return JSON.stringify(extra);
  try {
    const parsed = typeof supplied === 'string' ? JSON.parse(supplied) : supplied;
    return JSON.stringify(Object.assign({}, parsed, extra));
  } catch (e) {
    return JSON.stringify(Object.assign({ note: supplied.toString().slice(0, 200) }, extra));
  }
}

// Actions whose failures must NOT be auto-logged server-side, to avoid a
// recursive log-of-the-log loop.
const NO_SERVER_AUTOLOG = new Set(['logError', 'reportErrorPublic', 'reportErrorToWhatsApp', 'getErrorLog']);

// Errors that are normal operation, not defects: an expired session, a permission
// refusal, a user-facing validation message.
//
// This used to only check authError/announceSessionExpired, so every
// PermissionError ("Only a Superadmin can perform this action") and every
// validation message ("Incorrect PIN", "Incorrect OTP", "This email is already
// registered") became an Error Log row. The live log had 278 rows of which
// ~50 were these — real defects were impossible to spot. `expected` is set by
// PermissionError / AuthError / ValidationError in auth.js.
function isExpectedError(err) {
  return !!(err && (err.expected || err.authError || err.announceSessionExpired));
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(request, env, {
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          // audit H-12/M-10: allow the CSRF header on preflight; allow credentials
          // so the browser will send/accept the cookies on cross-origin XHR.
          'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
          'Access-Control-Allow-Credentials': 'true',
        }),
      });
    }
    if (request.method === 'GET') {
      // Readiness health check (audit 3.3 + 4.1): `?health=1` actually touches
      // D1 + KV and reports any missing binding/secret/var by NAME (never a
      // value), returning HTTP 503 when the deployment is degraded so uptime
      // monitors see a real failure instead of a cheerful "ok" while databases
      // are down. A plain GET stays a cheap liveness string.
      const url = new URL(request.url);
      if (url.searchParams.has('health')) {
        const report = await healthCheck(env);
        return jsonOut(report, request, env, report.status === 'ok' ? 200 : 503);
      }
      return jsonOut({ status: 'ok', message: 'Chhath Puja Management API is live (Cloudflare Worker)' }, request, env);
    }

    // ---- PUBLIC GitHub webhook (AI auto-fix CI monitoring, PR-3) ----
    // GitHub POSTs check_suite events here, signed with GITHUB_WEBHOOK_SECRET
    // (X-Hub-Signature-256 over the RAW body). Handled BEFORE request.json()
    // because HMAC must run on the raw bytes, and the payload shape is GitHub's,
    // not ours. Point a repo webhook (content-type application/json, events:
    // "Check suites") at:  https://<worker>/?github-webhook=1
    {
      const whUrl = new URL(request.url);
      const eventType = request.headers.get('X-GitHub-Event') || '';
      if (whUrl.searchParams.has('github-webhook') || eventType) {
        const raw = await request.text();
        const ok = await verifyGithubSignature(env, raw, request.headers.get('X-Hub-Signature-256'));
        if (!ok) {
          ctx.waitUntil(logError(env, 'backend', 'github-webhook', 'GitHub webhook rejected: bad/missing signature', '', ''));
          return jsonOut({ success: false, message: 'Unauthorized' }, request, env, 401);
        }
        if (eventType === 'ping') {
          return jsonOut({ success: true, pong: true }, request, env);
        }
        if (eventType !== 'check_suite') {
          return jsonOut({ success: true, ignored: `event ${eventType}` }, request, env);
        }
        let payload;
        try { payload = JSON.parse(raw); } catch (e) {
          return jsonOut({ success: false, message: 'Invalid JSON' }, request, env, 400);
        }
        // Never make GitHub retry: run the (possibly slow) retry work in the
        // background and ack immediately.
        ctx.waitUntil(
          handleCheckSuiteEvent(env, payload).catch(err =>
            logErrorAt(env, 'backend', 'github-webhook', err, { branch: payload && payload.check_suite && payload.check_suite.head_branch }))
        );
        return jsonOut({ success: true, received: true }, request, env);
      }
    }

    let req;
    try {
      // FIX #2: reject oversized payloads before parsing. The Content-Length header
      // can be absent or spoofed, so we check the actual body size after reading.
      // 4096 bytes for logError/reportErrorPublic; 10 MB for everything else
      // (file uploads go through this too — docx/pdf/image uploads are legitimately large).
      const MAX_LOGERROR_BODY = 4096;
      const MAX_GENERAL_BODY = 10 * 1024 * 1024;
      const rawBody = await request.text();
      // Detect if this looks like an error-log call BEFORE we parse (check action
      // in raw body as a fast pre-filter — full check after parse).
      const looksLikeLogError = rawBody.includes('"logError"') || rawBody.includes('"reportErrorPublic"');
      if (looksLikeLogError && rawBody.length > MAX_LOGERROR_BODY) {
        const earlyIp = request.headers.get('CF-Connecting-IP') || 'unknown';
        ctx.waitUntil(logError(env, 'backend', 'router', `logError payload too large: ${rawBody.length} bytes from ${earlyIp}`, '', ''));
        return jsonOut({ success: false, message: 'Payload too large' }, request, env, 413);
      }
      if (rawBody.length > MAX_GENERAL_BODY) {
        return jsonOut({ success: false, message: 'Payload too large' }, request, env, 413);
      }
      req = JSON.parse(rawBody);
    } catch (e) {
      // Was returned with nothing persisted, so a bot or a broken client hammering
      // the API was completely invisible.
      ctx.waitUntil(logError(env, 'backend', 'router', 'Invalid JSON body: ' + (e && e.message), '', ''));
      return jsonOut({ success: false, message: 'Invalid JSON body' }, request, env, 400);
    }
    // ---- PUBLIC inbound-email webhook (Resend receiving) ----
    // Resend POSTs the 'email.received' event here. It is NOT an action call and
    // carries no session — it is authenticated by a shared secret configured both
    // in Resend's webhook URL and as RESEND_WEBHOOK_SECRET. Point Resend at
    //   https://<worker>/?inbound-email=<RESEND_WEBHOOK_SECRET>
    // (or send the secret in an X-Webhook-Secret header). Handled before the
    // action router because the body shape is Resend's, not ours.
    const reqUrl = new URL(request.url);
    if (reqUrl.searchParams.has('inbound-email') || (req && (req.type === 'email.received' || req.event === 'email.received'))) {
      const provided = reqUrl.searchParams.get('inbound-email') || request.headers.get('X-Webhook-Secret') || '';
      const expected = env.RESEND_WEBHOOK_SECRET || '';
      if (!expected || provided !== expected) {
        ctx.waitUntil(logError(env, 'backend', 'inbound-email', 'Inbound webhook rejected: bad/missing secret', '', ''));
        return jsonOut({ success: false, message: 'Unauthorized' }, request, env, 401);
      }
      const result = await officialMail.handleInboundEmailWebhook(env, req);
      // Always 200 so Resend does not retry a stored message; failures are logged.
      return jsonOut({ success: true, ...result }, request, env, 200);
    }

    const action = req.action;

    // SECURITY (audit S7): overwrite the client-reported IP with the real
    // Cloudflare edge IP so consent records (respondConsent stores req.clientIp)
    // and the error log carry a value the client cannot forge. The original
    // client value is preserved separately as a hint (see buildLogContext).
    const edgeIp = request.headers.get('CF-Connecting-IP') || '';
    req.serverIp = edgeIp;
    req.clientIpReported = req.clientIp || '';
    if (edgeIp) req.clientIp = edgeIp;

    // ---- audit H-12 / M-10: cookie session + CSRF (backward-compatible) ----
    //
    // Read the HttpOnly session cookie so withAuth() can fall back to it when the
    // body carried no token (a cookie-only client). This is ADDITIVE: a client
    // that still sends req.token in the body is unaffected — that path stays first.
    //
    // CSRF is enforced ONLY when the request authenticated via the COOKIE (no body
    // token) AND is a state-changing action. A body-token caller is structurally
    // CSRF-immune (a cross-site page can't read localStorage to forge the body
    // token), so it is never blocked — which is exactly what lets the old and new
    // schemes run side by side with zero breakage. The check is the standard
    // double-submit: the readable cpm_csrf cookie must equal the X-CSRF-Token
    // header. `login`/`verifyGoogleLogin` are exempt (no session yet).
    const cookies = parseCookies(request);
    const cookieSession = cookies[SESSION_COOKIE] || '';
    if (cookieSession) req.__cookieSessionToken = cookieSession;
    const usingCookieAuth = !req.token && !!cookieSession;
    const CSRF_EXEMPT = new Set(['login', 'verifyGoogleLogin']);
    if (usingCookieAuth && EXPECTED_MUTATING_ACTIONS.has(action) && !CSRF_EXEMPT.has(action)) {
      const headerToken = (request.headers.get(CSRF_HEADER) || '').trim();
      const cookieToken = (cookies[CSRF_COOKIE] || '').trim();
      if (!headerToken || !cookieToken || headerToken !== cookieToken) {
        return jsonOut(
          { success: false, message: 'Security check failed (CSRF). Please refresh the page and sign in again.' },
          request, env, 403
        );
      }
    }

    // SECURITY (audit S5): lightweight per-IP rate limit on UNAUTHENTICATED /
    // public actions (the authenticated ones are already gated by login + role,
    // and login/OTP have their own dedicated caps). Uses KV with a short TTL as a
    // fixed-window counter — best-effort, fails OPEN if KV is unavailable so a KV
    // hiccup never takes the API down.
    if (edgeIp && RATE_LIMITED_ACTIONS.has(action)) {
      const limited = await isRateLimited(env, edgeIp, action).catch((e) => {
        // Audit 4.3: a KV error here means the limit fails open — record it.
        ctx.waitUntil(logError(env, 'backend', 'isRateLimited', 'Rate-limit check failed (failing open): ' + (e && e.message), (e && e.stack) || '', ''));
        return false;
      });
      if (limited) {
        return jsonOut(
          { success: false, message: 'Too many requests. Please try again in a little while.' },
          request, env, 429
        );
      }
    }

    const handlers = {
      // Login failures (wrong password, unknown user, the 5-attempt lockout) used
      // to return {success:false} with NO logging on either side — api.js also
      // excluded 'login' from auto-logging — so there was zero brute-force
      // visibility. The identifier is recorded; the password never is.
      login: async () => {
        // Pass the server-observed edge IP so the lockout/backoff is keyed on
        // identifier + IP (audit 1.1, Fix #5) — an attacker can no longer lock out
        // a real user by guessing against their username.
        const res = await login(env, req.name, req.password, req.rememberMe, req.serverIp, req.deviceInfo);
        // FIX #4: the login response no longer carries a `lockedOut` flag or a
        // distinct "locked out" message (that let attackers enumerate valid /
        // locked usernames). Brute-force / throttling signal now comes from the
        // login_attempts audit trail (reason='backoff_throttled' / 'ip_rate_limited'),
        // which auth.js records — visible to a Superadmin on the Audit Logs screen —
        // rather than from the client-facing response.
        return res;
      },
      // Sign in with Google. Verifies the Google ID token server-side and maps
      // the verified email to an existing login_users row, issuing the same
      // session a password login does. No auth token required to call it (like
      // `login`); rate-limited per IP via RATE_LIMITED_ACTIONS below.
      verifyGoogleLogin: () => loginWithGoogle(env, req.idToken, req.rememberMe, req.serverIp, req.deviceInfo),

      logout: () => withAuth(env, req, (user) => doLogout(env, req.token)),

      // ---- Active sessions / devices (every role: own devices) ----
      getMySessions: () => withAuth(env, req, (user) => getMySessions(env, user, user.th)),
      revokeSession: () => withAuth(env, req, (user) => revokeSession(env, user, req.sessionId, user.th)),
      revokeAllOtherSessions: () => withAuth(env, req, (user) => revokeAllOtherSessions(env, user, user.th)),
      // ---- Superadmin: view / force-logout ANY user's sessions ----
      getUserSessions: () => withAuth(env, req, (user) => getUserSessions(env, req.targetName, user)),
      revokeUserSession: () => withAuth(env, req, (user) => revokeUserSession(env, req.targetName, req.sessionId, user)),
      // ---- Superadmin: login/activity audit + locked accounts + unlock ----
      getLoginAttempts: () => withAuth(env, req, (user) => getLoginAttempts(env, { name: req.name2, failedOnly: req.failedOnly, successOnly: req.successOnly, limit: req.limit }, user)),
      getActivityLog: () => withAuth(env, req, (user) => { requireSuperadmin(user); return getActivityLog(env, { name: req.name2, limit: req.limit }); }),
      getLockedAccounts: () => withAuth(env, req, (user) => getLockedAccounts(env, user)),
      revokeLock: () => withAuth(env, req, (user) => revokeLock(env, req.lockKey, req.targetName, req.ip, user)),
      revokeAllLocks: () => withAuth(env, req, (user) => revokeAllLocks(env, user)),
      getYears: () => withAuth(env, req, () => getYears(env)),
      // Tiny read the SPA calls once on load to decide whether its localStorage
      // cache is still current: if the version is unchanged since the copy was
      // saved, the shell (users/committee/years) is served from localStorage and
      // NO heavy re-fetch happens. Same counter the Public portal uses for its
      // ETag; a staff session is required (withAuth) like every other read.
      getDataVersion: () => withAuth(env, req, (user) => { requireStaffRole(user); return getDataVersion(env).then(v => ({ v: (v || '0').toString() })); }),
      // SECURITY (audit H-1, scoped): these three returned member PII and full
      // financial history to ANY caller holding a valid session, with no role check
      // whatsoever. Broad read access for the three staff roles is intentional in
      // this portal — a Subadmin genuinely needs the member list to record a
      // collection, and the Users tab edits Mobile/Email/WhatsApp — so the fix is
      // NOT to narrow the payload (that would break Users.jsx). It is to require an
      // actual staff role, which closes the gap where a legacy or mistyped free-text
      // role (e.g. an old 'Treasurer' login) gets full read access while
      // ROLE_PERMISSIONS grants it no write permission at all.
      getUsers: () => withAuth(env, req, (user) => { requireStaffRole(user); return getSheetDataAsJSON(env, 'USERS'); }),
      getCommittee: () => withAuth(env, req, () => getCommitteeData(env, req.year)),
      getHome: () => withAuth(env, req, () => getHomeData(env, req.year)),
      getExpenses: () => withAuth(env, req, () => getExpensesData(env, req.year)),
      getLoans: () => withAuth(env, req, () => getLoansData(env, req.year)),
      getLoanBudget: () => withAuth(env, req, async () => ({ success: true, available: await loans.availableLoanFund(env, req.year) })),
      getUserHistory: () => withAuth(env, req, (user) => { requireStaffRole(user); return getUserHistory(env, req.userId); }),
      getUserProfile: () => withAuth(env, req, (user) => { requireStaffRole(user); return getUserProfile(env, req.userId); }),
      getYearContributors: () => withAuth(env, req, () => getYearContributors(env, req.year)),
      getLockedYears: () => withAuth(env, req, async () => Array.from(await getLockedYearsSet(env))),
      lockYear: () => withAuth(env, req, (user) => lockYear(env, req.year, user)),
      unlockYear: () => withAuth(env, req, (user) => unlockYear(env, req.year, user)),
      addYear: () => withAuth(env, req, (user) => addYear(env, req.year, user)),
      updateOwnProfile: () => withAuth(env, req, (user) => updateOwnProfile(env, req.payload, user)),
      changePassword: () => withAuth(env, req, (user) => changePassword(env, req.currentPassword, req.newPassword, user)),

      // ---- Login Management (Superadmin only) ----
      getLoginUsers: () => withAuth(env, req, (user) => getLoginUsers(env, user)),
      addLoginUser: () => withAuth(env, req, (user) => addLoginUser(env, req.userId, req.password, req.role, req.mobile, req.email, user)),
      updateLoginUser: () => withAuth(env, req, (user) => updateLoginUser(env, req.rowIndex, req.password, req.role, req.mobile, req.email, user)),
      deleteLoginUser: () => withAuth(env, req, (user) => deleteLoginUser(env, req.rowIndex, user)),

      // saveRecord/updateRecord/deleteRecord now also write an activity_log row
      // (best-effort, non-blocking) so the Superadmin audit page shows WHO did
      // WHAT and WHEN. `details` is a compact summary: sheet + a few key fields
      // (never the whole payload, to keep the log readable and avoid storing
      // more than needed). logActivity never throws, so it can't affect the save.
      saveRecord: () => withAuth(env, req, async (user) => {
        const res = await saveRecord(env, req.sheet, req.payload, user);
        ctx.waitUntil(logActivity(env, { name: user.name, action: 'add ' + (req.sheet || ''), details: summarizePayload(req.sheet, req.payload, res), deviceInfo: req.deviceInfo, ip: req.serverIp, deviceId: req.deviceId }));
        return res;
      }),
      queueCollectionMessages: () => withAuth(env, req, (user) => wa.queueCollectionMessages(env, req.payload, req.rowIndex, req.fileLink, user)),

      // Superadmin bulk CSV import (Users / Collections / Committee Members). Each
      // row goes through saveRecord (same validation + id allocation as a manual
      // add). Returns a per-row report; logs one activity entry summarising it.
      // Not in READ_ONLY_ACTIONS, so bumpDataVersion fires afterwards and the
      // public portal picks up the new rows.
      importCsvRows: () => withAuth(env, req, async (user) => {
        const res = await importCsvRows(env, req.sheet, req.rows, user);
        const r = res.report || {};
        ctx.waitUntil(logActivity(env, {
          name: user.name, action: 'import CSV ' + (req.sheet || ''),
          details: `${r.label || req.sheet}: ${r.imported || 0} imported, ${r.skipped || 0} skipped of ${r.total || 0}`,
          deviceInfo: req.deviceInfo, ip: req.serverIp, deviceId: req.deviceId,
        }));
        return res;
      }),
      updateRecord: () => withAuth(env, req, async (user) => {
        const res = await updateRecordByIdx(env, req.sheet, req.rowIndex, req.payload, user);
        ctx.waitUntil(logActivity(env, { name: user.name, action: 'edit ' + (req.sheet || ''), details: summarizePayload(req.sheet, req.payload, { rowIndex: req.rowIndex }), deviceInfo: req.deviceInfo, ip: req.serverIp, deviceId: req.deviceId }));
        return res;
      }),
      deleteRecord: () => withAuth(env, req, async (user) => {
        const res = await deleteRecordByIdx(env, req.sheet, req.rowIndex, user);
        ctx.waitUntil(logActivity(env, { name: user.name, action: 'delete ' + (req.sheet || ''), details: `row #${req.rowIndex}`, deviceInfo: req.deviceInfo, ip: req.serverIp, deviceId: req.deviceId }));
        return res;
      }),

      // ---- Loans (full consent/OTP/guarantor flow ported — see loans.js) ----
      saveLoan: () => withAuth(env, req, (user) => loans.saveLoanTransaction(env, req.loan, req.guarantors, user)),
      // audit H-8: deleting a loan was the only destructive action in the portal
      // that wrote NOTHING to the activity log — every saveRecord/updateRecord/
      // deleteRecord above logs, this did not. It is also the most consequential
      // one: it removes the loan, its three guarantor rows and (now) every
      // consent record, signatures and photos included. Record who did it and
      // exactly how much went with it.
      deleteLoan: () => withAuth(env, req, async (user) => {
        const res = await loans.deleteLoanTransaction(env, req.rowIndex, req.year, req.loanerId, user, req.loanId);
        ctx.waitUntil(logActivity(env, {
          name: user.name,
          action: 'delete LOANS',
          details: `row #${req.rowIndex}, Loan ID=${res.loanId || '(none)'}, `
            + `guarantors removed=${res.removedGuarantors}, consents revoked=${res.removedConsents}`,
          deviceInfo: req.deviceInfo, ip: req.serverIp, deviceId: req.deviceId,
        }));
        return res;
      }),

      // SECURITY: this handler had NO role check — any authenticated user
      // (including a Subadmin) could push arbitrary bytes to the committee's
      // Drive folder, uploaded world-readable by default. Gate it to staff
      // (Admin/Superadmin) like the other write/upload paths.
      uploadFile: () => withAuth(env, req, (user) => { requireAdminOrAbove(user); return uploadFileToDrive(env, req.base64, req.fileName, req.mimeType); }),

      // ---- WhatsApp: Templates (Superadmin only) ----
      getPersonTemplates: () => withAuth(env, req, (user) => { requireSuperadmin(user); return getSheetDataAsJSON(env, 'PERSON_MESSAGE_TEMPLATES'); }),
      addPersonTemplate: () => withAuth(env, req, (user) => wa.addTemplate(env, 'PERSON_MESSAGE_TEMPLATES', req.text, req.messageType, req.contributionType, req.fileLink, req.docSubType, req.fileDocType, user)),
      updatePersonTemplate: () => withAuth(env, req, (user) => wa.updateTemplate(env, 'PERSON_MESSAGE_TEMPLATES', req.rowIndex, req.text, req.active, req.messageType, req.contributionType, req.fileLink, req.docSubType, req.fileDocType, user)),
      deletePersonTemplate: () => withAuth(env, req, (user) => wa.deleteTemplate(env, 'PERSON_MESSAGE_TEMPLATES', req.rowIndex, user)),
      // ---- Email (Resend) templates ----
      getEmailTemplates: () => withAuth(env, req, (user) => { requireSuperadmin(user); return getSheetDataAsJSON(env, 'EMAIL_MESSAGE_TEMPLATES'); }),
      addEmailTemplate: () => withAuth(env, req, (user) => email.addEmailTemplate(env, req.subject, req.text, req.messageType, req.contributionType, req.fileLink, req.docSubType, req.fileDocType, user)),
      updateEmailTemplate: () => withAuth(env, req, (user) => email.updateEmailTemplate(env, req.rowIndex, req.subject, req.text, req.active, req.messageType, req.contributionType, req.fileLink, req.docSubType, req.fileDocType, user)),
      deleteEmailTemplate: () => withAuth(env, req, (user) => email.deleteEmailTemplate(env, req.rowIndex, user)),
      // ---- Loan email (Resend) templates ----
      getLoanEmailTemplates: () => withAuth(env, req, (user) => { requireSuperadmin(user); return email.getLoanEmailTemplates(env, req.type); }),
      addLoanEmailTemplate: () => withAuth(env, req, (user) => email.addLoanEmailTemplate(env, req.type, req.subject, req.text, req.messageType, req.fileLink, user)),
      updateLoanEmailTemplate: () => withAuth(env, req, (user) => email.updateLoanEmailTemplate(env, req.rowIndex, req.subject, req.text, req.active, req.messageType, req.fileLink, user)),
      deleteLoanEmailTemplate: () => withAuth(env, req, (user) => email.deleteLoanEmailTemplate(env, req.rowIndex, user)),
      getGroupTemplates: () => withAuth(env, req, (user) => { requireSuperadmin(user); return getSheetDataAsJSON(env, 'GROUP_MESSAGE_TEMPLATES'); }),
      addGroupTemplate: () => withAuth(env, req, (user) => wa.addTemplate(env, 'GROUP_MESSAGE_TEMPLATES', req.text, req.messageType, req.contributionType, req.fileLink, req.docSubType, req.fileDocType, user)),
      updateGroupTemplate: () => withAuth(env, req, (user) => wa.updateTemplate(env, 'GROUP_MESSAGE_TEMPLATES', req.rowIndex, req.text, req.active, req.messageType, req.contributionType, req.fileLink, req.docSubType, req.fileDocType, user)),
      deleteGroupTemplate: () => withAuth(env, req, (user) => wa.deleteTemplate(env, 'GROUP_MESSAGE_TEMPLATES', req.rowIndex, user)),

      // ---- WhatsApp: Group Info (Superadmin only) ----
      getWhatsappGroups: () => withAuth(env, req, (user) => { requireSuperadmin(user); return getSheetDataAsJSON(env, 'WHATSAPP_GROUPS'); }),
      addWhatsappGroup: () => withAuth(env, req, (user) => wa.addWhatsappGroup(env, req.groupName, req.groupid, user)),
      updateWhatsappGroup: () => withAuth(env, req, (user) => wa.updateWhatsappGroup(env, req.rowIndex, req.groupName, req.groupid, req.active, user)),
      deleteWhatsappGroup: () => withAuth(env, req, (user) => wa.deleteWhatsappGroup(env, req.rowIndex, user)),

      getMessageLog: () => withAuth(env, req, (user) => { requireSuperadmin(user); return wa.getMessageLog(env); }),

      // ---- Bilingual Dropdown Lists ----
      getDropdownList: () => withAuth(env, req, () => getDropdownList(env, req.type)),
      getAllDropdownLists: () => withAuth(env, req, () => getAllDropdownLists(env)),
      addDropdownListItem: () => withAuth(env, req, (user) => addDropdownListItem(env, req.type, req.englishValue, req.hindiLabel, user)),
      updateDropdownListItem: () => withAuth(env, req, (user) => updateDropdownListItem(env, req.rowIndex, req.englishValue, req.hindiLabel, req.active, user)),
      deleteDropdownListItem: () => withAuth(env, req, (user) => deleteDropdownListItem(env, req.rowIndex, user)),

      // ---- Loan Consent — PUBLIC + Admin (fully ported — see loans.js) ----
      getConsentByToken: () => loans.getConsentByToken(env, req.token),
      requestConsentOtp: () => loans.requestConsentOtp(env, req.token),
      verifyConsentOtp: () => loans.verifyConsentOtp(env, req.token, req.otp),
      respondConsent: () => loans.respondConsent(env, req.token, req.decision, req.deviceId, req.deviceInfo, req.clientIp, req.geoLat, req.geoLng, req.geoAccuracy, req.photoBase64, req.signatureBase64, req.declineRemarks, req.verifyToken),
      getLoanConsents: () => withAuth(env, req, (user) => loans.getLoanConsents(env, req.loanId, user)),
      resendConsent: () => withAuth(env, req, (user) => loans.resendConsent(env, req.consentId, user)),
      replaceGuarantor: () => withAuth(env, req, (user) => loans.replaceGuarantor(env, req.loanId, req.oldConsentId, req.newPersonId, user)),
      markLoanDisbursed: () => withAuth(env, req, (user) => loans.markLoanDisbursed(env, req.loanId, req.cashAmount, req.onlineAmount, user)),
      getConsentsForReview: () => withAuth(env, req, (user) => loans.getConsentsForReview(env, user)),
      setConsentVerification: () => withAuth(env, req, (user) => loans.setConsentVerification(env, req.consentId, req.status, req.remarks, user)),

      // ---- Festival Dates ----
      getFestivalDates: () => withAuth(env, req, () => getFestivalDates(env, req.year)),
      saveFestivalDates: () => withAuth(env, req, (user) => saveFestivalDates(env, req.year, req.diwali, req.nahayKhay, req.chhathArghya, user)),

      // ---- Portal Settings ----
      getPortalSetting: () => withAuth(env, req, async (user) => { requireSuperadmin(user); return { value: await getPortalSetting(env, req.key) }; }),
      setPortalSetting: () => withAuth(env, req, (user) => setPortalSetting(env, req.key, req.value, user)),

      // ---- SEO / social link preview (Superadmin) ----
      // publicGetSeo is intentionally unauthenticated: the frontends' build step
      // fetches it at deploy time to bake the tags into index.html. It returns
      // only the presentation fields (title/description/keywords/image) and never
      // the deploy-hook URLs.
      getSeoSettings: () => withAuth(env, req, (user) => seo.getSeoSettings(env, user)),
      saveSeoSettings: () => withAuth(env, req, (user) => seo.saveSeoSettings(env, req.payload, user)),
      uploadSeoImage: () => withAuth(env, req, (user) => seo.uploadSeoImage(env, req.base64, req.fileName, user)),
      triggerRebuild: () => withAuth(env, req, (user) => seo.triggerRebuild(env, req.target, user)),
      publicGetSeo: async () => {
        // `portal` selects which portal's preview fields to return ('public' |
        // 'mgmt'); defaults to public. Never exposes deploy-hook URLs.
        const all = await seo.readAllSeo(env);
        const which = req.portal === 'mgmt' ? all.mgmt : all.public;
        return { status: true, seo: which };
      },

      // ---- Consent Page Templates ----
      getConsentPageTemplate: () => withAuth(env, req, (user) => { requireSuperadmin(user); return getConsentPageTemplate(env, req.type); }),
      updateConsentPageTemplate: () => withAuth(env, req, (user) => updateConsentPageTemplate(env, req.type, req.text, user)),

      // ---- Receipt / Certificate / Samaan Templates + DOCX templates + PDF
      // conversion — fully ported (see templates.js / docxTemplates.js / drive.js).
      //
      // audit L-15: this comment used to say the docx->pdf leg needs
      // DRIVE_SA_EMAIL / DRIVE_SA_PRIVATE_KEY. Those names are read by NO code
      // anywhere — wrangler.toml says so explicitly. That service-account path was
      // replaced by an OAuth refresh-token flow, so the real requirements are
      // DRIVE_OAUTH_CLIENT_ID / DRIVE_OAUTH_CLIENT_SECRET /
      // DRIVE_OAUTH_REFRESH_TOKEN plus DRIVE_ROOT_FOLDER_ID. Setting the old two
      // does nothing, which is a genuinely expensive hour for whoever tries. ----
      // audit M-1: these six had NO role argument — `withAuth(env, req, () => ...)`
      // — so any authenticated caller could read every year's receipt, certificate
      // and material-receipt template text. All six are used ONLY by the three
      // *Templates.jsx screens, which App.jsx exposes to Superadmin alone (the
      // Admin and Subadmin tab groups do not contain them), and their save/copy/
      // delete siblings already call requireSuperadmin. Match them.
      getReceiptTemplates: () => withAuth(env, req, (user) => { requireSuperadmin(user); return tpl.getTemplates(env, 'receipt'); }),
      getReceiptTemplate: () => withAuth(env, req, (user) => { requireSuperadmin(user); return tpl.getTemplate(env, 'receipt', req.year); }),
      saveReceiptTemplate: () => withAuth(env, req, (user) => tpl.saveTemplate(env, 'receipt', req.year, req.text, req.pageSize, user)),
      copyReceiptTemplate: () => withAuth(env, req, (user) => tpl.copyTemplate(env, 'receipt', req.fromYear, req.toYear, user)),
      deleteReceiptTemplate: () => withAuth(env, req, (user) => tpl.deleteTemplate(env, 'receipt', req.year, user)),
      getReceiptData: () => withAuth(env, req, (user) => tpl.getReceiptData(env, req.rowIndex, req.year, user)),
      getCertificateTemplates: () => withAuth(env, req, (user) => { requireSuperadmin(user); return tpl.getTemplates(env, 'certificate'); }),
      getCertificateTemplate: () => withAuth(env, req, (user) => { requireSuperadmin(user); return tpl.getTemplate(env, 'certificate', req.year); }),
      saveCertificateTemplate: () => withAuth(env, req, (user) => tpl.saveTemplate(env, 'certificate', req.year, req.text, req.pageSize, user)),
      copyCertificateTemplate: () => withAuth(env, req, (user) => tpl.copyTemplate(env, 'certificate', req.fromYear, req.toYear, user)),
      deleteCertificateTemplate: () => withAuth(env, req, (user) => tpl.deleteTemplate(env, 'certificate', req.year, user)),
      getCertificateData: () => withAuth(env, req, (user) => tpl.getCertificateData(env, req.rowIndex, req.year, user)),
      getSamaanTemplates: () => withAuth(env, req, (user) => { requireSuperadmin(user); return tpl.getTemplates(env, 'samaan'); }),
      getSamaanTemplate: () => withAuth(env, req, (user) => { requireSuperadmin(user); return tpl.getTemplate(env, 'samaan', req.year); }),
      saveSamaanTemplate: () => withAuth(env, req, (user) => tpl.saveTemplate(env, 'samaan', req.year, req.text, req.pageSize, user)),
      copySamaanTemplate: () => withAuth(env, req, (user) => tpl.copyTemplate(env, 'samaan', req.fromYear, req.toYear, user)),
      deleteSamaanTemplate: () => withAuth(env, req, (user) => tpl.deleteTemplate(env, 'samaan', req.year, user)),
      getSamaanData: () => withAuth(env, req, (user) => tpl.getSamaanData(env, req.rowIndex, req.year, user)),
      getDocxTemplates: () => withAuth(env, req, (user) => { requireSuperadmin(user); return docx.getDocxTemplates(env, req.docType); }),
      getDocxTemplate: () => withAuth(env, req, (user) => { requireSuperadmin(user); return docx.getDocxTemplate(env, req.docType, req.year); }),
      uploadDocxTemplate: () => withAuth(env, req, (user) => docx.uploadDocxTemplate(env, req.docType, req.year, req.base64, req.fileName, user)),
      copyDocxTemplate: () => withAuth(env, req, (user) => docx.copyDocxTemplate(env, req.docType, req.fromYear, req.toYear, user)),
      deleteDocxTemplate: () => withAuth(env, req, (user) => docx.deleteDocxTemplate(env, req.docType, req.year, user)),
      // Was `withAuth` with NO role check, handing full template bytes to any
      // logged-in user of any role.
      getDocxTemplateForDoc: () => withAuth(env, req, (user) => docx.getDocxTemplateForDoc(env, req.docType, req.year, user)),
      // PUBLIC (Consent page). Was completely unauthenticated — anyone could pull
      // down the committee's raw .docx templates for any docType/year. Now the
      // consent token is verified and the role+year come from the consent row.
      getDocxTemplatePublic: () => docx.getDocxTemplatePublic(env, req.docType, req.year, req.token),
      // `mode` replaces the old `isAutoGenerate` boolean — see docxTemplates.js.
      // An unrecognised mode falls back to the most restrictive (Superadmin).
      // SECURITY (audit C-2): `mode` used to come straight from the request body,
      // and inside convertDocxToPdf it is the ONLY thing that selects the
      // authorization branch ('bulk' -> requireSuperadmin, anything else ->
      // requireStaffRole). A Subadmin could therefore send mode:'auto' together
      // with force:true and a recordId belonging to somebody else's consent, and
      // overwrite the indexed PDF that the public portal serves as a "Verified
      // Record".
      //
      // The privilege level is now bound to the ENDPOINT, not to a payload field,
      // so the client can no longer choose which check it faces:
      //   convertDocxToPdf      -> staff; one record from the caller's own screen
      //                            (Receipt modal, Home's auto-PDF fallback).
      //                            Never a consent document, never force.
      //   convertDocxToPdfBulk  -> Superadmin; mass generation / regeneration
      //                            (Generate PDFs, Download Center, PDF Export).
      // Both server-internal callers keep their own modes: the collection queue
      // passes 'auto' and the token-gated public consent path passes 'public'.
      convertDocxToPdf: () => withAuth(env, req, (user) => {
        requireStaffRole(user);
        return docx.convertDocxToPdf(
          env, req.docType, req.year, req.recordId, req.base64, req.fileName,
          user, 'single', { force: false }
        );
      }),
      convertDocxToPdfBulk: () => withAuth(env, req, (user) => {
        requireSuperadmin(user);
        return docx.convertDocxToPdf(
          env, req.docType, req.year, req.recordId, req.base64, req.fileName,
          user, 'bulk', { force: !!req.force }
        );
      }),
      // PUBLIC (Consent page). Was unauthenticated AND trusted the client's
      // docType/year/recordId, so anyone could write arbitrary rows into
      // generated_files that the public portal renders as "Verified Record".
      // Everything except the file bytes is now derived from the verified token.
      convertDocxToPdfPublic: () => docx.convertDocxToPdfPublic(env, req.base64, req.token),

      // ---- Bulk "Generate PDFs" + Download Center — fully ported ----
      getRecordsForDocType: () => withAuth(env, req, (user) => docx.getRecordsForDocType(env, req.docType, req.year, user)),
      getGeneratedFilesForYear: () => withAuth(env, req, (user) => docx.getGeneratedFilesForYear(env, req.year, user, req.docType)),
      searchUsersByVillageAndName: () => withAuth(env, req, (user) => docx.searchUsersByVillageAndName(env, req.village, req.query, user)),
      getPersonDownloads: () => withAuth(env, req, (user) => docx.getPersonDownloads(env, req.userId, user)),

      // ---- Storage Management (Superadmin): R2 <-> Drive ----
      getStorageOverview: () => withAuth(env, req, (user) => storage.getStorageOverview(env, user)),
      moveYearToDrive: () => withAuth(env, req, (user) => storage.moveYearToDrive(env, req.year, user)),

      // ---- Full Backup & Restore (Superadmin) ----
      // exportBackup only READS every table; restoreBackup replaces table
      // contents (DESTRUCTIVE) and is guarded by a typed confirmation + an
      // automatic pre-restore safety snapshot inside backup.js.
      exportBackup: () => withAuth(env, req, (user) => backup.exportBackup(env, user)),
      restoreBackup: () => withAuth(env, req, (user) => backup.restoreBackup(env, user, req.backup, req.confirm, req.opts || {})),

      // ---- Collection Queue (background PDF + WhatsApp) ----
      // enqueueCollectionJob: called right after a COLLECTION save so the browser
      // doesn't have to wait for PDF conversion + WhatsApp queueing (a Cron
      // Trigger does those — see scheduled() below). getCollectionQueueStatus is
      // a read-only status panel available to any staff role.
      enqueueCollectionJob: () => withAuth(env, req, (user) => cq.enqueueCollectionJob(env, req.job, user)),
      getCollectionQueueStatus: () => withAuth(env, req, (user) => cq.getCollectionQueueStatus(env, user)),
      // Superadmin-only Queue Monitor tab: full, filterable job list across ALL
      // users (getQueueJobsForSuperadmin) + a retry action for failed/stuck jobs
      // (retryQueueJob). Both enforce requireSuperadmin inside collectionQueue.js.
      getQueueJobsForSuperadmin: () => withAuth(env, req, (user) => cq.getQueueJobsForSuperadmin(env, user, { status: req.status, limit: req.limit })),
      retryQueueJob: () => withAuth(env, req, (user) => cq.retryQueueJob(env, user, req.jobId)),
      // On-demand queue drain. Cloudflare Cron Triggers on the free plan fire
      // unreliably (and never in local/preview), so the frontend calls this
      // fire-and-forget right after a save — the PDF + WhatsApp then process
      // within seconds instead of waiting for (or depending on) the cron. The
      // cron in wrangler.toml stays as a backup. Safe to call concurrently: jobs
      // are claimed with an optimistic UPDATE so two runs never double-process.
      processCollectionQueue: () => withAuth(env, req, (user) => cq.processCollectionQueueOnDemand(env, user)),

      // ---- Popup Management ----
      getPopups: () => withAuth(env, req, (user) => popups.getPopups(env, user)),
      getPopupWithSlides: () => withAuth(env, req, (user) => popups.getPopupWithSlides(env, req.popupId, user)),
      savePopup: () => withAuth(env, req, (user) => popups.savePopup(env, req.popupId, req.title, req.roles, req.active, req.startAt, req.endAt, user)),
      deletePopup: () => withAuth(env, req, (user) => popups.deletePopup(env, req.popupId, user)),
      savePopupSlides: () => withAuth(env, req, (user) => popups.savePopupSlides(env, req.popupId, req.slides, user)),
      uploadPopupImage: () => withAuth(env, req, (user) => popups.uploadPopupImage(env, req.base64, req.fileName, req.mimeType, user)),
      getActivePopups: () => withAuth(env, req, (user) => popups.getActivePopups(env, user)),
      // Lets an Admin see exactly what the PUBLIC portal will render — including
      // which eligible popups will NOT be shown (only the first one is) and which
      // are dropped for having zero slides. Previously a 'Public'-only popup was
      // invisible to its own author, because getActivePopups filters by the
      // caller's own role.
      previewPublicPopups: () => withAuth(env, req, (user) => popups.previewPublicPopups(env, user)),

      // ---- Error Log ----
      // FIX #1 (Security): logError now requires authentication. The unauthenticated
      // fallback for pre-login errors (Login page crashes, Consent page, Announce
      // page) uses reportErrorPublic — a separate, rate-limited, sanitized action.
      // BEFORE this fix: anyone could POST {action:"logError"} with no token and
      // inject fake error rows (log poisoning, D1 bill inflation).
      logError: () => withAuth(env, req, (user) => {
        // FIX #3: sanitize + truncate all user-supplied fields before storage.
        const cleanMsg  = sanitizeForLog(req.message, 500);
        const cleanStk  = sanitizeForLog(req.stack,   2000);
        const cleanCtx  = sanitizeForLog(req.context, 1000);
        if (hasXss(req.message) || hasXss(req.stack) || hasXss(req.context)) {
          return { success: false, message: 'Invalid payload' };
        }
        return logError(env, req.source, req.page, cleanMsg, cleanStk, buildLogContext({ ...req, message: cleanMsg, stack: cleanStk, context: cleanCtx }));
      }),

      // FIX #1 EXCEPTION: unauthenticated error reporting for pages with no session.
      // Covers: Login page crashes, Consent page errors, Announce page errors.
      // Protected by: (a) RATE_LIMITED_ACTIONS per-IP rate limit (20/min, index.js),
      //               (b) per-IP rate limit inside errorLog.js (isLogErrorRateLimited),
      //               (c) 4096-byte body size limit (enforced above before JSON.parse),
      //               (d) XSS detection and HTML sanitization inside reportErrorPublic.
      reportErrorPublic: () => reportErrorPublic(
        env,
        req.source, req.page, req.message, req.stack,
        typeof req.context === 'string' ? req.context : (req.context ? JSON.stringify(req.context) : ''),
        edgeIp
      ),

      reportErrorToWhatsApp: () => reportErrorToWhatsApp(env, req.errorId),
      getErrorLog: () => withAuth(env, req, (user) => getErrorLog(env, user, req.limit)),
      // AI auto-fix (Superadmin-only; enforced inside each handler). PR-1 scope:
      // generate a fix + preview it. Branch/PR is PR-2, CI retry is PR-3.
      generateAiFix: () => withAuth(env, req, (user) => generateAiFix(env, req.errorId, user)),
      getAiFixes: () => withAuth(env, req, (user) => getAiFixes(env, user, req.errorId)),
      getAiFix: () => withAuth(env, req, (user) => getAiFix(env, user, req.fixId)),
      createAiFixPr: () => withAuth(env, req, (user) => createAiFixPr(env, req.fixId, user)),
      // AI Management tab — multi-provider config (Superadmin-only inside each).
      getAiProviders: () => withAuth(env, req, (user) => getAiProviders(env, user)),
      saveAiProvider: () => withAuth(env, req, (user) => saveAiProvider(env, req, user)),
      deleteAiProvider: () => withAuth(env, req, (user) => deleteAiProvider(env, req.providerId, user)),
      setDefaultAiProvider: () => withAuth(env, req, (user) => setDefaultAiProvider(env, req.providerId, user)),
      testAiProvider: () => withAuth(env, req, (user) => testAiProvider(env, req.providerId, user)),

      // ---- Loan message templates (Superadmin) — fully ported, see loans.js ----
      getLoanTemplates: () => withAuth(env, req, (user) => { requireSuperadmin(user); return loans.getLoanTemplates(env, req.type); }),
      addLoanTemplate: () => withAuth(env, req, (user) => loans.addLoanTemplate(env, req.type, req.text, req.messageType, req.fileLink, user)),
      updateLoanTemplate: () => withAuth(env, req, (user) => loans.updateLoanTemplate(env, req.rowIndex, req.text, req.active, req.messageType, req.fileLink, user)),
      deleteLoanTemplate: () => withAuth(env, req, (user) => loans.deleteLoanTemplate(env, req.rowIndex, user)),

      // ---- WhatsApp: Queue polling (apiKey-based, external automation script) ----
      getPendingMessages: () => withApiKey(env, req, () => wa.getPendingMessages(env, req.limit)), // withApiKey is async (M-6); the router awaits every handler
      // Surfaces messages that were queued but never reached sent/failed, so a
      // dead external sender or a rotated API key is VISIBLE instead of silently
      // piling up 'pending' rows nobody looks at.
      getStuckMessages: () => withAuth(env, req, (user) => { requireSuperadmin(user); return wa.getStuckMessages(env, req.olderThanMinutes); }),
      updateMessageStatus: () => withApiKey(env, req, () => wa.updateMessageStatus(env, req.type, req.message_id, req.status, req.remarks)),
      resendMessage: () => withAuth(env, req, (user) => wa.resendMessage(env, req.type, req.message_id, user)),

      // ---- Email (Resend) queue admin (Superadmin) ----
      getEmailLog: () => withAuth(env, req, (user) => { requireSuperadmin(user); return email.getEmailLog(env); }),
      getStuckEmails: () => withAuth(env, req, (user) => { requireSuperadmin(user); return email.getStuckEmails(env, req.olderThanMinutes); }),
      resendEmail: () => withAuth(env, req, (user) => email.resendEmail(env, req.message_id, user)),

      // ---- Official mailbox (chhath@shaharpura.com) — Superadmin ----
      listOfficialEmails: () => withAuth(env, req, (user) => officialMail.listOfficialEmails(env, req.box, { limit: req.limit }, user)),
      getOfficialEmail: () => withAuth(env, req, (user) => officialMail.getOfficialEmail(env, req.message_id, user)),
      sendOfficialEmail: () => withAuth(env, req, (user) => officialMail.sendOfficialEmail(env, { to: req.to, cc: req.cc, subject: req.subject, body: req.body, attachments: req.attachments }, user)),
      replyOfficialEmail: () => withAuth(env, req, (user) => officialMail.replyOfficialEmail(env, { messageId: req.message_id, body: req.body, attachments: req.attachments }, user)),
      markOfficialEmailRead: () => withAuth(env, req, (user) => officialMail.markOfficialEmailRead(env, req.message_id, user)),

      // ---- Data cleanup (Superadmin) ----
      cleanupPreview: () => withAuth(env, req, (user) => cleanupPreview(env, req.target, req.mode, req.days, user)),
      cleanupData: () => withAuth(env, req, (user) => cleanupData(env, req.target, req.mode, req.days, user)),

      // ---- WhatsApp: Diagnostic endpoint (Superadmin only) ----
      whatsappDiagnostic: () => withAuth(env, req, async (user) => {
        // The comment above said "Superadmin only" but no check existed, so any
        // authenticated Subadmin could dump every template, group JID and message
        // preview.
        requireSuperadmin(user);
        const allGroups = await getSheetDataAsJSON(env, 'WHATSAPP_GROUPS');
        const allGroupTemplates = await getSheetDataAsJSON(env, 'GROUP_MESSAGE_TEMPLATES');
        const allPersonTemplates = await getSheetDataAsJSON(env, 'PERSON_MESSAGE_TEMPLATES');
        
        // Was a 4th inline copy of isTruthyFlag that would drift from the real
        // one — import the single implementation instead.
        const checkActive = wa.isTruthyFlag;
        
        const activeGroups = allGroups.filter(g => checkActive(g.active));
        const activeGroupTemplates = allGroupTemplates.filter(t => checkActive(t.active));
        const activePersonTemplates = allPersonTemplates.filter(t => checkActive(t.active));
        
        // Count templates by contribution type
        const countByType = (templates) => {
          const counts = { '1': 0, '2': 0, '3': 0, '4': 0 };
          templates.forEach(t => {
            if (!checkActive(t.active)) return;
            const num = parseFloat(t.contribution_type);
            const type = isNaN(num) ? '1' : Math.floor(num).toString();
            if (counts[type] !== undefined) counts[type]++;
          });
          return counts;
        };
        
        return {
          summary: {
            totalGroups: allGroups.length,
            activeGroups: activeGroups.length,
            totalGroupTemplates: allGroupTemplates.length,
            activeGroupTemplates: activeGroupTemplates.length,
            totalPersonTemplates: allPersonTemplates.length,
            activePersonTemplates: activePersonTemplates.length,
            groupTemplatesByType: countByType(allGroupTemplates),
            personTemplatesByType: countByType(allPersonTemplates)
          },
          groups: allGroups.map(g => ({
            group_name: g.group_name,
            groupid: g.groupid,
            active: g.active,
            active_type: typeof g.active,
            is_active: checkActive(g.active)
          })),
          groupTemplates: allGroupTemplates.map(t => ({
            template_id: t.template_id,
            contribution_type: t.contribution_type,
            contribution_type_typeof: typeof t.contribution_type,
            active: t.active,
            active_type: typeof t.active,
            is_active: checkActive(t.active),
            message_type: t.message_type,
            text_preview: (t.text || '').slice(0, 50)
          })),
          personTemplates: allPersonTemplates.map(t => ({
            template_id: t.template_id,
            contribution_type: t.contribution_type,
            contribution_type_typeof: typeof t.contribution_type,
            active: t.active,
            active_type: typeof t.active,
            is_active: checkActive(t.active),
            message_type: t.message_type,
            doc_sub_type: t.doc_sub_type,
            file_doc_type: t.file_doc_type,
            text_preview: (t.text || '').slice(0, 50)
          })),
          issues: [
            ...(activeGroups.length === 0 ? ['⚠️ No active WhatsApp groups configured'] : []),
            ...(activeGroupTemplates.length === 0 ? ['⚠️ No active group message templates'] : []),
            ...(activePersonTemplates.length === 0 ? ['⚠️ No active person message templates'] : []),
            ...(countByType(allGroupTemplates)['1'] === 0 ? ['⚠️ No group template for type 1 (Cash Receipt)'] : []),
            ...(countByType(allPersonTemplates)['1'] === 0 ? ['⚠️ No person template for type 1 (Cash Receipt)'] : [])
          ]
        };
      }),

      // ---- Announcement Portal ----
      generateAnnouncementLink: () => withAuth(env, req, (user) => announce.generateAnnouncementLink(env, req.year, req.pin, req.expiresAt, user)),
      getAnnouncementLinks: () => withAuth(env, req, (user) => announce.getAnnouncementLinks(env, user)),
      revokeAnnouncementLink: () => withAuth(env, req, (user) => announce.revokeAnnouncementLink(env, req.token, user)),
      getCustomAnnouncements: () => withAuth(env, req, (user) => announce.getCustomAnnouncements(env, req.year, user)),
      addCustomAnnouncement: () => withAuth(env, req, (user) => announce.addCustomAnnouncement(env, req.year, req.textHindi, req.textEnglish, req.priority, user)),
      updateCustomAnnouncement: () => withAuth(env, req, (user) => announce.updateCustomAnnouncement(env, req.id, req.textHindi, req.textEnglish, req.priority, user)),
      deleteCustomAnnouncement: () => withAuth(env, req, (user) => announce.deleteCustomAnnouncement(env, req.id, user)),
      // audit H-17: the PIN-failure lockout is now scoped to the caller, so a
      // link-holder cannot lock the whole committee out. `req.serverIp` is the
      // Cloudflare edge IP (CF-Connecting-IP, set above) — the one value the
      // caller cannot forge.
      verifyAnnouncementPin: () => announce.verifyAnnouncementPin(env, req.token, req.pin, req.serverIp),
      getAnnouncementQueue: () => announce.getAnnouncementQueue(env, req.announceToken, req.statusFilter, req.typeFilter),
      markAnnounced: () => announce.markAnnounced(env, req.announceToken, req.itemId, req.itemType),
      reannounceAll: () => announce.reannounceAll(env, req.announceToken, req.typeFilter),
    };

    if (!handlers[action]) {
      // Previously returned silently, so a mis-configured client or a bot probing
      // the API left no trace anywhere.
      ctx.waitUntil(logError(env, 'backend', 'router', `Unknown action: ${action}`, '', buildLogContext(req)));
      return jsonOut({ success: false, message: 'Unknown action' }, request, env, 404);
    }

    try {
      let result;

      // ---- Phase 2 response cache (SHARED read actions only) ----
      // SAFETY: auth is verified LIVE here first (verifyToken), before any cache
      // read — so a cache hit can never bypass the session check. Only if the
      // session is valid do we consult the version-keyed cache; on a miss we run
      // the real handler (which verifies auth again via withAuth) and store the
      // successful result. If verifyToken throws/returns null we fall through to
      // the normal handler so it produces the exact same AuthError as before.
      const cacheParamFn = CACHEABLE_ACTIONS[action];
      let servedFromCacheable = false;
      if (cacheParamFn) {
        const authedUser = await verifyToken(env, req.token).catch(() => null);
        if (authedUser) {
          // SECURITY (audit H-1): a cache HIT returns WITHOUT invoking the handler,
          // so any role check that lives inside the handler is bypassed on a hit.
          // Every action in CACHEABLE_ACTIONS is a staff-level read, so the same
          // gate the handlers apply must also be applied here, BEFORE the cache is
          // consulted — otherwise adding a role check to a cached action would be
          // silently ineffective for as long as a cached copy exists.
          //
          // This is also why no per-role or per-user action may ever be added to
          // CACHEABLE_ACTIONS without putting the role into the cache key: the key
          // is (action, param, data-version) and carries no authorization dimension.
          requireStaffRole(authedUser);
          servedFromCacheable = true;
          const param = cacheParamFn(req);
          const version = await getDataVersion(env).catch(() => '0');
          const cached = await mgmtCacheGet(env, action, param, version);
          if (cached !== null) {
            result = cached; // cache HIT — no D1 work
          } else {
            result = await handlers[action]();
            // Only cache a real success (never an explicit {success:false}).
            if (!(result && result.success === false)) {
              ctx.waitUntil(mgmtCachePut(env, action, param, version, result));
            }
          }
        }
      }
      if (!servedFromCacheable) {
        result = await handlers[action]();
      }

      // Bump the public data-version after any successful write so the Public
      // portal's ETag changes and browsers/CDN revalidate. Reads are skipped.
      // A handler that returned an explicit failure ({success:false}) made no
      // change, so skip those too. Runs in the background — never delays or
      // fails the response.
      if (!READ_ONLY_ACTIONS.has(action) && !(result && result.success === false)) {
        ctx.waitUntil(bumpDataVersion(env));
      }
      // A handler that returned an explicit {success:false} (e.g. a bad login,
      // "no active group") is a business-level failure, not a server error —
      // surface it as 400 so infra sees it as a client-correctable outcome, not
      // a 200 "success". Everything else is a real 200.
      const status = (result && result.success === false) ? 400 : 200;

      // audit H-12: on a successful login, set the HttpOnly session + readable CSRF
      // cookies. `token` STAYS in the body (so the existing localStorage path is
      // unchanged); `csrf`/`ttlMs` are transport-only for the cookie, so strip them
      // from the body before serializing. On logout, clear the cookies.
      let setCookies = null;
      if (status === 200 && result && result.success && result.token && result.csrf) {
        const maxAge = Math.floor((result.ttlMs || 8 * 60 * 60 * 1000) / 1000);
        setCookies = buildSessionCookies(result.token, result.csrf, maxAge);
        delete result.csrf;
        delete result.ttlMs;
      } else if (action === 'logout') {
        setCookies = buildClearCookies();
      }

      // mgmt responses are per-caller/private — never let a browser/CDN cache them
      // across users (our own server-side KV cache is the only cache, and it only
      // holds shared read data).
      const resp = jsonOut(result, request, env, status, { 'Cache-Control': 'private, no-store' });
      if (setCookies) {
        try { for (const c of setCookies) resp.headers.append('Set-Cookie', c); }
        catch (e) { /* cookie set is best-effort — never fail the response */ }
      }
      return resp;
    } catch (err) {
      const status = err.authError ? 'authError' : (err.announceSessionExpired ? 'announceSessionExpired' : 'error');

      // THE BIG ONE: this catch never called logError. Backend errors reached the
      // error log ONLY because the mgmt React frontend echoed them back — so any
      // other caller (the Public portal, the external WhatsApp queue script using
      // withApiKey, curl, a bot) got a 200 JSON error and NOTHING was persisted.
      // err.stack was dropped too, which is why every backend-sourced row had an
      // empty stack.
      if (!isExpectedError(err) && !NO_SERVER_AUTOLOG.has(action)) {
        ctx.waitUntil(
          logError(env, 'backend', action || 'router', err.message || String(err), err.stack || '', buildLogContext(req))
        );
      }

      // SECURITY: only return the raw message for EXPECTED errors (Validation/
      // Permission/Auth) — those are safe, user-facing strings. Unexpected 500s
      // used to echo internal detail verbatim (D1 binding names, table/column
      // guesses, raw Google API error bodies) to any caller. Send a generic
      // message for those; the real message + stack still go to the error log
      // above for the committee to debug.
      // `err.userMessage` is the escape hatch for a server fault that still owes
      // the operator a specific sentence — chiefly "nothing was changed, your data
      // is safe" after an aborted write. It is a hand-written, leak-free string set
      // by InternalError(internalMessage, userMessage); the raw message + stack
      // still went to the error log above. Anything without one gets the generic
      // text, so an unexpected throw can never echo internal detail.
      const safeMessage = isExpectedError(err)
        ? (err.message || String(err))
        : (err.userMessage
          || 'Something went wrong on the server. Please try again; the committee has been notified.');
      return jsonOut(
        { success: false, message: safeMessage, [status]: true },
        request, env, httpStatusForError(err)
      );
    }
  },

  // ---- Cron Trigger (see wrangler.toml [triggers] crons) ----
  // Drains the Collection Queue: processes any `pending` collection_jobs rows
  // (PDF generation + WhatsApp queueing) that a save enqueued. Wrapped so a
  // failure is logged, never thrown — the scheduled handler must return cleanly.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      cq.processPendingJobs(env).catch((err) =>
        logError(env, 'backend', 'scheduled:collectionQueue', err && err.message || String(err), err && err.stack || '', '')
      )
    );

    // ---- Email queue drain (Resend) ----
    // Unlike WhatsApp (drained by an external poller), email is sent by the Worker
    // itself: claim pending email_messages rows and POST each to Resend. No-op when
    // RESEND_API_KEY is unset. Never throws — logged if it does.
    ctx.waitUntil(
      email.processPendingEmails(env).catch((err) =>
        logError(env, 'backend', 'scheduled:emailQueue', err && err.message || String(err), err && err.stack || '', '')
      )
    );

    // ---- Data retention sweep (audit M-38) ----
    // Nothing in this portal ever deleted anything, so collection_jobs.filled_base64
    // (a complete filled .docx per COLLECTION save) accumulated forever in D1 — the
    // fastest route to the 5 GB free-tier storage limit, and pure dead weight once
    // the PDF exists. activity_log, login_attempts, user_sessions and the WhatsApp
    // message history grew without bound too.
    //
    // The cron fires every minute, but a DELETE counts against D1's 100,000
    // rows-written-per-day limit, so the sweep runs on ONE minute of each hour and
    // every statement is individually bounded. It never throws — see retention.js.
    if (shouldSweepNow()) {
      ctx.waitUntil(
        runRetentionSweep(env).then((report) => {
          const touched = Object.keys(report).length;
          if (!touched) return; // the steady state — stay silent
          return logWarn(env, 'backend', 'scheduled:retention',
            `Retention sweep removed old data: ${JSON.stringify(report)}`, report);
        }).catch((err) =>
          logError(env, 'backend', 'scheduled:retention', err && err.message || String(err), err && err.stack || '', '')
        )
      );
    }
  },
};
