import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api, reportClientError } from '../api.js';
import { safeImport } from '../chunkGuard.js';
import { generateQrDataUrl, publicRecordUrl } from '../qrCode.js';
import ReportErrorButton from '../components/ReportErrorButton.jsx';

// Public, no-login page: /consent/:token
//
// Flow: load loan details -> OTP verify -> choose Accept or Decline:
//   Accept  — camera photo (live getUserMedia capture) + location + signature
//             upload are ALL mandatory before the final "Confirm Accept" button
//             unlocks. Nothing is optional here — if camera/location permission
//             is denied, Accept simply cannot proceed (Decline still can).
//   Decline — a mandatory remarks box explaining why, no photo/location needed.
// Once submitted, the link permanently shows the locked-in decision.

const MAX_SIGNATURE_BYTES = 1024 * 1024; // 1MB

// Kept in sync with receiptTemplate.js's renderReceiptTemplate().
//
// The old condition was `placeholders[key] !== undefined && placeholders[key] !== ''`,
// so a REAL-but-blank field (e.g. FINAL_REPAYMENT_DAY_NAME when the Festival Dates
// haven't been entered for the year) printed the literal text
// "[FINAL_REPAYMENT_DAY_NAME]" on a PUBLIC legal page. receiptTemplate.js
// substitutes an empty string in exactly that case — the two resolvers had
// diverged. An UNKNOWN key still renders literally, which is the useful signal
// (it means the template references a placeholder that does not exist).
function substitutePlaceholders(text, placeholders) {
  return (text || '').replace(/\[([A-Z0-9_]+)\]/g, (m, key) => (
    Object.prototype.hasOwnProperty.call(placeholders || {}, key) ? String(placeholders[key]) : m
  ));
}

function fileToCompressedBase64(file, maxDim = 1000, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('File could not be read'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image failed to load'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function getGeoLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    const timer = setTimeout(() => resolve(null), 10000);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }); },
      () => { clearTimeout(timer); resolve(null); },
      { timeout: 9000, maximumAge: 60000 }
    );
  });
}

// Live camera capture — a real getUserMedia permission prompt (not a file picker),
// so we can tell whether the person actually granted camera access.
function CameraCapture({ photo, onCapture }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [state, setState] = useState('idle'); // idle | starting | live | denied

  const startCamera = async () => {
    setState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setState('live');
    } catch (err) {
      setState('denied');
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return; // frame not ready yet — button shouldn't normally be clickable this fast, but guard anyway
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    stopCamera();
    onCapture(canvas.toDataURL('image/jpeg', 0.75).split(',')[1]);
  };

  const stopCamera = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    setState('idle');
  };

  useEffect(() => () => stopCamera(), []);

  if (photo) {
    return (
      <div>
        <img src={`data:image/jpeg;base64,${photo}`} alt="Captured" style={{ width: '100%', borderRadius: 8, marginBottom: 8 }} />
        <button type="button" className="btn-submit" style={{ background: '#e5e7eb', color: '#111' }} onClick={() => onCapture(null)}>Retake Photo</button>
      </div>
    );
  }

  return (
    <div>
      <video
        ref={videoRef}
        style={{ width: '100%', borderRadius: 8, marginBottom: 8, transform: 'scaleX(-1)', display: state === 'live' ? 'block' : 'none' }}
        muted
        playsInline
      />
      {state === 'live' ? (
        <button type="button" className="btn-submit" onClick={capture}>📸 Capture Photo</button>
      ) : (
        <button type="button" className="btn-submit" onClick={startCamera} disabled={state === 'starting'}>
          {state === 'starting' ? 'Opening camera...' : '📷 Open Camera'}
        </button>
      )}
      {state === 'denied' && (
        <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: 6 }}>
          Camera permission was denied. Please allow camera access in your browser settings and try again — a photo is required to Accept.
        </p>
      )}
    </div>
  );
}

