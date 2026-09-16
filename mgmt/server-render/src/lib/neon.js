// Neon (Postgres) client for the public chatbot's conversation logs.
//
// DESIGN: logging must NEVER break a chat. Everything here is best-effort:
//   - if DATABASE_URL is unset, or `pg` isn't installed, or a query fails, we log
//     a warning and return — the chatbot still answers.
//   - `pg` is imported LAZILY (dynamic import) so the service boots (and its unit
//     tests run) even when the dependency isn't present.
//
// Schema: mgmt/db/neon/schema.sql (chat_sessions, chat_messages).

import { config } from '../config.js';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

let _poolPromise = null;   // cached Promise<Pool> | null
let _disabled = false;     // set once if pg/DATABASE_URL is unavailable

async function getPool() {
  if (_disabled) return null;
  if (!config.databaseUrl) { _disabled = true; return null; }
  if (_poolPromise) return _poolPromise;
  _poolPromise = (async () => {
    try {
      const pg = await import('pg');
      const Pool = pg.default ? pg.default.Pool : pg.Pool;
      const pool = new Pool({
        connectionString: config.databaseUrl,
        // audit Render/offload #9. This was `rejectUnauthorized: false`, under the comment
        // "Neon requires TLS; managed cert" — which is a true statement that does not justify
        // it. REQUIRING TLS and VERIFYING it are different things: with verification off the
        // connection is encrypted but UNAUTHENTICATED, so anything that can get in the path
        // presents its own certificate and reads — and rewrites — everything crossing it.
        //
        // What crosses it is every public chat question and answer, and the visitor IP
        // pseudonyms. Neon serves a publicly-trusted certificate, so verification simply
        // works; there was nothing to work around.
        //
        // The escape hatch is deliberately opt-in and named for what it is, so nobody can turn
        // it off by accident or leave it off without having typed the reason.
        ssl: config.neonAllowUnverifiedTls
          ? { rejectUnauthorized: false }
          : { rejectUnauthorized: true },
        max: 3,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 8000,
      });
      pool.on('error', (e) => console.warn('[neon] idle client error:', e && e.message));
      return pool;
    } catch (e) {
      console.warn('[neon] disabled (pg unavailable / bad DATABASE_URL):', e && e.message);
      _disabled = true;
      return null;
    }
  })();
  return _poolPromise;
}

// ---- An IP pseudonym that is actually a pseudonym (audit Render/offload #9) ----
//
// This was `sha256(ip)` with no secret. An unsalted hash of an IPv4 address is **2^32
// candidates** — a few minutes of a laptop's time to build the entire lookup table. So the
// stored value was not a pseudonym at all; it was the visitor's IP address with extra steps,
// and it sat in Neon indefinitely.
//
// Two changes make it real:
//
//   * an HMAC keyed on a SECRET. Without the key, the 2^32 sweep is useless.
//   * a rotating period in the message, so the same visitor does not carry one stable
//     identifier across months. Linkability is what turns "which requests came together" into
//     "here is a person's history".
//
// And when no secret is configured, this returns '' — **no pseudonym at all** — rather than
// falling back to the reversible hash. An unset secret must not silently mean "store something
// that looks protected and is not". Chat logging is best-effort and never blocks an answer, so
// the cost of that choice is a missing column, not a broken chatbot.
export function ipPeriod(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 7); // YYYY-MM — monthly rotation
}

export function hashIp(ip, now = Date.now()) {
  if (!ip) return '';
  const secret = config.chatIpHashSecret;
  if (!secret) return '';
  return createHmac('sha256', secret).update(`${ip}|${ipPeriod(now)}`).digest('hex').slice(0, 32);
}

// ---- The session id is issued by the server, not accepted from the caller ----
//
// audit Render/offload #9. `sessionId` came straight out of the request body:
//
//     const sessionId = ((req.body && req.body.sessionId) || '').toString().slice(0, 80);
//
// and was written to Neon as the key that groups a conversation. So any caller could send
// somebody else's session id and have their questions and answers appended to that
// conversation — or send one long arbitrary string per request and shard the table.
//
// The id is now `<uuid>.<hmac>`: issued here, signed with a secret this service already has,
// and verified on the way back in. A client may keep using the id it was given — that is the
// point of a session — but it cannot invent one, because it cannot produce the signature.
export function newChatSessionId(now = Date.now()) {
  const id = randomUUID();
  return `${id}.${signSessionId(id)}`;
}

function signSessionId(id) {
  const secret = config.chatSessionSecret;
  if (!secret) return '';
  return createHmac('sha256', secret).update(id).digest('hex').slice(0, 16);
}

/**
 * Returns the caller's session id if we issued it, otherwise a fresh one.
 *
 * `issued` tells the route whether to hand a new id back to the client. With no secret
 * configured nothing can be verified, so every request gets a fresh server-side id — which
 * loses conversation grouping but never lets one caller write into another's history.
 */
export function resolveChatSessionId(fromClient, now = Date.now()) {
  const raw = (fromClient === undefined || fromClient === null ? '' : fromClient.toString()).trim();
  const m = /^([0-9a-f-]{36})\.([0-9a-f]{16})$/i.exec(raw);
  if (m && config.chatSessionSecret) {
    const expected = signSessionId(m[1]);
    // timingSafeEqual needs equal lengths; the format check above guarantees them.
    if (expected && expected.length === m[2].length
        && timingSafeEqual(Buffer.from(expected), Buffer.from(m[2].toLowerCase()))) {
      return { sessionId: raw, issued: false };
    }
  }
  return { sessionId: newChatSessionId(now), issued: true };
}

// Best-effort: ensure a session row exists (idempotent on session_id).
export async function ensureChatSession(sessionId, { lang, ipHash, userAgent } = {}) {
  if (!sessionId) return;
  const pool = await getPool();
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO chat_sessions (session_id, lang, ip_hash, user_agent, last_seen_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (session_id) DO UPDATE SET last_seen_at = now()`,
      [sessionId, lang || null, ipHash || null, (userAgent || '').slice(0, 300)]
    );
  } catch (e) {
    console.warn('[neon] ensureChatSession failed (non-fatal):', e && e.message);
  }
}

// Best-effort: append one message row.
export async function logChatMessage({ sessionId, role, content, model, promptTokens, completionTokens, dataVersion }) {
  if (!sessionId || !role || !content) return;
  const pool = await getPool();
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO chat_messages
         (session_id, role, content, model, prompt_tokens, completion_tokens, data_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sessionId, role, String(content).slice(0, 8000), model || null,
       promptTokens || null, completionTokens || null, dataVersion || null]
    );
  } catch (e) {
    console.warn('[neon] logChatMessage failed (non-fatal):', e && e.message);
  }
}
