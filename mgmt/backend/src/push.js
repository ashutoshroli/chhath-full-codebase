// ============================================================================
// WEB PUSH (public portal notifications)
//
// The PUBLIC worker owns SUBSCRIBING (a visitor opts in on the portal and the
// public worker upserts the subscription — see Public/backend/src/index.js
// ?action=savePushSubscription). This module owns SENDING, and lives in the mgmt
// worker for two reasons:
//   1. the VAPID PRIVATE key is a secret and must never sit in the public,
//      unauthenticated worker;
//   2. the events worth notifying about happen here (a new contribution is
//      saved), and the cron can prune dead endpoints.
// Both workers bind the same physical D1 database (chhath-core), so this module
// simply reads the rows the public worker wrote.
//
// CRYPTO: Web Push needs a VAPID ES256 JWT plus an aes128gcm-encrypted payload
// (RFC 8291/8292). Node's `web-push` does not run on Workers, so we use
// `web-push-browser` — a zero-dependency library built on the Web Crypto API
// that defaults to aes128gcm (the encoding Safari/iOS requires; the older
// `aesgcm` draft is not used).
//
// CONFIG (all optional — with none of it set, every function below no-ops so the
// portal and the mgmt UI keep working exactly as before):
//   VAPID_PUBLIC_KEY   [vars]   base64url RAW P-256 public key (also shipped to
//                               the browser as applicationServerKey)
//   VAPID_PRIVATE_KEY  secret   base64url PKCS8 private key
//   VAPID_SUBJECT      [vars]   mailto: contact for the push service
//
// FREE-PLAN CPU BUDGET: signing + encrypting is per-subscriber work. A blocking
// loop over every subscriber inside one request would burn through the Workers
// free-plan CPU limit, so broadcast() never awaits the fan-out itself — it hands
// each subscriber to ctx.waitUntil() as its OWN task (see broadcast()).
// ============================================================================

import { ValidationError } from './auth.js';
import { logErrorAt, logWarn } from './logger.js';
import { userByIdCode } from './lookups.js';

// The crypto library is imported LAZILY, on the first actual send. The Worker
// test suite deliberately runs with nothing installed ("no dependencies, nothing
// to install" — .github/workflows/ci.yml), and it imports the Worker source
// directly, so a top-level `import 'web-push-browser'` would break every test in
// CI the moment index.js wires this module in. Nothing below reaches the import
// unless pushConfigured(env) is true (i.e. VAPID keys are set), which is never
// the case in tests. Wrangler/esbuild still bundles it for the real deploy.
let libPromise = null;
function pushLib() {
  if (!libPromise) libPromise = import('web-push-browser');
  return libPromise;
}

/** Max subscribers touched by a single broadcast (safety valve, not a quota). */
const MAX_FANOUT = 2000;

/** True when the VAPID keys are configured; otherwise pushing is skipped. */
export function pushConfigured(env) {
  return !!(
    env &&
    env.VAPID_PUBLIC_KEY &&
    env.VAPID_PUBLIC_KEY.toString().trim() &&
    env.VAPID_PRIVATE_KEY &&
    env.VAPID_PRIVATE_KEY.toString().trim()
  );
}

function vapidSubject(env) {
  const s = (env.VAPID_SUBJECT || '').toString().trim();
  // web-push-browser takes the bare address and builds the mailto: itself.
  return (s || 'chhath@shaharpura.com').replace(/^mailto:/i, '');
}

// Importing the keys is a few ms of crypto, so cache the CryptoKeyPair for the
// life of the isolate rather than re-importing it per subscriber.
let keyCache = null;
async function vapidKeys(env) {
  const pub = env.VAPID_PUBLIC_KEY.toString().trim();
  const priv = env.VAPID_PRIVATE_KEY.toString().trim();
  if (keyCache && keyCache.pub === pub) return keyCache.keys;
  const { deserializeVapidKeys } = await pushLib();
  const keys = await deserializeVapidKeys({ publicKey: pub, privateKey: priv });
  keyCache = { pub, keys };
  return keys;
}

/** The public key the browser needs to subscribe ('' when unconfigured). */
export function publicKey(env) {
  return pushConfigured(env) ? env.VAPID_PUBLIC_KEY.toString().trim() : '';
}

// ---- Subscription storage (rows are written by the PUBLIC worker) ----

