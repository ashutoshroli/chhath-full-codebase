import { useEffect, useState, useMemo, Suspense, lazy } from 'react';
import { api, getSession, clearSession } from './api.js';
import { useViewData } from './useViewData.js';
import { isSuperadmin } from './permissions.js';
import Login from './components/Login.jsx';
import Home from './views/Home.jsx';
import Expenses from './views/Expenses.jsx';
import Loans from './views/Loans.jsx';
import Users from './views/Users.jsx';
import Committee from './views/Committee.jsx';
import LoginManagement from './views/LoginManagement.jsx';
import LockYears from './views/LockYears.jsx';
import WhatsApp from './views/WhatsApp.jsx';
import ListManagement from './views/ListManagement.jsx';
import ConsentTemplates from './views/ConsentTemplates.jsx';
import ConsentReview from './views/ConsentReview.jsx';
import ReceiptTemplates from './views/ReceiptTemplates.jsx';
import CertificateTemplates from './views/CertificateTemplates.jsx';
import SamaanTemplates from './views/SamaanTemplates.jsx';
import ErrorLog from './views/ErrorLog.jsx';
// docxtemplater+pizzip (used to fill .docx templates) are lazy — only Superadmin
// on these tabs (or someone downloading a Receipt/Certificate/Consent PDF) needs them.
const DocxTemplates = lazy(() => import('./views/DocxTemplates.jsx'));
const BulkGeneratePdfs = lazy(() => import('./views/BulkGeneratePdfs.jsx'));
const DownloadCenter = lazy(() => import('./views/DownloadCenter.jsx'));
// Lazy-loaded — pulls in jsPDF (heavy), only needed by Superadmin on this one tab.
const PdfExport = lazy(() => import('./views/PdfExport.jsx'));
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ProfileMenu from './components/ProfileMenu.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import Modal from './components/Modal.jsx';
import LoginPopups from './components/LoginPopups.jsx';
import PopupManagement from './views/PopupManagement.jsx';
import AnnouncementPortal from './views/AnnouncementPortal.jsx';

