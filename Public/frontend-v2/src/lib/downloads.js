

export function selectDocType(entry) {
  const e = entry || {};
  const isSamaan = e['Contribution Type'] === '2';
  const wantCert = !isSamaan && e['Certificate Or Receipt'] === 'Certificate';
  const isWork = !isSamaan && !wantCert && (e['Contribution Type'] || '').toString() === '3';
  return isSamaan ? 'samaan' : (wantCert ? 'certificate' : (isWork ? 'receipt_work' : 'receipt'));
}

export function buildRecordId(docType, year, rowIndex) {
  return `${docType}-${year}-${rowIndex}`;
}

export function isFileGenerated(generatedFiles, docType, year, recordId) {
  return (generatedFiles || []).find((r) =>
    r.doc_type === docType && parseInt(r.year) === year && r.record_id === recordId
  ) || null;
}

export function buildPersonDownloads(data, id, deps) {
  const d = data || {};
  const { t, fmt, localize, getUser } = deps || {};
  const genFiles = d.generatedFiles || [];

  const collections = (d.collections || [])
    .filter((r) => (r.ID || r.Name) === id)
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
