/**
 * Client-side money / payment-detail checks (audit P0-09, UI half).
 *
 * The backend is the enforcement point (see mgmt/backend/src/validate.js —
 * assertMoney / assertYear), and these rules deliberately MIRROR it so the
 * operator is told what is wrong before a request is sent, with the same limits.
 * Nothing here is a security control: a request that skips the UI is still
 * rejected by the Worker.
 *
 * The views used to check `if (!form.Amount)` only, so `-500`, `1e21` and
 * `'12.3456'` all reached the API. A negative expense inflates the yearly
 * surplus, which is what the lending budget is computed from.
 */

export const MIN_MONEY = 0.01;
export const MAX_MONEY = 100000000; // ₹10 crore — matches the backend cap

export interface Checked {
  ok: boolean;
  /** The parsed number when ok, otherwise null. */
  value: number | null;
  /** Operator-facing message when not ok, otherwise ''. */
  message: string;
}

const ok = (value: number | null): Checked => ({ ok: true, value, message: '' });
const bad = (message: string): Checked => ({ ok: false, value: null, message });

/**
 * An amount of rupees: a plain number, greater than zero by default, at most two
 * decimal places, within the portal's cap. Commas are refused rather than
 * stripped — the backend stores the raw value, so `'1,200'` would land as NaN.
 */
export function checkMoney(
  raw: unknown,
  label = 'Amount',
  { required = true, min = MIN_MONEY }: { required?: boolean; min?: number } = {}
): Checked {
  const s = raw === undefined || raw === null ? '' : raw.toString().trim();
  if (s === '') return required ? bad(`${label} is required.`) : ok(null);
  if (s.includes(',')) return bad(`${label} must be a plain number without commas, e.g. 1500 or 1500.50.`);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return bad(`${label} must be a number of rupees, e.g. 1500 or 1500.50.`);

  const n = Number(s);
  if (!Number.isFinite(n)) return bad(`${label} must be a number of rupees.`);
  const decimals = s.includes('.') ? s.split('.')[1].length : 0;
  if (decimals > 2) return bad(`${label} may have at most 2 decimal places.`);
  if (n < min) {
    return bad(min > 0 ? `${label} must be more than zero.` : `${label} cannot be negative.`);
  }
  if (n > MAX_MONEY) return bad(`${label} looks too large — please check it.`);
  return ok(n);
}

/** A festival year: 4 digits inside the range the backend accepts. */
export function checkYear(raw: unknown, label = 'Year', { required = true } = {}): Checked {
  const s = raw === undefined || raw === null ? '' : raw.toString().trim();
  if (s === '') return required ? bad(`${label} is required.`) : ok(null);
  if (!/^\d{4}$/.test(s)) return bad(`${label} must be a 4-digit year.`);
  const n = parseInt(s, 10);
  if (n < 2000 || n > 2100) return bad(`${label} must be between 2000 and 2100.`);
  return ok(n);
}

// ---------------------------------------------------------------------------
// Donation payment details (audit: donation settings were published field by
// field with no validation, so a typo in an account number or UPI id could reach
// the public Donate page and send money to the wrong place).
// ---------------------------------------------------------------------------

const UPI_RE = /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9.\-]{1,32}$/;
const IFSC_RE = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/;
const ACCOUNT_RE = /^\d{6,20}$/;
const TEN_DIGITS = /^\d{10}$/;

export interface DonationDetails {
  upiId?: string;
  accountNumber?: string;
  ifsc?: string;
  whatsapp?: string;
  bankAccountName?: string;
  bankName?: string;
}

/**
 * Returns '' when every supplied field looks usable, otherwise the first
 * problem. Blank fields are allowed — a committee may publish only UPI, or only
 * bank details — but a field that IS filled in must be plausible.
 */
export function checkDonationDetails(f: DonationDetails): string {
  const upi = (f.upiId || '').trim();
  if (upi && !UPI_RE.test(upi)) {
    return 'The UPI ID does not look right — it should look like name@bank.';
  }
  const account = (f.accountNumber || '').trim();
  if (account && !ACCOUNT_RE.test(account)) {
    return 'The account number must be 6–20 digits, with no spaces or dashes.';
  }
  const ifsc = (f.ifsc || '').trim();
  if (ifsc && !IFSC_RE.test(ifsc)) {
    return 'The IFSC code does not look right — it should look like SBIN0001234.';
  }
  const whatsapp = (f.whatsapp || '').trim();
  if (whatsapp && !TEN_DIGITS.test(whatsapp)) {
    return 'The WhatsApp number must be exactly 10 digits.';
  }
  // Bank details only make sense together: an account number with no IFSC (or the
  // reverse) publishes a transfer nobody can complete.
  if (account && !ifsc) return 'An account number needs its IFSC code as well.';
  if (ifsc && !account) return 'An IFSC code needs the account number as well.';
  return '';
}
