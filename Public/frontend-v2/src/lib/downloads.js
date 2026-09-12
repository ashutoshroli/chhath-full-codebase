// Download-center document builders for the v2 public portal.
//
// WHY THIS EXISTS
// The Download Center lets a visitor pick a village + person and see every
// receipt / certificate / consent PDF the committee generated for them. The
// logic that decides WHICH document type a collection row maps to, and how the
// per-document recordId is built, is porting-sensitive: the recordId string MUST
// match EXACTLY how the mgmt backend files and generates the PDF, or the public
// download would look for the wrong record and the link would never appear. So
// that logic lives here as a framework-free module (imports nothing from Astro),
// where the pure docType-selection and recordId helpers can be unit-tested with
// plain `node --test`. Ported from Public/frontend/script.js buildPersonDownloads.
//
// TWO LAYERS:
//   - PURE, import-free helpers (selectDocType, buildRecordId, isFileGenerated)
//     — trivially unit-testable, no i18n/finance/Astro dependency.
//   - buildPersonDownloads(...) — the orchestration that assembles the three
//     labelled sections. It needs t()/fmt()/localize()/getUser to build the
//     human labels, so those are passed IN (dependency injection) rather than
//     imported here, keeping this module import-free and the pure helpers above
//     testable in isolation.

// ---- PURE helpers (no I/O, no imports) -------------------------------------

// Decide the document type for a collection row, EXACTLY as the mgmt backend
// files it. The order matters:
//   - Contribution Type '2' is a MATERIAL contribution -> 'samaan' (material
//     receipt). It never carries a Certificate/Receipt choice.
//   - Otherwise, when the row explicitly asks for a Certificate -> 'certificate'.
//   - Otherwise, Contribution Type '3' (Service/Work) with a Receipt is its OWN
//     doc type 'receipt_work'. This exists because the mgmt backend generates and
//     files a work receipt under a DISTINCT recordId prefix; if the public site
//     used the plain 'receipt' prefix here, it would query the wrong recordId and
//     a valid work-receipt download would silently never show.
//   - Everything else is a plain 'receipt'.
export function selectDocType(entry) {
  const e = entry || {};
  const isSamaan = e['Contribution Type'] === '2';
  const wantCert = !isSamaan && e['Certificate Or Receipt'] === 'Certificate';
  const isWork = !isSamaan && !wantCert && (e['Contribution Type'] || '').toString() === '3';
  return isSamaan ? 'samaan' : (wantCert ? 'certificate' : (isWork ? 'receipt_work' : 'receipt'));
}

// Build the per-document recordId. This string is the join key against the
// generatedFiles table (doc_type + year + record_id), so its shape is a hard
// contract with the mgmt backend: `${docType}-${year}-${rowIndex}`. Do NOT
// change the separators or ordering without changing mgmt in lockstep.
export function buildRecordId(docType, year, rowIndex) {
  return `${docType}-${year}-${rowIndex}`;
}

// Find the generated-file record for a (docType, year, recordId) triple, or null
// when the committee has not generated/filed that PDF yet. `year` is compared as
// an integer because the payload stores it as a string in some columns.
export function isFileGenerated(generatedFiles, docType, year, recordId) {
  return (generatedFiles || []).find((r) =>
    r.doc_type === docType && parseInt(r.year) === year && r.record_id === recordId
  ) || null;
}

// ---- Orchestration (dependency-injected i18n/finance/user helpers) ---------
//
// Assemble the three document sections for one person. The i18n/finance/user
// helpers are injected via `deps` so this file imports nothing from Astro or the
// i18n module — the caller (the Downloads island) wires the real t/fmt/localize/
// getUser, while unit tests exercise the pure helpers above directly.
//
//   data     the coalesced portal payload (collections/loans/loanConsents/
//            generatedFiles guaranteed to be arrays by coalescePortalData).
//   id       the selected person's user ID (string).
//   deps     { t, fmt, localize, getUser } — t(key), fmt(amount),
//            localize(row, field), getUser(id). `lang` is baked into the caller's
//            t/localize closures so this module stays language-agnostic.
//
// Returns { collections, loanerItems, guarantorItems }, each an array of
// { recordId, docType, year, label, publicLink } sorted newest-year first.
export function buildPersonDownloads(data, id, deps) {
  const d = data || {};
  const { t, fmt, localize, getUser } = deps || {};
  const genFiles = d.generatedFiles || [];

  // ---- Collections: Receipt / Certificate / Material ----
  const collections = (d.collections || [])
    .filter((r) => (r.ID || r.Name) === id)
    // A Resell row is a resold donated item with no owning person, so it carries
    // no downloadable personal document — exclude it.
    .filter((r) => !(r['Is Resell'] === 'TRUE' || r['Is Resell'] === true))
    .map((entry) => {
      const year = parseInt(entry.Year);
      const isSamaan = entry['Contribution Type'] === '2';
      const docType = selectDocType(entry);
      const recordId = buildRecordId(docType, year, entry.__rowIndex);
      const gen = isFileGenerated(genFiles, docType, year, recordId);
      const label = `${t('doc_' + docType)} — ${year}${(!isSamaan && entry.Amount) ? ' — ' + fmt(entry.Amount) : ''}`;
      return { recordId, docType, year, label, publicLink: gen ? gen.public_link : null };
    })
    .sort((a, b) => b.year - a.year);

  // ---- Loans this person took (as Loaner) ----
  const loanerItems = (d.loans || [])
    .filter((l) => (l.ID || l.Name) === id)
    .flatMap((loan) => {
      const year = parseInt(loan.Year);
      const c = (d.loanConsents || []).find((x) =>
        x.loan_id === loan['Loan ID'] && x.role === 'loaner' && x.status === 'accepted');
      if (!c) return [];
      const recordId = `consent_loaner-${year}-${c.consent_id}`;
      const gen = isFileGenerated(genFiles, 'consent_loaner', year, recordId);
      return [{ recordId, docType: 'consent_loaner', year, label: `${t('doc_consent_loaner')} — ${year} — ${fmt(loan.Amount)}`, publicLink: gen ? gen.public_link : null }];
    })
    .sort((a, b) => b.year - a.year);

  // ---- Loans this person guaranteed for someone else ----
  const guarantorItems = (d.loanConsents || [])
    .filter((c) => c.role === 'guarantor' && c.status === 'accepted' && (c.person_id || '').toString().trim() === id)
    .flatMap((c) => {
      const loan = (d.loans || []).find((l) => l['Loan ID'] === c.loan_id);
      if (!loan) return [];
      const year = parseInt(loan.Year);
      const recordId = `consent_guarantor-${year}-${c.consent_id}`;
      const gen = isFileGenerated(genFiles, 'consent_guarantor', year, recordId);
      const loanerName = localize(getUser(loan.ID || loan.Name), 'Name');
      return [{ recordId, docType: 'consent_guarantor', year, label: `${t('doc_consent_guarantor')} — ${loanerName} — ${year}`, publicLink: gen ? gen.public_link : null }];
    })
    .sort((a, b) => b.year - a.year);

  return { collections, loanerItems, guarantorItems };
}
