const API_URL = import.meta.env.VITE_API_URL;
import { getDeviceId, getDeviceInfo } from './device.js';

const TOKEN_KEY = 'cpm_token';
const EXPIRY_KEY = 'cpm_token_expiry';
const REMEMBER_KEY = 'cpm_remember';
const USER_KEY = 'cpm_user';

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

const NO_AUTOLOG_ACTIONS = ['logError', 'reportErrorPublic', 'reportErrorToWhatsApp', 'login', 'verifyGoogleLogin'];

const IGNORED_ERROR_PATTERNS = [
  /MetaMask/i,
  /ethereum/i,
  /chrome-extension:/i,
  /moz-extension:/i,
  /safari-extension:/i,
  /ResizeObserver loop/i,
  /Non-Error promise rejection/i,
];
export function isIgnorableClientError(message) {
  const m = (message || '').toString();
  return IGNORED_ERROR_PATTERNS.some(re => re.test(m));
}

const TRANSPORT_ERROR_RE = /Failed to fetch|NetworkError|Load failed|network error|ERR_NETWORK|ERR_INTERNET/i;
let lastTransportReportAt = 0;
const TRANSPORT_REPORT_WINDOW_MS = 60000;

const PENDING_LOG_KEY = 'cpm_pending_error_logs';
const MAX_BUFFERED_LOGS = 20;

function bufferLog(body) {
  try {
    const buf = JSON.parse(sessionStorage.getItem(PENDING_LOG_KEY) || '[]');
    buf.push(body);
    sessionStorage.setItem(PENDING_LOG_KEY, JSON.stringify(buf.slice(-MAX_BUFFERED_LOGS)));
  } catch (e) {  }
}

export function flushBufferedLogs() {
  let buf = [];
  try {
    buf = JSON.parse(sessionStorage.getItem(PENDING_LOG_KEY) || '[]');
    if (!buf.length) return;
    sessionStorage.removeItem(PENDING_LOG_KEY);
  } catch (e) { return; }
  buf.forEach(body => {
    fetch(API_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => bufferLog(body));
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', flushBufferedLogs);
}

function fireAndForgetLogError(source, message, stack, context) {
  try {
    if (isIgnorableClientError(message)) return;

    if (TRANSPORT_ERROR_RE.test(message)) {
      const now = Date.now();
      if (now - lastTransportReportAt < TRANSPORT_REPORT_WINDOW_MS) return;
      lastTransportReportAt = now;
      message = `Network/transport failure — could not connect to the server (${message})`;
    }

    const session = getSession();
    const contextStr = context ? (typeof context === 'string' ? context : JSON.stringify(context)) : '';

    let body;
    if (session && session.token) {
      body = {
        action: 'logError',
        token: session.token,
        source,
        page: window.location.pathname,
        message,
        stack: stack || '',
        context: contextStr,
        deviceId: getDeviceId(),
        deviceInfo: getDeviceInfo(),
      };
    } else {
      body = {
        action: 'reportErrorPublic',
        source,
        page: window.location.pathname,
        message,
        stack: stack || '',
        context: contextStr,
        deviceId: getDeviceId(),
        deviceInfo: getDeviceInfo(),
      };
    }

    fetch(API_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => bufferLog(body));
  } catch (e) {  }
}

async function call(action, params = {}, requireAuth = true) {
  const body = { action, ...params, deviceId: getDeviceId(), deviceInfo: getDeviceInfo() };
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
      throw new Error(`The server returned an invalid response (HTTP ${res.status}). Please try again in a little while.`);
    }

    if (data === null || data === undefined) {
      flushBufferedLogs();
      return data;
    }

    if (data.authError) {
      clearSession();
      const err = new Error(data.message || 'Session expired');
      err.authError = true;
      if (!NO_AUTOLOG_ACTIONS.includes(action)) {
        fireAndForgetLogError('auth', `[${action}] ${err.message}`, '');
      }
      throw err;
    }
    if (data.success === false) {
      const err = new Error(data.message || 'Request failed');
      Object.assign(err, data);
      err.__logged = true;
      throw err;
    }
    flushBufferedLogs();
    return data;
  } catch (err) {
    if (!NO_AUTOLOG_ACTIONS.includes(action) && !err.__logged) {
      err.__logged = true;
      fireAndForgetLogError(err.authError ? 'auth' : 'frontend', `[${action}] ${err.message}`, err.stack || '');
    }
    throw err;
  }
}

