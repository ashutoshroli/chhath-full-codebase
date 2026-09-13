<script lang="ts">
  // Ported from React views/AnnouncePage.jsx (public /announce/:token route) —
  // PIN gate, then a queue of announcements (normal + priority) navigated
  // prev/next, mark-announced, re-announce, with a 15s live poll.
  import { page } from '$app/stores';
  import { api } from '$lib/api';
  import { startPolling } from '$lib/polling';
  import ReportErrorButton from '$lib/components/ReportErrorButton.svelte';
  import AnnounceBox from '$lib/components/announce/AnnounceBox.svelte';

  const STATUS_OPTIONS: [string, string][] = [['All', 'All'], ['Not Announced', 'Not Announced'], ['Announced', 'Announced']];
  const TYPE_OPTIONS: [string, string][] = [['All', 'All'], ['Paisa', 'Cash'], ['Kaam', 'Service'], ['Saman', 'Material'], ['Resell', 'Resell'], ['Custom', 'Custom']];
  const POLL_MS = 15000;
  const pageStyle = 'min-height:100vh; background:var(--bg-offwhite); padding:20px 15px;';

  let token = $derived($page.params.token ?? '');
  let storageKey = $derived(`announce_session_${token}`);

  let pin = $state('');
  let pinError = $state('');
  let sessionPersistWarning = $state(false);
  let linkExpired = $state(false);
  let verifying = $state(false);
  let announceToken = $state<string | null>(null);
  let year = $state<string | null>(null);
  let restoring = $state(true);

  let statusFilter = $state('All');
  let typeFilter = $state('All');
  let items = $state<any[]>([]);
  let pollFailed = $state(false);
  let priorityQueue = $state<any[]>([]);
  let normalIndex = $state(0);
  let priorityPointer = $state(-1);
  let boxOrder = $state(['hindi', 'english']);
  let loading = $state(false);
  let marking = $state(false);
  let error = $state('');

  let skipNextLoad = false;

  let pageEl: HTMLDivElement | undefined = $state();
  let topBarEl: HTMLDivElement | undefined = $state();
  let bottomBarEl: HTMLDivElement | undefined = $state();

  // Restore any saved session (matches useEffect [storageKey]).
  let restored = false;
  $effect(() => {
    void storageKey;
    if (restored) return;
    restored = true;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.announceToken) {
          announceToken = parsed.announceToken;
          year = parsed.year;
        }
      }
    } catch (e) { /* ignore */ }
    restoring = false;
  });

  async function submitPin() {
    if (!pin.trim()) return;
    verifying = true;
    pinError = '';
    try {
      const res: any = await api.verifyAnnouncementPin(token, pin.trim());
      items = res.items || [];
      priorityQueue = res.priorityItems || [];
      normalIndex = 0;
      priorityPointer = -1;
      skipNextLoad = true;
      announceToken = res.announceToken;
      year = res.year;
      try {
        sessionStorage.setItem(storageKey, JSON.stringify({ announceToken: res.announceToken, year: res.year }));
      } catch (e) {
        sessionPersistWarning = true;
      }
    } catch (err) {
      if ((err as any).expired) linkExpired = true;
      pinError = (err as Error).message;
    } finally {
      verifying = false;
    }
  }

  function handleSessionExpiry(err: any): boolean {
    if (err.announceSessionExpired) {
      announceToken = null;
      pinError = err.message;
      try { sessionStorage.removeItem(storageKey); } catch (e) { /* ignore */ }
      return true;
    }
    return false;
  }

  function loadQueue(resetPointer: boolean) {
    if (!announceToken) return;
    if (skipNextLoad) { skipNextLoad = false; return; }
    loading = true;
    api.getAnnouncementQueue(announceToken, statusFilter, typeFilter)
      .then((res: any) => {
        items = res.items || [];
        priorityQueue = res.priorityItems || [];
        if (resetPointer) { normalIndex = 0; priorityPointer = -1; }
      })
      .catch((err: any) => { if (!handleSessionExpiry(err)) error = err.message; })
      .finally(() => (loading = false));
  }

  // React: useEffect on [announceToken, statusFilter, typeFilter].
  let lastQueueKey = '';
  $effect(() => {
    const key = `${announceToken}|${statusFilter}|${typeFilter}`;
    if (key === lastQueueKey) return;
    lastQueueKey = key;
    loadQueue(true);
  });

  // 15s poll (skipped while showing a priority item).
  $effect(() => {
    if (!announceToken) return;
    return startPolling(() => {
      if (!announceToken) return;
      if (priorityPointer >= 0) return;
      api.getAnnouncementQueue(announceToken, statusFilter, typeFilter)
        .then((res: any) => { items = res.items || []; priorityQueue = res.priorityItems || []; pollFailed = false; })
        .catch(() => (pollFailed = true));
    }, POLL_MS);
  });

  let displayedItem = $derived(priorityPointer >= 0 ? priorityQueue[priorityPointer] : items[normalIndex]);

  // Keep the fixed top/bottom bar heights as CSS vars (matches ResizeObserver).
  $effect(() => {
    void displayedItem;
    void statusFilter;
    void typeFilter;
    void boxOrder;
    if (!pageEl || !topBarEl || !bottomBarEl) return;
    const applyHeights = () => {
      pageEl!.style.setProperty('--announce-top-h', `${topBarEl!.offsetHeight}px`);
      pageEl!.style.setProperty('--announce-bottom-h', `${bottomBarEl!.offsetHeight}px`);
    };
    applyHeights();
    const ro = new ResizeObserver(applyHeights);
    ro.observe(topBarEl);
    ro.observe(bottomBarEl);
    return () => ro.disconnect();
  });

  function handleNext() {
    if (priorityPointer >= 0) {
      if (priorityPointer + 1 < priorityQueue.length) priorityPointer = priorityPointer + 1;
      else priorityPointer = -1;
      return;
    }
    if (priorityQueue.length > 0) { priorityPointer = 0; return; }
    if (normalIndex + 1 < items.length) normalIndex = normalIndex + 1;
  }

  function handlePrev() {
    if (priorityPointer >= 0) {
      if (priorityPointer > 0) priorityPointer = priorityPointer - 1;
      else priorityPointer = -1;
      return;
    }
    if (normalIndex > 0) normalIndex = normalIndex - 1;
  }

  async function markItemAnnounced() {
    if (!displayedItem) return;
    marking = true;
    error = '';
    try {
      const res: any = await api.markAnnounced(announceToken, displayedItem.itemId, displayedItem.itemType);
      const updater = (arr: any[]) => arr.map((it) => (it.itemId === displayedItem.itemId && it.itemType === displayedItem.itemType)
        ? { ...it, announced: true, announcedCount: res.announcedCount } : it);
      if (priorityPointer >= 0) priorityQueue = updater(priorityQueue);
      else items = updater(items);
      handleNext();
    } catch (err) {
      if (!handleSessionExpiry(err)) error = (err as Error).message;
    } finally {
      marking = false;
    }
  }

  async function reannounce() {
    if (!confirm('This will reset the Announced status for all items in this Year + Type scope. Confirm?')) return;
    loading = true;
    error = '';
    try {
      await api.reannounceAll(announceToken, typeFilter);
      loadQueue(true);
    } catch (err) {
      if (!handleSessionExpiry(err)) error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  function swapBoxes() { boxOrder = [boxOrder[1], boxOrder[0]]; }
</script>

{#if linkExpired}
  <div style={pageStyle}>
    <div class="glass-card" style="padding:24px; max-width:420px; margin:60px auto; text-align:center;">
      <span class="material-icons-round" style="font-size:2.5rem; color:var(--danger);">link_off</span>
      <h3 style="margin:12px 0;">This link has expired</h3>
    </div>
  </div>
{:else if !announceToken}
  {#if restoring}
    <div style={pageStyle}><div class="inline-spinner">Loading...</div></div>
  {:else}
    <div style={pageStyle}>
      <div class="glass-card" style="padding:24px; max-width:380px; margin:60px auto;">
        <h3 style="margin-bottom:15px; text-align:center;">Announcement Portal</h3>
        {#if pinError}<div class="error-banner">{pinError}</div>{/if}
        {#if sessionPersistWarning}
          <div style="background:#FEF3C7; color:#92400E; border-radius:8px; padding:8px 12px; font-size:0.8rem; margin-bottom:10px;">
            ⚠️ Your browser is unable to save the session (private/incognito mode). You will need to enter the PIN again after refreshing the page.
          </div>
        {/if}
        <div class="form-group">
          <label>Enter PIN</label>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            type="password" inputmode="numeric" bind:value={pin} autofocus
            onkeydown={(e) => e.key === 'Enter' && submitPin()}
            style="font-size:1.2rem; text-align:center; letter-spacing:0.2em;"
          />
        </div>
        <button class="btn-submit" onclick={submitPin} disabled={verifying}>{verifying ? 'Verifying...' : 'Enter'}</button>
        {#if pinError}<ReportErrorButton page="Announce" message={pinError} />{/if}
      </div>
    </div>
  {/if}
{:else}
  <div class="announce-page" bind:this={pageEl}>
    <div class="announce-top-bar" bind:this={topBarEl}>
      {#if pollFailed}
        <span title="Live refresh has stopped — the data may be out of date" style="color:#DC2626; font-size:0.7rem; font-weight:700; margin-right:6px;">● OFFLINE</span>
      {/if}
      <div class="announce-top-bar-title">
        <h3>Announcements — Year {year}</h3>
      </div>
      <div class="announce-top-bar-controls" style="flex-wrap:nowrap; gap:6px;">
        <select bind:value={statusFilter} class="year-selector" style="font-size:0.75rem; padding:4px 6px; min-width:0; flex:1 1 0;">
          {#each STATUS_OPTIONS as [v, l] (v)}<option value={v}>{l}</option>{/each}
        </select>
        <select bind:value={typeFilter} class="year-selector" style="font-size:0.75rem; padding:4px 6px; min-width:0; flex:1 1 0;">
          {#each TYPE_OPTIONS as [v, l] (v)}<option value={v}>{l}</option>{/each}
        </select>
        <button class="btn-danger" onclick={reannounce} style="font-size:0.75rem; padding:4px 8px; width:auto; flex:0 0 auto; white-space:nowrap;">
          Re-announce
        </button>
      </div>
    </div>

    <div style="max-width:900px; margin:0 auto;">
      {#if error}<div class="error-banner">{error}</div>{/if}

      {#if priorityPointer >= 0}
        <div style="background:#FEF3C7; color:#92400E; padding:8px 14px; border-radius:8px; margin-bottom:10px; font-weight:700; font-size:0.85rem;">
          ⚡ Priority Announcement ({priorityPointer + 1} / {priorityQueue.length})
        </div>
      {/if}

      {#if loading}
        <div class="inline-spinner">Loading...</div>
      {:else if !displayedItem}
        <div class="glass-card" style="padding:24px; text-align:center; color:var(--text-muted);">No items found for this filter.</div>
      {:else}
        <div class="announce-boxes-row" style="display:flex; gap:15px; flex-wrap:wrap; align-items:center; justify-content:center;">
          <AnnounceBox lang={boxOrder[0]} item={displayedItem} onMarkAnnounced={markItemAnnounced} {marking} />
          <button
            class="btn-submit announce-swap-btn"
            style="width:40px; height:40px; padding:0; border-radius:50%; background:#e5e7eb; color:#111; display:flex; align-items:center; justify-content:center; flex:0 0 auto;"
            onclick={swapBoxes}
            title="Swap"
          >
            <span class="material-icons-round" style="font-size:1.2rem;">swap_horiz</span>
          </button>
          <AnnounceBox lang={boxOrder[1]} item={displayedItem} onMarkAnnounced={markItemAnnounced} {marking} />
        </div>
      {/if}

      {#if priorityPointer < 0 && items.length > 0}
        <div style="text-align:center; margin-top:15px; font-size:0.8rem; color:var(--text-muted);">
          {normalIndex + 1} / {items.length}
        </div>
      {/if}
    </div>

    <div class="announce-bottom-bar" bind:this={bottomBarEl}>
      <div class="announce-bottom-bar-inner">
        <button class="btn-submit" style="width:auto; flex:1;" onclick={handlePrev} disabled={loading}>◀ Prev</button>
        <button class="btn-submit" style="width:auto; flex:1; background:#e5e7eb; color:#111;" onclick={markItemAnnounced} disabled={marking || !displayedItem}>
          Announced: {displayedItem ? (displayedItem.announcedCount || 0) : 0}
        </button>
        <button class="btn-submit" style="width:auto; flex:1;" onclick={handleNext} disabled={loading}>Next ▶</button>
      </div>
    </div>
  </div>
{/if}

<style>
  @media (max-width: 640px) {
    .announce-boxes-row { flex-direction: column; align-items: stretch; }
    .announce-boxes-row > :global(.glass-card) { width: 100% !important; min-width: 0 !important; }
    .announce-swap-btn { align-self: center; }
  }
</style>