const BASE_TABS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'expenses', label: 'Expenses', icon: 'receipt_long' },
  { id: 'loans', label: 'Loans', icon: 'handshake' },
  { id: 'users', label: 'Users', icon: 'group' },
  { id: 'committee', label: 'Committee', icon: 'groups' },
];
const LOCK_TAB = { id: 'lock', label: 'Lock Data', icon: 'lock' };
const LOGIN_MGMT_TAB = { id: 'loginmgmt', label: 'Login Management', icon: 'key' };
const WHATSAPP_TAB = { id: 'whatsapp', label: 'WhatsApp', icon: 'chat' };
const PDF_TAB = { id: 'pdfexport', label: 'PDF Export', icon: 'picture_as_pdf' };
const LIST_TAB = { id: 'lists', label: 'List Management', icon: 'list_alt' };
const CONSENT_TEMPLATES_TAB = { id: 'consenttemplates', label: 'Consent Templates', icon: 'gavel' };
const CONSENT_REVIEW_TAB = { id: 'consentreview', label: 'Consent Review', icon: 'fact_check' };
const RECEIPT_TEMPLATES_TAB = { id: 'receipttemplates', label: 'Receipt Templates', icon: 'receipt_long' };
const CERTIFICATE_TEMPLATES_TAB = { id: 'certificatetemplates', label: 'Certificate Templates', icon: 'workspace_premium' };
const SAMAAN_TEMPLATES_TAB = { id: 'samaantemplates', label: 'Material Templates', icon: 'redeem' };
const ERROR_LOG_TAB = { id: 'errorlog', label: 'Error Log', icon: 'bug_report' };
const DOCX_TEMPLATES_TAB = { id: 'docxtemplates', label: 'Document Templates', icon: 'description' };
const BULK_GENERATE_TAB = { id: 'bulkgenerate', label: 'Generate PDFs', icon: 'auto_awesome_mosaic' };
const POPUP_MGMT_TAB = { id: 'popupmgmt', label: 'Popup Management', icon: 'campaign' };
const DOWNLOAD_CENTER_TAB = { id: 'downloadcenter', label: 'Download Center', icon: 'download' };
const ANNOUNCEMENT_TAB = { id: 'announcementportal', label: 'Announcement Portal', icon: 'campaign' };
// Superadmin: everything below, tucked behind a single "More" button instead of
// crowding the nav bar (there'd be 14 tabs otherwise). Grouped into categories
// so the More menu is scannable instead of one long flat list.
const SUPERADMIN_TAB_GROUPS = [
  { title: '📄 Documents & Templates', tabs: [RECEIPT_TEMPLATES_TAB, CERTIFICATE_TEMPLATES_TAB, SAMAAN_TEMPLATES_TAB, DOCX_TEMPLATES_TAB, BULK_GENERATE_TAB, DOWNLOAD_CENTER_TAB, PDF_TAB] },
  { title: '🤝 Loan Consent', tabs: [CONSENT_TEMPLATES_TAB, CONSENT_REVIEW_TAB] },
  { title: '💬 Communication', tabs: [WHATSAPP_TAB, POPUP_MGMT_TAB, ANNOUNCEMENT_TAB] },
  { title: '⚙️ Data & Settings', tabs: [LOCK_TAB, LIST_TAB, ERROR_LOG_TAB, LOGIN_MGMT_TAB] },
];
// Admin: a smaller subset — no data-editing/config tools (Templates, Lock Data,
// WhatsApp, List Management, Error Log), and Download Center is view/download
// only (no manual "Generate Now" — that stays Superadmin-only within the tab
// itself). Login Management here can only ADD a Subadmin login (view is
// read-only, no edit/delete) — also enforced within the tab itself.
const ADMIN_ROLE_TAB_GROUPS = [
  { title: '📄 Documents & Templates', tabs: [DOWNLOAD_CENTER_TAB, PDF_TAB] },
  { title: '🤝 Loan Consent', tabs: [CONSENT_REVIEW_TAB] },
  { title: '💬 Communication', tabs: [POPUP_MGMT_TAB, ANNOUNCEMENT_TAB] },
  { title: '⚙️ Data & Settings', tabs: [LOGIN_MGMT_TAB] },
];
// Subadmin: just Download Center (view/download only, same as Admin).
const SUBADMIN_ROLE_TAB_GROUPS = [
  { title: '📄 Documents & Templates', tabs: [DOWNLOAD_CENTER_TAB] },
];
const TAB_GROUPS_BY_ROLE = { Superadmin: SUPERADMIN_TAB_GROUPS, Admin: ADMIN_ROLE_TAB_GROUPS, Subadmin: SUBADMIN_ROLE_TAB_GROUPS };
const MENU_TITLE_BY_ROLE = { Superadmin: 'Superadmin Tools', Admin: 'Admin Tools', Subadmin: 'Subadmin Tools' };
const MORE_TAB = { id: '__more__', label: 'More', icon: 'more_horiz' };

