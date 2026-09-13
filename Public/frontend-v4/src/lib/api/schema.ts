/**
 * Zod schemas for the read-only Cloudflare Worker `portalData` payload.
 *
 * DESIGN: validation is intentionally SOFT. The backend is unchanged and may add
 * columns at any time (it ships an allowlist per table), and the public site must
 * NEVER crash a visitor over an unexpected/missing field. So every row schema
 * `.passthrough()`es unknown keys, treats each known field as optional, and the
 * top-level object `.catch()`es each array to `[]`. The exact header keys below
 * mirror what Public/frontend-v3/script.js reads field-for-field.
 *
 * A value is "usable" if at least one core array is present — the same liveness
 * check the existing frontend uses before rendering.
 */
import { z } from 'zod';

// A cell can arrive as string | number | null; normalize to a loose union.
const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]).optional();

// Every row keeps unknown columns (passthrough) so future backend fields survive.
const row = z.object({ __rowIndex: z.union([z.string(), z.number()]).optional() }).passthrough();

export const userRow = row.extend({
  ID: cell,
  Name: cell,
  'Name (Hindi)': cell,
  Village: cell,
  'Village (Hindi)': cell,
  Designation: cell,
  'Designation (Hindi)': cell,
  "Father's Name": cell,
  "Father's Name (Hindi)": cell,
  Mobile: cell
});

export const committeeRow = row.extend({
  ID: cell,
  Name: cell,
  Year: cell,
  'View Role': cell,
  'View Role (Hindi)': cell
});

export const collectionRow = row.extend({
  Year: cell,
  Amount: cell,
  ID: cell,
  Name: cell,
  Detail: cell,
  'Contribution Type': cell,
  'Certificate Or Receipt': cell,
  'Is Resell': cell
});

export const expenseRow = row.extend({
  Year: cell,
  Amount: cell,
  Discription: cell,
  'Discription (Hindi)': cell,
  Description: cell,
  Category: cell
});

export const loanRow = row.extend({
  Year: cell,
  Amount: cell,
  ID: cell,
  Name: cell,
  Receiver: cell,
  'Loan ID': cell,
  'Intrest Rate': cell,
  'Interest Rate': cell,
  Tenure: cell
});

export const guarantorRow = row.extend({
  Year: cell,
  Loaner: cell,
  ID: cell,
  Name: cell,
  Guarantor: cell,
  'Guarantor ID': cell,
  'Guarantor 1': cell,
  'Loan ID': cell
});

export const generatedFileRow = row.extend({
  doc_type: cell,
  year: cell,
  record_id: cell,
  public_link: cell
});

export const loanConsentRow = row.extend({
  loan_id: cell,
  role: cell,
  status: cell,
  person_id: cell,
  consent_id: cell
});

const arr = <T extends z.ZodTypeAny>(schema: T) => z.array(schema).catch([]);

export const portalDataSchema = z
  .object({
    users: arr(userRow),
    committee: arr(committeeRow),
    collections: arr(collectionRow),
    expenses: arr(expenseRow),
    loans: arr(loanRow),
    guarantors: arr(guarantorRow),
    generatedFiles: arr(generatedFileRow),
    loanConsents: arr(loanConsentRow),
    // Backend may flag a degraded (last-known-good) response.
    stale: z.boolean().optional(),
    staleReason: z.string().optional()
  })
  .passthrough();

export type PortalData = z.infer<typeof portalDataSchema>;
export type UserRow = z.infer<typeof userRow>;
export type CommitteeRow = z.infer<typeof committeeRow>;
export type CollectionRow = z.infer<typeof collectionRow>;
export type ExpenseRow = z.infer<typeof expenseRow>;
export type LoanRow = z.infer<typeof loanRow>;
export type GuarantorRow = z.infer<typeof guarantorRow>;
export type GeneratedFileRow = z.infer<typeof generatedFileRow>;
export type LoanConsentRow = z.infer<typeof loanConsentRow>;

/** Empty-but-valid payload used as a safe default before data loads. */
export const EMPTY_PORTAL_DATA: PortalData = {
  users: [],
  committee: [],
  collections: [],
  expenses: [],
  loans: [],
  guarantors: [],
  generatedFiles: [],
  loanConsents: []
};

/** True when a parsed payload has at least one core array populated. */
export function isUsable(data: PortalData | null | undefined): boolean {
  if (!data) return false;
  return (
    (data.collections?.length ?? 0) > 0 ||
    (data.committee?.length ?? 0) > 0 ||
    (data.loans?.length ?? 0) > 0 ||
    (data.expenses?.length ?? 0) > 0 ||
    (data.users?.length ?? 0) > 0
  );
}

/**
 * Parse an unknown API response into a PortalData. Because arrays `.catch([])`
 * and rows passthrough, this never throws on shape drift; it returns a valid
 * (possibly empty) object. Returns null only when the input isn't an object.
 */
export function parsePortalData(input: unknown): PortalData | null {
  if (!input || typeof input !== 'object') return null;
  const res = portalDataSchema.safeParse(input);
  return res.success ? res.data : null;
}

// Active popups (optional feature) — kept permissive.
export const popupSlideSchema = z
  .object({
    slide_id: cell,
    slide_order: z.union([z.string(), z.number()]).optional(),
    image_url: cell,
    text: cell,
    link_url: cell,
    link_text: cell,
    duration_ms: z.union([z.string(), z.number()]).optional()
  })
  .passthrough();

export const popupSchema = z
  .object({
    popup_id: cell,
    title: cell,
    slides: z.array(popupSlideSchema).catch([])
  })
  .passthrough();

export const activePopupsSchema = z.array(popupSchema).catch([]);
export type Popup = z.infer<typeof popupSchema>;
