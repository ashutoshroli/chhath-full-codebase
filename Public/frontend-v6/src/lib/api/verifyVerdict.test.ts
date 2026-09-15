// ====== AUDIT P0-10 — the portal must not call a genuine record invalid ======
//
// The Verify screen turned verifyRecord()'s single boolean into one of two
// verdicts: "Verified Record" or the red "Record Not Found". verifyRecord() only
// asks whether the id is in the data we HAPPEN to hold, and the screen ignored
// portalState.failed and portalState.stale entirely — so:
//
//   * first visit with the API down  -> empty data -> "Record Not Found"
//   * out-of-date local snapshot     -> newer receipt -> "Record Not Found"
//
// Both told a visitor holding a real receipt that the committee has no such
// document, on the one screen whose entire purpose is trust.

import { describe, it, expect } from 'vitest';
import { verifyVerdict, isProvisional, type VerifyVerdictInput } from './verifyVerdict';

const input = (over: Partial<VerifyVerdictInput> = {}): VerifyVerdictInput => ({
  recordId: 'receipt-2026-12',
  result: { verified: false, malformed: false },
  status: 'ready',
  failed: false,
  stale: false,
  ...over
});

describe('verifyVerdict (audit P0-10)', () => {
  it('says CHECKING while the data is loading', () => {
    expect(verifyVerdict(input({ status: 'loading' }))).toBe('checking');
  });

  it('says CHECKING before the load has even started (the prerendered shell)', () => {
    // This is the state the static page hydrates from. Treating it as "ready" is
    // how an empty payload produced a red verdict.
    expect(verifyVerdict(input({ status: 'idle' }))).toBe('checking');
  });

  it('says UNAVAILABLE when we hold no records at all — never "not found"', () => {
    const v = verifyVerdict(input({ status: 'error', failed: true }));
    expect(v).toBe('unavailable');
    expect(isProvisional(v)).toBe(true);
  });

  it('says UNAVAILABLE on an errored load even without the failed flag', () => {
    // Defence in depth: the store sets both together today, but an error must
    // never be allowed to produce an authoritative negative.
    expect(verifyVerdict(input({ status: 'error', failed: false }))).toBe('unavailable');
  });

  it('says INCONCLUSIVE when only a stale copy was searched', () => {
    const v = verifyVerdict(input({ stale: true }));
    expect(v).toBe('inconclusive');
    expect(isProvisional(v)).toBe(true);
  });

  it('says NOT-FOUND only when live records were searched and missed', () => {
    const v = verifyVerdict(input({ stale: false, failed: false, status: 'ready' }));
    expect(v).toBe('not-found');
    expect(isProvisional(v)).toBe(false);
  });

  it('says VERIFIED when the id is found', () => {
    expect(verifyVerdict(input({ result: { verified: true, malformed: false } }))).toBe('verified');
  });

  it('still says VERIFIED from a stale copy — a hit is a real hit', () => {
    expect(verifyVerdict(input({ result: { verified: true, malformed: false }, stale: true })))
      .toBe('verified');
  });

  it('says NO-ID when the page is opened without ?record=', () => {
    expect(verifyVerdict(input({ recordId: '' }))).toBe('no-id');
  });

  it('says MALFORMED for an id that is not docType-year-ref', () => {
    expect(verifyVerdict(input({ recordId: 'garbage', result: { verified: false, malformed: true } })))
      .toBe('malformed');
  });

  it('prefers MALFORMED over UNAVAILABLE — no records are needed to judge the shape', () => {
    expect(verifyVerdict(input({
      recordId: 'garbage',
      result: { verified: false, malformed: true },
      failed: true
    }))).toBe('malformed');
  });

  it('prefers CHECKING over everything else', () => {
    expect(verifyVerdict(input({ status: 'loading', failed: true, stale: true }))).toBe('checking');
  });

  it('never returns not-found when the data is not trustworthy', () => {
    // The exhaustive statement of the bug: across every untrustworthy data state,
    // a miss must not produce the authoritative negative.
    for (const status of ['idle', 'loading', 'ready', 'error'] as const) {
      for (const failed of [true, false]) {
        for (const stale of [true, false]) {
          const v = verifyVerdict(input({ status, failed, stale }));
          const trustworthy = status === 'ready' && !failed && !stale;
          if (!trustworthy) {
            expect(v, `status=${status} failed=${failed} stale=${stale}`).not.toBe('not-found');
          } else {
            expect(v).toBe('not-found');
          }
        }
      }
    }
  });

  it('a verified record is reported as verified in every data state that has data', () => {
    for (const stale of [true, false]) {
      expect(verifyVerdict(input({ result: { verified: true, malformed: false }, stale, status: 'ready' })))
        .toBe('verified');
    }
  });
});

describe('isProvisional', () => {
  it('marks exactly the two "we cannot say" verdicts', () => {
    expect(isProvisional('unavailable')).toBe(true);
    expect(isProvisional('inconclusive')).toBe(true);
    for (const v of ['checking', 'no-id', 'malformed', 'verified', 'not-found'] as const) {
      expect(isProvisional(v)).toBe(false);
    }
  });
});
