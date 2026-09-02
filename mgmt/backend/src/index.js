import { login, doLogout, withAuth, withApiKey, requireSuperadmin, requireAdminOrAbove, requireStaffRole, getLockedYearsSet, lockYear, unlockYear } from './auth.js';
import { getSheetDataAsJSON, saveRecord, updateRecordByIdx, deleteRecordByIdx } from './crud.js';
import { getYears, addYear, getHomeData, getLoansData, getExpensesData, getCommitteeData, getUserHistory, getYearContributors, getUserProfile } from './views.js';
import { getLoginUsers, addLoginUser, updateLoginUser, deleteLoginUser, updateOwnProfile, changePassword, uploadFileToDrive } from './account.js';
import { getDropdownList, getAllDropdownLists, addDropdownListItem, updateDropdownListItem, deleteDropdownListItem } from './dropdownLists.js';
import { getFestivalDates, saveFestivalDates, getPortalSetting, setPortalSetting, getConsentPageTemplate, updateConsentPageTemplate } from './settings.js';
import * as wa from './whatsapp.js';
import { logError, reportErrorToWhatsApp, getErrorLog } from './errorLog.js';
import * as popups from './popups.js';
import * as announce from './announcements.js';
import * as loans from './loans.js';
import * as tpl from './templates.js';
import * as docx from './docxTemplates.js';
import * as storage from './storage.js';
import * as backup from './backup.js';
import * as cq from './collectionQueue.js';
import { bumpDataVersion } from './dataVersion.js';

// Actions that only READ — after any OTHER successful action we bump the public
// data-version counter so the Public portal's ETag changes and cached copies are
// revalidated. Keeping the READ list (rather than a WRITE list) is the safe
// default: a new action that isn't listed here is treated as a write and simply
// causes one extra (harmless) public revalidation. Anything that can change data
// the public portal renders MUST NOT be added here.
const READ_ONLY_ACTIONS = new Set([
  'logout',
  'getYears', 'getUsers', 'getCommittee', 'getHome', 'getExpenses', 'getLoans',
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
  'getCollectionQueueStatus',
  'getPopups', 'getPopupWithSlides', 'getActivePopups', 'previewPublicPopups',
  'logError', 'reportErrorToWhatsApp', 'getErrorLog',
  'getLoanTemplates',
  'getPendingMessages', 'getStuckMessages',
  'whatsappDiagnostic',
  'getAnnouncementLinks', 'getCustomAnnouncements', 'getAnnouncementQueue',
  // OTP request/verify only touch consent-flow state, not public-portal data.
  'requestConsentOtp', 'verifyConsentOtp', 'verifyAnnouncementPin',
]);

// SECURITY (audit S5): actions reachable WITHOUT a session token (the public
// consent + announcement pages, error reporting, and the external WhatsApp queue
// key endpoints). These get a per-IP rate limit since there is no login/role gate
// in front of them. Authenticated actions are intentionally NOT listed — they are
// protected by the session + role checks, and login/OTP already have their own
// dedicated attempt caps in auth.js / loans.js.
const RATE_LIMITED_ACTIONS = new Set([
  'login',
  'logError', 'reportErrorToWhatsApp',
  'getConsentByToken', 'requestConsentOtp', 'verifyConsentOtp', 'respondConsent',
  'getDocxTemplatePublic', 'convertDocxToPdfPublic',
  'verifyAnnouncementPin', 'getAnnouncementQueue', 'markAnnounced', 'reannounceAll',
]);

// Fixed-window per-IP+action counter in KV. RATE_LIMIT_MAX requests per
// RATE_LIMIT_WINDOW_SECONDS. Best-effort: any KV error means "not limited" so a
// KV outage can never take the whole API offline (fail open).
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX = 40;
async function isRateLimited(env, ip, action) {
  if (!env || !env.KV_SESSIONS) return false;
  const bucket = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000));
  const key = `rl:${action}:${ip}:${bucket}`;
  const current = parseInt((await env.KV_SESSIONS.get(key)) || '0', 10) || 0;
  if (current >= RATE_LIMIT_MAX) return true;
  // TTL slightly longer than the window so the key self-expires.
  await env.KV_SESSIONS.put(key, String(current + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS + 5 });
  return false;
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
function allowedOrigin(request, env) {
  const configured = (env && env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.toString() : '').trim();
  if (!configured) return '*';
  const list = configured.split(',').map(s => s.trim()).filter(Boolean);
  if (list.includes('*')) return '*';
  const origin = (request.headers.get('Origin') || '').trim();
  return origin && list.includes(origin) ? origin : list[0]; // deny unknown origins by pinning to the first allowed one
}

