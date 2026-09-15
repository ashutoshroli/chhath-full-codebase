const fmt = (n) => new Intl.NumberFormat('en-IN', {style:'currency', currency:'INR', maximumFractionDigits:0}).format(n||0);
const parseAmt = (v) => parseFloat((v||'').toString().replace(/[^0-9.-]+/g,"")) || 0;

const CHATBOT_API_URL = "https://chhath-server-render.onrender.com/public-chat";
const CHAT_SESSION_ID = (() => {
  try {
    let id = sessionStorage.getItem('chat_sid');
    if (!id) { id = 'cs-' + Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('chat_sid', id); }
    return id;
  } catch (e) { return 'cs-' + Math.random().toString(36).slice(2); }
})();

function escapeHtml(v) {
  return (v === undefined || v === null ? '' : v.toString())
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function safeUrl(v) {
  const raw = (v === undefined || v === null ? '' : v.toString()).trim();
  return /^https?:\/\//i.test(raw) ? raw : '';
}

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

let ERROR_LOG_URL = null;
const reportedMessages = new Set();

function reportPublicError(message, err, extra) {
  try {
    const msg = (message || '').toString().slice(0, 500);
    if (reportedMessages.has(msg)) return;
    reportedMessages.add(msg);
    if (!ERROR_LOG_URL) return;
    fetch(ERROR_LOG_URL, {
      method: 'POST',
      // Required by the Worker (audit PUB-BE-06): without it this is a CORS simple
      // request, which skips the preflight the origin allow-list is enforced in.
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        page: location.pathname + location.search,
        message: msg,
        stack: (err && err.stack) ? err.stack.toString().slice(0, 2000) : '',
        context: JSON.stringify(Object.assign({ ua: navigator.userAgent.slice(0, 150) }, extra || {})).slice(0, 500),
      }),
    }).catch(() => {});
  } catch (e) {  }
}

