/**
 * What the portal is entitled to SAY about a scanned record (audit P0-10).
 *
 * `verifyRecord()` only answers "is this id present in the data I happen to
 * hold?". The Verify screen used to turn that straight into one of two verdicts —
 * "Verified Record" or the red "Record Not Found" — so a genuine receipt was
 * declared invalid whenever the data was missing (API down on a first visit) or
 * out of date (a stale local snapshot). The record verification QR is the
 * portal's central trust journey, so a false negative there is the worst kind of
 * bug it can have.
 *
 * This is the decision, kept pure so it can be tested exhaustively:
 *
 *   checking      still loading, or not started yet (the prerendered shell)
 *   no-id         opened without ?record=
 *   malformed     the id is not even `docType-year-ref` (safe to say with no data)
 *   unavailable   we hold NO records, so no check is possible at all
 *   verified      found — a hit in a stale snapshot is still a real hit
 *   inconclusive  not found, but only a possibly-out-of-date copy was searched
 *   not-found     not found in live records — the only authoritative negative
 */
export type VerifyVerdict =
  | 'checking'
  | 'no-id'
  | 'malformed'
  | 'unavailable'
  | 'verified'
  | 'inconclusive'
  | 'not-found';

export interface VerifyVerdictInput {
  /** The raw ?record= value ('' when absent). */
  recordId: string;
  /** Outcome of verifyRecord(), or null when there is no id to check. */
  result: { verified: boolean; malformed: boolean } | null;
  /** portalState.status */
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** portalState.failed — cold failure, no snapshot and no rows. */
  failed: boolean;
  /** portalState.stale — the data came from a saved copy, not the network. */
  stale: boolean;
}

export function verifyVerdict({ recordId, result, status, failed, stale }: VerifyVerdictInput): VerifyVerdict {
  if (!recordId) return 'no-id';
  // 'idle' matters: the prerendered shell renders before the client load starts,
  // and treating that as "ready" is how an empty payload became "not found".
  if (status === 'loading' || status === 'idle') return 'checking';
  // A wrong-shaped id needs no records to judge, so say so precisely instead of
  // implying the committee has no such document.
  if (result?.malformed) return 'malformed';
  // `status === 'error'` is included deliberately, not just `failed`: today the
  // store sets both together, but if a future load path reports an error without
  // that flag we must still refuse to assert a negative.
  if (failed || status === 'error') return 'unavailable';
  if (result?.verified) return 'verified';
  return stale ? 'inconclusive' : 'not-found';
}

/** True when the verdict is a negative the data does NOT entitle us to assert. */
export function isProvisional(verdict: VerifyVerdict): boolean {
  return verdict === 'unavailable' || verdict === 'inconclusive';
}
