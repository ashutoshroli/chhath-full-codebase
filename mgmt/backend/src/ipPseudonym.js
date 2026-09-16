// ============ VISITOR PSEUDONYMS FOR RATE-LIMIT KEYS (carry-over C12, mgmt half) ============
//
// Five places in this Worker put a visitor's IP address straight into a KV key:
//
//   index.js         rl:<action>:<ip>:<bucket>            every rate-limited public action
//   errorLog.js      rl:logError:<ip>:<bucket>            reportErrorPublic — a PUBLIC endpoint
//   auth.js          loginip:<ip>:<bucket>                the login-attempt limiter
//   twoFactor.js     twofa:rl:<ip>:<bucket>               the 2FA attempt limiter
//   announcements.js announcepinfail:<token>:<ip>         the announce-PIN lockout
//
// The last one is not a rate limiter and does not fail open — see the note at
// pinFailKey for why its no-pseudonym fallback is the token-only key rather than
// skipping the gate.
//
// #356 fixed the public Worker's persisted copies of the address and left the KV keys
// alone, on the grounds that they expire in about a minute. #362 established that was the
// wrong call — a snapshot of KV at any moment still lists the address of everyone who has
// just used the portal, and "it will be gone shortly" is not a reason to have written it
// down — and fixed it there. This is the same fix on this side.
//
// It also corrects something I understated in #362, which named only `isLogErrorRateLimited`.
// There are five call sites, and `index.js` is the broad one: it covers every rate-limited
// public action, not just error reporting.
//
// WHAT THIS DELIBERATELY LEAVES ALONE. `login_attempts.ip` and `user_sessions.ip` keep the
// address, and so does the consent record in loans.js. Those are not visitors: they are
// named staff accounts, where "which address logged in" is the audit trail that makes a
// compromised account detectable — and the consent address is evidence attached to a
// legally binding document. Removing them would destroy a record the committee needs,
// which is a different question from writing down the address of a passer-by.
//
// WHY THIS COSTS NOTHING. Every one of those limiters already gives up when there is no
// KV binding, and the pseudonym needs the same KV — identical preconditions. The salt is
// cached per namespace, so after an isolate's first request this adds no read to the hot
// path. And there is no fallback to the address: no pseudonym means no counting, because
// a limiter that quietly reverts to storing addresses is worse than one that stops.
//
// WHY THE KEY LIVES IN KV RATHER THAN A SECRET. Same reasoning as the public Worker: it
// needs no operator step, so the fix cannot sit un-deployed waiting for one; and it
// ROTATES DAILY and then EXPIRES, so once a day's salt is gone that day's keys cannot be
// tied back to an address by anybody. A long-lived secret would make every key ever
// written linkable for ever.
//
// NOT a byte-identical copy of the public Worker's version behind 8< markers, unlike the
// contracts shared in #339/#341/#342. Those had to agree exactly because both sides parse
// the same payload. This does not: the two Workers never compare pseudonyms with each
// other, so what matters is that each is correct, not that they are identical. Stated
// here so the difference is a decision rather than an oversight.
// ============================================================================

const SALT_TTL_SECONDS = 60 * 60 * 48; // two days — one full period plus slack

const saltKeyFor = (now = new Date()) => `mgmt:ipsalt:${now.toISOString().slice(0, 10)}`; // UTC day

const toHex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// Keyed on the KV namespace OBJECT, not module-global: a plain variable would leak the
// salt between unrelated callers, which is the bug the public Worker's first version had.
const saltCache = new WeakMap(); // kv -> { period, salt }

async function dailySalt(kv) {
  const key = saltKeyFor();
  const hit = saltCache.get(kv);
  if (hit && hit.period === key && hit.salt) return hit.salt;
  let salt = await kv.get(key);
  if (!salt) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    salt = toHex(bytes);
    // Two isolates can race on the first request of a day and write different salts. The
    // loser's counters simply stop matching, which costs at most one limiter window —
    // worth strictly less than a lock.
    await kv.put(key, salt, { expirationTtl: SALT_TTL_SECONDS });
  }
  saltCache.set(kv, { period: key, salt });
  return salt;
}

/**
 * A keyed, daily-rotating pseudonym for `ip`, or '' when one cannot be produced.
 *
 * Never returns the address, and never an unkeyed hash of it: an unsalted hash of an IPv4
 * is 2^32 candidates, so it would be the address with extra steps.
 */
export async function ipKey(env, ip) {
  const raw = (ip == null ? '' : ip.toString()).trim();
  if (!raw) return '';
  const kv = env && env.KV_SESSIONS;
  if (!kv) return '';
  try {
    const salt = await dailySalt(kv);
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
    // 128 bits: far past collision concerns for a per-day counter, and short enough that
    // the stored value is obviously not an address.
    return toHex(sig).slice(0, 32);
  } catch (e) {
    return ''; // fail CLOSED on privacy — store nothing rather than something weak
  }
}
