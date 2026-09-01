import { getSheetDataAsJSON, saveRecord } from './crud.js';
import { requireRole, requireYearUnlocked, requireYearAccess, requireSuperadmin, requireAdminOrAbove, requireStaffRole, ValidationError, timingSafeEqualHex } from './auth.js';
import { toColumnPayload } from './tableRegistry.js';
import { otpConsentSenderNumber } from './settings.js';
import { getConsentPageTemplate } from './settings.js';
import { pickRandomActive, renderTemplateChecked, queuePersonMessageDirect, queueGroupMessageDirect, isTruthyFlag as waTruthyFlag } from './whatsapp.js';
import { uploadFileToDrive } from './account.js';
import { r2Available, putToR2, keyForYear } from './r2.js';
import { base64ToBytes } from './base64.js';
import { logErrorAt, logWarn } from './logger.js';
import { waNumberOf, looksLikeAttemptedNumber } from './phone.js';
import { buildConsentPlaceholders } from './consentPlaceholders.js';

function generateLoanId() { return 'LN' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function generateConsentId() { return 'CN' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function generateConsentToken() { return crypto.randomUUID().replace(/-/g, '') + Math.random().toString(36).slice(2, 8); }
function generateOtp() { return String(Math.floor(100000 + Math.random() * 900000)); }
function parseAmt(v) { return parseFloat((v || '').toString().replace(/[^0-9.-]+/g, '')) || 0; }
const isTruthyFlag = waTruthyFlag;

// Uploads a consent photo/signature. Prefers R2 (year-wise key), falls back to
// Google Drive when R2 isn't configured — so this keeps working before the
// bucket exists. `year` groups the object so the Superadmin "Move <year> to
// Drive" feature can find it later; returns the public URL to store.
async function uploadConsentFile(env, base64, fileName, year) {
  if (r2Available(env)) {
    const bytes = base64ToBytes(base64, { label: fileName || 'File' });
    const key = keyForYear(year, 'consent', fileName);
    return putToR2(env, key, bytes, 'image/jpeg');
  }
  // Drive fallback (returns the lh3 directUrl, unchanged behaviour).
  return (await uploadFileToDrive(env, base64, fileName, 'image/jpeg')).directUrl;
}

// OTP hardening: previously an OTP never expired and verifyConsentOtp() had NO
// attempt limit at all — unlimited guesses against a 6-digit code.
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_VERIFY_ATTEMPTS = 5;
const OTP_MAX_REQUESTS_PER_HOUR = 5;

// CONSENT_BASE_URL used to fall back to '' (`env.CONSENT_BASE_URL || ''`), so a
// misconfigured Worker silently sent every consent invitation with a dead
// relative link like "/consent/<token>" — recorded as `sent`, impossible to open.
// wrangler.toml still ships the literal placeholder domain, so check for that too.
function consentLinkBuilder(env) {
  const base = (env.CONSENT_BASE_URL || '').toString().trim().replace(/\/+$/, '');
  const isPlaceholder = !base || /YOUR-FRONTEND-DOMAIN|example\.com/i.test(base);
  if (isPlaceholder) {
    throw new Error(
      'CONSENT_BASE_URL server par configure nahi hai (abhi placeholder value hai). ' +
      'Consent link bheja nahi ja sakta — wrangler.toml / Worker vars mein asli frontend domain set karein.'
    );
  }
  return (token) => `${base}/consent/${token}`;
}

// Reads LOAN_MESSAGE_TEMPLATES exactly once per request instead of the 3-6 times
// the old code did (createLoanConsents alone read it three separate times, and
// otpConsentSenderNumber() was called inside the guarantor loop).
async function loanTemplateContext(env) {
  const [all, sender] = await Promise.all([
    getSheetDataAsJSON(env, 'LOAN_MESSAGE_TEMPLATES'),
    otpConsentSenderNumber(env),
  ]);
  return {
    sender,
    pick: (type) => pickRandomActive(all.filter(t => t.type === type)),
    countFor: (type) => all.filter(t => t.type === type).length,
  };
}

// Renders a loan template and logs any placeholder the caller didn't supply.
// Unresolved tokens used to be delivered LITERALLY — real `status='sent'` rows in
// the migration data contain {FatherName}, {Village}, {Guarantor1}, etc.
async function renderLoanTemplate(env, page, tpl, data, context) {
  const { text, missing } = renderTemplateChecked(tpl.text, data);
  if (missing.length) {
    await logWarn(env, 'whatsapp-template', page,
      `Loan template ${tpl.template_id || '(unknown)'} [${tpl.type}] has unresolved placeholder(s): ${[...new Set(missing)].join(', ')} — rendered blank.`,
      { templateId: tpl.template_id, type: tpl.type, missing: [...new Set(missing)], ...(context || {}) });
  }
  return text;
}

// Every send site below used to be a bare `catch (e) { console.error(e) }`, i.e.
// invisible in the portal. This wrapper keeps the "never break the main
// operation" behaviour but always leaves an error_log row behind.
async function trySend(env, page, fn, context) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[loans:${page}]`, err);
    await logErrorAt(env, 'whatsapp-loans', page, err, context);
    return { failed: true, error: err.message };
  }
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

  // The loan rows are committed at this point, so we must not throw — but the
  // old code did `console.error(...)` and then returned a flat {success:true},
  // meaning a loan could be saved with NO consent records and NO WhatsApp
  // invitations while the admin was told everything worked.
  let consentResult;
  try {
    consentResult = await createLoanConsents(env, loanId, loanPayload, guarantorPayloads, user);
  } catch (err) {
    console.error('LoanConsentCreateError', err);
    await logErrorAt(env, 'backend-loans', 'saveLoanTransaction:createLoanConsents', err, {
      loanId, loanerId: loanPayload.Name, year: loanPayload.Year,
    });
    return {
      success: true,
      loanId,
      consentWarning:
        'Loan save ho gaya, lekin consent records / WhatsApp invitations banane mein problem hui: ' +
        err.message + ' — Loan Consents screen se "Resend" karein.',
    };
  }

  const warnings = (consentResult && consentResult.warnings) || [];
  return warnings.length
    ? { success: true, loanId, consentWarning: 'Loan save ho gaya, lekin: ' + warnings.join(' | ') }
    : { success: true, loanId };
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
  const consentLink = consentLinkBuilder(env); // throws early if misconfigured

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

  // One read of LOAN_MESSAGE_TEMPLATES + one read of the sender number for all
  // three blocks below (was 3 template reads + up to 5 sender reads).
  const tpls = await loanTemplateContext(env);
  const warnings = [];

  // Group template — to all Active WhatsApp groups.
  await trySend(env, 'createLoanConsents:group', async () => {
    const groups = (await getSheetDataAsJSON(env, 'WHATSAPP_GROUPS')).filter(g => isTruthyFlag(g.active));
    if (!groups.length) {
      warnings.push('koi active WhatsApp group nahi hai');
      await logWarn(env, 'whatsapp-loans', 'createLoanConsents:group',
        'No ACTIVE WhatsApp group configured — loan consent group announcement was not queued.', { loanId });
      return;
    }
    for (const g of groups) {
      const tpl = tpls.pick('consent_group');
      if (!tpl) {
        warnings.push('consent_group template active nahi hai');
        await logWarn(env, 'whatsapp-loans', 'createLoanConsents:group',
          'No active "consent_group" loan message template — group announcement was not queued.', { loanId });
        return;
      }
      const message = await renderLoanTemplate(env, 'createLoanConsents:group', tpl, baseData, { loanId });
      await queueGroupMessageDirect(env, g.groupid, message, tpls.sender, tpl.message_type, tpl.file_link);
    }
  }, { loanId });

  // Personal — loaner.
  await trySend(env, 'createLoanConsents:loaner', async () => {
    const loanerWa = waNumberOf(loanerU);
    const tpl = tpls.pick('consent_personal_loaner');
    if (!tpl) {
      warnings.push('consent_personal_loaner template active nahi hai');
      await logWarn(env, 'whatsapp-loans', 'createLoanConsents:loaner',
        'No active "consent_personal_loaner" template — the loaner got no consent link.', { loanId, loanerId: loanPayload.Name });
      return;
    }
    if (!loanerWa) {
      warnings.push(`loaner ka WhatsApp number invalid/missing hai`);
      await logWarn(env, 'whatsapp-loans', 'createLoanConsents:loaner',
        looksLikeAttemptedNumber(loanerU.WhatsApp || loanerU.Mobile)
          ? `Loaner ${loanPayload.Name} has an INVALID WhatsApp/Mobile number — consent link not sent.`
          : `Loaner ${loanPayload.Name} has no WhatsApp/Mobile number on file — consent link not sent.`,
        { loanId, loanerId: loanPayload.Name });
      return;
    }
    const data = Object.assign({}, baseData, {
      Name: loanerU.Name || loanPayload.Name, NameHindi: loanerU['Name (Hindi)'] || '',
      FatherName: loanerU["Father's Name"] || '', FatherNameHindi: loanerU["Father's Name (Hindi)"] || '',
      Village: loanerU.Village || '', VillageHindi: loanerU['Village (Hindi)'] || '',
      ConsentLink: baseData.LoanerConsentLink,
    });
    const message = await renderLoanTemplate(env, 'createLoanConsents:loaner', tpl, data, { loanId });
    await queuePersonMessageDirect(env, loanerWa, message, tpls.sender, tpl.message_type, tpl.file_link);
  }, { loanId, loanerId: loanPayload.Name });

  // Personal — each guarantor.
  await trySend(env, 'createLoanConsents:guarantors', async () => {
    const tpl0 = tpls.countFor('consent_personal_guarantor');
    if (!tpl0) {
      warnings.push('consent_personal_guarantor template active nahi hai');
      await logWarn(env, 'whatsapp-loans', 'createLoanConsents:guarantors',
        'No "consent_personal_guarantor" template — none of the guarantors got a consent link.', { loanId });
      return;
    }
    for (let i = 0; i < guarConsents.length; i++) {
      const c = guarConsents[i];
      const gU = guarantorUsers[i] || {};
      const gWa = waNumberOf(gU);
      const tpl = tpls.pick('consent_personal_guarantor');
      if (!tpl) continue;
      if (!gWa) {
        warnings.push(`guarantor ${gU.Name || c.personId} ka WhatsApp number invalid/missing hai`);
        await logWarn(env, 'whatsapp-loans', 'createLoanConsents:guarantors',
          looksLikeAttemptedNumber(gU.WhatsApp || gU.Mobile)
            ? `Guarantor ${gU.Name || c.personId} has an INVALID WhatsApp/Mobile number — consent link not sent.`
            : `Guarantor ${gU.Name || c.personId} has no WhatsApp/Mobile number on file — consent link not sent.`,
          { loanId, consentId: c.consentId, personId: c.personId });
        continue;
      }
      const data = Object.assign({}, baseData, {
        Name: gU.Name || c.personId, NameHindi: gU['Name (Hindi)'] || '',
        FatherName: gU["Father's Name"] || '', FatherNameHindi: gU["Father's Name (Hindi)"] || '',
        Village: gU.Village || '', VillageHindi: gU['Village (Hindi)'] || '',
        ConsentLink: consentLink(c.token),
      });
      const message = await renderLoanTemplate(env, 'createLoanConsents:guarantors', tpl, data, { loanId, consentId: c.consentId });
      await queuePersonMessageDirect(env, gWa, message, tpls.sender, tpl.message_type, tpl.file_link);
    }
  }, { loanId });

  return { warnings };
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
  if (!rowObj) throw ValidationError('Ye link valid nahi hai ya expire ho chuka hai.');
  const loanId = rowObj.loan_id;

  const loans = await getSheetDataAsJSON(env, 'LOANS');
  const loan = loans.find(l => l['Loan ID'] === loanId);
  if (!loan) throw ValidationError('Loan record nahi mila.');

  const users = await getSheetDataAsJSON(env, 'USERS');
  const userMap = {};
  users.forEach(u => { userMap[u.ID] = u; });
  const nameOf = (id) => (userMap[id] && userMap[id].Name) || id;

  const { results: allConsentsRaw } = await env.DB_LOANS_EXPENSES.prepare("SELECT * FROM loan_consents WHERE loan_id = ? AND status != 'replaced'").bind(loanId).all();
  const guarantorConsents = allConsentsRaw.filter(c => c.role === 'guarantor');
  const acceptedCount = guarantorConsents.filter(c => c.status === 'accepted').length;
  const allGuarantorsAccepted = guarantorConsents.length > 0 && acceptedCount === guarantorConsents.length;

  // Was ~35 lines of inline placeholder construction + a private copy of
  // statusLabel(). Both now live in consentPlaceholders.js so Bulk Generate and
  // Download Center produce the IDENTICAL map (they previously supplied only 6 of
  // these keys, silently blanking every festival date and count).
  const placeholders = await buildConsentPlaceholders(env, loan, allConsentsRaw, rowObj, nameOf);

  const tplText = (await getConsentPageTemplate(env, rowObj.role === 'loaner' ? 'loaner_consent' : 'guarantor_consent')).text;

  return {
    status: rowObj.status,
    otpVerified: isTruthyFlag(rowObj.otp_verified),
    role: rowObj.role,
    templateText: tplText,
    placeholders,
    // The Consent page builds its PDF recordId from this instead of guessing
    // between LOAN_CONSENT_ID and CONSENT_ID (the old `LOAN_CONSENT_ID ||
    // CONSENT_ID` picked the LOANER's id for a guarantor, so every guarantor PDF
    // was indexed under the wrong key and never appeared anywhere again).
    consentId: rowObj.consent_id,
    docType: rowObj.role === 'loaner' ? 'consent_loaner' : 'consent_guarantor',
    lockedReason: (rowObj.role === 'loaner' && !allGuarantorsAccepted) ? `${acceptedCount}/${guarantorConsents.length} guarantors accepted` : null,
  };
}