export function reportClientError(page, message, err, context) {
  fireAndForgetLogError(
    'frontend',
    `[${page}] ${message}${err && err.message ? ': ' + err.message : ''}`,
    (err && err.stack) || '',
    context
  );
}

const PDF_POLL_INTERVAL_MS = 2000;
const PDF_POLL_TIMEOUT_MS = 3 * 60 * 1000;
async function pollRenderPdfJob(jobId, returnJob) {
  const start = Date.now();
  while (true) {
    if (Date.now() - start > PDF_POLL_TIMEOUT_MS) {
      throw new Error('PDF generation timed out (the processing service did not respond in time).');
    }
    let job = null;
    try {
      const res = await call('getRenderJobStatus', { jobId });
      job = res && res.job;
    } catch (e) {  }
    if (job && job.status === 'completed') {
      if (returnJob) return job;
      const r = job.result || {};
      return { success: true, skipped: false, publicLink: r.publicLink || '', fileName: r.fileName || '' };
    }
    if (job && job.status === 'failed') {
      throw new Error(job.error || 'PDF generation failed on the processing service.');
    }
    await new Promise(res => setTimeout(res, PDF_POLL_INTERVAL_MS));
  }
}

export const api = {
  login: (name, password, rememberMe) => call('login', { name, password, rememberMe }, false),
  verifyGoogleLogin: (idToken, rememberMe) => call('verifyGoogleLogin', { idToken, rememberMe }, false),

  verify2FA: (tempToken, code) => call('verify2FA', { tempToken, code }, false),
  get2FAStatus: () => call('get2FAStatus'),
  enroll2FA: () => call('enroll2FA'),
  confirm2FA: (code, backupCodes, recoveryKey) => call('confirm2FA', { code, backupCodes, recoveryKey }),
  disable2FA: (password) => call('disable2FA', { password }),
  regenerate2FABackupCodes: (password) => call('regenerate2FABackupCodes', { password }),
  disable2FAWithRecoveryKey: (name, password, recoveryKey) => call('disable2FAWithRecoveryKey', { name, password, recoveryKey }, false),
  request2FARecovery: (name) => call('request2FARecovery', { name }, false),
  reset2FA: (recoveryToken) => call('reset2FA', { recoveryToken }, false),

  requestPasswordReset: (name) => call('requestPasswordReset', { name }, false),
  resetPassword: (name, code, newPassword) => call('resetPassword', { name, code, newPassword }, false),
  logout: () => call('logout'),
  getYears: () => call('getYears'),
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

  getMySessions: () => call('getMySessions'),
  revokeSession: (sessionId) => call('revokeSession', { sessionId }),
  revokeAllOtherSessions: () => call('revokeAllOtherSessions'),
  getUserSessions: (targetName) => call('getUserSessions', { targetName }),
  revokeUserSession: (targetName, sessionId) => call('revokeUserSession', { targetName, sessionId }),
  getLoginAttempts: (opts) => call('getLoginAttempts', opts || {}),
  getActivityLog: (opts) => call('getActivityLog', opts || {}),
  getLockedAccounts: () => call('getLockedAccounts'),
  revokeLock: (lockKey, targetName, ip) => call('revokeLock', { lockKey, targetName, ip }),
  revokeAllLocks: () => call('revokeAllLocks'),

  getLoginUsers: () => call('getLoginUsers', {}),
  addLoginUser: (userId, password, role, mobile, email) => call('addLoginUser', { userId, password, role, mobile, email }),
  updateLoginUser: (rowIndex, password, role, mobile, email) => call('updateLoginUser', { rowIndex, password, role, mobile, email }),
  deleteLoginUser: (rowIndex) => call('deleteLoginUser', { rowIndex }),
  saveRecord: (sheet, payload) => call('saveRecord', { sheet, payload }),
  importCsvRows: (sheet, rows) => call('importCsvRows', { sheet, rows }),
  queueCollectionMessages: (payload, rowIndex, fileLink) => call('queueCollectionMessages', { payload, rowIndex, fileLink }),
  updateRecord: (sheet, rowIndex, payload) => call('updateRecord', { sheet, rowIndex, payload }),
  deleteRecord: (sheet, rowIndex) => call('deleteRecord', { sheet, rowIndex }),
  saveLoan: (loan, guarantors) => call('saveLoan', { loan, guarantors }),
  deleteLoan: (rowIndex, year, loanerId, loanId) => call('deleteLoan', { rowIndex, year, loanerId, loanId }),

  getPersonTemplates: () => call('getPersonTemplates'),
  addPersonTemplate: (text, messageType, contributionType, fileLink, docSubType, fileDocType) => call('addPersonTemplate', { text, messageType, contributionType, fileLink, docSubType, fileDocType }),
  updatePersonTemplate: (rowIndex, text, active, messageType, contributionType, fileLink, docSubType, fileDocType) => call('updatePersonTemplate', { rowIndex, text, active, messageType, contributionType, fileLink, docSubType, fileDocType }),
  deletePersonTemplate: (rowIndex) => call('deletePersonTemplate', { rowIndex }),
  getGroupTemplates: () => call('getGroupTemplates'),
  addGroupTemplate: (text, messageType, contributionType, fileLink, docSubType, fileDocType) => call('addGroupTemplate', { text, messageType, contributionType, fileLink, docSubType, fileDocType }),
  updateGroupTemplate: (rowIndex, text, active, messageType, contributionType, fileLink, docSubType, fileDocType) => call('updateGroupTemplate', { rowIndex, text, active, messageType, contributionType, fileLink, docSubType, fileDocType }),
  deleteGroupTemplate: (rowIndex) => call('deleteGroupTemplate', { rowIndex }),
  getEmailTemplates: () => call('getEmailTemplates'),
  addEmailTemplate: (subject, text, messageType, contributionType, fileLink, docSubType, fileDocType) => call('addEmailTemplate', { subject, text, messageType, contributionType, fileLink, docSubType, fileDocType }),
  updateEmailTemplate: (rowIndex, subject, text, active, messageType, contributionType, fileLink, docSubType, fileDocType) => call('updateEmailTemplate', { rowIndex, subject, text, active, messageType, contributionType, fileLink, docSubType, fileDocType }),
  deleteEmailTemplate: (rowIndex) => call('deleteEmailTemplate', { rowIndex }),
  getStuckEmails: (olderThanMinutes) => call('getStuckEmails', { olderThanMinutes }),
  getEmailLog: () => call('getEmailLog'),
  resendEmail: (message_id) => call('resendEmail', { message_id }),
  listOfficialEmails: (box, limit) => call('listOfficialEmails', { box, limit }),
  getOfficialEmail: (message_id) => call('getOfficialEmail', { message_id }),
  sendOfficialEmail: (to, cc, subject, body, attachments) => call('sendOfficialEmail', { to, cc, subject, body, attachments }),
  replyOfficialEmail: (message_id, body, attachments) => call('replyOfficialEmail', { message_id, body, attachments }),
  markOfficialEmailRead: (message_id) => call('markOfficialEmailRead', { message_id }),
  cleanupPreview: (target, mode, days) => call('cleanupPreview', { target, mode, days }),
  cleanupData: (target, mode, days) => call('cleanupData', { target, mode, days }),
  getLoanEmailTemplates: (type) => call('getLoanEmailTemplates', { type }),
  addLoanEmailTemplate: (type, subject, text, messageType, fileLink) => call('addLoanEmailTemplate', { type, subject, text, messageType, fileLink }),
  updateLoanEmailTemplate: (rowIndex, subject, text, active, messageType, fileLink) => call('updateLoanEmailTemplate', { rowIndex, subject, text, active, messageType, fileLink }),
  deleteLoanEmailTemplate: (rowIndex) => call('deleteLoanEmailTemplate', { rowIndex }),

  getWhatsappGroups: () => call('getWhatsappGroups'),
  addWhatsappGroup: (groupName, groupid) => call('addWhatsappGroup', { groupName, groupid }),
  updateWhatsappGroup: (rowIndex, groupName, groupid, active) => call('updateWhatsappGroup', { rowIndex, groupName, groupid, active }),
  deleteWhatsappGroup: (rowIndex) => call('deleteWhatsappGroup', { rowIndex }),

  getMessageLog: () => call('getMessageLog'),
  resendMessage: (type, message_id) => call('resendMessage', { type, message_id }),
  getStuckMessages: (olderThanMinutes) => call('getStuckMessages', { olderThanMinutes }),
  
  whatsappDiagnostic: () => call('whatsappDiagnostic'),

  getPortalSetting: (key) => call('getPortalSetting', { key }),
  setPortalSetting: (key, value) => call('setPortalSetting', { key, value }),

  getDropdownList: (type) => call('getDropdownList', { type }),
  getAllDropdownLists: () => call('getAllDropdownLists'),
  addDropdownListItem: (type, englishValue, hindiLabel) => call('addDropdownListItem', { type, englishValue, hindiLabel }),
  updateDropdownListItem: (rowIndex, englishValue, hindiLabel, active) => call('updateDropdownListItem', { rowIndex, englishValue, hindiLabel, active }),
  deleteDropdownListItem: (rowIndex) => call('deleteDropdownListItem', { rowIndex }),

  getConsentByToken: (token) => call('getConsentByToken', { token }, false),
  requestConsentOtp: (token) => call('requestConsentOtp', { token }, false),
  verifyConsentOtp: (token, otp) => call('verifyConsentOtp', { token, otp }, false),
  respondConsent: (token, decision, extra = {}) => call('respondConsent', {
    token, decision,
    geoLat: extra.geo && extra.geo.lat, geoLng: extra.geo && extra.geo.lng, geoAccuracy: extra.geo && extra.geo.accuracy,
    photoBase64: extra.photoBase64, signatureBase64: extra.signatureBase64, declineRemarks: extra.declineRemarks,
    verifyToken: extra.verifyToken,
  }, false),

  getFestivalDates: (year) => call('getFestivalDates', { year }),
  saveFestivalDates: (year, diwali, nahayKhay, chhathArghya) => call('saveFestivalDates', { year, diwali, nahayKhay, chhathArghya }),

  getConsentPageTemplate: (type) => call('getConsentPageTemplate', { type }),
  updateConsentPageTemplate: (type, text) => call('updateConsentPageTemplate', { type, text }),

  getConsentsForReview: () => call('getConsentsForReview'),
  setConsentVerification: (consentId, status, remarks) => call('setConsentVerification', { consentId, status, remarks }),

  getReceiptTemplates: () => call('getReceiptTemplates'),
  getReceiptTemplate: (year) => call('getReceiptTemplate', { year }),
  saveReceiptTemplate: (year, text, pageSize) => call('saveReceiptTemplate', { year, text, pageSize }),
  copyReceiptTemplate: (fromYear, toYear) => call('copyReceiptTemplate', { fromYear, toYear }),
  deleteReceiptTemplate: (year) => call('deleteReceiptTemplate', { year }),
  getReceiptData: (rowIndex, year) => call('getReceiptData', { rowIndex, year }),

  logError: (source, page, message, stack, context) => call('logError', { source, page, message, stack, context }, true),
  reportErrorToWhatsApp: (errorId) => call('reportErrorToWhatsApp', { errorId }, false),
  getErrorLog: (limit) => call('getErrorLog', { limit }),
  generateAiFix: (errorId, force, guidance) => call('generateAiFix', { errorId, force: !!force, guidance: guidance || '' }),
  getAiFixes: (errorId) => call('getAiFixes', { errorId }),
  getAiFix: (fixId) => call('getAiFix', { fixId }),
  getLatestAiFixForError: (errorId) => call('getLatestAiFixForError', { errorId }),
  createAiFixPr: (fixId) => call('createAiFixPr', { fixId }),
  getRenderJobStatus: (jobId) => call('getRenderJobStatus', { jobId }),
  getAiProviders: () => call('getAiProviders'),
  saveAiProvider: (p) => call('saveAiProvider', p),
  deleteAiProvider: (providerId) => call('deleteAiProvider', { providerId }),
  setDefaultAiProvider: (providerId, purpose) => call('setDefaultAiProvider', { providerId, purpose }),
  reorderAiProviders: (purpose, orderedIds) => call('reorderAiProviders', { purpose, orderedIds }),
  testAiProvider: async (providerId, prompt, maxTokens) => {
    const res = await call('testAiProvider', { providerId, prompt, maxTokens });
    if (!res || !res.jobId) {
      return { ok: !!(res && res.ok), message: (res && res.message) || '', reply: (res && res.reply) || '', latencyMs: res && res.latencyMs, status: res && res.status, via: (res && res.via) || 'worker' };
    }
    const job = await pollRenderPdfJob(res.jobId,  true);
    const r = (job && job.result) || {};
    return { ok: !!r.ok, message: r.message || '', reply: r.reply || '', latencyMs: r.latencyMs, status: r.status, via: 'render' };
  },

  getLoanConsents: (loanId) => call('getLoanConsents', { loanId }),
  resendConsent: (consentId) => call('resendConsent', { consentId }),
  replaceGuarantor: (loanId, oldConsentId, newPersonId) => call('replaceGuarantor', { loanId, oldConsentId, newPersonId }),
  markLoanDisbursed: (loanId, cashAmount, onlineAmount) => call('markLoanDisbursed', { loanId, cashAmount, onlineAmount }),

  getLoanTemplates: (type) => call('getLoanTemplates', { type }),
  addLoanTemplate: (type, text, messageType, fileLink) => call('addLoanTemplate', { type, text, messageType, fileLink }),
  updateLoanTemplate: (rowIndex, text, active, messageType, fileLink) => call('updateLoanTemplate', { rowIndex, text, active, messageType, fileLink }),
  deleteLoanTemplate: (rowIndex) => call('deleteLoanTemplate', { rowIndex }),

  getCertificateTemplates: () => call('getCertificateTemplates'),
  getCertificateTemplate: (year) => call('getCertificateTemplate', { year }),
  saveCertificateTemplate: (year, text, pageSize) => call('saveCertificateTemplate', { year, text, pageSize }),
  copyCertificateTemplate: (fromYear, toYear) => call('copyCertificateTemplate', { fromYear, toYear }),
  deleteCertificateTemplate: (year) => call('deleteCertificateTemplate', { year }),
  getCertificateData: (rowIndex, year) => call('getCertificateData', { rowIndex, year }),

  getSamaanTemplates: () => call('getSamaanTemplates'),
  getSamaanTemplate: (year) => call('getSamaanTemplate', { year }),
  saveSamaanTemplate: (year, text, pageSize) => call('saveSamaanTemplate', { year, text, pageSize }),
  copySamaanTemplate: (fromYear, toYear) => call('copySamaanTemplate', { fromYear, toYear }),
  deleteSamaanTemplate: (year) => call('deleteSamaanTemplate', { year }),
  getSamaanData: (rowIndex, year) => call('getSamaanData', { rowIndex, year }),

  getDocxTemplates: (docType) => call('getDocxTemplates', { docType }),
  getDocxTemplate: (docType, year) => call('getDocxTemplate', { docType, year }),
  uploadDocxTemplate: (docType, year, base64, fileName) => call('uploadDocxTemplate', { docType, year, base64, fileName }),
  copyDocxTemplate: (docType, fromYear, toYear) => call('copyDocxTemplate', { docType, fromYear, toYear }),
  deleteDocxTemplate: (docType, year) => call('deleteDocxTemplate', { docType, year }),
  getDocxTemplateForDoc: (docType, year) => call('getDocxTemplateForDoc', { docType, year }),
  getDocxTemplatePublic: (docType, year, token) => call('getDocxTemplatePublic', { docType, year, token }, false),

  convertDocxToPdf: (docType, year, recordId, base64, fileName) => call('convertDocxToPdf', { docType, year, recordId, base64, fileName }),
  convertDocxToPdfBulk: async (docType, year, recordId, base64, fileName, force) => {
    const res = await call('convertDocxToPdfBulk', { docType, year, recordId, base64, fileName, force });
    if (!res || !res.jobId) return res;
    return pollRenderPdfJob(res.jobId);
  },
  convertDocxToPdfBatch: async (docType, year, items, force) => {
    const res = await call('convertDocxToPdfBatch', { docType, year, items, force });
    const meta = {
      engine: (res && res.engine) || 'unknown',
      engineReason: (res && res.engineReason) || null,
      dispatchedCount: (res && res.dispatchedCount) || 0,
      skippedCount: (res && res.skippedCount) || 0,
      jobId: (res && res.jobId) || null,
    };
    if (!res || !res.jobId) return { ...meta, results: (res && res.results) || [] };
    const job = await pollRenderPdfJob(res.jobId,  true);
    const converted = (job && job.result && job.result.results) || [];
    const preSkipped = (res.preSkipped || []).map(s => ({ recordId: s.recordId, success: true, skipped: true, publicLink: s.publicLink, fileName: s.fileName }));
    return { ...meta, results: [...preSkipped, ...converted] };
  },
  convertDocxToPdfPublic: (base64, token) => call('convertDocxToPdfPublic', { base64, token }, false),

  getRecordsForDocType: (docType, year) => call('getRecordsForDocType', { docType, year }),
  getGeneratedFilesForYear: (year, docType) => call('getGeneratedFilesForYear', { year, docType }),
  searchUsersByVillageAndName: (village, query) => call('searchUsersByVillageAndName', { village, query }),
  getPersonDownloads: (userId) => call('getPersonDownloads', { userId }),

  getStorageOverview: () => call('getStorageOverview'),
  moveYearToDrive: (year) => call('moveYearToDrive', { year }),

  exportBackup: () => call('exportBackup'),
  restoreBackup: (backup, confirm, opts = {}) => call('restoreBackup', { backup, confirm, opts }),

  enqueueCollectionJob: (job) => call('enqueueCollectionJob', { job }),
  getCollectionQueueStatus: () => call('getCollectionQueueStatus'),
  processCollectionQueue: () => call('processCollectionQueue'),
  getQueueJobsForSuperadmin: (status, limit) => call('getQueueJobsForSuperadmin', { status, limit }),
  retryQueueJob: (jobId) => call('retryQueueJob', { jobId }),

  getPopups: () => call('getPopups'),
  getPopupWithSlides: (popupId) => call('getPopupWithSlides', { popupId }),
  savePopup: (popupId, title, roles, active, startAt, endAt) => call('savePopup', { popupId, title, roles, active, startAt, endAt }),
  deletePopup: (popupId) => call('deletePopup', { popupId }),
  savePopupSlides: (popupId, slides) => call('savePopupSlides', { popupId, slides }),
  uploadPopupImage: (base64, fileName, mimeType) => call('uploadPopupImage', { base64, fileName, mimeType }),
  uploadUserPhoto: (base64, fileName, idCode) => call('uploadUserPhoto', { base64, fileName, idCode }),
  getJourneyEntries: () => call('getJourneyEntries'),
  saveJourneyEntry: (entry) => call('saveJourneyEntry', { entry }),
  deleteJourneyEntry: (id) => call('deleteJourneyEntry', { id }),
  reorderJourneyEntries: (orderedIds) => call('reorderJourneyEntries', { orderedIds }),
  getActivePopups: () => call('getActivePopups'),

  getSeoSettings: () => call('getSeoSettings'),
  saveSeoSettings: (payload) => call('saveSeoSettings', { payload }),
  uploadSeoImage: (base64, fileName) => call('uploadSeoImage', { base64, fileName }),
  triggerRebuild: (target) => call('triggerRebuild', { target }),
  previewPublicPopups: () => call('previewPublicPopups'),

  generateAnnouncementLink: (year, pin, expiresAt) => call('generateAnnouncementLink', { year, pin, expiresAt }),
  getAnnouncementLinks: () => call('getAnnouncementLinks'),
  revokeAnnouncementLink: (token) => call('revokeAnnouncementLink', { token }),

  getCustomAnnouncements: (year) => call('getCustomAnnouncements', { year }),
  addCustomAnnouncement: (year, textHindi, textEnglish, priority) => call('addCustomAnnouncement', { year, textHindi, textEnglish, priority }),
  updateCustomAnnouncement: (id, textHindi, textEnglish, priority) => call('updateCustomAnnouncement', { id, textHindi, textEnglish, priority }),
  deleteCustomAnnouncement: (id) => call('deleteCustomAnnouncement', { id }),

  verifyAnnouncementPin: (token, pin) => call('verifyAnnouncementPin', { token, pin }, false),
  getAnnouncementQueue: (announceToken, statusFilter, typeFilter) => call('getAnnouncementQueue', { announceToken, statusFilter, typeFilter }, false),
  markAnnounced: (announceToken, itemId, itemType) => call('markAnnounced', { announceToken, itemId, itemType }, false),
  reannounceAll: (announceToken, typeFilter) => call('reannounceAll', { announceToken, typeFilter }, false),
};

export const fmt = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
