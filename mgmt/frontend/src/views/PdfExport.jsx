import { useEffect, useState } from 'react';
import { api, reportClientError } from '../api.js';
import { fillDocxTemplateFromRow, getLastRenderReport } from '../docxFill.js';

// Superadmin-only. Own year dropdown (independent of the app's top year-selector).
//
// Language modes map 1:1 to a Superadmin-uploaded .docx template (Document
// Templates tab -> Report - English / Report - Hindi / Report - Both):
//   'en'   — docType 'report_en'
//   'hi'   — docType 'report_hi'
//   'both' — docType 'report_both'
//
// The template is filled client-side (docxtemplater, same engine as
// Receipt/Certificate/Samaan) then converted to a real PDF on the backend via
// the Drive conversion pipeline (convertDocxToPdf) — no more hand-built jsPDF
// layout / hindiPdf rasterization.

const DOC_TYPE_FOR_MODE = { en: 'report_en', hi: 'report_hi', both: 'report_both' };
const MODE_LABEL_FOR_DOC_TYPE = { report_en: 'English', report_hi: 'Hindi', report_both: 'Both' };

function amountText(n) {
  return 'Rs. ' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);
}

export default function PdfExport() {
  const [years, setYears] = useState(null);
  const [year, setYear] = useState('');
  const [language, setLanguage] = useState('en'); // 'en' | 'hi' | 'both'
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [previous, setPrevious] = useState(null); // previously generated Report PDFs for the selected year
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
    // All three report modes (en/hi/both) are separate docTypes but the same
    // "Year's generated reports" list — fetch all three and merge.
    Promise.all(
      // Was `.catch(() => [])`, so a permissions or DB failure silently rendered
      // as "no reports generated yet for this year".
      Object.values(DOC_TYPE_FOR_MODE).map(dt =>
        api.getGeneratedFilesForYear(y, dt).catch(err => {
          setWarning(`Purani reports ki list load nahi hui (${dt}): ${err.message}`);
          reportClientError('PdfExport', `getGeneratedFilesForYear failed for ${dt} ${y}`, err, { year: y, docType: dt });
          return [];
        })
      )
    ).then(lists => {
      const merged = [].concat(...lists).sort((a, b) => (b.generated_at || '').localeCompare(a.generated_at || ''));
      setPrevious(merged);
    }).finally(() => setPreviousLoading(false));
  };

  useEffect(() => { loadPrevious(year); /* eslint-disable-next-line */ }, [year]);

  const generate = async () => {
    if (!year) return alert('Please select a year');
    setGenerating(true);
    setError('');
    setWarning('');
    try {
      const mode = language;
      const docType = DOC_TYPE_FOR_MODE[mode];

      let docxRow = null;
      try {
        docxRow = await api.getDocxTemplateForDoc(docType, year);
      } catch (err) {
        // Was `.catch(() => null)` -> a real load failure was reported as "no
        // template uploaded", sending the Superadmin to upload a template that
        // already existed.
        reportClientError('PdfExport', `Template load failed for ${docType} ${year}`, err, { docType, year });
        throw new Error(`Report template load nahi hua: ${err.message}`);
      }
      if (!docxRow || !(docxRow.base64 || docxRow.downloadUrl)) {
        throw new Error(`No Report template (${mode}) has been uploaded for Year ${year} yet. Please upload one under Document Templates.`);
      }

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
        // Samaan (Material) / Kaam (Service) entries never carry a money
        // Amount — the item/work name lives in Detail instead — so showing
        // "Rs. 0" for them is misleading. Resell entries have an Amount but
        // no linked contributor (Name is intentionally blank). Both cases
        // are shown via Detail/label instead of a bare 0 amount.
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

      const filledBase64 = await fillDocxTemplateFromRow(docxRow, placeholders);

      const rep = getLastRenderReport();
      if (rep.missingTags.length) {
        setWarning(`Report template mein ye placeholders resolve nahi hue (blank rahenge): ${[...new Set(rep.missingTags)].join(', ')}`);
        reportClientError('PdfExport', 'Report template had unresolved placeholders', null,
          { docType, year, missingTags: [...new Set(rep.missingTags)] });
      }

      // Was `${docType}-${year}-${Date.now()}`. A timestamp-based recordId can
      // never match isFileGenerated(), so EVERY click created a brand-new Drive
      // PDF plus a brand-new generated_files row — an unbounded stream of
      // duplicates that are shipped to every anonymous portal visitor, and whose
      // QR codes (`?record=report_en-...`) the public portal can't resolve at all.
      // One stable row per (docType, year), regenerated on purpose via force.
      const recordId = `${docType}-${year}`;
      const fileName = `Chhath-Puja-Report-${year}${mode !== 'en' ? '-' + mode : ''}.docx`;
      const res = await api.convertDocxToPdf(docType, year, recordId, filledBase64, fileName, 'bulk', true);

      if (res && res.indexFailed) {
        setWarning(res.error || 'Report PDF ban gaya lekin index nahi hua.');
        reportClientError('PdfExport', `Report generated but NOT indexed: ${recordId}`, null,
          { docType, year, recordId, publicLink: res.publicLink });
      }

      // The `download` attribute is ignored on a cross-origin Drive URL, and the
      // click happens several awaits after the user gesture, so it needs to be a
      // real DOM node with a navigation fallback.
      const a = document.createElement('a');
      a.href = res.publicLink;
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      loadPrevious(year);
    } catch (err) {
      setError(err.message || 'An error occurred while generating the PDF');
      // Client-side docx fill / report assembly failures never pass through
      // api.js's call(), so they were previously invisible in the Error Log.
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
                href={f.public_link}
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
