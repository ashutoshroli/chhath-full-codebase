import { useEffect, useState } from 'react';
import { api, reportClientError } from '../api.js';


const DOC_TYPE_FOR_MODE = { en: 'report_en', hi: 'report_hi', both: 'report_both' };
const MODE_LABEL_FOR_DOC_TYPE = { report_en: 'English', report_hi: 'Hindi', report_both: 'Both' };

function amountText(n) {
  return 'Rs. ' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);
}

// Defense-in-depth cache-buster for the PDF links this view opens. Even with distinct
// per-generation R2 keys from the backend, a fixed URL that the browser (or the CDN edge)
// has already cached could be served stale when clicked from inside the app. Appending a
// ?v=<token> derived from the file's generation time (or the current timestamp for a
// just-generated file) makes each rendered link a distinct request URL. Pure and a no-op
// for empty/null urls or a missing token.
export function withCacheBuster(url, token) {
  if (!url) return url;
  if (token === undefined || token === null || token === '') return url;
  return url + (url.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(token);
}

export default function PdfExport() {
  const [years, setYears] = useState(null);
  const [year, setYear] = useState('');
  const [language, setLanguage] = useState('en');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [previous, setPrevious] = useState(null);
  const [previousLoading, setPreviousLoading] = useState(false);

  useEffect(() => {
    api.getYears().then(ys => {
      setYears(ys);
      if (ys && ys.length) setYear(String(ys[0]));
    }).catch(err => setError(err.message));
  }, []);

  const loadPrevious = (y) => {
    if (!y) { setPrevious(null); return; }
    setPreviousLoading(true);
    Promise.all(
      Object.values(DOC_TYPE_FOR_MODE).map(dt =>
        api.getGeneratedFilesForYear(y, dt).catch(err => {
          setWarning(`Could not load the list of previous reports (${dt}): ${err.message}`);
          reportClientError('PdfExport', `getGeneratedFilesForYear failed for ${dt} ${y}`, err, { year: y, docType: dt });
          return [];
        })
      )
    ).then(lists => {
      const merged = [].concat(...lists).sort((a, b) => (b.generated_at || '').localeCompare(a.generated_at || ''));
      setPrevious(merged);
    }).finally(() => setPreviousLoading(false));
  };

  useEffect(() => { loadPrevious(year);  }, [year]);

  const generate = async () => {
    if (!year) return alert('Please select a year');
    setGenerating(true);
    setError('');
    setWarning('');
    try {
      const mode = language;
      const docType = DOC_TYPE_FOR_MODE[mode];

      // The browser no longer fills the report .docx. The Worker resolves the template and
      // Render fills it with the placeholders we build below (+QR) then converts.
      const [home, loansData, expenses, users, lists] = await Promise.all([
        api.getHome(year),
        api.getLoans(year),
        api.getExpenses(year),
        api.getUsers(),
        mode !== 'en' ? api.getAllDropdownLists() : Promise.resolve(null),
      ]);

      const userMap = {};
      (users || []).forEach(u => { userMap[u.ID] = u; });
      const nameOf = (id) => (userMap[id] && userMap[id].Name) || id || 'Unknown';
      const nameHiOf = (id) => (userMap[id] && userMap[id]['Name (Hindi)']) || '';
      const categoryHiOf = (val) => {
        if (!lists) return '';
        const row = (lists['Category'] || []).find(r => r['English Value'] === val);
        return row ? row['Hindi Label'] : '';
      };
      const statusHiOf = (val) => {
        if (!lists) return '';
        const row = (lists['Loan Status'] || []).find(r => r['English Value'] === val);
        return row ? row['Hindi Label'] : '';
      };
      const parseAmt = (v) => parseFloat((v || '').toString().replace(/[^0-9.-]+/g, '')) || 0;

      const loans = (loansData.loans || []).map(l => ({
        LOAN_TAKER: nameOf(l.Name),
        LOAN_TAKER_HI: nameHiOf(l.Name),
        AMOUNT: amountText(parseAmt(l.Amount)),
        INTEREST: (l['Intrest Rate'] || l['Interest Rate'] || '0') + '%',
        TENURE: l.Tenure || '-',
        STATUS: l.Status || 'Active',
        STATUS_HI: statusHiOf(l.Status || 'Active'),
      }));

      const guarantors = (loansData.guarantors || []).map(g => ({
        GUARANTOR_NAME: nameOf(g.Guarantor),
        GUARANTOR_NAME_HI: nameHiOf(g.Guarantor),
        LOAN_TAKER: nameOf(g.Loaner),
        LOAN_TAKER_HI: nameHiOf(g.Loaner),
        YEAR: g.Year || year,
      }));

      const contributors = (home.collections || []).map((c, i) => {
        const isResellRow = c['Is Resell'] === 'TRUE' || c['Is Resell'] === true;
        const isMoneyType = (c['Contribution Type'] || '1').toString() === '1';
        const u = userMap[c.Name] || {};
        return {
          SL_NO: i + 1,
          NAME: isResellRow ? `Resold Item: ${c.Detail || '-'}` : nameOf(c.Name),
          NAME_HI: isResellRow ? '' : nameHiOf(c.Name),
          FATHER_NAME: isResellRow ? '-' : (u["Father's Name"] || '-'),
          FATHER_NAME_HI: isResellRow ? '' : (u["Father's Name (Hindi)"] || ''),
          VILLAGE: isResellRow ? '-' : (u.Village || '-'),
          VILLAGE_HI: isResellRow ? '' : (u['Village (Hindi)'] || ''),
          AMOUNT: (isMoneyType || isResellRow) ? amountText(parseAmt(c.Amount)) : (c.Detail || '-'),
        };
      });

      const expenseRows = (expenses || []).map((e, i) => ({
        SL_NO: i + 1,
        DESCRIPTION: e.Discription || '-',
        DESCRIPTION_HI: e['Discription (Hindi)'] || '',
        CATEGORY: e.Category || '-',
        CATEGORY_HI: categoryHiOf(e.Category),
        AMOUNT: amountText(parseAmt(e.Amount)),
      }));

      const placeholders = {
        YEAR: year,
        TOTAL_COLLECTION: amountText(home.totCol),
        PAST_RETURN: amountText(home.pastRet),
        TOTAL_EXPENSES: amountText(home.totExp),
        TOTAL_BUDGET: amountText(home.totBudget),
        SURPLUS: amountText(home.surplus),
        GENERATED_AT: new Date().toLocaleString('en-IN'),
        loans, guarantors, contributors, expenses: expenseRows,
      };

      const recordId = `${docType}-${year}`;
      const fileName = `Chhath-Puja-Report-${year}${mode !== 'en' ? '-' + mode : ''}.docx`;
      const res = await api.convertDocxToPdfBulk(docType, year, recordId, placeholders, fileName, true);

      // The per-record render report (unresolved placeholders) now comes BACK on the
      // result, since Render filled the document.
      const missing = res && res.report && Array.isArray(res.report.missingTags) ? res.report.missingTags : [];
      if (missing.length) {
        setWarning(`These placeholders in the report template could not be resolved (they will be blank): ${[...new Set(missing)].join(', ')}`);
        reportClientError('PdfExport', 'Report template had unresolved placeholders', null,
          { docType, year, missingTags: [...new Set(missing)] });
      }

      if (res && res.indexFailed) {
        setWarning(res.error || 'The report PDF was generated but not indexed.');
        reportClientError('PdfExport', `Report generated but NOT indexed: ${recordId}`, null,
          { docType, year, recordId, publicLink: res.publicLink });
      }

      const a = document.createElement('a');
      a.href = withCacheBuster(res.publicLink, res.generated_at || Date.now());
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      loadPrevious(year);
    } catch (err) {
      setError(err.message || 'An error occurred while generating the PDF');
      reportClientError('PdfExport', `Report generation failed for ${year}`, err, { year, language });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <h2 style={{ marginBottom: 15 }}>PDF Export</h2>
      {error && <div className="error-banner">{error}</div>}
      {warning && (
        <div style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 8, padding: '8px 12px', fontSize: '0.8rem', marginBottom: 10 }}>
          ⚠️ {warning}
        </div>
      )}

      <div className="glass-card" style={{ padding: 20 }}>
        <div className="form-group">
          <label>Year</label>
          <select value={year} onChange={e => setYear(e.target.value)}>
            {(years || []).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>Language</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['en', 'English'], ['hi', 'Hindi'], ['both', 'Both']].map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                className="nav-btn"
                style={{
                  flex: 1, border: '1px solid var(--primary-saffron)',
                  background: language === val ? 'var(--primary-saffron)' : '#fff',
                  color: language === val ? '#fff' : 'var(--primary-saffron)',
                }}
                onClick={() => setLanguage(val)}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <button className="btn-submit" onClick={generate} disabled={generating || !year}>
          {generating ? 'Generating...' : 'Generate PDF'}
        </button>
      </div>

      <div className="glass-card" style={{ padding: 20, marginTop: 15 }}>
        <h3 style={{ marginBottom: 10, fontSize: '1rem' }}>Already Generated — Year {year || '-'}</h3>
        {previousLoading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading...</div>
        ) : !previous || previous.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No reports generated yet for this year.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {previous.map((f, i) => (
              <a
                key={f.id || i}
                href={withCacheBuster(f.public_link, f.generated_at || f.id)}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 12px', borderRadius: 8, background: '#fafafa',
                  border: '1px solid #eee', textDecoration: 'none', color: 'inherit', fontSize: '0.85rem',
                }}
              >
                <span>{MODE_LABEL_FOR_DOC_TYPE[f.doc_type] || f.doc_type} — {f.file_name}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  {f.generated_at ? new Date(f.generated_at).toLocaleString('en-IN') : ''}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
