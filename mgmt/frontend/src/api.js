const API_URL = import.meta.env.VITE_API_URL;
import { getDeviceId, getDeviceInfo } from './device.js';

const TOKEN_KEY = 'cpm_token';
const EXPIRY_KEY = 'cpm_token_expiry';
const REMEMBER_KEY = 'cpm_remember';
const USER_KEY = 'cpm_user';

// audit H-12: read the readable CSRF cookie (cpm_csrf) the backend sets at login,
// so call() can echo it in the X-CSRF-Token header (double-submit CSRF check). The
// session cookie itself is HttpOnly and never readable here — only the backend
// reads that. Returns '' if the cookie isn't present (e.g. cookies disabled), in
// which case the body token still authenticates.
function csrfFromCookie() {
  try {
    const m = document.cookie.match(/(?:^|;\s*)cpm_csrf=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : '';
  } catch (e) { return ''; }
}

function activeStore() {
  return localStorage.getItem(REMEMBER_KEY) === '1' ? localStorage : sessionStorage;
}

export function saveSession({ token, expiresAt, name, role }, remember) {
  localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
  const store = remember ? localStorage : sessionStorage;
  store.setItem(TOKEN_KEY, token);
  store.setItem(EXPIRY_KEY, String(expiresAt));
  store.setItem(USER_KEY, JSON.stringify({ name, role }));
}

export function getSession() {
  const store = activeStore();
  const token = store.getItem(TOKEN_KEY);
  const expiry = Number(store.getItem(EXPIRY_KEY) || 0);
  if (!token || Date.now() > expiry) {
    clearSession();
    return null;
  }
  const user = JSON.parse(store.getItem(USER_KEY) || 'null');
  return { token, user };
}

export function clearSession() {
  [localStorage, sessionStorage].forEach(s => {
    s.removeItem(TOKEN_KEY);
    s.removeItem(EXPIRY_KEY);
    s.removeItem(USER_KEY);
  });
  localStorage.removeItem(REMEMBER_KEY);
}

// 'login' was in this list too, which — combined with the backend also not
// logging — meant wrong passwords, unknown users and the 5-attempt lockout were
// COMPLETELY invisible: zero brute-force visibility. The backend now logs login
// failures itself (see index.js), so the client still skips it to avoid a
// duplicate row, but the event is no longer lost.
const NO_AUTOLOG_ACTIONS = ['logError', 'reportErrorToWhatsApp', 'login', 'verifyGoogleLogin'];

// Noise produced by browser extensions and by the browser itself — never our bug.
// The live log had "Failed to connect to MetaMask" rows from a crypto wallet
// extension injecting itself into the consent page.
const IGNORED_ERROR_PATTERNS = [
  /MetaMask/i,
  /ethereum/i,
  /chrome-extension:/i,
  /moz-extension:/i,
  /safari-extension:/i,
  /ResizeObserver loop/i,          // benign browser warning
  /Non-Error promise rejection/i,
];
export function isIgnorableClientError(message) {
  const m = (message || '').toString();
  return IGNORED_ERROR_PATTERNS.some(re => re.test(m));
}

// A single outage produced 10-15 rows (one per in-flight action: getYears,
// getHome, getUsers, getCommittee, ...). Because dedup keys on the message and
// each message carried its own action name, they never collapsed. Transport
// failures are now reported once per minute under one shared message.
const TRANSPORT_ERROR_RE = /Failed to fetch|NetworkError|Load failed|network error|ERR_NETWORK|ERR_INTERNET/i;
let lastTransportReportAt = 0;
const TRANSPORT_REPORT_WINDOW_MS = 60000;

// The log POST itself needs a working network, so `TypeError: Failed to fetch`
// (offline / Worker down / CORS) could never be recorded — which is exactly when
// things are most broken. Failed sends are now buffered in sessionStorage and
// flushed on the next successful call / when the tab regains connectivity.
const PENDING_LOG_KEY = 'cpm_pending_error_logs';
const MAX_BUFFERED_LOGS = 20;

function bufferLog(body) {
  try {
    const buf = JSON.parse(sessionStorage.getItem(PENDING_LOG_KEY) || '[]');
    buf.push(body);
    sessionStorage.setItem(PENDING_LOG_KEY, JSON.stringify(buf.slice(-MAX_BUFFERED_LOGS)));
  } catch (e) { /* storage full or blocked (Safari private mode) — nothing else to try */ }
}

export function flushBufferedLogs() {
  let buf = [];
  try {
    buf = JSON.parse(sessionStorage.getItem(PENDING_LOG_KEY) || '[]');
    if (!buf.length) return;
    sessionStorage.removeItem(PENDING_LOG_KEY);
  } catch (e) { return; }
  buf.forEach(body => {
    fetch(API_URL, { method: 'POST', body: JSON.stringify(body) }).catch(() => bufferLog(body));
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', flushBufferedLogs);
}

function fireAndForgetLogError(source, message, stack, context) {
  try {
    if (isIgnorableClientError(message)) return;

    // Collapse a burst of transport failures (one outage != 15 error rows).
    if (TRANSPORT_ERROR_RE.test(message)) {
      const now = Date.now();
      if (now - lastTransportReportAt < TRANSPORT_REPORT_WINDOW_MS) return;
      lastTransportReportAt = now;
      message = `Network/transport failure — could not connect to the server (${message})`;
    }
    const body = {
      action: 'logError',
      source,
      page: window.location.pathname,
      message,
      stack: stack || '',
      // Was hardcoded ''. The backend folds deviceId/deviceInfo/clientIp in on its
      // side; anything the caller knows goes here so "which admin, which device"
      // is finally answerable from the Error Log screen.
      context: context ? (typeof context === 'string' ? context : JSON.stringify(context)) : '',
      deviceId: getDeviceId(),
      deviceInfo: getDeviceInfo(),
    };
    fetch(API_URL, { method: 'POST', body: JSON.stringify(body) }).catch(() => bufferLog(body));
  } catch (e) { /* never let logging break anything */ }
}

async function call(action, params = {}, requireAuth = true) {
  // audit H-13: no `clientIp` is sent any more. It was fetched from a third-party
  // service (api.ipify.org), delayed the first request of every page load, and was
  // discarded server-side in favour of the unspoofable CF-Connecting-IP.
  const body = { action, ...params, deviceId: getDeviceId(), deviceInfo: getDeviceInfo() };
  // (csrfFromCookie is defined at module scope below)
  if (requireAuth) {
    const session = getSession();
    if (!session) {
      const err = new Error('Session expired, please login again');
      err.authError = true;
      throw err;
    }
    body.token = session.token;
  }
  try {
    // audit H-12/M-10: send JSON + credentials so the HttpOnly session cookie flows,
    // and echo the readable cpm_csrf cookie in the X-CSRF-Token header (double-submit
    // CSRF). We STILL send body.token (above) as a belt-and-suspenders fallback, so
    // if a browser drops third-party cookies (Safari ITP etc.) auth keeps working.
    const headers = { 'Content-Type': 'application/json' };
    const csrf = csrfFromCookie();
    if (csrf) headers['X-CSRF-Token'] = csrf;
    const res = await fetch(API_URL, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(body),
    });
    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      // Non-JSON body (an HTML error page from the CDN/host, a 502, etc.)
      throw new Error(`The server returned an invalid response (HTTP ${res.status}). Please try again in a little while.`);
    }

    // `data` can legitimately be NULL: getDocxTemplate() returns null when no
    // template exists for that (docType, year), and jsonOut(null) sends the body
    // "null". The old `data.authError` then threw
    //     "Cannot read properties of null (reading 'authError')"
    // — the single most frequent real error in production (12+ rows), firing on
    // the most ordinary path there is ("there is no template for this year"). Callers
    // already handle a null/empty template row, so pass it straight through.
    if (data === null || data === undefined) {
      flushBufferedLogs();
      return data;
    }

    if (data.authError) {
      clearSession();
      const err = new Error(data.message || 'Session expired');
      err.authError = true;
      // A forced logout / expired token used to be excluded from logging
      // entirely, so "everyone keeps getting logged out" was undiagnosable.
      // Logged at 'auth' severity so it's distinguishable from real defects.
      if (!NO_AUTOLOG_ACTIONS.includes(action)) {
        fireAndForgetLogError('auth', `[${action}] ${err.message}`, '');
      }
      throw err;
    }
    if (data.success === false) {
      const err = new Error(data.message || 'Request failed');
      Object.assign(err, data); // preserves extra flags like `expired` for callers that need them
      err.__logged = true;
      // The backend now logs its own failures (index.js top-level catch), so this
      // client-side echo would double up. Kept only for actions the backend
      // deliberately does not auto-log.
      throw err;
    }
    // A successful round trip proves the network is back — drain anything that
    // couldn't be delivered while it was down.
    flushBufferedLogs();
    return data;
  } catch (err) {
    // Pure client-side / transport failures (Failed to fetch, JSON parse, CORS).
    // The backend cannot possibly know about these, so this is the only place
    // they can be captured.
    if (!NO_AUTOLOG_ACTIONS.includes(action) && !err.__logged) {
      err.__logged = true;
      fireAndForgetLogError(err.authError ? 'auth' : 'frontend', `[${action}] ${err.message}`, err.stack || '');
    }
    throw err;
  }
}

// Explicit client-side error reporter for failures that never pass through
// call() — docxtemplater render errors, QR generation, canvas/jsPDF, file reads.
// Every one of those was previously invisible (caught into setError() only).
export function reportClientError(page, message, err, context) {
  fireAndForgetLogError(
    'frontend',
    `[${page}] ${message}${err && err.message ? ': ' + err.message : ''}`,
    (err && err.stack) || '',
    context
  );
}

export const api = {
  login: (name, password, rememberMe) => call('login', { name, password, rememberMe }, false),
  // Sign in with Google: send the Google ID token (JWT) the browser got from
  // Google Identity Services; the server verifies it and returns the same
  // { token, name, role, expiresAt } shape as `login`.
  verifyGoogleLogin: (idToken, rememberMe) => call('verifyGoogleLogin', { idToken, rememberMe }, false),
  logout: () => call('logout'),
  getYears: () => call('getYears'),
  // Tiny call used to decide whether the localStorage cache is still current.
  getDataVersion: () => call('getDataVersion'),
  getUsers: () => call('getUsers'),
  getCommittee: (year) => call('getCommittee', { year }),
  getHome: (year) => call('getHome', { year }),
  getExpenses: (year) => call('getExpenses', { year }),
  getLoans: (year) => call('getLoans', { year }),
  getLoanBudget: (year) => call('getLoanBudget', { year }),
  getUserHistory: (userId) => call('getUserHistory', { userId }),
  getUserProfile: (userId) => call('getUserProfile', { userId }),
  getYearContributors: (year) => call('getYearContributors', { year }),
  getLockedYears: () => call('getLockedYears'),
  lockYear: (year) => call('lockYear', { year }),
  unlockYear: (year) => call('unlockYear', { year }),
  addYear: (year) => call('addYear', { year }),
  updateOwnProfile: (payload) => call('updateOwnProfile', { payload }),
  changePassword: (currentPassword, newPassword) => call('changePassword', { currentPassword, newPassword }),

  // Active sessions / devices (any role — own devices)
  getMySessions: () => call('getMySessions'),
  revokeSession: (sessionId) => call('revokeSession', { sessionId }),
  revokeAllOtherSessions: () => call('revokeAllOtherSessions'),
  // Superadmin: view / force-logout any user's sessions
  getUserSessions: (targetName) => call('getUserSessions', { targetName }),
  revokeUserSession: (targetName, sessionId) => call('revokeUserSession', { targetName, sessionId }),
  // Superadmin: login audit + activity trail + locked accounts + unlock
  getLoginAttempts: (opts) => call('getLoginAttempts', opts || {}),
  getActivityLog: (opts) => call('getActivityLog', opts || {}),
  getLockedAccounts: () => call('getLockedAccounts'),
  revokeLock: (lockKey, targetName, ip) => call('revokeLock', { lockKey, targetName, ip }),
  revokeAllLocks: () => call('revokeAllLocks'),

  // Login Management (Superadmin)
  getLoginUsers: () => call('getLoginUsers', {}),
  addLoginUser: (userId, password, role, mobile, email) => call('addLoginUser', { userId, password, role, mobile, email }),
  updateLoginUser: (rowIndex, password, role, mobile, email) => call('updateLoginUser', { rowIndex, password, role, mobile, email }),
  deleteLoginUser: (rowIndex) => call('deleteLoginUser', { rowIndex }),
  saveRecord: (sheet, payload) => call('saveRecord', { sheet, payload }),
  // Superadmin CSV bulk import. `rows` is an array of objects keyed by CSV header.
  importCsvRows: (sheet, rows) => call('importCsvRows', { sheet, rows }),
  queueCollectionMessages: (payload, rowIndex, fileLink) => call('queueCollectionMessages', { payload, rowIndex, fileLink }),
  updateRecord: (sheet, rowIndex, payload) => call('updateRecord', { sheet, rowIndex, payload }),
  deleteRecord: (sheet, rowIndex) => call('deleteRecord', { sheet, rowIndex }),
  saveLoan: (loan, guarantors) => call('saveLoan', { loan, guarantors }),
  deleteLoan: (rowIndex, year, loanerId, loanId) => call('deleteLoan', { rowIndex, year, loanerId, loanId }),
  // audit L-5: api.uploadFile was removed — no caller anywhere in the app. The
  // backend `uploadFile` action stays (popup images use uploadPopupImage, which
  // shares the same Drive path) and is gated to Admin-or-above per H-7.

  // WhatsApp: Templates
  getPersonTemplates: () => call('getPersonTemplates'),
  addPersonTemplate: (text, messageType, contributionType, fileLink, docSubType, fileDocType) => call('addPersonTemplate', { text, messageType, contributionType, fileLink, docSubType, fileDocType }),
  updatePersonTemplate: (rowIndex, text, active, messageType, contributionType, fileLink, docSubType, fileDocType) => call('updatePersonTemplate', { rowIndex, text, active, messageType, contributionType, fileLink, docSubType, fileDocType }),
  deletePersonTemplate: (rowIndex) => call('deletePersonTemplate', { rowIndex }),
  getGroupTemplates: () => call('getGroupTemplates'),
  addGroupTemplate: (text, messageType, contributionType, fileLink, docSubType, fileDocType) => call('addGroupTemplate', { text, messageType, contributionType, fileLink, docSubType, fileDocType }),
  updateGroupTemplate: (rowIndex, text, active, messageType, contributionType, fileLink, docSubType, fileDocType) => call('updateGroupTemplate', { rowIndex, text, active, messageType, contributionType, fileLink, docSubType, fileDocType }),
  deleteGroupTemplate: (rowIndex) => call('deleteGroupTemplate', { rowIndex }),
  // Email (Resend) templates + queue
  getEmailTemplates: () => call('getEmailTemplates'),
  addEmailTemplate: (subject, text, messageType, contributionType, fileLink, docSubType, fileDocType) => call('addEmailTemplate', { subject, text, messageType, contributionType, fileLink, docSubType, fileDocType }),
  updateEmailTemplate: (rowIndex, subject, text, active, messageType, contributionType, fileLink, docSubType, fileDocType) => call('updateEmailTemplate', { rowIndex, subject, text, active, messageType, contributionType, fileLink, docSubType, fileDocType }),
  deleteEmailTemplate: (rowIndex) => call('deleteEmailTemplate', { rowIndex }),
  getStuckEmails: (olderThanMinutes) => call('getStuckEmails', { olderThanMinutes }),
  getEmailLog: () => call('getEmailLog'),
  resendEmail: (message_id) => call('resendEmail', { message_id }),
  // Official mailbox (chhath@shaharpura.com)
  listOfficialEmails: (box, limit) => call('listOfficialEmails', { box, limit }),
  getOfficialEmail: (message_id) => call('getOfficialEmail', { message_id }),
  sendOfficialEmail: (to, cc, subject, body, attachments) => call('sendOfficialEmail', { to, cc, subject, body, attachments }),
  replyOfficialEmail: (message_id, body, attachments) => call('replyOfficialEmail', { message_id, body, attachments }),
  markOfficialEmailRead: (message_id) => call('markOfficialEmailRead', { message_id }),
  // Data cleanup (Superadmin)
  cleanupPreview: (target, mode, days) => call('cleanupPreview', { target, mode, days }),
  cleanupData: (target, mode, days) => call('cleanupData', { target, mode, days }),
  // Loan email (Resend) templates
  getLoanEmailTemplates: (type) => call('getLoanEmailTemplates', { type }),
  addLoanEmailTemplate: (type, subject, text, messageType, fileLink) => call('addLoanEmailTemplate', { type, subject, text, messageType, fileLink }),
  updateLoanEmailTemplate: (rowIndex, subject, text, active, messageType, fileLink) => call('updateLoanEmailTemplate', { rowIndex, subject, text, active, messageType, fileLink }),
  deleteLoanEmailTemplate: (rowIndex) => call('deleteLoanEmailTemplate', { rowIndex }),

  // WhatsApp: Group Info
  getWhatsappGroups: () => call('getWhatsappGroups'),
  addWhatsappGroup: (groupName, groupid) => call('addWhatsappGroup', { groupName, groupid }),
  updateWhatsappGroup: (rowIndex, groupName, groupid, active) => call('updateWhatsappGroup', { rowIndex, groupName, groupid, active }),
  deleteWhatsappGroup: (rowIndex) => call('deleteWhatsappGroup', { rowIndex }),

  // WhatsApp: Message Log (view-only + Resend for failed)
  getMessageLog: () => call('getMessageLog'),
  resendMessage: (type, message_id) => call('resendMessage', { type, message_id }),
  // Messages queued but never delivered (dead external sender / rotated API key).
  getStuckMessages: (olderThanMinutes) => call('getStuckMessages', { olderThanMinutes }),
  
  // WhatsApp: Diagnostic
  whatsappDiagnostic: () => call('whatsappDiagnostic'),

  // Portal Settings (OTP/Consent sender number)
  getPortalSetting: (key) => call('getPortalSetting', { key }),
  setPortalSetting: (key, value) => call('setPortalSetting', { key, value }),

  // Bilingual Dropdown Lists (Category / Payment Mode / Loan Status / Village)
  getDropdownList: (type) => call('getDropdownList', { type }),
  getAllDropdownLists: () => call('getAllDropdownLists'),
  addDropdownListItem: (type, englishValue, hindiLabel) => call('addDropdownListItem', { type, englishValue, hindiLabel }),
  updateDropdownListItem: (rowIndex, englishValue, hindiLabel, active) => call('updateDropdownListItem', { rowIndex, englishValue, hindiLabel, active }),
  deleteDropdownListItem: (rowIndex) => call('deleteDropdownListItem', { rowIndex }),

  // Loan Consent — PUBLIC (no login; used by the /consent/:token page)
  getConsentByToken: (token) => call('getConsentByToken', { token }, false),
  requestConsentOtp: (token) => call('requestConsentOtp', { token }, false),
  verifyConsentOtp: (token, otp) => call('verifyConsentOtp', { token, otp }, false),
  respondConsent: (token, decision, extra = {}) => call('respondConsent', {
    token, decision,
    geoLat: extra.geo && extra.geo.lat, geoLng: extra.geo && extra.geo.lng, geoAccuracy: extra.geo && extra.geo.accuracy,
    photoBase64: extra.photoBase64, signatureBase64: extra.signatureBase64, declineRemarks: extra.declineRemarks,
    // Session-bound proof that THIS client verified the OTP (see verifyConsentOtp).
    verifyToken: extra.verifyToken,
  }, false),

  // Festival Dates (read: any logged-in user; write: Superadmin)
  getFestivalDates: (year) => call('getFestivalDates', { year }),
  saveFestivalDates: (year, diwali, nahayKhay, chhathArghya) => call('saveFestivalDates', { year, diwali, nahayKhay, chhathArghya }),

  // Consent Page Templates (Superadmin-editable legal text)
  getConsentPageTemplate: (type) => call('getConsentPageTemplate', { type }),
  updateConsentPageTemplate: (type, text) => call('updateConsentPageTemplate', { type, text }),

  // Consent Review (Superadmin)
  getConsentsForReview: () => call('getConsentsForReview'),
  setConsentVerification: (consentId, status, remarks) => call('setConsentVerification', { consentId, status, remarks }),

  // Receipt Templates (Superadmin)
  getReceiptTemplates: () => call('getReceiptTemplates'),
  getReceiptTemplate: (year) => call('getReceiptTemplate', { year }),
  saveReceiptTemplate: (year, text, pageSize) => call('saveReceiptTemplate', { year, text, pageSize }),
  copyReceiptTemplate: (fromYear, toYear) => call('copyReceiptTemplate', { fromYear, toYear }),
  deleteReceiptTemplate: (year) => call('deleteReceiptTemplate', { year }),
  getReceiptData: (rowIndex, year) => call('getReceiptData', { rowIndex, year }),

  // Error Log + WhatsApp Report
  logError: (source, page, message, stack, context) => call('logError', { source, page, message, stack, context }, false),
  reportErrorToWhatsApp: (errorId) => call('reportErrorToWhatsApp', { errorId }, false),
  getErrorLog: (limit) => call('getErrorLog', { limit }),
  // AI auto-fix (Superadmin-only). PR-1: generate a fix + preview.
  generateAiFix: (errorId) => call('generateAiFix', { errorId }),
  getAiFixes: (errorId) => call('getAiFixes', { errorId }),
  getAiFix: (fixId) => call('getAiFix', { fixId }),
  createAiFixPr: (fixId) => call('createAiFixPr', { fixId }),

  // Loan Consent — Admin
  getLoanConsents: (loanId) => call('getLoanConsents', { loanId }),
  resendConsent: (consentId) => call('resendConsent', { consentId }),
  replaceGuarantor: (loanId, oldConsentId, newPersonId) => call('replaceGuarantor', { loanId, oldConsentId, newPersonId }),
  markLoanDisbursed: (loanId, cashAmount, onlineAmount) => call('markLoanDisbursed', { loanId, cashAmount, onlineAmount }),

  // Loan message templates (Superadmin) — also used for OTP (type: 'otp')
  getLoanTemplates: (type) => call('getLoanTemplates', { type }),
  addLoanTemplate: (type, text, messageType, fileLink) => call('addLoanTemplate', { type, text, messageType, fileLink }),
  updateLoanTemplate: (rowIndex, text, active, messageType, fileLink) => call('updateLoanTemplate', { rowIndex, text, active, messageType, fileLink }),
  deleteLoanTemplate: (rowIndex) => call('deleteLoanTemplate', { rowIndex }),

  // Certificate Templates (Superadmin) — same engine as Receipt Templates
  getCertificateTemplates: () => call('getCertificateTemplates'),
  getCertificateTemplate: (year) => call('getCertificateTemplate', { year }),
  saveCertificateTemplate: (year, text, pageSize) => call('saveCertificateTemplate', { year, text, pageSize }),
  copyCertificateTemplate: (fromYear, toYear) => call('copyCertificateTemplate', { fromYear, toYear }),
  deleteCertificateTemplate: (year) => call('deleteCertificateTemplate', { year }),
  getCertificateData: (rowIndex, year) => call('getCertificateData', { rowIndex, year }),

  // Samaan Templates (Superadmin) — same engine as Receipt Templates
  getSamaanTemplates: () => call('getSamaanTemplates'),
  getSamaanTemplate: (year) => call('getSamaanTemplate', { year }),
  saveSamaanTemplate: (year, text, pageSize) => call('saveSamaanTemplate', { year, text, pageSize }),
  copySamaanTemplate: (fromYear, toYear) => call('copySamaanTemplate', { fromYear, toYear }),
  deleteSamaanTemplate: (year) => call('deleteSamaanTemplate', { year }),
  getSamaanData: (rowIndex, year) => call('getSamaanData', { rowIndex, year }),

  // DOCX Templates (Superadmin uploads .docx, year-wise) — replaces the old
  // pdfme drag-drop designer approach entirely.
  getDocxTemplates: (docType) => call('getDocxTemplates', { docType }),
  getDocxTemplate: (docType, year) => call('getDocxTemplate', { docType, year }),
  uploadDocxTemplate: (docType, year, base64, fileName) => call('uploadDocxTemplate', { docType, year, base64, fileName }),
  copyDocxTemplate: (docType, fromYear, toYear) => call('copyDocxTemplate', { docType, fromYear, toYear }),
  deleteDocxTemplate: (docType, year) => call('deleteDocxTemplate', { docType, year }),
  getDocxTemplateForDoc: (docType, year) => call('getDocxTemplateForDoc', { docType, year }),
  // Now token-gated server-side — the consent token decides which role+year
  // template you're allowed to read.
  getDocxTemplatePublic: (docType, year, token) => call('getDocxTemplatePublic', { docType, year, token }, false),

  // DOCX -> PDF conversion (fill happens client-side via docxtemplater first).
  // `mode` replaces the old `isAutoGenerate` boolean:
  //   'auto'   — Home's silent auto-PDF right after a save        (staff)
  //   'single' — one row's own document from the Receipt modal     (staff)
  //   'bulk'   — Bulk Generate PDFs / Download Center / Reports    (Superadmin)
  // Omitting it falls back to 'bulk' (most restrictive) on the server.
  // SECURITY (audit C-2): the privilege level is now decided by WHICH endpoint is
  // called, not by a `mode` field in the body — a client-chosen `mode` was the only
  // thing selecting between requireStaffRole and requireSuperadmin on the server.
  //   convertDocxToPdf     — staff; ONE record from the caller's own screen
  //                          (Receipt modal, Home's auto-PDF fallback). Never a
  //                          consent document, and `force` is never honoured.
  //   convertDocxToPdfBulk — Superadmin; mass generation / regeneration
  //                          (Generate PDFs, Download Center, PDF Export).
  convertDocxToPdf: (docType, year, recordId, base64, fileName) => call('convertDocxToPdf', { docType, year, recordId, base64, fileName }),
  convertDocxToPdfBulk: (docType, year, recordId, base64, fileName, force) => call('convertDocxToPdfBulk', { docType, year, recordId, base64, fileName, force }),
  // Everything except the bytes is derived server-side from the verified consent
  // token, so docType/year/recordId are no longer client-controlled.
  convertDocxToPdfPublic: (base64, token) => call('convertDocxToPdfPublic', { base64, token }, false),

  // Bulk "Generate PDFs" (Superadmin)
  getRecordsForDocType: (docType, year) => call('getRecordsForDocType', { docType, year }),
  getGeneratedFilesForYear: (year, docType) => call('getGeneratedFilesForYear', { year, docType }),
  searchUsersByVillageAndName: (village, query) => call('searchUsersByVillageAndName', { village, query }),
  getPersonDownloads: (userId) => call('getPersonDownloads', { userId }),

  // Storage Management (Superadmin) — R2 overview + archive a year to Drive
  getStorageOverview: () => call('getStorageOverview'),
  moveYearToDrive: (year) => call('moveYearToDrive', { year }),

  // Full Backup & Restore (Superadmin). exportBackup returns all DB data as JSON
  // (the view zips it client-side); restoreBackup is destructive and requires
  // confirm === 'RESTORE'.
  exportBackup: () => call('exportBackup'),
  // opts (audit H-16): { snapshotAcknowledged, onlyBinding, withInRequestSnapshot }.
  //   - no onlyBinding + snapshotAcknowledged -> PLANNING call, returns the binding
  //     list to walk one request each (incremental restore; no data touched).
  //   - onlyBinding='DB_CORE' etc -> restore just that database (bounded memory).
  restoreBackup: (backup, confirm, opts = {}) => call('restoreBackup', { backup, confirm, opts }),

  // Collection Queue: enqueue a job right after a save (fast return); the Worker
  // Cron Trigger does the PDF + WhatsApp in the background. getCollectionQueueStatus
  // powers a small status panel visible to any staff role.
  enqueueCollectionJob: (job) => call('enqueueCollectionJob', { job }),
  getCollectionQueueStatus: () => call('getCollectionQueueStatus'),
  // Drains the queue on demand (called fire-and-forget after a save so we don't
  // wait for the unreliable free-plan cron).
  processCollectionQueue: () => call('processCollectionQueue'),
  // Queue Monitor (Superadmin only): full job list across all users, with an
  // optional status filter ('pending' | 'processing' | 'done' | 'failed'), and a
  // retry action for a failed/stuck job.
  getQueueJobsForSuperadmin: (status, limit) => call('getQueueJobsForSuperadmin', { status, limit }),
  retryQueueJob: (jobId) => call('retryQueueJob', { jobId }),

  // Popup Management (Superadmin) + login-time fetch
  getPopups: () => call('getPopups'),
  getPopupWithSlides: (popupId) => call('getPopupWithSlides', { popupId }),
  savePopup: (popupId, title, roles, active, startAt, endAt) => call('savePopup', { popupId, title, roles, active, startAt, endAt }),
  deletePopup: (popupId) => call('deletePopup', { popupId }),
  savePopupSlides: (popupId, slides) => call('savePopupSlides', { popupId, slides }),
  uploadPopupImage: (base64, fileName, mimeType) => call('uploadPopupImage', { base64, fileName, mimeType }),
  getActivePopups: () => call('getActivePopups'),

  // SEO & social link preview (Superadmin). `saveSeoSettings` takes the full
  // settings object; `triggerRebuild` target is 'public' | 'mgmt' | 'both'.
  getSeoSettings: () => call('getSeoSettings'),
  saveSeoSettings: (payload) => call('saveSeoSettings', { payload }),
  uploadSeoImage: (base64, fileName) => call('uploadSeoImage', { base64, fileName }),
  triggerRebuild: (target) => call('triggerRebuild', { target }),
  // Shows exactly what the PUBLIC portal will render (a 'Public'-only popup is
  // invisible to getActivePopups, which filters by the caller's own role).
  previewPublicPopups: () => call('previewPublicPopups'),

  // Announcement Portal — links (Superadmin)
  generateAnnouncementLink: (year, pin, expiresAt) => call('generateAnnouncementLink', { year, pin, expiresAt }),
  getAnnouncementLinks: () => call('getAnnouncementLinks'),
  revokeAnnouncementLink: (token) => call('revokeAnnouncementLink', { token }),

  // Announcement Portal — Custom Announcements (Superadmin)
  getCustomAnnouncements: (year) => call('getCustomAnnouncements', { year }),
  addCustomAnnouncement: (year, textHindi, textEnglish, priority) => call('addCustomAnnouncement', { year, textHindi, textEnglish, priority }),
  updateCustomAnnouncement: (id, textHindi, textEnglish, priority) => call('updateCustomAnnouncement', { id, textHindi, textEnglish, priority }),
  deleteCustomAnnouncement: (id) => call('deleteCustomAnnouncement', { id }),

  // Announcement Portal — PUBLIC (used by /announce/:token page, no login)
  verifyAnnouncementPin: (token, pin) => call('verifyAnnouncementPin', { token, pin }, false),
  getAnnouncementQueue: (announceToken, statusFilter, typeFilter) => call('getAnnouncementQueue', { announceToken, statusFilter, typeFilter }, false),
  markAnnounced: (announceToken, itemId, itemType) => call('markAnnounced', { announceToken, itemId, itemType }, false),
  reannounceAll: (announceToken, typeFilter) => call('reannounceAll', { announceToken, typeFilter }, false),
};

export const fmt = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
