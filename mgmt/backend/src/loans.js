import { getSheetDataAsJSON, saveRecord } from './crud.js';
import { requireRole, requireYearUnlocked, requireYearAccess, requireSuperadmin, requireAdminOrAbove, requireStaffRole, ValidationError, timingSafeEqualHex, InternalError } from './auth.js';
import { toColumnPayload } from './tableRegistry.js';
import { otpConsentSenderNumber } from './settings.js';
import { getConsentPageTemplate } from './settings.js';
import { pickRandomActive, renderTemplateChecked, queuePersonMessageDirect, queueGroupMessageDirect, isTruthyFlag as waTruthyFlag, MAX_GROUPS_PER_JOB } from './whatsapp.js';
import { queueLoanEmail, loanEmailTemplateContext } from './email.js';
import { uploadFileToDrive } from './account.js';
import { r2Available, putToR2, keyForYear } from './r2.js';
import { base64ToBytes, MAX_CONSENT_IMAGE_BYTES } from './base64.js';
import { logErrorAt, logWarn } from './logger.js';
import { waNumberOf, looksLikeAttemptedNumber } from './phone.js';
import { buildConsentPlaceholders } from './consentPlaceholders.js';
import { usersByIdCodes, userByIdCode, loanByLoanId, loansByLoanIds } from './lookups.js';
import { randomId, randomToken, randomOtp } from './random.js';
import { parseAmt } from './money.js'; // audit L-13: shared, was duplicated here

// SECURITY (audit C-4): all four of these were built from Math.random(), which is
// not a CSPRNG — see random.js for why that made the consent OTP predictable.
const generateLoanId = () => randomId('LN');
const generateConsentId = () => randomId('CN');
const generateConsentToken = () => randomToken();
const generateOtp = () => randomOtp();
const isTruthyFlag = waTruthyFlag;

// Uploads a consent photo/signature. Prefers R2 (year-wise key), falls back to
// Google Drive when R2 isn't configured — so this keeps working before the
// bucket exists. `year` groups the object so the Superadmin "Move <year> to
// Drive" feature can find it later; returns the public URL to store.
async function uploadConsentFile(env, base64, fileName, year) {
  // audit H-6: respondConsent is PUBLIC and unauthenticated, so an uncapped decode
  // here is a one-request denial of service against a 128 MB isolate. Decode ONCE,
  // before the storage branch, so the cap applies on the Drive fallback path too
  // (that branch re-encodes through uploadFileToDrive, whose own generic 8 MB limit
  // is looser than the consent-specific one).
  const bytes = base64ToBytes(base64, { label: fileName || 'File', maxBytes: MAX_CONSENT_IMAGE_BYTES });

  if (r2Available(env)) {
    const key = keyForYear(year, 'consent', fileName);
    return putToR2(env, key, bytes, 'image/jpeg');
  }
  // Drive fallback. SECURITY (audit S6): consent photos/signatures are sensitive
  // personal data, so they are uploaded PRIVATE (makePublic:false) rather than
  // world-readable. The preferred storage path is R2 above; the R2 custom-domain
  // bucket should itself be access-controlled. When Drive is used as a fallback,
  // the returned link is not anonymously viewable — the mgmt UI must fetch such
  // media through an authenticated proxy. Prefer configuring R2 in production.
  const uploaded = await uploadFileToDrive(env, base64, fileName, 'image/jpeg', { makePublic: false });
  return uploaded.directUrl;
}

// OTP hardening: previously an OTP never expired and verifyConsentOtp() had NO
// attempt limit at all — unlimited guesses against a 6-digit code.
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_VERIFY_ATTEMPTS = 5;
const OTP_MAX_REQUESTS_PER_HOUR = 5;
// Audit 1.4: a consent is a legal document (geo + photo + signature). After the
// OTP is verified, the actual Accept/Decline must happen within this window,
// otherwise the person must re-verify with a fresh OTP. Without this, a
// once-verified token could be used to respond arbitrarily long afterwards.
const OTP_RESPOND_WINDOW_MS = 20 * 60 * 1000;

