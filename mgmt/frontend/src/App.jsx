import { useEffect, useState, useMemo, Suspense, lazy } from 'react';
import { api, getSession, clearSession } from './api.js';
import { useViewData } from './useViewData.js';
import { setDataVersion, setCacheIdentity } from './cache.js';
import { isSuperadmin } from './permissions.js';
import Login from './components/Login.jsx';
import AppFooter from './components/AppFooter.jsx';
import Home from './views/Home.jsx';
const Expenses = lazy(() => import('./views/Expenses.jsx'));
const Loans = lazy(() => import('./views/Loans.jsx'));
const Users = lazy(() => import('./views/Users.jsx'));
const Committee = lazy(() => import('./views/Committee.jsx'));
const LoginManagement = lazy(() => import('./views/LoginManagement.jsx'));
const LockYears = lazy(() => import('./views/LockYears.jsx'));
const StorageManagement = lazy(() => import('./views/StorageManagement.jsx'));
const WhatsApp = lazy(() => import('./views/WhatsApp.jsx'));
const Email = lazy(() => import('./views/Email.jsx'));
const EmailOfficial = lazy(() => import('./views/EmailOfficial.jsx'));
const ListManagement = lazy(() => import('./views/ListManagement.jsx'));
const ConsentTemplates = lazy(() => import('./views/ConsentTemplates.jsx'));
const ConsentReview = lazy(() => import('./views/ConsentReview.jsx'));

const ErrorLog = lazy(() => import('./views/ErrorLog.jsx'));
const QueueMonitor = lazy(() => import('./views/QueueMonitor.jsx'));
const PopupManagement = lazy(() => import('./views/PopupManagement.jsx'));
const JourneyContent = lazy(() => import('./views/JourneyContent.jsx'));
const DonationSettings = lazy(() => import('./views/DonationSettings.jsx'));
const CustomNotification = lazy(() => import('./views/CustomNotification.jsx'));
const AnnouncementPortal = lazy(() => import('./views/AnnouncementPortal.jsx'));
const DocxTemplates = lazy(() => import('./views/DocxTemplates.jsx'));
const BulkGeneratePdfs = lazy(() => import('./views/BulkGeneratePdfs.jsx'));
const DownloadCenter = lazy(() => import('./views/DownloadCenter.jsx'));
const PdfExport = lazy(() => import('./views/PdfExport.jsx'));
const Backup = lazy(() => import('./views/Backup.jsx'));
const SeoSettings = lazy(() => import('./views/SeoSettings.jsx'));
const AuditLogs = lazy(() => import('./views/AuditLogs.jsx'));
const UploadCsvs = lazy(() => import('./views/UploadCsvs.jsx'));
const AiManagement = lazy(() => import('./views/AiManagement.jsx'));
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ProfileMenu from './components/ProfileMenu.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import Modal from './components/Modal.jsx';
import LoginPopups from './components/LoginPopups.jsx';

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
const EMAIL_TAB = { id: 'email', label: 'Mail (noreply)', icon: 'mail' };
const EMAIL_OFFICIAL_TAB = { id: 'emailofficial', label: 'Mail (official)', icon: 'alternate_email' };
const PDF_TAB = { id: 'pdfexport', label: 'PDF Export', icon: 'picture_as_pdf' };
const LIST_TAB = { id: 'lists', label: 'List Management', icon: 'list_alt' };
const CONSENT_TEMPLATES_TAB = { id: 'consenttemplates', label: 'Consent Templates', icon: 'gavel' };
const CONSENT_REVIEW_TAB = { id: 'consentreview', label: 'Consent Review', icon: 'fact_check' };

