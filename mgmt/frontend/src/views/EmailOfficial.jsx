import { useEffect, useState, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { api } from '../api.js';
import { usePolling } from '../usePolling.js';
import Modal from '../components/Modal.jsx';


function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? s : d.toLocaleString();
}

function BodyView({ html, text }) {
  if (html && html.trim()) {
    const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    return <div style={{ fontSize: '0.9rem', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: clean }} />;
  }
  if (text && text.trim()) {
    return <div style={{ fontSize: '0.9rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{text}</div>;
  }
  return <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>(No message body — the email had no text/HTML content, or its body could not be retrieved.)</div>;
}

export default function EmailOfficial() {
  const [box, setBox] = useState('inbox');
  const [rows, setRows] = useState(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openMsg, setOpenMsg] = useState(null);
  const [opening, setOpening] = useState(false);

  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [form, setForm] = useState({ to: '', cc: '', subject: '', body: '' });
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);

  const onFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const read = (file) => new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve({ filename: file.name, content: (r.result || '').toString().split(',')[1] || '' });
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    try {
      const added = await Promise.all(files.map(read));
      const next = [...attachments, ...added];
      const total = next.reduce((s, a) => s + (a.content ? a.content.length : 0), 0);
      if (total > 3 * 1024 * 1024) return alert('Attachments too large (max ~2 MB total).');
      setAttachments(next);
    } catch (err) { alert('Could not read the file.'); }
  };
  const removeAttachment = (i) => setAttachments(attachments.filter((_, idx) => idx !== i));

  const load = useCallback((silent) => {
    if (!silent) setLoading(true);
    api.listOfficialEmails(box, 50)
      .then(r => { setRows(r.emails || []); setUnread(r.unread || 0); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [box]);

  useEffect(() => { load(); }, [load]);
  usePolling(() => load(true), 60000, [load]);

  const openMessage = async (m) => {
    setOpening(true);
    try {
      const res = await api.getOfficialEmail(m.message_id);
      setOpenMsg(res);
      if (box === 'inbox' && !m.is_read) load(true);
    } catch (e) { alert(e.message); } finally { setOpening(false); }
  };

  const startCompose = () => {
    setReplyTo(null);
    setForm({ to: '', cc: '', subject: '', body: '' });
    setAttachments([]);
    setComposeOpen(true);
  };
  const startReply = (msg) => {
    setReplyTo(msg.message_id);
    setForm({ to: '', cc: '', subject: '', body: '' });
    setAttachments([]);
    setComposeOpen(true);
  };

  const submitSend = async (e) => {
    e.preventDefault();
    if (!form.body.trim()) return alert('Please write a message.');
    setSending(true);
    try {
      const att = attachments.length ? attachments : undefined;
      if (replyTo) {
        await api.replyOfficialEmail(replyTo, form.body.trim(), att);
      } else {
        if (!form.to.trim()) return alert('Recipient is required.');
        if (!form.subject.trim()) return alert('Subject is required.');
        await api.sendOfficialEmail(form.to.trim(), form.cc.trim(), form.subject.trim(), form.body.trim(), att);
      }
      setComposeOpen(false);
      setOpenMsg(null);
      setBox('sent');
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h2 style={{ marginBottom: 4 }}>✉️ Mail (official)</h2>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>chhath@shaharpura.com</p>

      <div className="subtabs">
        <button className={`subtab-btn ${box === 'inbox' ? 'active' : ''}`} onClick={() => { setBox('inbox'); setOpenMsg(null); }}>
          Inbox{unread > 0 ? ` (${unread})` : ''}
        </button>
        <button className={`subtab-btn ${box === 'sent' ? 'active' : ''}`} onClick={() => { setBox('sent'); setOpenMsg(null); }}>Sent</button>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading && <div className="inline-spinner">Loading mailbox...</div>}

      {!loading && !error && (rows || []).length === 0 && (
        <div className="glass-card" style={{ textAlign: 'center', padding: 20 }}>
          {box === 'inbox' ? 'No emails received yet.' : 'No emails sent yet.'}
        </div>
      )}

      {!loading && !error && (rows || []).map((m, i) => {
        const who = box === 'inbox' ? m.from_addr : m.to_addr;
        const unreadRow = box === 'inbox' && !m.is_read;
        return (
          <div
            className="glass-card"
            style={{ padding: 12, marginBottom: 8, cursor: 'pointer', borderLeft: unreadRow ? '3px solid var(--primary, #d97706)' : '3px solid transparent' }}
            key={m.message_id || i}
            onClick={() => openMessage(m)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontWeight: unreadRow ? 700 : 500 }}>{who || '(unknown)'}</strong>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{fmtDate(m.created_at)}</span>
            </div>
            <div style={{ fontSize: '0.88rem', marginTop: 2 }}>{m.subject || '(no subject)'}</div>
            {box === 'sent' && m.status === 'failed' && <span className="badge badge-warn" style={{ marginTop: 6 }}>failed</span>}
          </div>
        );
      })}

      <button className="fab" onClick={startCompose} title="Compose"><span className="material-icons-round">edit</span></button>

      {}
      <Modal open={!!openMsg} onClose={() => setOpenMsg(null)}>
        {opening && <div className="inline-spinner">Opening...</div>}
        {openMsg && (
          <>
            <h3 style={{ marginBottom: 4 }}>{openMsg.message.subject || '(no subject)'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
              {(openMsg.thread || [openMsg.message]).map((t, i) => (
                <div key={t.message_id || i} className="glass-card" style={{ padding: 12, background: t.direction === 'inbound' ? '#f9fafb' : '#eef6ff' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                    <strong>{t.direction === 'inbound' ? t.from_addr : 'You (chhath@shaharpura.com)'}</strong>
                    {t.direction === 'inbound' ? '' : ` → ${t.to_addr}`} · {fmtDate(t.created_at)}
                    {t.status === 'failed' ? ' · failed' : ''}
                  </div>
                  <BodyView html={t.body_html} text={t.body_text} />
                  {Array.isArray(t.attachments) && t.attachments.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {t.attachments.map((a, ai) => (
                        <span key={ai} className="badge" style={{ background: '#eef2ff', color: '#3730a3' }}>📎 {a.filename || 'attachment'}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button className="btn-submit" style={{ marginTop: 14 }} onClick={() => startReply(openMsg.message)}>Reply</button>
          </>
        )}
      </Modal>

      {}
      <Modal open={composeOpen} onClose={() => setComposeOpen(false)}>
        <h3 style={{ marginBottom: 12 }}>{replyTo ? 'Reply' : 'Compose'}</h3>
        <form onSubmit={submitSend}>
          {!replyTo && (
            <>
              <div className="form-group">
                <label>To</label>
                <input type="email" value={form.to} onChange={e => setForm({ ...form, to: e.target.value })} placeholder="recipient@example.com" />
              </div>
              <div className="form-group">
                <label>Cc (optional)</label>
                <input type="email" value={form.cc} onChange={e => setForm({ ...form, cc: e.target.value })} placeholder="optional" />
              </div>
              <div className="form-group">
                <label>Subject</label>
                <input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} />
              </div>
            </>
          )}
          <div className="form-group">
            <label>Message</label>
            <textarea rows={8} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd' }} />
          </div>
          <div className="form-group">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <span className="material-icons-round" style={{ fontSize: 18 }}>attach_file</span> Attach files (≤ ~2 MB total)
              <input type="file" multiple onChange={onFiles} style={{ display: 'none' }} />
            </label>
            {attachments.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {attachments.map((a, i) => (
                  <span key={i} className="badge" style={{ background: '#eef2ff', color: '#3730a3', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    📎 {a.filename}
                    <span className="material-icons-round" style={{ fontSize: 14, cursor: 'pointer' }} onClick={() => removeAttachment(i)}>close</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <button className="btn-submit" disabled={sending}>{sending ? 'Sending...' : (replyTo ? 'Send Reply' : 'Send')}</button>
        </form>
      </Modal>
    </div>
  );
}
