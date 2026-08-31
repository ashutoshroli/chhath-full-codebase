import { useState, useRef, useEffect } from 'react';

// Replaces the old plain "Logout" button. Click the avatar to see Name + Role,
// then either open Settings or Logout.
export default function ProfileMenu({ name, role, onOpenSettings, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="nav-btn"
        style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}
        onClick={() => setOpen(o => !o)}
      >
        <span className="material-icons-round">account_circle</span>
      </button>

      {open && (
        <div
          className="glass-card"
          style={{ position: 'absolute', right: 0, top: '110%', minWidth: 190, padding: 8, zIndex: 100 }}
        >
          <div style={{ padding: '8px 10px', marginBottom: 6, borderBottom: '1px solid #e5e7eb' }}>
            <strong style={{ display: 'block', fontSize: '0.95rem' }}>{name}</strong>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{role}</span>
          </div>
          <button
            className="nav-btn"
            style={{ width: '100%', justifyContent: 'flex-start', gap: 8 }}
            onClick={() => { setOpen(false); onOpenSettings(); }}
          >
            <span className="material-icons-round">settings</span> Settings
          </button>
          <button
            className="nav-btn"
            style={{ width: '100%', justifyContent: 'flex-start', gap: 8, color: 'var(--danger)' }}
            onClick={() => { setOpen(false); onLogout(); }}
          >
            <span className="material-icons-round">logout</span> Logout
          </button>
        </div>
      )}
    </div>
  );
}
