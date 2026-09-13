// Ported verbatim from the React app (mgmt/frontend/src/device.js) — behaviour
// must stay identical so the backend sees the same device id / info.
const DEVICE_KEY = 'cpm_device_id';

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : 'dev-' + Math.random().toString(36).slice(2) + Date.now();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getDeviceInfo(): string {
  return (navigator.userAgent || 'unknown').slice(0, 200);
}
