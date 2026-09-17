<script lang="ts">
  // Ported from React views/PdfExport.jsx — generate a year's report (EN/HI/Both)
  // by filling the report .docx template with aggregated home/loans/expenses/
  // contributors data, converting to PDF, and listing previously generated files.
  import { api, reportClientError } from '$lib/api';

  import { newUid } from '$lib/a11y/uid';
  // audit PR-40: one prefix per instance, so `for`/`id` pairs cannot collide when a
  // component is mounted more than once on a screen.
  const uid = newUid();

  const DOC_TYPE_FOR_MODE: Record<string, string> = { en: 'report_en', hi: 'report_hi', both: 'report_both' };
  const MODE_LABEL_FOR_DOC_TYPE: Record<string, string> = { report_en: 'English', report_hi: 'Hindi', report_both: 'Both' };

  function amountText(n: unknown): string {
    return 'Rs. ' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format((n as number) || 0);
  }

  let years = $state<string[] | null>(null);
  let year = $state('');
  let language = $state('en');
  let generating = $state(false);
  let error = $state('');
  let warning = $state('');
  let previous = $state<any[] | null>(null);
  let previousLoading = $state(false);

  // Load years once.
  let yearsLoaded = false;
  $effect(() => {
    if (yearsLoaded) return;
    yearsLoaded = true;
    api.getYears()
      .then((ys: string[]) => {
        years = ys;
        if (ys && ys.length) year = String(ys[0]);
      })
      .catch((err: Error) => (error = err.message));
  });

  function loadPrevious(y: string) {
    if (!y) { previous = null; return; }
    previousLoading = true;
    Promise.all(
      Object.values(DOC_TYPE_FOR_MODE).map((dt) =>
        api.getGeneratedFilesForYear(y, dt).catch((err: Error) => {
          warning = `Could not load the list of previous reports (${dt}): ${err.message}`;
          reportClientError('PdfExport', `getGeneratedFilesForYear failed for ${dt} ${y}`, err, { year: y, docType: dt });
          return [] as any[];
        })
      )
    )
      .then((lists: any[][]) => {
        const merged = ([] as any[]).concat(...lists).sort((a, b) => (b.generated_at || '').localeCompare(a.generated_at || ''));
        previous = merged;
      })
      .finally(() => (previousLoading = false));
  }

  // React: useEffect on [year].
  let lastYear = '__init__';
  $effect(() => {
    if (year === lastYear) return;
    lastYear = year;
    loadPrevious(year);
  });

  async function generate() {
    if (!year) { alert('Please select a year'); return; }
    generating = true;
    error = '';
    warning = '';
    try {
      const mode = language;
      const docType = DOC_TYPE_FOR_MODE[mode];

      // The browser no longer fills the report .docx. The Worker resolves the template and
      // Render fills it with the placeholders we build below (+QR) then converts.
      const [home, loansData, expenses, users, lists]: any[] = await Promise.all([
        api.getHome(year),
        api.getLoans(year),
        api.getExpenses(year),
        api.getUsers(),
        mode !== 'en' ? api.getAllDropdownLists() : Promise.resolve(null)
      ]);

      const userMap: Record<string, any> = {};
      (users || []).forEach((u: any) => (userMap[u.ID] = u));
      const nameOf = (id: string) => (userMap[id] && userMap[id].Name) || id || 'Unknown';
      const nameHiOf = (id: string) => (userMap[id] && userMap[id]['Name (Hindi)']) || '';
      const categoryHiOf = (val: string) => {
        if (!lists) return '';
        const row = (lists['Category'] || []).find((r: any) => r['English Value'] === val);
        return row ? row['Hindi Label'] : '';
      };
      const statusHiOf = (val: string) => {
        if (!lists) return '';
        const row = (lists['Loan Status'] || []).find((r: any) => r['English Value'] === val);
        return row ? row['Hindi Label'] : '';
      };
      const parseAmt = (v: unknown) => parseFloat((v || '').toString().replace(/[^0-9.-]+/g, '')) || 0;

      const loans = (loansData.loans || []).map((l: any) => ({
        LOAN_TAKER: nameOf(l.Name),
        LOAN_TAKER_HI: nameHiOf(l.Name),
        AMOUNT: amountText(parseAmt(l.Amount)),
        INTEREST: (l['Intrest Rate'] || l['Interest Rate'] || '0') + '%',
        TENURE: l.Tenure || '-',
        STATUS: l.Status || 'Active',
        STATUS_HI: statusHiOf(l.Status || 'Active')
      }));

      const guarantors = (loansData.guarantors || []).map((g: any) => ({
        GUARANTOR_NAME: nameOf(g.Guarantor),
        GUARANTOR_NAME_HI: nameHiOf(g.Guarantor),
        LOAN_TAKER: nameOf(g.Loaner),
        LOAN_TAKER_HI: nameHiOf(g.Loaner),
        YEAR: g.Year || year
      }));

      const contributors = (home.collections || []).map((c: any, i: number) => {
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
          AMOUNT: (isMoneyType || isResellRow) ? amountText(parseAmt(c.Amount)) : (c.Detail || '-')
        };
      });

      const expenseRows = (expenses || []).map((e: any, i: number) => ({
        SL_NO: i + 1,
        DESCRIPTION: e.Discription || '-',
        DESCRIPTION_HI: e['Discription (Hindi)'] || '',
        CATEGORY: e.Category || '-',
        CATEGORY_HI: categoryHiOf(e.Category),
        AMOUNT: amountText(parseAmt(e.Amount))
      }));

      const placeholders = {
        YEAR: year,
        TOTAL_COLLECTION: amountText(home.totCol),
        PAST_RETURN: amountText(home.pastRet),
        TOTAL_EXPENSES: amountText(home.totExp),
        TOTAL_BUDGET: amountText(home.totBudget),
        SURPLUS: amountText(home.surplus),
        GENERATED_AT: new Date().toLocaleString('en-IN'),
        loans, guarantors, contributors, expenses: expenseRows
      };

      const recordId = `${docType}-${year}`;
      const fileName = `Chhath-Puja-Report-${year}${mode !== 'en' ? '-' + mode : ''}.docx`;
      const res: any = await api.convertDocxToPdfBulk(docType, year, recordId, placeholders, fileName, true);

      const missing = res && res.report && Array.isArray(res.report.missingTags) ? res.report.missingTags : [];
      if (missing.length) {
        warning = `These placeholders in the report template could not be resolved (they will be blank): ${[...new Set(missing)].join(', ')}`;
        reportClientError('PdfExport', 'Report template had unresolved placeholders', undefined,
          { docType, year, missingTags: [...new Set(missing)] });
      }

      if (res && res.indexFailed) {
        warning = res.error || 'The report PDF was generated but not indexed.';
        reportClientError('PdfExport', `Report generated but NOT indexed: ${recordId}`, undefined,
          { docType, year, recordId, publicLink: res.publicLink });
      }

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
      error = (err as Error).message || 'An error occurred while generating the PDF';
      reportClientError('PdfExport', `Report generation failed for ${year}`, err as Error, { year, language });
    } finally {
      generating = false;
    }
  }
