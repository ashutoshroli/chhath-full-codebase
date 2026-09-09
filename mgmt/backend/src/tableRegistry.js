// Auto-derived from the live xlsx export. Lookup is case-insensitive + trims
// whitespace, mirroring Code.js's findSheet() so `sheet` params from the
// frontend (which use mixed casing like 'COLLECTIONS', 'USERS', 'COMMITEE MEMBERS')
// resolve exactly as they did against the old Sheet tabs.
export const TABLE_REGISTRY = {
  'commitee members': { db: 'core', table: 'committee_members' },
  'custom_announcements': { db: 'misc', table: 'custom_announcements' },
  'announcement_links': { db: 'misc', table: 'announcement_links' },
  'login': { db: 'core', table: 'login_users' },
  'samaan_templates': { db: 'templates', table: 'samaan_templates' },
  'generated_files': { db: 'file_index', table: 'generated_files' },
  'popup_slides': { db: 'misc', table: 'popup_slides' },
  'popups': { db: 'misc', table: 'popups' },
  'docx_templates': { db: 'templates', table: 'docx_templates' },
  'doc_pdf_templates': { db: 'templates', table: 'doc_pdf_templates' },
  'certificate_templates': { db: 'templates', table: 'certificate_templates' },
  'portal_settings': { db: 'core', table: 'portal_settings' },
  'error_log': { db: 'logs', table: 'error_log' },
  'receipt_templates': { db: 'templates', table: 'receipt_templates' },
  'consent_page_templates': { db: 'templates', table: 'consent_page_templates' },
  'festival_dates': { db: 'core', table: 'festival_dates' },
  'pdf_templates': { db: 'templates', table: 'pdf_templates' },
  'loan_consents': { db: 'loans_expenses', table: 'loan_consents' },
  'loan_message_templates': { db: 'loans_expenses', table: 'loan_message_templates' },
  'loan_email_templates': { db: 'loans_expenses', table: 'loan_email_templates' },
  'dropdown_lists': { db: 'core', table: 'dropdown_lists' },
  'group_message_templates': { db: 'whatsapp_index', table: 'group_message_templates' },
  'whatsapp_groups': { db: 'whatsapp_index', table: 'whatsapp_groups' },
  'person_message_templates': { db: 'whatsapp_index', table: 'person_message_templates' },
  'group_messages': { db: 'whatsapp_index', table: 'group_messages' },
  'person_messages': { db: 'whatsapp_index', table: 'person_messages' },
  'email_message_templates': { db: 'whatsapp_index', table: 'email_message_templates' },
  'email_messages': { db: 'whatsapp_index', table: 'email_messages' },
  'manual years': { db: 'core', table: 'manual_years' },
  'activity log': { db: 'logs', table: 'activity_log' },
  'locked years': { db: 'core', table: 'locked_years' },
  'users': { db: 'core', table: 'users' },
  'collections': { db: 'collections', table: 'collections' },
  'expenses': { db: 'loans_expenses', table: 'expenses' },
  'loans': { db: 'loans_expenses', table: 'loans' },
  'loan guarantor': { db: 'loans_expenses', table: 'loan_guarantors' },
};

// Header (as used by the old frontend payloads, e.g. `payload['Intrest Rate']`)
// -> D1 column name. Only columns whose name actually changes are listed;
// anything not in a table's map is assumed to already be snake_case-safe
// (single lowercase word, e.g. Year -> year, Amount -> amount).
export const COLUMN_ALIASES = {
  committee_members: { 'Year': 'year', 'Name': 'name', 'Created By': 'created_by', 'View Role': 'view_role', 'View Role (Hindi)': 'view_role_hindi', 'WhatsApp': 'whatsapp' },
  users: { 'ID': 'id_code', 'Name': 'name', 'Village': 'village', "Father's Name": 'fathers_name', 'Mobile': 'mobile', 'Designation': 'designation', 'Created By': 'created_by', 'Email': 'email', 'WhatsApp': 'whatsapp', 'Name (Hindi)': 'name_hindi', "Father's Name (Hindi)": 'fathers_name_hindi', 'Designation (Hindi)': 'designation_hindi', 'Village (Hindi)': 'village_hindi' },
  collections: { 'Year': 'year', 'Sl. No.': 'sl_no', 'Name': 'name', 'Amount': 'amount', 'Created By': 'created_by', 'Payment Mode': 'payment_mode', 'Date': 'date', 'Contribution Type': 'contribution_type', 'Detail': 'detail', 'Certificate Or Receipt': 'certificate_or_receipt', 'UTR': 'utr', 'Is Resell': 'is_resell', 'Announced': 'announced', 'AnnouncedCount': 'announcedcount' },
  expenses: { 'Year': 'year', 'Discription': 'discription', 'Amount': 'amount', 'Created By': 'created_by', 'Category': 'category', 'Discription (Hindi)': 'discription_hindi' },
  loans: { 'Year': 'year', 'Name': 'name', 'Amount': 'amount', 'Intrest Rate': 'intrest_rate', 'Tenure': 'tenure', 'Signature': 'signature', 'Loan Documents': 'loan_documents', 'Created By': 'created_by', 'Status': 'status', 'Loan ID': 'loan_id', 'Loan Status': 'loan_status', 'Final Repayment Date': 'final_repayment_date', 'Cash Amount': 'cash_amount', 'Online Amount': 'online_amount' },
  loan_guarantors: { 'Year': 'year', 'Loaner': 'loaner', 'Guarantor': 'guarantor', 'Guarantor Signature': 'guarantor_signature', 'Created By': 'created_by', 'Loan ID': 'loan_id' },
  custom_announcements: { 'ID': 'id_code', 'Year': 'year', 'TextHindi': 'texthindi', 'TextEnglish': 'textenglish', 'Priority': 'priority', 'Announced': 'announced', 'AnnouncedCount': 'announcedcount', 'CreatedAt': 'createdat', 'Order': 'order' },
  login_users: { 'Name': 'name', 'Role': 'role', 'Mobile': 'mobile', 'Email': 'email', 'Updated At': 'updated_at' },
  manual_years: { 'Year': 'year' },
  festival_dates: { 'Year': 'year', 'Diwali Next Day Date': 'diwali_next_day_date', 'Nahay-Khay Date': 'nahay_khay_date', 'Chhath Morning Arghya Date': 'chhath_morning_arghya_date' },
};

