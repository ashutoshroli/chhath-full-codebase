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
// audit L-19: there used to be an `escapeAttr` alias here that just called
// escapeHtml. The name implied a different, attribute-specific escaping that did
// not exist, which invites someone to "improve" one and not the other.
//
// escapeHtml is in fact correct for BOTH contexts, and deliberately so: it escapes
// the double AND single quote, so an interpolated value cannot terminate either
// form of quoted attribute. The alias is gone; every call site uses escapeHtml.
//
// The one place that needs more is a value going into a JS string inside an
// onclick attribute (see renderDownloadPeople) — that is a third context, and it
// escapes for the JS string FIRST and then for HTML.
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

// ============ i18n (bilingual English / हिंदी) ============
//
// The toggle is PURELY CLIENT-SIDE — it does not change any network request, so
// the version-keyed edge cache is untouched (the Hindi values already ship in the
// same portalData payload as 'Name (Hindi)', 'Village (Hindi)', etc.). Switching
// language just re-reads those fields and re-renders.
//
// Two parts:
//   T[lang][key]         — static UI strings (headings, buttons, table labels).
//   localize(row, field) — a person/record's DATA value, preferring the Hindi DB
//                          column when Hindi is active, falling back to English.
const T = {
  en: {
    app_title: 'Chhath Puja', app_subtitle: 'Transparency Portal',
    nav_home: 'Home', nav_expenses: 'Expenses', nav_loans: 'Loans', nav_committee: 'Committee', nav_downloads: 'Downloads',
    back_to_home: 'Back to Home',
    master_calc: 'Master Financial Calculation',
    budget_overview: 'Budget Overview', lifetime_budget_overview: 'Lifetime Budget Overview',
    past_loan_returned: '(+) Past Loan Returned (with Int.)', lifetime_loans_returned: '(+) Lifetime Loans Returned (with Int.)',
    current_year_collection: '(+) Current Year Collection', lifetime_collections: '(+) Lifetime Collections',
    total_budget: 'TOTAL BUDGET', total_expense: 'Total Expense', net_surplus: 'Net Surplus',
    contributors_list: 'Contributors List', search_by_name: 'Search by Name...',
    expenses_ledger: 'Expenses Ledger', loan_distribution: 'Surplus Loan Distribution',
    active_committee: 'Active Committee', login: 'Login',
    download_center: 'Download Center', village: 'Village', name: 'Name',
    select_village: '-- Select Village --', select_village_first: 'Please select a village first', search: 'Search',
    resell: 'Resell', resold_item: 'Resold item', material: 'Material', service: 'Service',
    no_records_found: 'No records found.', no_expenses: 'No expenses recorded.',
    not_distributed: 'Not Distributed Yet', no_committee: 'No committee on record.',
    no_matches: 'No matches found.', no_docs: 'No records available.',
    verified_record: 'Verified Record', record_not_found: 'Record Not Found',
    verify_help: "This record could not be verified against the committee's records. If you believe this is an error, please contact the committee.",
    year: 'Year', amount: 'Amount', detail: 'Detail',
    surplus_loan: 'Surplus Loan', given_to_verified: 'Given to a single verified contributor.',
    receiver_name: 'Receiver Name', int_rate: 'Int. Rate', tenure: 'Tenure',
    verified_guarantors: 'Verified Guarantors', no_guarantors: 'No guarantors on record.',
    rule_violation: 'Rule Violation (Committee Member)', valid_guarantor: 'Valid Guarantor',
    contributor_yes_no: 'Contributor', committee_yes_no: 'Committee', yes: 'Yes', no: 'No',
    member: 'Member', na: 'N/A', download: 'Download', not_available: 'Not Available', back: '← Back',
    doc_receipt: 'Receipt', doc_receipt_work: 'Work Receipt', doc_certificate: 'Certificate',
    doc_samaan: 'Material Receipt', doc_consent_loaner: 'Loan Consent (Loaner)', doc_consent_guarantor: 'Loan Consent (Guarantor)',
    dc_collections: 'Collections (Receipt / Certificate / Material)',
    dc_as_loaner: 'Loan Consent — As Loaner', dc_as_guarantor: 'Loan Consent — As Guarantor',
  },
  hi: {
    app_title: 'छठ पूजा', app_subtitle: 'पारदर्शिता पोर्टल',
    nav_home: 'होम', nav_expenses: 'व्यय', nav_loans: 'ऋण', nav_committee: 'समिति', nav_downloads: 'डाउनलोड',
    back_to_home: 'होम पर वापस',
    master_calc: 'मुख्य वित्तीय गणना',
    budget_overview: 'बजट विवरण', lifetime_budget_overview: 'कुल बजट विवरण',
    past_loan_returned: '(+) पिछला ऋण वापसी (ब्याज सहित)', lifetime_loans_returned: '(+) कुल ऋण वापसी (ब्याज सहित)',
    current_year_collection: '(+) इस वर्ष का संग्रह', lifetime_collections: '(+) कुल संग्रह',
    total_budget: 'कुल बजट', total_expense: 'कुल व्यय', net_surplus: 'शुद्ध शेष',
    contributors_list: 'योगदानकर्ता सूची', search_by_name: 'नाम से खोजें...',
    expenses_ledger: 'व्यय बही', loan_distribution: 'अधिशेष ऋण वितरण',
    active_committee: 'सक्रिय समिति', login: 'लॉगिन',
    download_center: 'डाउनलोड केंद्र', village: 'गाँव', name: 'नाम',
    select_village: '-- गाँव चुनें --', select_village_first: 'कृपया पहले गाँव चुनें', search: 'खोजें',
    resell: 'पुनर्विक्रय', resold_item: 'पुनर्विक्रीत वस्तु', material: 'सामग्री', service: 'सेवा',
    no_records_found: 'कोई रिकॉर्ड नहीं मिला।', no_expenses: 'कोई व्यय दर्ज नहीं है।',
    not_distributed: 'अभी वितरित नहीं हुआ', no_committee: 'कोई समिति दर्ज नहीं है।',
    no_matches: 'कोई परिणाम नहीं मिला।', no_docs: 'कोई दस्तावेज़ उपलब्ध नहीं है।',
    verified_record: 'सत्यापित रिकॉर्ड', record_not_found: 'रिकॉर्ड नहीं मिला',
    verify_help: 'यह रिकॉर्ड समिति के अभिलेखों से सत्यापित नहीं हो सका। यदि आपको लगता है कि यह त्रुटि है, तो कृपया समिति से संपर्क करें।',
    year: 'वर्ष', amount: 'राशि', detail: 'विवरण',
    surplus_loan: 'अधिशेष ऋण', given_to_verified: 'एक सत्यापित योगदानकर्ता को दिया गया।',
    receiver_name: 'प्राप्तकर्ता का नाम', int_rate: 'ब्याज दर', tenure: 'अवधि',
    verified_guarantors: 'सत्यापित गारंटर', no_guarantors: 'कोई गारंटर दर्ज नहीं है।',
    rule_violation: 'नियम उल्लंघन (समिति सदस्य)', valid_guarantor: 'मान्य गारंटर',
    contributor_yes_no: 'योगदानकर्ता', committee_yes_no: 'समिति', yes: 'हाँ', no: 'नहीं',
    member: 'सदस्य', na: 'उपलब्ध नहीं', download: 'डाउनलोड', not_available: 'उपलब्ध नहीं', back: '← वापस',
    doc_receipt: 'रसीद', doc_receipt_work: 'कार्य रसीद', doc_certificate: 'प्रमाण-पत्र',
    doc_samaan: 'सामग्री रसीद', doc_consent_loaner: 'ऋण सहमति (ऋणी)', doc_consent_guarantor: 'ऋण सहमति (गारंटर)',
    dc_collections: 'योगदान (रसीद / प्रमाण-पत्र / सामग्री)',
    dc_as_loaner: 'ऋण सहमति — ऋणी के रूप में', dc_as_guarantor: 'ऋण सहमति — गारंटर के रूप में',
  },
};

