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
import { createHash } from 'node:crypto';

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
        ssl: { rejectUnauthorized: false }, // Neon requires TLS; managed cert
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

// Hash an IP for rate-limit/audit correlation without storing the raw address.
export function hashIp(ip) {
  if (!ip) return '';
  return createHash('sha256').update(String(ip)).digest('hex').slice(0, 32);
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