/** Active subscriptions, newest first. Fail-soft when the table is absent. */
export async function activeSubscriptions(env, limit = MAX_FANOUT) {
  if (!env || !env.DB_CORE) return [];
  try {
    const { results } = await env.DB_CORE.prepare(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE active = 1 ORDER BY id DESC LIMIT ?'
    )
      .bind(limit)
      .all();
    return results || [];
  } catch (e) {
    const msg = (e && e.message ? e.message : String(e)).toLowerCase();
    if (msg.includes('no such table') || msg.includes('no such column')) return [];
    throw e;
  }
}

/** Counts for the mgmt UI. Fail-soft when the table is absent. */
export async function subscriptionStats(env) {
  const out = { total: 0, active: 0 };
  if (!env || !env.DB_CORE) return out;
  try {
    const row = await env.DB_CORE.prepare(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active FROM push_subscriptions'
    ).first();
    out.total = Number(row && row.total) || 0;
    out.active = Number(row && row.active) || 0;
  } catch (e) {
    const msg = (e && e.message ? e.message : String(e)).toLowerCase();
    if (!msg.includes('no such table') && !msg.includes('no such column')) throw e;
  }
  return out;
}

/** A push service reporting 404/410 means the endpoint is permanently gone. */
async function deactivate(env, id, reason) {
  try {
    await env.DB_CORE.prepare(
      "UPDATE push_subscriptions SET active = 0, last_error = ?, updated_at = ? WHERE id = ?"
    )
      .bind((reason || '').toString().slice(0, 300), new Date().toISOString(), id)
      .run();
  } catch {
    /* pruning is best-effort */
  }
}

async function recordError(env, id, reason) {
  try {
    await env.DB_CORE.prepare(
      'UPDATE push_subscriptions SET last_error = ?, updated_at = ? WHERE id = ?'
    )
      .bind((reason || '').toString().slice(0, 300), new Date().toISOString(), id)
      .run();
  } catch {
    /* best-effort */
  }
}

// ---- Sending ----

/**
 * Deliver one notification. Returns { ok, status }. Never throws: a bad endpoint
 * must not take down the caller (a contribution save, or the rest of a broadcast).
 */
export async function sendOne(env, keys, row, payload) {
  const subscription = {
    endpoint: (row.endpoint || '').toString(),
    keys: { p256dh: (row.p256dh || '').toString(), auth: (row.auth || '').toString() }
  };
  if (!subscription.endpoint || !subscription.keys.p256dh || !subscription.keys.auth) {
    await deactivate(env, row.id, 'incomplete subscription');
    return { ok: false, status: 0 };
  }
  try {
    const { sendPushNotification } = await pushLib();
    const res = await sendPushNotification(
      keys,
      subscription,
      vapidSubject(env),
      JSON.stringify(payload),
      { algorithm: 'aes128gcm', ttl: 24 * 60 * 60, urgency: 'normal' }
    );
    const status = res && typeof res.status === 'number' ? res.status : 0;
    // 404/410 => the browser dropped the subscription; stop retrying it.
    if (status === 404 || status === 410) {
      await deactivate(env, row.id, `push service returned ${status}`);
      return { ok: false, status };
    }
    if (status >= 400) {
      await recordError(env, row.id, `push service returned ${status}`);
      return { ok: false, status };
    }
    return { ok: true, status };
  } catch (e) {
    await recordError(env, row.id, e && e.message ? e.message : String(e));
    return { ok: false, status: 0 };
  }
}

/**
 * Broadcast to every active subscriber.
 *
 * CPU BUDGET: each subscriber's sign+encrypt+send is scheduled as its OWN
 * ctx.waitUntil() task instead of being awaited in a loop here, so a large
 * subscriber list never accumulates into one long-running invocation (Workers
 * free plan allows only ~10ms CPU per invocation). This function therefore
 * returns as soon as the work is scheduled.
 *
 * Returns { scheduled, skipped } — `skipped` is set when push is unconfigured.
 */
export async function broadcast(env, ctx, payload) {
  if (!pushConfigured(env)) return { scheduled: 0, skipped: true, reason: 'push not configured' };

  const rows = await activeSubscriptions(env);
  if (rows.length === 0) return { scheduled: 0, skipped: false };

  const keys = await vapidKeys(env);
  for (const row of rows) {
    // One independent task per subscriber (see the CPU note above).
    const task = sendOne(env, keys, row, payload).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
  }
  return { scheduled: rows.length, skipped: false };
}

/**
 * Compose the notification body for a new contribution.
 *
 * A COLLECTIONS row's `Name` field stores a `USER####` id CODE, not a display
 * name (see tableRegistry.js). So resolve it to the contributor's display name
 * via userByIdCode — the same fail-soft pattern email.js/whatsapp.js use — and
 * only fall back to the raw value (a blank string, a resell/material detail, or
 * an unresolved code) when the lookup returns nothing.
 *
 * Kept as its own exported helper so the body wording can be unit-tested without
 * configured VAPID keys (broadcast() no-ops when push is unconfigured).
 */
