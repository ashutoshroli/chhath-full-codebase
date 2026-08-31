// Public transparency portal — READ-ONLY. Bound only to core, collections,
// loans_expenses, file_index (see MIGRATION_NOTES.md flag #4 for why these 4
// and not all 8 — templates/whatsapp_index/logs/misc stay mgmt-internal).
//
// Deliberately a SEPARATE Worker deployment from mgmt-worker (confirmed with
// Vhhb) — different D1 binding scope, different wrangler.toml, different URL.
// Frontend change needed: Public/frontend just points its fetch at this
// Worker's URL with ?action=portalData, same as before.

async function tableRows(db, table, columnMap, dropColumns) {
  const { results } = await db.prepare(`SELECT * FROM ${table} ORDER BY id ASC`).all();
  return results.map(r => {
    const out = {};
    for (const [col, val] of Object.entries(r)) {
      if (col === 'id') { out['__rowIndex'] = val; continue; }
      if (dropColumns && dropColumns.includes(col)) continue; // never expose columns the public site doesn't need
      const header = (columnMap && columnMap[col]) || col;
      out[header] = val === null ? '' : val;
    }
    return out;
  });
}

// Same header-name reversal as mgmt-worker's tableRegistry.js COLUMN_ALIASES,
// duplicated here (not imported) so this Worker has zero dependency on
// mgmt-worker's source tree — keeps the two deployments fully independent.
const REVERSE_MAPS = {
  users: { id_code: 'ID', name: 'Name', village: 'Village', fathers_name: "Father's Name ", mobile: 'Mobile ', designation: 'Designation', created_by: 'Created By', email: 'Email', whatsapp: 'WhatsApp', name_hindi: 'Name (Hindi)', fathers_name_hindi: "Father's Name (Hindi)", designation_hindi: 'Designation (Hindi)', village_hindi: 'Village (Hindi)' },
  committee_members: { year: 'Year', name: 'Name', created_by: 'Created By', view_role: 'View Role', view_role_hindi: 'View Role (Hindi)', whatsapp: 'WhatsApp' },
  collections: { year: 'Year', sl_no: 'Sl. No.', name: 'Name', amount: 'Amount', created_by: 'Created By', payment_mode: 'Payment Mode', date: 'Date', contribution_type: 'Contribution Type', detail: 'Detail', certificate_or_receipt: 'Certificate Or Receipt', utr: 'UTR', is_resell: 'Is Resell', announced: 'Announced', announced_count: 'AnnouncedCount' },
  expenses: { year: 'Year', discription: 'Discription', amount: 'Amount', created_by: 'Created By', category: 'Category', discription_hindi: 'Discription (Hindi)' },
  loans: { year: 'Year', name: 'Name', amount: 'Amount', intrest_rate: 'Intrest Rate', tenure: 'Tenure', signature: 'Signature', loan_documents: 'Loan Documents', created_by: 'Created By', status: 'Status', loan_id: 'Loan ID', loan_status: 'Loan Status', final_repayment_date: 'Final Repayment Date' },
  loan_guarantors: { year: 'Year', loaner: 'Loaner', guarantor: 'Guarantor', guarantor_signature: 'Guarantor Signature', created_by: 'Created By', loan_id: 'Loan ID' },
  generated_files: {}, // headers already close to snake_case originals; see file_index/schema.sql if you need exact source names
  loan_consents: {},
};

async function getAllPortalData(env) {
  return {
    // Public transparency portal only needs Name/Village/Father's Name/
    // Designation/Mobile for display (Mobile is shown next to Committee
    // members) — email and personal WhatsApp numbers are never rendered on
    // the public site, so they're dropped here rather than shipped to every
    // visitor's browser (data-minimization — see MIGRATION_NOTES.md flag).
    users: await tableRows(env.DB_CORE, 'users', REVERSE_MAPS.users, ['email', 'whatsapp']),
    committee: await tableRows(env.DB_CORE, 'committee_members', REVERSE_MAPS.committee_members),
    collections: await tableRows(env.DB_COLLECTIONS, 'collections', REVERSE_MAPS.collections),
    expenses: await tableRows(env.DB_LOANS_EXPENSES, 'expenses', REVERSE_MAPS.expenses),
    loans: await tableRows(env.DB_LOANS_EXPENSES, 'loans', REVERSE_MAPS.loans),
    guarantors: await tableRows(env.DB_LOANS_EXPENSES, 'loan_guarantors', REVERSE_MAPS.loan_guarantors),
    generatedFiles: await tableRows(env.DB_FILE_INDEX, 'generated_files', REVERSE_MAPS.generated_files),
    loanConsents: await tableRows(env.DB_LOANS_EXPENSES, 'loan_consents', REVERSE_MAPS.loan_consents),
  };
}

// ---- Public popups (read-only, scoped to ONLY popups + popup_slides — never
// any other table in the misc DB, per the "no extra data" requirement) ----
function isTruthyFlag(v) { return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true'; }

async function getActivePublicPopups(env) {
  if (!env.DB_MISC) return []; // binding not configured yet — fail closed, not open
  const now = new Date();
  const { results: allPopups } = await env.DB_MISC.prepare(
    'SELECT popup_id, title, roles, active, start_at, end_at FROM popups WHERE active = 1'
  ).all();
  const popups = allPopups.filter(p => {
    const rolesList = (p.roles || '').split(',').map(r => r.trim()).filter(Boolean);
    // Only popups explicitly tagged "Public" in mgmt's Popup Management show
    // here — a popup with no roles at all is treated as mgmt-internal-only
    // (matches the existing getActivePopups behavior for logged-in staff),
    // so Superadmin must opt a popup into the Public role deliberately.
    if (!rolesList.includes('Public')) return false;
    if (p.start_at && new Date(p.start_at) > now) return false;
    if (p.end_at && new Date(p.end_at) < now) return false;
    return isTruthyFlag(p.active);
  });
  if (!popups.length) return [];
  const { results: allSlides } = await env.DB_MISC.prepare(
    'SELECT slide_id, popup_id, slide_order, image_url, text, link_url, link_text FROM popup_slides ORDER BY slide_order ASC'
  ).all();
  return popups
    .map(p => ({
      popup_id: p.popup_id,
      title: p.title,
      slides: allSlides
        .filter(s => s.popup_id === p.popup_id)
        .map(s => ({ slide_id: s.slide_id, slide_order: s.slide_order, image_url: s.image_url, text: s.text, link_url: s.link_url, link_text: s.link_text })),
    }))
    .filter(p => p.slides.length > 0);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
    }
    if (action === 'portalData') {
      const data = await getAllPortalData(env);
      return new Response(JSON.stringify(data), { headers: cors });
    }
    if (action === 'activePopups') {
      const data = await getActivePublicPopups(env);
      return new Response(JSON.stringify(data), { headers: cors });
    }
    return new Response(JSON.stringify({ status: false, message: 'Invalid Request' }), { headers: cors });
  },
};
