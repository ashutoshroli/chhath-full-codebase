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

// Client-reported public IP (fetched once per app load, then cached in memory).
// This is what the *browser* sees as its own public IP — Apps Script has no
// native way to read the caller's IP — so it's a convenience log, not proof.
let cachedIpPromise = null;
export function getClientIp() {
  if (!cachedIpPromise) {
    cachedIpPromise = fetch('https://api.ipify.org?format=json')
      .then(r => r.json())
      .then(d => d.ip || 'unknown')
      .catch(() => 'unknown');
  }
  return cachedIpPromise;
}
