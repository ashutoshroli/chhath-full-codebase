// ============ A DECLINED OR REJECTED CONSENT TELLS SOMEBODY (C14) ============
//
// Reported by the committee from live use.
//
//     // respondConsent
//     if (decision === 'accepted') {
//       await recomputeLoanStatus(...);
//       await notifyConsentAccepted(...);
//     }
//     return { success: true, status: decision };      // declined: just returns
//
// `setConsentVerification` was the same shape — only `verified` notified.
//
// The consequence is not a missing nicety. **A loaner was never told his loan had stopped**,
// so he waited on a process that was already over. The committee got no message either. And
// the remarks the decliner is FORCED to write —
//
//     if (!declineRemarks?.trim()) throw ValidationError('Remarks are required in order to Decline.');
//
// — went nowhere a person sees, unless someone happened to open the Consent Review screen.
//
// Recipients, decided with the committee: THE LOANER AND THE GROUP. The raw remark goes to
// the group (their own channel, and what they need in order to decide); the loaner is told
// that it was declined and by whom. Both are template text, so either can be reworded.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MIGRATION = new URL('../../db/migration/2026-09-05/32-consent-decline-templates.sql', import.meta.url);

describe('the shipped templates', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  test('every template type the notifier picks is seeded', () => {
    // notifyConsentClosed builds its type as `consent_${outcome}_group` /
    // `consent_${outcome}_loaner_personal`, so these four names are a contract between the
    // migration and the code. A missing row means a silent no-op — the very failure being
    // fixed — because the notifier guards `if (groupTpl)`.
    for (const type of [
      'consent_declined_group',
      'consent_rejected_group',
      'consent_declined_loaner_personal',
      'consent_rejected_loaner_personal',
    ]) {
      assert.ok(sql.includes(`'${type}'`), `${type} must be seeded`);
    }
  });

  test('the email mirror is seeded for both outcomes', () => {
    const emailInserts = sql.split('INSERT INTO loan_email_templates').length - 1;
    assert.equal(emailInserts, 2, 'declined + rejected, so a loaner with no WhatsApp is still told');
  });

  test('the GROUP templates carry the remark and the LOANER templates do not', () => {
    // The judgement call, asserted rather than left to a reader of the SQL. A decline remark
    // can be blunt about the person it concerns; forwarding it to him verbatim should be a
    // deliberate edit, not a default.
    const blocks = sql.split('INSERT INTO');
    const groupBlocks = blocks.filter((b) => b.includes('_group'));
    const loanerBlocks = blocks.filter((b) => b.includes('_loaner_personal'));
    assert.equal(groupBlocks.length, 2);
    assert.equal(loanerBlocks.length, 4, '2 WhatsApp + 2 email');
    for (const b of groupBlocks) assert.match(b, /\{DeclineRemarks\}/, 'the group needs the reason');
    for (const b of loanerBlocks) {
      assert.ok(!b.includes('{DeclineRemarks}'), 'the loaner template ships without the raw remark');
    }
  });

  test('every INSERT is guarded, so a re-run cannot overwrite edited text', () => {
    // The committee is expected to reword these. A migration that re-seeded on every run
    // would quietly revert their wording.
    const inserts = sql.split('INSERT INTO').slice(1);
    assert.equal(inserts.length, 6);
    for (const b of inserts) {
      assert.match(b, /WHERE NOT EXISTS \(SELECT 1 FROM/, 'each INSERT must be guarded by NOT EXISTS');
    }
  });

  test('it drops and deletes nothing', () => {
    const code = sql.replace(/--.*$/gm, '');
    assert.ok(!/\bDROP\b/i.test(code));
    assert.ok(!/\bDELETE\b/i.test(code));
    assert.ok(!/\bUPDATE\b/i.test(code), 'and modifies no existing row');
  });

  test('it creates loan_email_templates if absent, so it is self-sufficient', () => {
    // That table is added by migration 16 and is NOT in the committed schema file, so an
    // INSERT into it would fail on a fresh apply.
    assert.match(sql, /CREATE TABLE IF NOT EXISTS loan_email_templates/);
  });

  test('the templates reference only placeholders the notifier supplies', () => {
    // notificationData's own comment records that real recipients once received literal
    // "{Guarantor1}" / "{Village}" text. Every placeholder used here must exist.
    const supplied = new Set([
      'Name', 'NameHindi', 'FatherName', 'FatherNameHindi', 'Village', 'VillageHindi',
      'Role', 'LoanerName', 'LoanerNameHindi', 'Amount', 'Tenure', 'InterestRate', 'Year',
      'Guarantor1', 'Guarantor2', 'Guarantor3', 'DeclineRemarks',
    ]);
    const used = [...sql.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    assert.ok(used.length > 0, 'sanity: the templates use placeholders');
    for (const u of new Set(used)) {
      assert.ok(supplied.has(u), `{${u}} is used but notificationData does not supply it`);
    }
  });
});

describe('both closing paths now notify', () => {
  const src = readFileSync(new URL('../src/loans.js', import.meta.url), 'utf8');

  test('respondConsent notifies on decline', () => {
    // The `else` that used to be absent entirely.
    assert.match(src, /await notifyConsentClosed\(env, 'declined'/);
    const respond = src.slice(src.indexOf('export async function respondConsent'));
    const upToReturn = respond.slice(0, respond.indexOf('return { success: true, status: decision }'));
    assert.match(upToReturn, /notifyConsentClosed/, 'before the function returns, not after');
  });

  test('the decliner’s remarks are what get passed', () => {
    assert.match(src, /declineRemarks: declineRemarks\.toString\(\)\.trim\(\)/);
  });

  test('setConsentVerification notifies on reject', () => {
    assert.match(src, /await notifyConsentClosed\(env, 'rejected'/);
    // It reads the loan and person off the consent row, because unlike respondConsent it is
    // given only a consentId.
    assert.match(src, /SELECT loan_id, person_id, role FROM loan_consents WHERE consent_id = \?/);
  });

  test('the notifier sends to the group AND the loaner, plus an email mirror', () => {
    const fn = src.slice(src.indexOf('async function notifyConsentClosed'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.match(body, /consent_\$\{outcome\}_group/);
    assert.match(body, /queueGroupMessageDirect/);
    assert.match(body, /consent_\$\{outcome\}_loaner_personal/);
    assert.match(body, /queuePersonMessageDirect/);
    assert.match(body, /queueLoanEmail/, 'so a loaner with an email but no WhatsApp is still told');
  });

  test('a failed notification cannot roll back the recorded decision', () => {
    // The decline is the user's; failing to announce it is ours. trySend swallows and logs.
    const fn = src.slice(src.indexOf('async function notifyConsentClosed'));
    assert.match(fn.slice(0, 200), /return trySend\(env, `notifyConsent_\$\{outcome\}`/);
  });

  test('DeclineRemarks is always supplied, so it can never render literally', () => {
    assert.match(src, /DeclineRemarks: \(extra\.declineRemarks \|\| ''\)\.toString\(\)\.trim\(\)/);
  });
});
