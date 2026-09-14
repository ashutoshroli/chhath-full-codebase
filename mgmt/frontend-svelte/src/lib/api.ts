// Ported from mgmt/frontend/src/api.js. Framework-agnostic: session storage,
// CSRF, device id, fire-and-forget error logging, offline log buffering, PDF
// job polling, and the full `api` action map. Behaviour is preserved 1:1 so the
// UNCHANGED backend sees identical requests. Only TS types were added.
import { getDeviceId, getDeviceInfo } from './device';

const API_URL: string = import.meta.env.VITE_API_URL;

const TOKEN_KEY = 'cpm_token';
const EXPIRY_KEY = 'cpm_token_expiry';
const REMEMBER_KEY = 'cpm_remember';
const USER_KEY = 'cpm_user';

export interface SessionUser {
  name: string;
  role: string;
}
export interface Session {
  token: string;
  user: SessionUser | null;
}

function csrfFromCookie(): string {
  try {
    const m = document.cookie.match(/(?:^|;\s*)cpm_csrf=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : '';
  } catch {
    return '';
  }
}

function activeStore(): Storage {
  return localStorage.getItem(REMEMBER_KEY) === '1' ? localStorage : sessionStorage;
}

export function saveSession(
  { token, expiresAt, name, role }: { token: string; expiresAt: number; name: string; role: string },
  remember: boolean
): void {
  localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
  const store = remember ? localStorage : sessionStorage;
  store.setItem(TOKEN_KEY, token);
  store.setItem(EXPIRY_KEY, String(expiresAt));
  store.setItem(USER_KEY, JSON.stringify({ name, role }));
}

export function getSession(): Session | null {
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

export function clearSession(): void {
  [localStorage, sessionStorage].forEach((s) => {
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
  /Non-Error promise rejection/i
];
export function isIgnorableClientError(message: string): boolean {
  const m = (message || '').toString();
  return IGNORED_ERROR_PATTERNS.some((re) => re.test(m));
}

const TRANSPORT_ERROR_RE = /Failed to fetch|NetworkError|Load failed|network error|ERR_NETWORK|ERR_INTERNET/i;
let lastTransportReportAt = 0;
const TRANSPORT_REPORT_WINDOW_MS = 60000;

const PENDING_LOG_KEY = 'cpm_pending_error_logs';
const MAX_BUFFERED_LOGS = 20;

function bufferLog(body: unknown): void {
  try {
    const buf = JSON.parse(sessionStorage.getItem(PENDING_LOG_KEY) || '[]');
    buf.push(body);
    sessionStorage.setItem(PENDING_LOG_KEY, JSON.stringify(buf.slice(-MAX_BUFFERED_LOGS)));
  } catch {
    /* ignore */
  }
}

export function flushBufferedLogs(): void {
  let buf: unknown[] = [];
  try {
    buf = JSON.parse(sessionStorage.getItem(PENDING_LOG_KEY) || '[]');
    if (!buf.length) return;
    sessionStorage.removeItem(PENDING_LOG_KEY);
  } catch {
    return;
  }
  buf.forEach((body) => {
    fetch(API_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).catch(() => bufferLog(body));
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', flushBufferedLogs);
}

function fireAndForgetLogError(source: string, message: string, stack?: string, context?: unknown): void {
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

    let body: Record<string, unknown>;
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
        deviceInfo: getDeviceInfo()
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
        deviceInfo: getDeviceInfo()
      };
    }

    fetch(API_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).catch(() => bufferLog(body));
  } catch {
    /* ignore */
  }
}

interface ApiError extends Error {
  authError?: boolean;
  __logged?: boolean;
  [k: string]: unknown;
}

async function call<T = any>(action: string, params: Record<string, unknown> = {}, requireAuth = true): Promise<T> {
  const body: Record<string, unknown> = { action, ...params, deviceId: getDeviceId(), deviceInfo: getDeviceInfo() };
  if (requireAuth) {
    const session = getSession();
    if (!session) {
      const err = new Error('Session expired, please login again') as ApiError;
      err.authError = true;
      throw err;
    }
    body.token = session.token;
  }
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const csrf = csrfFromCookie();
    if (csrf) headers['X-CSRF-Token'] = csrf;
    const res = await fetch(API_URL, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(body)
    });
    let data: any;
    try {
      data = await res.json();
    } catch {
      throw new Error(
        `The server returned an invalid response (HTTP ${res.status}). Please try again in a little while.`
      );
    }

    if (data === null || data === undefined) {
      flushBufferedLogs();
      return data;
    }

    if (data.authError) {
      clearSession();
      const err = new Error(data.message || 'Session expired') as ApiError;
      err.authError = true;
      if (!NO_AUTOLOG_ACTIONS.includes(action)) {
        fireAndForgetLogError('auth', `[${action}] ${err.message}`, '');
      }
      throw err;
    }
    if (data.success === false) {
      const err = new Error(data.message || 'Request failed') as ApiError;
      Object.assign(err, data);
      err.__logged = true;
      throw err;
    }
    flushBufferedLogs();
    return data;
  } catch (e) {
    const err = e as ApiError;
    if (!NO_AUTOLOG_ACTIONS.includes(action) && !err.__logged) {
      err.__logged = true;
      fireAndForgetLogError(err.authError ? 'auth' : 'frontend', `[${action}] ${err.message}`, err.stack || '');
    }
    throw err;
  }
}

export function reportClientError(page: string, message: string, err?: Error, context?: unknown): void {
  fireAndForgetLogError(
    'frontend',
    `[${page}] ${message}${err && err.message ? ': ' + err.message : ''}`,
    (err && err.stack) || '',
    context
  );
}

const PDF_POLL_INTERVAL_MS = 2000;
const PDF_POLL_TIMEOUT_MS = 3 * 60 * 1000;
async function pollRenderPdfJob(jobId: string, returnJob?: boolean): Promise<any> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - start > PDF_POLL_TIMEOUT_MS) {
      throw new Error('PDF generation timed out (the processing service did not respond in time).');
    }
    let job: any = null;
    try {
      const res = await call('getRenderJobStatus', { jobId });
      job = res && res.job;
    } catch {
      /* ignore */
    }
    if (job && job.status === 'completed') {
      if (returnJob) return job;
      const r = job.result || {};
      return { success: true, skipped: false, publicLink: r.publicLink || '', fileName: r.fileName || '' };
    }
    if (job && job.status === 'failed') {
      throw new Error(job.error || 'PDF generation failed on the processing service.');
    }
    await new Promise((r) => setTimeout(r, PDF_POLL_INTERVAL_MS));
  }
}

