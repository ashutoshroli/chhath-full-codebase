import { getSheetDataAsJSON, filterByYear } from './crud.js';
import { requireSuperadmin, requireYearAccess, ValidationError } from './auth.js';

const RECEIPT_TEMPLATE_SAMPLE = `## नवयुवक छठ पूजा समिति / NAVYUVAK CHHATH PUJA SAMITI
### Donation Receipt / दान रसीद

---

**Receipt No / रसीद संख्या:** [RECEIPT_NO]
**Date / दिनांक:** [DATE]

---

**Received From / प्राप्तकर्ता का नाम:** [NAME]

{{#IF FATHER_NAME}}
**Father's Name / पिता का नाम:** [FATHER_NAME]
{{/IF}}
{{#IF VILLAGE}}
**Village / गाँव:** [VILLAGE]
{{/IF}}
{{#IF DESIGNATION}}
**Designation / पदनाम:** [DESIGNATION]
{{/IF}}
{{#IF MOBILE}}
**Mobile / मोबाइल:** [MOBILE]
{{/IF}}

---

{{#IF AMOUNT}}
**Amount Received / प्राप्त राशि:** ₹[AMOUNT]
{{/IF}}
{{#IF DETAIL}}
**Work/Contribution Detail / कार्य विवरण:** [DETAIL]
{{/IF}}

धन्यवाद! आपके योगदान से छठ पूजा का आयोजन सफल होगा।

*Thank you! Your contribution helps make the Chhath Puja celebration successful.*

---

*Generated at / जनरेट किया गया: [GENERATED_AT]*`;

const CERTIFICATE_TEMPLATE_SAMPLE = `## नवयुवक छठ पूजा समिति / NAVYUVAK CHHATH PUJA SAMITI
### प्रमाण पत्र / CERTIFICATE OF APPRECIATION

---

**Certificate No / प्रमाण पत्र संख्या:** [CERT_NO]
**Date / दिनांक:** [DATE]

---

यह प्रमाणित किया जाता है कि **[NAME]** ने वर्ष [YEAR] की छठ पूजा में निम्न कार्य में अपना योगदान दिया:

*This is to certify that **[NAME]** contributed to the following work during the [YEAR] Chhath Puja celebration:*

**[DETAIL]**

{{#IF VILLAGE}}
**Village / गाँव:** [VILLAGE]
{{/IF}}
{{#IF FATHER_NAME}}
**Father's Name / पिता का नाम:** [FATHER_NAME]
{{/IF}}

समिति की ओर से हार्दिक धन्यवाद एवं शुभकामनाएं।

*With heartfelt thanks and best wishes from the committee.*

---

*Generated at / जनरेट किया गया: [GENERATED_AT]*`;

const SAMAAN_TEMPLATE_SAMPLE = `## नवयुवक छठ पूजा समिति / NAVYUVAK CHHATH PUJA SAMITI
### सामान रसीद / ITEM RECEIPT

---

**Receipt No / रसीद संख्या:** [SAMAAN_NO]
**Date / दिनांक:** [DATE]

---

**दानकर्ता / Donor:** [NAME]
{{#IF FATHER_NAME}}
**पिता का नाम / Father's Name:** [FATHER_NAME]
{{/IF}}
{{#IF VILLAGE}}
**गाँव / Village:** [VILLAGE]
{{/IF}}

**दिया गया सामान / Item Given:** [ITEM_DETAIL]

छठ पूजा वर्ष [YEAR] में आपके योगदान के लिए हार्दिक धन्यवाद!

*Thank you for your contribution to the [YEAR] Chhath Puja celebration!*

---

*Generated at / जनरेट किया गया: [GENERATED_AT]*`;

// One shared engine drives all three template kinds — same table shape
// (year, template_text, page_size, created_at, updated_at), same CRUD shape.
const ENGINES = {
  receipt: { table: 'receipt_templates', sample: RECEIPT_TEMPLATE_SAMPLE },
  certificate: { table: 'certificate_templates', sample: CERTIFICATE_TEMPLATE_SAMPLE },
  samaan: { table: 'samaan_templates', sample: SAMAAN_TEMPLATE_SAMPLE },
};

function rowOut(r) {
  return { Year: r.year, 'Template Text': r.template_text, 'Page Size': r.page_size, created_at: r.created_at, updated_at: r.updated_at };
}

export async function getTemplates(env, kind) {
  const { table } = ENGINES[kind];
  const { results } = await env.DB_TEMPLATES.prepare(`SELECT year, page_size, updated_at FROM ${table} ORDER BY year DESC`).all();
  return results.map(r => ({ Year: r.year, 'Page Size': r.page_size, updated_at: r.updated_at }));
}

export async function getTemplate(env, kind, year) {
  const { table } = ENGINES[kind];
  const row = await env.DB_TEMPLATES.prepare(`SELECT * FROM ${table} WHERE year = ?`).bind(parseInt(year)).first();
  return row ? rowOut(row) : null;
}

