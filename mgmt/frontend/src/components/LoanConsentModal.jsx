import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { invalidate } from '../cache.js';
import Modal from './Modal.jsx';
import SearchableSelect from './SearchableSelect.jsx';
import { isSuperadmin } from '../permissions.js';

const STATUS_LABEL = { pending: 'Pending', accepted: 'Accepted', declined: 'Declined', replaced: 'Replaced' };
const STATUS_BADGE = { pending: 'badge-warn', accepted: 'badge-ok', declined: 'badge-danger', replaced: 'badge-warn' };

// loan: the LOANS row (needs 'Loan ID' + 'Loan Status'). contributorOptions: for the
// "replace guarantor" picker — pass the same list Loans.jsx uses for issuing loans.
export default function LoanConsentModal({ loan, open, onClose, role, contributorOptions, onChanged }) {
  const [consents, setConsents] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [replacingId, setReplacingId] = useState(null);
  const [newGuarantor, setNewGuarantor] = useState('');
  const [showDisburseForm, setShowDisburseForm] = useState(false);
  const [cashAmount, setCashAmount] = useState('');
  const [onlineAmount, setOnlineAmount] = useState('');

  const loanId = loan && loan['Loan ID'];

  const load = () => {
    if (!loanId) return;
    setLoading(true);
    api.getLoanConsents(loanId).then(setConsents).catch(err => setError(err.message)).finally(() => setLoading(false));
  };

  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open, loanId]);

  if (!loanId) {
    return (
      <Modal open={open} onClose={onClose}>
        <p style={{ padding: 20 }}>This is an older loan (predates the Consent system) — no consent record is available.</p>
      </Modal>
    );
  }

  const resend = async (consentId) => {
    setBusyId(consentId);
    setError('');
    try {
      await api.resendConsent(consentId);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const startReplace = (consentId) => { setReplacingId(consentId); setNewGuarantor(''); };

  const confirmReplace = async (consentId) => {
    if (!newGuarantor) return alert('Please select a new guarantor');
    setBusyId(consentId);
    setError('');
    try {
      await api.replaceGuarantor(loanId, consentId, newGuarantor);
      setReplacingId(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const disburse = async () => {
    const cash = parseFloat(cashAmount) || 0;
    const online = parseFloat(onlineAmount) || 0;
    if (cash <= 0 && online <= 0) return alert('Please enter at least one amount — Cash or Online.');
    if (!confirm(`Disburse: Cash ₹${cash} + Online ₹${online} = Total ₹${cash + online}. Confirm?`)) return;
    setBusyId('disburse');
    setError('');
    try {
      await api.markLoanDisbursed(loanId, cash, online);
      invalidate('loans:');
      onChanged && onChanged();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const allAccepted = (consents || []).filter(c => c.status !== 'replaced').every(c => c.status === 'accepted') && (consents || []).length > 0;
  const canDisburse = isSuperadmin(role) && loan['Loan Status'] === 'Approved';

  return (
    <Modal open={open} onClose={onClose}>
      <h3 style={{ marginBottom: 5 }}>Loan Status</h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 15 }}>
        Loan ID: {loanId} — <strong>{loan['Loan Status'] || 'Created'}</strong>
      </p>

      {error && <div className="error-banner" style={{ marginBottom: 10 }}>{error}</div>}
      {loading && <div className="inline-spinner">Loading...</div>}

      {!loading && (consents || []).filter(c => c.status !== 'replaced').map(c => (
        <div className="glass-card" style={{ padding: 12, marginBottom: 10 }} key={c.consent_id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>{c.personName}</strong>{c.personNameHindi ? ` (${c.personNameHindi})` : ''}
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.role === 'loaner' ? 'Loan Receiver' : 'Guarantor'} — Sent {c.send_count}/5</div>
            </div>
            <span className={`badge ${STATUS_BADGE[c.status] || 'badge-warn'}`}>{STATUS_LABEL[c.status] || c.status}</span>
          </div>

          {isSuperadmin(role) && c.status !== 'accepted' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-submit"
                style={{ width: 'auto', padding: '6px 12px', fontSize: '0.8rem' }}
                onClick={() => resend(c.consent_id)}
                disabled={busyId === c.consent_id || parseInt(c.send_count) >= 5}
              >
                {parseInt(c.send_count) >= 5 ? 'Max reached' : 'Resend'}
              </button>
              {c.role === 'guarantor' && (
                <button
                  type="button"
                  className="btn-submit"
                  style={{ width: 'auto', padding: '6px 12px', fontSize: '0.8rem', background: '#e5e7eb', color: '#111' }}
                  onClick={() => startReplace(c.consent_id)}
                >
                  Change Guarantor
                </button>
              )}
            </div>
          )}

          {replacingId === c.consent_id && (
            <div style={{ marginTop: 10, background: '#f9fafb', padding: 10, borderRadius: 8 }}>
              <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: 6 }}>New Guarantor</label>
              <SearchableSelect options={contributorOptions || []} value={newGuarantor} onChange={setNewGuarantor} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" className="btn-submit" style={{ width: 'auto', padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => confirmReplace(c.consent_id)} disabled={busyId === c.consent_id}>Confirm</button>
                <button type="button" className="btn-submit" style={{ width: 'auto', padding: '6px 12px', fontSize: '0.8rem', background: '#e5e7eb', color: '#111' }} onClick={() => setReplacingId(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}

      {canDisburse && !showDisburseForm && (
        <button className="btn-submit" style={{ marginTop: 10 }} onClick={() => setShowDisburseForm(true)}>
          Mark as Disbursed
        </button>
      )}

      {canDisburse && showDisburseForm && (
        <div className="glass-card" style={{ padding: 12, marginTop: 10 }}>
          <label style={{ fontSize: '0.8rem' }}>Cash Amount (₹)</label>
          <input type="number" min="0" className="input-field" value={cashAmount} onChange={e => setCashAmount(e.target.value)} placeholder="0" />
          <label style={{ fontSize: '0.8rem', marginTop: 8, display: 'block' }}>Online Amount (₹)</label>
          <input type="number" min="0" className="input-field" value={onlineAmount} onChange={e => setOnlineAmount(e.target.value)} placeholder="0" />
          <p style={{ fontSize: '0.8rem', marginTop: 6 }}>Total: ₹{(parseFloat(cashAmount) || 0) + (parseFloat(onlineAmount) || 0)}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn-submit" style={{ width: 'auto' }} onClick={disburse} disabled={busyId === 'disburse'}>
              {busyId === 'disburse' ? 'Marking...' : 'Confirm Disburse'}
            </button>
            <button type="button" className="btn-submit" style={{ width: 'auto', background: '#e5e7eb', color: '#111' }} onClick={() => setShowDisburseForm(false)}>Cancel</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
