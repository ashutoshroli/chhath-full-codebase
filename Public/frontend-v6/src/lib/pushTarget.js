// ============ WHERE A NOTIFICATION MAY SEND YOU (audit PR-44) ============
//
// A push payload is `{ title, body, url, tag }` and the `url` decides where a click goes. Two
// places acted on it and NEITHER confined it to this site:
//
//  * `static/push-sw.js` (`notificationclick`) passed it straight to `client.navigate(target)`
//    and `clients.openWindow(target)` with no check at all. A service worker will navigate to
//    any URL you give it, so a payload carrying `https://evil.example` takes the visitor
//    off-site from inside what looks like the installed portal — the most trusted surface the
//    app has.
//
//  * `NotificationsView.svelte` had a check, and a comment saying
//        "Only allow same-origin/relative targets from the payload."
//    over code that called `safeUrl()`, which only requires `^https?://`. It rejects
//    `javascript:` and accepts EVERY cross-origin https URL. The comment described the intent;
//    the code did something else, which is worse than no comment, because it stops anyone
//    looking again.
//
// The payload is produced by mgmt's own push.js today, so this is defence in depth rather than
// a live exploit — but "the sender is trusted" is not a property the receiving end can check,
// and a notification is precisely the surface where a visitor's guard is lowest.
//
// THIS FILE IS DUPLICATED, BYTE FOR BYTE, INSIDE static/push-sw.js between `8< ----` markers.
// That file is served as a static asset and pulled in with `importScripts`, so it cannot import
// anything — see its header for why it is not bundled. A test asserts the two copies are
// identical, so they cannot drift.

// 8< ---- shared with static/push-sw.js — keep byte-identical ----------------------------
/**
 * The path a notification is allowed to open, as a same-origin, absolute path.
 *
 * Returns '/' for anything that is not plainly this site: another origin, a scheme that is not
 * http(s), a protocol-relative `//host` (which LOOKS relative and is not), or junk. Never
 * returns an absolute URL, so a caller cannot accidentally navigate off-site with the result.
 *
 * Typed with JSDoc rather than TypeScript syntax on purpose: this block is copied verbatim into
 * static/push-sw.js, which is plain ES2019 with no build step.
 *
 * @param {unknown} raw  Anything; only a string can produce a path.
 * @param {string} origin
 * @returns {string}
 */
function sameOriginPath(raw, origin) {
  // The payload contract says `url` is a string. Coercing anything else would turn a malformed
  // payload into a real-looking path — String(42) resolves to '/42', which is same-origin and so
  // technically safe, but it is not a page and pretending otherwise hides the malformed payload.
  if (typeof raw !== 'string') return '/';
  var input = raw.trim();
  if (!input) return '/';
  // `//evil.example` is protocol-relative: it starts with '/' but is cross-origin. Checked
  // before the plain-path case, because that is exactly the string a naive `startsWith('/')`
  // test waves through.
  if (input.indexOf('//') === 0) return '/';
  try {
    // A relative input resolves against `origin`; an absolute one keeps its own origin, which
    // is what the comparison below then rejects.
    var resolved = new URL(input, origin);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return '/';
    if (resolved.origin !== new URL(origin).origin) return '/';
    return resolved.pathname + resolved.search + resolved.hash;
  } catch (e) {
    return '/';
  }
}
// 8< ---- end shared block ---------------------------------------------------------------

export { sameOriginPath };
