const fmt = (n) => new Intl.NumberFormat('en-IN', {style:'currency', currency:'INR', maximumFractionDigits:0}).format(n||0);
const parseAmt = (v) => parseFloat((v||'').toString().replace(/[^0-9.-]+/g,"")) || 0;

// ---- HTML escaping ----
// This file builds almost all of its DOM with innerHTML string templates. Values
// that originate from an authenticated author (popup slide text, link URL/label)
// must be escaped before being interpolated, otherwise the mgmt portal becomes an
// injection vector into the public site.
function escapeHtml(v) {
  return (v === undefined || v === null ? '' : v.toString())
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(v) { return escapeHtml(v); }
// Only http(s) — blocks javascript:, data:, vbscript: in href/src.
function safeUrl(v) {
  const raw = (v === undefined || v === null ? '' : v.toString()).trim();
  return /^https?:\/\//i.test(raw) ? raw : '';
}

// Popup images saved before the uploadPopupImage fix hold the Drive VIEWER page
// URL (.../file/d/<id>/view), which is an HTML document and renders as a broken
// image. Rewrite it to the direct image URL.
// This file is not bundled (plain <script>), so it cannot import mgmt's
// driveUrl.js — the logic is copied from there, and both must be changed together.
//
// `uc?export=view` does a 303 redirect to drive.usercontent.google.com, which
// returns `cross-origin-resource-policy: same-site` — i.e. the browser BLOCKS it
// from being embedded by another site, and the popup image silently appears blank.
// `lh3.googleusercontent.com` is Google's image CDN (ACAO *, no CORP).
function driveFileId(url) {
  const s = (url === undefined || url === null) ? '' : url.toString();
  if (!s) return null;
  var pats = [
    /\/file\/d\/([A-Za-z0-9_-]{10,})/,
    /lh3\.googleusercontent\.com\/d\/([A-Za-z0-9_-]{10,})/,
    /[?&]id=([A-Za-z0-9_-]{10,})/,
    /\/d\/([A-Za-z0-9_-]{10,})/,
  ];
  for (var i = 0; i < pats.length; i++) {
    var m = pats[i].exec(s);
    if (m) return m[1];
  }
  return null;
}
function driveImageUrl(url) {
  var id = driveFileId(url);
  return id ? 'https://lh3.googleusercontent.com/d/' + id + '=w1600' : url;
}
function driveImageFallbackUrl(url) {
  var id = driveFileId(url);
  return id ? 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1600' : '';
}

// ---- Error reporting (this file previously had NONE) ----
//
// There was no window.onerror, no unhandledrejection and no reporting anywhere in
// the public portal, and the Public Worker wasn't even bound to DB_LOGS. So when
// the public site broke — a failed data load, a JS crash, a missing element — the
// committee had no way whatsoever to find out. This closes that half of the gap;
// the Worker side now accepts `?action=logError` (POST) and writes to error_log.
//
// Set by init() once the Worker base URL is known.
let ERROR_LOG_URL = null;
const reportedMessages = new Set(); // client-side de-dup so a render loop can't spam

function reportPublicError(message, err, extra) {
  try {
    const msg = (message || '').toString().slice(0, 500);
    if (reportedMessages.has(msg)) return;
    reportedMessages.add(msg);
    if (!ERROR_LOG_URL) return; // nothing we can do before init() runs
    fetch(ERROR_LOG_URL, {
      method: 'POST',
      body: JSON.stringify({
        page: location.pathname + location.search,
        message: msg,
        stack: (err && err.stack) ? err.stack.toString().slice(0, 2000) : '',
        context: JSON.stringify(Object.assign({ ua: navigator.userAgent.slice(0, 150) }, extra || {})).slice(0, 500),
      }),
    }).catch(() => {}); // last resort — the network is what failed
  } catch (e) { /* never let reporting break the page */ }
}

window.addEventListener('error', (e) => {
  reportPublicError(e.message, e.error, { filename: e.filename, lineno: e.lineno });
});
window.addEventListener('unhandledrejection', (e) => {
  const err = e.reason;
  reportPublicError('Unhandled rejection: ' + ((err && err.message) || String(err)), err, {});
});

const app = {
  data: null,
  userMap: {},
  dcVillage: 'All',
  dcSelectedId: null,

  init: () => {
    // Was a hardcoded Apps Script /exec URL — now the deployed chhath-public-api
    // Worker instead (see Public/backend). ⚠️ REPLACE with your real Worker URL
    // after `wrangler deploy` — this is the one genuine frontend code change in
    // the whole migration (Public/frontend has no build step / env vars, unlike
    // mgmt/frontend, so this can't be an env var — see FRONTEND_DIFF_NOTES.md).
    // Points at the CUSTOM DOMAIN (not the *.workers.dev URL) on purpose: Cloudflare
    // Cache Rules only apply on the zone's custom domain, and they let the big
    // version-keyed payloads (portalData/activePopups with ?v=) be served straight
    // from the edge cache WITHOUT invoking the Worker — which keeps the daily
    // Workers-request quota from being burned during a festival traffic spike.
    const BASE_API_URL = "https://chhath-public-worker.shaharpura.com/";
    ERROR_LOG_URL = BASE_API_URL + "?action=logError";

    // Fetch the current data version FIRST (one tiny, always-fresh call), then
    // request the big payloads with `?v=<version>`. Those version-keyed URLs are
    // served from Cloudflare's edge cache (immutable), so on a plain refresh the
    // Worker/DB are not touched for portalData/activePopups — only this small
    // version ping reaches the Worker. When mgmt data changes the version bumps,
    // the URL changes, and the fresh URL is fetched once (then cached again).
    //
    // If the version call fails for any reason, we fall back to the un-versioned
    // URL, which the Worker still serves via its ETag path — so nothing breaks.
    fetch(BASE_API_URL + "?action=dataVersion")
      .then(r => (r.ok ? r.json() : null))
      .then(vr => (vr && vr.v != null ? vr.v.toString() : ''))
      .catch(() => '')
      .then(version => {
        const vq = version ? ("&v=" + encodeURIComponent(version)) : "";
        const API_URL = BASE_API_URL + "?action=portalData" + vq;

        // fire-and-forget, independent of portalData — a popup failure should
        // never block the rest of the site. Same version so popups are edge-cached too.
        app.loadPopup(BASE_API_URL, version);

        return fetch(API_URL);
      })
      .then(response => {
        if (!response.ok) throw new Error('portalData HTTP ' + response.status);
        return response.json();
      })
      .then(res => {
        app.data = res;
        app.data.generatedFiles = app.data.generatedFiles || [];
        app.data.loanConsents = app.data.loanConsents || [];

        (res.users || []).forEach(u => {
          if (u.ID) app.userMap[u.ID.toString().trim()] = u;
        });

        app.getUser = (id) => {
          const uid = (id || '').toString().trim();
          return app.userMap[uid] || {
            Name: 'Unknown User',
            Village: '-',
            Designation: '-',
            Mobile: '-'
          };
        };

        let years = new Set();

        res.collections.forEach(r => {
          if (r.Year) years.add(parseInt(r.Year));
        });

        res.loans.forEach(r => {
          if (r.Year) years.add(parseInt(r.Year));
        });

        res.committee.forEach(r => {
          if (r.Year) years.add(parseInt(r.Year));
        });

        let yearArr = Array.from(years).sort((a, b) => b - a);

        if (yearArr.length === 0)
          yearArr = [new Date().getFullYear()];

        const sel = document.getElementById('global-year');
        sel.innerHTML = `<option value="All">All Years</option>` + yearArr.map(y => `<option value="${y}">${y}</option>`).join('');
        sel.value = yearArr[0];

        app.refreshData();
        app.renderDownloadVillages();
        app.checkRecordVerification();
        // Restore the section from the URL hash on load, so a REFRESH keeps the
        // user on the section they were viewing instead of snapping to Home.
        // Skipped when a QR ?record= is present (that opens the 'verify' view via
        // checkRecordVerification above and must win).
        app.restoreViewFromHash();

        document.getElementById('loader').style.display = 'none';
      })
      .catch(error => {
        console.error(error);
        // Was console.error + a dead-end banner, never reported anywhere.
        reportPublicError('Public portal data load failed: ' + (error && error.message), error, {});
        document.getElementById('loader').innerHTML = `
            <h2>Failed To Load Data</h2>
            <p>Please Try Again Later</p>
            <button onclick="location.reload()" style="margin-top:12px;padding:8px 18px;border:none;border-radius:8px;cursor:pointer;">Retry</button>
          `;
      });
  },

  // ---- Popup (mgmt Popup Management, popups tagged role "Public") ----
  // Fetched fresh on EVERY page load/refresh (no localStorage dismissal
  // memory) — matches the requirement that it should show again each time
  // the page is refreshed, not just once per browser.
  popupSlides: [],
  popupIndex: 0,

  loadPopup: (baseApiUrl, version) => {
    // Version-keyed URL so activePopups is served from the edge cache too; falls
    // back to the un-versioned (ETag) URL if no version was resolved.
    const vq = version ? ("&v=" + encodeURIComponent(version)) : "";
    fetch(baseApiUrl + "?action=activePopups" + vq)
      .then(r => r.json())
      .then(popups => {
        if (!Array.isArray(popups) || !popups.length) return;
        // Only the first eligible popup is shown per load — if more than one
        // is tagged "Public" and active at once, Superadmin should stagger
        // start_at/end_at rather than stacking multiple overlays.
        // Only the FIRST eligible popup is rendered. mgmt's "Preview as Public"
        // now reports the ones that won't be shown, so this is no longer silent.
        const popup = popups[0];
        if (!popup.slides || !popup.slides.length) return;
        app.popupSlides = popup.slides;
        app.popupIndex = 0;
        app.renderPopupSlide();
        document.getElementById('popup-overlay').style.display = 'flex';
      })
      // The popup is non-critical, so we still never surface an error to the
      // visitor — but it IS reported now, instead of being discarded entirely.
      .catch(err => reportPublicError('Public popup load failed: ' + (err && err.message), err, {}));
  },

  renderPopupSlide: () => {
    const slide = app.popupSlides[app.popupIndex];
    if (!slide) return;
    const content = document.getElementById('popup-slide-content');
    // Popup text/links are authored by an Admin in the mgmt portal, but they are
    // rendered on the PUBLIC site — so an admin account (or anyone who got hold of
    // one) could previously inject arbitrary HTML/script here, and `link_url`
    // accepted `javascript:`. All four values are escaped now, and the link scheme
    // is restricted to http/https.
    content.innerHTML = `
      ${slide.image_url && safeUrl(driveImageUrl(slide.image_url)) ? `<img class="popup-slide-img" src="${escapeAttr(driveImageUrl(slide.image_url))}" alt="" data-fb="${escapeAttr(driveImageFallbackUrl(slide.image_url))}" onerror="if(this.dataset.fb&&this.dataset.fbTried!=='1'){this.dataset.fbTried='1';this.src=this.dataset.fb;}else{this.style.display='none';}">` : ''}
      ${slide.text ? `<div class="popup-slide-text">${escapeHtml(slide.text)}</div>` : ''}
      ${slide.link_url && safeUrl(slide.link_url) ? `<a class="popup-slide-link" href="${escapeAttr(slide.link_url)}" target="_blank" rel="noreferrer">${escapeHtml(slide.link_text || 'Learn more')}</a>` : ''}
    `;
    const navEl = document.getElementById('popup-slide-nav');
    if (app.popupSlides.length > 1) {
      navEl.style.display = 'flex';
      document.getElementById('popup-slide-dots').textContent = `${app.popupIndex + 1} / ${app.popupSlides.length}`;
    } else {
      navEl.style.display = 'none';
    }
  },

  popupPrevSlide: () => {
    app.popupIndex = (app.popupIndex - 1 + app.popupSlides.length) % app.popupSlides.length;
    app.renderPopupSlide();
  },

  popupNextSlide: () => {
    app.popupIndex = (app.popupIndex + 1) % app.popupSlides.length;
    app.renderPopupSlide();
  },

  closePopup: () => {
    document.getElementById('popup-overlay').style.display = 'none';
  },

  // On load, if the URL hash names a valid section (e.g. "#loans"), open it — but
  // NOT when a QR ?record= is present (that already opened the 'verify' view).
  // An unknown/empty hash leaves the default Home view as-is.
  restoreViewFromHash: () => {
    if (new URLSearchParams(window.location.search).get('record')) return; // verify view wins
    const id = (window.location.hash || '').replace(/^#/, '').trim();
    const allowed = ['home', 'expenses', 'loans', 'committee', 'downloads'];
    if (id && allowed.includes(id)) app.nav(id);
  },

  nav: (viewId) => {
    const target = document.getElementById('view-' + viewId);
    if (!target) return; // unknown view id — do nothing (guards a bad hash)
    document.querySelectorAll('.page-view').forEach(e => e.classList.remove('active-view'));
    target.classList.add('active-view');
    document.querySelectorAll('.nav-btn').forEach(e => e.classList.remove('active'));
    document.querySelectorAll(`.nav-btn[data-target="${viewId}"]`).forEach(e => e.classList.add('active'));
    // Remember the current section in the URL hash so a REFRESH (or a shared
    // link) stays on this section instead of snapping back to Home. Not written
    // for the special 'verify' view (that is driven by ?record= in the query, not
    // a user-navigable tab).
    if (viewId !== 'verify') {
      try { history.replaceState(null, '', '#' + viewId); } catch (e) { /* ignore */ }
    }
    window.scrollTo(0,0);
    // Same reasoning as mgmt/frontend's App.jsx tracker — this site swaps
    // sections via JS, no real URL change, so GTM's default trigger only ever
    // sees the first load. Push a matching `pageview` event per section.
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'pageview', page: '/' + viewId });
  },

  // Reached when a document's QR code is scanned — the QR encodes
  // ?record=<docType>-<year>-<ref> (see mgmt/frontend/src/qrCode.js). Shows a
  // verification banner confirming the document was actually generated by the
  // committee (matched against GENERATED_FILES), plus the underlying record's
  // details where available.
  checkRecordVerification: () => {
    const recordId = new URLSearchParams(window.location.search).get('record');
    if (!recordId) return;

    const content = document.getElementById('record-verify-content');
    if (!content) return;

    const parts = recordId.split('-');
    if (parts.length < 3) return;
    const docType = parts[0];
    const year = parts[1];
    const ref = parts.slice(2).join('-');

    const genFile = (app.data.generatedFiles || []).find(g => (g.record_id || '').toString().trim() === recordId);
    const docLabel = {
      receipt: 'Receipt', certificate: 'Certificate', samaan: 'Material Receipt',
      consent_loaner: 'Loan Consent (Loaner)', consent_guarantor: 'Loan Consent (Guarantor)',
    }[docType] || docType;

    let detailsHtml = '';
    if (['receipt', 'certificate', 'samaan'].includes(docType)) {
      const entry = (app.data.collections || []).find(c =>
        (c.__rowIndex || '').toString() === ref && parseInt(c.Year) === parseInt(year));
      if (entry) {
        // A resold-item receipt has no contributor — show the item, not a user.
        if (app.isResellRow(entry)) {
          detailsHtml = `
            <div style="margin-top:8px; font-size:0.9rem;">
              <div><strong>♻️ Resell: ${escapeHtml(entry.Detail || '-')}</strong></div>
              ${entry.Amount ? `<div>Amount: ${fmt(entry.Amount)}</div>` : ''}
            </div>`;
        } else {
          const u = app.getUser(entry.Name);
          detailsHtml = `
            <div style="margin-top:8px; font-size:0.9rem;">
              <div><strong>${escapeHtml(u.Name)}</strong>${u.Village && u.Village !== '-' ? ' — ' + escapeHtml(u.Village) : ''}</div>
              ${entry.Amount ? `<div>Amount: ${fmt(entry.Amount)}</div>` : ''}
              ${entry.Detail ? `<div>Detail: ${escapeHtml(entry.Detail)}</div>` : ''}
            </div>`;
        }
      }
    }

    content.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="material-icons-round" style="color:${genFile ? 'var(--success)' : 'var(--danger)'};">${genFile ? 'verified' : 'error_outline'}</span>
        <strong>${genFile ? 'Verified Record' : 'Record Not Found'}</strong>
      </div>
      <div style="font-size:0.85rem; color:var(--text-muted); margin-top:4px;">${escapeHtml(docLabel)} — Year ${escapeHtml(year)}</div>
      ${genFile ? detailsHtml : `<p style="font-size:0.85rem; margin-top:8px;">This record could not be verified against the committee's records. If you believe this is an error, please contact the committee.</p>`}
    `;

    app.nav('verify');
  },

  refreshData: () => {
    const rawYear = document.getElementById('global-year').value;
    const isAll = rawYear === 'All';
    const tYear = isAll ? 'All' : parseInt(rawYear);

    document.getElementById('disp-year-title').innerText = isAll ? 'Lifetime Budget Overview' : `${tYear} Budget Overview`;
    document.getElementById('lbl-past-loan').innerText = isAll ? '(+) Lifetime Loans Returned (with Int.)' : '(+) Past Loan Returned (with Int.)';
    document.getElementById('lbl-cur-col').innerText = isAll ? '(+) Lifetime Collections' : '(+) Current Year Collection';

    const curCol = isAll ? app.data.collections : app.data.collections.filter(c => parseInt(c.Year) === tYear);
    const totCol = curCol.reduce((s, c) => s + parseAmt(c.Amount), 0);

    let pastRet = 0;
    const prevLoans = isAll ? app.data.loans : app.data.loans.filter(l => parseInt(l.Year) === (tYear - 1));
    
    prevLoans.forEach(l => {
      let principal = parseAmt(l.Amount);
      let intRatePerMonth = parseAmt(l['Intrest Rate'] || l['Interest Rate']);
      let tenureMonths = parseAmt(l.Tenure);
      let totalInterest = principal * (intRatePerMonth / 100) * tenureMonths;
      pastRet += principal + totalInterest; 
    });
    const totBudget = totCol + pastRet;

    const curExp = isAll ? app.data.expenses : app.data.expenses.filter(e => parseInt(e.Year) === tYear);
    const totExp = curExp.reduce((s, e) => s + parseAmt(e.Amount), 0);
    const surplus = totBudget - totExp;

    document.getElementById('h-past-loan').innerText = fmt(pastRet);
    document.getElementById('h-cur-col').innerText = '+' + fmt(totCol);
    document.getElementById('h-tot-bud').innerText = fmt(totBudget);
    document.getElementById('h-tot-exp').innerText = fmt(totExp);
    document.getElementById('h-surplus').innerText = fmt(surplus);
    
    app.currentData = { col: curCol, exp: curExp, tYear: tYear, isAll: isAll };

    app.renderHomeList();
    app.renderExpenses();
    app.renderLoans();
    app.renderCommittee();
  },

  // A collection row is a "Resell" (committee resold a donated item) when Is Resell
  // is truthy. Such a row has NO contributor person — its Name field does not point
  // at a USER — so we must show the resold item (Detail), NOT run it through
  // getUser() (which would render "Unknown User"). Mirrors mgmt Home.jsx.
  isResellRow: (r) => r && (r['Is Resell'] === true || r['Is Resell'] === 'TRUE' || (typeof r['Is Resell'] === 'string' && r['Is Resell'].trim().toLowerCase() === 'true')),

  renderHomeList: () => {
    const s = document.getElementById('home-search').value.toLowerCase();
    const html = app.currentData.col
      .filter(r => {
         // Resell rows are searchable by their item name (Detail); everyone else
         // by contributor name. Previously resell rows matched only the literal
         // string "unknown user".
         if (app.isResellRow(r)) return (r.Detail || '').toLowerCase().includes(s);
         const u = app.getUser(r.ID || r.Name);
         return (u.Name || '').toLowerCase().includes(s);
      })
      .map(r => {
         const cType = (r['Contribution Type'] || 1).toString();
         const isMoney = cType === '1';
         const yrTag = app.currentData.isAll ? `<span class="yr-tag">[${escapeHtml(r.Year)}]</span>` : '';

         // ---- Resell row: an item that was resold, not a person's contribution ----
         if (app.isResellRow(r)) {
            return `<div class="data-row">
               <div>
                 <strong style="display:block;">♻️ Resell: ${escapeHtml(r.Detail || '-')} ${yrTag}</strong>
                 <span style="font-size:0.8rem; color:var(--text-muted);">Resold item</span>
               </div>
               <strong style="color:var(--success);">+${fmt(r.Amount)}</strong>
            </div>`;
         }

         const u = app.getUser(r.ID || r.Name);
         // Material/Service contributions do not have a monetary amount, since no
         // cash is involved — so instead of the amount, we show what was given /
         // what work was done (Detail).
         const rightSide = isMoney
            ? `<strong style="color:var(--success);">+${fmt(r.Amount)}</strong>`
            : `<div style="text-align:right;">
                 <span class="badge" style="background:#DBEAFE; color:#1E40AF;">${cType === '2' ? 'Material' : 'Service'}</span>
                 ${r.Detail ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px; max-width:150px;">${escapeHtml(r.Detail)}</div>` : ''}
               </div>`;

         return `<div class="data-row">
            <div>
              <strong style="display:block;">${escapeHtml(u.Name)} (${escapeHtml(u.Designation || '-')}) ${yrTag}</strong>
              <span style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(u.Village || r.Village || '-')} | ${escapeHtml(u["Father's Name"] || '-')}</span>
            </div>
            
            ${rightSide}
         </div>`;
      }).join('');
    document.getElementById('home-col-list').innerHTML = html || '<div style="text-align:center; padding:20px;">No records found.</div>';
  },

  renderExpenses: () => {
    const html = app.currentData.exp.map(r => {
      // The column is misspelled "Discription" in the schema; some payloads use
      // "Description". Fall back across both (and to a dash) so the name is never
      // blank, and escape it.
      const desc = r.Discription || r.Description || '-';
      const yrTag = app.currentData.isAll ? `<span class="yr-tag">[${escapeHtml(r.Year)}]</span>` : '';
      return `<div class="data-row">
        <div><strong style="display:block; max-width:200px;">${escapeHtml(desc)} ${yrTag}</strong></div>
        <strong style="color:var(--danger);">-${fmt(r.Amount)}</strong>
      </div>`;
    }).join('');
    document.getElementById('exp-list').innerHTML = html || '<div style="text-align:center; padding:20px;">No expenses recorded.</div>';
  },

  renderLoans: () => {
    const isAll = app.currentData.isAll;
    const targetLoans = isAll ? app.data.loans : app.data.loans.filter(l => parseInt(l.Year) === app.currentData.tYear);
    
    if(targetLoans.length === 0) {
      document.getElementById('loans-dynamic-list').innerHTML = '<div class="glass-card" style="text-align:center; padding: 20px;">Not Distributed Yet</div>';
      return;
    }

    let finalHtml = '';
    targetLoans.forEach(curLoan => {
      const lYear = curLoan.Year;
      const receiverId = curLoan.ID || curLoan.Name || curLoan.Receiver;
      const uReceiver = app.getUser(receiverId);
      const loanId = (curLoan['Loan ID'] || '').toString().trim();

      // If a Loan ID is available, match guarantors using it (a single user can have
      // multiple loans in the same year — matching on Year+Loaner alone caused their
      // guarantors to mix/repeat). For older records without a Loan ID, fall back
      // to the Year+Loaner match.
      const guars = loanId
        ? app.data.guarantors.filter(g => (g['Loan ID'] || '').toString().trim() === loanId)
        : app.data.guarantors.filter(g => parseInt(g.Year) === parseInt(lYear) && (g.Loaner === receiverId || g.ID === receiverId || g.Name === receiverId));

      const isContributor = (id) => app.data.collections.some(c => parseInt(c.Year) === parseInt(lYear) && (c.ID === id || c.Name === id));
      const isCommittee = (id) => app.data.committee.some(c => parseInt(c.Year) === parseInt(lYear) && (c.ID === id || c.Name === id));

      let gHtml = '';
      guars.forEach(row => {
         const gid = row.Guarantor || row['Guarantor ID'] || row['Guarantor 1'];
         const uGuarantor = app.getUser(gid); 
         
         const isCont = isContributor(gid);
         const isCom = isCommittee(gid);

         // The actual committee rule (backend saveLoanTransaction) is only:
         // "a Committee Member cannot be a guarantor". There is NO requirement
         // that a guarantor also be a contributor that year — so the old badge,
         // which flagged every non-contributor guarantor as "Rule Violation",
         // produced false red flags for perfectly valid guarantors. Now only an
         // actual committee-member guarantor is a violation.
         const statusBadge = isCom
            ? '<span class="badge badge-warn">Rule Violation (Committee Member)</span>'
            : '<span class="badge badge-ok">Valid Guarantor</span>';

         gHtml += `<div class="glass-card" style="padding:15px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
              <strong style="min-width:0; overflow-wrap:anywhere;">${escapeHtml(uGuarantor.Name)}</strong>
              <span style="flex-shrink:0;">${statusBadge}</span>
            </div>
           
            <div style="font-size:0.75rem; color:gray; margin-top:5px;">
              Village: ${escapeHtml(uGuarantor.Village || '-')} | Contributor: ${isCont ? 'Yes':'No'} | Committee: ${isCom ? 'Yes':'No'}
            </div>
         </div>`;
      });

      finalHtml += `
      <div class="glass-card" style="background: #FFFBEB; border-color: #FCD34D;">
        <h3 style="color: #92400E; margin-bottom: 5px;">Surplus Loan ${isAll ? `(${lYear})` : ''}</h3>
        <p style="font-size: 0.85rem; color: #B45309; margin-bottom: 15px;">Given to a single verified contributor.</p>
        
        <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #FDE68A; margin-bottom: 15px;">
          <div style="font-size: 0.8rem; color: var(--text-muted);">Receiver Name</div>
          <div style="font-size: 1.3rem; font-weight: bold; color: var(--text-main); margin-bottom: 10px;">${escapeHtml(uReceiver.Name)}</div>
          <div class="grid-3">
            <div><span style="font-size:0.75rem;">Amount</span><br><strong style="font-size: 0.95rem;">${fmt(curLoan.Amount)}</strong></div>
            <div><span style="font-size:0.75rem;">Int. Rate</span><br><strong style="font-size: 0.95rem;">${escapeHtml(curLoan['Intrest Rate'] || curLoan['Interest Rate'] || '0')}%</strong></div>
            <div><span style="font-size:0.75rem;">Tenure</span><br><strong style="font-size: 0.95rem;">${escapeHtml(curLoan.Tenure || '0')} Mo</strong></div>
          </div>
        </div>
        
        <h4 style="margin-bottom: 10px; color: #92400E;">Verified Guarantors</h4>
        ${gHtml || '<p>No guarantors on record.</p>'}
      </div>`;
    });

    document.getElementById('loans-dynamic-list').innerHTML = finalHtml;
  },

  /* UPDATED COMMITTEE RENDER FUNCTION */
  renderCommittee: () => {
    const isAll = app.currentData.isAll;
    const targetCom = isAll ? app.data.committee : app.data.committee.filter(r => parseInt(r.Year) === app.currentData.tYear);
    const html = targetCom.map(r => {
       const u = app.getUser(r.ID || r.Name); 
       // `u.Name[0]` threw a TypeError (blanking the WHOLE list) if a committee
       // member's Name was ever undefined. Coerce to a string first.
       const nameStr = (u.Name || '').toString();
       const initial = (nameStr.charAt(0) || '?').toUpperCase();

       // Naya Professional ID Card Layout
       return `
       <div class="glass-card" style="padding:15px; margin-bottom:12px; display:flex; gap:15px; align-items:center;">
          <div style="width:50px;height:50px;border-radius:50%;background:var(--saffron-light);color:var(--primary-saffron);display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:bold;flex-shrink:0;">
             ${escapeHtml(initial)}
          </div>
          <div style="flex-grow:1;">
             <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                <strong style="font-size:1.05rem; min-width:0; overflow-wrap:anywhere;">${escapeHtml(nameStr || '-')}</strong>
                <span class="badge" style="background:#f3f4f6; color:#374151; flex-shrink:0;">${escapeHtml(r.Year)}</span>
             </div>
             <div style="font-size:0.85rem; color:var(--primary-saffron); font-weight:600; margin-bottom:4px;">
                ${escapeHtml(r.Role || u.Designation || 'Member')}
             </div>
             <div style="font-size:0.8rem; color:var(--text-muted); display:flex; flex-wrap:wrap; gap:10px;">
                <span style="display:flex; align-items:center; gap:3px;"><span class="material-icons-round" style="font-size:12px;">call</span> ${escapeHtml(u.Mobile || 'N/A')}</span>
                <span style="display:flex; align-items:center; gap:3px;"><span class="material-icons-round" style="font-size:12px;">place</span> ${escapeHtml(u.Village || 'N/A')}</span>
             </div>
          </div>
       </div>`;
    }).join('');
    document.getElementById('com-list').innerHTML = html || '<div style="text-align:center; padding:20px;">No committee on record.</div>';
  },

  /* ================= DOWNLOAD CENTER ================= */

  renderDownloadVillages: () => {
    const villages = new Set();
    (app.data.users || []).forEach(u => { if (u.Village) villages.add(u.Village.trim()); });
    const arr = Array.from(villages).sort((a, b) => a.localeCompare(b));
    const sel = document.getElementById('dc-village');
    sel.innerHTML = `<option value="">-- Select Village --</option>` + arr.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join('');
    sel.value = '';
  },

  onDcVillageChange: () => {
    const village = document.getElementById('dc-village').value;
    const nameInput = document.getElementById('dc-search');
    const searchBtn = document.getElementById('dc-search-btn');

    document.getElementById('dc-people-wrap').innerHTML = '';
    document.getElementById('dc-docs-wrap').innerHTML = '';
    app.dcSelectedId = null;

    if (village) {
      nameInput.disabled = false;
      nameInput.placeholder = 'Search by Name...';
      searchBtn.disabled = false;
      searchBtn.style.opacity = '1';
    } else {
      nameInput.disabled = true;
      nameInput.value = '';
      nameInput.placeholder = 'Please select a village first';
      searchBtn.disabled = true;
      searchBtn.style.opacity = '0.5';
    }
  },

  searchDownloadPeople: () => {
    const village = document.getElementById('dc-village').value;
    if (!village) { alert('Please select a village first'); return; }
    const q = document.getElementById('dc-search').value.toLowerCase().trim();

    app.dcSelectedId = null;
    document.getElementById('dc-docs-wrap').innerHTML = '';

    const list = (app.data.users || [])
      .filter(u => (u.Village || '').trim() === village)
      .filter(u => !q || (u.Name || '').toLowerCase().includes(q))
      .slice(0, 50);

    const html = list.map(u => {
      // ID goes into a JS string inside an onclick attribute — escape for BOTH
      // the JS-string context and the HTML-attribute context. Names/villages are
      // HTML-escaped like everywhere else.
      const idJs = (u.ID || '').toString().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `
      <div class="data-row" style="cursor:pointer;" onclick="app.selectDownloadPerson('${escapeAttr(idJs)}')">
        <div>
          <strong style="display:block;">${escapeHtml(u.Name)}</strong>
          <span style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(u.Village || '-')}</span>
        </div>
        <span class="material-icons-round" style="color:var(--primary-saffron);">chevron_right</span>
      </div>`;
    }).join('');

    document.getElementById('dc-people-wrap').innerHTML = `<div class="glass-card" id="dc-people-list">${html || '<div style="text-align:center; padding:20px;">No matches found.</div>'}</div>`;
  },

  selectDownloadPerson: (id) => {
    app.dcSelectedId = id;
    document.getElementById('dc-people-wrap').style.display = 'none';
    app.renderDownloadDocs();
    document.getElementById('dc-docs-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  backToDownloadList: () => {
    app.dcSelectedId = null;
    document.getElementById('dc-docs-wrap').innerHTML = '';
    document.getElementById('dc-people-wrap').style.display = '';
  },

  buildPersonDownloads: (id) => {
    const isFileGenerated = (docType, year, recordId) => {
      return (app.data.generatedFiles || []).find(r =>
        r.doc_type === docType && parseInt(r.year) === year && r.record_id === recordId
      ) || null;
    };

    // ---- Collections: Receipt / Certificate / Material ----
    const collections = (app.data.collections || [])
      .filter(r => (r.ID || r.Name) === id)
      .filter(r => !(r['Is Resell'] === 'TRUE' || r['Is Resell'] === true))
      .map(entry => {
        const year = parseInt(entry.Year);
        const isSamaan = entry['Contribution Type'] === '2';
        const wantCert = !isSamaan && entry['Certificate Or Receipt'] === 'Certificate';
        const docType = isSamaan ? 'samaan' : (wantCert ? 'certificate' : 'receipt');
        const recordId = `${docType}-${year}-${entry.__rowIndex}`;
        const gen = isFileGenerated(docType, year, recordId);
        const label = `${isSamaan ? 'Material' : (wantCert ? 'Certificate' : 'Receipt')} — ${year}${(!isSamaan && entry.Amount) ? ' — ' + fmt(entry.Amount) : ''}`;
        return { recordId, docType, year, label, publicLink: gen ? gen.public_link : null };
      })
      .sort((a, b) => b.year - a.year);

    // ---- Loans this person took (as Loaner) ----
    const loanerItems = (app.data.loans || [])
      .filter(l => (l.ID || l.Name) === id)
      .flatMap(loan => {
        const year = parseInt(loan.Year);
        const c = (app.data.loanConsents || []).find(x => x.loan_id === loan['Loan ID'] && x.role === 'loaner' && x.status === 'accepted');
        if (!c) return [];
        const recordId = `consent_loaner-${year}-${c.consent_id}`;
        const gen = isFileGenerated('consent_loaner', year, recordId);
        return [{ recordId, docType: 'consent_loaner', year, label: `Loan Consent (as Loaner) — ${year} — ${fmt(loan.Amount)}`, publicLink: gen ? gen.public_link : null }];
      })
      .sort((a, b) => b.year - a.year);

    // ---- Loans this person guaranteed for someone else ----
    const guarantorItems = (app.data.loanConsents || [])
      .filter(c => c.role === 'guarantor' && c.status === 'accepted' && (c.person_id || '').toString().trim() === id)
      .flatMap(c => {
        const loan = (app.data.loans || []).find(l => l['Loan ID'] === c.loan_id);
        if (!loan) return [];
        const year = parseInt(loan.Year);
        const recordId = `consent_guarantor-${year}-${c.consent_id}`;
        const gen = isFileGenerated('consent_guarantor', year, recordId);
        const loanerName = app.getUser(loan.ID || loan.Name).Name;
        return [{ recordId, docType: 'consent_guarantor', year, label: `Loan Consent (as Guarantor for ${loanerName}) — ${year}`, publicLink: gen ? gen.public_link : null }];
      })
      .sort((a, b) => b.year - a.year);

    return { collections, loanerItems, guarantorItems };
  },

  renderDownloadDocs: () => {
    const id = app.dcSelectedId;
    const wrap = document.getElementById('dc-docs-wrap');
    if (!id) { wrap.innerHTML = ''; return; }

    const u = app.getUser(id);
    const { collections, loanerItems, guarantorItems } = app.buildPersonDownloads(id);

    const rowHtml = (item) => `
      <div class="data-row">
        <div><strong style="display:block; font-size:0.9rem;">${escapeHtml(item.label)}</strong></div>
        ${item.publicLink && safeUrl(item.publicLink)
          ? `<a href="${escapeAttr(item.publicLink)}" target="_blank" rel="noreferrer" class="badge badge-ok" style="text-decoration:none;">Download</a>`
          : `<span class="badge" style="background:#f3f4f6; color:#9CA3AF;">Not Available</span>`}
      </div>`;

    const section = (title, items) => `
      <h4 style="margin: 15px 0 8px; color: var(--text-main);">${escapeHtml(title)}</h4>
      <div class="glass-card" style="padding:10px 15px;">
        ${items.length ? items.map(rowHtml).join('') : '<div style="text-align:center; padding:10px; color:var(--text-muted); font-size:0.85rem;">No records available.</div>'}
      </div>`;

    wrap.innerHTML = `
      <div class="glass-card" style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <div style="min-width:0; overflow-wrap:anywhere;">
          <strong style="display:block; font-size:1.05rem;">${escapeHtml(u.Name)}</strong>
          <span style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(u.Village || '-')}</span>
        </div>
        <button style="background:#e5e7eb; color:#111; border:none; padding:8px 14px; border-radius:8px; font-weight:600; font-size:0.85rem; cursor:pointer; flex-shrink:0;" onclick="app.backToDownloadList()">← Back</button>
      </div>
      ${section('Collections (Receipt / Certificate / Samaan)', collections)}
      ${section('Loan Consent — As Loaner', loanerItems)}
      ${section('Loan Consent — As Guarantor', guarantorItems)}
    `;
  }
};

window.onload = app.init;
