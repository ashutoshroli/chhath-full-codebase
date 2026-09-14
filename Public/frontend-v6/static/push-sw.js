/* eslint-disable no-undef */
// ============================================================================
// Push notification handlers for the portal's service worker.
//
// This file is NOT bundled by Vite. It is served as a static asset from
// /push-sw.js and pulled into the Workbox-generated service worker via
// `workbox: { importScripts: ['/push-sw.js'] }` in vite.config.ts.
//
// Why importScripts instead of a custom SW entry: the generated SW owns the
// precache manifest and the runtime-caching rules (the API NetworkFirst rule,
// the fonts CacheFirst rule, and the deliberate absence of a rule for the
// CORS-less R2 image host). Rewriting all of that as a hand-written
// `injectManifest` service worker risks regressing caching behaviour that took
// several fixes to get right. Importing this script leaves every one of those
// rules untouched and only ADDS event listeners.
//
// Constraints that follow from that choice: plain ES2019-ish JavaScript, no
// imports, no build-time env — everything must come from the pushed payload.
//
// The payload is produced by mgmt/backend/src/push.js and looks like:
//   { title, body, url, tag }
// ============================================================================

'use strict';

var DEFAULT_TITLE = 'Chhath Puja';
var DEFAULT_ICON = '/icons/icon-192.png';
var DEFAULT_BADGE = '/icons/icon-192.png';

// ---- notification inbox (IndexedDB) ----------------------------------------
//
// Every push is also written to IndexedDB so the portal can show an in-app
// notification list (the "Notifications" view in the Menu sheet). The pushed
// payload is all we get — mgmt keeps no server-side history of what it sent
// (mgmt/backend/src/push.js only writes push_subscriptions), so this device
// inbox IS the history.
//
// TWO THINGS TO KNOW, both deliberate:
//
//  1. Records are keyed by an auto-incrementing id, NOT by `tag`. The tag is
//     meant to COLLAPSE the tray notification (a second "new contribution"
//     replaces the first one in the system tray), but the in-app list must
//     still show both. Keying by tag would silently reduce a whole festival's
//     contributions to one row.
//
//  2. `receivedAt` is stamped HERE. The payload carries no timestamp or id
//     ({ title, body, url, tag } is the whole of it), so the moment of arrival
//     is the only time information that exists.
//
// SCHEMA IS SHARED with src/lib/notifications.ts, which reads the same database
// from the page. Change one, change the other.
var NOTIF_DB = 'chhath-notifications';
var NOTIF_DB_VERSION = 1;
var NOTIF_STORE = 'items';
/** Keep only the newest N so the inbox cannot grow without bound. */
var NOTIF_MAX = 50;

function openNotifDb() {
  return new Promise(function (resolve, reject) {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no indexedDB'));
      return;
    }
    var req = indexedDB.open(NOTIF_DB, NOTIF_DB_VERSION);
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(NOTIF_STORE)) {
        var store = db.createObjectStore(NOTIF_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('receivedAt', 'receivedAt');
      }
    };
    req.onsuccess = function () {
      resolve(req.result);
    };
    req.onerror = function () {
      reject(req.error || new Error('indexedDB open failed'));
    };
  });
}

/** Drop the oldest rows once the store grows past NOTIF_MAX. */
function trimNotifications(db) {
  return new Promise(function (resolve) {
    var tx = db.transaction(NOTIF_STORE, 'readwrite');
    var store = tx.objectStore(NOTIF_STORE);
    var countReq = store.count();
    countReq.onsuccess = function () {
      var extra = countReq.result - NOTIF_MAX;
      if (extra <= 0) {
        resolve();
        return;
      }
      // A plain cursor walks the primary key ascending, and the key is an
      // autoIncrement id, so this visits insertion order — oldest first.
      var removed = 0;
      var cursorReq = store.openCursor();
      cursorReq.onsuccess = function () {
        var cursor = cursorReq.result;
        if (!cursor || removed >= extra) {
          resolve();
          return;
        }
        cursor.delete();
        removed++;
        cursor.continue();
      };
      cursorReq.onerror = function () {
        resolve();
      };
    };
    countReq.onerror = function () {
      resolve();
    };
  });
}

function saveNotification(item) {
  return openNotifDb()
    .then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(NOTIF_STORE, 'readwrite');
        tx.objectStore(NOTIF_STORE).add(item);
        tx.oncomplete = function () {
          resolve(db);
        };
        tx.onerror = function () {
          reject(tx.error || new Error('inbox write failed'));
        };
        tx.onabort = function () {
          reject(tx.error || new Error('inbox write aborted'));
        };
      });
    })
    .then(function (db) {
      return trimNotifications(db);
    });
}

/** Tell any open page that the inbox changed, so its badge/list updates live. */
function notifyPages(type) {
  return self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then(function (list) {
      for (var i = 0; i < list.length; i++) list[i].postMessage({ type: type });
      return undefined;
    })
    .catch(function () {
      return undefined;
    });
}