window.addEventListener('error', (e) => {
  reportPublicError(e.message, e.error, { filename: e.filename, lineno: e.lineno });
});
window.addEventListener('unhandledrejection', (e) => {
  const err = e.reason;
  reportPublicError('Unhandled rejection: ' + ((err && err.message) || String(err)), err, {});
});

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
    chat_placeholder: 'Type your question…', chat_error: 'Sorry, something went wrong. Please try again.',
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
    chat_placeholder: 'अपना प्रश्न लिखें…', chat_error: 'क्षमा करें, कुछ गड़बड़ हुई। कृपया पुनः प्रयास करें।',
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
  lang: (() => { try { return localStorage.getItem(LANG_KEY) === 'hi' ? 'hi' : 'en'; } catch (e) { return 'en'; } })(),

  t: (key) => (T[app.lang] && T[app.lang][key]) || T.en[key] || key,

  localize: (row, field) => {
    if (!row) return '';
    const en = (row[field] === undefined || row[field] === null) ? '' : row[field].toString();
    if (app.lang !== 'hi') return en;
    const hi = row[field + ' (Hindi)'];
    const hiStr = (hi === undefined || hi === null) ? '' : hi.toString().trim();
    return hiStr || en;
  },

  toggleLang: () => {
    app.lang = app.lang === 'hi' ? 'en' : 'hi';
    try { localStorage.setItem(LANG_KEY, app.lang); } catch (e) {  }
    app.applyLang();
  },

  applyStaticLang: () => {
    const label = document.getElementById('lang-toggle-label');
    if (label) label.innerText = app.lang === 'hi' ? 'English' : 'हिंदी';
    try { document.documentElement.setAttribute('lang', app.lang); } catch (e) {  }

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const v = app.t(el.getAttribute('data-i18n'));
      if (v) el.innerText = v;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const v = app.t(el.getAttribute('data-i18n-placeholder'));
      if (v) el.setAttribute('placeholder', v);
    });
  },

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
    const BASE_API_URL = "https://chhath-public-worker.shaharpura.com/";
    ERROR_LOG_URL = BASE_API_URL + "?action=logError";

    fetch(BASE_API_URL + "?action=dataVersion")
      .then(r => (r.ok ? r.json() : null))
      .then(vr => (vr && vr.v != null ? vr.v.toString() : ''))
      .catch(() => '')
      .then(version => {
        const vq = version ? ("&v=" + encodeURIComponent(version)) : "";
        const API_URL = BASE_API_URL + "?action=portalData" + vq;

        app.loadPopup(BASE_API_URL, version);

        return fetch(API_URL);
      })
      .then(response => {
        if (!response.ok) throw new Error('portalData HTTP ' + response.status);
        return response.json();
      })
      .then(res => {
        const looksReal = res && typeof res === 'object' && res.status !== false &&
          (Array.isArray(res.collections) || Array.isArray(res.committee) ||
           Array.isArray(res.loans) || Array.isArray(res.expenses) || Array.isArray(res.users));
        if (!looksReal) throw new Error('portalData returned no usable data');

        app.applyPortalData(res, { fromCache: false });
        app.saveLocalSnapshot(res);
      })
      .catch(error => {
        console.error(error);
        reportPublicError('Public portal data load failed: ' + (error && error.message), error, {});
        const cached = app.loadLocalSnapshot();
        if (cached) {
          try {
            app.applyPortalData(cached.data, { fromCache: true, savedAt: cached.savedAt });
            return;
          } catch (e) {
            reportPublicError('Public portal cached-render failed: ' + (e && e.message), e, {});
          }
        }
        app.renderColdFailureFallback();
      });
  },


  LOCAL_SNAPSHOT_KEY: 'cpm_public_portalData_v1',

  saveLocalSnapshot: (res) => {
    try {
      const payload = JSON.stringify({ savedAt: Date.now(), data: res });
      if (payload.length > 4000000) return;
      localStorage.setItem(app.LOCAL_SNAPSHOT_KEY, payload);
    } catch (e) {  }
  },

  loadLocalSnapshot: () => {
    try {
      const raw = localStorage.getItem(app.LOCAL_SNAPSHOT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.data) return null;
      return { data: parsed.data, savedAt: parsed.savedAt || 0 };
    } catch (e) { return null; }
  },

  applyPortalData: (res, opts) => {
    opts = opts || {};
    res = res || {};
    app.data = res;
    app.data.generatedFiles = app.data.generatedFiles || [];
    app.data.loanConsents = app.data.loanConsents || [];

    app.userMap = {};
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

    app.data.collections = app.data.collections || [];
    app.data.loans = app.data.loans || [];
    app.data.committee = app.data.committee || [];
    app.data.expenses = app.data.expenses || [];

    (res.collections || []).forEach(r => { if (r.Year) years.add(parseInt(r.Year)); });
    (res.loans || []).forEach(r => { if (r.Year) years.add(parseInt(r.Year)); });
    (res.committee || []).forEach(r => { if (r.Year) years.add(parseInt(r.Year)); });

    let yearArr = Array.from(years).sort((a, b) => b - a);
    if (yearArr.length === 0) yearArr = [new Date().getFullYear()];

    const sel = document.getElementById('global-year');
    sel.innerHTML = yearArr.map(y => `<option value="${y}">${y}</option>`).join('');
    sel.value = yearArr[0];

    app.applyStaticLang();

    app.refreshData();
    app.renderDownloadVillages();
    app.checkRecordVerification();
    app.restoreViewFromHash();
    app.setupChat();

    app.renderStaleNotice(opts.fromCache ? opts.savedAt : null);

    document.getElementById('loader').style.display = 'none';
  },

  setupChat: () => {
    if (app._chatReady) return;
    const fab = document.getElementById('chat-fab');
    const panel = document.getElementById('chat-panel');
    const closeBtn = document.getElementById('chat-close');
    const form = document.getElementById('chat-form');
    if (!fab || !panel || !form) return;
    app._chatReady = true;

    const isOpen = () => panel.style.display === 'flex';
    const open = () => {
      panel.hidden = false;
      panel.style.display = 'flex';
      const input = document.getElementById('chat-input');
      if (input) setTimeout(() => input.focus(), 50);
    };
    const close = () => { panel.hidden = true; panel.style.display = 'none'; };
    close();
    fab.addEventListener('click', () => (isOpen() ? close() : open()));
    if (closeBtn) closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });

    form.addEventListener('submit', (e) => { e.preventDefault(); app.sendChat(); });
  },

  // ---- Linkify bot replies, XSS-safe by construction ----
  //
  // The chatbot answer is UNTRUSTED model output. We still want Markdown links
  // `[label](url)` and bare http(s):// URLs to render as clickable <a> tags.
  //
  // ORDERING IS THE SECURITY PROPERTY: escape-FIRST-then-linkify.
  //   (1) escapeHtml() the WHOLE reply first, so every < > & " ' the model produced
  //       is neutralised. After this step the string contains NO live markup at all.
  //   (2) Only THEN run the linkify regex over the already-escaped string. Because
  //       escapeHtml does not touch [ ] ( ), a Markdown link is still matchable, and
  //       an http(s):// URL has no raw < > so it survives intact.
  //   (3) Every candidate URL is passed through safeUrl(): if it is not http(s)
  //       (javascript:, data:, vbscript:, …) safeUrl returns '' and we DO NOT build
  //       a link — the text stays as its already-escaped, inert form.
  // The consequence: the ONLY HTML that can ever appear in the output is the <a>
  // tags THIS function emits, and their href is constrained to http(s) by safeUrl.
  // Nothing the model returns can create any other element or attribute. This is
  // why appendChatMsg may safely assign the result to innerHTML for the bot bubble.
  //
  // escapeHtml + safeUrl are passed in as arguments (dependency injection) so this
  // function is pure and can be evaluated by the Node test harness without a DOM.
  linkifyBotText: (text, escapeHtmlFn, safeUrlFn) => {
    const escaped = escapeHtmlFn(text);
    const unescapeHtml = (s) => s
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
    const re = /\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<]+)/gi;
    return escaped.replace(re, (match, mdLabel, mdUrl, bareUrl) => {
      if (bareUrl !== undefined) {
        let url = bareUrl;
        let trailing = '';
        const trailingRe = /[.,;:)\]}'"]+$/;
        const tm = url.match(trailingRe);
        if (tm) { trailing = tm[0]; url = url.slice(0, url.length - trailing.length); }
        const safe = safeUrlFn(unescapeHtml(url));
        if (!safe) return match;
        return '<a href="' + escapeHtmlFn(safe) + '" target="_blank" rel="noopener noreferrer nofollow">' + url + '</a>' + trailing;
      }
      const safe = safeUrlFn(unescapeHtml(mdUrl));
      if (!safe) return match;
      return '<a href="' + escapeHtmlFn(safe) + '" target="_blank" rel="noopener noreferrer nofollow">' + mdLabel + '</a>';
    });
  },

  appendChatMsg: (text, kind) => {
    const wrap = document.getElementById('chat-messages');
    if (!wrap) return null;
    const div = document.createElement('div');
    div.className = 'chat-msg chat-msg-' + (kind === 'user' ? 'user' : kind === 'error' ? 'error' : 'bot');
    if (kind === 'user' || kind === 'error') {
      div.textContent = text;
    } else {
      div.innerHTML = app.linkifyBotText(text, escapeHtml, safeUrl);
    }
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
    return div;
  },

  sendChat: async () => {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    const wrap = document.getElementById('chat-messages');
    if (!input || app._chatBusy) return;
    const question = (input.value || '').trim();
    if (!question) return;

    app._chatBusy = true;
    if (sendBtn) sendBtn.disabled = true;
    input.value = '';
    app.appendChatMsg(question, 'user');

    const typing = document.createElement('div');
    typing.className = 'chat-typing';
    typing.textContent = app.lang === 'hi' ? 'सोच रहा हूँ…' : 'Thinking…';
    if (wrap) { wrap.appendChild(typing); wrap.scrollTop = wrap.scrollHeight; }

    try {
      const res = await fetch(CHATBOT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, sessionId: CHAT_SESSION_ID, lang: app.lang }),
      });
      const data = await res.json().catch(() => ({}));
      typing.remove();
      if (res.ok && data && data.ok && data.answer) {
        app.appendChatMsg(data.answer, 'bot');
      } else {
        app.appendChatMsg((data && data.error) || app.t('chat_error'), 'error');
      }
    } catch (err) {
      typing.remove();
      app.appendChatMsg(app.t('chat_error'), 'error');
    } finally {
      app._chatBusy = false;
      if (sendBtn) sendBtn.disabled = false;
      if (input) input.focus();
    }
  },

  renderStaleNotice: (savedAt) => {
    const existing = document.getElementById('stale-data-notice');
    if (!savedAt) { if (existing) existing.remove(); return; }
    if (existing) return;
    let when = '';
    try { when = new Date(savedAt).toLocaleString(); } catch (e) { when = ''; }
    const bar = document.createElement('div');
    bar.id = 'stale-data-notice';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'background:#FEF3C7;color:#92400E;text-align:center;font-size:0.8rem;padding:6px 12px;line-height:1.4;';
    const en = 'You are viewing saved data — live figures could not be loaded right now.' + (when ? ' (saved: ' + when + ')' : '');
    const hi = 'आप सहेजा हुआ डेटा देख रहे हैं — अभी ताज़ा आँकड़े लोड नहीं हो सके।' + (when ? ' (सहेजा: ' + when + ')' : '');
    bar.textContent = app.lang === 'hi' ? hi : en;
    document.body.insertBefore(bar, document.body.firstChild);
  },

  renderColdFailureFallback: () => {
    const loader = document.getElementById('loader');
    if (!loader) return;
    const isHi = app.lang === 'hi';
    const title = isHi ? 'नवयुवक छठ पूजा समिति, शहरपुरा एवं गरडीह' : 'Navyuvak Chhath Puja Samiti, Shaharpura & Gardih';
    const msg = isHi
      ? 'अभी डेटा लोड नहीं हो पा रहा। कृपया थोड़ी देर बाद पुनः प्रयास करें।'
      : 'Data could not be loaded right now. Please try again in a little while.';
    const retry = isHi ? 'पुनः प्रयास करें' : 'Retry';
    loader.innerHTML =
      '<div style="text-align:center;padding:24px 16px;max-width:420px;margin:0 auto;">' +
      '<img src="/logo.svg" alt="" width="72" height="72" style="width:72px;height:72px;margin-bottom:12px;">' +
      '<h2 style="margin:0 0 6px;font-size:1.05rem;">' + escapeHtml(title) + '</h2>' +
      '<p style="color:#6b7280;font-size:0.9rem;margin:0 0 16px;">' + escapeHtml(msg) + '</p>' +
      '<button onclick="location.reload()" style="padding:9px 20px;border:none;border-radius:8px;background:var(--primary-saffron,#F97316);color:#fff;font-weight:600;cursor:pointer;">' + escapeHtml(retry) + '</button>' +
      '</div>';
    loader.style.display = 'flex';
  },

  popupSlides: [],
  popupIndex: 0,
  _popupTimer: null,
  _popupPaused: false,

  loadPopup: (baseApiUrl, version) => {
    const vq = version ? ("&v=" + encodeURIComponent(version)) : "";
    fetch(baseApiUrl + "?action=activePopups" + vq)
      .then(r => r.json())
      .then(popups => {
        if (!Array.isArray(popups) || !popups.length) return;
        const popup = popups[0];
        if (!popup.slides || !popup.slides.length) return;
        app.popupSlides = popup.slides;
        app.popupIndex = 0;
        app._popupPaused = false;
        app.setupPopupAutoPlayPause();
        document.getElementById('popup-overlay').style.display = 'flex';
        app.renderPopupSlide();
      })
      .catch(err => reportPublicError('Public popup load failed: ' + (err && err.message), err, {}));
  },

  renderPopupSlide: () => {
    const slide = app.popupSlides[app.popupIndex];
    if (!slide) return;
    const content = document.getElementById('popup-slide-content');
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
    app.scheduleAutoAdvance();
  },

  clampSlideDuration: (ms) => {
    var n = parseInt(ms, 10);
    if (!isFinite(n) || n <= 0) return 5000;
    if (n < 1000) return 1000;
    if (n > 60000) return 60000;
    return n;
  },

  clearAutoAdvance: () => {
    if (app._popupTimer) { clearTimeout(app._popupTimer); app._popupTimer = null; }
  },

  scheduleAutoAdvance: () => {
    app.clearAutoAdvance();
    if (app.popupSlides.length <= 1 || app._popupPaused) return;
    var slide = app.popupSlides[app.popupIndex];
    var ms = app.clampSlideDuration(slide && slide.duration_ms);
    app._popupTimer = setTimeout(function () {
      app._popupTimer = null;
      app.popupIndex = (app.popupIndex + 1) % app.popupSlides.length;
      app.renderPopupSlide();
    }, ms);
  },

  setupPopupAutoPlayPause: () => {
    var card = document.querySelector('#popup-overlay .popup-card');
    if (!card || card.dataset.autoplayBound === '1') return;
    card.dataset.autoplayBound = '1';
    var pause = function () { app._popupPaused = true; app.clearAutoAdvance(); };
    var resume = function () { app._popupPaused = false; app.scheduleAutoAdvance(); };
    card.addEventListener('mouseenter', pause);
    card.addEventListener('mouseleave', resume);
    card.addEventListener('touchstart', pause, { passive: true });
    card.addEventListener('touchend', resume, { passive: true });
    card.addEventListener('touchcancel', resume, { passive: true });
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
    app.clearAutoAdvance();
    document.getElementById('popup-overlay').style.display = 'none';
  },

  restoreViewFromHash: () => {
    if (new URLSearchParams(window.location.search).get('record')) return;
    const id = (window.location.hash || '').replace(/^#/, '').trim();
    const allowed = ['home', 'expenses', 'loans', 'committee', 'downloads'];
    if (id && allowed.includes(id)) app.nav(id);
  },

  nav: (viewId) => {
    const target = document.getElementById('view-' + viewId);
    if (!target) return;
    document.querySelectorAll('.page-view').forEach(e => e.classList.remove('active-view'));
    target.classList.add('active-view');
    document.querySelectorAll('.nav-btn').forEach(e => e.classList.remove('active'));
    document.querySelectorAll(`.nav-btn[data-target="${viewId}"]`).forEach(e => e.classList.add('active'));
    if (viewId !== 'verify') {
      try { history.replaceState(null, '', '#' + viewId); } catch (e) {  }
    }
    window.scrollTo(0,0);
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'pageview', page: '/' + viewId });
  },

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

  isResellRow: (r) => r && (r['Is Resell'] === true || r['Is Resell'] === 'TRUE' || (typeof r['Is Resell'] === 'string' && r['Is Resell'].trim().toLowerCase() === 'true')),

  renderHomeList: () => {
    const s = document.getElementById('home-search').value.toLowerCase();
    const html = app.currentData.col
      .filter(r => {
         if (app.isResellRow(r)) return (r.Detail || '').toLowerCase().includes(s);
         const u = app.getUser(r.ID || r.Name);
         return (u.Name || '').toLowerCase().includes(s)
            || (u['Name (Hindi)'] || '').toString().toLowerCase().includes(s);
      })
      .map(r => {
         const cType = (r['Contribution Type'] || 1).toString();
         const isMoney = cType === '1';
         const yrTag = app.currentData.isAll ? `<span class="yr-tag">[${escapeHtml(r.Year)}]</span>` : '';

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
         const rightSide = isMoney
            ? `<strong style="color:var(--success);">+${fmt(r.Amount)}</strong>`
            : `<div style="text-align:right;">
                 <span class="badge" style="background:#DBEAFE; color:#1E40AF;">${cType === '2' ? app.t('material') : app.t('service')}</span>
                 ${r.Detail ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px; max-width:150px;">${escapeHtml(r.Detail)}</div>` : ''}
               </div>`;

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

  renderCommittee: () => {
    const isAll = app.currentData.isAll;
    const targetCom = isAll ? app.data.committee : app.data.committee.filter(r => parseInt(r.Year) === app.currentData.tYear);
    const html = targetCom.map(r => {
       const u = app.getUser(r.ID || r.Name); 
       const nameStr = (app.localize(u, 'Name') || '').toString();
       const initial = (nameStr.charAt(0) || '?').toUpperCase();

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
                ${
''}
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
      .filter(u => !q
        || (u.Name || '').toLowerCase().includes(q)
        || (u['Name (Hindi)'] || '').toString().toLowerCase().includes(q))
      .slice(0, 50);

    const html = list.map(u => {
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

  onYearChange: () => {
    const wrap = document.getElementById('dc-docs-wrap');
    if (app.dcSelectedId) {
      app.dcSelectedId = null;
      if (wrap) wrap.innerHTML = '';
      const people = document.getElementById('dc-people-wrap');
      if (people) people.style.display = '';
    }
    app.refreshData();
  },

  buildPersonDownloads: (id) => {
    const isFileGenerated = (docType, year, recordId) => {
      return (app.data.generatedFiles || []).find(r =>
        r.doc_type === docType && parseInt(r.year) === year && r.record_id === recordId
      ) || null;
    };

    const collections = (app.data.collections || [])
      .filter(r => (r.ID || r.Name) === id)
      .filter(r => !(r['Is Resell'] === 'TRUE' || r['Is Resell'] === true))
      .map(entry => {
        const year = parseInt(entry.Year);
        const isSamaan = entry['Contribution Type'] === '2';
        const wantCert = !isSamaan && entry['Certificate Or Receipt'] === 'Certificate';
        const isWork = !isSamaan && !wantCert && (entry['Contribution Type'] || '').toString() === '3';
        const docType = isSamaan ? 'samaan' : (wantCert ? 'certificate' : (isWork ? 'receipt_work' : 'receipt'));
        const recordId = `${docType}-${year}-${entry.__rowIndex}`;
        const gen = isFileGenerated(docType, year, recordId);
        const label = `${app.t('doc_' + docType)} — ${year}${(!isSamaan && entry.Amount) ? ' — ' + fmt(entry.Amount) : ''}`;
        return { recordId, docType, year, label, publicLink: gen ? gen.public_link : null };
      })
      .sort((a, b) => b.year - a.year);

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

window.addEventListener('load', () => app.init());
