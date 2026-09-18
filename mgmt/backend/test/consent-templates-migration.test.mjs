// ===== FEAT-003 — consent PREVIEW page template seed migration =====
//
// The public consent preview page (mgmt/frontend-svelte .../consent/[token])
// renders the stored consent_page_templates row for the loaner ('loaner_consent')
// or a guarantor ('guarantor_consent'), substituting [A-Z0-9_]+ bracket tokens and
// then running marked + DOMPurify. After the committee reset the templates DB, the
// migration 2026-09-18/01-loan-consent-preview-templates.sql re-seeds BOTH rows
// with the committee's exact bilingual (Hindi + English) text.
//
// This suite runs that migration in-memory against the REAL committed
// templates.sql schema and asserts:
//   1. exactly one row per type (loaner_consent, guarantor_consent);
//   2. it is idempotent — a second application still leaves one row per type with
//      identical text (DELETE-by-type then INSERT, since there is no UNIQUE index
//      on `type`);
//   3. each seeded body carries its required headers, sample tokens, the ☐
//      declaration checkbox and the [ ACCEPT ... ] / [ DECLINE ... ] display
//      markers verbatim;
//   4. every [A-Z0-9_]+ token in the seeded text is one that
//      buildConsentPlaceholders() actually emits — so no token silently drifts
//      into a literal-bracket string on the live page.
//
// Run: node --test mgmt/backend/test/consent-templates-migration.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { buildConsentPlaceholders } from '../src/consentPlaceholders.js';

const MIGRATION = new URL(
  '../../db/migration/2026-09-18/01-loan-consent-preview-templates.sql',
  import.meta.url,
);
const migrationSql = () => readFileSync(MIGRATION, 'utf8');

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaFor('templates.sql'));
  return db;
}

const textFor = (db, type) =>
  db.prepare('SELECT text FROM consent_page_templates WHERE type = ?').get(type)?.text;

const countFor = (db, type) =>
  db.prepare('SELECT COUNT(*) AS c FROM consent_page_templates WHERE type = ?').get(type).c;

describe('the migration file itself', () => {
  test('names chhath-templates in an executable apply line', () => {
    assert.match(
      migrationSql(),
      /wrangler d1 execute chhath-templates --remote --file=\.\/migration\/2026-09-18\/01-loan-consent-preview-templates\.sql/,
    );
  });

  test('contains no explicit transaction statements (D1 rejects them in --file)', () => {
    // Only leading statement keywords count — the header comment mentions the words.
    const bad = migrationSql()
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('--'))
      .filter((l) => /^\s*(BEGIN|COMMIT|SAVEPOINT|ROLLBACK|END\s+TRANSACTION)\b/i.test(l));
    assert.deepEqual(bad, []);
  });
});