// ---- push: show the notification -------------------------------------------
self.addEventListener('push', function (event) {
  var payload = {};
  if (event.data) {
    // Prefer JSON; fall back to treating the body as plain text so a
    // hand-crafted/plain push still shows something useful.
    try {
      payload = event.data.json() || {};
    } catch (e) {
      try {
        payload = { body: event.data.text() };
      } catch (e2) {
        payload = {};
      }
    }
  }

  var title = (payload.title || DEFAULT_TITLE).toString();
  var body = (payload.body || '').toString();
  var url = (payload.url || '/').toString();
  var tag = (payload.tag || 'chhath').toString();

  var options = {
    body: body,
    icon: DEFAULT_ICON,
    badge: DEFAULT_BADGE,
    // Same tag replaces an earlier unread notification instead of stacking.
    tag: tag,
    renotify: false,
    // Never wake the device silently in the middle of the night for this; the
    // portal is informational, not urgent.
    requireInteraction: false,
    data: { url: url }
  };

  // waitUntil keeps the SW alive until the notification is actually shown AND
  // the inbox row is written. The inbox write is best-effort and swallowed on
  // its own: a storage failure (private mode, quota, blocked IDB) must never
  // stop the notification itself from appearing.
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      saveNotification({
        title: title,
        body: body,
        url: url,
        tag: tag,
        receivedAt: Date.now(),
        read: 0
      })
        .then(function () {
          return notifyPages('push-received');
        })
        .catch(function () {
          return undefined;
        })
    ])
  );
});

// ---- notificationclick: focus an open tab, else open one -------------------
self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  var target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clientList) {
        // If the portal is already open somewhere, reuse that window.
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if ('focus' in client) {
            if ('navigate' in client && target && target !== '/') {
              return client.focus().then(function (focused) {
                return focused && focused.navigate ? focused.navigate(target) : focused;
              });
            }
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
        return undefined;
      })
      .catch(function () {
        /* never let a click handler reject */
      })
  );
});

// ---- sync / periodicsync: refresh the cached portal data -------------------
//
// Both are Chromium-only (Safari/iOS and Firefox never fire them), which is why
// the app ALSO refreshes on the `online` event from a page — see src/lib/sync.ts.
// Periodic Sync additionally needs an installed PWA plus site engagement, and the
// browser picks the real cadence (typically ~12h), so neither of these is
// something the UI may depend on.
//
// The work itself is deliberately tiny: re-fetch the portal payload so the
// generated Workbox NetworkFirst rule stores a fresh copy in the `chhath-api`
// cache. The next launch then paints current data immediately, even offline.
var SYNC_TAG = 'chhath-refresh';
var PERIODIC_TAG = 'chhath-periodic-refresh';

function refreshPortalCache() {
  // Ask any open page for the API base (it knows its own build-time config).
  // With no page open, fall back to the production Worker.
  var FALLBACK_API = 'https://chhath-public-worker.shaharpura.com';
  return fetch(FALLBACK_API + '/?action=dataVersion', { cache: 'no-store' })
    .then(function (res) {
      if (!res || !res.ok) return undefined;
      return res.json().catch(function () {
        return null;
      });
    })
    .then(function (v) {
      var q = v && v.v != null ? '&v=' + encodeURIComponent(v.v) : '';
      // Going through fetch() means the SW's own runtime-caching rule updates
      // the cache entry as a side effect.
      return fetch(FALLBACK_API + '/?action=portalData' + q);
    })
    .then(function () {
      return undefined;
    })
    .catch(function () {
      return undefined;
    });
}

self.addEventListener('sync', function (event) {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil(refreshPortalCache());
});

self.addEventListener('periodicsync', function (event) {
  if (event.tag !== PERIODIC_TAG) return;
  event.waitUntil(refreshPortalCache());
});

// ---- pushsubscriptionchange: re-register when the browser rotates keys -----
// Browsers may replace a subscription without user action. Without this the
// endpoint silently goes dead. We re-subscribe with the same server key and
// hand the new subscription back to the public worker.
self.addEventListener('pushsubscriptionchange', function (event) {
  event.waitUntil(
    (function () {
      var oldSub = event.oldSubscription || null;
      var appServerKey =
        (event.newSubscription && event.newSubscription.options && event.newSubscription.options.applicationServerKey) ||
        (oldSub && oldSub.options && oldSub.options.applicationServerKey) ||
        null;

      var ready = event.newSubscription
        ? Promise.resolve(event.newSubscription)
        : appServerKey
          ? self.registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: appServerKey
            })
          : Promise.resolve(null);

      return ready
        .then(function (sub) {
          if (!sub) return undefined;
          // The API base is not available here (no build-time env in this file),
          // so ask any open page to persist it. If no page is open the next visit
          // re-subscribes anyway, because the app always upserts on load.
          return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
            for (var i = 0; i < list.length; i++) {
              list[i].postMessage({ type: 'push-subscription-changed', subscription: sub.toJSON() });
            }
            return undefined;
          });
        })
        .catch(function () {
          /* best effort */
        });
    })()
  );
});
