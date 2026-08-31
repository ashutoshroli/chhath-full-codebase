const API_URL = import.meta.env.VITE_API_URL;
import { getDeviceId, getDeviceInfo, getClientIp } from './device.js';

const TOKEN_KEY = 'cpm_token';
const EXPIRY_KEY = 'cpm_token_expiry';
const REMEMBER_KEY = 'cpm_remember';
const USER_KEY = 'cpm_user';

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

const NO_AUTOLOG_ACTIONS = ['logError', 'reportErrorToWhatsApp', 'login'];

function fireAndForgetLogError(source, message, stack) {
  try {
    const body = { action: 'logError', source, page: window.location.pathname, message, stack: stack || '', context: '' };
    fetch(API_URL, { method: 'POST', body: JSON.stringify(body) }).catch(() => {});
  } catch (e) { /* never let logging break anything */ }
}

async function call(action, params = {}, requireAuth = true) {
  const body = { action, ...params, deviceId: getDeviceId(), deviceInfo: getDeviceInfo(), clientIp: await getClientIp() };
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
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(body), // text/plain content-type by default — avoids CORS preflight on Apps Script
    });
    const data = await res.json();
    if (data.authError) {
      clearSession();
      const err = new Error(data.message || 'Session expired');
      err.authError = true;
      throw err;
    }
    if (data.success === false) {
      const err = new Error(data.message || 'Request failed');
      Object.assign(err, data); // preserves extra flags like `expired` for callers that need them
      err.__logged = true;
      if (!NO_AUTOLOG_ACTIONS.includes(action)) fireAndForgetLogError('backend', `[${action}] ${err.message}`, '');
      throw err;
    }
    return data;
  } catch (err) {
    if (!err.authError && !NO_AUTOLOG_ACTIONS.includes(action) && !err.__logged) {
      err.__logged = true;
      fireAndForgetLogError('frontend', `[${action}] ${err.message}`, err.stack || '');
    }
    throw err;
  }
}

