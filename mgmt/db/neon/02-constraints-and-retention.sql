-- ============================================================================
-- PR-32 — Neon constraints and the retention window (chat logs)
--
-- schema.sql creates the two chat tables and is documented as safe to re-run because
-- everything in it is CREATE ... IF NOT EXISTS. This file is separate because adding a
-- constraint is not that: a constraint can FAIL on data that already exists, and that
-- has to be a deliberate step with a look at the data first.
--
-- Two gaps schema.sql left, both written down in its own comments:
--
--   chat_messages.session_id   "FK-ish to chat_sessions.session_id (not enforced:
--                               logs, keep writes cheap)"
--   role                        'user' | 'assistant' — as a comment, not a constraint
--
-- and the retention policy, which was two commented-out DELETE statements under
-- "run manually or via a scheduled job if you want to". Nobody was going to run those
-- by hand for ever, so the privacy claim they represent was aspirational. The sweep is
-- now code (src/lib/chatRetention.js); this file gives it the index it needs and the
-- constraints that make a cascade correct.
--
-- HOW TO APPLY: Neon SQL Editor, or psql. Run PART 1 first and read it.
-- ============================================================================


-- ============================================================================
-- PART 1 — LOOK FIRST (read-only)
-- ============================================================================
--
-- How much is here, how far back does it go, and would the constraints below reject
-- anything that is already stored:
--
--   SELECT
--     (SELECT count(*) FROM chat_sessions)                                   AS sessions,
--     (SELECT count(*) FROM chat_messages)                                   AS messages,
--     (SELECT min(created_at) FROM chat_messages)                            AS oldest,
--     (SELECT count(*) FROM chat_messages m
--        WHERE NOT EXISTS (SELECT 1 FROM chat_sessions s
--                           WHERE s.session_id = m.session_id))              AS orphan_messages,
--     (SELECT count(*) FROM chat_messages
--        WHERE role NOT IN ('user','assistant'))                             AS bad_roles;
--
-- `orphan_messages` above zero is expected rather than alarming: nothing has ever
-- enforced the relationship, and a session row is written best-effort, so a message
-- whose session insert failed is exactly the case the comment predicted. PART 2 is
-- written so those rows do NOT have to be cleaned up first — see NOT VALID below.


-- ============================================================================
-- PART 2 — the constraints
-- ============================================================================

-- WHY `NOT VALID`, WHICH IS THE WHOLE TRICK HERE.
--
-- Postgres, unlike SQLite, can add a constraint to a populated table. But a plain ADD
-- CONSTRAINT scans every existing row and FAILS if any one of them violates it — on a
-- log table that has been collecting unconstrained rows, that is a coin flip.
--
-- `NOT VALID` adds the constraint so it governs every NEW write immediately, while
-- explicitly not checking what is already stored. No table scan, no lock held for a
-- scan, and no failure on legacy rows. It is the direct analogue of the PARTIAL unique
-- indexes used on the D1 side (migrations 34/35/36), and for the same reason: enforce
-- going forward without demanding a backfill first.
--
-- Once PART 1 reports orphan_messages = 0 and bad_roles = 0, the constraints can be
-- promoted with a scan you have chosen to run:
--
--   ALTER TABLE chat_messages VALIDATE CONSTRAINT chat_messages_session_fk;
--   ALTER TABLE chat_messages VALIDATE CONSTRAINT chat_messages_role_check;
--
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so each is wrapped to make re-running
-- this file a no-op rather than an error.

-- role is only ever 'user' or 'assistant' (chatProvider.js writes exactly these two).
DO $$
BEGIN
  ALTER TABLE chat_messages
    ADD CONSTRAINT chat_messages_role_check
    CHECK (role IN ('user', 'assistant')) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- The relationship, with ON DELETE CASCADE.
--
-- CASCADE is what makes retention correct rather than merely tidy. Without it,
-- deleting an expired session leaves its messages behind — the exact rows retention
-- exists to remove, now unreachable because the thing that named them is gone. With
-- it, one DELETE on chat_sessions takes the whole conversation.
--
-- It references chat_sessions.session_id, which schema.sql already declares UNIQUE, so
-- no new index is needed on the parent side.
DO $$
BEGIN
  ALTER TABLE chat_messages
    ADD CONSTRAINT chat_messages_session_fk
    FOREIGN KEY (session_id) REFERENCES chat_sessions (session_id)
    ON DELETE CASCADE NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- PART 3 — the index the retention sweep needs
-- ============================================================================
--
-- The sweep deletes sessions by `last_seen_at`. schema.sql indexes `created_at` on
-- both tables, which answers "recent activity" but not "everything last seen before
-- X" — so without this the sweep is a full scan of chat_sessions every time it runs,
-- which is the shape of thing that stops being run.
CREATE INDEX IF NOT EXISTS idx_chat_sessions_last_seen ON chat_sessions (last_seen_at);


-- ============================================================================
-- PART 4 — retention is now code, not a comment
-- ============================================================================
--
-- schema.sql ended with two DELETE statements commented out under "run manually or via
-- a scheduled job if you want to keep the free tier small". That framed a privacy
-- commitment as an optional housekeeping chore, and nothing ran it.
--
-- src/lib/chatRetention.js now performs the sweep, bounded and logged, driven by
-- CHAT_RETENTION_DAYS (default 90; set to 0 to disable and keep everything). It is
-- reachable two ways, on purpose:
--
--   * opportunistically, at most once per UTC day per instance, fired without being
--     awaited so it never delays an answer. Best-effort — a Render free instance that
--     sleeps may skip a day.
--   * POST /retention with the X-Render-Signature header, for a scheduled caller or a
--     human who wants it to have definitely happened.
--
-- Deleting the SESSION cascades to its messages (PART 2), so the two statements the
-- old comment listed are one operation now, and cannot half-happen.
-- ============================================================================