describe('applying the migration seeds both consent types', () => {
  test('exactly one row per type after a single apply', () => {
    const db = freshDb();
    try {
      db.exec(migrationSql());
      assert.equal(countFor(db, 'loaner_consent'), 1);
      assert.equal(countFor(db, 'guarantor_consent'), 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS c FROM consent_page_templates').get().c, 2);
    } finally { db.close(); }
  });

  test('idempotent: a second apply still leaves one row per type with identical text', () => {
    const db = freshDb();
    try {
      db.exec(migrationSql());
      const l1 = textFor(db, 'loaner_consent');
      const g1 = textFor(db, 'guarantor_consent');
      db.exec(migrationSql()); // re-run
      assert.equal(countFor(db, 'loaner_consent'), 1);
      assert.equal(countFor(db, 'guarantor_consent'), 1);
      assert.equal(textFor(db, 'loaner_consent'), l1);
      assert.equal(textFor(db, 'guarantor_consent'), g1);
    } finally { db.close(); }
  });

  test('self-healing: collapses pre-existing stale/duplicate rows into one per type', () => {
    const db = freshDb();
    try {
      // Simulate a messy DB: a stale duplicate and wrong text.
      db.prepare("INSERT INTO consent_page_templates (type, text, updated_at) VALUES ('loaner_consent','OLD','x')").run();
      db.prepare("INSERT INTO consent_page_templates (type, text, updated_at) VALUES ('loaner_consent','OLD2','x')").run();
      db.exec(migrationSql());
      assert.equal(countFor(db, 'loaner_consent'), 1);
      assert.ok(!textFor(db, 'loaner_consent').includes('OLD'));
    } finally { db.close(); }
  });
});

describe('the seeded loaner_consent body', () => {
  let text;
  const db = freshDb();
  db.exec(migrationSql());
  text = textFor(db, 'loaner_consent');
  db.close();

  test('carries the expected headers', () => {
    assert.ok(text.includes('LOAN RECEIPT & FINAL CONSENT'), 'main heading');
    assert.ok(text.includes('Final Consent Record'), 'record section');
  });

  test('carries a sample of the required tokens and display markers', () => {
    for (const tok of ['[LOANER_NAME]', '[LOAN_CONSENT_DATETIME]', '[LOAN_STATUS]', '[LOAN_CONSENT_ID]']) {
      assert.ok(text.includes(tok), `missing token ${tok}`);
    }
    assert.ok(text.includes('☐'), 'declaration checkbox');
    assert.ok(text.includes('[ ACCEPT & CONFIRM LOAN ]'), 'accept display marker');
  });
});

describe('the seeded guarantor_consent body', () => {
  let text;
  const db = freshDb();
  db.exec(migrationSql());
  text = textFor(db, 'guarantor_consent');
  db.close();

  test('carries the expected headers', () => {
    assert.ok(text.includes('LOAN GUARANTOR CONSENT & TERMS AND CONDITIONS'), 'main heading');
    assert.ok(text.includes('Consent Record'), 'record section');
  });

  test('carries a sample of the required tokens and display markers', () => {
    for (const tok of ['[GUARANTOR_NAME]', '[CONSENT_DATETIME]', '[CONSENT_STATUS]', '[CONSENT_ID]']) {
      assert.ok(text.includes(tok), `missing token ${tok}`);
    }
    assert.ok(text.includes('☐'), 'declaration checkbox');
    assert.ok(text.includes('[ ACCEPT CONSENT ]'), 'accept display marker');
    assert.ok(text.includes('[ DECLINE CONSENT ]'), 'decline display marker');
  });
});

describe('every bracket token in the seeded text is a placeholder the code emits', () => {
  // Guards against literal-bracket drift: a [TOKEN] with no matching key would
  // render as raw brackets on the live consent page (substitutePlaceholders
  // returns the match unchanged for unknown keys).

  // A minimal env: buildConsentPlaceholders only reads env.DB_CORE (festival dates).
  const env = { DB_CORE: makeD1(schemaFor('core.sql')) };
  const nameOf = (id) => `Name ${id}`;
  const loan = {
    Name: 'USER0001', Amount: 10000, 'Intrest Rate': 2, Tenure: 6,
    'Final Repayment Date': '2026-11-01', Year: 2026,
  };
  const consents = [
    { role: 'loaner', person_id: 'USER0001', consent_id: 'LC1', status: 'pending', created_at: '2026-09-01', responded_at: '' },
    { role: 'guarantor', person_id: 'USER0002', consent_id: 'C1', status: 'accepted', created_at: '2026-09-02', responded_at: '2026-09-03' },
  ];

  async function knownKeys() {
    // Union of the keys emitted for a loaner-target doc and a guarantor-target doc.
    const loanerMap = await buildConsentPlaceholders(env, loan, consents, consents[0], nameOf);
    const guarantorMap = await buildConsentPlaceholders(env, loan, consents, consents[1], nameOf);
    return new Set([...Object.keys(loanerMap), ...Object.keys(guarantorMap)]);
  }

  const tokensIn = (text) => {
    const set = new Set();
    for (const m of text.matchAll(/\[([A-Z0-9_]+)\]/g)) set.add(m[1]);
    return set;
  };

  const seeded = (type) => {
    const db = freshDb();
    db.exec(migrationSql());
    const t = textFor(db, type);
    db.close();
    return t;
  };

  test('loaner_consent tokens are all known', async () => {
    const known = await knownKeys();
    const unknown = [...tokensIn(seeded('loaner_consent'))].filter((t) => !known.has(t));
    assert.deepEqual(unknown, [], 'these tokens are not emitted by buildConsentPlaceholders');
  });

  test('guarantor_consent tokens are all known', async () => {
    const known = await knownKeys();
    const unknown = [...tokensIn(seeded('guarantor_consent'))].filter((t) => !known.has(t));
    assert.deepEqual(unknown, [], 'these tokens are not emitted by buildConsentPlaceholders');
  });
});
