import { getSheetDataAsJSON, saveRecord } from './crud.js';
import { requireRole, requireYearUnlocked, requireYearAccess, requireSuperadmin, requireAdminOrAbove } from './auth.js';
import { toColumnPayload } from './tableRegistry.js';
import { getFestivalDates, dayNamesOf, otpConsentSenderNumber } from './settings.js';
import { getConsentPageTemplate } from './settings.js';
import { pickRandomActive, renderTemplate, queuePersonMessageDirect } from './whatsapp.js';
import { uploadFileToDrive } from './account.js';

function generateLoanId() { return 'LN' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function generateConsentId() { return 'CN' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function generateConsentToken() { return crypto.randomUUID().replace(/-/g, '') + Math.random().toString(36).slice(2, 8); }
function generateOtp() { return String(Math.floor(100000 + Math.random() * 900000)); }
function parseAmt(v) { return parseFloat((v || '').toString().replace(/[^0-9.-]+/g, '')) || 0; }
function isTruthyFlag(v) { return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true'; }
function whatsappNumberOf(user) {
  const raw = (user && (user.WhatsApp || user.Mobile) || '').toString().trim();
  return /^\d{10}$/.test(raw) ? raw : '';
}

// ---- Save / delete loan transaction ----

export async function saveLoanTransaction(env, loanPayload, guarantorPayloads, user) {
  requireRole(user, 'add', 'LOANS');
  if (loanPayload.Year) await requireYearUnlocked(env, loanPayload.Year);
  if (loanPayload.Year) await requireYearAccess(env, user, loanPayload.Year);
  if (!loanPayload.Name || !loanPayload.Amount) throw new Error('Missing required field: Name/Amount');
  if (!guarantorPayloads || guarantorPayloads.length !== 3) throw new Error('Exactly 3 guarantors required');

  const ids = [loanPayload.Name, ...guarantorPayloads.map(g => g.Guarantor)];
  if (new Set(ids).size !== ids.length) throw new Error('Receiver and Guarantors must all be different');

  const committee = (await getSheetDataAsJSON(env, 'COMMITEE MEMBERS')).map(c => c.Name);
  guarantorPayloads.forEach(g => {
    if (committee.includes(g.Guarantor)) throw new Error('Rule Violation: A Committee Member cannot be a Guarantor');
  });

  loanPayload['Created By'] = user.name;
  const loanId = generateLoanId();
  loanPayload['Loan ID'] = loanId;
  loanPayload['Loan Status'] = 'Created';

  const loanCols = toColumnPayload('loans', loanPayload);
  const loanKeys = Object.keys(loanCols);
  await env.DB_LOANS_EXPENSES.prepare(
    `INSERT INTO loans (${loanKeys.join(', ')}) VALUES (${loanKeys.map(() => '?').join(', ')})`
  ).bind(...loanKeys.map(k => loanCols[k])).run();

  const guarStmts = guarantorPayloads.map(gPayload => {
    gPayload['Created By'] = user.name;
    gPayload['Loan ID'] = loanId;
    const cols = toColumnPayload('loan_guarantors', gPayload);
    const keys = Object.keys(cols);
    return env.DB_LOANS_EXPENSES.prepare(
      `INSERT INTO loan_guarantors (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
    ).bind(...keys.map(k => cols[k]));
  });
  await env.DB_LOANS_EXPENSES.batch(guarStmts);

  try {
    await createLoanConsents(env, loanId, loanPayload, guarantorPayloads, user);
  } catch (err) {
    console.error('LoanConsentCreateError', err);
  }

  return { success: true, loanId };
}

export async function deleteLoanTransaction(env, rowIndex, year, loanerId, user, loanId) {
  requireRole(user, 'delete');
  await requireYearUnlocked(env, year);
  await requireYearAccess(env, user, year);

  await env.DB_LOANS_EXPENSES.prepare('DELETE FROM loans WHERE id = ?').bind(rowIndex).run();

  if (loanId) {
    await env.DB_LOANS_EXPENSES.prepare('DELETE FROM loan_guarantors WHERE loan_id = ?').bind(loanId.toString().trim()).run();
  } else {
    await env.DB_LOANS_EXPENSES.prepare('DELETE FROM loan_guarantors WHERE year = ? AND loaner = ?')
      .bind(parseInt(year), loanerId.toString().trim()).run();
  }
  return { success: true };
}

// ---- Consent creation (called right after saveLoanTransaction) ----

async function createLoanConsents(env, loanId, loanPayload, guarantorPayloads, user) {
  const users = await getSheetDataAsJSON(env, 'USERS');
  const userMap = {};
  users.forEach(u => { userMap[u.ID] = u; });

  const now = new Date().toISOString();
  const participants = [{ personId: loanPayload.Name, role: 'loaner' }]
    .concat(guarantorPayloads.map(g => ({ personId: g.Guarantor, role: 'guarantor' })));

  const created = [];
  for (const p of participants) {
    const consentId = generateConsentId();
    const token = generateConsentToken();
    await env.DB_LOANS_EXPENSES.prepare(
      'INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status, otp, otp_verified, send_count, created_at, responded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(consentId, loanId, p.personId, p.role, token, 'pending', '', 0, 1, now, '').run();
    created.push({ consentId, personId: p.personId, role: p.role, token });
  }

  const loanerU = userMap[loanPayload.Name] || {};
  const guarantorUsers = guarantorPayloads.map(g => userMap[g.Guarantor] || {});
  const rate = loanPayload['Intrest Rate'] || loanPayload['Interest Rate'] || '0';
  const consentBaseUrl = env.CONSENT_BASE_URL || '';
  const consentLink = (token) => consentBaseUrl + '/consent/' + token;

  const loanerConsent = created.find(c => c.role === 'loaner');
  const guarConsents = created.filter(c => c.role === 'guarantor');

  const baseData = {
    LoanerName: loanerU.Name || loanPayload.Name, LoanerNameHindi: loanerU['Name (Hindi)'] || '',
    Amount: parseAmt(loanPayload.Amount), Tenure: loanPayload.Tenure || '', InterestRate: rate,
    Guarantor1: guarantorUsers[0].Name || '', Guarantor2: guarantorUsers[1].Name || '', Guarantor3: guarantorUsers[2].Name || '',
    LoanerConsentLink: consentLink(loanerConsent.token),
    Guarantor1ConsentLink: consentLink(guarConsents[0].token),
    Guarantor2ConsentLink: consentLink(guarConsents[1].token),
    Guarantor3ConsentLink: consentLink(guarConsents[2].token),
  };

  // Group template — to all Active WhatsApp groups.
  try {
    const groups = (await getSheetDataAsJSON(env, 'WHATSAPP_GROUPS')).filter(g => isTruthyFlag(g.active));
    const groupTpls = (await getSheetDataAsJSON(env, 'LOAN_MESSAGE_TEMPLATES')).filter(t => t.type === 'consent_group');
    const sender = await otpConsentSenderNumber(env);
    for (const g of groups) {
      const tpl = pickRandomActive(groupTpls);
      if (!tpl) continue;
      await env.DB_WHATSAPP_INDEX.prepare(
        'INSERT INTO group_messages (message_id, groupid, message, status, remarks, created_at, "from", message_type, file_link) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind('MSG' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), g.groupid, renderTemplate(tpl.text, baseData), 'pending', '', new Date().toISOString(), sender, tpl.message_type || 'normal', tpl.file_link || '').run();
    }
  } catch (e) { console.error(e); }

  // Personal — loaner.
  try {
    const loanerWa = whatsappNumberOf(loanerU);
    const tpl = pickRandomActive((await getSheetDataAsJSON(env, 'LOAN_MESSAGE_TEMPLATES')).filter(t => t.type === 'consent_personal_loaner'));
    if (loanerWa && tpl) {
      const data = Object.assign({}, baseData, {
        Name: loanerU.Name || loanPayload.Name, NameHindi: loanerU['Name (Hindi)'] || '',
        FatherName: loanerU["Father's Name"] || '', FatherNameHindi: loanerU["Father's Name (Hindi)"] || '',
        Village: loanerU.Village || '', VillageHindi: loanerU['Village (Hindi)'] || '',
        ConsentLink: baseData.LoanerConsentLink,
      });
      await queuePersonMessageDirect(env, loanerWa, renderTemplate(tpl.text, data), await otpConsentSenderNumber(env), tpl.message_type, tpl.file_link);
    }
  } catch (e) { console.error(e); }

  // Personal — each guarantor.
  try {
    const personalGuarTpls = (await getSheetDataAsJSON(env, 'LOAN_MESSAGE_TEMPLATES')).filter(t => t.type === 'consent_personal_guarantor');
    for (let i = 0; i < guarConsents.length; i++) {
      const c = guarConsents[i];
      const gU = guarantorUsers[i] || {};
      const gWa = whatsappNumberOf(gU);
      const tpl = pickRandomActive(personalGuarTpls);
      if (!gWa || !tpl) continue;
      const data = Object.assign({}, baseData, {
        Name: gU.Name || c.personId, NameHindi: gU['Name (Hindi)'] || '',
        FatherName: gU["Father's Name"] || '', FatherNameHindi: gU["Father's Name (Hindi)"] || '',
        Village: gU.Village || '', VillageHindi: gU['Village (Hindi)'] || '',
        ConsentLink: consentLink(c.token),
      });
      await queuePersonMessageDirect(env, gWa, renderTemplate(tpl.text, data), await otpConsentSenderNumber(env), tpl.message_type, tpl.file_link);
    }
  } catch (e) { console.error(e); }
}

async function recomputeLoanStatus(env, loanId) {
  const { results } = await env.DB_LOANS_EXPENSES.prepare("SELECT status FROM loan_consents WHERE loan_id = ? AND status != 'replaced'").bind(loanId).all();
  const allAccepted = results.length > 0 && results.every(c => c.status === 'accepted');
  if (!allAccepted) return;
  await env.DB_LOANS_EXPENSES.prepare("UPDATE loans SET loan_status = 'Approved' WHERE loan_id = ? AND loan_status = 'Created'").bind(loanId).run();
}

async function findConsentRowByToken(env, token) {
  const row = await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM loan_consents WHERE token = ?').bind(token).first();
  return row || null;
}

// ---- PUBLIC (no login — token is the credential) ----

export async function getConsentByToken(env, token) {
  const rowObj = await findConsentRowByToken(env, token);
  if (!rowObj) throw new Error('Ye link valid nahi hai ya expire ho chuka hai.');
  const loanId = rowObj.loan_id;

  const loans = await getSheetDataAsJSON(env, 'LOANS');
  const loan = loans.find(l => l['Loan ID'] === loanId);
  if (!loan) throw new Error('Loan record nahi mila.');

  const users = await getSheetDataAsJSON(env, 'USERS');
  const userMap = {};
  users.forEach(u => { userMap[u.ID] = u; });
  const nameOf = (id) => (userMap[id] && userMap[id].Name) || id;

  const { results: allConsentsRaw } = await env.DB_LOANS_EXPENSES.prepare("SELECT * FROM loan_consents WHERE loan_id = ? AND status != 'replaced'").bind(loanId).all();
  const guarantorConsents = allConsentsRaw.filter(c => c.role === 'guarantor');
  const loanerConsent = allConsentsRaw.find(c => c.role === 'loaner');
  const acceptedCount = guarantorConsents.filter(c => c.status === 'accepted').length;
  const pendingCount = guarantorConsents.filter(c => c.status === 'pending').length;
  const declinedCount = guarantorConsents.filter(c => c.status === 'declined').length;
  const allGuarantorsAccepted = guarantorConsents.length > 0 && acceptedCount === guarantorConsents.length;

  const festival = await getFestivalDates(env, loan.Year);
  const diwali = dayNamesOf(festival['Diwali Next Day Date']);
  const nahayKhay = dayNamesOf(festival['Nahay-Khay Date']);
  const finalRepay = dayNamesOf(loan['Final Repayment Date']);
  const chhathArghya = dayNamesOf(festival['Chhath Morning Arghya Date']);

  const statusLabel = (s, c) => {
    if (s === 'accepted') {
      const v = c && c.verification_status;
      const suffix = v === 'verified' ? ' — Verified / सत्यापित'
        : v === 'rejected' ? ` — Rejected / अस्वीकृत${c.verification_remarks ? ` (Remarks: ${c.verification_remarks})` : ''}`
        : ' — Pending Verification / सत्यापन लंबित';
      return 'Accepted / स्वीकृत' + suffix;
    }
    if (s === 'declined') return 'Declined / अस्वीकृत' + (c && c.decline_remarks ? ` (Remarks: ${c.decline_remarks})` : '');
    return 'Pending / लंबित';
  };

  const placeholders = {
    LOANER_NAME: nameOf(loan.Name), GUARANTOR_NAME: nameOf(rowObj.person_id),
    LOAN_AMOUNT: loan.Amount, MONTHLY_INTEREST_RATE: loan['Intrest Rate'] || loan['Interest Rate'] || '0',
    MINIMUM_TENURE_MONTHS: loan.Tenure || '', FINAL_REPAYMENT_DATE: loan['Final Repayment Date'] || '',
    FUND_YEAR: loan.Year, LOAN_CONSENT_ID: loanerConsent ? loanerConsent.consent_id : '', CONSENT_ID: rowObj.consent_id,
    DIWALI_NEXT_DAY_DATE: festival['Diwali Next Day Date'] || '', DIWALI_NEXT_DAY_DAY_NAME: diwali.en ? `${diwali.en} / ${diwali.hi}` : '',
    NAHAY_KHAY_DATE: festival['Nahay-Khay Date'] || '', NAHAY_KHAY_DAY_NAME: nahayKhay.en ? `${nahayKhay.en} / ${nahayKhay.hi}` : '',
    FINAL_REPAYMENT_DAY_NAME: finalRepay.en ? `${finalRepay.en} / ${finalRepay.hi}` : '',
    CHHATH_MORNING_ARGHYA_DATE: festival['Chhath Morning Arghya Date'] || '', CHHATH_MORNING_ARGHYA_DAY_NAME: chhathArghya.en ? `${chhathArghya.en} / ${chhathArghya.hi}` : '',
    ACCEPTED_COUNT: acceptedCount, PENDING_COUNT: pendingCount, DECLINED_COUNT: declinedCount,
  };
  guarantorConsents.forEach((c, i) => {
    placeholders[`GUARANTOR_${i + 1}_NAME`] = nameOf(c.person_id);
    placeholders[`GUARANTOR_${i + 1}_STATUS`] = statusLabel(c.status, c);
  });

  const tplText = (await getConsentPageTemplate(env, rowObj.role === 'loaner' ? 'loaner_consent' : 'guarantor_consent')).text;

  return {
    status: rowObj.status,
    otpVerified: isTruthyFlag(rowObj.otp_verified),
    role: rowObj.role,
    templateText: tplText,
    placeholders,
    lockedReason: (rowObj.role === 'loaner' && !allGuarantorsAccepted) ? `${acceptedCount}/${guarantorConsents.length} guarantors accepted` : null,
  };
}

export async function requestConsentOtp(env, token) {
  const rowObj = await findConsentRowByToken(env, token);
  if (!rowObj) throw new Error('Ye link valid nahi hai.');
  if (rowObj.status !== 'pending') throw new Error('Is loan par aapka jawab pehle hi record ho chuka hai.');

  const users = await getSheetDataAsJSON(env, 'USERS');
  const person = users.find(u => u.ID === rowObj.person_id);
  const wa = whatsappNumberOf(person || {});
  if (!wa) throw new Error('Aapka WhatsApp number portal mein register nahi hai. Superadmin se contact karein.');

  const otp = generateOtp();
  await env.DB_LOANS_EXPENSES.prepare('UPDATE loan_consents SET otp = ?, otp_verified = 0 WHERE id = ?').bind(otp, rowObj.id).run();

  const otpTpl = pickRandomActive((await getSheetDataAsJSON(env, 'LOAN_MESSAGE_TEMPLATES')).filter(t => t.type === 'otp'));
  const message = otpTpl
    ? renderTemplate(otpTpl.text, { OTP: otp, Name: person ? person.Name : '' })
    : `Aapka loan consent verification OTP hai: ${otp}. Kisi ke saath share na karein.`;
  await queuePersonMessageDirect(env, wa, message, await otpConsentSenderNumber(env), otpTpl ? otpTpl.message_type : 'normal', otpTpl ? otpTpl.file_link : '');
  return { success: true };
}

export async function verifyConsentOtp(env, token, otp) {
  const rowObj = await findConsentRowByToken(env, token);
  if (!rowObj) throw new Error('Ye link valid nahi hai.');
  if (rowObj.status !== 'pending') throw new Error('Is loan par aapka jawab pehle hi record ho chuka hai.');
  if (!rowObj.otp || (otp || '').toString().trim() !== rowObj.otp.toString().trim()) {
    throw new Error('OTP galat hai.');
  }
  await env.DB_LOANS_EXPENSES.prepare('UPDATE loan_consents SET otp_verified = 1 WHERE id = ?').bind(rowObj.id).run();
  return { success: true };
}

export async function respondConsent(env, token, decision, deviceId, deviceInfo, clientIp, geoLat, geoLng, geoAccuracy, photoBase64, signatureBase64, declineRemarks) {
  if (decision !== 'accepted' && decision !== 'declined') throw new Error('Invalid decision');
  const rowObj = await findConsentRowByToken(env, token);
  if (!rowObj) throw new Error('Ye link valid nahi hai.');
  if (rowObj.status !== 'pending') throw new Error('Is loan par aapka jawab pehle hi record ho chuka hai — ye locked hai.');
  if (!isTruthyFlag(rowObj.otp_verified)) throw new Error('Pehle WhatsApp OTP se verify karein.');

  let photoUrl = '', signatureUrl = '';

  if (decision === 'accepted') {
    if (rowObj.role === 'loaner') {
      const { results: guarantorConsents } = await env.DB_LOANS_EXPENSES.prepare(
        "SELECT status FROM loan_consents WHERE loan_id = ? AND role = 'guarantor' AND status != 'replaced'"
      ).bind(rowObj.loan_id).all();
      const allAccepted = guarantorConsents.length > 0 && guarantorConsents.every(c => c.status === 'accepted');
      if (!allAccepted) throw new Error('Abhi Final Acceptance available nahi hai — pehle teeno guarantors ko Accept karna hoga.');
    }
    if (!geoLat || !geoLng) throw new Error('Location permission zaroori hai Accept karne ke liye.');
    if (!photoBase64) throw new Error('Photo capture karna zaroori hai Accept karne ke liye.');
    if (!signatureBase64) throw new Error('Signature upload karna zaroori hai Accept karne ke liye.');
    try {
      photoUrl = (await uploadFileToDrive(env, photoBase64, `consent_${rowObj.consent_id}_photo.jpg`, 'image/jpeg')).directUrl;
      signatureUrl = (await uploadFileToDrive(env, signatureBase64, `consent_${rowObj.consent_id}_signature.jpg`, 'image/jpeg')).directUrl;
    } catch (err) {
      throw new Error('Photo/Signature upload fail hua: ' + err.message);
    }
  } else {
    if (!declineRemarks || !declineRemarks.toString().trim()) throw new Error('Decline karne ke liye remarks likhna zaroori hai.');
  }

  const now = new Date().toISOString();
  if (decision === 'accepted') {
    await env.DB_LOANS_EXPENSES.prepare(
      `UPDATE loan_consents SET status = ?, responded_at = ?, device_id = ?, ip_address = ?, user_agent = ?, geo_lat = ?, geo_lng = ?, geo_accuracy = ?, photo_url = ?, signature_url = ?, verification_status = 'pending' WHERE id = ?`
    ).bind(decision, now, deviceId || '', clientIp || '', (deviceInfo || '').toString().slice(0, 200), geoLat || '', geoLng || '', geoAccuracy || '', photoUrl, signatureUrl, rowObj.id).run();
  } else {
    await env.DB_LOANS_EXPENSES.prepare(
      `UPDATE loan_consents SET status = ?, responded_at = ?, device_id = ?, ip_address = ?, user_agent = ?, geo_lat = ?, geo_lng = ?, geo_accuracy = ?, decline_remarks = ? WHERE id = ?`
    ).bind(decision, now, deviceId || '', clientIp || '', (deviceInfo || '').toString().slice(0, 200), geoLat || '', geoLng || '', geoAccuracy || '', declineRemarks.toString().trim(), rowObj.id).run();
  }

  if (decision === 'accepted') {
    await recomputeLoanStatus(env, rowObj.loan_id);
    await notifyConsentAccepted(env, rowObj.loan_id, rowObj.person_id, rowObj.role);
  }
  return { success: true, status: decision };
}

async function notifyConsentAccepted(env, loanId, personId, role) {
  try {
    const users = await getSheetDataAsJSON(env, 'USERS');
    const userMap = {};
    users.forEach(u => { userMap[u.ID] = u; });
    const loans = await getSheetDataAsJSON(env, 'LOANS');
    const loan = loans.find(l => l['Loan ID'] === loanId) || {};
    const loanerU = userMap[loan.Name] || {};
    const person = userMap[personId] || {};

    const data = {
      Name: person.Name || personId, NameHindi: person['Name (Hindi)'] || '',
      Role: role === 'loaner' ? 'Loaner' : 'Guarantor',
      LoanerName: loanerU.Name || loan.Name || '', LoanerNameHindi: loanerU['Name (Hindi)'] || '',
      Amount: parseAmt(loan.Amount), Tenure: loan.Tenure || '', InterestRate: loan['Intrest Rate'] || loan['Interest Rate'] || '0',
    };
    const sender = await otpConsentSenderNumber(env);

    const groupTpl = pickRandomActive((await getSheetDataAsJSON(env, 'LOAN_MESSAGE_TEMPLATES')).filter(t => t.type === 'consent_accepted_group'));
    if (groupTpl) {
      const groups = (await getSheetDataAsJSON(env, 'WHATSAPP_GROUPS')).filter(g => isTruthyFlag(g.active));
      for (const g of groups) {
        await env.DB_WHATSAPP_INDEX.prepare(
          'INSERT INTO group_messages (message_id, groupid, message, status, remarks, created_at, "from", message_type, file_link) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind('MSG' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), g.groupid, renderTemplate(groupTpl.text, data), 'pending', '', new Date().toISOString(), sender, groupTpl.message_type || 'normal', groupTpl.file_link || '').run();
      }
    }

    const loanerWa = whatsappNumberOf(loanerU);
    const loanerTpl = pickRandomActive((await getSheetDataAsJSON(env, 'LOAN_MESSAGE_TEMPLATES')).filter(t => t.type === 'consent_accepted_loaner_personal'));
    if (loanerWa && loanerTpl) {
      await queuePersonMessageDirect(env, loanerWa, renderTemplate(loanerTpl.text, data), sender, loanerTpl.message_type, loanerTpl.file_link);
    }

    if (role === 'guarantor') {
      const { results: guarantorConsents } = await env.DB_LOANS_EXPENSES.prepare(
        "SELECT status FROM loan_consents WHERE loan_id = ? AND role = 'guarantor' AND status != 'replaced'"
      ).bind(loanId).all();
      const allAccepted = guarantorConsents.length > 0 && guarantorConsents.every(c => c.status === 'accepted');
      if (allAccepted && loanerWa) {
        const readyTpl = pickRandomActive((await getSheetDataAsJSON(env, 'LOAN_MESSAGE_TEMPLATES')).filter(t => t.type === 'all_guarantors_accepted_loaner'));
        if (readyTpl) await queuePersonMessageDirect(env, loanerWa, renderTemplate(readyTpl.text, data), sender, readyTpl.message_type, readyTpl.file_link);
      }
    }
  } catch (e) { console.error(e); }
}

// ---- ADMIN (Superadmin/Admin) ----

export async function getLoanConsents(env, loanId, user) {
  const { results } = await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM loan_consents WHERE loan_id = ?').bind(loanId).all();
  const users = await getSheetDataAsJSON(env, 'USERS');
  const userMap = {};
  users.forEach(u => { userMap[u.ID] = u; });
  return results.map(c => Object.assign({}, c, {
    personName: (userMap[c.person_id] && userMap[c.person_id].Name) || c.person_id,
    personNameHindi: (userMap[c.person_id] && userMap[c.person_id]['Name (Hindi)']) || '',
  }));
}

export async function getConsentsForReview(env, user) {
  requireAdminOrAbove(user);
  const { results } = await env.DB_LOANS_EXPENSES.prepare(
    "SELECT * FROM loan_consents WHERE status = 'accepted' OR status = 'declined'"
  ).all();
  const users = await getSheetDataAsJSON(env, 'USERS');
  const loans = await getSheetDataAsJSON(env, 'LOANS');
  const userMap = {};
  users.forEach(u => { userMap[u.ID] = u; });
  const loanMap = {};
  loans.forEach(l => { loanMap[l['Loan ID']] = l; });

  return results
    .map(c => {
      const loan = loanMap[c.loan_id] || {};
      return Object.assign({}, c, {
        personName: (userMap[c.person_id] && userMap[c.person_id].Name) || c.person_id,
        personNameHindi: (userMap[c.person_id] && userMap[c.person_id]['Name (Hindi)']) || '',
        loanerName: (userMap[loan.Name] && userMap[loan.Name].Name) || loan.Name || '',
        loanAmount: loan.Amount || '', loanYear: loan.Year || '',
      });
    })
    .sort((a, b) => new Date(b.responded_at) - new Date(a.responded_at));
}

export async function setConsentVerification(env, consentId, status, remarks, user) {
  requireAdminOrAbove(user);
  if (status !== 'verified' && status !== 'rejected') throw new Error('Invalid verification status');
  const result = await env.DB_LOANS_EXPENSES.prepare(
    'UPDATE loan_consents SET verification_status = ?, verification_remarks = ?, verified_by = ?, verified_at = ? WHERE consent_id = ?'
  ).bind(status, remarks || '', user.name, new Date().toISOString(), consentId).run();
  if (!result.meta.changes) throw new Error('Consent record nahi mila.');
  if (status === 'verified') await notifyConsentVerified(env, consentId);
  return { success: true };
}

async function notifyConsentVerified(env, consentId) {
  try {
    const consent = await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM loan_consents WHERE consent_id = ?').bind(consentId).first();
    if (!consent) return;
    const users = await getSheetDataAsJSON(env, 'USERS');
    const userMap = {};
    users.forEach(u => { userMap[u.ID] = u; });
    const loans = await getSheetDataAsJSON(env, 'LOANS');
    const loan = loans.find(l => l['Loan ID'] === consent.loan_id) || {};
    const loanerU = userMap[loan.Name] || {};
    const person = userMap[consent.person_id] || {};
    const data = {
      Name: person.Name || consent.person_id, NameHindi: person['Name (Hindi)'] || '',
      Role: consent.role === 'loaner' ? 'Loaner' : 'Guarantor',
      LoanerName: loanerU.Name || loan.Name || '', LoanerNameHindi: loanerU['Name (Hindi)'] || '',
      Amount: parseAmt(loan.Amount), Tenure: loan.Tenure || '', InterestRate: loan['Intrest Rate'] || loan['Interest Rate'] || '0',
    };
    const sender = await otpConsentSenderNumber(env);

    const personWa = whatsappNumberOf(person);
    const verifiedTpl = pickRandomActive((await getSheetDataAsJSON(env, 'LOAN_MESSAGE_TEMPLATES')).filter(t => t.type === 'consent_verified_personal'));
    if (personWa && verifiedTpl) {
      await queuePersonMessageDirect(env, personWa, renderTemplate(verifiedTpl.text, data), sender, verifiedTpl.message_type, verifiedTpl.file_link);
    }

    const { results: allConsents } = await env.DB_LOANS_EXPENSES.prepare(
      "SELECT verification_status FROM loan_consents WHERE loan_id = ? AND status != 'replaced'"
    ).bind(consent.loan_id).all();
    const allVerified = allConsents.length > 0 && allConsents.every(c => c.verification_status === 'verified');
    if (allVerified) {
      const loanerWa = whatsappNumberOf(loanerU);
      const passedTpl = pickRandomActive((await getSheetDataAsJSON(env, 'LOAN_MESSAGE_TEMPLATES')).filter(t => t.type === 'loan_passed_personal'));
      if (loanerWa && passedTpl) {
        await queuePersonMessageDirect(env, loanerWa, renderTemplate(passedTpl.text, data), sender, passedTpl.message_type, passedTpl.file_link);
      }
    }
  } catch (e) { console.error(e); }
}

export async function resendConsent(env, consentId, user) {
  requireSuperadmin(user);
  const rowObj = await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM loan_consents WHERE consent_id = ?').bind(consentId).first();
  if (!rowObj) throw new Error('Consent record nahi mila.');
  if (rowObj.status === 'accepted') throw new Error('Ye pehle hi accept ho chuka hai — resend ki zaroorat nahi.');
  const sendCount = parseInt(rowObj.send_count) || 0;
  if (sendCount >= 5) throw new Error('Is guarantor/loaner ko already 5 baar bheja ja chuka hai. Ab guarantor replace karein.');

  const newToken = generateConsentToken();
  await env.DB_LOANS_EXPENSES.prepare(
    "UPDATE loan_consents SET token = ?, status = 'pending', otp = '', otp_verified = 0, send_count = ?, responded_at = '' WHERE id = ?"
  ).bind(newToken, sendCount + 1, rowObj.id).run();

  const users = await getSheetDataAsJSON(env, 'USERS');
  const person = users.find(u => u.ID === rowObj.person_id);
  const wa = whatsappNumberOf(person || {});
  const loans = await getSheetDataAsJSON(env, 'LOANS');
  const loan = loans.find(l => l['Loan ID'] === rowObj.loan_id) || {};
  const tplType = rowObj.role === 'loaner' ? 'consent_personal_loaner' : 'consent_personal_guarantor';
  const tpl = pickRandomActive((await getSheetDataAsJSON(env, 'LOAN_MESSAGE_TEMPLATES')).filter(t => t.type === tplType));
  if (wa && tpl) {
    const data2 = {
      Name: person.Name || rowObj.person_id, NameHindi: person['Name (Hindi)'] || '',
      Amount: loan.Amount || '', Tenure: loan.Tenure || '', InterestRate: loan['Intrest Rate'] || loan['Interest Rate'] || '0',
      ConsentLink: (env.CONSENT_BASE_URL || '') + '/consent/' + newToken,
    };
    await queuePersonMessageDirect(env, wa, renderTemplate(tpl.text, data2), await otpConsentSenderNumber(env), tpl.message_type, tpl.file_link);
  }
  return { success: true };
}

export async function replaceGuarantor(env, loanId, oldConsentId, newPersonId, user) {
  requireSuperadmin(user);
  const oldRow = await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM loan_consents WHERE consent_id = ?').bind(oldConsentId).first();
  if (!oldRow) throw new Error('Consent record nahi mila.');
  if (oldRow.role !== 'guarantor') throw new Error('Sirf guarantor replace kiya ja sakta hai.');
  if (oldRow.status === 'accepted') throw new Error('Ye guarantor pehle hi accept kar chuka hai — replace nahi kiya ja sakta.');

  const loans = await getSheetDataAsJSON(env, 'LOANS');
  const loan = loans.find(l => l['Loan ID'] === loanId);
  if (!loan) throw new Error('Loan nahi mila.');

  const { results: activeRows } = await env.DB_LOANS_EXPENSES.prepare(
    "SELECT person_id FROM loan_consents WHERE loan_id = ? AND status != 'replaced' AND consent_id != ?"
  ).bind(loanId, oldConsentId).all();
  const activeParticipants = activeRows.map(c => c.person_id);
  if (activeParticipants.includes(newPersonId)) throw new Error('Ye person pehle se is loan mein shaamil hai.');
  const committee = (await getSheetDataAsJSON(env, 'COMMITEE MEMBERS')).map(c => c.Name);
  if (committee.includes(newPersonId)) throw new Error('Rule Violation: Committee Member guarantor nahi ban sakta.');

  await env.DB_LOANS_EXPENSES.prepare("UPDATE loan_consents SET status = 'replaced' WHERE consent_id = ?").bind(oldConsentId).run();

  // Update loan_guarantors: swap old person_id -> newPersonId, matching by loan_id
  // when available (precise), else Year+Loaner (legacy rows with no loan_id).
  const byLoanId = await env.DB_LOANS_EXPENSES.prepare(
    'SELECT id FROM loan_guarantors WHERE loan_id = ? AND guarantor = ?'
  ).bind(loanId.toString().trim(), oldRow.person_id).first();
  if (byLoanId) {
    await env.DB_LOANS_EXPENSES.prepare('UPDATE loan_guarantors SET guarantor = ? WHERE id = ?').bind(newPersonId, byLoanId.id).run();
  } else {
    await env.DB_LOANS_EXPENSES.prepare(
      'UPDATE loan_guarantors SET guarantor = ? WHERE year = ? AND loaner = ? AND guarantor = ?'
    ).bind(newPersonId, parseInt(loan.Year), loan.Name, oldRow.person_id).run();
  }

  const consentId = generateConsentId();
  const token = generateConsentToken();
  await env.DB_LOANS_EXPENSES.prepare(
    'INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status, otp, otp_verified, send_count, created_at, responded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(consentId, loanId, newPersonId, 'guarantor', token, 'pending', '', 0, 1, new Date().toISOString(), '').run();

  const users = await getSheetDataAsJSON(env, 'USERS');
  const newPerson = users.find(u => u.ID === newPersonId) || {};
  const wa = whatsappNumberOf(newPerson);
  const tpl = pickRandomActive((await getSheetDataAsJSON(env, 'LOAN_MESSAGE_TEMPLATES')).filter(t => t.type === 'consent_personal_guarantor'));
  if (wa && tpl) {
    const tplData = {
      Name: newPerson.Name || newPersonId, NameHindi: newPerson['Name (Hindi)'] || '',
      Amount: loan.Amount, Tenure: loan.Tenure, InterestRate: loan['Intrest Rate'] || loan['Interest Rate'] || '0',
      ConsentLink: (env.CONSENT_BASE_URL || '') + '/consent/' + token,
    };
    await queuePersonMessageDirect(env, wa, renderTemplate(tpl.text, tplData), await otpConsentSenderNumber(env), tpl.message_type, tpl.file_link);
  }
  return { success: true };
}

export async function markLoanDisbursed(env, loanId, cashAmount, onlineAmount, user) {
  requireSuperadmin(user);
  const cash = parseFloat(cashAmount) || 0;
  const online = parseFloat(onlineAmount) || 0;
  if (cash <= 0 && online <= 0) throw new Error('Cash ya Online, kam se kam ek amount daalein.');

  const loanRow = await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM loans WHERE loan_id = ?').bind(loanId).first();
  if (!loanRow) throw new Error('Loan nahi mila.');
  if (loanRow.loan_status !== 'Approved') throw new Error('Loan abhi Approved nahi hai — pehle sabhi consents accept hone chahiye.');

  await env.DB_LOANS_EXPENSES.prepare(
    "UPDATE loans SET loan_status = 'Disbursed', cash_amount = ?, online_amount = ? WHERE loan_id = ?"
  ).bind(cash, online, loanId).run();

  try {
    const users = await getSheetDataAsJSON(env, 'USERS');
    const loaner = users.find(u => u.ID === loanRow.name) || {};
    const wa = whatsappNumberOf(loaner);
    const tpl = pickRandomActive((await getSheetDataAsJSON(env, 'LOAN_MESSAGE_TEMPLATES')).filter(t => t.type === 'disbursement'));
    if (wa && tpl) {
      const tplData = {
        Name: loaner.Name || loanRow.name, NameHindi: loaner['Name (Hindi)'] || '',
        Amount: loanRow.amount, Tenure: loanRow.tenure, InterestRate: loanRow.intrest_rate || '0',
        CashAmount: cash, OnlineAmount: online, TotalAmount: cash + online,
      };
      await queuePersonMessageDirect(env, wa, renderTemplate(tpl.text, tplData), await otpConsentSenderNumber(env), tpl.message_type, tpl.file_link);
    }
  } catch (e) { console.error(e); }

  return { success: true };
}

// ---- Loan template CRUD (Superadmin) — same pattern as Person/Group templates ----

export async function getLoanTemplates(env, type) {
  const { results } = await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM loan_message_templates WHERE type = ?').bind(type).all();
  return results;
}

export async function addLoanTemplate(env, type, text, messageType, fileLink, user) {
  requireSuperadmin(user);
  if (!text || !text.toString().trim()) throw new Error('Template text required');
  const id = 'LTPL' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await env.DB_LOANS_EXPENSES.prepare(
    'INSERT INTO loan_message_templates (template_id, type, text, active, created_at, message_type, file_link) VALUES (?, ?, ?, 1, ?, ?, ?)'
  ).bind(id, type, text.toString().trim(), new Date().toISOString(), messageType || 'normal', fileLink || '').run();
  return { success: true, template_id: id };
}

export async function updateLoanTemplate(env, rowIndex, text, active, messageType, fileLink, user) {
  requireSuperadmin(user);
  if (!rowIndex) throw new Error('rowIndex required');
  const sets = []; const vals = [];
  if (text !== undefined) { sets.push('text = ?'); vals.push(text); }
  if (active !== undefined) { sets.push('active = ?'); vals.push(active ? 1 : 0); }
  if (messageType !== undefined) { sets.push('message_type = ?'); vals.push(messageType); }
  if (fileLink !== undefined) { sets.push('file_link = ?'); vals.push(fileLink); }
  if (!sets.length) return { success: true };
  vals.push(rowIndex);
  await env.DB_LOANS_EXPENSES.prepare(`UPDATE loan_message_templates SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return { success: true };
}

export async function deleteLoanTemplate(env, rowIndex, user) {
  requireSuperadmin(user);
  if (!rowIndex) throw new Error('rowIndex required');
  await env.DB_LOANS_EXPENSES.prepare('DELETE FROM loan_message_templates WHERE id = ?').bind(rowIndex).run();
  return { success: true };
}
