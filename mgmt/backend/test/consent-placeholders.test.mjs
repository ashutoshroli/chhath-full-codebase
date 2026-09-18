// ===== FEAT-002: the 4 new consent placeholder tokens =====
//
// The new loaner/guarantor consent templates reference tokens that the shared
// placeholder builder must emit from REAL loan_consents data:
//
//   LOAN_CONSENT_DATETIME / LOAN_STATUS   — loan-level, from the loaner consent
//   CONSENT_DATETIME      / CONSENT_STATUS — per-consent, from the target consent
//
// These are prove-first: each assertion below fails if the corresponding token
// is removed from consentPlaceholders.js. Test C additionally pins the invariant
// the module exists to protect — that buildConsentPlaceholders() and
// consentPlaceholderFactory() never drift on the per-consent values.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import {
  buildConsentPlaceholders,
  consentPlaceholderFactory,
  statusLabel,
} from '../src/consentPlaceholders.js';

// getFestivalDates reads DB_CORE.festival_dates and returns blanks when there is
// no row, so a plain schema-backed env resolves the festival tokens to '' — the
// 4 new tokens under test do not depend on festival data at all.
function baseEnv() {
  return {
    DB_CORE: makeD1(schemaFor('core.sql')),
    KV_SESSIONS: makeKV(),
  };
}

// Names are irrelevant to the tokens under test; a passthrough keeps fixtures small.
const nameOf = (id) => (id ? `Name(${id})` : '');

// A minimal LOANS row (header-keyed, as the builder consumes it).
const loan = {
  'Loan ID': 'LN1',
  Name: 'USER0002',
  Amount: 50000,
  'Intrest Rate': 2,
  Tenure: 12,
  'Final Repayment Date': '',
  Year: 2026,
};

const loanerConsent = {
  role: 'loaner',
  status: 'accepted',
  responded_at: '2026-10-20T10:00:00.000Z',
  created_at: '2026-10-01',
  consent_id: 'LCN1',
  person_id: 'USER0002',
  verification_status: 'verified',
};

const guarantorTarget = {
  role: 'guarantor',
  status: 'declined',
  created_at: '2026-10-01',
  responded_at: '2026-10-05T09:00:00.000Z',
  consent_id: 'GCN1',
  person_id: 'USER0003',
  decline_remarks: 'busy',
};

// ------------------------------------------------------------------ Test A

test('A: the 4 new tokens are wired to real loan_consents data', async () => {
  const env = baseEnv();
  const consents = [loanerConsent, guarantorTarget];
  const p = await buildConsentPlaceholders(env, loan, consents, guarantorTarget, nameOf);

  // Loan-level (from the loaner consent).
  assert.equal(p.LOAN_CONSENT_DATETIME, '2026-10-20T10:00:00.000Z');
  assert.equal(p.LOAN_STATUS, statusLabel('accepted', loanerConsent));
  assert.match(p.LOAN_STATUS, /Accepted/);
  assert.match(p.LOAN_STATUS, /Verified/);

  // Per-consent (from the target guarantor consent).
  assert.equal(p.CONSENT_DATETIME, '2026-10-05T09:00:00.000Z');
  assert.equal(p.CONSENT_STATUS, statusLabel('declined', guarantorTarget));
  assert.match(p.CONSENT_STATUS, /Declined/);
  assert.match(p.CONSENT_STATUS, /busy/);
});

// ------------------------------------------------------------------ Test B

test('B: CONSENT_DATETIME falls back to created_at until a decision is recorded', async () => {
  const env = baseEnv();
  const pendingTarget = {
    role: 'guarantor',
    status: 'pending',
    responded_at: '',
    created_at: '2026-09-01',
    consent_id: 'GCN2',
    person_id: 'USER0004',
  };
  const p = await buildConsentPlaceholders(env, loan, [loanerConsent, pendingTarget], pendingTarget, nameOf);

  assert.equal(p.CONSENT_DATETIME, '2026-09-01', 'responded_at is blank, so created_at is used');
  assert.match(p.CONSENT_STATUS, /Pending/);
});

// ------------------------------------------------------------------ Test C

test('C: the factory closure agrees with buildConsentPlaceholders (no drift)', async () => {
  const env = baseEnv();
  const consents = [loanerConsent, guarantorTarget];

  const direct = await buildConsentPlaceholders(env, loan, consents, guarantorTarget, nameOf);
  const factory = await consentPlaceholderFactory(env, loan, consents, nameOf);
  const viaFactory = factory(guarantorTarget);

  // Per-consent values must be identical between the two builders.
  assert.equal(viaFactory.CONSENT_DATETIME, direct.CONSENT_DATETIME);
  assert.equal(viaFactory.CONSENT_STATUS, direct.CONSENT_STATUS);

  // Loan-level values come from the shared base and must also match.
  assert.equal(viaFactory.LOAN_CONSENT_DATETIME, direct.LOAN_CONSENT_DATETIME);
  assert.equal(viaFactory.LOAN_STATUS, direct.LOAN_STATUS);

  // And the factory must vary per target: a different consent yields its own values.
  const other = factory(loanerConsent);
  assert.equal(other.CONSENT_DATETIME, '2026-10-20T10:00:00.000Z');
  assert.equal(other.CONSENT_STATUS, statusLabel('accepted', loanerConsent));
  assert.notEqual(other.CONSENT_STATUS, viaFactory.CONSENT_STATUS, 'per-consent status must differ per target');
});
