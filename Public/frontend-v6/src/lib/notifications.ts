/**
 * Notification inbox — the PAGE side of the IndexedDB store that the service
 * worker writes on every push.
 *
 * Why a device inbox at all: mgmt sends exactly two kinds of push (an automatic
 * "Naya contribution" when a COLLECTIONS row is added, and the manual broadcast
 * from the "Custom Notification" tab) and keeps NO server-side record of either
 * — mgmt/backend/src/push.js only ever writes push_subscriptions. The pushed
 * payload is `{ title, body, url, tag }` with no id and no timestamp. So the
 * only place a history can exist is the device that received it, which is what
 * static/push-sw.js writes and this module reads.
 *
 * Consequences worth remembering (they are inherent, not bugs):
 *  - only notifications that ARRIVED on this device are here, so a visitor who
 *    never opted in sees an empty inbox;
 *  - nothing from before this feature shipped can appear;
 *  - the list is per-device, not per-person.
 *
 * SCHEMA IS SHARED with static/push-sw.js (which cannot import anything — it is
 * loaded into the generated service worker via importScripts). Keep the database
 * name, version and store name in sync across both files.
 */
import { browser } from '$app/environment';

const DB_NAME = 'chhath-notifications';
const DB_VERSION = 1;
const STORE = 'items';

export interface InboxItem {
  id: number;
  title: string;
  body: string;
  /** Where tapping the notification should go (defaults to '/'). */
  url: string;
  /** The push `tag`; kept for reference — rows are NOT collapsed by it. */
  tag: string;
  /** Stamped by the service worker on arrival (ms since epoch). */
  receivedAt: number;
  read: 0 | 1;
}

/** True when this browser can hold the inbox at all. */
export function inboxSupported(): boolean {
  return browser && typeof indexedDB !== 'undefined';
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!inboxSupported()) {
      reject(new Error('no indexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // The page may well open the database before any push has ever arrived, so
    // it must be able to CREATE the store too — not just read one the service
    // worker made earlier.
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('receivedAt', 'receivedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

/** Newest first. Returns [] rather than throwing when storage is unavailable. */
export async function listInbox(): Promise<InboxItem[]> {
  if (!inboxSupported()) return [];
  try {
    const db = await open();
    return await new Promise<InboxItem[]>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const rows = (req.result ?? []) as InboxItem[];
        rows.sort((a, b) => (b.receivedAt ?? 0) - (a.receivedAt ?? 0));
        resolve(rows);
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/** Flip every unread row to read. Best-effort. */
export async function markInboxRead(): Promise<void> {
  if (!inboxSupported()) return;
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const cursorReq = tx.objectStore(STORE).openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return; // tx.oncomplete resolves
        const row = cursor.value as InboxItem;
        if (!row.read) cursor.update({ ...row, read: 1 });
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    /* best-effort */
  }
}

/** Empty the inbox. Best-effort. */
export async function clearInbox(): Promise<void> {
  if (!inboxSupported()) return;
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    /* best-effort */
  }
}