export default function ConsentPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [finalStatus, setFinalStatus] = useState(null);
  const [mode, setMode] = useState(null); // null | 'accept' | 'decline'

  // Accept-path state
  const [photo, setPhoto] = useState(null);
  const [geo, setGeo] = useState(null);
  const [geoState, setGeoState] = useState('idle'); // idle | requesting | granted | denied
  const [signatureBase64, setSignatureBase64] = useState(null);
  const [signatureError, setSignatureError] = useState('');

  // Decline-path state
  const [declineRemarks, setDeclineRemarks] = useState('');

  const load = () => {
    setLoading(true);
    api.getConsentByToken(token)
      .then(d => { setData(d); if (d.status !== 'pending') setFinalStatus(d.status); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  const sendOtp = async () => {
    setBusy(true);
    setError('');
    try {
      await api.requestConsentOtp(token);
      setOtpSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    if (!otp.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.verifyConsentOtp(token, otp.trim());
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const requestGeo = async () => {
    setGeoState('requesting');
    const result = await getGeoLocation();
    if (result) { setGeo(result); setGeoState('granted'); }
    else setGeoState('denied');
  };

  const onSignatureFile = async (e) => {
    const file = e.target.files[0];
    setSignatureError('');
    setSignatureBase64(null);
    if (!file) return;
    if (file.size > MAX_SIGNATURE_BYTES) {
      setSignatureError('File is larger than 1MB — please upload a smaller photo/scan.');
      return;
    }
    try {
      const b64 = await fileToCompressedBase64(file, 800, 0.8);
      setSignatureBase64(b64);
    } catch (err) {
      setSignatureError(err.message);
    }
  };

  const submitAccept = async () => {
    if (!confirm('You are about to Accept — confirm?')) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.respondConsent(token, 'accepted', { geo, photoBase64: photo, signatureBase64 });
      setFinalStatus(res.status);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitDecline = async () => {
    if (!declineRemarks.trim()) return alert('Please provide a reason for declining');
    if (!confirm('You are about to Decline — confirm?')) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.respondConsent(token, 'declined', { declineRemarks: declineRemarks.trim() });
      setFinalStatus(res.status);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div style={pageStyle}><div className="inline-spinner">Loading...</div></div>;
  if (error && !data) return (
    <div style={pageStyle}>
      <div className="glass-card" style={{ padding: 20, maxWidth: 480, margin: '40px auto' }}>
        <div className="error-banner">{error}</div>
        <ReportErrorButton page="Consent" message={error} />
      </div>
    </div>
  );
  if (!data) return null;

  const locked = finalStatus || (data.status !== 'pending' ? data.status : null);
  const html = DOMPurify.sanitize(marked.parse(substitutePlaceholders(data.templateText, data.placeholders)));
  const acceptReady = photo && geo && signatureBase64;

  return (
    <div style={pageStyle}>
      <div className="glass-card" style={{ padding: 20, maxWidth: 640, margin: '20px auto' }}>
        <div className="consent-doc" dangerouslySetInnerHTML={{ __html: html }} />

        {error && <div className="error-banner" style={{ margin: '15px 0' }}>{error}</div>}

        {locked ? (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <span className={`badge ${locked === 'accepted' ? 'badge-ok' : 'badge-warn'}`} style={{ fontSize: '1rem', padding: '8px 16px' }}>
              {locked === 'accepted' ? '✓ You have Accepted / आपने स्वीकार किया' : '✕ You have Declined / आपने अस्वीकार किया'}
            </span>
            <p style={{ marginTop: 12, fontSize: '0.8rem', color: 'var(--text-muted)' }}>This decision is final and cannot be changed.</p>
            <ConsentPdfDownload
              role={data.role}
              fundYear={data.placeholders.FUND_YEAR}
              placeholders={data.placeholders}
              consentId={data.consentId}
              docTypeFromServer={data.docType}
              token={token}
            />
          </div>
        ) : (
          <>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '15px 0', fontSize: '0.85rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ marginTop: 3 }} />
              <span>मैंने ऊपर दिए गए सभी विवरण और नियम-शर्तों को ध्यानपूर्वक पढ़ लिया है और समझ लिया है। / I have read and understood all the details and terms mentioned above.</span>
            </label>

            {data.lockedReason && (
              <div style={{ background: '#FEF3C7', color: '#92400E', padding: 10, borderRadius: 8, fontSize: '0.8rem', marginBottom: 12 }}>
                ⚠️ Final Acceptance Locked — {data.lockedReason}. You cannot Accept until all three guarantors have Accepted (you may still Decline).
              </div>
            )}

            {!otpSent ? (
              <button className="btn-submit" onClick={sendOtp} disabled={busy || !agreed}>
                {busy ? 'Sending...' : 'Send OTP via WhatsApp'}
              </button>
            ) : !data.otpVerified ? (
              <>
                <div className="form-group">
                  <label>Enter OTP (sent via WhatsApp)</label>
                  <input value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} maxLength={6} inputMode="numeric" />
                </div>
                <button className="btn-submit" onClick={verifyOtp} disabled={busy || otp.length !== 6}>
                  {busy ? 'Verifying...' : 'Verify OTP'}
                </button>
                <button type="button" className="btn-submit" style={{ background: '#e5e7eb', color: '#111', marginTop: 8 }} onClick={sendOtp} disabled={busy}>
                  Resend OTP
                </button>
              </>
            ) : !mode ? (
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn-submit" style={{ background: 'var(--success)' }} onClick={() => setMode('accept')} disabled={!!data.lockedReason}>
                  Accept / स्वीकार करें
                </button>
                <button className="btn-submit" style={{ background: 'var(--danger)' }} onClick={() => setMode('decline')}>
                  Decline / अस्वीकार करें
                </button>
              </div>
            ) : mode === 'decline' ? (
              <div>
                <div className="form-group">
                  <label>Reason for declining (required)</label>
                  <textarea rows={3} value={declineRemarks} onChange={e => setDeclineRemarks(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #ddd' }} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-submit" style={{ background: 'var(--danger)' }} onClick={submitDecline} disabled={busy || !declineRemarks.trim()}>
                    {busy ? 'Submitting...' : 'Confirm Decline'}
                  </button>
                  <button type="button" className="btn-submit" style={{ background: '#e5e7eb', color: '#111' }} onClick={() => setMode(null)}>Back</button>
                </div>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                  All three are required to Accept — photo, location, and signature. These will be permanently saved with your consent record.
                </p>

                <div style={{ marginBottom: 15 }}>
                  <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: 6 }}>1. Take Your Photo</strong>
                  <CameraCapture photo={photo} onCapture={setPhoto} />
                </div>

                <div style={{ marginBottom: 15 }}>
                  <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: 6 }}>2. Location</strong>
                  {geoState === 'granted' ? (
                    <span className="badge badge-ok">✓ Location Captured</span>
                  ) : (
                    <button type="button" className="btn-submit" onClick={requestGeo} disabled={geoState === 'requesting'}>
                      {geoState === 'requesting' ? 'Getting location...' : '📍 Allow Location'}
                    </button>
                  )}
                  {geoState === 'denied' && (
                    <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: 6 }}>
                      Location permission was not granted. Please allow location access in your browser settings and try again.
                    </p>
                  )}
                </div>

                <div style={{ marginBottom: 15 }}>
                  <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: 6 }}>3. Upload Your Signature (max 1MB)</strong>
                  <div style={{ background: '#f9fafb', borderRadius: 8, padding: 10, marginBottom: 8, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Sign on a plain sheet of paper, take a clear photo of it, and upload it here.
                  </div>
                  <input type="file" accept="image/*" onChange={onSignatureFile} />
                  {signatureBase64 && (
                    <img src={`data:image/jpeg;base64,${signatureBase64}`} alt="Signature" style={{ maxWidth: '100%', maxHeight: 120, marginTop: 8, border: '1px solid #eee', borderRadius: 6 }} />
                  )}
                  {signatureError && <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: 6 }}>{signatureError}</p>}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-submit" style={{ background: 'var(--success)' }} onClick={submitAccept} disabled={busy || !acceptReady}>
                    {busy ? 'Submitting...' : 'Confirm Accept'}
                  </button>
                  <button type="button" className="btn-submit" style={{ background: '#e5e7eb', color: '#111' }} onClick={() => setMode(null)}>Back</button>
                </div>
              </div>
            )}

            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 12 }}>
              To Accept, your photo, signature, device, IP, and location will be recorded as required.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const pageStyle = { minHeight: '100vh', background: 'var(--bg-offwhite)', padding: '20px 15px' };

// Shown once a decision is locked in. Silently hides itself if no Superadmin-
// uploaded .docx template exists yet for this role+year (no error shown — this
// isn't the person's fault and doesn't need to interrupt their flow).
function ConsentPdfDownload({ role, fundYear, placeholders, consentId, docTypeFromServer, token }) {
  const [templateRow, setTemplateRow] = useState(null);
  const [checked, setChecked] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [qrCode, setQrCode] = useState('');
  const [error, setError] = useState('');
  const docType = docTypeFromServer || (role === 'loaner' ? 'consent_loaner' : 'consent_guarantor');

  // Was: `placeholders.LOAN_CONSENT_ID || placeholders.CONSENT_ID`
  //
  // For a GUARANTOR, LOAN_CONSENT_ID is the *loaner's* consent_id and CONSENT_ID is
  // the guarantor's own — so `||` picked the WRONG one. Every guarantor PDF was
  // stored/indexed as `consent_guarantor-<year>-<LOANER id>` while Download Center
  // and the public portal both look for `...-<GUARANTOR id>`: never matched, never
  // shown, and a duplicate PDF generated on the next attempt. Worse, before the
  // loaner had consented LOAN_CONSENT_ID was '', so the SAME guarantor produced a
  // DIFFERENT recordId depending on when they clicked.
  // The server now supplies the authoritative id.
  const consentRefId = consentId || placeholders.CONSENT_ID;

  useEffect(() => {
    let alive = true;
    // Now token-gated server-side; the token also decides which role+year template
    // may be read at all.
    api.getDocxTemplatePublic(docType, fundYear, token)
      .then(row => { if (alive) setTemplateRow(row); })
      // Still silent on purpose (a missing template is not the person's fault and
      // must not interrupt their flow) — but it is reported now, because before
      // this hid genuine failures too.
      .catch(err => { if (alive) reportClientError('ConsentPage', `Consent template load failed (${docType}/${fundYear})`, err, { docType, fundYear }); })
      .finally(() => { if (alive) setChecked(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType, fundYear, token]);

  useEffect(() => {
    if (!consentRefId) return;
    const recordId = `${docType}-${fundYear}-${consentRefId}`;
    generateQrDataUrl(publicRecordUrl(recordId))
      .then(setQrCode)
      .catch(err => reportClientError('ConsentPage', `QR generation failed for ${recordId}`, err, { docType, fundYear, recordId }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType, fundYear, consentRefId]);

  const download = async () => {
    setDownloading(true);
    setError('');
    try {
      const { fillDocxTemplateFromRow, getLastRenderReport } = await safeImport(() => import('../docxFill.js'), 'docxFill');
      const filledBase64 = await fillDocxTemplateFromRow(templateRow, { ...placeholders, GENERATED_AT: new Date().toLocaleString('en-IN'), QR_CODE: qrCode });

      const rep = getLastRenderReport();
      if (rep.missingTags.length) {
        reportClientError('ConsentPage', 'Consent template had unresolved placeholders', null,
          { docType, fundYear, consentId: consentRefId, missingTags: [...new Set(rep.missingTags)] });
      }

      // docType / year / recordId / fileName are all derived SERVER-side from the
      // verified consent token now — the client only sends the bytes, so it can no
      // longer choose where the file is indexed.
      const res = await api.convertDocxToPdfPublic(filledBase64, token);

      if (res && res.indexFailed) {
        reportClientError('ConsentPage', `Consent PDF generated but NOT indexed (${consentRefId})`, null,
          { docType, fundYear, consentId: consentRefId, publicLink: res.publicLink });
      }

      // `download` is ignored cross-origin and the click is several awaits after
      // the gesture, so use a real DOM node.
      const a = document.createElement('a');
      a.href = res.publicLink;
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setError('There was a problem while generating the PDF: ' + err.message);
      reportClientError('ConsentPage', `Consent PDF generation failed (${consentRefId})`, err, { docType, fundYear, consentId: consentRefId });
    } finally {
      setDownloading(false);
    }
  };

  if (!checked || !templateRow || (!templateRow.base64 && !templateRow.downloadUrl)) return null;


  return (
    <>
      <button className="btn-submit" style={{ marginTop: 12, width: 'auto' }} onClick={download} disabled={downloading}>
        {downloading ? 'Generating PDF...' : '⬇ Download PDF'}
      </button>
      {error && (
        <>
          <div style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: 8 }}>{error}</div>
          <ReportErrorButton page="Consent PDF" message={error} />
        </>
      )}
    </>
  );
}