export default function App() {
  const [user, setUser] = useState(null);
  const [checkedSession, setCheckedSession] = useState(false);
  const [freshLogin, setFreshLogin] = useState(false);
  const [tab, setTab] = useState('home');
  const [year, setYear] = useState('All');
  const [yearInitialized, setYearInitialized] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdminMenu, setShowAdminMenu] = useState(false);

  // Tab switching inside the authenticated portal is internal React state, not
  // a URL route change (see the single "*" route in main.jsx) — so GTM's
  // History Change trigger never fires for it. This pushes a `pageview` event
  // to dataLayer every time `tab` changes, giving GA4/Clarity real per-screen
  // visibility (Home, Users, Loans, ...) instead of one pageview for the whole
  // session. Same dataLayer event name/shape as main.jsx's route-level tracker.
  useEffect(() => {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'pageview', page: '/app/' + tab });
  }, [tab]);

  useEffect(() => {
    const session = getSession();
    if (session) setUser(session.user);
    setCheckedSession(true);
  }, []);

  // Years list — small, cheap, fetched once after login. Sorted newest-first by backend.
  const { data: years, refresh: refreshYears } = useViewData('years', () => api.getYears(), [user]);

  // Locked years — Superadmin's "Lock Data" list. Affects add/edit/delete everywhere.
  const lockedYearsView = useViewData('lockedYears', () => api.getLockedYears(), [user]);
  const lockedYearsSet = useMemo(() => new Set((lockedYearsView.data || []).map(y => parseInt(y))), [lockedYearsView.data]);

  // Users list — needed for name lookups across every view, fetched once (not per-tab) but only after login.
  const usersView = useViewData('users', () => api.getUsers(), [user]);

  // Committee (all years) — needed by Loans view to block committee members as guarantors.
  const committeeAllView = useViewData('committee:All', () => api.getCommittee('All'), [user]);

  // Which years the logged-in user themselves was a Committee member in — used
  // to gate add/edit/delete for Admin/Subadmin (rule: they can only touch years
  // they were actually on the committee for; other years are read-only to them).
  const myCommitteeYears = useMemo(() => {
    const set = new Set();
    (committeeAllView.data || []).forEach(r => {
      if (user && (r.Name || '').toString().trim() === user.name) set.add(parseInt(r.Year));
    });
    return set;
  }, [committeeAllView.data, user]);

  // Default the year selector to the latest year once years load (instead of "All Years").
  useEffect(() => {
    if (years && years.length && !yearInitialized) {
      setYear(String(years[0]));
      setYearInitialized(true);
    }
  }, [years, yearInitialized]);

  if (!checkedSession) return null;

  if (!user) {
    return <Login onLogin={(u) => { setUser(u); setFreshLogin(true); }} />;
  }

  const toolTabGroups = TAB_GROUPS_BY_ROLE[user.role] || [];
  const toolTabs = toolTabGroups.flatMap(g => g.tabs);
  const canAccessTab = (id) => toolTabs.some(t => t.id === id);
  const TABS = toolTabGroups.length ? [...BASE_TABS, MORE_TAB] : BASE_TABS;
  const isAdminTabActive = toolTabs.some(t => t.id === tab);
  const openTab = (id) => { setTab(id); setShowAdminMenu(false); };

  // A specific year is editable (add/edit/delete) only when it's actually selected
  // (not "All Years"), a Superadmin hasn't locked it, and — for Admin/Subadmin —
  // the logged-in user was themselves a Committee member that year. "All Years"
  // and locked years are read-only everywhere except Users (Users has no Year,
  // unaffected by any of this).
  const isAllYears = year === 'All';
  const isYearLocked = !isAllYears && lockedYearsSet.has(parseInt(year));
  const isMyCommitteeYear = isSuperadmin(user.role) || (!isAllYears && myCommitteeYears.has(parseInt(year)));
  const editable = !isAllYears && !isYearLocked && isMyCommitteeYear;

  const logout = async () => {
    try { await api.logout(); } catch (err) { /* even if this fails, still clear locally */ }
    clearSession();
    setUser(null);
  };

  return (
    <>
      <header className="top-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select className="year-selector" value={year} onChange={e => setYear(e.target.value)}>
            <option value="All">All Years</option>
            {(years || []).map(y => (
              <option key={y} value={y}>{y}{lockedYearsSet.has(parseInt(y)) ? ' 🔒' : ''}</option>
            ))}
          </select>
        </div>
        <nav className="desktop-nav">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`nav-btn ${(t.id === MORE_TAB.id ? isAdminTabActive : tab === t.id) ? 'active' : ''}`}
              onClick={() => t.id === MORE_TAB.id ? setShowAdminMenu(true) : setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <ProfileMenu
          name={(usersView.data || []).find(u => u.ID === user.name)?.Name || user.name}
          role={user.role}
          onOpenSettings={() => setShowSettings(true)}
          onLogout={logout}
        />
      </header>

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} userId={user.name} />

      <main className="page-view">
        {/* There was no ErrorBoundary anywhere, so one render throw white-screened
            the entire app and was only "logged" as a stackless "Script error.".
            Keyed on `tab` so navigating away resets the boundary rather than
            leaving it permanently stuck in its error state. */}
        <ErrorBoundary key={tab} name={`tab:${tab}`}>
        {tab === 'home' && <Home year={year} users={usersView.data} onUserCreated={usersView.refresh} role={user.role} editable={editable} />}
        {tab === 'expenses' && <Expenses year={year} role={user.role} editable={editable} />}
        {tab === 'loans' && <Loans year={year} users={usersView.data} committee={committeeAllView.data} role={user.role} editable={editable} />}
        {tab === 'users' && <Users users={usersView.data} loading={usersView.loading} error={usersView.error} onRefresh={usersView.refresh} role={user.role} />}
        {tab === 'committee' && <Committee year={year} users={usersView.data} role={user.role} editable={editable} />}
        {tab === 'lock' && canAccessTab('lock') && <LockYears years={years} lockedYears={lockedYearsSet} onChange={lockedYearsView.refresh} onYearAdded={refreshYears} />}
        {tab === 'whatsapp' && canAccessTab('whatsapp') && <WhatsApp />}
        {tab === 'lists' && canAccessTab('lists') && <ListManagement />}
        {tab === 'consenttemplates' && canAccessTab('consenttemplates') && <ConsentTemplates />}
        {tab === 'consentreview' && canAccessTab('consentreview') && <ConsentReview />}
        {tab === 'receipttemplates' && canAccessTab('receipttemplates') && <ReceiptTemplates />}
        {tab === 'certificatetemplates' && canAccessTab('certificatetemplates') && <CertificateTemplates />}
        {tab === 'samaantemplates' && canAccessTab('samaantemplates') && <SamaanTemplates />}
        {tab === 'errorlog' && canAccessTab('errorlog') && <ErrorLog />}
        {tab === 'loginmgmt' && canAccessTab('loginmgmt') && <LoginManagement users={usersView.data} role={user.role} />}
        {tab === 'docxtemplates' && canAccessTab('docxtemplates') && (
          <Suspense fallback={<div className="inline-spinner">Loading...</div>}>
            <DocxTemplates />
          </Suspense>
        )}
        {tab === 'bulkgenerate' && canAccessTab('bulkgenerate') && (
          <Suspense fallback={<div className="inline-spinner">Loading...</div>}>
            <BulkGeneratePdfs />
          </Suspense>
        )}
        {tab === 'downloadcenter' && canAccessTab('downloadcenter') && (
          <Suspense fallback={<div className="inline-spinner">Loading...</div>}>
            <DownloadCenter role={user.role} />
          </Suspense>
        )}
        {tab === 'popupmgmt' && canAccessTab('popupmgmt') && <PopupManagement />}
        {tab === 'announcementportal' && canAccessTab('announcementportal') && <AnnouncementPortal years={years} />}
        {tab === 'pdfexport' && canAccessTab('pdfexport') && (
          <Suspense fallback={<div className="inline-spinner">Loading...</div>}>
            <PdfExport />
          </Suspense>
        )}
        </ErrorBoundary>
      </main>

      <nav className="bottom-nav">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`nav-btn ${(t.id === MORE_TAB.id ? isAdminTabActive : tab === t.id) ? 'active' : ''}`}
            onClick={() => t.id === MORE_TAB.id ? setShowAdminMenu(true) : setTab(t.id)}
          >
            <span className="material-icons-round">{t.icon}</span>{t.label}
          </button>
        ))}
      </nav>

      <Modal open={showAdminMenu} onClose={() => setShowAdminMenu(false)}>
        <h3 style={{ marginBottom: 15 }}>{MENU_TITLE_BY_ROLE[user.role] || 'Tools'}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {toolTabGroups.map(group => (
            <div key={group.title}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                {group.title}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {group.tabs.map(t => (
                  <button
                    key={t.id}
                    onClick={() => openTab(t.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10,
                      border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: '0.95rem',
                      background: tab === t.id ? 'var(--primary-saffron)' : '#f3f4f6',
                      color: tab === t.id ? '#fff' : '#111827',
                    }}
                  >
                    <span className="material-icons-round">{t.icon}</span>{t.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {freshLogin && <LoginPopups />}
    </>
  );
}
