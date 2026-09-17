import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { usePolling } from '../usePolling.js';
import Modal from '../components/Modal.jsx';
import CleanupPanel from '../components/CleanupPanel.jsx';
import { isTruthyFlag } from '../flags.js';

const LOAN_PLACEHOLDER_HINTS = {
  consent_group: 'Placeholders: {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate} {Guarantor1} {Guarantor2} {Guarantor3} {LoanerConsentLink} {Guarantor1ConsentLink} {Guarantor2ConsentLink} {Guarantor3ConsentLink}',
  consent_personal_loaner: 'Placeholders: {Name} {NameHindi} {FatherName} {FatherNameHindi} {Village} {VillageHindi} {Amount} {Tenure} {InterestRate} {Guarantor1} {Guarantor2} {Guarantor3} {ConsentLink}',
  consent_personal_guarantor: 'Placeholders: {Name} {NameHindi} {FatherName} {FatherNameHindi} {Village} {VillageHindi} {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate} {ConsentLink}',
  consent_accepted_group: 'Placeholders: {Name} {NameHindi} {Role} {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate}',
  consent_accepted_loaner_personal: 'Placeholders: {Name} {NameHindi} {Role} {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate}',
  all_guarantors_accepted_loaner: 'Placeholders: {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate}',
  consent_verified_personal: 'Placeholders: {Name} {NameHindi} {Role} {Amount} {Tenure} {InterestRate}',
  loan_passed_personal: 'Placeholders: {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate}',
  disbursement: 'Placeholders: {Name} {NameHindi} {Amount} {Tenure} {InterestRate} {CashAmount} {OnlineAmount} {TotalAmount}',
  otp: 'Placeholders: {OTP} {Name}',
  // C14: the loaner's email mirror when a consent is declined or a verification is
  // rejected. Email is personal-only, so there is no group email here (the group is a
  // WhatsApp-only channel). Subject + body both support these tokens.
  consent_declined_loaner_personal: 'Sent to the loaner when a consent is declined. Placeholders (subject + body): {Name} {Role} {LoanerName} {Amount} {Year}',
  consent_rejected_loaner_personal: 'Sent to the loaner when a verification is rejected. Placeholders (subject + body): {Name} {Role} {LoanerName} {Amount} {Year}',
};
const LOAN_TEMPLATE_TYPES = [
  ['consent_personal_loaner', 'Consent — Loaner'],
  ['consent_personal_guarantor', 'Consent — Guarantor'],
  ['consent_accepted_loaner_personal', 'Accepted — Loaner'],
  ['all_guarantors_accepted_loaner', 'All Guarantors Accepted'],
  ['consent_verified_personal', 'Verified — Personal'],
  ['loan_passed_personal', 'Loan Passed — Loaner'],
  ['disbursement', 'Disbursement'],
  // C14 — declined / rejected loaner emails (seeded in migration 32, sent by the
  // backend; they were missing from this list so the committee could not edit them).
  ['consent_declined_loaner_personal', 'Declined — Loaner'],
  ['consent_rejected_loaner_personal', 'Rejected — Loaner'],
  ['otp', 'OTP'],
];

const PLACEHOLDER_HINT = 'Placeholders: {Name} {NameHindi} {Amount} {Year} {PaymentMethod} {Village} {VillageHindi} {FatherName} {FatherNameHindi} {Detail}';
const CONTRIBUTION_TYPES = [['1', 'Cash (Money)'], ['2', 'Material (Item)'], ['3', 'Service (Work)']];
const DOC_SUB_TYPES = [['', 'Both (Receipt + Certificate)'], ['Receipt', 'Receipt Only'], ['Certificate', 'Certificate Only']];
const FILE_DOC_TYPE_OPTIONS = [['receipt', 'Receipt'], ['receipt_work', 'Work Receipt'], ['certificate', 'Certificate'], ['samaan', 'Material Receipt']];
const DEFAULT_FILE_DOC_TYPE = { '1': 'receipt', '2': 'samaan', '3': 'receipt_work' };

