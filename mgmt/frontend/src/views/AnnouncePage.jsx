import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import ReportErrorButton from '../components/ReportErrorButton.jsx';

const STATUS_OPTIONS = [['All', 'All'], ['Not Announced', 'Not Announced'], ['Announced', 'Announced']];
const TYPE_OPTIONS = [['All', 'All'], ['Paisa', 'Cash'], ['Kaam', 'Service'], ['Saman', 'Material'], ['Resell', 'Resell'], ['Custom', 'Custom']];

const POLL_MS = 15000;

function Box({ lang, item, onMarkAnnounced, marking }) {
  if (!item) return null;
  const isHindi = lang === 'hindi';
  const label = isHindi ? 'हिन्दी' : 'English';

  let body = null;
  if (item.category === 'Custom') {
    const text = isHindi ? item.textHindi : item.textEnglish;
    if (!text) return null;
    body = <div style={{ fontSize: '1.3rem', fontWeight: 600, lineHeight: 1.5 }}>{text}</div>;
  } else if (item.category === 'Resell') {
    body = (
      <>
        <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{item.detail}</div>
        <div style={{ fontSize: '1.1rem', color: 'var(--text-muted)', marginTop: 6 }}>₹{item.amount}</div>
      </>
    );
  } else {
    const name = isHindi ? (item.nameHindi || item.name) : item.name;
    const designation = isHindi ? (item.designationHindi || item.designation) : item.designation;
    const fatherName = isHindi ? (item.fatherNameHindi || item.fatherName) : item.fatherName;
    const village = isHindi ? (item.villageHindi || item.village) : item.village;
    body = (
      <>
        <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{name}</div>
        {designation && <div style={{ fontSize: '1rem', color: 'var(--primary-saffron)', fontWeight: 700, marginTop: 2 }}>{designation}</div>}
        {fatherName && <div style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginTop: 4 }}>
          {isHindi ? 'पिता:' : "Father's Name:"} {fatherName}
        </div>}
        {village && <div style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginTop: 2 }}>
          {isHindi ? 'गाँव:' : 'Village:'} {village}
        </div>}
        <div style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: 10 }}>
          {(item.category === 'Kaam' || item.category === 'Saman') ? item.detail : `₹${item.amount}`}
        </div>
      </>
    );
  }

  return (
    <div className="glass-card" style={{ padding: 18, flex: 1, minWidth: 260, position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span>
        <button
          className="btn-submit"
          style={{ width: 'auto', padding: '4px 10px', fontSize: '0.75rem', background: '#e5e7eb', color: '#111' }}
          onClick={onMarkAnnounced}
          disabled={marking}
        >
          Announced: {item.announcedCount || 0}
        </button>
      </div>
      {body}
    </div>
  );
}

export default function AnnouncePage() {
  const { token } = useParams();
  const storageKey = `announce_session_${token}`;
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [linkExpired, setLinkExpired] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [announceToken, setAnnounceToken] = useState(null);
  const [year, setYear] = useState(null);
  const [restoring, setRestoring] = useState(true);

  const [statusFilter, setStatusFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [items, setItems] = useState([]);
  const [priorityQueue, setPriorityQueue] = useState([]);
  const [normalIndex, setNormalIndex] = useState(0);
  const [priorityPointer, setPriorityPointer] = useState(-1);
  const [boxOrder, setBoxOrder] = useState(['hindi', 'english']);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState('');

  const priorityPointerRef = useRef(priorityPointer);
  const announcePageRef = useRef(null);
  const announceTopBarRef = useRef(null);
  const announceBottomBarRef = useRef(null);
  priorityPointerRef.current = priorityPointer;

  // On mount, restore a previously verified PIN session for this link (if any)
  // from sessionStorage, so a page refresh doesn't bounce back to the PIN screen
  // while the backend cache session (ANNOUNCE_SESSION_TTL_SECONDS) is still valid.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.announceToken) {
          setAnnounceToken(parsed.announceToken);
          setYear(parsed.year);
        }
      }
    } catch (e) { /* ignore malformed storage */ }
    setRestoring(false);
  }, [storageKey]);

  // Set right after a successful PIN verify, so the loadQueue effect below
  // knows to skip its immediate fetch — verifyAnnouncementPin already returns
  // the first queue inline, so an extra round-trip right after login isn't
  // just wasteful, it's the exact call that used to race the cache write.
  const skipNextLoadRef = useRef(false);

  const submitPin = async () => {
    if (!pin.trim()) return;
    setVerifying(true);
    setPinError('');
    try {
      const res = await api.verifyAnnouncementPin(token, pin.trim());
      setItems(res.items || []);
      setPriorityQueue(res.priorityItems || []);
      setNormalIndex(0);
      setPriorityPointer(-1);
      skipNextLoadRef.current = true;
      setAnnounceToken(res.announceToken);
      setYear(res.year);
      try { sessionStorage.setItem(storageKey, JSON.stringify({ announceToken: res.announceToken, year: res.year })); } catch (e) { /* ignore */ }
    } catch (err) {
      if (err.expired) setLinkExpired(true);
      setPinError(err.message);
    } finally {
      setVerifying(false);
    }
  };

  // If the PIN-based session expired server-side (cache cleared), bounce back
  // to the PIN screen instead of showing a dead announcement screen.
  const handleSessionExpiry = (err) => {
    if (err.announceSessionExpired) {
      setAnnounceToken(null);
      setPinError(err.message);
      try { sessionStorage.removeItem(storageKey); } catch (e) { /* ignore */ }
      return true;
    }
    return false;
  };

  const loadQueue = useCallback((resetPointer) => {
    if (!announceToken) return;
    if (skipNextLoadRef.current) { skipNextLoadRef.current = false; return; }
    setLoading(true);
    api.getAnnouncementQueue(announceToken, statusFilter, typeFilter)
      .then(res => {
        setItems(res.items || []);
        setPriorityQueue(res.priorityItems || []);
        if (resetPointer) { setNormalIndex(0); setPriorityPointer(-1); }
      })
      .catch(err => { if (!handleSessionExpiry(err)) setError(err.message); })
      .finally(() => setLoading(false));
  }, [announceToken, statusFilter, typeFilter]);

  useEffect(() => { loadQueue(true); }, [announceToken, statusFilter, typeFilter]); // eslint-disable-line

  // Background poll — keeps queue fresh (new collections / new priority customs
  // added live during the event) without disturbing what's on screen. Only
  // safe to silently swap "items"/"priorityQueue" while not mid-priority-display.
  useEffect(() => {
    if (!announceToken) return;
    const iv = setInterval(() => {
      if (priorityPointerRef.current >= 0) return; // don't disturb an active priority interrupt
      api.getAnnouncementQueue(announceToken, statusFilter, typeFilter)
        .then(res => { setItems(res.items || []); setPriorityQueue(res.priorityItems || []); })
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(iv);
  }, [announceToken, statusFilter, typeFilter]);

  const displayedItem = priorityPointer >= 0 ? priorityQueue[priorityPointer] : items[normalIndex];

  // Measure the real rendered height of the fixed top/bottom bars (instead of
  // guessing a px value) and expose it via CSS vars so .announce-page padding
  // always matches exactly — even if filters wrap to a second line or fonts
  // render slightly differently across devices.
  useEffect(() => {
    const pageEl = announcePageRef.current;
    const topEl = announceTopBarRef.current;
    const bottomEl = announceBottomBarRef.current;
    if (!pageEl || !topEl || !bottomEl) return;

    const applyHeights = () => {
      pageEl.style.setProperty('--announce-top-h', `${topEl.offsetHeight}px`);
      pageEl.style.setProperty('--announce-bottom-h', `${bottomEl.offsetHeight}px`);
    };

    applyHeights();
    const ro = new ResizeObserver(applyHeights);
    ro.observe(topEl);
    ro.observe(bottomEl);
    return () => ro.disconnect();
  }, [displayedItem, statusFilter, typeFilter, boxOrder]);

  const handleNext = () => {
    if (priorityPointer >= 0) {
      if (priorityPointer + 1 < priorityQueue.length) setPriorityPointer(priorityPointer + 1);
      else setPriorityPointer(-1); // all priority cleared — resume normal queue at same item
      return;
    }
    if (priorityQueue.length > 0) { setPriorityPointer(0); return; } // interrupt, normalIndex untouched
    if (normalIndex + 1 < items.length) setNormalIndex(normalIndex + 1);
  };

  const handlePrev = () => {
    if (priorityPointer >= 0) {
      if (priorityPointer > 0) setPriorityPointer(priorityPointer - 1);
      else setPriorityPointer(-1);
      return;
    }
    if (normalIndex > 0) setNormalIndex(normalIndex - 1);
  };

  const markItemAnnounced = async () => {
    if (!displayedItem) return;
    setMarking(true);
    setError('');
    try {
      const res = await api.markAnnounced(announceToken, displayedItem.itemId, displayedItem.itemType);
      const updater = (arr) => arr.map(it => (it.itemId === displayedItem.itemId && it.itemType === displayedItem.itemType)
        ? { ...it, announced: true, announcedCount: res.announcedCount } : it);
      if (priorityPointer >= 0) setPriorityQueue(updater);
      else setItems(updater);
      handleNext();
    } catch (err) {
      if (!handleSessionExpiry(err)) setError(err.message);
    } finally {
      setMarking(false);
    }
  };

  const reannounce = async () => {
    if (!confirm('This will reset the Announced status for all items in this Year + Type scope. Confirm?')) return;
    setLoading(true);
    setError('');
    try {
      await api.reannounceAll(announceToken, typeFilter);
      loadQueue(true);
    } catch (err) {
      if (!handleSessionExpiry(err)) setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const swapBoxes = () => setBoxOrder(([a, b]) => [b, a]);

  // ---- Screens ----

  if (linkExpired) {
    return (
      <div style={pageStyle}>
        <div className="glass-card" style={{ padding: 24, maxWidth: 420, margin: '60px auto', textAlign: 'center' }}>
          <span className="material-icons-round" style={{ fontSize: '2.5rem', color: 'var(--danger)' }}>link_off</span>
          <h3 style={{ margin: '12px 0' }}>This link has expired</h3>
        </div>
      </div>
    );
  }

  if (!announceToken) {
    if (restoring) {
      return (
        <div style={pageStyle}>
          <div className="inline-spinner">Loading...</div>
        </div>
      );
    }
    return (
      <div style={pageStyle}>
        <div className="glass-card" style={{ padding: 24, maxWidth: 380, margin: '60px auto' }}>
          <h3 style={{ marginBottom: 15, textAlign: 'center' }}>Announcement Portal</h3>
          {pinError && <div className="error-banner">{pinError}</div>}
          <div className="form-group">
            <label>Enter PIN</label>
            <input
              type="password" inputMode="numeric" value={pin} autoFocus
              onChange={e => setPin(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitPin()}
              style={{ fontSize: '1.2rem', textAlign: 'center', letterSpacing: '0.2em' }}
            />
          </div>
          <button className="btn-submit" onClick={submitPin} disabled={verifying}>{verifying ? 'Verifying...' : 'Enter'}</button>
          {pinError && <ReportErrorButton page="Announce" message={pinError} />}
        </div>
      </div>
    );
  }

  return (
    <div className="announce-page" ref={announcePageRef}>
      <div className="announce-top-bar" ref={announceTopBarRef}>
        <div className="announce-top-bar-title">
          <h3>Announcements — Year {year}</h3>
        </div>
        <div className="announce-top-bar-controls" style={{ flexWrap: 'nowrap', gap: 6 }}>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="year-selector"
            style={{ fontSize: '0.75rem', padding: '4px 6px', minWidth: 0, flex: '1 1 0' }}
          >
            {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="year-selector"
            style={{ fontSize: '0.75rem', padding: '4px 6px', minWidth: 0, flex: '1 1 0' }}
          >
            {TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button
            className="btn-danger"
            onClick={reannounce}
            style={{ fontSize: '0.75rem', padding: '4px 8px', width: 'auto', flex: '0 0 auto', whiteSpace: 'nowrap' }}
          >
            Re-announce
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {error && <div className="error-banner">{error}</div>}

        {priorityPointer >= 0 && (
          <div style={{ background: '#FEF3C7', color: '#92400E', padding: '8px 14px', borderRadius: 8, marginBottom: 10, fontWeight: 700, fontSize: '0.85rem' }}>
            ⚡ Priority Announcement ({priorityPointer + 1} / {priorityQueue.length})
          </div>
        )}

        {loading ? (
          <div className="inline-spinner">Loading...</div>
        ) : !displayedItem ? (
          <div className="glass-card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No items found for this filter.</div>
        ) : (
          <>
            <style>{`
              .announce-boxes-row { display: flex; gap: 15px; flex-wrap: wrap; align-items: center; justify-content: center; }
              .announce-swap-btn { flex: 0 0 auto; }
              @media (max-width: 640px) {
                .announce-boxes-row { flex-direction: column; align-items: stretch; }
                .announce-boxes-row > .glass-card { width: 100% !important; min-width: 0 !important; }
                .announce-swap-btn { align-self: center; }
              }
            `}</style>
            <div className="announce-boxes-row">
              <Box lang={boxOrder[0]} item={displayedItem} onMarkAnnounced={markItemAnnounced} marking={marking} />
              <button
                className="btn-submit announce-swap-btn"
                style={{
                  width: 40, height: 40, padding: 0, borderRadius: '50%',
                  background: '#e5e7eb', color: '#111',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                onClick={swapBoxes}
                title="Swap"
              >
                <span className="material-icons-round" style={{ fontSize: '1.2rem' }}>swap_horiz</span>
              </button>
              <Box lang={boxOrder[1]} item={displayedItem} onMarkAnnounced={markItemAnnounced} marking={marking} />
            </div>
          </>
        )}

        {priorityPointer < 0 && items.length > 0 && (
          <div style={{ textAlign: 'center', marginTop: 15, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {normalIndex + 1} / {items.length}
          </div>
        )}
      </div>

      <div className="announce-bottom-bar" ref={announceBottomBarRef}>
        <div className="announce-bottom-bar-inner">
          <button className="btn-submit" style={{ width: 'auto', flex: 1 }} onClick={handlePrev} disabled={loading}>◀ Prev</button>
          <button
            className="btn-submit"
            style={{ width: 'auto', flex: 1, background: '#e5e7eb', color: '#111' }}
            onClick={markItemAnnounced}
            disabled={marking || !displayedItem}
          >
            Announced: {displayedItem ? (displayedItem.announcedCount || 0) : 0}
          </button>
          <button className="btn-submit" style={{ width: 'auto', flex: 1 }} onClick={handleNext} disabled={loading}>Next ▶</button>
        </div>
      </div>
    </div>
  );
}

const pageStyle = { minHeight: '100vh', background: 'var(--bg-offwhite)', padding: '20px 15px' };