const ERROR_LOG_TAB = { id: 'errorlog', label: 'Error Log', icon: 'bug_report' };
const DOCX_TEMPLATES_TAB = { id: 'docxtemplates', label: 'Document Templates', icon: 'description' };
const BULK_GENERATE_TAB = { id: 'bulkgenerate', label: 'Generate PDFs', icon: 'auto_awesome_mosaic' };
const POPUP_MGMT_TAB = { id: 'popupmgmt', label: 'Popup Management', icon: 'campaign' };
const DOWNLOAD_CENTER_TAB = { id: 'downloadcenter', label: 'Download Center', icon: 'download' };
const STORAGE_TAB = { id: 'storage', label: 'Storage Management', icon: 'cloud' };
const BACKUP_TAB = { id: 'backup', label: 'Backup & Restore', icon: 'backup' };
const ANNOUNCEMENT_TAB = { id: 'announcementportal', label: 'Announcement Portal', icon: 'campaign' };
const QUEUE_MONITOR_TAB = { id: 'queuemonitor', label: 'Queue Monitor', icon: 'sync' };
const SEO_TAB = { id: 'seo', label: 'SEO & Link Preview', icon: 'travel_explore' };
const AUDIT_TAB = { id: 'auditlogs', label: 'Activity & Login Logs', icon: 'security' };
const UPLOAD_CSV_TAB = { id: 'uploadcsvs', label: 'Upload CSVs', icon: 'upload_file' };
const AI_MGMT_TAB = { id: 'aimanagement', label: 'AI Management', icon: 'smart_toy' };
const JOURNEY_TAB = { id: 'journeycontent', label: 'Journey Content', icon: 'timeline' };
const DONATION_TAB = { id: 'donation', label: 'Donation', icon: 'volunteer_activism' };
const CUSTOM_PUSH_TAB = { id: 'custompush', label: 'Custom Notification', icon: 'notifications_active' };
const SUPERADMIN_TAB_GROUPS = [
  { title: '📄 Documents & Templates', tabs: [DOCX_TEMPLATES_TAB, BULK_GENERATE_TAB, DOWNLOAD_CENTER_TAB, PDF_TAB] },
  { title: '🤝 Loan Consent', tabs: [CONSENT_TEMPLATES_TAB, CONSENT_REVIEW_TAB] },
  { title: '💬 Communication', tabs: [WHATSAPP_TAB, EMAIL_TAB, EMAIL_OFFICIAL_TAB, POPUP_MGMT_TAB, ANNOUNCEMENT_TAB, JOURNEY_TAB, CUSTOM_PUSH_TAB] },
  { title: '⚙️ Data & Settings', tabs: [LOCK_TAB, LIST_TAB, UPLOAD_CSV_TAB, STORAGE_TAB, BACKUP_TAB, QUEUE_MONITOR_TAB, ERROR_LOG_TAB, AI_MGMT_TAB, LOGIN_MGMT_TAB, SEO_TAB, DONATION_TAB, AUDIT_TAB] },
];
const ADMIN_ROLE_TAB_GROUPS = [
  { title: '📄 Documents & Templates', tabs: [DOWNLOAD_CENTER_TAB, PDF_TAB] },
  { title: '🤝 Loan Consent', tabs: [CONSENT_REVIEW_TAB] },
  { title: '💬 Communication', tabs: [POPUP_MGMT_TAB, ANNOUNCEMENT_TAB, CUSTOM_PUSH_TAB] },
  { title: '⚙️ Data & Settings', tabs: [LOGIN_MGMT_TAB] },
];
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
  const [tab, setTab] = useState(() => {
    try {
      const h = (window.location.hash || '').replace(/^#/, '').trim();
      return h || 'home';
    } catch (e) { return 'home'; }
  });
  const [year, setYear] = useState('');
  const [yearInitialized, setYearInitialized] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdminMenu, setShowAdminMenu] = useState(false);

  useEffect(() => {
    try {
      const current = (window.location.hash || '').replace(/^#/, '').trim();
      if (current === tab) {
        window.history.replaceState(null, '', '#' + tab);
      } else {
        window.history.pushState(null, '', '#' + tab);
      }
    } catch (e) {  }
  }, [tab]);

  useEffect(() => {
    const onHashChange = () => {
      const h = (window.location.hash || '').replace(/^#/, '').trim() || 'home';
      const groups = user ? (TAB_GROUPS_BY_ROLE[user.role] || []) : [];
      const allowed = new Set([...BASE_TABS.map(t => t.id), ...groups.flatMap(g => g.tabs).map(t => t.id)]);
      const next = allowed.has(h) ? h : 'home';
      setTab(prev => (prev === next ? prev : next));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const groups = TAB_GROUPS_BY_ROLE[user.role] || [];
    const allowed = new Set([...BASE_TABS.map(t => t.id), ...groups.flatMap(g => g.tabs).map(t => t.id)]);
    if (!allowed.has(tab)) setTab('home');
  }, [user]);

  useEffect(() => {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'pageview', page: '/app/' + tab });
  }, [tab]);

  useEffect(() => {
    const session = getSession();
    if (session) {
      // audit P0-08: bind the view cache to this account before any view reads
      // it, so a mirror left by a different account is purged, not served.
      setCacheIdentity(`${session.user?.name}|${session.user?.role}`);
      setUser(session.user);
    }
    setCheckedSession(true);
  }, []);

  const { data: years, refresh: refreshYears } = useViewData('years', () => api.getYears(), [user]);

  const lockedYearsView = useViewData('lockedYears', () => api.getLockedYears(), [user]);
  const lockedYearsSet = useMemo(() => new Set(lockedYearsView.list.map(y => parseInt(y))), [lockedYearsView.data]);

  const usersView = useViewData('users', () => api.getUsers(), [user]);

  const committeeAllView = useViewData('committee:All', () => api.getCommittee('All'), [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.getDataVersion()
      .then(res => {
        if (cancelled) return;
        const v = res && res.v != null ? res.v.toString() : null;
        const stillValid = setDataVersion(v);
        if (!stillValid) {
          refreshYears();
          lockedYearsView.refresh();
          usersView.refresh();
          committeeAllView.refresh();
        }
      })
      .catch(() => {
        setDataVersion(null);
        refreshYears();
        lockedYearsView.refresh();
        usersView.refresh();
        committeeAllView.refresh();
      });
    return () => { cancelled = true; };
  }, [user]);

  const myCommitteeYears = useMemo(() => {
    const set = new Set();
    committeeAllView.list.forEach(r => {
      if (user && (r.Name || '').toString().trim() === user.name) set.add(parseInt(r.Year));
    });
    return set;
  }, [committeeAllView.data, user]);

  useEffect(() => {
    if (years && years.length && !yearInitialized) {
      setYear(String(years[0]));
      setYearInitialized(true);
    }
  }, [years, yearInitialized]);

  if (!checkedSession) return null;

  if (!user) {
    return <Login onLogin={(u) => { setCacheIdentity(`${u?.name}|${u?.role}`); setUser(u); setFreshLogin(true); }} />;
  }

  const toolTabGroups = TAB_GROUPS_BY_ROLE[user.role] || [];
  const toolTabs = toolTabGroups.flatMap(g => g.tabs);
  const canAccessTab = (id) => toolTabs.some(t => t.id === id);
  const TABS = toolTabGroups.length ? [...BASE_TABS, MORE_TAB] : BASE_TABS;
  const isAdminTabActive = toolTabs.some(t => t.id === tab);
  const openTab = (id) => { setTab(id); setShowAdminMenu(false); };

  const isAllYears = year === 'All';
  const isYearLocked = !isAllYears && lockedYearsSet.has(parseInt(year));
  const isMyCommitteeYear = isSuperadmin(user.role) || (!isAllYears && myCommitteeYears.has(parseInt(year)));
  const editable = !isAllYears && !isYearLocked && isMyCommitteeYear;

  const logout = async () => {
    try { await api.logout(); } catch (err) {  }
    clearSession();
    setUser(null);
  };

  return (
    <>
      <header className="top-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/logo.svg" alt="Navyuvak Chhath Puja Samiti" width="34" height="34" style={{ width: 34, height: 34, flex: 'none' }} />
          <select className="year-selector" value={year} onChange={e => setYear(e.target.value)}>
            {
}
            {!year && <option value="" disabled>Year…</option>}
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
          name={usersView.list.find(u => u.ID === user.name)?.Name || user.name}
          role={user.role}
          onOpenSettings={() => setShowSettings(true)}
          onLogout={logout}
        />
      </header>

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} userId={user.name} />

      <main className="page-view">
        {
}
        <ErrorBoundary key={tab} name={`tab:${tab}`}>
        {
}
        <Suspense fallback={<div className="inline-spinner">Loading...</div>}>
        {tab === 'home' && <Home year={year} users={usersView.data} onUserCreated={usersView.refresh} role={user.role} editable={editable} />}
        {tab === 'expenses' && <Expenses year={year} role={user.role} editable={editable} />}
        {tab === 'loans' && <Loans year={year} users={usersView.data} committee={committeeAllView.data} role={user.role} editable={editable} />}
        {tab === 'users' && <Users users={usersView.data} loading={usersView.loading} error={usersView.error} onRefresh={usersView.refresh} role={user.role} />}
        {tab === 'committee' && <Committee year={year} users={usersView.data} role={user.role} editable={editable} />}
        {tab === 'lock' && canAccessTab('lock') && <LockYears years={years} lockedYears={lockedYearsSet} onChange={lockedYearsView.refresh} onYearAdded={refreshYears} />}
        {tab === 'storage' && canAccessTab('storage') && <StorageManagement />}
        {tab === 'backup' && canAccessTab('backup') && <Backup />}
        {tab === 'whatsapp' && canAccessTab('whatsapp') && <WhatsApp role={user.role} />}
        {tab === 'email' && canAccessTab('email') && <Email role={user.role} />}
        {tab === 'emailofficial' && canAccessTab('emailofficial') && <EmailOfficial />}
        {tab === 'lists' && canAccessTab('lists') && <ListManagement />}
        {tab === 'consenttemplates' && canAccessTab('consenttemplates') && <ConsentTemplates />}
        {tab === 'consentreview' && canAccessTab('consentreview') && <ConsentReview />}

        {tab === 'errorlog' && canAccessTab('errorlog') && <ErrorLog role={user.role} />}
        {tab === 'queuemonitor' && canAccessTab('queuemonitor') && <QueueMonitor />}
        {tab === 'loginmgmt' && canAccessTab('loginmgmt') && <LoginManagement users={usersView.data} role={user.role} />}
        {tab === 'docxtemplates' && canAccessTab('docxtemplates') && <DocxTemplates />}
        {tab === 'bulkgenerate' && canAccessTab('bulkgenerate') && <BulkGeneratePdfs />}
        {tab === 'downloadcenter' && canAccessTab('downloadcenter') && <DownloadCenter role={user.role} />}
        {tab === 'popupmgmt' && canAccessTab('popupmgmt') && <PopupManagement />}
        {tab === 'journeycontent' && canAccessTab('journeycontent') && <JourneyContent />}
        {tab === 'announcementportal' && canAccessTab('announcementportal') && <AnnouncementPortal years={years} />}
        {tab === 'pdfexport' && canAccessTab('pdfexport') && <PdfExport />}
        {tab === 'seo' && canAccessTab('seo') && <SeoSettings />}
        {tab === 'donation' && canAccessTab('donation') && <DonationSettings />}
        {tab === 'custompush' && canAccessTab('custompush') && <CustomNotification />}
        {tab === 'auditlogs' && canAccessTab('auditlogs') && <AuditLogs role={user.role} />}
        {tab === 'aimanagement' && canAccessTab('aimanagement') && <AiManagement />}
        {tab === 'uploadcsvs' && canAccessTab('uploadcsvs') && <UploadCsvs />}
        </Suspense>
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

      <AppFooter />
    </>
  );
}