export async function saveTemplate(env, kind, year, text, pageSize, user) {
  requireSuperadmin(user);
  if (!year) throw ValidationError('Year required');
  const { table } = ENGINES[kind];
  const now = new Date().toISOString();
  const existing = await env.DB_TEMPLATES.prepare(`SELECT id FROM ${table} WHERE year = ?`).bind(parseInt(year)).first();
  if (existing) {
    await env.DB_TEMPLATES.prepare(`UPDATE ${table} SET template_text = ?, page_size = ?, updated_at = ? WHERE year = ?`)
      .bind(text, pageSize || 'A5', now, parseInt(year)).run();
  } else {
    await env.DB_TEMPLATES.prepare(`INSERT INTO ${table} (year, template_text, page_size, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(parseInt(year), text, pageSize || 'A5', now, now).run();
  }
  return { success: true };
}

export async function copyTemplate(env, kind, fromYear, toYear, user) {
  requireSuperadmin(user);
  if (!toYear) throw ValidationError('Target year required');
  const { table } = ENGINES[kind];
  const conflict = await env.DB_TEMPLATES.prepare(`SELECT id FROM ${table} WHERE year = ?`).bind(parseInt(toYear)).first();
  if (conflict) throw ValidationError(`A template already exists for ${toYear}.`);
  const source = await env.DB_TEMPLATES.prepare(`SELECT * FROM ${table} WHERE year = ?`).bind(parseInt(fromYear)).first();
  if (!source) throw ValidationError('Source template not found.');
  return saveTemplate(env, kind, toYear, source.template_text, source.page_size, user);
}

export async function deleteTemplate(env, kind, year, user) {
  requireSuperadmin(user);
  const { table } = ENGINES[kind];
  const result = await env.DB_TEMPLATES.prepare(`DELETE FROM ${table} WHERE year = ?`).bind(parseInt(year)).run();
  if (!result.meta.changes) throw ValidationError('Template not found.');
  return { success: true };
}

// Seeds a sample template on the current year if that kind's table is empty —
// same "always have a working example" behavior as Code.js's ensure*Sheet().
// Migration data already seeded RECEIPT/CERTIFICATE/SAMAAN from your live export
// (18 rows total across all templates tables — see migration/templates.sql), so
// this only matters for a genuinely fresh deploy.
export async function ensureSeedTemplate(env, kind) {
  const { table, sample } = ENGINES[kind];
  const { results } = await env.DB_TEMPLATES.prepare(`SELECT id FROM ${table} LIMIT 1`).all();
  if (results.length) return;
  const now = new Date();
  await env.DB_TEMPLATES.prepare(`INSERT INTO ${table} (year, template_text, page_size, created_at, updated_at) VALUES (?, ?, 'A5', ?, ?)`)
    .bind(now.getFullYear(), sample, now.toISOString(), now.toISOString()).run();
}

const parseAmt = (v) => parseFloat((v || '').toString().replace(/[^0-9.-]+/g, '')) || 0;
// Guards on the *parsed* number, not raw truthiness — a literal "0" string
// (accidental typo, or a pre-existing row saved before Kaam/Samaan entries
// properly left Amount blank) must still be treated as "no amount", same as
// a genuinely blank value, so {{#IF AMOUNT}} in the templates hides correctly.
const formatAmt = (v) => (parseAmt(v) > 0 ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(parseAmt(v)) : '');

async function resolveEntry(env, rowIndex, year) {
  const collections = filterByYear(await getSheetDataAsJSON(env, 'COLLECTIONS'), year);
  const entry = collections.find(c => parseInt(c.__rowIndex) === parseInt(rowIndex));
  if (!entry) throw ValidationError('Collection entry not found.');
  const users = await getSheetDataAsJSON(env, 'USERS');
  // Collections.Name actually stores the contributor's User ID (see Home.jsx's
  // contributor picker), not their display name — so this must match on ID, not
  // Name. Matching on Name here (as the original Code.js did) always returns {},
  // silently blanking Designation/Father's Name/Village/Mobile on every receipt.
  const u = users.find(x => (x.ID || '').toString().trim() === (entry.Name || '').toString().trim()) || {};
  return { entry, u };
}

export async function getReceiptData(env, rowIndex, year, user) {
  await requireYearAccess(env, user, year);
  const { entry, u } = await resolveEntry(env, rowIndex, year);
  const template = await getTemplate(env, 'receipt', year);
  return {
    templateFound: !!template,
    templateText: template ? template['Template Text'] : '',
    pageSize: template ? template['Page Size'] : 'A5',
    placeholders: {
      RECEIPT_NO: `NCS-${year}-${entry['Sl. No.']}`,
      NAME: u.Name || entry.Name || '', DESIGNATION: u.Designation || '',
      FATHER_NAME: u["Father's Name"] || '', VILLAGE: u.Village || '', MOBILE: u.Mobile || '',
      AMOUNT: formatAmt(entry.Amount), DETAIL: entry.Detail || '', DATE: entry.Date || '', YEAR: year,
    },
  };
}

export async function getCertificateData(env, rowIndex, year, user) {
  await requireYearAccess(env, user, year);
  const { entry, u } = await resolveEntry(env, rowIndex, year);
  const template = await getTemplate(env, 'certificate', year);
  return {
    templateFound: !!template,
    templateText: template ? template['Template Text'] : '',
    pageSize: template ? template['Page Size'] : 'A5',
    placeholders: {
      CERT_NO: `NCS-CERT-${year}-${entry['Sl. No.']}`,
      NAME: u.Name || entry.Name || '', DESIGNATION: u.Designation || '',
      FATHER_NAME: u["Father's Name"] || '', VILLAGE: u.Village || '', DETAIL: entry.Detail || '',
      DATE: entry.Date || '', YEAR: year,
    },
  };
}

export async function getSamaanData(env, rowIndex, year, user) {
  await requireYearAccess(env, user, year);
  const { entry, u } = await resolveEntry(env, rowIndex, year);
  const template = await getTemplate(env, 'samaan', year);
  return {
    templateFound: !!template,
    templateText: template ? template['Template Text'] : '',
    pageSize: template ? template['Page Size'] : 'A5',
    placeholders: {
      SAMAAN_NO: `NCS-SAMAAN-${year}-${entry['Sl. No.']}`,
      NAME: u.Name || entry.Name || '', FATHER_NAME: u["Father's Name"] || '', VILLAGE: u.Village || '',
      ITEM_DETAIL: entry.Detail || '', DATE: entry.Date || '', YEAR: year,
    },
  };
}
