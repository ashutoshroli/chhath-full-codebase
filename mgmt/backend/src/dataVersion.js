// ============ PUBLIC DATA VERSION ============
//
// The Public transparency portal should serve its (large) dataset from the
// browser/CDN cache and only re-download when the underlying data has actually
// changed in the mgmt portal — not on a fixed timer.
//
// To make that possible without a fixed max-age, we keep a single monotonically
// increasing "data version" counter that the mgmt Worker bumps after every
// successful WRITE, and that the Public Worker turns into an ETag. As long as
// the version is unchanged, the Public Worker answers conditional requests with
// `304 Not Modified` (no DB reads, no payload) and the browser reuses its copy.
//
// WHERE IT LIVES: `portal_settings` (key/value) in DB_CORE. Both Workers already
// bind DB_CORE (the Public Worker has no KV binding), so this is the one storage
// they can both reach. Key: `public_data_version`.

export const DATA_VERSION_KEY = 'public_data_version';

// Reads the current version as a string (used to build the ETag). Returns '0'
// when the row doesn't exist yet or the read fails — a stable, safe default.
export async function getDataVersion(env) {
  try {
    if (!env || !env.DB_CORE) return '0';
    const row = await env.DB_CORE.prepare('SELECT value FROM portal_settings WHERE "key" = ?')
      .bind(DATA_VERSION_KEY).first();
    const v = row && row.value != null ? row.value.toString() : '0';
    return v || '0';
  } catch (e) {
    return '0';
  }
}

// Atomically bumps the version. Uses a single UPSERT so concurrent writers can't
// lose an increment, and never throws — a data mutation must never fail just
// because the cache-version bookkeeping hit a snag (worst case the Public portal
// serves a slightly stale copy until the next bump).
//
// NOTE: relies on a UNIQUE index on portal_settings("key"). If that index is not
// present (older DB), the UPSERT's ON CONFLICT can't fire; see the fallback
// below which does read-modify-write instead.
export async function bumpDataVersion(env) {
  try {
    if (!env || !env.DB_CORE) return;

    // Preferred path: atomic UPSERT keyed on the unique `key` column.
    try {
      await env.DB_CORE.prepare(
        `INSERT INTO portal_settings ("key", value) VALUES (?, '1')
           ON CONFLICT("key") DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`
      ).bind(DATA_VERSION_KEY).run();
      return;
    } catch (e) {
      // ON CONFLICT needs a UNIQUE index on "key"; if it's missing the statement
      // throws. Fall back to a best-effort read-modify-write.
    }

    const row = await env.DB_CORE.prepare('SELECT id, value FROM portal_settings WHERE "key" = ?')
      .bind(DATA_VERSION_KEY).first();
    if (row && row.id != null) {
      const next = (parseInt(row.value, 10) || 0) + 1;
      await env.DB_CORE.prepare('UPDATE portal_settings SET value = ? WHERE id = ?')
        .bind(String(next), row.id).run();
    } else {
      await env.DB_CORE.prepare('INSERT INTO portal_settings ("key", value) VALUES (?, ?)')
        .bind(DATA_VERSION_KEY, '1').run();
    }
  } catch (e) {
    // Swallow — see doc comment. The mutation itself has already happened.
    console.error('[bumpDataVersion] non-fatal:', e && e.message);
  }
}
