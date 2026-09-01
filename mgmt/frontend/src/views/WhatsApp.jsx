import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import { isTruthyFlag } from '../flags.js';

const PLACEHOLDER_HINT = 'Placeholders: {Name} {NameHindi} {Amount} {Year} {PaymentMethod} {Village} {VillageHindi} {FatherName} {FatherNameHindi} {Detail}';

const LOAN_PLACEHOLDER_HINTS = {
  consent_group: 'Placeholders: {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate} {Guarantor1} {Guarantor2} {Guarantor3} {LoanerConsentLink} {Guarantor1ConsentLink} {Guarantor2ConsentLink} {Guarantor3ConsentLink}',
  consent_personal_loaner: 'Placeholders: {Name} {NameHindi} {FatherName} {FatherNameHindi} {Village} {VillageHindi} {Amount} {Tenure} {InterestRate} {Guarantor1} {Guarantor2} {Guarantor3} {ConsentLink}',
  consent_personal_guarantor: 'Placeholders: {Name} {NameHindi} {FatherName} {FatherNameHindi} {Village} {VillageHindi} {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate} {ConsentLink}',
  consent_accepted_group: 'Sent to the WA group when anyone (loaner/guarantor) accepts. Placeholders: {Name} {NameHindi} {Role} {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate}',
  consent_accepted_loaner_personal: 'Sent personally to the loaner when anyone accepts. Placeholders: {Name} {NameHindi} {Role} {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate}',
  all_guarantors_accepted_loaner: 'Sent personally to the loaner once all three guarantors have accepted ("you may now accept"). Placeholders: {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate}',
  consent_verified_personal: 'Sent personally to the person once the Superadmin verifies. Placeholders: {Name} {NameHindi} {Role} {Amount} {Tenure} {InterestRate}',
  loan_passed_personal: 'Sent personally to the loaner once everyone\'s consent is verified. Placeholders: {LoanerName} {LoanerNameHindi} {Amount} {Tenure} {InterestRate}',
  disbursement: 'Placeholders: {Name} {NameHindi} {Amount} {Tenure} {InterestRate} {CashAmount} {OnlineAmount} {TotalAmount}',
  otp: 'Placeholders: {OTP} {Name}',
};
const LOAN_TEMPLATE_TYPES = [
  ['consent_group', 'Consent — Group'],
  ['consent_personal_loaner', 'Consent — Personal (Loaner)'],
  ['consent_personal_guarantor', 'Consent — Personal (Guarantor)'],
  ['consent_accepted_group', 'Accepted — Group'],
  ['consent_accepted_loaner_personal', 'Accepted — Loaner Personal'],
  ['all_guarantors_accepted_loaner', 'All Guarantors Accepted — Loaner'],
  ['consent_verified_personal', 'Verified — Personal'],
  ['loan_passed_personal', 'Loan Passed — Loaner'],
  ['disbursement', 'Disbursement'],
  ['otp', 'OTP'],
];

const CONTRIBUTION_TYPES = [['1', 'Cash (Money)'], ['2', 'Material (Item)'], ['3', 'Service (Work)']];
// Resell has no contributor at all — a personal WhatsApp message makes no sense for it,
// so this 4th type is offered only on Group templates, never Person templates.
const GROUP_CONTRIBUTION_TYPES = [...CONTRIBUTION_TYPES, ['4', 'Resell (Item)']];
const RESELL_PLACEHOLDER_HINT = 'Placeholders: {ItemName} {Amount} {Year}';
const DOC_SUB_TYPES = [['', 'Both (Receipt + Certificate)'], ['Receipt', 'Receipt Only'], ['Certificate', 'Certificate Only']];
// Person/Group templates only (Loan templates don't have this concept, unchanged
// below). Instead of pasting a static link, pick WHICH generated document this
// template should carry — the recipient's own file gets auto-attached when the
// message is queued (right after that PDF finishes generating).
const FILE_DOC_TYPE_OPTIONS = [['receipt', 'Receipt'], ['certificate', 'Certificate'], ['samaan', 'Material Receipt']];
const DEFAULT_FILE_DOC_TYPE = { '1': 'receipt', '2': 'samaan', '3': 'receipt' };