// CONSENT_BASE_URL used to fall back to '' (`env.CONSENT_BASE_URL || ''`), so a
// misconfigured Worker silently sent every consent invitation with a dead
// relative link like "/consent/<token>" — recorded as `sent`, impossible to open.
// wrangler.toml still ships the literal placeholder domain, so check for that too.
function consentLinkBuilder(env) {
  const base = (env.CONSENT_BASE_URL || '').toString().trim().replace(/\/+$/, '');
  const isPlaceholder = !base || /YOUR-FRONTEND-DOMAIN|example\.com/i.test(base);
  if (isPlaceholder) {
    throw InternalError(
      'CONSENT_BASE_URL is not configured on the server (it is still the placeholder value). ' +
      'The consent link cannot be sent — set the real frontend domain in wrangler.toml / Worker vars.',
      'Consent links are not configured on the server, so no invitation was sent. ' +
      'Please ask the Superadmin to set the portal address before sending consents.'
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
  if (!loanPayload.Name || !loanPayload.Amount) throw ValidationError('Missing required field: Name/Amount');
  if (!guarantorPayloads || guarantorPayloads.length !== 3) throw ValidationError('Exactly 3 guarantors required');

  const ids = [loanPayload.Name, ...guarantorPayloads.map(g => g.Guarantor)];
  if (new Set(ids).size !== ids.length) throw ValidationError('Receiver and Guarantors must all be different');

  const committee = (await getSheetDataAsJSON(env, 'COMMITEE MEMBERS')).map(c => c.Name);
  guarantorPayloads.forEach(g => {
    if (committee.includes(g.Guarantor)) throw ValidationError('Rule Violation: A Committee Member cannot be a Guarantor');
  });

  loanPayload['Created By'] = user.name;
  const loanId = generateLoanId();
  loanPayload['Loan ID'] = loanId;
  loanPayload['Loan Status'] = 'Created';

  // ---- audit H-8: the loan and its guarantors must land together ----
  //
  // This used to be an INSERT for the loan, awaited, and THEN a separate batch()
  // for the three guarantors:
  //
  //     await ...INSERT INTO loans...        <-- committed on its own
  //     await ...batch(guarStmts)            <-- separate transaction
  //
  // If the second await failed for any reason — a D1 blip, a bad guarantor
  // payload, the isolate being evicted — the loan row was already committed and
  // stayed behind with ZERO guarantors. That is not a recoverable state through
  // the UI: the Loans screen renders the loan, but every consent, the approval
  // rule ("all three guarantors must Accept") and the repayment gate read the
  // guarantor rows, so the loan can never be approved and can never be repaid.
  // The admin saw a plain success.
  //
  // One batch() is one implicit transaction in D1: all four rows land, or none do.
  const loanCols = toColumnPayload('loans', loanPayload);
  const loanKeys = Object.keys(loanCols);
  const loanStmt = env.DB_LOANS_EXPENSES.prepare(
    `INSERT INTO loans (${loanKeys.join(', ')}) VALUES (${loanKeys.map(() => '?').join(', ')})`
  ).bind(...loanKeys.map(k => loanCols[k]));

  const guarStmts = guarantorPayloads.map(gPayload => {
    gPayload['Created By'] = user.name;
    gPayload['Loan ID'] = loanId;
    const cols = toColumnPayload('loan_guarantors', gPayload);
    const keys = Object.keys(cols);
    return env.DB_LOANS_EXPENSES.prepare(
      `INSERT INTO loan_guarantors (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
    ).bind(...keys.map(k => cols[k]));
  });

  await env.DB_LOANS_EXPENSES.batch([loanStmt, ...guarStmts]);

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
        'The loan was saved, but there was a problem creating the consent records / WhatsApp invitations: ' +
        err.message + ' — use "Resend" on the Loan Consents screen.',
    };
  }

  const warnings = (consentResult && consentResult.warnings) || [];
  return warnings.length
    ? { success: true, loanId, consentWarning: 'The loan was saved, but: ' + warnings.join(' | ') }
    : { success: true, loanId };
}

// audit H-8. Four separate problems, all in one seven-line function:
//
//  1. THE CONSENTS WERE NEVER DELETED. loan_consents rows survived, and each one
//     holds a live `token` that was WhatsApped to the loaner and the three
//     guarantors. The consent page is PUBLIC and authenticates on that token
//     alone, so after a loan was deleted anyone still holding the link could
//     open it, request an OTP, and upload a photo + signature to Drive/R2
//     against a loan that no longer exists. Deleting the loan looked like it
//     revoked access; it did not.
//  2. THREE UNPROTECTED STATEMENTS. `DELETE loans` was awaited, then
//     `DELETE loan_guarantors` separately. A failure in between left the
//     guarantor rows behind with no loan — invisible, and they still counted
//     towards a member's guarantee load on their profile.
//  3. `loanerId.toString()` WAS UNGUARDED. On the legacy branch (no loan_id), a
//     null/absent loanerId threw a raw TypeError -> HTTP 500, generic message,
//     a row in error_log, and nothing deleted.
//  4. THE YEAR LOCK WAS CHECKED AGAINST THE CLIENT'S CLAIM. `requireYearUnlocked
//     (env, year)` used the year in the REQUEST, while `rowIndex` addressed the
//     row directly. A caller could send an unlocked year they have access to and
//     delete a loan belonging to a LOCKED year. This is the same IDOR that
//     crud.js deleteRecordByIdx was hardened against in audit 2.1; this path
//     was missed.
export async function deleteLoanTransaction(env, rowIndex, year, loanerId, user, loanId) {
  requireRole(user, 'delete');

  const idx = parseInt(rowIndex);
  if (!idx) throw ValidationError('Could not tell which loan to delete. Please reload the page and try again.');

  // (4) Resolve the row FIRST and enforce the locks against its STORED year.
  const stored = await env.DB_LOANS_EXPENSES
    .prepare('SELECT year, name, loan_id FROM loans WHERE id = ?').bind(idx).first();
  if (!stored) throw ValidationError('This loan has already been deleted.');

  await requireYearUnlocked(env, stored.year);
  await requireYearAccess(env, user, stored.year);
  // Also honour the year the caller claims, so a mismatch can never be used to
  // skip a check rather than add one.
  if (year && parseInt(year) !== parseInt(stored.year)) {
    await requireYearUnlocked(env, year);
    await requireYearAccess(env, user, year);
  }

  // Prefer the loan_id on the stored row over the client-supplied one.
  const key = (loanId || stored.loan_id || '').toString().trim();

  const statements = [
    env.DB_LOANS_EXPENSES.prepare('DELETE FROM loans WHERE id = ?').bind(idx),
  ];
  let removed = { guarantors: 0, consents: 0 };

  if (key) {
    // Count first, so the activity log can say what was removed. Both tables are
    // indexed on loan_id, so this is two cheap lookups, not a scan.
    const [g, c] = await Promise.all([
      env.DB_LOANS_EXPENSES.prepare('SELECT COUNT(*) AS n FROM loan_guarantors WHERE loan_id = ?').bind(key).first('n'),
      env.DB_LOANS_EXPENSES.prepare('SELECT COUNT(*) AS n FROM loan_consents WHERE loan_id = ?').bind(key).first('n'),
    ]);
    removed = { guarantors: Number(g) || 0, consents: Number(c) || 0 };

    statements.push(
      env.DB_LOANS_EXPENSES.prepare('DELETE FROM loan_guarantors WHERE loan_id = ?').bind(key),
      // (1) THE FIX THAT MATTERS: this revokes every outstanding consent link.
      env.DB_LOANS_EXPENSES.prepare('DELETE FROM loan_consents WHERE loan_id = ?').bind(key)
    );
  } else {
    // Legacy rows saved before `loan_id` existed. They can have no consents
    // (createLoanConsents always keys on a loan_id), so only guarantors apply.
    const loaner = (loanerId != null && loanerId !== '' ? loanerId : stored.name);
    const loanerKey = (loaner == null ? '' : loaner).toString().trim();
    // (3) A missing loaner used to become `null.toString()` — a raw TypeError.
    if (!loanerKey) {
      throw ValidationError(
        'This older loan has no Loan ID and no receiver name, so its guarantors cannot be '
        + 'matched. Delete the guarantor rows from the Loan Guarantor screen instead.'
      );
    }
    const y = parseInt(stored.year);
    const g = await env.DB_LOANS_EXPENSES
      .prepare('SELECT COUNT(*) AS n FROM loan_guarantors WHERE year = ? AND loaner = ?')
      .bind(y, loanerKey).first('n');
    removed = { guarantors: Number(g) || 0, consents: 0 };

    statements.push(
      env.DB_LOANS_EXPENSES.prepare('DELETE FROM loan_guarantors WHERE year = ? AND loaner = ?')
        .bind(y, loanerKey)
    );
  }

  // (2) One batch = one transaction: the loan, its guarantors and its consents
  // all go, or nothing does.
  await env.DB_LOANS_EXPENSES.batch(statements);

  return {
    success: true,
    loanId: key || null,
    removedGuarantors: removed.guarantors,
    removedConsents: removed.consents,
  };
}

// ---- Consent creation (called right after saveLoanTransaction) ----

async function createLoanConsents(env, loanId, loanPayload, guarantorPayloads, user) {
  // audit M-14: only the loaner and the three guarantors are needed — this used to
  // read every member row to look up four of them.
  const userMap = await usersByIdCodes(env, [loanPayload.Name, ...guarantorPayloads.map(g => g.Guarantor)]);

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
    let groups = (await getSheetDataAsJSON(env, 'WHATSAPP_GROUPS')).filter(g => isTruthyFlag(g.active));
    if (!groups.length) {
      warnings.push('there is no active WhatsApp group');
      await logWarn(env, 'whatsapp-loans', 'createLoanConsents:group',
        'No ACTIVE WhatsApp group configured — loan consent group announcement was not queued.', { loanId });
      return;
    }
    // free-plan: cap the per-invocation group fan-out (see MAX_GROUPS_PER_JOB in whatsapp.js).
    if (groups.length > MAX_GROUPS_PER_JOB) {
      await logWarn(env, 'whatsapp-loans', 'createLoanConsents:group',
        `${groups.length} active WhatsApp groups exceed the per-job cap of ${MAX_GROUPS_PER_JOB}; messaging only the first ${MAX_GROUPS_PER_JOB}.`, { loanId, activeGroups: groups.length, cap: MAX_GROUPS_PER_JOB });
      groups = groups.slice(0, MAX_GROUPS_PER_JOB);
    }
    for (const g of groups) {
      const tpl = tpls.pick('consent_group');
      if (!tpl) {
        warnings.push('the consent_group template is not active');
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
    const data = Object.assign({}, baseData, {
      Name: loanerU.Name || loanPayload.Name, NameHindi: loanerU['Name (Hindi)'] || '',
      FatherName: loanerU["Father's Name"] || '', FatherNameHindi: loanerU["Father's Name (Hindi)"] || '',
      Village: loanerU.Village || '', VillageHindi: loanerU['Village (Hindi)'] || '',
      ConsentLink: baseData.LoanerConsentLink,
    });
    // Email is an independent channel (its own template + address), attempted
    // regardless of the WhatsApp template/number below. Never throws.
    await queueLoanEmail(env, 'consent_personal_loaner', loanerU, data, { loanId, loanerId: loanPayload.Name });

    const tpl = tpls.pick('consent_personal_loaner');
    if (!tpl) {
      warnings.push('the consent_personal_loaner template is not active');
      await logWarn(env, 'whatsapp-loans', 'createLoanConsents:loaner',
        'No active "consent_personal_loaner" template — the loaner got no consent link.', { loanId, loanerId: loanPayload.Name });
      return;
    }
    if (!loanerWa) {
      warnings.push(`the loaner's WhatsApp number is invalid/missing`);
      await logWarn(env, 'whatsapp-loans', 'createLoanConsents:loaner',
        looksLikeAttemptedNumber(loanerU.WhatsApp || loanerU.Mobile)
          ? `Loaner ${loanPayload.Name} has an INVALID WhatsApp/Mobile number — consent link not sent.`
          : `Loaner ${loanPayload.Name} has no WhatsApp/Mobile number on file — consent link not sent.`,
        { loanId, loanerId: loanPayload.Name });
      return;
    }
    const message = await renderLoanTemplate(env, 'createLoanConsents:loaner', tpl, data, { loanId });
    await queuePersonMessageDirect(env, loanerWa, message, tpls.sender, tpl.message_type, tpl.file_link);
  }, { loanId, loanerId: loanPayload.Name });

  // Personal — each guarantor.
  await trySend(env, 'createLoanConsents:guarantors', async () => {
    const tpl0 = tpls.countFor('consent_personal_guarantor');
    if (!tpl0) {
      warnings.push('the consent_personal_guarantor template is not active');
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
      const data = Object.assign({}, baseData, {
        Name: gU.Name || c.personId, NameHindi: gU['Name (Hindi)'] || '',
        FatherName: gU["Father's Name"] || '', FatherNameHindi: gU["Father's Name (Hindi)"] || '',
        Village: gU.Village || '', VillageHindi: gU['Village (Hindi)'] || '',
        ConsentLink: consentLink(c.token),
      });
      // Email is an independent channel — attempt it even when the WhatsApp
      // number is missing/invalid (a guarantor may have an email but no WhatsApp).
      await queueLoanEmail(env, 'consent_personal_guarantor', gU, data, { loanId, consentId: c.consentId, personId: c.personId });
      if (!gWa) {
        warnings.push(`guarantor ${gU.Name || c.personId}'s WhatsApp number is invalid/missing`);
        await logWarn(env, 'whatsapp-loans', 'createLoanConsents:guarantors',
          looksLikeAttemptedNumber(gU.WhatsApp || gU.Mobile)
            ? `Guarantor ${gU.Name || c.personId} has an INVALID WhatsApp/Mobile number — consent link not sent.`
            : `Guarantor ${gU.Name || c.personId} has no WhatsApp/Mobile number on file — consent link not sent.`,
          { loanId, consentId: c.consentId, personId: c.personId });
        continue;
      }
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
  if (!rowObj) throw ValidationError('This link is not valid or has expired.');
  const loanId = rowObj.loan_id;

  // audit M-14: this is a PUBLIC endpoint. It used to scan the whole loans table AND
  // the whole users table on every consent-page open.
  const loan = await loanByLoanId(env, loanId);
  if (!loan) throw ValidationError('Loan record not found.');

  const { results: allConsentsRaw } = await env.DB_LOANS_EXPENSES.prepare("SELECT * FROM loan_consents WHERE loan_id = ? AND status != 'replaced'").bind(loanId).all();

  // Only the people actually named on this loan.
  const userMap = await usersByIdCodes(env, [loan.Name, ...allConsentsRaw.map(c => c.person_id)]);
  const nameOf = (id) => (userMap[id] && userMap[id].Name) || id;
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
  if (!env.KV_SESSIONS) {
    // Audit 4.3: without KV the OTP attempt cap + expiry can't be enforced (this
    // returning null resets the attempt counter). Surface it so a mis-wired
    // deployment is visible rather than silently unthrottling the 6-digit OTP.
    await logWarn(env, 'backend-loans', 'readOtpMeta',
      'KV_SESSIONS binding missing — OTP attempt/expiry limits are DISABLED (failing open).', { consentId });
    return null;
  }
  try {
    const raw = await env.KV_SESSIONS.get(otpMetaKey(consentId));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    await logWarn(env, 'backend-loans', 'readOtpMeta',
      'OTP meta read failed (failing open — attempt/expiry cap not enforced this call): ' + (e && e.message), { consentId });
    return null;
  }
}

async function writeOtpMeta(env, consentId, meta) {
  if (!env.KV_SESSIONS) return;
  try {
    // TTL must comfortably outlast BOTH the OTP validity and the verify->respond
    // window, otherwise the meta (which now also holds the verifyToken) could
    // expire mid-window and wrongly block a legitimate submit. Use the larger of
    // the two windows + a 5-min buffer.
    const ttlSeconds = Math.ceil(Math.max(OTP_TTL_MS, OTP_RESPOND_WINDOW_MS) / 1000) + 300;
    await env.KV_SESSIONS.put(otpMetaKey(consentId), JSON.stringify(meta), {
      expirationTtl: Math.max(60, ttlSeconds),
    });
  } catch (e) { /* KV unavailable — verification still works, just without TTL */ }
}

export async function requestConsentOtp(env, token) {
  const rowObj = await findConsentRowByToken(env, token);
  if (!rowObj) throw ValidationError('This link is not valid.');
  if (rowObj.status !== 'pending') throw ValidationError('Your response for this loan has already been recorded.');

  // audit M-14: one indexed lookup instead of a full users scan.
  const person = await userByIdCode(env, rowObj.person_id);
  const wa = waNumberOf(person || {});
  if (!wa) throw ValidationError('Your WhatsApp number is not registered in the portal. Please contact the Superadmin.');

  // requestConsentOtp is unauthenticated by design (the token IS the credential),
  // but previously anyone holding a link could enqueue UNLIMITED OTP messages to
  // that person's number — a spam/ban vector for the sending device.
  const prev = await readOtpMeta(env, rowObj.consent_id);
  const hourAgo = Date.now() - 3600000;
  const recentRequests = ((prev && prev.requests) || []).filter(t => t > hourAgo);
  if (recentRequests.length >= OTP_MAX_REQUESTS_PER_HOUR) {
    throw ValidationError(`An OTP can only be sent ${OTP_MAX_REQUESTS_PER_HOUR} times per hour. Please try again after a while.`);
  }

  const otp = generateOtp();
  const issuedAt = Date.now();
  // BUGFIX (Issue 2 — parallel OTP request invalidated an already-verified user):
  // issuing a fresh OTP must NOT revoke an existing verification. We only overwrite
  // the `otp` column (so the previous code can't be reused) and PRESERVE the prior
  // verification proof (verifiedAt + verifyToken) in KV, so a user who already
  // verified in their own browser keeps working even if a second tab / resend /
  // another visitor requests a new OTP. That other visitor still has no verifyToken
  // of their own, so THEY must verify to act (see respondConsent). verifyConsentOtp
  // mints a fresh verifyToken + verifiedAt when the new OTP is verified.
  await env.DB_LOANS_EXPENSES.prepare('UPDATE loan_consents SET otp = ? WHERE id = ?').bind(otp, rowObj.id).run();
  await writeOtpMeta(env, rowObj.consent_id, {
    issuedAt,
    attempts: 0,
    // Preserve an existing verification so a prior verified client keeps its
    // window + token; verifying the new OTP overwrites these with fresh values.
    verifiedAt: (prev && prev.verifiedAt) || undefined,
    verifyToken: (prev && prev.verifyToken) || undefined,
    requests: recentRequests.concat(issuedAt),
  });

  const tpls = await loanTemplateContext(env);
  const otpTpl = tpls.pick('otp');
  const message = otpTpl
    ? await renderLoanTemplate(env, 'requestConsentOtp', otpTpl, { OTP: otp, Name: person ? person.Name : '' }, { consentId: rowObj.consent_id })
    : `Your loan consent verification OTP is: ${otp}. It will expire in ${Math.round(OTP_TTL_MS / 60000)} minutes. Do not share it with anyone.`;

  // Email the OTP too (independent backup channel — if the WhatsApp number is
  // wrong, the OTP can still arrive by email). Additive and never throws, so it
  // cannot change the WhatsApp-failure behaviour below.
  await queueLoanEmail(env, 'otp', person || {}, { OTP: otp, Name: person ? person.Name : '' }, { consentId: rowObj.consent_id });

  const res = await queuePersonMessageDirect(env, wa, message, tpls.sender, otpTpl ? otpTpl.message_type : 'normal', otpTpl ? otpTpl.file_link : '');
  if (!res || !res.success) {
    await logWarn(env, 'whatsapp-loans', 'requestConsentOtp',
      `OTP message could NOT be queued for consent ${rowObj.consent_id} (number rejected).`,
      { consentId: rowObj.consent_id, personId: rowObj.person_id });
    throw ValidationError('The OTP could not be sent — your registered number is not valid. Please contact the Superadmin.');
  }
  return { success: true, expiresInMinutes: Math.round(OTP_TTL_MS / 60000) };
}

export async function verifyConsentOtp(env, token, otp) {
  const rowObj = await findConsentRowByToken(env, token);
  if (!rowObj) throw ValidationError('This link is not valid.');
  if (rowObj.status !== 'pending') throw ValidationError('Your response for this loan has already been recorded.');
  if (!rowObj.otp || rowObj.otp.toString().trim() === '') throw ValidationError('Please request an OTP first.');

  const meta = (await readOtpMeta(env, rowObj.consent_id)) || {};

  // Expiry: an OTP used to be valid forever.
  if (meta.issuedAt && Date.now() - meta.issuedAt > OTP_TTL_MS) {
    throw ValidationError('The OTP has expired. Please request a new OTP.');
  }

  // Attempt limit: there was NO limit at all — unlimited guesses against a
  // 6-digit code.
  const attempts = parseInt(meta.attempts) || 0;
  if (attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    await logWarn(env, 'backend-loans', 'verifyConsentOtp',
      `OTP verification locked for consent ${rowObj.consent_id} after ${attempts} wrong attempts.`,
      { consentId: rowObj.consent_id, personId: rowObj.person_id });
    throw ValidationError('The OTP was entered incorrectly too many times. Please request a new OTP.');
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
    throw ValidationError(`The OTP is incorrect.${left > 0 ? ` ${left} attempt(s) remaining.` : ' Please request a new OTP.'}`);
  }

  // SECURITY (audit C-3): actually BURN the code in the database, not just in KV.
  // The comment below has always said the OTP is burned, but only the KV meta was
  // rewritten — the `otp` column kept the live code until a new one was requested.
  // Combined with the old `SELECT *` list endpoints that returned it, that gave a
  // staff member a reusable credential. Clearing it here means a verified code
  // cannot be replayed even by someone who already holds it.
  await env.DB_LOANS_EXPENSES.prepare("UPDATE loan_consents SET otp_verified = 1, otp = '' WHERE id = ?").bind(rowObj.id).run();

  // SECURITY: bind this verification to WHOEVER just proved control of the OTP,
  // instead of leaving a permanent otp_verified=1 flag that ANY later visitor to
  // the link could ride on (that flag persists in the DB, so once one person
  // verified, a stranger who merely opened the link could Accept WITHOUT any OTP).
  // We mint a random verifyToken, hand it back to this client only, and require it
  // in respondConsent. A different browser/person has no such token, so they must
  // verify their own OTP. The token is stored in KV with the same 20-min window as
  // the verify->respond limit (audit 1.4).
  // SECURITY (audit C-4): this is a bearer credential — it is the ONLY thing that
  // authorizes respondConsent() — so it must come from a CSPRNG, not Math.random().
  const verifyToken = randomToken();
  const verifiedAt = Date.now();
  // Burn the OTP so the same code can't be reused, and record the verify token.
  await writeOtpMeta(env, rowObj.consent_id, Object.assign({}, meta, { attempts: 0, verifiedAt, verifyToken }));
  return { success: true, verifyToken };
}

export async function respondConsent(env, token, decision, deviceId, deviceInfo, clientIp, geoLat, geoLng, geoAccuracy, photoBase64, signatureBase64, declineRemarks, verifyToken) {
  if (decision !== 'accepted' && decision !== 'declined') throw ValidationError('Invalid decision');
  const rowObj = await findConsentRowByToken(env, token);
  if (!rowObj) throw ValidationError('This link is not valid.');
  if (rowObj.status !== 'pending') throw ValidationError('Your response for this loan has already been recorded — it is locked.');

  // SECURITY: the ONLY thing that authorizes a response is a valid, unexpired
  // verifyToken minted for THIS client when it verified the OTP (see
  // verifyConsentOtp). We deliberately do NOT accept the persistent
  // otp_verified=1 DB flag as proof — that flag stays set on the consent row, so
  // relying on it let ANY later visitor to the link Accept/Decline WITHOUT ever
  // entering an OTP. A stranger opening the link has no verifyToken, so they are
  // forced to verify their own OTP.
  const respondMeta = await readOtpMeta(env, rowObj.consent_id);
  const supplied = (verifyToken || '').toString();
  const stored = (respondMeta && respondMeta.verifyToken) || '';
  const tokenOk = !!stored && !!supplied && timingSafeEqualHex(
    Array.from(supplied).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    Array.from(stored).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  );
  if (!tokenOk) {
    throw ValidationError('Please verify with the WhatsApp OTP first.');
  }
  // Audit 1.4: enforce the verify->respond window against THIS verification.
  if (respondMeta.verifiedAt && Date.now() - respondMeta.verifiedAt > OTP_RESPOND_WINDOW_MS) {
    throw ValidationError('Your verification has expired. Please request and enter a new OTP, then submit your response.');
  }

  let photoUrl = '', signatureUrl = '';

  if (decision === 'accepted') {
    if (rowObj.role === 'loaner') {
      const { results: guarantorConsents } = await env.DB_LOANS_EXPENSES.prepare(
        "SELECT status FROM loan_consents WHERE loan_id = ? AND role = 'guarantor' AND status != 'replaced'"
      ).bind(rowObj.loan_id).all();
      const allAccepted = guarantorConsents.length > 0 && guarantorConsents.every(c => c.status === 'accepted');
      if (!allAccepted) throw ValidationError('Final Acceptance is not available yet — all three guarantors must Accept first.');
    }
    if (!geoLat || !geoLng) throw ValidationError('Location permission is required in order to Accept.');
    if (!photoBase64) throw ValidationError('Capturing a photo is required in order to Accept.');
    if (!signatureBase64) throw ValidationError('Uploading a signature is required in order to Accept.');
    try {
      // Derive the loan's year so the files land under the right R2 year prefix
      // (used by the Superadmin "Move <year> to Drive" feature). If the loan
      // can't be resolved, keyForYear() falls back to an 'unknown-year' prefix.
      // audit M-14: one indexed lookup instead of scanning every loan.
      const loanRow = await loanByLoanId(env, rowObj.loan_id);
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
      throw InternalError(
        'respondConsent: photo/signature upload failed: ' + (err && err.message || err),
        'Your photo and signature could not be uploaded, so nothing was recorded. '
        + 'Please check your connection and submit again.'
      );
    }
  } else {
    if (!declineRemarks || !declineRemarks.toString().trim()) throw ValidationError('Remarks are required in order to Decline.');
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

// The guarantor person ids for a loan, in order, so notificationData() can fill
// {Guarantor1..3} — templates assume these exist.
//
// audit M-14: this used to return USERS ROWS, which forced every caller to have
// already built a full userMap from a whole-table scan. Returning the IDS lets the
// caller fetch exactly the people it needs in ONE batched lookup instead.
async function guarantorPersonIds(env, loanId) {
  const { results } = await env.DB_LOANS_EXPENSES.prepare(
    "SELECT person_id FROM loan_consents WHERE loan_id = ? AND role = 'guarantor' AND status != 'replaced' ORDER BY id ASC"
  ).bind(loanId).all().catch(() => ({ results: [] }));
  return (results || []).map(r => (r.person_id == null ? '' : r.person_id.toString().trim()));
}

async function notifyConsentAccepted(env, loanId, personId, role) {
  return trySend(env, 'notifyConsentAccepted', async () => {
    // audit M-14: fetch the loan, then only the people it names.
    const loan = (await loanByLoanId(env, loanId)) || {};
    const guarantorIds = await guarantorPersonIds(env, loanId);
    const userMap = await usersByIdCodes(env, [loan.Name, personId, ...guarantorIds]);
    const loanerU = userMap[loan.Name] || {};
    const person = userMap[personId] || {};
    const guarantorUsers = guarantorIds.map(id => userMap[id] || {});

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
    // Email mirror to the loaner (independent template + channel).
    await queueLoanEmail(env, 'consent_accepted_loaner_personal', loanerU, data, { loanId, personId });

    if (role === 'guarantor') {
      const { results: guarantorConsents } = await env.DB_LOANS_EXPENSES.prepare(
        "SELECT status FROM loan_consents WHERE loan_id = ? AND role = 'guarantor' AND status != 'replaced'"
      ).bind(loanId).all();
      const allAccepted = guarantorConsents.length > 0 && guarantorConsents.every(c => c.status === 'accepted');
      if (allAccepted) {
        if (loanerWa) {
          const readyTpl = tpls.pick('all_guarantors_accepted_loaner');
          if (readyTpl) {
            const message = await renderLoanTemplate(env, 'notifyConsentAccepted:allAccepted', readyTpl, data, { loanId });
            await queuePersonMessageDirect(env, loanerWa, message, tpls.sender, readyTpl.message_type, readyTpl.file_link);
          }
        }
        // Email is independent of the WhatsApp number.
        await queueLoanEmail(env, 'all_guarantors_accepted_loaner', loanerU, data, { loanId });
      }
    }
  }, { loanId, personId, role });
}

// ---- ADMIN (Superadmin/Admin) ----

// ============ CONSENT COLUMN ALLOWLISTS (audit C-3) ============
//
// SECURITY: `token` and `otp` are CREDENTIALS, not data. Together they are
// sufficient to impersonate the consenting person end-to-end:
//     verifyConsentOtp(token, otp) -> mints a verifyToken for the caller
//     respondConsent(token, 'accepted', ..., verifyToken) -> records the consent
// so a staff member holding them could accept a loan guarantee on someone else's
// behalf, complete with a fabricated photo, signature and geolocation.
//
// Both list endpoints used `SELECT *`, which returned them. They are now projected
// explicitly, and `token`/`otp` appear in NEITHER list — there is no screen that
// needs them, and no legitimate reason for them to leave the Worker.
//
// The two lists are also scoped differently, because their audiences differ:
//   LIST   — the Loan Consents modal, reachable from the Loans tab by EVERY staff
//            role. It renders six fields (consent_id, personName, personNameHindi,
//            role, send_count, status), so it gets those and nothing more. The
//            geolocation, photo, signature, IP and device of a named private
//            person are not needed to show "2/3 guarantors accepted".
//   REVIEW — the Consent Review screen (Admin/Superadmin), which exists precisely
//            to inspect the photo/signature/geo before verifying. It gets the full
//            evidence set, still minus the credentials.
const CONSENT_LIST_COLS = `
  id, consent_id, loan_id, person_id, role, status, otp_verified, send_count,
  created_at, responded_at, verification_status`;

const CONSENT_REVIEW_COLS = `
  id, consent_id, loan_id, person_id, role, status, otp_verified, send_count,
  created_at, responded_at, device_id, ip_address, user_agent,
  geo_lat, geo_lng, geo_accuracy, photo_url, signature_url, decline_remarks,
  verification_status, verification_remarks, verified_by, verified_at`;

// A single loan has at most a handful of consents, but the review queue grows
// without bound — cap it so one request can never read the whole table.
const CONSENT_REVIEW_LIMIT = 500;

export async function getLoanConsents(env, loanId, user) {
  // Was completely un-gated beyond having a valid session. The Loans tab is
  // available to every staff role, so this stays staff-level — the fix is that it
  // no longer hands out credentials or third-party evidence (see CONSENT_LIST_COLS).
  requireStaffRole(user);
  const { results } = await env.DB_LOANS_EXPENSES
    .prepare(`SELECT ${CONSENT_LIST_COLS} FROM loan_consents WHERE loan_id = ?`)
    .bind(loanId).all();
  // audit M-14: only the people named on this loan's consents.
  const userMap = await usersByIdCodes(env, results.map(c => c.person_id));
  return results.map(c => Object.assign({}, c, {
    personName: (userMap[c.person_id] && userMap[c.person_id].Name) || c.person_id,
    personNameHindi: (userMap[c.person_id] && userMap[c.person_id]['Name (Hindi)']) || '',
  }));
}

export async function getConsentsForReview(env, user) {
  requireAdminOrAbove(user);
  // Explicit columns (never token/otp — see CONSENT_REVIEW_COLS) and a hard cap.
  // Ordering moved into SQL so the LIMIT keeps the NEWEST responses rather than an
  // arbitrary page (the JS sort below is now just a tie-break safety net).
  const { results } = await env.DB_LOANS_EXPENSES.prepare(
    `SELECT ${CONSENT_REVIEW_COLS} FROM loan_consents
      WHERE status IN ('accepted', 'declined')
      ORDER BY responded_at DESC LIMIT ?`
  ).bind(CONSENT_REVIEW_LIMIT).all();
  // audit M-14: two bounded IN (...) lookups scoped to the rows on THIS page,
  // instead of reading the whole users and loans tables.
  const loanMap = await loansByLoanIds(env, results.map(c => c.loan_id));
  const userMap = await usersByIdCodes(env, [
    ...results.map(c => c.person_id),
    ...Object.values(loanMap).map(l => l.Name),
  ]);

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
  if (status !== 'verified' && status !== 'rejected') throw ValidationError('Invalid verification status');
  const result = await env.DB_LOANS_EXPENSES.prepare(
    'UPDATE loan_consents SET verification_status = ?, verification_remarks = ?, verified_by = ?, verified_at = ? WHERE consent_id = ?'
  ).bind(status, remarks || '', user.name, new Date().toISOString(), consentId).run();
  if (!result.meta.changes) throw ValidationError('Consent record not found.');
  if (status === 'verified') await notifyConsentVerified(env, consentId);
  return { success: true };
}

async function notifyConsentVerified(env, consentId) {
  return trySend(env, 'notifyConsentVerified', async () => {
    const consent = await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM loan_consents WHERE consent_id = ?').bind(consentId).first();
    if (!consent) return;
    const loan = (await loanByLoanId(env, consent.loan_id)) || {};
    const guarantorIds = await guarantorPersonIds(env, consent.loan_id);
    const userMap = await usersByIdCodes(env, [loan.Name, consent.person_id, ...guarantorIds]);
    const loanerU = userMap[loan.Name] || {};
    const person = userMap[consent.person_id] || {};
    const guarantorUsers = guarantorIds.map(id => userMap[id] || {});

    const data = notificationData(loan, loanerU, person, consent.role, guarantorUsers);
    const tpls = await loanTemplateContext(env);

    const personWa = waNumberOf(person);
    const verifiedTpl = tpls.pick('consent_verified_personal');
    if (personWa && verifiedTpl) {
      const message = await renderLoanTemplate(env, 'notifyConsentVerified:person', verifiedTpl, data, { consentId });
      await queuePersonMessageDirect(env, personWa, message, tpls.sender, verifiedTpl.message_type, verifiedTpl.file_link);
    }
    await queueLoanEmail(env, 'consent_verified_personal', person, data, { consentId });

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
      await queueLoanEmail(env, 'loan_passed_personal', loanerU, data, { consentId, loanId: consent.loan_id });
    }
  }, { consentId });
}

export async function resendConsent(env, consentId, user) {
  requireSuperadmin(user);
  const rowObj = await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM loan_consents WHERE consent_id = ?').bind(consentId).first();
  if (!rowObj) throw ValidationError('Consent record not found.');
  if (rowObj.status === 'accepted') throw ValidationError('This has already been accepted — no resend is needed.');
  const sendCount = parseInt(rowObj.send_count) || 0;
  if (sendCount >= 5) throw ValidationError('This guarantor/loaner has already been sent the invitation 5 times. Please replace the guarantor now.');

  const newToken = generateConsentToken();
  await env.DB_LOANS_EXPENSES.prepare(
    "UPDATE loan_consents SET token = ?, status = 'pending', otp = '', otp_verified = 0, send_count = ?, responded_at = '' WHERE id = ?"
  ).bind(newToken, sendCount + 1, rowObj.id).run();

  const consentLink = consentLinkBuilder(env);
  const loan = (await loanByLoanId(env, rowObj.loan_id)) || {};
  const guarantorIds = await guarantorPersonIds(env, rowObj.loan_id);
  const userMap = await usersByIdCodes(env, [loan.Name, rowObj.person_id, ...guarantorIds]);
  const person = userMap[rowObj.person_id] || {};
  const wa = waNumberOf(person);
  const loanerU = userMap[loan.Name] || {};
  const guarantorUsers = guarantorIds.map(id => userMap[id] || {});
  const tplType = rowObj.role === 'loaner' ? 'consent_personal_loaner' : 'consent_personal_guarantor';
  const tpls = await loanTemplateContext(env);
  const tpl = tpls.pick(tplType);

  // Email mirror first (independent channel + its own template + address), so a
  // resend still reaches the person by email even if the WhatsApp template/number
  // is missing. queueLoanEmail never throws.
  const data2 = Object.assign(notificationData(loan, loanerU, person, rowObj.role, guarantorUsers), {
    ConsentLink: consentLink(newToken),
    LoanerConsentLink: consentLink(newToken),
  });
  await queueLoanEmail(env, tplType, person, data2, { consentId });

  if (!tpl) throw ValidationError(`There is no active "${tplType}" template — add one in the WhatsApp templates first.`);
  if (!wa) {
    await logWarn(env, 'whatsapp-loans', 'resendConsent',
      `Cannot resend consent ${consentId}: ${rowObj.person_id} has no valid WhatsApp/Mobile number.`,
      { consentId, personId: rowObj.person_id });
    throw ValidationError('This person does not have a valid WhatsApp/Mobile number registered — please correct the number in USERS first.');
  }

  const message = await renderLoanTemplate(env, 'resendConsent', tpl, data2, { consentId });
  await queuePersonMessageDirect(env, wa, message, tpls.sender, tpl.message_type, tpl.file_link);
  return { success: true, sendCount: sendCount + 1 };
}

export async function replaceGuarantor(env, loanId, oldConsentId, newPersonId, user) {
  requireSuperadmin(user);
  const oldRow = await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM loan_consents WHERE consent_id = ?').bind(oldConsentId).first();
  if (!oldRow) throw ValidationError('Consent record not found.');
  if (oldRow.role !== 'guarantor') throw ValidationError('Only a guarantor can be replaced.');
  if (oldRow.status === 'accepted') throw ValidationError('This guarantor has already accepted — they cannot be replaced.');

  const loan = await loanByLoanId(env, loanId);
  if (!loan) throw ValidationError('Loan not found.');

  const { results: activeRows } = await env.DB_LOANS_EXPENSES.prepare(
    "SELECT person_id FROM loan_consents WHERE loan_id = ? AND status != 'replaced' AND consent_id != ?"
  ).bind(loanId, oldConsentId).all();
  const activeParticipants = activeRows.map(c => c.person_id);
  if (activeParticipants.includes(newPersonId)) throw ValidationError('This person is already part of this loan.');
  const committee = (await getSheetDataAsJSON(env, 'COMMITEE MEMBERS')).map(c => c.Name);
  if (committee.includes(newPersonId)) throw ValidationError('Rule Violation: A Committee Member cannot become a guarantor.');

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
  const guarantorIdsAfter = await guarantorPersonIds(env, loanId);
  const userMap = await usersByIdCodes(env, [newPersonId, loan.Name, ...guarantorIdsAfter]);
  const newPerson = userMap[newPersonId] || {};
  const loanerU = userMap[loan.Name] || {};
  const wa = waNumberOf(newPerson);
  const tpls = await loanTemplateContext(env);
  const tpl = tpls.pick('consent_personal_guarantor');
  const guarantorUsersR = guarantorIdsAfter.map(id => userMap[id] || {});
  const tplData = Object.assign(notificationData(loan, loanerU, newPerson, 'guarantor', guarantorUsersR), {
    ConsentLink: consentLink(token),
  });

  // Email mirror (independent channel), attempted regardless of the WhatsApp
  // template/number below. Never throws.
  await queueLoanEmail(env, 'consent_personal_guarantor', newPerson, tplData, { loanId, newConsentId: consentId });

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
        ? 'The guarantor was replaced, but the consent_personal_guarantor template is not active — the invitation was not sent.'
        : 'The guarantor was replaced, but their WhatsApp number is not valid — the invitation was not sent.',
    };
  }

  const message = await renderLoanTemplate(env, 'replaceGuarantor', tpl, tplData, { loanId, newConsentId: consentId });
  await queuePersonMessageDirect(env, wa, message, tpls.sender, tpl.message_type, tpl.file_link);
  return { success: true, consentId };
}

export async function markLoanDisbursed(env, loanId, cashAmount, onlineAmount, user) {
  requireSuperadmin(user);
  const cash = parseFloat(cashAmount) || 0;
  const online = parseFloat(onlineAmount) || 0;
  if (cash <= 0 && online <= 0) throw ValidationError('Enter at least one amount, either Cash or Online.');

  const loanRow = await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM loans WHERE loan_id = ?').bind(loanId).first();
  if (!loanRow) throw ValidationError('Loan not found.');
  if (loanRow.loan_status !== 'Approved') throw ValidationError('The loan is not Approved yet — all consents must be accepted first.');

  await env.DB_LOANS_EXPENSES.prepare(
    "UPDATE loans SET loan_status = 'Disbursed', cash_amount = ?, online_amount = ? WHERE loan_id = ?"
  ).bind(cash, online, loanId).run();

  const notify = await trySend(env, 'markLoanDisbursed', async () => {
    const guarantorIds = await guarantorPersonIds(env, loanId);
    const userMap = await usersByIdCodes(env, [loanRow.name, ...guarantorIds]);
    const loaner = userMap[loanRow.name] || {};
    const wa = waNumberOf(loaner);
    const tpls = await loanTemplateContext(env);
    const tpl = tpls.pick('disbursement');
    const guarantorUsers = guarantorIds.map(id => userMap[id] || {});
    const tplData = Object.assign(
      notificationData(
        { Name: loanRow.name, Amount: loanRow.amount, Tenure: loanRow.tenure, 'Intrest Rate': loanRow.intrest_rate, Year: loanRow.year },
        loaner, loaner, 'loaner', guarantorUsers
      ),
      { CashAmount: cash, OnlineAmount: online, TotalAmount: cash + online }
    );
    // Email the disbursement confirmation too (independent channel). Never throws.
    await queueLoanEmail(env, 'disbursement', loaner, tplData, { loanId });
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
    const message = await renderLoanTemplate(env, 'markLoanDisbursed', tpl, tplData, { loanId });
    await queuePersonMessageDirect(env, wa, message, tpls.sender, tpl.message_type, tpl.file_link);
    return { sent: true };
  }, { loanId });

  // The status change is committed either way, but the caller now learns that
  // the confirmation message did not go out (it used to be a silent console.error
  // followed by a flat {success:true}).
  return (notify && (notify.failed || notify.skipped))
    ? { success: true, messageWarning: 'The loan was marked as Disbursed, but the WhatsApp confirmation could not be sent. Please check the Error Log.' }
    : { success: true };
}

// ---- Loan template CRUD (Superadmin) — same pattern as Person/Group templates ----

export async function getLoanTemplates(env, type) {
  const { results } = await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM loan_message_templates WHERE type = ?').bind(type).all();
  // BUGFIX: the WhatsApp Templates screen deletes/updates/toggles a loan template
  // by `r.__rowIndex` (the same field the person/group lists use), and the backend
  // delete/update run `WHERE id = ?`. Person/group templates get `__rowIndex`
  // because they are read through getSheetDataAsJSON -> fromColumnRow, which
  // aliases the `id` column to `__rowIndex`. This function returns the raw D1 rows
  // instead, so loan-template rows had no `__rowIndex` — every delete/update/toggle
  // failed with "rowIndex required". Alias `id` -> `__rowIndex` here to match, while
  // leaving all the raw columns (text, active, message_type, file_link) the screen
  // already reads untouched.
  return (results || []).map(r => ({ ...r, __rowIndex: r.id }));
}

export async function addLoanTemplate(env, type, text, messageType, fileLink, user) {
  requireSuperadmin(user);
  if (!text || !text.toString().trim()) throw ValidationError('Template text required');
  const id = randomId('LTPL');
  await env.DB_LOANS_EXPENSES.prepare(
    'INSERT INTO loan_message_templates (template_id, type, text, active, created_at, message_type, file_link) VALUES (?, ?, ?, 1, ?, ?, ?)'
  ).bind(id, type, text.toString().trim(), new Date().toISOString(), messageType || 'normal', fileLink || '').run();
  return { success: true, template_id: id };
}

export async function updateLoanTemplate(env, rowIndex, text, active, messageType, fileLink, user) {
  requireSuperadmin(user);
  if (!rowIndex) throw ValidationError('rowIndex required');
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
  if (!rowIndex) throw ValidationError('rowIndex required');
  await env.DB_LOANS_EXPENSES.prepare('DELETE FROM loan_message_templates WHERE id = ?').bind(rowIndex).run();
  return { success: true };
}