export const api = {
  login: (name: string, password: string, rememberMe: boolean) => call('login', { name, password, rememberMe }, false),
  verifyGoogleLogin: (idToken: string, rememberMe: boolean) => call('verifyGoogleLogin', { idToken, rememberMe }, false),

  verify2FA: (tempToken: string, code: string) => call('verify2FA', { tempToken, code }, false),
  get2FAStatus: () => call('get2FAStatus'),
  enroll2FA: () => call('enroll2FA'),
  confirm2FA: (code: string, backupCodes: unknown, recoveryKey: unknown) => call('confirm2FA', { code, backupCodes, recoveryKey }),
  disable2FA: (password: string) => call('disable2FA', { password }),
  regenerate2FABackupCodes: (password: string) => call('regenerate2FABackupCodes', { password }),
  disable2FAWithRecoveryKey: (name: string, password: string, recoveryKey: string) =>
    call('disable2FAWithRecoveryKey', { name, password, recoveryKey }, false),
  request2FARecovery: (name: string) => call('request2FARecovery', { name }, false),
  reset2FA: (recoveryToken: string) => call('reset2FA', { recoveryToken }, false),

  requestPasswordReset: (name: string) => call('requestPasswordReset', { name }, false),
  resetPassword: (name: string, code: string, newPassword: string) =>
    call('resetPassword', { name, code, newPassword }, false),
  logout: () => call('logout'),
  getYears: () => call('getYears'),
  getDataVersion: () => call('getDataVersion'),
  getUsers: () => call('getUsers'),
  getCommittee: (year: string) => call('getCommittee', { year }),
  getHome: (year: string) => call('getHome', { year }),
  getExpenses: (year: string) => call('getExpenses', { year }),
  getLoans: (year: string) => call('getLoans', { year }),
  getLoanBudget: (year: string) => call('getLoanBudget', { year }),
  getUserHistory: (userId: string) => call('getUserHistory', { userId }),
  getUserProfile: (userId: string) => call('getUserProfile', { userId }),
  getYearContributors: (year: string) => call('getYearContributors', { year }),
  getLockedYears: () => call('getLockedYears'),
  lockYear: (year: string | number) => call('lockYear', { year }),
  unlockYear: (year: string | number) => call('unlockYear', { year }),
  addYear: (year: string | number) => call('addYear', { year }),
  updateOwnProfile: (payload: unknown) => call('updateOwnProfile', { payload }),
  changePassword: (currentPassword: string, newPassword: string) =>
    call('changePassword', { currentPassword, newPassword }),

  getMySessions: () => call('getMySessions'),
  revokeSession: (sessionId: string) => call('revokeSession', { sessionId }),
  revokeAllOtherSessions: () => call('revokeAllOtherSessions'),
  getUserSessions: (targetName: string) => call('getUserSessions', { targetName }),
  revokeUserSession: (targetName: string, sessionId: string | null) => call('revokeUserSession', { targetName, sessionId }),
  getLoginAttempts: (opts?: unknown) => call('getLoginAttempts', (opts as Record<string, unknown>) || {}),
  getActivityLog: (opts?: unknown) => call('getActivityLog', (opts as Record<string, unknown>) || {}),
  getLockedAccounts: () => call('getLockedAccounts'),
  revokeLock: (lockKey: string, targetName?: string, ip?: string) => call('revokeLock', { lockKey, targetName, ip }),
  revokeAllLocks: () => call('revokeAllLocks'),

  getLoginUsers: () => call('getLoginUsers', {}),
  addLoginUser: (userId: string, password: string, role: string, mobile: string, email: string) =>
    call('addLoginUser', { userId, password, role, mobile, email }),
  updateLoginUser: (rowIndex: number, password: string, role: string, mobile: string, email: string) =>
    call('updateLoginUser', { rowIndex, password, role, mobile, email }),
  deleteLoginUser: (rowIndex: number) => call('deleteLoginUser', { rowIndex }),
  saveRecord: (sheet: string, payload: unknown) => call('saveRecord', { sheet, payload }),
  importCsvRows: (sheet: string, rows: unknown) => call('importCsvRows', { sheet, rows }),
  queueCollectionMessages: (payload: unknown, rowIndex: number, fileLink: string) =>
    call('queueCollectionMessages', { payload, rowIndex, fileLink }),
  updateRecord: (sheet: string, rowIndex: number, payload: unknown) => call('updateRecord', { sheet, rowIndex, payload }),
  deleteRecord: (sheet: string, rowIndex: number) => call('deleteRecord', { sheet, rowIndex }),
  saveLoan: (loan: unknown, guarantors: unknown) => call('saveLoan', { loan, guarantors }),
  deleteLoan: (rowIndex: number, year: string, loanerId: string, loanId: string) =>
    call('deleteLoan', { rowIndex, year, loanerId, loanId }),

  getPersonTemplates: () => call('getPersonTemplates'),
  addPersonTemplate: (text: string, messageType: string, contributionType: string, fileLink: string, docSubType?: string, fileDocType?: string) =>
    call('addPersonTemplate', { text, messageType, contributionType, fileLink, docSubType, fileDocType }),
  updatePersonTemplate: (rowIndex: number, text?: string, active?: unknown, messageType?: string, contributionType?: string, fileLink?: string, docSubType?: string, fileDocType?: string) =>
    call('updatePersonTemplate', { rowIndex, text, active, messageType, contributionType, fileLink, docSubType, fileDocType }),
  deletePersonTemplate: (rowIndex: number) => call('deletePersonTemplate', { rowIndex }),
  getGroupTemplates: () => call('getGroupTemplates'),
  addGroupTemplate: (text: string, messageType: string, contributionType: string, fileLink: string, docSubType: string, fileDocType: string) =>
    call('addGroupTemplate', { text, messageType, contributionType, fileLink, docSubType, fileDocType }),
  updateGroupTemplate: (rowIndex: number, text?: string, active?: unknown, messageType?: string, contributionType?: string, fileLink?: string, docSubType?: string, fileDocType?: string) =>
    call('updateGroupTemplate', { rowIndex, text, active, messageType, contributionType, fileLink, docSubType, fileDocType }),
  deleteGroupTemplate: (rowIndex: number) => call('deleteGroupTemplate', { rowIndex }),
  getEmailTemplates: () => call('getEmailTemplates'),
  addEmailTemplate: (subject: string, text: string, messageType: string, contributionType: string, fileLink: string, docSubType: string, fileDocType: string) =>
    call('addEmailTemplate', { subject, text, messageType, contributionType, fileLink, docSubType, fileDocType }),
  updateEmailTemplate: (rowIndex: number, subject?: string, text?: string, active?: unknown, messageType?: string, contributionType?: string, fileLink?: string, docSubType?: string, fileDocType?: string) =>
    call('updateEmailTemplate', { rowIndex, subject, text, active, messageType, contributionType, fileLink, docSubType, fileDocType }),
  deleteEmailTemplate: (rowIndex: number) => call('deleteEmailTemplate', { rowIndex }),
  getStuckEmails: (olderThanMinutes: number) => call('getStuckEmails', { olderThanMinutes }),
  getEmailLog: () => call('getEmailLog'),
  resendEmail: (message_id: string) => call('resendEmail', { message_id }),
  listOfficialEmails: (box: string, limit: number) => call('listOfficialEmails', { box, limit }),
  getOfficialEmail: (message_id: string) => call('getOfficialEmail', { message_id }),
  sendOfficialEmail: (to: string, cc: string, subject: string, body: string, attachments: unknown) =>
    call('sendOfficialEmail', { to, cc, subject, body, attachments }),
  replyOfficialEmail: (message_id: string, body: string, attachments: unknown) =>
    call('replyOfficialEmail', { message_id, body, attachments }),
  markOfficialEmailRead: (message_id: string) => call('markOfficialEmailRead', { message_id }),
  cleanupPreview: (target: string, mode: string, days?: number | string) => call('cleanupPreview', { target, mode, days }),
  cleanupData: (target: string, mode: string, days?: number | string) => call('cleanupData', { target, mode, days }),
  getLoanEmailTemplates: (type: string) => call('getLoanEmailTemplates', { type }),
  addLoanEmailTemplate: (type: string, subject: string, text: string, messageType: string, fileLink: string) =>
    call('addLoanEmailTemplate', { type, subject, text, messageType, fileLink }),
  updateLoanEmailTemplate: (rowIndex: number, subject?: string, text?: string, active?: unknown, messageType?: string, fileLink?: string) =>
    call('updateLoanEmailTemplate', { rowIndex, subject, text, active, messageType, fileLink }),
  deleteLoanEmailTemplate: (rowIndex: number) => call('deleteLoanEmailTemplate', { rowIndex }),

  getWhatsappGroups: () => call('getWhatsappGroups'),
  addWhatsappGroup: (groupName: string, groupid: string) => call('addWhatsappGroup', { groupName, groupid }),
  updateWhatsappGroup: (rowIndex: number, groupName?: string, groupid?: string, active?: unknown) =>
    call('updateWhatsappGroup', { rowIndex, groupName, groupid, active }),
  deleteWhatsappGroup: (rowIndex: number) => call('deleteWhatsappGroup', { rowIndex }),

  getMessageLog: () => call('getMessageLog'),
  resendMessage: (type: string, message_id: string) => call('resendMessage', { type, message_id }),
  getStuckMessages: (olderThanMinutes: number) => call('getStuckMessages', { olderThanMinutes }),

  whatsappDiagnostic: () => call('whatsappDiagnostic'),

  getPortalSetting: (key: string) => call('getPortalSetting', { key }),
  setPortalSetting: (key: string, value: unknown) => call('setPortalSetting', { key, value }),

  getDropdownList: (type: string) => call('getDropdownList', { type }),
  getAllDropdownLists: () => call('getAllDropdownLists'),
  addDropdownListItem: (type: string, englishValue: string, hindiLabel: string) =>
    call('addDropdownListItem', { type, englishValue, hindiLabel }),
  updateDropdownListItem: (rowIndex: number, englishValue: string, hindiLabel: string, active: unknown) =>
    call('updateDropdownListItem', { rowIndex, englishValue, hindiLabel, active }),
  deleteDropdownListItem: (rowIndex: number) => call('deleteDropdownListItem', { rowIndex }),

  getConsentByToken: (token: string) => call('getConsentByToken', { token }, false),
  requestConsentOtp: (token: string) => call('requestConsentOtp', { token }, false),
  verifyConsentOtp: (token: string, otp: string) => call('verifyConsentOtp', { token, otp }, false),
  respondConsent: (token: string, decision: string, extra: any = {}) =>
    call(
      'respondConsent',
      {
        token,
        decision,
        geoLat: extra.geo && extra.geo.lat,
        geoLng: extra.geo && extra.geo.lng,
        geoAccuracy: extra.geo && extra.geo.accuracy,
        photoBase64: extra.photoBase64,
        signatureBase64: extra.signatureBase64,
        declineRemarks: extra.declineRemarks,
        verifyToken: extra.verifyToken
      },
      false
    ),

  getFestivalDates: (year: string) => call('getFestivalDates', { year }),
  saveFestivalDates: (year: string, diwali: string, nahayKhay: string, chhathArghya: string) =>
    call('saveFestivalDates', { year, diwali, nahayKhay, chhathArghya }),

  getConsentPageTemplate: (type: string) => call('getConsentPageTemplate', { type }),
  updateConsentPageTemplate: (type: string, text: string) => call('updateConsentPageTemplate', { type, text }),

  getConsentsForReview: () => call('getConsentsForReview'),
  setConsentVerification: (consentId: string, status: string, remarks: string) =>
    call('setConsentVerification', { consentId, status, remarks }),

  getReceiptTemplates: () => call('getReceiptTemplates'),
  getReceiptTemplate: (year: string) => call('getReceiptTemplate', { year }),
  saveReceiptTemplate: (year: string, text: string, pageSize: string) => call('saveReceiptTemplate', { year, text, pageSize }),
  copyReceiptTemplate: (fromYear: string, toYear: string) => call('copyReceiptTemplate', { fromYear, toYear }),
  deleteReceiptTemplate: (year: string) => call('deleteReceiptTemplate', { year }),
  getReceiptData: (rowIndex: number, year: string) => call('getReceiptData', { rowIndex, year }),

  logError: (source: string, page: string, message: string, stack?: string, context?: unknown) =>
    call('logError', { source, page, message, stack, context }, true),
  reportErrorToWhatsApp: (errorId: string) => call('reportErrorToWhatsApp', { errorId }, false),
  getErrorLog: (limit: number) => call('getErrorLog', { limit }),
  generateAiFix: (errorId: string, force: boolean, guidance: string) =>
    call('generateAiFix', { errorId, force: !!force, guidance: guidance || '' }),
  getAiFixes: (errorId?: string) => call('getAiFixes', { errorId }),
  getAiFix: (fixId: string) => call('getAiFix', { fixId }),
  getLatestAiFixForError: (errorId: string) => call('getLatestAiFixForError', { errorId }),
  createAiFixPr: (fixId: string) => call('createAiFixPr', { fixId }),
  getRenderJobStatus: (jobId: string) => call('getRenderJobStatus', { jobId }),
  getAiProviders: () => call('getAiProviders'),
  saveAiProvider: (p: unknown) => call('saveAiProvider', p as Record<string, unknown>),
  deleteAiProvider: (providerId: string) => call('deleteAiProvider', { providerId }),
  setDefaultAiProvider: (providerId: string, purpose?: string) => call('setDefaultAiProvider', { providerId, purpose }),
  reorderAiProviders: (purpose: string, orderedIds: unknown) => call('reorderAiProviders', { purpose, orderedIds }),
  testAiProvider: async (providerId: string, prompt?: string, maxTokens?: number) => {
    const res: any = await call('testAiProvider', { providerId, prompt, maxTokens });
    if (!res || !res.jobId) {
      return {
        ok: !!(res && res.ok),
        message: (res && res.message) || '',
        reply: (res && res.reply) || '',
        latencyMs: res && res.latencyMs,
        status: res && res.status,
        via: (res && res.via) || 'worker'
      };
    }
    const job = await pollRenderPdfJob(res.jobId, true);
    const r = (job && job.result) || {};
    return { ok: !!r.ok, message: r.message || '', reply: r.reply || '', latencyMs: r.latencyMs, status: r.status, via: 'render' };
  },

  getLoanConsents: (loanId: string) => call('getLoanConsents', { loanId }),
  resendConsent: (consentId: string) => call('resendConsent', { consentId }),
  replaceGuarantor: (loanId: string, oldConsentId: string, newPersonId: string) =>
    call('replaceGuarantor', { loanId, oldConsentId, newPersonId }),
  markLoanDisbursed: (loanId: string, cashAmount: number, onlineAmount: number) =>
    call('markLoanDisbursed', { loanId, cashAmount, onlineAmount }),

  getLoanTemplates: (type: string) => call('getLoanTemplates', { type }),
  addLoanTemplate: (type: string, text: string, messageType: string, fileLink: string) =>
    call('addLoanTemplate', { type, text, messageType, fileLink }),
  updateLoanTemplate: (rowIndex: number, text?: string, active?: unknown, messageType?: string, fileLink?: string) =>
    call('updateLoanTemplate', { rowIndex, text, active, messageType, fileLink }),
  deleteLoanTemplate: (rowIndex: number) => call('deleteLoanTemplate', { rowIndex }),

  getCertificateTemplates: () => call('getCertificateTemplates'),
  getCertificateTemplate: (year: string) => call('getCertificateTemplate', { year }),
  saveCertificateTemplate: (year: string, text: string, pageSize: string) =>
    call('saveCertificateTemplate', { year, text, pageSize }),
  copyCertificateTemplate: (fromYear: string, toYear: string) => call('copyCertificateTemplate', { fromYear, toYear }),
  deleteCertificateTemplate: (year: string) => call('deleteCertificateTemplate', { year }),
  getCertificateData: (rowIndex: number, year: string) => call('getCertificateData', { rowIndex, year }),

  getSamaanTemplates: () => call('getSamaanTemplates'),
  getSamaanTemplate: (year: string) => call('getSamaanTemplate', { year }),
  saveSamaanTemplate: (year: string, text: string, pageSize: string) => call('saveSamaanTemplate', { year, text, pageSize }),
  copySamaanTemplate: (fromYear: string, toYear: string) => call('copySamaanTemplate', { fromYear, toYear }),
  deleteSamaanTemplate: (year: string) => call('deleteSamaanTemplate', { year }),
  getSamaanData: (rowIndex: number, year: string) => call('getSamaanData', { rowIndex, year }),

  getDocxTemplates: (docType: string) => call('getDocxTemplates', { docType }),
  getDocxTemplate: (docType: string, year: string) => call('getDocxTemplate', { docType, year }),
  uploadDocxTemplate: (docType: string, year: string, base64: string, fileName: string) =>
    call('uploadDocxTemplate', { docType, year, base64, fileName }),
  copyDocxTemplate: (docType: string, fromYear: string, toYear: string) => call('copyDocxTemplate', { docType, fromYear, toYear }),
  deleteDocxTemplate: (docType: string, year: string) => call('deleteDocxTemplate', { docType, year }),
  getDocxTemplateForDoc: (docType: string, year: string) => call('getDocxTemplateForDoc', { docType, year }),
  getDocxTemplatePublic: (docType: string, year: string, token: string) =>
    call('getDocxTemplatePublic', { docType, year, token }, false),

  convertDocxToPdf: (docType: string, year: string, recordId: string, base64: string, fileName: string) =>
    call('convertDocxToPdf', { docType, year, recordId, base64, fileName }),
  convertDocxToPdfBulk: async (docType: string, year: string, recordId: string, base64: string, fileName: string, force?: boolean) => {
    const res: any = await call('convertDocxToPdfBulk', { docType, year, recordId, base64, fileName, force });
    if (!res || !res.jobId) return res;
    return pollRenderPdfJob(res.jobId);
  },
  convertDocxToPdfBatch: async (docType: string, year: string, items: unknown, force?: boolean) => {
    const res: any = await call('convertDocxToPdfBatch', { docType, year, items, force });
    const meta = {
      engine: (res && res.engine) || 'unknown',
      engineReason: (res && res.engineReason) || null,
      dispatchedCount: (res && res.dispatchedCount) || 0,
      skippedCount: (res && res.skippedCount) || 0,
      jobId: (res && res.jobId) || null
    };
    if (!res || !res.jobId) return { ...meta, results: (res && res.results) || [] };
    const job = await pollRenderPdfJob(res.jobId, true);
    const converted = (job && job.result && job.result.results) || [];
    const preSkipped = (res.preSkipped || []).map((s: any) => ({
      recordId: s.recordId,
      success: true,
      skipped: true,
      publicLink: s.publicLink,
      fileName: s.fileName
    }));
    return { ...meta, results: [...preSkipped, ...converted] };
  },
  convertDocxToPdfPublic: (base64: string, token: string) => call('convertDocxToPdfPublic', { base64, token }, false),

  getRecordsForDocType: (docType: string, year: string) => call('getRecordsForDocType', { docType, year }),
  getGeneratedFilesForYear: (year: string, docType: string) => call('getGeneratedFilesForYear', { year, docType }),
  searchUsersByVillageAndName: (village: string, query: string) => call('searchUsersByVillageAndName', { village, query }),
  getPersonDownloads: (userId: string) => call('getPersonDownloads', { userId }),

  getStorageOverview: () => call('getStorageOverview'),
  moveYearToDrive: (year: string) => call('moveYearToDrive', { year }),

  exportBackup: () => call('exportBackup'),
  restoreBackup: (backup: unknown, confirm: string | boolean, opts: unknown = {}) => call('restoreBackup', { backup, confirm, opts }),

  enqueueCollectionJob: (job: unknown) => call('enqueueCollectionJob', { job }),
  getCollectionQueueStatus: () => call('getCollectionQueueStatus'),
  processCollectionQueue: () => call('processCollectionQueue'),
  getQueueJobsForSuperadmin: (status: string | undefined, limit: number) => call('getQueueJobsForSuperadmin', { status, limit }),
  retryQueueJob: (jobId: string) => call('retryQueueJob', { jobId }),

  getPopups: () => call('getPopups'),
  getPopupWithSlides: (popupId: string) => call('getPopupWithSlides', { popupId }),
  savePopup: (popupId: string | undefined, title: string, roles: unknown, active: unknown, startAt: string, endAt: string) =>
    call('savePopup', { popupId, title, roles, active, startAt, endAt }),
  deletePopup: (popupId: string) => call('deletePopup', { popupId }),
  savePopupSlides: (popupId: string, slides: unknown) => call('savePopupSlides', { popupId, slides }),
  uploadPopupImage: (base64: string, fileName: string, mimeType: string) =>
    call('uploadPopupImage', { base64, fileName, mimeType }),
  uploadUserPhoto: (base64: string, fileName: string, idCode: string) =>
    call('uploadUserPhoto', { base64, fileName, idCode }),
  uploadDonationQr: (base64: string, fileName: string) =>
    call('uploadDonationQr', { base64, fileName }),
  sendCustomPush: (title: string, body: string, url?: string) =>
    call('sendCustomPush', { title, body, url }),
  listPushSubscriptions: (limit?: number) => call('listPushSubscriptions', { limit }),
  getJourneyEntries: () => call('getJourneyEntries'),
  saveJourneyEntry: (entry: unknown) => call('saveJourneyEntry', { entry }),
  deleteJourneyEntry: (id: number) => call('deleteJourneyEntry', { id }),
  reorderJourneyEntries: (orderedIds: number[]) => call('reorderJourneyEntries', { orderedIds }),
  getActivePopups: () => call('getActivePopups'),

  getSeoSettings: () => call('getSeoSettings'),
  saveSeoSettings: (payload: unknown) => call('saveSeoSettings', { payload }),
  uploadSeoImage: (base64: string, fileName: string) => call('uploadSeoImage', { base64, fileName }),
  triggerRebuild: (target: string) => call('triggerRebuild', { target }),
  previewPublicPopups: () => call('previewPublicPopups'),

  generateAnnouncementLink: (year: string, pin: string, expiresAt: string | null) =>
    call('generateAnnouncementLink', { year, pin, expiresAt }),
  getAnnouncementLinks: () => call('getAnnouncementLinks'),
  revokeAnnouncementLink: (token: string) => call('revokeAnnouncementLink', { token }),

  getCustomAnnouncements: (year: string) => call('getCustomAnnouncements', { year }),
  addCustomAnnouncement: (year: string, textHindi: string, textEnglish: string, priority: boolean) =>
    call('addCustomAnnouncement', { year, textHindi, textEnglish, priority }),
  updateCustomAnnouncement: (id: string, textHindi: string, textEnglish: string, priority: boolean) =>
    call('updateCustomAnnouncement', { id, textHindi, textEnglish, priority }),
  deleteCustomAnnouncement: (id: string) => call('deleteCustomAnnouncement', { id }),

  verifyAnnouncementPin: (token: string, pin: string) => call('verifyAnnouncementPin', { token, pin }, false),
  getAnnouncementQueue: (announceToken: string | null, statusFilter: string, typeFilter: string) =>
    call('getAnnouncementQueue', { announceToken, statusFilter, typeFilter }, false),
  markAnnounced: (announceToken: string | null, itemId: string, itemType: string) =>
    call('markAnnounced', { announceToken, itemId, itemType }, false),
  reannounceAll: (announceToken: string | null, typeFilter: string) => call('reannounceAll', { announceToken, typeFilter }, false)
};

export const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
