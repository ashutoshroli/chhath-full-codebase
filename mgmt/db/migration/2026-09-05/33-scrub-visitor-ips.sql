-- ============================================================================
-- audit carry-over C12 — remove the visitor IP addresses already stored
-- Database: chhath-logs
--
-- The public Worker used to write a visitor's raw IP address into error_log TWICE
-- for every JavaScript error their browser reported: once into the indexed
-- `client_ip` column and once more into the JSON `context` column as `edgeIp`.
-- A public visitor never asked for that, could not see it, and nothing in this
-- portal needs it — the only question the address answered was "did these two
-- requests come from the same visitor?", which a keyed pseudonym answers just as
-- well.
--
-- The Worker no longer stores an address (it stores a keyed, daily-rotating
-- pseudonym, or nothing at all). That stops NEW rows. It does nothing about the
-- rows already written, which is what this migration is for.
--
-- SAFE TO RUN: it only ever CLEARS a field. It deletes no row, changes no
-- relationship, and touches nothing outside these two fields. Nothing in the
-- codebase reads `client_ip` except the 60-second flood counter, and nothing reads
-- `context.edgeIp` at all any more.
--
-- IDEMPOTENT: both statements are written so a second run matches zero rows.
--
-- Apply with:
--   wrangler d1 execute chhath-logs --remote --file=./33-scrub-visitor-ips.sql
-- ============================================================================


-- ============================================================================
-- PART 1 — DETECTION (read-only; run this FIRST to see the scale)
-- ============================================================================
--
-- How many rows still carry a raw address, in either place:
--
--   SELECT
--     SUM(CASE WHEN client_ip <> '' AND (LENGTH(client_ip) <> 32
--                                        OR client_ip GLOB '*[^0-9a-f]*')
--              THEN 1 ELSE 0 END)                              AS raw_client_ip,
--     SUM(CASE WHEN context IS NOT NULL AND json_valid(context)
--                    AND json_extract(context, '$.edgeIp') IS NOT NULL
--              THEN 1 ELSE 0 END)                              AS context_edge_ip,
--     COUNT(*)                                                 AS total_rows,
--     MIN(created_at)                                          AS oldest
--   FROM error_log;
--
-- The oldest row tells you how far back this goes, which is worth recording before
-- you erase the evidence of it.


-- ============================================================================
-- PART 2 — THE SCRUB (this is what running the file does)
-- ============================================================================

-- 2a. Clear anything in `client_ip` that is not a pseudonym.
--
-- WHY THE CONDITION IS "NOT A PSEUDONYM" RATHER THAN "LOOKS LIKE AN IP". A
-- pseudonym written by the new code is exactly 32 lowercase hex characters. Testing
-- for that and clearing everything else catches IPv4 ("203.0.113.47"), IPv6
-- (colons), and the literal 'unknown' the older code substituted — including any
-- shape nobody thought of. Matching '%.%' OR '%:%' instead would have left those
-- last two behind, which is the kind of near-miss that makes a privacy scrub look
-- finished when it is not.
--
-- Clearing a recent pseudonym would be harmless anyway (it would relax one 60
-- second flood window), but there is no reason to, so we do not.
UPDATE error_log
   SET client_ip = ''
 WHERE client_ip IS NOT NULL
   AND client_ip <> ''
   AND (LENGTH(client_ip) <> 32 OR client_ip GLOB '*[^0-9a-f]*');

-- 2b. Remove the `edgeIp` key from the JSON context, keeping the rest of it.
--
-- `json_remove` returns the object without that one key, so the screen size, user
-- agent hints and whatever else a report carried are all preserved — this is a
-- privacy fix, not a data cull. `json_valid` guards the rows whose context was
-- never valid JSON (the old code fell back to a plain string on a parse failure);
-- json_extract on those would error out and abort the whole statement.
UPDATE error_log
   SET context = json_remove(context, '$.edgeIp')
 WHERE context IS NOT NULL
   AND json_valid(context)
   AND json_extract(context, '$.edgeIp') IS NOT NULL;


-- ============================================================================
-- PART 3 — verification (read-only; run this AFTER)
-- ============================================================================
--
-- Both counts from PART 1 must now be zero:
--
--   SELECT
--     SUM(CASE WHEN client_ip <> '' AND (LENGTH(client_ip) <> 32
--                                        OR client_ip GLOB '*[^0-9a-f]*')
--              THEN 1 ELSE 0 END)                              AS raw_client_ip,
--     SUM(CASE WHEN context IS NOT NULL AND json_valid(context)
--                    AND json_extract(context, '$.edgeIp') IS NOT NULL
--              THEN 1 ELSE 0 END)                              AS context_edge_ip
--   FROM error_log;
--
-- NOTE ON THE SALT, which is the part that is easy to miss: the pseudonyms that
-- remain are only anonymous because their salt is unreachable. The salt lives in
-- the public Worker's KV under `pub:ipsalt:<UTC date>` with a two-day TTL, so it
-- expires on its own and yesterday's pseudonyms become permanently unlinkable to
-- any address. Do not copy those keys anywhere durable, and do not raise the TTL
-- without deciding you want the linkability that buys.
-- ============================================================================