export function resolveSheet(sheetName) {
  const key = (sheetName || '').toString().trim().toLowerCase();
  const entry = TABLE_REGISTRY[key];
  if (!entry) throw Object.assign(new Error('Unknown sheet: ' + sheetName), { authError: false });
  return entry;
}

// Turns a frontend payload keyed by original header names (e.g. 'Intrest Rate')
// into one keyed by the real D1 column names (e.g. 'intrest_rate'), so views
// never had to be renamed.
// Normalizes a header for tolerant alias lookup: trims, collapses inner runs of
// whitespace, and folds the curly apostrophe (U+2019) onto the ASCII one.
//
// The original sheet headers carried TRAILING SPACES — the public Worker's own
// reverse map still records them as "Father's Name " and "Mobile " — so a payload
// key that made a round trip through any of those could miss the alias by exactly
// one space and get silently sanitized into a column that does not exist.
function normalizeHeader(k) {
  return k.toString().replace(/\u2019/g, "'").trim().replace(/\s+/g, ' ');
}

function buildNormalizedAliases(table) {
  const aliases = COLUMN_ALIASES[table] || {};
  const map = {};
  for (const [orig, col] of Object.entries(aliases)) map[normalizeHeader(orig).toLowerCase()] = col;
  return map;
}

// Columns that are safe to accept without an alias entry (already snake_case in
// the schema, e.g. Year -> year). Anything else is a mistake we want to hear about.
const SNAKE_SAFE = /^[a-z][a-z0-9_]*$/;

export function toColumnPayload(table, payload) {
  const aliases = COLUMN_ALIASES[table] || {};
  const normalized = buildNormalizedAliases(table);
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k === '__rowIndex') continue;

    // 1) exact alias, 2) whitespace/apostrophe-tolerant alias, 3) already-safe key
    let col = aliases[k] || normalized[normalizeHeader(k).toLowerCase()];
    if (!col && SNAKE_SAFE.test(k)) col = k;
    if (!col) {
      const guess = normalizeHeader(k).toLowerCase().replace(/[^0-9a-z]+/g, '_').replace(/^_+|_+$/g, '');
      // This used to silently become the column name, producing a baffling
      // "D1_ERROR: no such column: father_s_name" — or, worse, quietly writing a
      // value into the wrong column when the guess happened to exist.
      throw Object.assign(
        new Error(`Field "${k}" is not a known column of "${table}" (guessed "${guess}"). ` +
                  'Add it to COLUMN_ALIASES in tableRegistry.js if it is genuinely new.'),
        { authError: false }
      );
    }
    out[col] = v;
  }
  return out;
}

// Reverse of toColumnPayload — turns a D1 row back into the original header
// keys the frontend expects (plus `__rowIndex` aliased from `id`).
// NOTE: this is the reverse of toColumnPayload's alias table, so fixing the
// collections `AnnouncedCount` alias above also fixes the read side — the DB
// column `announcedcount` now maps back to `AnnouncedCount`, which is what
// announcements.js reads. Before the fix that reverse lookup missed and
// `parseInt(row.AnnouncedCount) || 0` was permanently 0, so the announce counter
// never appeared to increase even though the DB value was going up.
export function fromColumnRow(table, row) {
  const aliases = COLUMN_ALIASES[table] || {};
  const reverse = {};
  for (const [orig, col] of Object.entries(aliases)) reverse[col] = orig;
  const out = {};
  for (const [col, v] of Object.entries(row)) {
    if (col === 'id') { out['__rowIndex'] = v; continue; }
    out[reverse[col] || col] = v === null ? '' : v;
  }
  return out;
}