// OTP state that the loan_consents table has no columns for (otp_issued_at,
// otp_attempts) is kept in KV, keyed by consent_id. This avoids a schema change
// on a table the external tooling also reads, and gives us free TTL expiry.
const otpMetaKey = (consentId) => `consentotp:${consentId}`;

async function readOtpMeta(env, consentId) {
  if (!env.KV_SESSIONS) return null;
  try {
    const raw = await env.KV_SESSIONS.get(otpMetaKey(consentId));
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

async function writeOtpMeta(env, consentId, meta) {
  if (!env.KV_SESSIONS) return;
  try {
    await env.KV_SESSIONS.put(otpMetaKey(consentId), JSON.stringify(meta), {
      expirationTtl: Math.max(60, Math.ceil(OTP_TTL_MS / 1000) * 2),
    });
  } catch (e) { /* KV unavailable — verification still works, just without TTL */ }
}

export async function requestConsentOtp(env, token) {
  const rowObj = await findConsentRowByToken(env, token);
  if (!rowObj) throw ValidationError('Ye link valid nahi hai.');
  if (rowObj.status !== 'pending') throw ValidationError('Is loan par aapka jawab pehle hi record ho chuka hai.');

  const users = await getSheetDataAsJSON(env, 'USERS');
  const person = users.find(u => u.ID === rowObj.person_id);
  const wa = waNumberOf(person || {});
  if (!wa) throw new Error('Aapka WhatsApp number portal mein register nahi hai. Superadmin se contact karein.');

  // requestConsentOtp is unauthenticated by design (the token IS the credential),
  // but previously anyone holding a link could enqueue UNLIMITED OTP messages to
  // that person's number — a spam/ban vector for the sending device.
  const prev = await readOtpMeta(env, rowObj.consent_id);
  const hourAgo = Date.now() - 3600000;
  const recentRequests = ((prev && prev.requests) || []).filter(t => t > hourAgo);
  if (recentRequests.length >= OTP_MAX_REQUESTS_PER_HOUR) {
    throw new Error(`Ek ghante mein sirf ${OTP_MAX_REQUESTS_PER_HOUR} baar OTP bheja ja sakta hai. Thodi der baad koshish karein.`);
  }

  const otp = generateOtp();
  const issuedAt = Date.now();
  await env.DB_LOANS_EXPENSES.prepare('UPDATE loan_consents SET otp = ?, otp_verified = 0 WHERE id = ?').bind(otp, rowObj.id).run();
  await writeOtpMeta(env, rowObj.consent_id, {
    issuedAt,
    attempts: 0,
    requests: recentRequests.concat(issuedAt),
  });

  const tpls = await loanTemplateContext(env);
  const otpTpl = tpls.pick('otp');
  const message = otpTpl
    ? await renderLoanTemplate(env, 'requestConsentOtp', otpTpl, { OTP: otp, Name: person ? person.Name : '' }, { consentId: rowObj.consent_id })
    : `Aapka loan consent verification OTP hai: ${otp}. Ye ${Math.round(OTP_TTL_MS / 60000)} minute mein expire ho jayega. Kisi ke saath share na karein.`;

  const res = await queuePersonMessageDirect(env, wa, message, tpls.sender, otpTpl ? otpTpl.message_type : 'normal', otpTpl ? otpTpl.file_link : '');
  if (!res || !res.success) {
    await logWarn(env, 'whatsapp-loans', 'requestConsentOtp',
      `OTP message could NOT be queued for consent ${rowObj.consent_id} (number rejected).`,
      { consentId: rowObj.consent_id, personId: rowObj.person_id });
    throw new Error('OTP bheja nahi ja saka — aapka registered number valid nahi hai. Superadmin se contact karein.');
  }
  return { success: true, expiresInMinutes: Math.round(OTP_TTL_MS / 60000) };
}

export async function verifyConsentOtp(env, token, otp) {
  const rowObj = await findConsentRowByToken(env, token);
  if (!rowObj) throw ValidationError('Ye link valid nahi hai.');
  if (rowObj.status !== 'pending') throw ValidationError('Is loan par aapka jawab pehle hi record ho chuka hai.');
  if (!rowObj.otp || rowObj.otp.toString().trim() === '') throw ValidationError('Pehle OTP request karein.');

  const meta = (await readOtpMeta(env, rowObj.consent_id)) || {};

  // Expiry: an OTP used to be valid forever.
  if (meta.issuedAt && Date.now() - meta.issuedAt > OTP_TTL_MS) {
    throw ValidationError('OTP expire ho gaya hai. Naya OTP request karein.');
  }

  // Attempt limit: there was NO limit at all — unlimited guesses against a
  // 6-digit code.
  const attempts = parseInt(meta.attempts) || 0;
  if (attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    await logWarn(env, 'backend-loans', 'verifyConsentOtp',
      `OTP verification locked for consent ${rowObj.consent_id} after ${attempts} wrong attempts.`,
      { consentId: rowObj.consent_id, personId: rowObj.person_id });
    throw ValidationError('Bahut baar galat OTP daala gaya. Naya OTP request karein.');
  }

  // Normalize both sides — otp is a REAL column, so '012345' can come back as 12345.
  const expected = rowObj.otp.toString().trim().replace(/\.0+$/, '');
  const supplied = (otp === undefined || otp === null ? '' : otp.toString()).trim();
  // Constant-time compare so a wrong OTP can't be narrowed down digit-by-digit
  // via response timing (the attempt cap is small, but this closes the side
  // channel regardless). Hex-encode first since the helper compares hex strings.
  const toHexStr = (s) => Array.from(s).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  if (!timingSafeEqualHex(toHexStr(supplied), toHexStr(expected))) {
    await writeOtpMeta(env, rowObj.consent_id, Object.assign({}, meta, { attempts: attempts + 1 }));
    const left = OTP_MAX_VERIFY_ATTEMPTS - (attempts + 1);
    throw new Error(`OTP galat hai.${left > 0 ? ` ${left} koshish bachi hai.` : ' Naya OTP request karein.'}`);
  }

  await env.DB_LOANS_EXPENSES.prepare('UPDATE loan_consents SET otp_verified = 1 WHERE id = ?').bind(rowObj.id).run();
  // Burn the OTP so the same code can't be reused after the decision window.
  await writeOtpMeta(env, rowObj.consent_id, Object.assign({}, meta, { attempts: 0, verifiedAt: Date.now() }));
  return { success: true };
}

export async function respondConsent(env, token, decision, deviceId, deviceInfo, clientIp, geoLat, geoLng, geoAccuracy, photoBase64, signatureBase64, declineRemarks) {
  if (decision !== 'accepted' && decision !== 'declined') throw new Error('Invalid decision');
  const rowObj = await findConsentRowByToken(env, token);
  if (!rowObj) throw ValidationError('Ye link valid nahi hai.');
  if (rowObj.status !== 'pending') throw ValidationError('Is loan par aapka jawab pehle hi record ho chuka hai — ye locked hai.');
  if (!isTruthyFlag(rowObj.otp_verified)) throw ValidationError('Pehle WhatsApp OTP se verify karein.');

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
      // Derive the loan's year so the files land under the right R2 year prefix
      // (used by the Superadmin "Move <year> to Drive" feature). If the loan
      // can't be resolved, keyForYear() falls back to an 'unknown-year' prefix.
      const loansList = await getSheetDataAsJSON(env, 'LOANS');
      const loanRow = loansList.find(l => l['Loan ID'] === rowObj.loan_id);
      const consentYear = loanRow ? loanRow.Year : '';
      photoUrl = await uploadConsentFile(env, photoBase64, `consent_${rowObj.consent_id}_photo.jpg`, consentYear);
      signatureUrl = await uploadConsentFile(env, signatureBase64, `consent_${rowObj.consent_id}_signature.jpg`, consentYear);
    } catch (err) {
      // The original Drive error text used to be wrapped away and only reached
      // the log if the caller happened to be the mgmt React app — but this is a
      // PUBLIC page, so persist it here.
      await logErrorAt(env, 'backend-loans', 'respondConsent:driveUpload', err, {
        consentId: rowObj.consent_id, personId: rowObj.person_id, role: rowObj.role,
      });
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

// Builds the notification placeholder set. The old code built a much SMALLER
// object here than createLoanConsents' baseData while reusing the same
// operator-authored templates, which is one of the two reasons real recipients
// received literal {Guarantor1} / {Village} / {FatherName} text.
function notificationData(loan, loanerU, person, role, guarantorUsers) {
  const gu = guarantorUsers || [];
  return {
    Name: person.Name || '', NameHindi: person['Name (Hindi)'] || '',
    FatherName: person["Father's Name"] || '', FatherNameHindi: person["Father's Name (Hindi)"] || '',
    Village: person.Village || '', VillageHindi: person['Village (Hindi)'] || '',
    Role: role === 'loaner' ? 'Loaner' : 'Guarantor',
    LoanerName: loanerU.Name || loan.Name || '', LoanerNameHindi: loanerU['Name (Hindi)'] || '',
    Amount: parseAmt(loan.Amount), Tenure: loan.Tenure || '',
    InterestRate: loan['Intrest Rate'] || loan['Interest Rate'] || '0',
    Year: loan.Year || '',
    Guarantor1: (gu[0] && gu[0].Name) || '', Guarantor2: (gu[1] && gu[1].Name) || '', Guarantor3: (gu[2] && gu[2].Name) || '',
  };
}

// Loads the guarantor USERS rows for a loan so notificationData() can fill
// {Guarantor1..3} — templates assume these exist.
async function guarantorUsersFor(env, loanId, userMap) {
  const { results } = await env.DB_LOANS_EXPENSES.prepare(
    "SELECT person_id FROM loan_consents WHERE loan_id = ? AND role = 'guarantor' AND status != 'replaced' ORDER BY id ASC"
  ).bind(loanId).all().catch(() => ({ results: [] }));
  return (results || []).map(r => userMap[r.person_id] || {});
}

async function notifyConsentAccepted(env, loanId, personId, role) {
  return trySend(env, 'notifyConsentAccepted', async () => {
    const users = await getSheetDataAsJSON(env, 'USERS');
    const userMap = {};
    users.forEach(u => { userMap[u.ID] = u; });
    const loans = await getSheetDataAsJSON(env, 'LOANS');
    const loan = loans.find(l => l['Loan ID'] === loanId) || {};
    const loanerU = userMap[loan.Name] || {};
    const person = userMap[personId] || {};
    const guarantorUsers = await guarantorUsersFor(env, loanId, userMap);

    const data = notificationData(loan, loanerU, person, role, guarantorUsers);
    const tpls = await loanTemplateContext(env);

    const groupTpl = tpls.pick('consent_accepted_group');
    if (groupTpl) {
      const groups = (await getSheetDataAsJSON(env, 'WHATSAPP_GROUPS')).filter(g => isTruthyFlag(g.active));
      const message = await renderLoanTemplate(env, 'notifyConsentAccepted:group', groupTpl, data, { loanId, personId });
      for (const g of groups) {
        await queueGroupMessageDirect(env, g.groupid, message, tpls.sender, groupTpl.message_type, groupTpl.file_link);
      }
    }

    const loanerWa = waNumberOf(loanerU);
    const loanerTpl = tpls.pick('consent_accepted_loaner_personal');
    if (loanerWa && loanerTpl) {
      const message = await renderLoanTemplate(env, 'notifyConsentAccepted:loaner', loanerTpl, data, { loanId, personId });
      await queuePersonMessageDirect(env, loanerWa, message, tpls.sender, loanerTpl.message_type, loanerTpl.file_link);
    }

    if (role === 'guarantor') {
      const { results: guarantorConsents } = await env.DB_LOANS_EXPENSES.prepare(
        "SELECT status FROM loan_consents WHERE loan_id = ? AND role = 'guarantor' AND status != 'replaced'"
      ).bind(loanId).all();
      const allAccepted = guarantorConsents.length > 0 && guarantorConsents.every(c => c.status === 'accepted');
      if (allAccepted && loanerWa) {
        const readyTpl = tpls.pick('all_guarantors_accepted_loaner');
        if (readyTpl) {
          const message = await renderLoanTemplate(env, 'notifyConsentAccepted:allAccepted', readyTpl, data, { loanId });
          await queuePersonMessageDirect(env, loanerWa, message, tpls.sender, readyTpl.message_type, readyTpl.file_link);
        }
      }
    }
  }, { loanId, personId, role });
}

// ---- ADMIN (Superadmin/Admin) ----

export async function getLoanConsents(env, loanId, user) {
  // Was completely un-gated beyond having a valid session — it returns consent
  // tokens/photo URLs/geo data, so it needs at least a staff role.
  requireStaffRole(user);
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
  if (!result.meta.changes) throw ValidationError('Consent record nahi mila.');
  if (status === 'verified') await notifyConsentVerified(env, consentId);
  return { success: true };
}

async function notifyConsentVerified(env, consentId) {
  return trySend(env, 'notifyConsentVerified', async () => {
    const consent = await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM loan_consents WHERE consent_id = ?').bind(consentId).first();
    if (!consent) return;
    const users = await getSheetDataAsJSON(env, 'USERS');
    const userMap = {};
    users.forEach(u => { userMap[u.ID] = u; });
    const loans = await getSheetDataAsJSON(env, 'LOANS');
    const loan = loans.find(l => l['Loan ID'] === consent.loan_id) || {};
    const loanerU = userMap[loan.Name] || {};
    const person = userMap[consent.person_id] || {};
    const guarantorUsers = await guarantorUsersFor(env, consent.loan_id, userMap);

    const data = notificationData(loan, loanerU, person, consent.role, guarantorUsers);
    const tpls = await loanTemplateContext(env);

    const personWa = waNumberOf(person);
    const verifiedTpl = tpls.pick('consent_verified_personal');
    if (personWa && verifiedTpl) {
      const message = await renderLoanTemplate(env, 'notifyConsentVerified:person', verifiedTpl, data, { consentId });
      await queuePersonMessageDirect(env, personWa, message, tpls.sender, verifiedTpl.message_type, verifiedTpl.file_link);
    }

    const { results: allConsents } = await env.DB_LOANS_EXPENSES.prepare(
      "SELECT verification_status FROM loan_consents WHERE loan_id = ? AND status != 'replaced'"
    ).bind(consent.loan_id).all();
    const allVerified = allConsents.length > 0 && allConsents.every(c => c.verification_status === 'verified');
    if (allVerified) {
      const loanerWa = waNumberOf(loanerU);
      const passedTpl = tpls.pick('loan_passed_personal');
      if (loanerWa && passedTpl) {
        const message = await renderLoanTemplate(env, 'notifyConsentVerified:loanPassed', passedTpl, data, { consentId, loanId: consent.loan_id });
        await queuePersonMessageDirect(env, loanerWa, message, tpls.sender, passedTpl.message_type, passedTpl.file_link);
      }
    }
  }, { consentId });
}

export async function resendConsent(env, consentId, user) {
  requireSuperadmin(user);
  const rowObj = await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM loan_consents WHERE consent_id = ?').bind(consentId).first();
  if (!rowObj) throw ValidationError('Consent record nahi mila.');
  if (rowObj.status === 'accepted') throw new Error('Ye pehle hi accept ho chuka hai — resend ki zaroorat nahi.');
  const sendCount = parseInt(rowObj.send_count) || 0;
  if (sendCount >= 5) throw new Error('Is guarantor/loaner ko already 5 baar bheja ja chuka hai. Ab guarantor replace karein.');

  const newToken = generateConsentToken();
  await env.DB_LOANS_EXPENSES.prepare(
    "UPDATE loan_consents SET token = ?, status = 'pending', otp = '', otp_verified = 0, send_count = ?, responded_at = '' WHERE id = ?"
  ).bind(newToken, sendCount + 1, rowObj.id).run();

  const consentLink = consentLinkBuilder(env);
  const users = await getSheetDataAsJSON(env, 'USERS');
  const userMap = {};
  users.forEach(u => { userMap[u.ID] = u; });
  const person = userMap[rowObj.person_id] || {};
  const wa = waNumberOf(person);
  const loans = await getSheetDataAsJSON(env, 'LOANS');
  const loan = loans.find(l => l['Loan ID'] === rowObj.loan_id) || {};
  const loanerU = userMap[loan.Name] || {};
  const guarantorUsers = await guarantorUsersFor(env, rowObj.loan_id, userMap);
  const tplType = rowObj.role === 'loaner' ? 'consent_personal_loaner' : 'consent_personal_guarantor';
  const tpls = await loanTemplateContext(env);
  const tpl = tpls.pick(tplType);

  if (!tpl) throw new Error(`"${tplType}" ka koi active template nahi hai — pehle WhatsApp templates mein add karein.`);
  if (!wa) {
    await logWarn(env, 'whatsapp-loans', 'resendConsent',
      `Cannot resend consent ${consentId}: ${rowObj.person_id} has no valid WhatsApp/Mobile number.`,
      { consentId, personId: rowObj.person_id });
    throw new Error('Is person ka valid WhatsApp/Mobile number registered nahi hai — pehle USERS mein number theek karein.');
  }

  const data2 = Object.assign(notificationData(loan, loanerU, person, rowObj.role, guarantorUsers), {
    ConsentLink: consentLink(newToken),
    LoanerConsentLink: consentLink(newToken),
  });
  const message = await renderLoanTemplate(env, 'resendConsent', tpl, data2, { consentId });
  await queuePersonMessageDirect(env, wa, message, tpls.sender, tpl.message_type, tpl.file_link);
  return { success: true, sendCount: sendCount + 1 };
}

export async function replaceGuarantor(env, loanId, oldConsentId, newPersonId, user) {
  requireSuperadmin(user);
  const oldRow = await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM loan_consents WHERE consent_id = ?').bind(oldConsentId).first();
  if (!oldRow) throw ValidationError('Consent record nahi mila.');
  if (oldRow.role !== 'guarantor') throw new Error('Sirf guarantor replace kiya ja sakta hai.');
  if (oldRow.status === 'accepted') throw new Error('Ye guarantor pehle hi accept kar chuka hai — replace nahi kiya ja sakta.');

  const loans = await getSheetDataAsJSON(env, 'LOANS');
  const loan = loans.find(l => l['Loan ID'] === loanId);
  if (!loan) throw ValidationError('Loan nahi mila.');

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

  const consentLink = consentLinkBuilder(env);
  const users = await getSheetDataAsJSON(env, 'USERS');
  const userMap = {};
  users.forEach(u => { userMap[u.ID] = u; });
  const newPerson = userMap[newPersonId] || {};
  const loanerU = userMap[loan.Name] || {};
  const wa = waNumberOf(newPerson);
  const tpls = await loanTemplateContext(env);
  const tpl = tpls.pick('consent_personal_guarantor');

  // The guarantor swap itself has already been committed, so don't throw — but
  // do make the "no invitation was sent" case visible instead of silent.
  if (!wa || !tpl) {
    await logWarn(env, 'whatsapp-loans', 'replaceGuarantor',
      !tpl
        ? 'Guarantor replaced but no active "consent_personal_guarantor" template exists — the new guarantor got no consent link.'
        : `Guarantor replaced but ${newPersonId} has no valid WhatsApp/Mobile number — no consent link sent.`,
      { loanId, oldConsentId, newPersonId, newConsentId: consentId });
    return {
      success: true,
      consentId,
      warning: !tpl
        ? 'Guarantor replace ho gaya, lekin consent_personal_guarantor template active nahi hai — invitation nahi gaya.'
        : 'Guarantor replace ho gaya, lekin uska WhatsApp number valid nahi hai — invitation nahi gaya.',
    };
  }

  const guarantorUsers = await guarantorUsersFor(env, loanId, userMap);
  const tplData = Object.assign(notificationData(loan, loanerU, newPerson, 'guarantor', guarantorUsers), {
    ConsentLink: consentLink(token),
  });
  const message = await renderLoanTemplate(env, 'replaceGuarantor', tpl, tplData, { loanId, newConsentId: consentId });
  await queuePersonMessageDirect(env, wa, message, tpls.sender, tpl.message_type, tpl.file_link);
  return { success: true, consentId };
}

export async function markLoanDisbursed(env, loanId, cashAmount, onlineAmount, user) {
  requireSuperadmin(user);
  const cash = parseFloat(cashAmount) || 0;
  const online = parseFloat(onlineAmount) || 0;
  if (cash <= 0 && online <= 0) throw new Error('Cash ya Online, kam se kam ek amount daalein.');

  const loanRow = await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM loans WHERE loan_id = ?').bind(loanId).first();
  if (!loanRow) throw ValidationError('Loan nahi mila.');
  if (loanRow.loan_status !== 'Approved') throw new Error('Loan abhi Approved nahi hai — pehle sabhi consents accept hone chahiye.');

  await env.DB_LOANS_EXPENSES.prepare(
    "UPDATE loans SET loan_status = 'Disbursed', cash_amount = ?, online_amount = ? WHERE loan_id = ?"
  ).bind(cash, online, loanId).run();

  const notify = await trySend(env, 'markLoanDisbursed', async () => {
    const users = await getSheetDataAsJSON(env, 'USERS');
    const userMap = {};
    users.forEach(u => { userMap[u.ID] = u; });
    const loaner = userMap[loanRow.name] || {};
    const wa = waNumberOf(loaner);
    const tpls = await loanTemplateContext(env);
    const tpl = tpls.pick('disbursement');
    if (!tpl) {
      await logWarn(env, 'whatsapp-loans', 'markLoanDisbursed',
        'No active "disbursement" template — the loaner got no disbursement confirmation.', { loanId });
      return { skipped: 'no-template' };
    }
    if (!wa) {
      await logWarn(env, 'whatsapp-loans', 'markLoanDisbursed',
        `Loaner ${loanRow.name} has no valid WhatsApp/Mobile number — disbursement confirmation not sent.`, { loanId });
      return { skipped: 'no-number' };
    }
    const guarantorUsers = await guarantorUsersFor(env, loanId, userMap);
    const tplData = Object.assign(
      notificationData(
        { Name: loanRow.name, Amount: loanRow.amount, Tenure: loanRow.tenure, 'Intrest Rate': loanRow.intrest_rate, Year: loanRow.year },
        loaner, loaner, 'loaner', guarantorUsers
      ),
      { CashAmount: cash, OnlineAmount: online, TotalAmount: cash + online }
    );
    const message = await renderLoanTemplate(env, 'markLoanDisbursed', tpl, tplData, { loanId });
    await queuePersonMessageDirect(env, wa, message, tpls.sender, tpl.message_type, tpl.file_link);
    return { sent: true };
  }, { loanId });

  // The status change is committed either way, but the caller now learns that
  // the confirmation message did not go out (it used to be a silent console.error
  // followed by a flat {success:true}).
  return (notify && (notify.failed || notify.skipped))
    ? { success: true, messageWarning: 'Loan Disbursed mark ho gaya, lekin WhatsApp confirmation nahi bheja ja saka. Error Log dekhein.' }
    : { success: true };
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