function corsHeaders(request, env, extra) {
  const origin = allowedOrigin(request, env);
  const headers = { 'Access-Control-Allow-Origin': origin, ...(extra || {}) };
  // When we echo a specific origin (not '*'), caches must vary on Origin.
  if (origin !== '*') headers['Vary'] = 'Origin';
  return headers;
}

function jsonOut(obj, request, env) {
  return new Response(JSON.stringify(obj), {
    headers: corsHeaders(request, env, { 'Content-Type': 'application/json' }),
  });
}

function notImplemented(name, hint) {
  return () => { throw new Error(`${name} is not yet ported to the Worker — see MIGRATION_NOTES.md ("Not yet ported") for status. ${hint || ''}`); };
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
    clientIp: req.serverIp || '',
    clientIpReported: req.clientIp || '',
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
const NO_SERVER_AUTOLOG = new Set(['logError', 'reportErrorToWhatsApp', 'getErrorLog']);

// Errors that are normal operation, not defects: an expired session, a permission
// refusal, a user-facing validation message.
//
// This used to only check authError/announceSessionExpired, so every
// PermissionError ("Sirf Superadmin ye action kar sakta hai") and every
// validation message ("Galat PIN", "OTP galat hai", "Ye Email pehle se
// registered hai") became an Error Log row. The live log had 278 rows of which
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
          'Access-Control-Allow-Headers': 'Content-Type',
        }),
      });
    }
    if (request.method === 'GET') {
      return jsonOut({ status: 'ok', message: 'Chhath Puja Management API is live (Cloudflare Worker)' }, request, env);
    }

    let req;
    try {
      req = await request.json();
    } catch (e) {
      // Was returned with nothing persisted, so a bot or a broken client hammering
      // the API was completely invisible.
      ctx.waitUntil(logError(env, 'backend', 'router', 'Invalid JSON body: ' + (e && e.message), '', ''));
      return jsonOut({ success: false, message: 'Invalid JSON body' }, request, env);
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

    // SECURITY (audit S5): lightweight per-IP rate limit on UNAUTHENTICATED /
    // public actions (the authenticated ones are already gated by login + role,
    // and login/OTP have their own dedicated caps). Uses KV with a short TTL as a
    // fixed-window counter — best-effort, fails OPEN if KV is unavailable so a KV
    // hiccup never takes the API down.
    if (edgeIp && RATE_LIMITED_ACTIONS.has(action)) {
      const limited = await isRateLimited(env, edgeIp, action).catch(() => false);
      if (limited) {
        return jsonOut(
          { success: false, message: 'Bahut zyada requests. Thodi der baad koshish karein.' },
          request, env
        );
      }
    }

    const handlers = {
      // Login failures (wrong password, unknown user, the 5-attempt lockout) used
      // to return {success:false} with NO logging on either side — api.js also
      // excluded 'login' from auto-logging — so there was zero brute-force
      // visibility. The identifier is recorded; the password never is.
      login: async () => {
        const res = await login(env, req.name, req.password, req.rememberMe);
        // Only the LOCKOUT is logged, not every wrong password. Logging each
        // failed attempt flooded the log while telling nobody anything; the
        // lockout is the actual security signal worth a Superadmin's attention.
        if (res && res.success === false && res.lockedOut) {
          ctx.waitUntil(logError(
            env, 'auth', 'login',
            `Login LOCKED OUT after repeated failures for "${(req.name || '').toString().slice(0, 60)}"`,
            '', buildLogContext(req)
          ));
        }
        return res;
      },
      logout: () => withAuth(env, req, (user) => doLogout(env, req.token)),
      getYears: () => withAuth(env, req, () => getYears(env)),
      getUsers: () => withAuth(env, req, () => getSheetDataAsJSON(env, 'USERS')),
      getCommittee: () => withAuth(env, req, () => getCommitteeData(env, req.year)),
      getHome: () => withAuth(env, req, () => getHomeData(env, req.year)),
      getExpenses: () => withAuth(env, req, () => getExpensesData(env, req.year)),
      getLoans: () => withAuth(env, req, () => getLoansData(env, req.year)),
      getUserHistory: () => withAuth(env, req, () => getUserHistory(env, req.userId)),
      getUserProfile: () => withAuth(env, req, () => getUserProfile(env, req.userId)),
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

      saveRecord: () => withAuth(env, req, (user) => saveRecord(env, req.sheet, req.payload, user)),
      queueCollectionMessages: () => withAuth(env, req, (user) => wa.queueCollectionMessages(env, req.payload, req.rowIndex, req.fileLink, user)),
      updateRecord: () => withAuth(env, req, (user) => updateRecordByIdx(env, req.sheet, req.rowIndex, req.payload, user)),
      deleteRecord: () => withAuth(env, req, (user) => deleteRecordByIdx(env, req.sheet, req.rowIndex, user)),

      // ---- Loans (full consent/OTP/guarantor flow ported — see loans.js) ----
      saveLoan: () => withAuth(env, req, (user) => loans.saveLoanTransaction(env, req.loan, req.guarantors, user)),
      deleteLoan: () => withAuth(env, req, (user) => loans.deleteLoanTransaction(env, req.rowIndex, req.year, req.loanerId, user, req.loanId)),

      uploadFile: () => withAuth(env, req, () => uploadFileToDrive(env, req.base64, req.fileName, req.mimeType)),

      // ---- WhatsApp: Templates (Superadmin only) ----
      getPersonTemplates: () => withAuth(env, req, (user) => { requireSuperadmin(user); return getSheetDataAsJSON(env, 'PERSON_MESSAGE_TEMPLATES'); }),
      addPersonTemplate: () => withAuth(env, req, (user) => wa.addTemplate(env, 'PERSON_MESSAGE_TEMPLATES', req.text, req.messageType, req.contributionType, req.fileLink, req.docSubType, req.fileDocType, user)),
      updatePersonTemplate: () => withAuth(env, req, (user) => wa.updateTemplate(env, 'PERSON_MESSAGE_TEMPLATES', req.rowIndex, req.text, req.active, req.messageType, req.contributionType, req.fileLink, req.docSubType, req.fileDocType, user)),
      deletePersonTemplate: () => withAuth(env, req, (user) => wa.deleteTemplate(env, 'PERSON_MESSAGE_TEMPLATES', req.rowIndex, user)),
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

      // ---- Dropped: D1 schema has all bilingual columns from day one, nothing to backfill ----
      ensureColumns: () => withAuth(env, req, (user) => { requireSuperadmin(user); return { success: true, report: { note: 'Not needed on D1 — schema already has every column.' } }; }),
      bulkFillHindi: notImplemented('bulkFillHindi', 'One-time backfill utility — confirm with Vhhb whether any real backfill work remains before porting, or drop entirely.'),

      // ---- Loan Consent — PUBLIC + Admin (fully ported — see loans.js) ----
      getConsentByToken: () => loans.getConsentByToken(env, req.token),
      requestConsentOtp: () => loans.requestConsentOtp(env, req.token),
      verifyConsentOtp: () => loans.verifyConsentOtp(env, req.token, req.otp),
      respondConsent: () => loans.respondConsent(env, req.token, req.decision, req.deviceId, req.deviceInfo, req.clientIp, req.geoLat, req.geoLng, req.geoAccuracy, req.photoBase64, req.signatureBase64, req.declineRemarks),
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

      // ---- Consent Page Templates ----
      getConsentPageTemplate: () => withAuth(env, req, (user) => { requireSuperadmin(user); return getConsentPageTemplate(env, req.type); }),
      updateConsentPageTemplate: () => withAuth(env, req, (user) => updateConsentPageTemplate(env, req.type, req.text, user)),

      // ---- Receipt / Certificate / Samaan Templates + DOCX templates + PDF
      // conversion — fully ported (see templates.js / docxTemplates.js / drive.js).
      // The docx->pdf leg needs your real Drive service-account credential
      // (DRIVE_SA_EMAIL/DRIVE_SA_PRIVATE_KEY/DRIVE_ROOT_FOLDER_ID) to actually
      // test — see account.js's getDriveAccessToken() ----
      getReceiptTemplates: () => withAuth(env, req, () => tpl.getTemplates(env, 'receipt')),
      getReceiptTemplate: () => withAuth(env, req, () => tpl.getTemplate(env, 'receipt', req.year)),
      saveReceiptTemplate: () => withAuth(env, req, (user) => tpl.saveTemplate(env, 'receipt', req.year, req.text, req.pageSize, user)),
      copyReceiptTemplate: () => withAuth(env, req, (user) => tpl.copyTemplate(env, 'receipt', req.fromYear, req.toYear, user)),
      deleteReceiptTemplate: () => withAuth(env, req, (user) => tpl.deleteTemplate(env, 'receipt', req.year, user)),
      getReceiptData: () => withAuth(env, req, (user) => tpl.getReceiptData(env, req.rowIndex, req.year, user)),
      getCertificateTemplates: () => withAuth(env, req, () => tpl.getTemplates(env, 'certificate')),
      getCertificateTemplate: () => withAuth(env, req, () => tpl.getTemplate(env, 'certificate', req.year)),
      saveCertificateTemplate: () => withAuth(env, req, (user) => tpl.saveTemplate(env, 'certificate', req.year, req.text, req.pageSize, user)),
      copyCertificateTemplate: () => withAuth(env, req, (user) => tpl.copyTemplate(env, 'certificate', req.fromYear, req.toYear, user)),
      deleteCertificateTemplate: () => withAuth(env, req, (user) => tpl.deleteTemplate(env, 'certificate', req.year, user)),
      getCertificateData: () => withAuth(env, req, (user) => tpl.getCertificateData(env, req.rowIndex, req.year, user)),
      getSamaanTemplates: () => withAuth(env, req, () => tpl.getTemplates(env, 'samaan')),
      getSamaanTemplate: () => withAuth(env, req, () => tpl.getTemplate(env, 'samaan', req.year)),
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
      convertDocxToPdf: () => withAuth(env, req, (user) => docx.convertDocxToPdf(env, req.docType, req.year, req.recordId, req.base64, req.fileName, user, req.mode, { force: !!req.force })),
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
      restoreBackup: () => withAuth(env, req, (user) => backup.restoreBackup(env, user, req.backup, req.confirm)),

      // ---- Collection Queue (background PDF + WhatsApp) ----
      // enqueueCollectionJob: called right after a COLLECTION save so the browser
      // doesn't have to wait for PDF conversion + WhatsApp queueing (a Cron
      // Trigger does those — see scheduled() below). getCollectionQueueStatus is
      // a read-only status panel available to any staff role.
      enqueueCollectionJob: () => withAuth(env, req, (user) => cq.enqueueCollectionJob(env, req.job, user)),
      getCollectionQueueStatus: () => withAuth(env, req, (user) => cq.getCollectionQueueStatus(env, user)),
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
      // logError stays intentionally unauthenticated: the Consent and Announce
      // pages are no-login pages and must be able to report their own failures.
      // The abuse surface is now closed by (a) de-duplication inside logger.js so
      // a flood collapses into one row, and (b) the hourly cap inside
      // reportErrorToWhatsApp so nobody can spam every Superadmin's WhatsApp.
      logError: () => logError(env, req.source, req.page, req.message, req.stack, buildLogContext(req)),
      reportErrorToWhatsApp: () => reportErrorToWhatsApp(env, req.errorId),
      getErrorLog: () => withAuth(env, req, (user) => getErrorLog(env, user, req.limit)),

      // ---- Loan message templates (Superadmin) — fully ported, see loans.js ----
      getLoanTemplates: () => withAuth(env, req, (user) => { requireSuperadmin(user); return loans.getLoanTemplates(env, req.type); }),
      addLoanTemplate: () => withAuth(env, req, (user) => loans.addLoanTemplate(env, req.type, req.text, req.messageType, req.fileLink, user)),
      updateLoanTemplate: () => withAuth(env, req, (user) => loans.updateLoanTemplate(env, req.rowIndex, req.text, req.active, req.messageType, req.fileLink, user)),
      deleteLoanTemplate: () => withAuth(env, req, (user) => loans.deleteLoanTemplate(env, req.rowIndex, user)),

      // ---- WhatsApp: Queue polling (apiKey-based, external automation script) ----
      getPendingMessages: () => withApiKey(env, req, () => wa.getPendingMessages(env, req.limit)),
      // Surfaces messages that were queued but never reached sent/failed, so a
      // dead external sender or a rotated API key is VISIBLE instead of silently
      // piling up 'pending' rows nobody looks at.
      getStuckMessages: () => withAuth(env, req, (user) => { requireSuperadmin(user); return wa.getStuckMessages(env, req.olderThanMinutes); }),
      updateMessageStatus: () => withApiKey(env, req, () => wa.updateMessageStatus(env, req.type, req.message_id, req.status, req.remarks)),
      resendMessage: () => withAuth(env, req, (user) => wa.resendMessage(env, req.type, req.message_id, user)),
      
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
      verifyAnnouncementPin: () => announce.verifyAnnouncementPin(env, req.token, req.pin),
      getAnnouncementQueue: () => announce.getAnnouncementQueue(env, req.announceToken, req.statusFilter, req.typeFilter),
      markAnnounced: () => announce.markAnnounced(env, req.announceToken, req.itemId, req.itemType),
      reannounceAll: () => announce.reannounceAll(env, req.announceToken, req.typeFilter),
    };

    if (!handlers[action]) {
      // Previously returned silently, so a mis-configured client or a bot probing
      // the API left no trace anywhere.
      ctx.waitUntil(logError(env, 'backend', 'router', `Unknown action: ${action}`, '', buildLogContext(req)));
      return jsonOut({ success: false, message: 'Unknown action' }, request, env);
    }

    try {
      const result = await handlers[action]();
      // Bump the public data-version after any successful write so the Public
      // portal's ETag changes and browsers/CDN revalidate. Reads are skipped.
      // A handler that returned an explicit failure ({success:false}) made no
      // change, so skip those too. Runs in the background — never delays or
      // fails the response.
      if (!READ_ONLY_ACTIONS.has(action) && !(result && result.success === false)) {
        ctx.waitUntil(bumpDataVersion(env));
      }
      return jsonOut(result, request, env);
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

      return jsonOut({ success: false, message: err.message || String(err), [status]: true }, request, env);
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
  },
};
