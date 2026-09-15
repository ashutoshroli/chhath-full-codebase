<script lang="ts">
  // App shell — ported from React App.jsx: session gate + Login, header with
  // logo + year selector, desktop/bottom nav, role-based tool groups, and the
  // "More" tools modal. View bodies are filled in later phases; for now each
  // tab renders a placeholder so the shell, auth, nav and permissions are fully
  // working and reviewable. Tab config + role groups are ported verbatim.
  import { onMount } from 'svelte';
  import { api, getSession, clearSession } from '$lib/api';
  import { session, sessionEndedMessage } from '$lib/stores/session';
  import { setDataVersion, setCacheIdentity } from '$lib/cache';
  import { isSuperadmin } from '$lib/permissions';
  import { createViewData } from '$lib/viewData';
  import { isTruthyFlag } from '$lib/flags';
  import Login from '$lib/components/Login.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import AppFooter from '$lib/components/AppFooter.svelte';
  import Home from '$lib/views/Home.svelte';
  import Expenses from '$lib/views/Expenses.svelte';
  import Loans from '$lib/views/Loans.svelte';
  import Users from '$lib/views/Users.svelte';
  import Committee from '$lib/views/Committee.svelte';
  import DocxTemplates from '$lib/views/DocxTemplates.svelte';
  import BulkGeneratePdfs from '$lib/views/BulkGeneratePdfs.svelte';
  import AnnouncementPortal from '$lib/views/AnnouncementPortal.svelte';
  import ConsentReview from '$lib/views/ConsentReview.svelte';
  import ConsentTemplates from '$lib/views/ConsentTemplates.svelte';
  import Email from '$lib/views/Email.svelte';
  import EmailOfficial from '$lib/views/EmailOfficial.svelte';
  import WhatsApp from '$lib/views/WhatsApp.svelte';
  import PopupManagement from '$lib/views/PopupManagement.svelte';
  import JourneyContent from '$lib/views/JourneyContent.svelte';
  import QueueMonitor from '$lib/views/QueueMonitor.svelte';
  import LoginPopups from '$lib/components/LoginPopups.svelte';
  import DownloadCenter from '$lib/views/DownloadCenter.svelte';
  import LockYears from '$lib/views/LockYears.svelte';
  import StorageManagement from '$lib/views/StorageManagement.svelte';
  import Backup from '$lib/views/Backup.svelte';
  import ListManagement from '$lib/views/ListManagement.svelte';
  import LoginManagement from '$lib/views/LoginManagement.svelte';
  import SeoSettings from '$lib/views/SeoSettings.svelte';
  import DonationSettings from '$lib/views/DonationSettings.svelte';
  import CustomNotification from '$lib/views/CustomNotification.svelte';
  import AuditLogs from '$lib/views/AuditLogs.svelte';
  import AiManagement from '$lib/views/AiManagement.svelte';
  import UploadCsvs from '$lib/views/UploadCsvs.svelte';
  import ProfileMenu from '$lib/components/ProfileMenu.svelte';
  import SettingsModal from '$lib/components/SettingsModal.svelte';
  import PdfExport from '$lib/views/PdfExport.svelte';

  interface Tab { id: string; label: string; icon: string; }
  interface TabGroup { title: string; tabs: Tab[]; }

  const BASE_TABS: Tab[] = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'expenses', label: 'Expenses', icon: 'receipt_long' },
    { id: 'loans', label: 'Loans', icon: 'handshake' },
    { id: 'users', label: 'Users', icon: 'group' },
    { id: 'committee', label: 'Committee', icon: 'groups' }
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
  const MORE_TAB: Tab = { id: '__more__', label: 'More', icon: 'more_horiz' };

  const SUPERADMIN_TAB_GROUPS: TabGroup[] = [
    { title: '📄 Documents & Templates', tabs: [DOCX_TEMPLATES_TAB, BULK_GENERATE_TAB, DOWNLOAD_CENTER_TAB, PDF_TAB] },
    { title: '🤝 Loan Consent', tabs: [CONSENT_TEMPLATES_TAB, CONSENT_REVIEW_TAB] },
    { title: '💬 Communication', tabs: [WHATSAPP_TAB, EMAIL_TAB, EMAIL_OFFICIAL_TAB, POPUP_MGMT_TAB, ANNOUNCEMENT_TAB, JOURNEY_TAB, CUSTOM_PUSH_TAB] },
    { title: '⚙️ Data & Settings', tabs: [LOCK_TAB, LIST_TAB, UPLOAD_CSV_TAB, STORAGE_TAB, BACKUP_TAB, QUEUE_MONITOR_TAB, ERROR_LOG_TAB, AI_MGMT_TAB, LOGIN_MGMT_TAB, SEO_TAB, DONATION_TAB, AUDIT_TAB] }
  ];
  const ADMIN_ROLE_TAB_GROUPS: TabGroup[] = [
    { title: '📄 Documents & Templates', tabs: [DOWNLOAD_CENTER_TAB, PDF_TAB] },
    { title: '🤝 Loan Consent', tabs: [CONSENT_REVIEW_TAB] },
    { title: '💬 Communication', tabs: [POPUP_MGMT_TAB, ANNOUNCEMENT_TAB, CUSTOM_PUSH_TAB] },
    { title: '⚙️ Data & Settings', tabs: [LOGIN_MGMT_TAB] }
  ];
  const SUBADMIN_ROLE_TAB_GROUPS: TabGroup[] = [
    { title: '📄 Documents & Templates', tabs: [DOWNLOAD_CENTER_TAB] }
  ];
  const TAB_GROUPS_BY_ROLE: Record<string, TabGroup[]> = {
    Superadmin: SUPERADMIN_TAB_GROUPS,
    Admin: ADMIN_ROLE_TAB_GROUPS,
    Subadmin: SUBADMIN_ROLE_TAB_GROUPS
  };
  const MENU_TITLE_BY_ROLE: Record<string, string> = {
    Superadmin: 'Superadmin Tools',
    Admin: 'Admin Tools',
    Subadmin: 'Subadmin Tools'
  };

  let checkedSession = $state(false);
  let freshLogin = $state(false);
  let year = $state('');
  let yearInitialized = $state(false);
  let showAdminMenu = $state(false);
  let tab = $state<string>('home');

  // audit P0-11: one definition of "which tab may this role open", used for the
  // INITIAL hash as well as later hash changes. The initial hash used to be
  // assigned verbatim, so `/#docxtemplates` as an Admin (or `/#garbage`) left the
  // shell rendering nothing at all instead of falling back to Home.
  function resolveAllowedTab(rawHash: string, role: string | undefined): string {
    const h = (rawHash || '').replace(/^#/, '').trim() || 'home';
    const groups = role ? TAB_GROUPS_BY_ROLE[role] || [] : [];
    const allowed = new Set([...BASE_TABS.map((t) => t.id), ...groups.flatMap((g) => g.tabs).map((t) => t.id)]);
    return allowed.has(h) ? h : 'home';
  }

  onMount(() => {
    const s = getSession();
    if (s) session.login(s.user!);
    try {
      tab = resolveAllowedTab(window.location.hash, s?.user?.role);
    } catch { /* ignore */ }
    checkedSession = true;

    const onHashChange = () => {
      const next = resolveAllowedTab(window.location.hash, $session?.role);
      if (tab !== next) tab = next;
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  });

  // If the session ends (expiry, remote sign-out, a revoked device), the store is
  // cleared by the API layer's auth-expired event. Tear the shell state down so a
  // later sign-in starts clean instead of reusing another account's view stores.
  $effect(() => {
    if ($session) return;
    started = false;
    yearInitialized = false;
    showSettings = false;
    showAdminMenu = false;
    tab = 'home';
  });

  // Keep the URL hash in sync with the active tab.
  $effect(() => {
    try {
      const current = (window.location.hash || '').replace(/^#/, '').trim();
      if (current === tab) window.history.replaceState(null, '', '#' + tab);
      else window.history.pushState(null, '', '#' + tab);
    } catch { /* ignore */ }
  });

  // Data views (shared, cache-first) — created once we have a user.
  let years = $state<string[]>([]);
  let lockedYearsSet = $state<Set<number>>(new Set());
  let usersList = $state<any[]>([]);
  let usersLoading = $state(true);
  let usersError = $state('');
  let committeeAll = $state<any[]>([]);
  let refreshUsers = $state<() => void>(() => {});
  let refreshYears = $state<() => void>(() => {});
  let refreshLockedYears = $state<() => void>(() => {});
  let showSettings = $state(false);

  let started = false;
  $effect(() => {
    const user = $session;
    if (!user || started) return;
    started = true;

    // audit P0-08: bind the view cache to THIS account before any view can read
    // from it. A different account (or the same account with a changed role)
    // purges the persisted rows instead of hydrating them, so one operator can
    // never be served the previous operator's Users / finance data on a shared
    // browser. Role is part of the identity because it decides what the cached
    // responses contained.
    setCacheIdentity(`${user.name}|${user.role}`);

    const yearsView = createViewData<string[]>('years', () => api.getYears());
    const lockedView = createViewData<any[]>('lockedYears', () => api.getLockedYears());
    const usersView = createViewData<any[]>('users', () => api.getUsers());
    const committeeView = createViewData<any[]>('committee:All', () => api.getCommittee('All'));
    refreshUsers = () => usersView.refresh();
    refreshYears = () => yearsView.refresh();
    refreshLockedYears = () => lockedView.refresh();

    yearsView.subscribe((v) => {
      years = Array.isArray(v.data) ? v.data : [];
      if (years.length && !yearInitialized) {
        year = String(years[0]);
        yearInitialized = true;
      }
    });
    lockedView.subscribe((v) => {
      lockedYearsSet = new Set((v.list as any[]).map((y) => parseInt(y)));
    });
    usersView.subscribe((v) => {
      usersList = v.list as any[];
      usersLoading = v.loading;
      usersError = v.error;
    });
    committeeView.subscribe((v) => (committeeAll = v.list as any[]));

    // Data-version check → invalidate caches if the backend moved on.
    api
      .getDataVersion()
      .then((res: any) => {
        const v = res && res.v != null ? res.v.toString() : null;
        const stillValid = setDataVersion(v);
        if (!stillValid) {
          yearsView.refresh();
          lockedView.refresh();
          usersView.refresh();
          committeeView.refresh();
        }
      })
      .catch(() => {
        setDataVersion(null);
        yearsView.refresh();
        lockedView.refresh();
        usersView.refresh();
        committeeView.refresh();
      });
  });

  let myCommitteeYears = $derived.by(() => {
    const set = new Set<number>();
    const user = $session;
    committeeAll.forEach((r: any) => {
      if (user && (r.Name || '').toString().trim() === user.name) set.add(parseInt(r.Year));
    });
    return set;
  });

  let toolTabGroups = $derived($session ? TAB_GROUPS_BY_ROLE[$session.role] || [] : []);
  let toolTabs = $derived(toolTabGroups.flatMap((g) => g.tabs));
  let TABS = $derived(toolTabGroups.length ? [...BASE_TABS, MORE_TAB] : BASE_TABS);
  let isAdminTabActive = $derived(toolTabs.some((t) => t.id === tab));
  const canAccessTab = (id: string) => toolTabs.some((t) => t.id === id);

  let isAllYears = $derived(year === 'All');
  let isYearLocked = $derived(!isAllYears && lockedYearsSet.has(parseInt(year)));
  let isMyCommitteeYear = $derived(
    $session ? isSuperadmin($session.role) || (!isAllYears && myCommitteeYears.has(parseInt(year))) : false
  );
  let editable = $derived(!isAllYears && !isYearLocked && isMyCommitteeYear);

  let displayName = $derived(
    usersList.find((u: any) => u.ID === $session?.name)?.Name || $session?.name || ''
  );

  function openTab(id: string) {
    tab = id;
    showAdminMenu = false;
  }

  async function logout() {
    try { await api.logout(); } catch { /* ignore */ }
    clearSession();
    session.clear();
    started = false;
    yearInitialized = false;
  }

</script>

{#if !checkedSession}
  <!-- match React: render nothing until the session check completes -->
{:else if !$session}
  {#if $sessionEndedMessage}
    <div class="error-banner" role="status" style="max-width:420px; margin:16px auto 0;">
      {$sessionEndedMessage}
    </div>
  {/if}
  <Login onLogin={(u) => { session.login(u); freshLogin = true; }} />
{:else}
  <header class="top-header">
    <div style="display:flex; align-items:center; gap:10px;">
      <img src="/logo.svg" alt="Navyuvak Chhath Puja Samiti" width="34" height="34" style="width:34px; height:34px; flex:none;" />
      <select class="year-selector" bind:value={year}>
        {#if !year}<option value="" disabled>Year…</option>{/if}
        {#each years as y}
          <option value={y}>{y}{lockedYearsSet.has(parseInt(y)) ? ' 🔒' : ''}</option>
        {/each}
      </select>
    </div>
    <nav class="desktop-nav">
      {#each TABS as t}
        <button
          class="nav-btn {(t.id === MORE_TAB.id ? isAdminTabActive : tab === t.id) ? 'active' : ''}"
          onclick={() => (t.id === MORE_TAB.id ? (showAdminMenu = true) : (tab = t.id))}
        >
          {t.label}
        </button>
      {/each}
    </nav>
    <ProfileMenu
      name={displayName}
      role={$session.role}
      onOpenSettings={() => (showSettings = true)}
      onLogout={logout}
    />
  </header>

  <SettingsModal open={showSettings} onClose={() => (showSettings = false)} userId={$session.name} />

  <main class="page-view">
    {#if tab === 'home'}
      <Home {year} users={usersList} onUserCreated={refreshUsers} role={$session.role} {editable} />
    {:else if tab === 'expenses'}
      <Expenses {year} role={$session.role} {editable} />
    {:else if tab === 'loans'}
      <Loans {year} users={usersList} committee={committeeAll} role={$session.role} {editable} />
    {:else if tab === 'users'}
      <Users users={usersList} loading={usersLoading} error={usersError} onRefresh={refreshUsers} role={$session.role} />
    {:else if tab === 'committee'}
      <Committee {year} users={usersList} role={$session.role} {editable} />
    {:else if tab === 'docxtemplates' && canAccessTab('docxtemplates')}
      <DocxTemplates />
    {:else if tab === 'bulkgenerate' && canAccessTab('bulkgenerate')}
      <BulkGeneratePdfs />
    {:else if tab === 'downloadcenter' && canAccessTab('downloadcenter')}
      <DownloadCenter role={$session.role} />
    {:else if tab === 'pdfexport' && canAccessTab('pdfexport')}
      <PdfExport />
    {:else if tab === 'consenttemplates' && canAccessTab('consenttemplates')}
      <ConsentTemplates />
    {:else if tab === 'consentreview' && canAccessTab('consentreview')}
      <ConsentReview />
    {:else if tab === 'whatsapp' && canAccessTab('whatsapp')}
      <WhatsApp role={$session.role} />
    {:else if tab === 'email' && canAccessTab('email')}
      <Email role={$session.role} />
    {:else if tab === 'emailofficial' && canAccessTab('emailofficial')}
      <EmailOfficial />
    {:else if tab === 'popupmgmt' && canAccessTab('popupmgmt')}
      <PopupManagement />
    {:else if tab === 'journeycontent' && canAccessTab('journeycontent')}
      <JourneyContent />
    {:else if tab === 'announcementportal' && canAccessTab('announcementportal')}
      <AnnouncementPortal {years} />
    {:else if tab === 'queuemonitor' && canAccessTab('queuemonitor')}
      <QueueMonitor />
    {:else if tab === 'lock' && canAccessTab('lock')}
      <LockYears {years} lockedYears={lockedYearsSet} onChange={refreshLockedYears} onYearAdded={refreshYears} />
    {:else if tab === 'storage' && canAccessTab('storage')}
      <StorageManagement />
    {:else if tab === 'backup' && canAccessTab('backup')}
      <Backup />
    {:else if tab === 'lists' && canAccessTab('lists')}
      <ListManagement />
    {:else if tab === 'loginmgmt' && canAccessTab('loginmgmt')}
      <LoginManagement users={usersList} role={$session.role} />
    {:else if tab === 'seo' && canAccessTab('seo')}
      <SeoSettings />
    {:else if tab === 'donation' && canAccessTab('donation')}
      <DonationSettings />
    {:else if tab === 'custompush' && canAccessTab('custompush')}
      <CustomNotification />
    {:else if tab === 'auditlogs' && canAccessTab('auditlogs')}
      <AuditLogs role={$session.role} />
    {:else if tab === 'aimanagement' && canAccessTab('aimanagement')}
      <AiManagement />
    {:else if tab === 'uploadcsvs' && canAccessTab('uploadcsvs')}
      <UploadCsvs />
    {:else if canAccessTab(tab)}
      <div class="glass-card" style="text-align:center; padding:40px 20px;">
        <span class="material-icons-round" style="font-size:40px; color:var(--primary-saffron);">construction</span>
        <h3 style="margin:12px 0 4px;">{[...BASE_TABS, ...toolTabs].find((t) => t.id === tab)?.label || tab}</h3>
        <p style="color:var(--text-muted); font-size:0.9rem;">
          This tool is being migrated to the new Svelte portal in a later phase. The shell, login, navigation, roles and year selector are live now.
        </p>
        <p style="color:var(--text-muted); font-size:0.8rem; margin-top:8px;">
          Year: <strong>{year || '—'}</strong> · Editable: <strong>{editable ? 'yes' : 'no'}</strong>
        </p>
      </div>
    {/if}
  </main>

  <nav class="bottom-nav">
    {#each TABS as t}
      <button
        class="nav-btn {(t.id === MORE_TAB.id ? isAdminTabActive : tab === t.id) ? 'active' : ''}"
        onclick={() => (t.id === MORE_TAB.id ? (showAdminMenu = true) : (tab = t.id))}
      >
        <span class="material-icons-round">{t.icon}</span>{t.label}
      </button>
    {/each}
  </nav>

  <Modal open={showAdminMenu} onClose={() => (showAdminMenu = false)}>
    <h3 style="margin-bottom:15px;">{MENU_TITLE_BY_ROLE[$session.role] || 'Tools'}</h3>
    <div style="display:flex; flex-direction:column; gap:18px;">
      {#each toolTabGroups as group (group.title)}
        <div>
          <div style="font-size:0.8rem; font-weight:600; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase; letter-spacing:0.02em;">
            {group.title}
          </div>
          <div style="display:flex; flex-direction:column; gap:8px;">
            {#each group.tabs as t (t.id)}
              <button
                onclick={() => openTab(t.id)}
                style="display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:10px; border:none; text-align:left; cursor:pointer; font-size:0.95rem;
                  background:{tab === t.id ? 'var(--primary-saffron)' : '#f3f4f6'}; color:{tab === t.id ? '#fff' : '#111827'};"
              >
                <span class="material-icons-round">{t.icon}</span>{t.label}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </Modal>

  {#if freshLogin}<LoginPopups />{/if}

  <AppFooter />
{/if}
