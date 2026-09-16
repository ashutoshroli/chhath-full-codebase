-- ============================================================================
-- PR-35 — the migration ledger
-- Database: EVERY database (this file is applied once per D1 database)
--
-- WHY THIS EXISTS. Asked "which migrations have you applied?", nobody could answer —
-- not the operator, not the code, not CI. The only way to find out was to probe for
-- artefacts (does this index exist? does that column?) and infer. That is how a
-- privacy remediation came to be reported as applied when its command had failed, and
-- how five migrations sat for months telling people to run them against a database
-- name that did not exist.
--
-- A migration system needs to record what it did. This is that record.
--
-- ONE LEDGER PER DATABASE, not one shared ledger. D1 has no cross-database query, so a
-- central ledger could never be read alongside the schema it describes, and would
-- drift the moment one database was restored from a backup and another was not. Each
-- database therefore carries its own history, and `filename` is unique within it.
--
-- WHAT THE CHECKSUM IS FOR. Not tamper-proofing — it answers a specific question that
-- comes up when a migration misbehaves: "is the file on disk still the file that was
-- applied?" An edited migration is the one thing a ledger keyed only on a name cannot
-- see, and editing an applied migration is a normal mistake (fixing a typo in a
-- comment, or worse, in a statement).
--
-- `applied_at` is ISO-8601 UTC, matching every other timestamp in this schema.
-- `applied_by` is free text — a person, a CI run id, or 'adopt' when a migration was
-- recorded as already-applied rather than actually run by the tool (see migrate.mjs).
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, and nothing else.
--
-- Apply with (once per database — the tool does this for you):
--   wrangler d1 execute chhath-core --remote --file=./37-schema-migrations-ledger.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  folder      TEXT NOT NULL,   -- e.g. '2026-09-05'
  filename    TEXT NOT NULL,   -- e.g. '34-core-unique-id-code.sql'
  checksum    TEXT NOT NULL,   -- sha256 of the file as applied
  applied_at  TEXT NOT NULL,   -- ISO-8601 UTC
  applied_by  TEXT             -- operator, CI run, or 'adopt'
);

-- The constraint that makes the ledger a ledger: a migration is applied once.
-- Filenames are unique across folders in this tree (they are numbered), so the
-- filename alone is the identity — keeping it that way means moving a file between
-- folders does not make it look unapplied.
CREATE UNIQUE INDEX IF NOT EXISTS uq_schema_migrations_filename
  ON schema_migrations (filename);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at
  ON schema_migrations (applied_at);