function EmailTemplateList() {
  const hint = 'Placeholders (subject + body): {Name} {NameHindi} {Amount} {Year} {PaymentMethod} {Village} {VillageHindi} {FatherName} {FatherNameHindi} {Detail}';

  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [messageType, setMessageType] = useState('normal');
  const [contributionType, setContributionType] = useState('1');
  const [docSubType, setDocSubType] = useState('');
  const [hasFile, setHasFile] = useState(false);
  const [fileDocType, setFileDocType] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.getEmailTemplates().then(setRows).catch(err => setError(err.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setSubject(''); setText(''); setMessageType('normal'); setContributionType('1');
    setDocSubType(''); setHasFile(false); setFileDocType('');
  };
  const closeModal = () => { setShowAdd(false); setEditing(null); resetForm(); };

  const openEdit = (r) => {
    setEditing(r);
    setSubject(r.subject || '');
    setText(r.text || '');
    setMessageType(r.message_type === 'priority' ? 'priority' : 'normal');
    setContributionType(String(parseInt(r.contribution_type, 10) || 1));
    setDocSubType(r.doc_sub_type || '');
    setFileDocType(r.file_doc_type || '');
    setHasFile(!!r.file_doc_type);
    setShowAdd(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!subject.trim()) return alert('Please enter the email subject');
    if (!text.trim()) return alert('Please enter the email body');
    if (hasFile && !fileDocType) return alert('Please select a Document Type, or turn off "Attach the generated document?"');
    setSaving(true);
    try {
      const fdt = hasFile ? fileDocType : '';
      const dst = contributionType === '3' ? docSubType : '';
      if (editing) {
        await api.updateEmailTemplate(editing.__rowIndex, subject.trim(), text.trim(), undefined, messageType, contributionType, '', dst, fdt);
      } else {
        await api.addEmailTemplate(subject.trim(), text.trim(), messageType, contributionType, '', dst, fdt);
      }
      closeModal();
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (r) => {
    try { await api.updateEmailTemplate(r.__rowIndex, undefined, undefined, !(isTruthyFlag(r.active)), undefined, undefined, undefined, undefined, undefined); load(); }
    catch (err) { alert(err.message); }
  };
  const cycleMessageType = async (r) => {
    const next = (r.message_type === 'priority') ? 'normal' : 'priority';
    try { await api.updateEmailTemplate(r.__rowIndex, undefined, undefined, undefined, next, undefined, undefined, undefined, undefined); load(); }
    catch (err) { alert(err.message); }
  };
  const remove = async (r) => {
    if (!confirm('Delete this email template?')) return;
    try { await api.deleteEmailTemplate(r.__rowIndex); load(); } catch (err) { alert(err.message); }
  };

  if (loading) return <div className="inline-spinner">Loading email templates...</div>;
  if (error) return <div className="error-banner">{error}</div>;

  return (
    <>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>{hint}</div>

      {(!rows || rows.length === 0) && <div className="glass-card" style={{ textAlign: 'center', padding: 20 }}>No email templates yet.</div>}

      {(rows || []).map((r, i) => {
        const isActive = isTruthyFlag(r.active);
        const isPriority = r.message_type === 'priority';
        const ct = String(parseInt(r.contribution_type, 10) || 1);
        const label = (CONTRIBUTION_TYPES.find(t => t[0] === ct) || [])[1] || 'Cash (Money)';
        return (
          <div className="glass-card" style={{ padding: 15, marginBottom: 10 }} key={r.__rowIndex ?? i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flexGrow: 1 }}>
                <strong style={{ display: 'block', marginBottom: 4 }}>✉️ {r.subject}</strong>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.text}</p>
              </div>
              <span className={`badge ${isActive ? 'badge-ok' : 'badge-warn'} toggle-switch`} onClick={() => toggleActive(r)}>
                {isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className={`badge ${isPriority ? 'badge-warn' : 'badge-pending'}`} style={{ cursor: 'pointer' }} onClick={() => cycleMessageType(r)} title="Tap to toggle Normal/Priority">
                {isPriority ? '⚡ Priority' : 'Normal'}
              </span>
              <span className="badge" style={{ background: '#f3f4f6', color: '#374151' }}>
                {label}{(ct === '3' && r.doc_sub_type) ? ` — ${r.doc_sub_type}` : ''}
              </span>
              {r.file_doc_type && (
                <span className="badge" style={{ background: '#DBEAFE', color: '#1E40AF' }} title="The recipient's own file link is added to the email">
                  📎 Auto: {(FILE_DOC_TYPE_OPTIONS.find(t => t[0] === r.file_doc_type) || [])[1] || r.file_doc_type}
                </span>
              )}
            </div>
            <div className="row-actions" style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button type="button" className="icon-btn" title="Edit" onClick={() => openEdit(r)}>
                <span className="material-icons-round" style={{ fontSize: 16 }}>edit</span>
              </button>
              <button type="button" className="icon-btn icon-danger" title="Delete" onClick={() => remove(r)}>
                <span className="material-icons-round" style={{ fontSize: 16 }}>delete</span>
              </button>
            </div>
          </div>
        );
      })}

      <button className="fab" onClick={() => { setEditing(null); resetForm(); setShowAdd(true); }}><span className="material-icons-round">add</span></button>

      <Modal open={showAdd} onClose={closeModal}>
        <h3 style={{ marginBottom: 15 }}>{editing ? 'Edit' : 'New'} Email Template</h3>
        <form onSubmit={submit}>
          <div className="form-group">
            <label>Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Thank you {Name} — receipt for {Year}" style={{ width: '100%' }} />
          </div>
          <div className="form-group">
            <label>Email Body</label>
            <textarea rows={6} value={text} onChange={e => setText(e.target.value)} placeholder={hint} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd' }} />
          </div>
          <div className="form-group">
            <label>Message Type</label>
            <select value={messageType} onChange={e => setMessageType(e.target.value)}>
              <option value="normal">Normal</option>
              <option value="priority">Priority</option>
            </select>
          </div>
          <div className="form-group">
            <label>Contribution Type</label>
            <select value={contributionType} onChange={e => {
              const val = e.target.value;
              setContributionType(val);
              if (val !== '3') setDocSubType('');
              if (hasFile) setFileDocType(val === '3' ? (docSubType === 'Certificate' ? 'certificate' : 'receipt_work') : (DEFAULT_FILE_DOC_TYPE[val] || 'receipt'));
            }}>
              {CONTRIBUTION_TYPES.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
            </select>
          </div>
          {contributionType === '3' && (
            <div className="form-group">
              <label>Document Type</label>
              <select value={docSubType} onChange={e => {
                const val = e.target.value;
                setDocSubType(val);
                if (hasFile) setFileDocType(val === 'Certificate' ? 'certificate' : 'receipt_work');
              }}>
                {DOC_SUB_TYPES.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
              </select>
            </div>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={hasFile} onChange={e => {
              const checked = e.target.checked;
              setHasFile(checked);
              if (checked && !fileDocType) {
                setFileDocType(contributionType === '3' ? (docSubType === 'Certificate' ? 'certificate' : 'receipt_work') : (DEFAULT_FILE_DOC_TYPE[contributionType] || 'receipt'));
              }
            }} />
            Attach the generated document (as a download link)?
          </label>
          {hasFile && (
            <div className="form-group">
              <label>Document to Attach</label>
              <select value={fileDocType} onChange={e => setFileDocType(e.target.value)}>
                {FILE_DOC_TYPE_OPTIONS.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
              </select>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                The recipient's own {(FILE_DOC_TYPE_OPTIONS.find(t => t[0] === fileDocType) || [])[1] || ''} download link is added to the email body.
              </div>
            </div>
          )}
          <button className="btn-submit" disabled={saving}>{saving ? 'Saving...' : (editing ? 'Update' : 'Save')}</button>
        </form>
      </Modal>
    </>
  );
}

function LoanEmailTemplateList({ loanType }) {
  const hint = LOAN_PLACEHOLDER_HINTS[loanType] || PLACEHOLDER_HINT;
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [messageType, setMessageType] = useState('normal');
  const [hasFile, setHasFile] = useState(false);
  const [fileLink, setFileLink] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.getLoanEmailTemplates(loanType).then(setRows).catch(err => setError(err.message)).finally(() => setLoading(false));
  }, [loanType]);
  useEffect(() => { load(); }, [load]);

  const resetForm = () => { setSubject(''); setText(''); setMessageType('normal'); setHasFile(false); setFileLink(''); };
  const closeModal = () => { setShowAdd(false); setEditing(null); resetForm(); };
  const openEdit = (r) => {
    setEditing(r);
    setSubject(r.subject || '');
    setText(r.text || '');
    setMessageType(r.message_type === 'priority' ? 'priority' : 'normal');
    setFileLink(r.file_link || '');
    setHasFile(!!r.file_link);
    setShowAdd(true);
  };
  const submit = async (e) => {
    e.preventDefault();
    if (!subject.trim()) return alert('Please enter the email subject');
    if (!text.trim()) return alert('Please enter the email body');
    if (hasFile && !fileLink.trim()) return alert('Please enter the file link, or turn off "Attach a file link?"');
    setSaving(true);
    try {
      const link = hasFile ? fileLink.trim() : '';
      if (editing) await api.updateLoanEmailTemplate(editing.__rowIndex, subject.trim(), text.trim(), undefined, messageType, link);
      else await api.addLoanEmailTemplate(loanType, subject.trim(), text.trim(), messageType, link);
      closeModal();
      load();
    } catch (err) { alert(err.message); } finally { setSaving(false); }
  };
  const toggleActive = async (r) => {
    try { await api.updateLoanEmailTemplate(r.__rowIndex, undefined, undefined, !(isTruthyFlag(r.active)), undefined, undefined); load(); }
    catch (err) { alert(err.message); }
  };
  const cycleMessageType = async (r) => {
    const next = (r.message_type === 'priority') ? 'normal' : 'priority';
    try { await api.updateLoanEmailTemplate(r.__rowIndex, undefined, undefined, undefined, next, undefined); load(); }
    catch (err) { alert(err.message); }
  };
  const remove = async (r) => {
    if (!confirm('Delete this loan email template?')) return;
    try { await api.deleteLoanEmailTemplate(r.__rowIndex); load(); } catch (err) { alert(err.message); }
  };

  if (loading) return <div className="inline-spinner">Loading loan email templates...</div>;
  if (error) return <div className="error-banner">{error}</div>;

  return (
    <>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>{hint}</div>
      {(!rows || rows.length === 0) && <div className="glass-card" style={{ textAlign: 'center', padding: 20 }}>No loan email templates yet for this type.</div>}
      {(rows || []).map((r, i) => {
        const isActive = isTruthyFlag(r.active);
        const isPriority = r.message_type === 'priority';
        return (
          <div className="glass-card" style={{ padding: 15, marginBottom: 10 }} key={r.__rowIndex ?? i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flexGrow: 1 }}>
                <strong style={{ display: 'block', marginBottom: 4 }}>✉️ {r.subject}</strong>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.text}</p>
              </div>
              <span className={`badge ${isActive ? 'badge-ok' : 'badge-warn'} toggle-switch`} onClick={() => toggleActive(r)}>
                {isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className={`badge ${isPriority ? 'badge-warn' : 'badge-pending'}`} style={{ cursor: 'pointer' }} onClick={() => cycleMessageType(r)} title="Tap to toggle Normal/Priority">
                {isPriority ? '⚡ Priority' : 'Normal'}
              </span>
              {r.file_link && <span className="badge" style={{ background: '#DBEAFE', color: '#1E40AF' }} title={r.file_link}>📎 File link</span>}
            </div>
            <div className="row-actions" style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button type="button" className="icon-btn" title="Edit" onClick={() => openEdit(r)}>
                <span className="material-icons-round" style={{ fontSize: 16 }}>edit</span>
              </button>
              <button type="button" className="icon-btn icon-danger" title="Delete" onClick={() => remove(r)}>
                <span className="material-icons-round" style={{ fontSize: 16 }}>delete</span>
              </button>
            </div>
          </div>
        );
      })}
      <button className="fab" onClick={() => { setEditing(null); resetForm(); setShowAdd(true); }}><span className="material-icons-round">add</span></button>
      <Modal open={showAdd} onClose={closeModal}>
        <h3 style={{ marginBottom: 15 }}>{editing ? 'Edit' : 'New'} Loan Email Template</h3>
        <form onSubmit={submit}>
          <div className="form-group">
            <label>Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Loan consent for {LoanerName}" style={{ width: '100%' }} />
          </div>
          <div className="form-group">
            <label>Email Body</label>
            <textarea rows={6} value={text} onChange={e => setText(e.target.value)} placeholder={hint} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd' }} />
          </div>
          <div className="form-group">
            <label>Message Type</label>
            <select value={messageType} onChange={e => setMessageType(e.target.value)}>
              <option value="normal">Normal</option>
              <option value="priority">Priority</option>
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={hasFile} onChange={e => setHasFile(e.target.checked)} />
            Attach a file link?
          </label>
          {hasFile && (
            <div className="form-group">
              <label>File Link (public URL)</label>
              <input value={fileLink} onChange={e => setFileLink(e.target.value)} placeholder="https://... any public link" />
            </div>
          )}
          <button className="btn-submit" disabled={saving}>{saving ? 'Saving...' : (editing ? 'Update' : 'Save')}</button>
        </form>
      </Modal>
    </>
  );
}

function MailLog() {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stuck, setStuck] = useState(null);
  const [resendingId, setResendingId] = useState(null);

  const load = useCallback((silent) => {
    if (!silent) setLoading(true);
    api.getEmailLog().then(setRows).catch(err => setError(err.message)).finally(() => setLoading(false));
    api.getStuckEmails(30).then(setStuck).catch(() => {  });
  }, []);
  usePolling(() => load(true), 60000, [load]);

  const badgeClass = (status) => status === 'sent' ? 'badge-ok' : status === 'failed' ? 'badge-warn' : 'badge-pending';
  const stuckCount = stuck ? stuck.total : 0;
  const resend = async (m) => {
    setResendingId(m.message_id);
    try { await api.resendEmail(m.message_id); load(true); } catch (err) { alert(err.message); } finally { setResendingId(null); }
  };

  return (
    <>
      {stuckCount > 0 && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 8, padding: '10px 12px', fontSize: '0.85rem', margin: '10px 0' }}>
          🚨 <strong>{stuckCount} email{stuckCount === 1 ? '' : 's'}</strong> have been stuck in the queue for over 30 minutes —
          this usually means <code>RESEND_API_KEY</code> is missing/invalid or the sending domain is not verified in Resend.
        </div>
      )}

      {loading && <div className="inline-spinner">Loading emails...</div>}
      {error && <div className="error-banner">{error}</div>}
      {!loading && !error && (!rows || rows.length === 0) && (
        <div className="glass-card" style={{ textAlign: 'center', padding: 20 }}>No emails have been sent yet.</div>
      )}

      {!loading && !error && (rows || []).map((m, i) => (
        <div className="glass-card" style={{ padding: 15, marginBottom: 10 }} key={m.message_id || i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
            <strong>{m.to_email}</strong>
            <div style={{ display: 'flex', gap: 6 }}>
              {m.message_type === 'priority' && <span className="badge badge-warn">⚡ Priority</span>}
              <span className={`badge ${badgeClass(m.status)}`}>{m.status}</span>
            </div>
          </div>
          {m.subject && <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: '0.9rem' }}>✉️ {m.subject}</p>}
          {m.file_link && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>📎 <a href={m.file_link} target="_blank" rel="noreferrer">Attached link</a></div>}
          {m.remarks && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Remarks: {m.remarks}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {m.created_at}
              {m.attempts > 0 && <> · {m.attempts} attempt{m.attempts === 1 ? '' : 's'}</>}
              {m.sent_at && <> · finished {m.sent_at}</>}
            </div>
            {m.status !== 'sent' && (
              <button
                className="btn-submit" style={{ width: 'auto', padding: '4px 12px', fontSize: '0.8rem' }}
                onClick={() => resend(m)} disabled={resendingId === m.message_id}
              >
                {resendingId === m.message_id ? 'Re-queuing...' : m.status === 'failed' ? 'Resend' : 'Re-queue'}
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

function EmailLog() {
  const [stuck, setStuck] = useState(null);
  const [error, setError] = useState('');
  const [resendingId, setResendingId] = useState(null);

  const load = useCallback(() => {
    api.getStuckEmails(30).then(setStuck).catch(err => setError(err.message));
  }, []);
  usePolling(() => load(), 60000, [load]);

  const badgeClass = (status) => status === 'sent' ? 'badge-ok' : status === 'failed' ? 'badge-warn' : 'badge-pending';
  const resend = async (m) => {
    setResendingId(m.message_id);
    try { await api.resendEmail(m.message_id); load(); } catch (err) { alert(err.message); } finally { setResendingId(null); }
  };

  const emails = (stuck && stuck.emails) || [];
  return (
    <>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '4px 0 12px' }}>
        Emails queued but not yet delivered in the last 30 minutes. Sent emails leave the queue; a long-stuck list means <code>RESEND_API_KEY</code> is missing or invalid, or the sending domain is not verified.
      </div>
      {error && <div className="error-banner">{error}</div>}
      {emails.length === 0 && <div className="glass-card" style={{ textAlign: 'center', padding: 20 }}>No stuck emails — the queue is healthy.</div>}
      {emails.map((m, i) => (
        <div className="glass-card" style={{ padding: 15, marginBottom: 10 }} key={m.message_id || i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
            <strong>{m.to_email}</strong>
            <span className={`badge ${badgeClass(m.status)}`}>{m.status}</span>
          </div>
          {m.remarks && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Remarks: {m.remarks}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {m.created_at}{m.attempts > 0 && <> · {m.attempts} attempt{m.attempts === 1 ? '' : 's'}</>}
            </div>
            {m.status !== 'sent' && (
              <button className="btn-submit" style={{ width: 'auto', padding: '4px 12px', fontSize: '0.8rem' }} onClick={() => resend(m)} disabled={resendingId === m.message_id}>
                {resendingId === m.message_id ? 'Re-queuing...' : 'Re-queue'}
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}


export default function Email({ role }) {
  const [emailSection, setEmailSection] = useState('template');
  const [loanEmailType, setLoanEmailType] = useState(LOAN_TEMPLATE_TYPES[0][0]);

  return (
    <>
      <h2 style={{ marginBottom: 15 }}>✉️ Mail (noreply)</h2>

      <div className="subtabs">
        <button className={`subtab-btn ${emailSection === 'template' ? 'active' : ''}`} onClick={() => setEmailSection('template')}>Collection</button>
        <button className={`subtab-btn ${emailSection === 'loan' ? 'active' : ''}`} onClick={() => setEmailSection('loan')}>Loan</button>
        <button className={`subtab-btn ${emailSection === 'mails' ? 'active' : ''}`} onClick={() => setEmailSection('mails')}>Mails</button>
        <button className={`subtab-btn ${emailSection === 'queue' ? 'active' : ''}`} onClick={() => setEmailSection('queue')}>Queue</button>
      </div>

      {emailSection === 'template' && <EmailTemplateList />}
      {emailSection === 'loan' && (
        <>
          <div className="subtabs" style={{ marginTop: 8 }}>
            {LOAN_TEMPLATE_TYPES.map(([val, lbl]) => (
              <button key={val} className={`subtab-btn ${loanEmailType === val ? 'active' : ''}`} onClick={() => setLoanEmailType(val)}>{lbl}</button>
            ))}
          </div>
          <LoanEmailTemplateList key={loanEmailType} loanType={loanEmailType} />
        </>
      )}
      {emailSection === 'mails' && (
        <>
          <MailLog />
          <CleanupPanel target="noreply_mails" label="noreply emails" role={role} hasStatus />
        </>
      )}
      {emailSection === 'queue' && <EmailLog />}
    </>
  );
}
