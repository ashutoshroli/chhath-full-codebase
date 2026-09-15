// ====== AUDIT P0-09 (UI half) — money and payment details ======
//
// The views checked `if (!form.Amount)` only, so -500, 1e21 and '12.3456' were
// all sent to the API. A negative EXPENSE inflates the yearly surplus, which is
// the figure the lending budget is derived from.
//
// These rules mirror mgmt/backend/src/validate.js (assertMoney / assertYear) —
// the backend stays the enforcement point; this is so the operator is told before
// a request goes out, with the same limits and the same wording.

import { describe, it, expect } from 'vitest';
import { checkMoney, checkYear, checkDonationDetails, MAX_MONEY } from './money';

describe('checkMoney (audit P0-09)', () => {
  it('accepts ordinary amounts and returns a number', () => {
    expect(checkMoney('1500')).toEqual({ ok: true, value: 1500, message: '' });
    expect(checkMoney('1500.50').value).toBe(1500.5);
    expect(checkMoney(' 1500 ').value).toBe(1500);
    expect(checkMoney(250).value).toBe(250);
  });

  it('refuses NEGATIVE amounts — the defect that inflated the surplus', () => {
    const r = checkMoney('-500');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/more than zero/i);
  });

  it('refuses zero', () => {
    expect(checkMoney('0').ok).toBe(false);
    expect(checkMoney('0.00').ok).toBe(false);
  });

  it('refuses more than two decimal places', () => {
    expect(checkMoney('12.3456').message).toMatch(/at most 2 decimal places/i);
    expect(checkMoney('12.34').ok).toBe(true);
  });

  it('refuses commas rather than stripping them (the backend stores the raw value)', () => {
    const r = checkMoney('1,200');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/without commas/i);
  });

  it('refuses non-numbers, exponents and absurd magnitudes', () => {
    for (const bad of ['abc', '1e5', 'Infinity', 'NaN', '12px', '--5']) {
      expect(checkMoney(bad).ok, `${bad} must be refused`).toBe(false);
    }
    expect(checkMoney(String(MAX_MONEY + 1)).message).toMatch(/too large/i);
  });

  it('treats a blank value as required by default, optional on request', () => {
    expect(checkMoney('').ok).toBe(false);
    expect(checkMoney('').message).toMatch(/required/i);
    expect(checkMoney('', 'Amount', { required: false })).toEqual({ ok: true, value: null, message: '' });
    expect(checkMoney(undefined, 'Amount', { required: false }).ok).toBe(true);
  });

  it('allows zero where zero is legitimate (interest rate, tenure)', () => {
    expect(checkMoney('0', 'Interest rate', { required: false, min: 0 }).value).toBe(0);
    expect(checkMoney('-1', 'Interest rate', { required: false, min: 0 }).message).toMatch(/cannot be negative/i);
  });

  it('names the field in every message', () => {
    expect(checkMoney('-1', 'Tenure', { min: 0 }).message).toMatch(/^Tenure/);
    expect(checkMoney('', 'Amount').message).toMatch(/^Amount/);
  });
});

describe('checkYear (audit P0-09)', () => {
  it('accepts a plausible festival year', () => {
    expect(checkYear('2026').value).toBe(2026);
  });
  it('refuses anything else', () => {
    for (const bad of ['', 'abc', '199', '20260', '1999', '2101', '2026.5']) {
      expect(checkYear(bad).ok, `${bad} must be refused`).toBe(false);
    }
  });
});

describe('checkDonationDetails (audit: payment details went live unvalidated)', () => {
  it('accepts a fully blank form (nothing published yet)', () => {
    expect(checkDonationDetails({})).toBe('');
  });

  it('accepts a UPI-only and a bank-only setup', () => {
    expect(checkDonationDetails({ upiId: 'samiti@okhdfcbank' })).toBe('');
    expect(checkDonationDetails({ accountNumber: '12345678901', ifsc: 'SBIN0001234' })).toBe('');
  });

  it('refuses a malformed UPI id', () => {
    expect(checkDonationDetails({ upiId: 'samiti' })).toMatch(/UPI ID/);
    expect(checkDonationDetails({ upiId: 'samiti@' })).toMatch(/UPI ID/);
  });

  it('refuses a malformed account number or IFSC', () => {
    expect(checkDonationDetails({ accountNumber: '12 34 56', ifsc: 'SBIN0001234' })).toMatch(/account number/i);
    expect(checkDonationDetails({ accountNumber: '12345678901', ifsc: 'SBI0001234' })).toMatch(/IFSC/);
  });

  it('refuses half-entered bank details, which nobody could transfer to', () => {
    expect(checkDonationDetails({ accountNumber: '12345678901' })).toMatch(/needs its IFSC/i);
    expect(checkDonationDetails({ ifsc: 'SBIN0001234' })).toMatch(/needs the account number/i);
  });

  it('refuses a WhatsApp number that is not 10 digits', () => {
    expect(checkDonationDetails({ whatsapp: '98765' })).toMatch(/10 digits/);
    expect(checkDonationDetails({ whatsapp: '+919876543210' })).toMatch(/10 digits/);
    expect(checkDonationDetails({ whatsapp: '9876543210' })).toBe('');
  });
});