export const api = {
  login: (name, password, rememberMe) => call('login', { name, password, rememberMe }, false),
  logout: () => call('logout'),
  getYears: () => call('getYears'),
  getUsers: () => call('getUsers'),
  getCommittee: (year) => call('getCommittee', { year }),
  getHome: (year) => call('getHome', { year }),
  getExpenses: (year) => call('getExpenses', { year }),
  getLoans: (year) => call('getLoans', { year }),
  getUserHistory: (userId) => call('getUserHistory', { userId }),
  getUserProfile: (userId) => call('getUserProfile', { userId }),
  getYearContributors: (year) => call('getYearContributors', { year }),
  getLockedYears: () => call('getLockedYears'),
  lockYear: (year) => call('lockYear', { year }),
  unlockYear: (year) => call('unlockYear', { year }),
  addYear: (year) => call('addYear', { year }),
  updateOwnProfile: (payload) => call('updateOwnProfile', { payload }),
  changePassword: (currentPassword, newPassword) => call('changePassword', { currentPassword, newPassword }),

  // Login Management (Superadmin)
  getLoginUsers: () => call('getLoginUsers', {}),
  addLoginUser: (userId, password, role, mobile, email) => call('addLoginUser', { userId, password, role, mobile, email }),
  updateLoginUser: (rowIndex, password, role, mobile, email) => call('updateLoginUser', { rowIndex, password, role, mobile, email }),
  deleteLoginUser: (rowIndex) => call('deleteLoginUser', { rowIndex }),
  saveRecord: (sheet, payload) => call('saveRecord', { sheet, payload }),
  queueCollectionMessages: (payload, rowIndex, fileLink) => call('queueCollectionMessages', { payload, rowIndex, fileLink }),
  updateRecord: (sheet, rowIndex, payload) => call('updateRecord', { sheet, rowIndex, payload }),
  deleteRecord: (sheet, rowIndex) => call('deleteRecord', { sheet, rowIndex }),
  saveLoan: (loan, guarantors) => call('saveLoan', { loan, guarantors }),
  deleteLoan: (rowIndex, year, loanerId, loanId) => call('deleteLoan', { rowIndex, year, loanerId, loanId }),
  uploadFile: (base64, fileName, mimeType) => call('uploadFile', { base64, fileName, mimeType }),

  // WhatsApp: Templates
  getPersonTemplates: () => call('getPersonTemplates'),
  addPersonTemplate: (text, messageType, contributionType, fileLink, docSubType, fileDocType) => call('addPersonTemplate', { text, messageType, contributionType, fileLink, docSubType, fileDocType }),
  updatePersonTemplate: (rowIndex, text, active, messageType, contributionType, fileLink, docSubType, fileDocType) => call('updatePersonTemplate', { rowIndex, text, active, messageType, contributionType, fileLink, docSubType, fileDocType }),
  deletePersonTemplate: (rowIndex) => call('deletePersonTemplate', { rowIndex }),
  getGroupTemplates: () => call('getGroupTemplates'),
  addGroupTemplate: (text, messageType, contributionType, fileLink, docSubType, fileDocType) => call('addGroupTemplate', { text, messageType, contributionType, fileLink, docSubType, fileDocType }),
  updateGroupTemplate: (rowIndex, text, active, messageType, contributionType, fileLink, docSubType, fileDocType) => call('updateGroupTemplate', { rowIndex, text, active, messageType, contributionType, fileLink, docSubType, fileDocType }),
  deleteGroupTemplate: (rowIndex) => call('deleteGroupTemplate', { rowIndex }),

  // WhatsApp: Group Info
  getWhatsappGroups: () => call('getWhatsappGroups'),
  addWhatsappGroup: (groupName, groupid) => call('addWhatsappGroup', { groupName, groupid }),
  updateWhatsappGroup: (rowIndex, groupName, groupid, active) => call('updateWhatsappGroup', { rowIndex, groupName, groupid, active }),
  deleteWhatsappGroup: (rowIndex) => call('deleteWhatsappGroup', { rowIndex }),

  // WhatsApp: Message Log (view-only + Resend for failed)
  getMessageLog: () => call('getMessageLog'),
  resendMessage: (type, message_id) => call('resendMessage', { type, message_id }),

  // Portal Settings (OTP/Consent sender number)
  getPortalSetting: (key) => call('getPortalSetting', { key }),
  setPortalSetting: (key, value) => call('setPortalSetting', { key, value }),

  // Bilingual Dropdown Lists (Category / Payment Mode / Loan Status / Village)
  getDropdownList: (type) => call('getDropdownList', { type }),
  getAllDropdownLists: () => call('getAllDropdownLists'),
  addDropdownListItem: (type, englishValue, hindiLabel) => call('addDropdownListItem', { type, englishValue, hindiLabel }),
  updateDropdownListItem: (rowIndex, englishValue, hindiLabel, active) => call('updateDropdownListItem', { rowIndex, englishValue, hindiLabel, active }),
  deleteDropdownListItem: (rowIndex) => call('deleteDropdownListItem', { rowIndex }),

  // One-time column setup (Superadmin)
  ensureColumns: () => call('ensureColumns'),

  // Bulk-fill Hindi columns for pre-existing records (Superadmin)
  bulkFillHindi: (sheetName) => call('bulkFillHindi', { sheetName }),

  // Loan Consent — PUBLIC (no login; used by the /consent/:token page)
  getConsentByToken: (token) => call('getConsentByToken', { token }, false),
  requestConsentOtp: (token) => call('requestConsentOtp', { token }, false),
  verifyConsentOtp: (token, otp) => call('verifyConsentOtp', { token, otp }, false),
  respondConsent: (token, decision, extra = {}) => call('respondConsent', {
    token, decision,
    geoLat: extra.geo && extra.geo.lat, geoLng: extra.geo && extra.geo.lng, geoAccuracy: extra.geo && extra.geo.accuracy,
    photoBase64: extra.photoBase64, signatureBase64: extra.signatureBase64, declineRemarks: extra.declineRemarks,
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
  getErrorLog: () => call('getErrorLog'),

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
  getDocxTemplatePublic: (docType, year) => call('getDocxTemplatePublic', { docType, year }, false),

  // DOCX -> PDF conversion (fill happens client-side via docxtemplater first)
  convertDocxToPdf: (docType, year, recordId, base64, fileName, isAutoGenerate) => call('convertDocxToPdf', { docType, year, recordId, base64, fileName, isAutoGenerate }),
  convertDocxToPdfPublic: (docType, year, recordId, base64, fileName) => call('convertDocxToPdfPublic', { docType, year, recordId, base64, fileName }, false),

  // Bulk "Generate PDFs" (Superadmin)
  getRecordsForDocType: (docType, year) => call('getRecordsForDocType', { docType, year }),
  getGeneratedFilesForYear: (year, docType) => call('getGeneratedFilesForYear', { year, docType }),
  searchUsersByVillageAndName: (village, query) => call('searchUsersByVillageAndName', { village, query }),
  getPersonDownloads: (userId) => call('getPersonDownloads', { userId }),

  // Popup Management (Superadmin) + login-time fetch
  getPopups: () => call('getPopups'),
  getPopupWithSlides: (popupId) => call('getPopupWithSlides', { popupId }),
  savePopup: (popupId, title, roles, active, startAt, endAt) => call('savePopup', { popupId, title, roles, active, startAt, endAt }),
  deletePopup: (popupId) => call('deletePopup', { popupId }),
  savePopupSlides: (popupId, slides) => call('savePopupSlides', { popupId, slides }),
  uploadPopupImage: (base64, fileName) => call('uploadPopupImage', { base64, fileName }),
  getActivePopups: () => call('getActivePopups'),

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
