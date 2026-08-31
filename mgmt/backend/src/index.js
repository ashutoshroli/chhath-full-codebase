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

function jsonOut(obj) {
  return new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}

function notImplemented(name, hint) {
  return () => { throw new Error(`${name} is not yet ported to the Worker — see MIGRATION_NOTES.md ("Not yet ported") for status. ${hint || ''}`); };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
    }
    if (request.method === 'GET') {
      return jsonOut({ status: 'ok', message: 'Chhath Puja Management API is live (Cloudflare Worker)' });
    }

    let req;
    try {
      req = await request.json();
    } catch (e) {
      return jsonOut({ success: false, message: 'Invalid JSON body' });
    }
    const action = req.action;

    const handlers = {
      login: () => login(env, req.name, req.password, req.rememberMe),
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
      getDocxTemplateForDoc: () => withAuth(env, req, () => docx.getDocxTemplatePublic(env, req.docType, req.year)),
      getDocxTemplatePublic: () => docx.getDocxTemplatePublic(env, req.docType, req.year),
      convertDocxToPdf: () => withAuth(env, req, (user) => docx.convertDocxToPdf(env, req.docType, req.year, req.recordId, req.base64, req.fileName, user, req.isAutoGenerate)),
      convertDocxToPdfPublic: () => docx.convertDocxToPdfPublic(env, req.docType, req.year, req.recordId, req.base64, req.fileName),

      // ---- Bulk "Generate PDFs" + Download Center — fully ported ----
      getRecordsForDocType: () => withAuth(env, req, (user) => docx.getRecordsForDocType(env, req.docType, req.year, user)),
      getGeneratedFilesForYear: () => withAuth(env, req, (user) => docx.getGeneratedFilesForYear(env, req.year, user, req.docType)),
      searchUsersByVillageAndName: () => withAuth(env, req, () => docx.searchUsersByVillageAndName(env, req.village, req.query)),
      getPersonDownloads: () => withAuth(env, req, (user) => docx.getPersonDownloads(env, req.userId, user)),

      // ---- Popup Management ----
      getPopups: () => withAuth(env, req, (user) => popups.getPopups(env, user)),
      getPopupWithSlides: () => withAuth(env, req, (user) => popups.getPopupWithSlides(env, req.popupId, user)),
      savePopup: () => withAuth(env, req, (user) => popups.savePopup(env, req.popupId, req.title, req.roles, req.active, req.startAt, req.endAt, user)),
      deletePopup: () => withAuth(env, req, (user) => popups.deletePopup(env, req.popupId, user)),
      savePopupSlides: () => withAuth(env, req, (user) => popups.savePopupSlides(env, req.popupId, req.slides, user)),
      uploadPopupImage: () => withAuth(env, req, (user) => popups.uploadPopupImage(env, req.base64, req.fileName, user)),
      getActivePopups: () => withAuth(env, req, (user) => popups.getActivePopups(env, user)),

      // ---- Error Log (public log/report; Superadmin view) ----
      logError: () => logError(env, req.source, req.page, req.message, req.stack, req.context),
      reportErrorToWhatsApp: () => reportErrorToWhatsApp(env, req.errorId),
      getErrorLog: () => withAuth(env, req, (user) => getErrorLog(env, user)),

      // ---- Loan message templates (Superadmin) — fully ported, see loans.js ----
      getLoanTemplates: () => withAuth(env, req, (user) => { requireSuperadmin(user); return loans.getLoanTemplates(env, req.type); }),
      addLoanTemplate: () => withAuth(env, req, (user) => loans.addLoanTemplate(env, req.type, req.text, req.messageType, req.fileLink, user)),
      updateLoanTemplate: () => withAuth(env, req, (user) => loans.updateLoanTemplate(env, req.rowIndex, req.text, req.active, req.messageType, req.fileLink, user)),
      deleteLoanTemplate: () => withAuth(env, req, (user) => loans.deleteLoanTemplate(env, req.rowIndex, user)),

      // ---- WhatsApp: Queue polling (apiKey-based, external automation script) ----
      getPendingMessages: () => withApiKey(env, req, () => wa.getPendingMessages(env)),
      updateMessageStatus: () => withApiKey(env, req, () => wa.updateMessageStatus(env, req.type, req.message_id, req.status, req.remarks)),
      resendMessage: () => withAuth(env, req, (user) => wa.resendMessage(env, req.type, req.message_id, user)),
      
      // ---- WhatsApp: Diagnostic endpoint (Superadmin only) ----
      whatsappDiagnostic: () => withAuth(env, req, async (user) => {
        const allGroups = await getSheetDataAsJSON(env, 'WHATSAPP_GROUPS');
        const allGroupTemplates = await getSheetDataAsJSON(env, 'GROUP_MESSAGE_TEMPLATES');
        const allPersonTemplates = await getSheetDataAsJSON(env, 'PERSON_MESSAGE_TEMPLATES');
        
        // Helper to check active status (exported from whatsapp.js later)
        const checkActive = (v) => {
          if (typeof v === 'boolean') return v;
          if (typeof v === 'number') return v === 1;
          if (typeof v === 'string') {
            const normalized = v.toLowerCase().trim();
            return normalized === 'true' || normalized === '1' || normalized === 'yes';
          }
          return false;
        };
        
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

    if (!handlers[action]) return jsonOut({ success: false, message: 'Unknown action' });

    try {
      const result = await handlers[action]();
      return jsonOut(result);
    } catch (err) {
      const status = err.authError ? 'authError' : (err.announceSessionExpired ? 'announceSessionExpired' : 'error');
      return jsonOut({ success: false, message: err.message || String(err), [status]: true });
    }
  },
};