export async function composeNewContributionBody(env, payload) {
  const code = (payload && (payload.Name ?? '')).toString().trim();
  const contributor = code ? await userByIdCode(env, code) : null;
  const name = (contributor && (contributor.Name ?? '').toString().trim()) || code;
  const amountRaw = payload && payload.Amount;
  const amount = Number(amountRaw);

  // Money contributions read "₹501 by Name"; material/service rows have no
  // amount, so fall back to a neutral wording rather than printing "₹NaN".
  return Number.isFinite(amount) && amount > 0
    ? `Naya contribution mila: \u20B9${amount.toLocaleString('en-IN')}${name ? ' by ' + name : ''}`
    : `Naya contribution mila${name ? ': ' + name : ''}`;
}

/**
 * The notification shown when a new contribution is recorded. Called from the
 * saveRecord router handler for COLLECTIONS only (never from the CSV bulk
 * import, which would notify once per imported row).
 *
 * Log-and-swallow: a notification problem must NEVER fail the contribution save.
 */
export async function notifyNewContribution(env, ctx, payload) {
  try {
    if (!pushConfigured(env)) return { skipped: true };
    const year = (payload && (payload.Year ?? '')).toString().trim();
    const body = await composeNewContributionBody(env, payload);

    return await broadcast(env, ctx, {
      title: 'Naya contribution',
      body,
      url: '/',
      tag: 'new-contribution' + (year ? '-' + year : '')
    });
  } catch (e) {
    try {
      await logWarn(env, 'push', 'notifyNewContribution failed', e && e.message ? e.message : String(e));
    } catch {
      /* never throw from the notification path */
    }
    return { skipped: true, error: true };
  }
}

/**
 * Manual broadcast from the mgmt "Custom Notification" tab. Validates the input
 * (a user-facing 400, not a logged 500) and then fans out like broadcast().
 */
export async function sendCustom(env, ctx, title, body, url) {
  const t = (title ?? '').toString().trim();
  const b = (body ?? '').toString().trim();
  if (!t) throw ValidationError('Please enter a notification title.');
  if (!b) throw ValidationError('Please enter a notification message.');
  if (t.length > 120) throw ValidationError('Title is too long (max 120 characters).');
  if (b.length > 500) throw ValidationError('Message is too long (max 500 characters).');
  if (!pushConfigured(env)) {
    throw ValidationError(
      'Push notifications are not configured on the server (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY). ' +
        'Ask an administrator to set them up.'
    );
  }

  const target = (url ?? '').toString().trim() || '/';
  const res = await broadcast(env, ctx, { title: t, body: b, url: target, tag: 'custom' });
  try {
    await logWarn(env, 'push', 'custom broadcast', `scheduled=${res.scheduled} title=${t.slice(0, 60)}`);
  } catch {
    /* logging is best-effort */
  }
  return { success: true, sent: res.scheduled };
}

/** Subscriptions list for the mgmt UI (no payload keys are returned). */
export async function listSubscriptions(env, limit = 200) {
  if (!env || !env.DB_CORE) return { subscriptions: [], stats: { total: 0, active: 0 } };
  const stats = await subscriptionStats(env);
  let subscriptions = [];
  try {
    const { results } = await env.DB_CORE.prepare(
      'SELECT id, endpoint, user_agent, active, last_error, created_at, updated_at FROM push_subscriptions ORDER BY id DESC LIMIT ?'
    )
      .bind(Math.max(1, Math.min(1000, Number(limit) || 200)))
      .all();
    // The endpoint is an opaque handle, but it is still a device identifier —
    // only expose enough of it to tell rows apart in the UI.
    subscriptions = (results || []).map((r) => ({
      id: r.id,
      endpointTail: (r.endpoint || '').toString().slice(-12),
      userAgent: r.user_agent || '',
      active: Number(r.active) === 1,
      lastError: r.last_error || '',
      createdAt: r.created_at || '',
      updatedAt: r.updated_at || ''
    }));
  } catch (e) {
    const msg = (e && e.message ? e.message : String(e)).toLowerCase();
    if (!msg.includes('no such table') && !msg.includes('no such column')) {
      await logErrorAt(env, 'push', 'listSubscriptions', e);
    }
  }
  return { subscriptions, stats, configured: pushConfigured(env) };
}