const LANG_KEY = 'cpm_public_lang';

const app = {
  data: null,
  userMap: {},
  dcVillage: 'All',
  dcSelectedId: null,
  // 'en' | 'hi' — restored from localStorage, default English. Read on first render.
  lang: (() => { try { return localStorage.getItem(LANG_KEY) === 'hi' ? 'hi' : 'en'; } catch (e) { return 'en'; } })(),

  // Static UI string for the current language (falls back to English, then the key).
  t: (key) => (T[app.lang] && T[app.lang][key]) || T.en[key] || key,

  // A DATA value for the current language. `field` is the English key
  // ('Name', 'Village', "Father's Name", 'Designation', 'View Role', 'Discription').
  // When Hindi is active, prefer '<field> (Hindi)' and fall back to English when
  // the Hindi column is blank — so a missing Hindi name never shows an empty cell.
  localize: (row, field) => {
    if (!row) return '';
    const en = (row[field] === undefined || row[field] === null) ? '' : row[field].toString();
    if (app.lang !== 'hi') return en;
    const hi = row[field + ' (Hindi)'];
    const hiStr = (hi === undefined || hi === null) ? '' : hi.toString().trim();
    return hiStr || en;
  },

  // Flip the language, persist it, update the toggle label + <html lang>, then
  // re-apply the static strings and re-render every dynamic view.
  toggleLang: () => {
    app.lang = app.lang === 'hi' ? 'en' : 'hi';
    try { localStorage.setItem(LANG_KEY, app.lang); } catch (e) { /* private mode */ }
    app.applyLang();
  },

  // Static-only application: the toggle button label, <html lang>, and every
  // element tagged data-i18n / data-i18n-placeholder. Safe to call before data
  // loads (does NOT re-render dynamic views), so init() uses it directly.
  applyStaticLang: () => {
    // The toggle button shows the language it will SWITCH TO (so it reads 'हिंदी'
    // while in English, and 'English' while in Hindi).
    const label = document.getElementById('lang-toggle-label');
    if (label) label.innerText = app.lang === 'hi' ? 'English' : 'हिंदी';
    try { document.documentElement.setAttribute('lang', app.lang); } catch (e) { /* ignore */ }

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const v = app.t(el.getAttribute('data-i18n'));
      if (v) el.innerText = v;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const v = app.t(el.getAttribute('data-i18n-placeholder'));
      if (v) el.setAttribute('placeholder', v);
    });
  },

  // Full application: static strings + re-render every dynamic view. Used by the
  // toggle so a language switch updates the whole page live.
  applyLang: () => {
    app.applyStaticLang();
    if (app.data && app.currentData) {
      app.refreshData();
      app.renderDownloadVillages();
      if (app.dcSelectedId) app.renderDownloadDocs();
    }
    app.checkRecordVerification();
  },

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

        // audit L-18: these three were unguarded while `users`, `generatedFiles` and
        // `loanConsents` right above are defaulted. The last-known-good snapshot
        // path (Public Worker, pub:snapshot:*) can serve a payload built before a
        // key existed, and an older/partial deployment omits others — either way
        // this threw "Cannot read properties of undefined (reading 'forEach')" and
        // took the WHOLE public portal to a blank page, on the one code path whose
        // entire purpose is to keep the portal up when things are already wrong.
        app.data.collections = app.data.collections || [];
        app.data.loans = app.data.loans || [];
        app.data.committee = app.data.committee || [];
        app.data.expenses = app.data.expenses || [];

        (res.collections || []).forEach(r => {
          if (r.Year) years.add(parseInt(r.Year));
        });

        (res.loans || []).forEach(r => {
          if (r.Year) years.add(parseInt(r.Year));
        });

        (res.committee || []).forEach(r => {
          if (r.Year) years.add(parseInt(r.Year));
        });

        let yearArr = Array.from(years).sort((a, b) => b - a);

        if (yearArr.length === 0)
          yearArr = [new Date().getFullYear()];

        const sel = document.getElementById('global-year');
        // The "All Years" option was removed; the dropdown now shows only real
        // years and defaults to the latest (yearArr is sorted newest-first). The
        // `isAll` code paths below are kept as harmless dead branches so nothing
        // that referenced them breaks.
        sel.innerHTML = yearArr.map(y => `<option value="${y}">${y}</option>`).join('');
        sel.value = yearArr[0];

        // Apply the saved language to the static labels + toggle button now that
        // the DOM strings exist. The render calls below already read app.lang, so
        // we don't want applyLang()'s re-render loop here — just the static bits.
        app.applyStaticLang();

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
      ${slide.image_url && safeUrl(driveImageUrl(slide.image_url)) ? `<img class="popup-slide-img" src="${escapeHtml(driveImageUrl(slide.image_url))}" alt="" data-fb="${escapeHtml(driveImageFallbackUrl(slide.image_url))}" onerror="if(this.dataset.fb&&this.dataset.fbTried!=='1'){this.dataset.fbTried='1';this.src=this.dataset.fb;}else{this.style.display='none';}">` : ''}
      ${slide.text ? `<div class="popup-slide-text">${escapeHtml(slide.text)}</div>` : ''}
      ${slide.link_url && safeUrl(slide.link_url) ? `<a class="popup-slide-link" href="${escapeHtml(slide.link_url)}" target="_blank" rel="noreferrer">${escapeHtml(slide.link_text || 'Learn more')}</a>` : ''}
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
    const docLabel = app.t('doc_' + docType) !== ('doc_' + docType) ? app.t('doc_' + docType) : docType;

    let detailsHtml = '';
    if (['receipt', 'receipt_work', 'certificate', 'samaan'].includes(docType)) {
      const entry = (app.data.collections || []).find(c =>
        (c.__rowIndex || '').toString() === ref && parseInt(c.Year) === parseInt(year));
      if (entry) {
        // A resold-item receipt has no contributor — show the item, not a user.
        if (app.isResellRow(entry)) {
          detailsHtml = `
            <div style="margin-top:8px; font-size:0.9rem;">
              <div><strong>♻️ ${app.t('resell')}: ${escapeHtml(entry.Detail || '-')}</strong></div>
              ${entry.Amount ? `<div>${app.t('amount')}: ${fmt(entry.Amount)}</div>` : ''}
            </div>`;
        } else {
          const u = app.getUser(entry.Name);
          const village = app.localize(u, 'Village');
          detailsHtml = `
            <div style="margin-top:8px; font-size:0.9rem;">
              <div><strong>${escapeHtml(app.localize(u, 'Name'))}</strong>${village && village !== '-' ? ' — ' + escapeHtml(village) : ''}</div>
              ${entry.Amount ? `<div>${app.t('amount')}: ${fmt(entry.Amount)}</div>` : ''}
              ${entry.Detail ? `<div>${app.t('detail')}: ${escapeHtml(entry.Detail)}</div>` : ''}
            </div>`;
        }
      }
    }

    content.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="material-icons-round" style="color:${genFile ? 'var(--success)' : 'var(--danger)'};">${genFile ? 'verified' : 'error_outline'}</span>
        <strong>${genFile ? app.t('verified_record') : app.t('record_not_found')}</strong>
      </div>
      <div style="font-size:0.85rem; color:var(--text-muted); margin-top:4px;">${escapeHtml(docLabel)} — ${app.t('year')} ${escapeHtml(year)}</div>
      ${genFile ? detailsHtml : `<p style="font-size:0.85rem; margin-top:8px;">${app.t('verify_help')}</p>`}
    `;

    app.nav('verify');
  },

  refreshData: () => {
    const rawYear = document.getElementById('global-year').value;
    const isAll = rawYear === 'All';
    const tYear = isAll ? 'All' : parseInt(rawYear);

    document.getElementById('disp-year-title').innerText = isAll ? app.t('lifetime_budget_overview') : `${tYear} ${app.t('budget_overview')}`;
    document.getElementById('lbl-past-loan').innerText = isAll ? app.t('lifetime_loans_returned') : app.t('past_loan_returned');
    document.getElementById('lbl-cur-col').innerText = isAll ? app.t('lifetime_collections') : app.t('current_year_collection');

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
         // Search matches the English OR Hindi name, in either display language.
         return (u.Name || '').toLowerCase().includes(s)
            || (u['Name (Hindi)'] || '').toString().toLowerCase().includes(s);
      })
      .map(r => {
         const cType = (r['Contribution Type'] || 1).toString();
         const isMoney = cType === '1';
         const yrTag = app.currentData.isAll ? `<span class="yr-tag">[${escapeHtml(r.Year)}]</span>` : '';

         // ---- Resell row: an item that was resold, not a person's contribution ----
         if (app.isResellRow(r)) {
            return `<div class="data-row">
               <div>
                 <strong style="display:block;">♻️ ${app.t('resell')}: ${escapeHtml(r.Detail || '-')} ${yrTag}</strong>
                 <span style="font-size:0.8rem; color:var(--text-muted);">${app.t('resold_item')}</span>
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
                 <span class="badge" style="background:#DBEAFE; color:#1E40AF;">${cType === '2' ? app.t('material') : app.t('service')}</span>
                 ${r.Detail ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px; max-width:150px;">${escapeHtml(r.Detail)}</div>` : ''}
               </div>`;

         // Name / Designation / Village / Father's Name come from the Hindi DB
         // columns when Hindi is active (localize falls back to English if blank).
         return `<div class="data-row">
            <div>
              <strong style="display:block;">${escapeHtml(app.localize(u, 'Name'))} (${escapeHtml(app.localize(u, 'Designation') || '-')}) ${yrTag}</strong>
              <span style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(app.localize(u, 'Village') || r.Village || '-')} | ${escapeHtml(app.localize(u, "Father's Name") || '-')}</span>
            </div>
            
            ${rightSide}
         </div>`;
      }).join('');
    document.getElementById('home-col-list').innerHTML = html || `<div style="text-align:center; padding:20px;">${app.t('no_records_found')}</div>`;
  },

  renderExpenses: () => {
    const html = app.currentData.exp.map(r => {
      // The column is misspelled "Discription" in the schema; some payloads use
      // "Description". Fall back across both (and to a dash) so the name is never
      // blank, and escape it.
      // Prefer the Hindi description when Hindi is active (localize on 'Discription',
      // the schema's misspelling; falls back to English / 'Description' / '-').
      const desc = app.localize(r, 'Discription') || r.Description || '-';
      const yrTag = app.currentData.isAll ? `<span class="yr-tag">[${escapeHtml(r.Year)}]</span>` : '';
      return `<div class="data-row">
        <div><strong style="display:block; max-width:200px;">${escapeHtml(desc)} ${yrTag}</strong></div>
        <strong style="color:var(--danger);">-${fmt(r.Amount)}</strong>
      </div>`;
    }).join('');
    document.getElementById('exp-list').innerHTML = html || `<div style="text-align:center; padding:20px;">${app.t('no_expenses')}</div>`;
  },

  renderLoans: () => {
    const isAll = app.currentData.isAll;
    const targetLoans = isAll ? app.data.loans : app.data.loans.filter(l => parseInt(l.Year) === app.currentData.tYear);
    
    if(targetLoans.length === 0) {
      document.getElementById('loans-dynamic-list').innerHTML = `<div class="glass-card" style="text-align:center; padding: 20px;">${app.t('not_distributed')}</div>`;
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
            ? `<span class="badge badge-warn">${app.t('rule_violation')}</span>`
            : `<span class="badge badge-ok">${app.t('valid_guarantor')}</span>`;

         gHtml += `<div class="glass-card" style="padding:15px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
              <strong style="min-width:0; overflow-wrap:anywhere;">${escapeHtml(app.localize(uGuarantor, 'Name'))}</strong>
              <span style="flex-shrink:0;">${statusBadge}</span>
            </div>
           
            <div style="font-size:0.75rem; color:gray; margin-top:5px;">
              ${app.t('village')}: ${escapeHtml(app.localize(uGuarantor, 'Village') || '-')} | ${app.t('contributor_yes_no')}: ${isCont ? app.t('yes') : app.t('no')} | ${app.t('committee_yes_no')}: ${isCom ? app.t('yes') : app.t('no')}
            </div>
         </div>`;
      });

      finalHtml += `
      <div class="glass-card" style="background: #FFFBEB; border-color: #FCD34D;">
        <h3 style="color: #92400E; margin-bottom: 5px;">${app.t('surplus_loan')} ${isAll ? `(${lYear})` : ''}</h3>
        <p style="font-size: 0.85rem; color: #B45309; margin-bottom: 15px;">${app.t('given_to_verified')}</p>
        
        <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #FDE68A; margin-bottom: 15px;">
          <div style="font-size: 0.8rem; color: var(--text-muted);">${app.t('receiver_name')}</div>
          <div style="font-size: 1.3rem; font-weight: bold; color: var(--text-main); margin-bottom: 10px;">${escapeHtml(app.localize(uReceiver, 'Name'))}</div>
          <div class="grid-3">
            <div><span style="font-size:0.75rem;">${app.t('amount')}</span><br><strong style="font-size: 0.95rem;">${fmt(curLoan.Amount)}</strong></div>
            <div><span style="font-size:0.75rem;">${app.t('int_rate')}</span><br><strong style="font-size: 0.95rem;">${escapeHtml(curLoan['Intrest Rate'] || curLoan['Interest Rate'] || '0')}%</strong></div>
            <div><span style="font-size:0.75rem;">${app.t('tenure')}</span><br><strong style="font-size: 0.95rem;">${escapeHtml(curLoan.Tenure || '0')} Mo</strong></div>
          </div>
        </div>
        
        <h4 style="margin-bottom: 10px; color: #92400E;">${app.t('verified_guarantors')}</h4>
        ${gHtml || `<p>${app.t('no_guarantors')}</p>`}
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
       const nameStr = (app.localize(u, 'Name') || '').toString();
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
                ${/* The committee role column is `view_role`, surfaced as 'View Role'
                      by the Worker's REVERSE_MAPS — there is no `Role` field, so this
                      silently fell through to Designation and the committee role was
                      never shown on the public site (audit H-2). */''}
                ${escapeHtml(app.localize(r, 'View Role') || app.localize(u, 'Designation') || app.t('member'))}
             </div>
             <div style="font-size:0.8rem; color:var(--text-muted); display:flex; flex-wrap:wrap; gap:10px;">
                <span style="display:flex; align-items:center; gap:3px;"><span class="material-icons-round" style="font-size:12px;">call</span> ${escapeHtml(u.Mobile || app.t('na'))}</span>
                <span style="display:flex; align-items:center; gap:3px;"><span class="material-icons-round" style="font-size:12px;">place</span> ${escapeHtml(app.localize(u, 'Village') || app.t('na'))}</span>
             </div>
          </div>
       </div>`;
    }).join('');
    document.getElementById('com-list').innerHTML = html || `<div style="text-align:center; padding:20px;">${app.t('no_committee')}</div>`;
  },

  /* ================= DOWNLOAD CENTER ================= */

  renderDownloadVillages: () => {
    const villages = new Set();
    (app.data.users || []).forEach(u => { if (u.Village) villages.add(u.Village.trim()); });
    const arr = Array.from(villages).sort((a, b) => a.localeCompare(b));
    const sel = document.getElementById('dc-village');
    sel.innerHTML = `<option value="">${app.t('select_village')}</option>` + arr.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
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
      nameInput.placeholder = app.t('search_by_name');
      searchBtn.disabled = false;
      searchBtn.style.opacity = '1';
    } else {
      nameInput.disabled = true;
      nameInput.value = '';
      nameInput.placeholder = app.t('select_village_first');
      searchBtn.disabled = true;
      searchBtn.style.opacity = '0.5';
    }
  },

  searchDownloadPeople: () => {
    const village = document.getElementById('dc-village').value;
    if (!village) { alert(app.t('select_village_first')); return; }
    const q = document.getElementById('dc-search').value.toLowerCase().trim();

    app.dcSelectedId = null;
    document.getElementById('dc-docs-wrap').innerHTML = '';

    const list = (app.data.users || [])
      .filter(u => (u.Village || '').trim() === village)
      // Match against BOTH the English and Hindi name so a search works in either
      // language regardless of which language is currently displayed.
      .filter(u => !q
        || (u.Name || '').toLowerCase().includes(q)
        || (u['Name (Hindi)'] || '').toString().toLowerCase().includes(q))
      .slice(0, 50);

    const html = list.map(u => {
      // ID goes into a JS string inside an onclick attribute — escape for BOTH
      // the JS-string context and the HTML-attribute context. Names/villages are
      // HTML-escaped like everywhere else.
      const idJs = (u.ID || '').toString().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `
      <div class="data-row" style="cursor:pointer;" onclick="app.selectDownloadPerson('${escapeHtml(idJs)}')">
        <div>
          <strong style="display:block;">${escapeHtml(app.localize(u, 'Name'))}</strong>
          <span style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(app.localize(u, 'Village') || '-')}</span>
        </div>
        <span class="material-icons-round" style="color:var(--primary-saffron);">chevron_right</span>
      </div>`;
    }).join('');

    document.getElementById('dc-people-wrap').innerHTML = `<div class="glass-card" id="dc-people-list">${html || `<div style="text-align:center; padding:20px;">${app.t('no_matches')}</div>`}</div>`;
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
        // Type 3 (Service/Work) + Receipt is its own doc type receipt_work; must
        // match how the mgmt backend files/generates it, or the public download
        // for a work receipt would look for the wrong recordId and never appear.
        const isWork = !isSamaan && !wantCert && (entry['Contribution Type'] || '').toString() === '3';
        const docType = isSamaan ? 'samaan' : (wantCert ? 'certificate' : (isWork ? 'receipt_work' : 'receipt'));
        const recordId = `${docType}-${year}-${entry.__rowIndex}`;
        const gen = isFileGenerated(docType, year, recordId);
        const label = `${app.t('doc_' + docType)} — ${year}${(!isSamaan && entry.Amount) ? ' — ' + fmt(entry.Amount) : ''}`;
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
        return [{ recordId, docType: 'consent_loaner', year, label: `${app.t('doc_consent_loaner')} — ${year} — ${fmt(loan.Amount)}`, publicLink: gen ? gen.public_link : null }];
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
        const loanerName = app.localize(app.getUser(loan.ID || loan.Name), 'Name');
        return [{ recordId, docType: 'consent_guarantor', year, label: `${app.t('doc_consent_guarantor')} — ${loanerName} — ${year}`, publicLink: gen ? gen.public_link : null }];
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
          ? `<a href="${escapeHtml(item.publicLink)}" target="_blank" rel="noreferrer" class="badge badge-ok" style="text-decoration:none;">${app.t('download')}</a>`
          : `<span class="badge" style="background:#f3f4f6; color:#9CA3AF;">${app.t('not_available')}</span>`}
      </div>`;

    const section = (title, items) => `
      <h4 style="margin: 15px 0 8px; color: var(--text-main);">${escapeHtml(title)}</h4>
      <div class="glass-card" style="padding:10px 15px;">
        ${items.length ? items.map(rowHtml).join('') : `<div style="text-align:center; padding:10px; color:var(--text-muted); font-size:0.85rem;">${app.t('no_docs')}</div>`}
      </div>`;

    wrap.innerHTML = `
      <div class="glass-card" style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <div style="min-width:0; overflow-wrap:anywhere;">
          <strong style="display:block; font-size:1.05rem;">${escapeHtml(app.localize(u, 'Name'))}</strong>
          <span style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(app.localize(u, 'Village') || '-')}</span>
        </div>
        <button style="background:#e5e7eb; color:#111; border:none; padding:8px 14px; border-radius:8px; font-weight:600; font-size:0.85rem; cursor:pointer; flex-shrink:0;" onclick="app.backToDownloadList()">${app.t('back')}</button>
      </div>
      ${section(app.t('dc_collections'), collections)}
      ${section(app.t('dc_as_loaner'), loanerItems)}
      ${section(app.t('dc_as_guarantor'), guarantorItems)}
    `;
  }
};

// audit L-17: `window.onload = app.init` REPLACES any existing load handler, so it
// silently disables anything else that registers one — the GTM snippet in
// index.html, an analytics tag, a future service-worker registration. addEventListener
// composes instead of clobbering.
window.addEventListener('load', () => app.init());
