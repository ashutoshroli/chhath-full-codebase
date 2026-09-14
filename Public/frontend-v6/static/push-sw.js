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

  // waitUntil keeps the SW alive until the notification is actually shown.
  event.waitUntil(self.registration.showNotification(title, options));
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