// ============ Templates (Person / Group / Loan incl. OTP) ============
function TemplateList({ kind, loanType, titleLabel }) {
  // kind: 'person' | 'group' | 'loan' (loan needs loanType, one of LOAN_TEMPLATE_TYPES' first values)
  const hasContributionType = kind === 'person' || kind === 'group';
  const get = useCallback(() => {
    if (kind === 'person') return api.getPersonTemplates();
    if (kind === 'group') return api.getGroupTemplates();
    return api.getLoanTemplates(loanType);
  }, [kind, loanType]);
  const add = kind === 'person' ? api.addPersonTemplate : kind === 'group' ? api.addGroupTemplate : (text, messageType, fileLink) => api.addLoanTemplate(loanType, text, messageType, fileLink);
  const update = kind === 'person' ? api.updatePersonTemplate : kind === 'group' ? api.updateGroupTemplate : (rowIndex, text, active, messageType, contributionType, fileLink) => api.updateLoanTemplate(rowIndex, text, active, messageType, fileLink);
  const del = kind === 'person' ? api.deletePersonTemplate : kind === 'group' ? api.deleteGroupTemplate : api.deleteLoanTemplate;
  const hint = kind === 'loan' ? (LOAN_PLACEHOLDER_HINTS[loanType] || PLACEHOLDER_HINT) : PLACEHOLDER_HINT;
  const contributionTypeOptions = kind === 'group' ? GROUP_CONTRIBUTION_TYPES : CONTRIBUTION_TYPES;

  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [text, setText] = useState('');
  const [messageType, setMessageType] = useState('normal');
  const [contributionType, setContributionType] = useState('1');
  const [docSubType, setDocSubType] = useState('');
  const [hasFile, setHasFile] = useState(false);
  const [fileLink, setFileLink] = useState('');
  const [fileDocType, setFileDocType] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    get().then(setRows).catch(err => setError(err.message)).finally(() => setLoading(false));
  }, [get]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return alert('Please enter the template text');
    if (hasFile && hasContributionType && !fileDocType) return alert('Please select a Document Type, or turn off "Is this template have files?"');
    if (hasFile && !hasContributionType && !fileLink.trim()) return alert('Please enter the file link, or turn off "Is this template have files?"');
    setSaving(true);
    try {
      const link = (hasFile && !hasContributionType) ? fileLink.trim() : '';
      const fdt = (hasFile && hasContributionType) ? fileDocType : '';
      const dst = (hasContributionType && contributionType === '3') ? docSubType : '';
      if (hasContributionType) await add(text.trim(), messageType, contributionType, link, dst, fdt);
      else await add(text.trim(), messageType, link);
      setText('');
      setMessageType('normal');
      setContributionType('1');
      setDocSubType('');
      setHasFile(false);
      setFileLink('');
      setFileDocType('');
      setShowAdd(false);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (r) => {
    try {
      await update(r.__rowIndex, undefined, !(isTruthyFlag(r.active)), undefined, undefined, undefined, undefined, undefined);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const cycleMessageType = async (r) => {
    const next = (r.message_type === 'priority') ? 'normal' : 'priority';
    try {
      await update(r.__rowIndex, undefined, undefined, next, undefined, undefined, undefined, undefined);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const remove = async (r) => {
    if (!confirm('Delete this template?')) return;
    try {
      await del(r.__rowIndex);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) return <div className="inline-spinner">Loading templates...</div>;
  if (error) return <div className="error-banner">{error}</div>;

  return (
    <>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>{hint}</div>

      {(!rows || rows.length === 0) && <div className="glass-card" style={{ textAlign: 'center', padding: 20 }}>No templates yet.</div>}

      {(rows || []).map((r, i) => {
        const isActive = isTruthyFlag(r.active);
        const isPriority = r.message_type === 'priority';
        return (
          <div className="glass-card" style={{ padding: 15, marginBottom: 10 }} key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <p style={{ margin: 0, flexGrow: 1 }}>{r.text}</p>
              <span className={`badge ${isActive ? 'badge-ok' : 'badge-warn'} toggle-switch`} onClick={() => toggleActive(r)}>
                {isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span
                className={`badge ${isPriority ? 'badge-warn' : 'badge-pending'}`}
                style={{ cursor: 'pointer' }}
                onClick={() => cycleMessageType(r)}
                title="Tap to toggle Normal/Priority"
              >
                {isPriority ? '⚡ Priority' : 'Normal'}
              </span>
              {hasContributionType && (
                <span className="badge" style={{ background: '#f3f4f6', color: '#374151' }}>
                  {(contributionTypeOptions.find(t => t[0] === (r.contribution_type || '1')) || [])[1] || 'Cash'}
                  {(r.contribution_type === '3' && r.doc_sub_type) ? ` — ${r.doc_sub_type}` : ''}
                </span>
              )}
              {r.file_doc_type && (
                <span className="badge" style={{ background: '#DBEAFE', color: '#1E40AF' }} title="The recipient's own file is auto-attached">
                  📎 Auto: {(FILE_DOC_TYPE_OPTIONS.find(t => t[0] === r.file_doc_type) || [])[1] || r.file_doc_type}
                </span>
              )}
              {!r.file_doc_type && r.file_link && (
                <span className="badge" style={{ background: '#DBEAFE', color: '#1E40AF' }} title={r.file_link}>
                  📎 File attached
                </span>
              )}
            </div>
            <div className="row-actions" style={{ marginTop: 10 }}>
              <button type="button" className="icon-btn icon-danger" title="Delete" onClick={() => remove(r)}>
                <span className="material-icons-round" style={{ fontSize: 16 }}>delete</span>
              </button>
            </div>
          </div>
        );
      })}

      <button className="fab" onClick={() => setShowAdd(true)}><span className="material-icons-round">add</span></button>

      <Modal open={showAdd} onClose={() => setShowAdd(false)}>
        <h3 style={{ marginBottom: 15 }}>New {titleLabel || (kind === 'person' ? 'Person' : 'Group')} Template</h3>
        <form onSubmit={submit}>
          <div className="form-group">
            <label>Message Text</label>
            <textarea rows={5} value={text} onChange={e => setText(e.target.value)} placeholder={contributionType === '4' ? RESELL_PLACEHOLDER_HINT : hint} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd' }} />
          </div>
          {hasContributionType && contributionType === '4' && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>{RESELL_PLACEHOLDER_HINT}</div>
          )}
          <div className="form-group">
            <label>Message Type</label>
            <select value={messageType} onChange={e => setMessageType(e.target.value)}>
              <option value="normal">Normal</option>
              <option value="priority">Priority</option>
            </select>
          </div>
          {hasContributionType && (
            <div className="form-group">
              <label>Contribution Type</label>
              <select value={contributionType} onChange={e => {
                const val = e.target.value;
                setContributionType(val);
                if (val !== '3') setDocSubType('');
                if (hasFile) setFileDocType(val === '3' ? (docSubType === 'Certificate' ? 'certificate' : 'receipt') : (DEFAULT_FILE_DOC_TYPE[val] || 'receipt'));
              }}>
                {contributionTypeOptions.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
              </select>
            </div>
          )}
          {hasContributionType && contributionType === '3' && (
            <div className="form-group">
              <label>Document Type</label>
              <select value={docSubType} onChange={e => {
                const val = e.target.value;
                setDocSubType(val);
                if (hasFile) setFileDocType(val === 'Certificate' ? 'certificate' : 'receipt');
              }}>
                {DOC_SUB_TYPES.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
              </select>
            </div>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={hasFile} onChange={e => {
              const checked = e.target.checked;
              setHasFile(checked);
              if (checked && hasContributionType && !fileDocType) {
                setFileDocType(contributionType === '3' ? (docSubType === 'Certificate' ? 'certificate' : 'receipt') : (DEFAULT_FILE_DOC_TYPE[contributionType] || 'receipt'));
              }
            }} />
            Is this template have files?
          </label>
          {hasFile && (
            hasContributionType ? (
              <div className="form-group">
                <label>File to Attach</label>
                <select value={fileDocType} onChange={e => setFileDocType(e.target.value)}>
                  {FILE_DOC_TYPE_OPTIONS.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
                </select>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  That recipient's own {(FILE_DOC_TYPE_OPTIONS.find(t => t[0] === fileDocType) || [])[1] || ''} will be auto-attached — no need to enter a link manually.
                </div>
              </div>
            ) : (
              <div className="form-group">
                <label>File Link (public download URL)</label>
                <input value={fileLink} onChange={e => setFileLink(e.target.value)} placeholder="https://drive.google.com/... or any public link" />
              </div>
            )
          )}
          <button className="btn-submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </form>
      </Modal>
    </>
  );
}

// ============ Group Info ============
function GroupInfoList() {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ groupName: '', groupid: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.getWhatsappGroups().then(setRows).catch(err => setError(err.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const closeModal = () => { setShowAdd(false); setEditing(null); setForm({ groupName: '', groupid: '' }); };

  const openEdit = (r) => {
    setEditing(r);
    setForm({ groupName: r.group_name, groupid: r.groupid });
    setShowAdd(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.groupName.trim() || !form.groupid.trim()) return alert('Both Group Name and Group ID are required');
    setSaving(true);
    try {
      if (editing) {
        await api.updateWhatsappGroup(editing.__rowIndex, form.groupName.trim(), form.groupid.trim(), undefined);
      } else {
        await api.addWhatsappGroup(form.groupName.trim(), form.groupid.trim());
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
    try {
      await api.updateWhatsappGroup(r.__rowIndex, undefined, undefined, !(isTruthyFlag(r.active)));
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const remove = async (r) => {
    if (!confirm(`Delete ${r.group_name}?`)) return;
    try {
      await api.deleteWhatsappGroup(r.__rowIndex);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) return <div className="inline-spinner">Loading groups...</div>;
  if (error) return <div className="error-banner">{error}</div>;

  return (
    <>
      {(!rows || rows.length === 0) && <div className="glass-card" style={{ textAlign: 'center', padding: 20 }}>No groups have been added yet.</div>}

      {(rows || []).map((r, i) => {
        const isActive = isTruthyFlag(r.active);
        return (
          <div className="glass-card" style={{ padding: 15, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }} key={i}>
            <div>
              <strong>{r.group_name}</strong>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{r.groupid}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`badge ${isActive ? 'badge-ok' : 'badge-warn'} toggle-switch`} onClick={() => toggleActive(r)}>
                {isActive ? 'Active' : 'Inactive'}
              </span>
              <div className="row-actions">
                <button type="button" className="icon-btn" title="Edit" onClick={() => openEdit(r)}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>edit</span>
                </button>
                <button type="button" className="icon-btn icon-danger" title="Delete" onClick={() => remove(r)}>
                  <span className="material-icons-round" style={{ fontSize: 16 }}>delete</span>
                </button>
              </div>
            </div>
          </div>
        );
      })}

      <button className="fab" onClick={() => setShowAdd(true)}><span className="material-icons-round">add</span></button>

      <Modal open={showAdd} onClose={closeModal}>
        <h3 style={{ marginBottom: 15 }}>{editing ? 'Edit Group' : 'New Group'}</h3>
        <form onSubmit={submit}>
          <div className="form-group">
            <label>Group Name</label>
            <input value={form.groupName} onChange={e => setForm({ ...form, groupName: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Group ID</label>
            <input value={form.groupid} onChange={e => setForm({ ...form, groupid: e.target.value })} placeholder="e.g. 1203630xxxx@g.us" />
          </div>
          <button className="btn-submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </form>
      </Modal>
    </>
  );
}

// ============ Message Log (view-only + Resend for failed, auto-refresh) ============
function MessageLog() {
  const [tab, setTab] = useState('person'); // person | group
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resendingId, setResendingId] = useState(null);

  // Messages queued but never delivered. Nothing in this repo transitions a row
  // from 'pending' to sent/failed (only the external sender script does), so a
  // rotated API key / stale script URL / dead host used to accumulate 'pending'
  // rows FOREVER with no alert, no threshold and nothing in the UI to notice it.
  const [stuck, setStuck] = useState(null);

  const load = useCallback((silent) => {
    if (!silent) setLoading(true);
    api.getMessageLog().then(setRows).catch(err => setError(err.message)).finally(() => setLoading(false));
    api.getStuckMessages(30).then(setStuck).catch(() => { /* panel is advisory only */ });
  }, []);

  useEffect(() => {
    load(false);
    const interval = setInterval(() => load(true), 12000); // auto-refresh every 12s
    return () => clearInterval(interval);
  }, [load]);

  const badgeClass = (status) => status === 'sent' ? 'badge-ok' : status === 'failed' ? 'badge-warn' : 'badge-pending';

  const stuckCount = stuck ? stuck.total : 0;

  const resend = async (m) => {
    setResendingId(m.message_id);
    try {
      await api.resendMessage(m.type, m.message_id);
      load(true);
    } catch (err) {
      alert(err.message);
    } finally {
      setResendingId(null);
    }
  };

  const filtered = (rows || []).filter(r => r.type === tab);

  return (
    <>
      <div className="subtabs">
        <button className={`subtab-btn ${tab === 'person' ? 'active' : ''}`} onClick={() => setTab('person')}>Person</button>
        <button className={`subtab-btn ${tab === 'group' ? 'active' : ''}`} onClick={() => setTab('group')}>Group</button>
      </div>

      {stuckCount > 0 && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 8, padding: '10px 12px', fontSize: '0.85rem', margin: '10px 0' }}>
          🚨 <strong>{stuckCount} message{stuckCount === 1 ? '' : 's'}</strong> 30 minute se zyada se queue mein atke hain
          ({stuck.person.length} person, {stuck.group.length} group) — matlab bahar wala WhatsApp sender script chal nahi raha,
          ya uska API key / URL galat hai. Sender script aur <code>WHATSAPP_QUEUE_API_KEY</code> check karein.
        </div>
      )}

      {loading && <div className="inline-spinner">Loading messages...</div>}
      {error && <div className="error-banner">{error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div className="glass-card" style={{ textAlign: 'center', padding: 20 }}>No message records found.</div>
      )}

      {!loading && !error && filtered.map((m, i) => (
        <div className="glass-card" style={{ padding: 15, marginBottom: 10 }} key={m.message_id || i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
            <strong>{m.recipient}</strong>
            <div style={{ display: 'flex', gap: 6 }}>
              {m.message_type === 'priority' && <span className="badge badge-warn">⚡ Priority</span>}
              <span className={`badge ${badgeClass(m.status)}`}>{m.status}</span>
            </div>
          </div>
          <p style={{ margin: '0 0 6px', fontSize: '0.9rem', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{m.message}</p>
          {m.from && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>From: {m.from}</div>}
          {m.file_link && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>📎 <a href={m.file_link} target="_blank" rel="noreferrer">Attached file</a></div>}
          {m.remarks && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Remarks: {m.remarks}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {m.created_at}
              {m.attempts > 0 && <> · {m.attempts} attempt{m.attempts === 1 ? '' : 's'}</>}
              {m.sent_at && <> · finished {m.sent_at}</>}
            </div>
            {/* Was `m.status === 'failed'` only. Since nothing in this codebase ever
                sets 'failed' (only the external sender does), a message stuck at
                'pending'/'sending' was completely unrecoverable from the UI — the
                row just sat there with a "pending" chip and no action. */}
            {m.status !== 'sent' && (
              <button
                className="btn-submit" style={{ width: 'auto', padding: '4px 12px', fontSize: '0.8rem' }}
                onClick={() => resend(m)} disabled={resendingId === m.message_id}
              >
                {resendingId === m.message_id ? 'Resending...' : m.status === 'failed' ? 'Resend' : 'Re-queue'}
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

// ============ Settings (OTP/Consent sender number) ============
function WhatsAppSettings() {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getPortalSetting('otp_consent_sender_number')
      .then(res => setValue(res.value || ''))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.setPortalSetting('otp_consent_sender_number', value.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass-card" style={{ padding: 15 }}>
      <strong>OTP / Consent Sender Number</strong>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '4px 0 10px' }}>
        Loan OTP and Consent-related messages will be sent "from" this number (10-digit number). This does not apply to any other message types.
      </p>
      {error && <div className="error-banner" style={{ marginBottom: 10 }}>{error}</div>}
      {loading ? <div className="inline-spinner">Loading...</div> : (
        <>
          <input
            value={value}
            maxLength={10}
            inputMode="numeric"
            placeholder="10 digit number"
            onChange={e => setValue(e.target.value.replace(/\D/g, '').slice(0, 10))}
            style={{ marginBottom: 10 }}
          />
          <button className="btn-submit" style={{ width: 'auto' }} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </>
      )}
    </div>
  );
}

// ============ Root: WhatsApp tab with Template / Group Info / Message / Settings subtabs ============
export default function WhatsApp() {
  const [section, setSection] = useState('template'); // template | groupinfo | message | settings
  const [templateKind, setTemplateKind] = useState('person'); // person | group | loan
  const [loanTemplateType, setLoanTemplateType] = useState(LOAN_TEMPLATE_TYPES[0][0]);

  return (
    <>
      <h2 style={{ marginBottom: 15 }}>WhatsApp</h2>

      <div className="subtabs">
        <button className={`subtab-btn ${section === 'template' ? 'active' : ''}`} onClick={() => setSection('template')}>Template</button>
        <button className={`subtab-btn ${section === 'groupinfo' ? 'active' : ''}`} onClick={() => setSection('groupinfo')}>Group Info</button>
        <button className={`subtab-btn ${section === 'message' ? 'active' : ''}`} onClick={() => setSection('message')}>Message</button>
        <button className={`subtab-btn ${section === 'settings' ? 'active' : ''}`} onClick={() => setSection('settings')}>Settings</button>
      </div>

      {section === 'template' && (
        <>
          <div className="subtabs">
            <button className={`subtab-btn ${templateKind === 'person' ? 'active' : ''}`} onClick={() => setTemplateKind('person')}>Person</button>
            <button className={`subtab-btn ${templateKind === 'group' ? 'active' : ''}`} onClick={() => setTemplateKind('group')}>Group</button>
            <button className={`subtab-btn ${templateKind === 'loan' ? 'active' : ''}`} onClick={() => setTemplateKind('loan')}>Loan</button>
          </div>

          {templateKind === 'loan' && (
            <div className="subtabs" style={{ marginTop: 8 }}>
              {LOAN_TEMPLATE_TYPES.map(([val, lbl]) => (
                <button key={val} className={`subtab-btn ${loanTemplateType === val ? 'active' : ''}`} onClick={() => setLoanTemplateType(val)}>{lbl}</button>
              ))}
            </div>
          )}

          {templateKind === 'loan' ? (
            <TemplateList key={loanTemplateType} kind="loan" loanType={loanTemplateType} titleLabel={LOAN_TEMPLATE_TYPES.find(t => t[0] === loanTemplateType)?.[1]} />
          ) : (
            <TemplateList key={templateKind} kind={templateKind} />
          )}
        </>
      )}

      {section === 'groupinfo' && <GroupInfoList />}

      {section === 'message' && <MessageLog />}

      {section === 'settings' && <WhatsAppSettings />}
    </>
  );
}
