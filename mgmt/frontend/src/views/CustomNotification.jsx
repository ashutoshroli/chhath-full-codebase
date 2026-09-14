import { useEffect, useState } from 'react';
import { api, reportClientError } from '../api.js';

// Manual push broadcast to everyone who opted in on the PUBLIC portal.
// Subscriptions are created by the public worker; this only sends.
export default function CustomNotification() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('/');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, active: 0 });
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listPushSubscriptions(1);
      setStats({ ...(res.stats || { total: 0, active: 0 }) });
      setConfigured(res.configured !== false);
    } catch (err) {
      // A Subadmin/Admin cannot list subscriptions (superadmin-only); that must
      // not block them from sending, so a failure here is not fatal.
      setStats({ total: 0, active: 0 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const send = async () => {
    if (!title.trim() || !body.trim()) {
      setError('Please fill in both the title and the message.');
      return;
    }
    if (!confirm('Send this notification to everyone who opted in?')) return;
    setSending(true);
    setError('');
    setNotice('');
    try {
      const res = await api.sendCustomPush(title.trim(), body.trim(), url.trim() || '/');
      setNotice(`Notification queued for ${res.sent ?? 0} subscriber(s).`);
      setTitle('');
      setBody('');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to send the notification.');
      reportClientError('CustomNotification', 'Failed to send custom push', err);
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="inline-spinner">Loading...</div>;

  const inputStyle = { width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: '0.9rem', marginBottom: 12 };
  const labelStyle = { fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: 5 };
  const btn = (bg) => ({ background: bg, color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer' });

  return (
    <div>
      <h2 style={{ marginBottom: 6 }}>Custom Notification</h2>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 16 }}>
        Send a one-off push notification to every visitor who turned notifications on
        in the public portal — an announcement, a reminder, or a festival greeting.
        New contributions already notify automatically; this is for everything else.
      </p>

      {!configured && (
        <div className="glass-card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: 12, padding: 12 }}>
          Push notifications are not configured on the server (VAPID keys missing), so sending will fail.
        </div>
      )}
      {error && <div className="glass-card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: 12, padding: 12 }}>{error}</div>}
      {notice && <div className="glass-card" style={{ borderColor: 'var(--success)', color: 'var(--success)', marginBottom: 12, padding: 12 }}>{notice}</div>}

      <div className="glass-card" style={{ marginBottom: 18, padding: 16 }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>
          Subscribers: <strong>{stats.active}</strong> active
          {stats.total !== stats.active ? ` (${stats.total} total)` : ''}
        </div>

        <label style={labelStyle}>Title</label>
        <input style={inputStyle} value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder="Chhath Puja 2026" />

        <label style={labelStyle}>Message</label>
        <textarea style={{ ...inputStyle, minHeight: 90 }} value={body} maxLength={500} onChange={e => setBody(e.target.value)} placeholder="Nahay Khay kal hai. Sabhi shraddhalu samay par ghat par pahunchein." />

        <label style={labelStyle}>Open this page when tapped</label>
        <input style={inputStyle} value={url} onChange={e => setUrl(e.target.value)} placeholder="/" />

        <button style={btn('var(--primary-saffron, #F97316)')} onClick={send} disabled={sending || stats.active === 0}>
          {sending ? 'Sending...' : 'Send Notification'}
        </button>
        {stats.active === 0 && (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 10 }}>
            Nobody has opted in yet, so there is nothing to send. Visitors opt in from the portal's User Guide page.
          </p>
        )}
      </div>

      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        Notifications reach a device only while its browser subscription is alive. Endpoints
        the push service reports as gone are deactivated automatically.
      </p>
    </div>
  );
}
