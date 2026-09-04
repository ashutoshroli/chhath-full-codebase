// Lightweight device fingerprint for the Activity Log — not a security feature,
// just enough to tell "which device/browser did this" apart in the log sheet.
const DEVICE_KEY = 'cpm_device_id';

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'dev-' + Math.random().toString(36).slice(2) + Date.now());
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getDeviceInfo() {
  return (navigator.userAgent || 'unknown').slice(0, 200);
}

// NOTE (audit H-13): getClientIp() used to live here and fetched
// https://api.ipify.org on every app load, then sent the result with every API
// call. It was removed because:
//   * it leaked every committee member's IP address to a third party we do not
//     control, on every visit, for no functional benefit;
//   * api.js awaited it before the FIRST request of a page load, so a slow or
//     blocked ipify delayed the whole app (and cost a full fetch timeout on a
//     restrictive network);
//   * the value was thrown away anyway — index.js overwrites req.clientIp with the
//     server-observed CF-Connecting-IP, which is the authoritative, unspoofable
//     value, and a client-reported IP is by definition forgeable.
// The server-side edge IP is what the audit log and consent records store.