</script>

<h2 style="margin-bottom:15px;">PDF Export</h2>
{#if error}<div role="alert" class="error-banner">{error}</div>{/if}
{#if warning}
  <div style="background:#FEF3C7; color:#92400E; border-radius:8px; padding:8px 12px; font-size:0.8rem; margin-bottom:10px;">
    ⚠️ {warning}
  </div>
{/if}

<div class="glass-card" style="padding:20px;">
  <div class="form-group">
    <label for={`${uid}-f1`}>Year</label>
    <select id={`${uid}-f1`} bind:value={year}>
      {#each years || [] as y (y)}<option value={y}>{y}</option>{/each}
    </select>
  </div>

  <div class="form-group">
    <span id={`${uid}-lang-label`} class="form-label">Language</span>
    <div role="group" aria-labelledby={`${uid}-lang-label`} style="display:flex; gap:8px;">
      {#each [['en', 'English'], ['hi', 'Hindi'], ['both', 'Both']] as [val, lbl] (val)}
        <button
          type="button"
          class="nav-btn"
          style="flex:1; border:1px solid var(--primary-saffron); background:{language === val ? 'var(--primary-saffron)' : '#fff'}; color:{language === val ? '#fff' : 'var(--primary-saffron)'};"
          onclick={() => (language = val)}
        >
          {lbl}
        </button>
      {/each}
    </div>
  </div>

  <button class="btn-submit" onclick={generate} disabled={generating || !year}>
    {generating ? 'Generating...' : 'Generate PDF'}
  </button>
</div>

<div class="glass-card" style="padding:20px; margin-top:15px;">
  <h3 style="margin-bottom:10px; font-size:1rem;">Already Generated — Year {year || '-'}</h3>
  {#if previousLoading}
    <div style="color:var(--text-muted); font-size:0.85rem;">Loading...</div>
  {:else if !previous || previous.length === 0}
    <div style="color:var(--text-muted); font-size:0.85rem;">No reports generated yet for this year.</div>
  {:else}
    <div style="display:flex; flex-direction:column; gap:8px;">
      {#each previous as f, i (f.id || i)}
        <a
          href={f.public_link}
          target="_blank"
          rel="noreferrer"
          style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border-radius:8px; background:#fafafa; border:1px solid #eee; text-decoration:none; color:inherit; font-size:0.85rem;"
        >
          <span>{MODE_LABEL_FOR_DOC_TYPE[f.doc_type] || f.doc_type} — {f.file_name}</span>
          <span style="color:var(--text-muted); font-size:0.75rem;">
            {f.generated_at ? new Date(f.generated_at).toLocaleString('en-IN') : ''}
          </span>
        </a>
      {/each}
    </div>
  {/if}
</div>
