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

