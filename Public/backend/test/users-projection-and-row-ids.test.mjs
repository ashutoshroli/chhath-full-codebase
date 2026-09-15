// ============ PUBLIC WORKER — THE users PROJECTION AND INTERNAL ROW IDS ============
//
// audit PUB-BE-05. Every section of the portal payload was converted to a column
// ALLOWLIST in H-5 except the one built from the most sensitive table: `users` was
// still `SELECT *` minus a hand-written list of drops. A denylist on that table is the
// wrong default twice over —
//
//   * it already published `created_by`, the internal login name of the staff member
//     who entered the row, which no frontend reads, and
//   * it fails OPEN: any column added to `users` later ships to the whole internet the
//     moment it exists, with no code change and nothing to review.
//
// Related observation in the same finding: `id` -> `__rowIndex` was emitted for every
// section, publishing the internal autoincrement id of all eight tables. Exactly one
// resource needs it (a collections row's `<docType>-<year>-<id>` QR record id).

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';

const BASE = 'https://api.example/';
const VERSION = '9';

let queries = [];

/** A D1 stub that records every statement and answers per table. */
function d1(tables) {
  return {
    prepare(sql) {
      const flat = sql.replace(/\s+/g, ' ').trim();
      let args = [];
      const rowsFor = () => {
        for (const [needle, rows] of Object.entries(tables)) {
          if (flat.includes(needle)) {
            // Emulate a real projection: an explicit column list returns only those
            // columns, so a test can tell `SELECT *` apart from a narrow read.
            const m = /^SELECT (.+?) FROM/i.exec(flat);
            const cols = m && m[1].trim() !== '*'
              ? m[1].split(',').map((c) => c.trim())
              : null;
            if (!cols) return rows;
            for (const r of rows) {
              for (const c of cols) {
                if (!(c in r)) throw new Error(`no such column: ${c}`);
              }
            }
            return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
          }
        }
        return [];
      };
      const stmt = {
        bind: (...a) => { args = a; return stmt; },
        all: async () => { queries.push({ sql: flat, args }); return { results: rowsFor() }; },
        first: async () => { queries.push({ sql: flat, args }); return rowsFor()[0] || null; },
        run: async () => { queries.push({ sql: flat, args }); return { success: true }; },
      };
      return stmt;
    },
  };
}

function kv() {
  const map = new Map();
  return { async get(k) { return map.has(k) ? map.get(k) : null; }, async put(k, v) { map.set(k, v); } };
}

function installCache() {
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(req) {
        const e = store.get(typeof req === 'string' ? req : req.url);
        return e ? new Response(e.body, { headers: e.headers }) : undefined;
      },
      async put(req, res) { store.set(req.url, { body: await res.text(), headers: Object.fromEntries(res.headers) }); },
    },
  };
}

// A users row exactly as the table really is: the public columns, the three that are
// deliberately withheld, and `secret_future_column` standing in for whatever the table
// grows next (an Aadhaar reference, a date of birth, an address...).
const USER_ROW = {
  id: 41,
  id_code: 'USER0007',
  name: 'Amit Kumar',
  name_hindi: 'अमित कुमार',
  village: 'Baragaon',
  village_hindi: 'बड़गाँव',
  designation: 'Member',
  designation_hindi: 'सदस्य',
  fathers_name: 'Ram Kumar',
  fathers_name_hindi: 'राम कुमार',
  photo: 'https://files.example/u7.jpg',
  mobile: '9876543210',
  created_by: 'superadmin',
  email: 'amit@example.com',
  whatsapp: '9876543210',
  secret_future_column: 'AADHAAR-1234-5678',
};

const COMMITTEE_ROW = { id: 3, year: 2026, name: 'USER0007', view_role: 'Treasurer', view_role_hindi: 'कोषाध्यक्ष', created_by: 'superadmin', whatsapp: '9', };

function makeEnv({ users = [USER_ROW], committee = [COMMITTEE_ROW] } = {}) {
  return {
    DB_CORE: d1({
      'FROM portal_settings': [{ key: 'public_data_version', value: VERSION }],
      'FROM users': users,
      'FROM committee_members': committee,
    }),
    DB_COLLECTIONS: d1({
      'FROM collections': [{
        id: 42, year: 2026, sl_no: 1, name: 'USER0007', amount: 501, detail: 'Cash',
        contribution_type: '1', certificate_or_receipt: 'receipt', is_resell: '0',
        created_by: 'superadmin', utr: 'UTR123', payment_mode: 'UPI', date: '2026-01-01',
        announced: '0', announced_count: 0,
      }],
    }),
    DB_LOANS_EXPENSES: d1({
      'FROM expenses': [{ id: 7, year: 2026, amount: 100, discription: 'Tent', discription_hindi: '', category: 'Setup', created_by: 'x' }],
      'FROM loans': [{ id: 8, year: 2026, name: 'USER0007', amount: 5000, intrest_rate: 2, tenure: 12, loan_id: 'LN1', created_by: 'x', status: 'Approved', loan_status: 'Open', final_repayment_date: '' }],
      'FROM loan_guarantors': [{ id: 9, year: 2026, loaner: 'USER0007', guarantor: 'USER0008', loan_id: 'LN1', created_by: 'x', guarantor_signature: 'sig' }],
      'FROM loan_consents': [{ id: 10, loan_id: 'LN1', role: 'loaner', status: 'accepted', person_id: 'USER0007', consent_id: 'C1', consent_token: 'tok', otp: '1234', ip_address: '1.2.3.4' }],
    }),
    DB_FILE_INDEX: d1({
      'FROM generated_files': [{ id: 11, doc_type: 'receipt', year: 2026, record_id: 'receipt-2026-42', public_link: 'https://f.example/a.pdf', file_name: 'a.pdf', drive_path: '/x/a.pdf' }],
    }),
    DB_MISC: d1({}),
    DB_LOGS: d1({}),
    KV_PUBLIC: kv(),
  };
}

const pending = [];
const ctx = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})) };

const portal = async (env) => {
  const res = await worker.fetch(new Request(`${BASE}?action=portalData`, { method: 'GET' }), env, ctx);
  assert.equal(res.status, 200, 'the payload must still build');
  return res.json();
};

beforeEach(() => { queries = []; pending.length = 0; installCache(); });

// The headers the public frontend reads, per `userRow` in
// Public/frontend-v6/src/lib/api/schema.ts. Note the two trailing spaces: they are the
// real header names this payload has always used and are NOT changed here.
const PUBLIC_USER_HEADERS = [
  'ID', 'Name', 'Name (Hindi)', 'Village', 'Village (Hindi)',
  'Designation', 'Designation (Hindi)', "Father's Name ", "Father's Name (Hindi)",
  'Photo', 'Mobile ',
];

describe('the public users payload is an allowlist (PUB-BE-05)', () => {
  test('a user row carries exactly the public headers and nothing else', async () => {
    const data = await portal(makeEnv());
    assert.equal(data.users.length, 1);
    assert.deepEqual(Object.keys(data.users[0]).sort(), [...PUBLIC_USER_HEADERS].sort());
  });

  test('created_by never reaches an anonymous visitor', async () => {
    const data = await portal(makeEnv());
    // Before: `SELECT *` minus email/whatsapp/mobile, so the staff login name that
    // created each member row shipped to the whole internet, read by nothing.
    assert.equal(data.users[0]['Created By'], undefined);
    assert.ok(!JSON.stringify(data.users).includes('superadmin'));
  });

  test('email and personal WhatsApp are still absent', async () => {
    const data = await portal(makeEnv());
    assert.equal(data.users[0].Email, undefined);
    assert.equal(data.users[0].WhatsApp, undefined);
    assert.ok(!JSON.stringify(data.users).includes('amit@example.com'));
  });

  test('a column the table grows LATER does not ship itself', async () => {
    const data = await portal(makeEnv());
    // THE finding: a denylist fails open. `secret_future_column` is on the row and on
    // no list — under the old code it was published the moment it existed.
    assert.ok(!JSON.stringify(data.users).includes('AADHAAR'),
      'an unreviewed column must fail closed');
  });

  test('the users read names its columns instead of SELECT *', async () => {
    await portal(makeEnv());
    const q = queries.find((x) => x.sql.includes('FROM users'));
    assert.ok(!/^SELECT \* FROM users/i.test(q.sql), `still a wide read: ${q.sql}`);
    assert.match(q.sql, /^SELECT id_code, name, name_hindi/);
    assert.ok(!q.sql.includes('created_by'), 'a column we intend to drop is not even read');
    assert.ok(!q.sql.includes('email'));
    assert.match(q.sql, /ORDER BY id ASC/, 'ordering is unchanged');
    assert.ok(!/SELECT[^F]*\bid\b,/.test(q.sql),
      'and `id` is ordered by without being returned, so it cannot leak');
  });
});

describe('committee mobiles only (audit 1.2, unchanged by the allowlist)', () => {
  test("a committee member's mobile is published", async () => {
    const data = await portal(makeEnv());
    assert.equal(data.users[0]['Mobile '], '9876543210');
  });

  test("a plain contributor's mobile is not", async () => {
    const data = await portal(makeEnv({ committee: [] }));
    assert.equal(data.users[0]['Mobile '], undefined);
    assert.ok(!JSON.stringify(data.users).includes('9876543210'));
    // Everything else about the row is unaffected.
    assert.equal(data.users[0].Name, 'Amit Kumar');
  });

  test('an id_code with stray whitespace still matches the committee list', async () => {
    const data = await portal(makeEnv({
      users: [{ ...USER_ROW, id_code: ' USER0007 ' }],
      committee: [{ ...COMMITTEE_ROW, name: 'USER0007 ' }],
    }));
    assert.equal(data.users[0]['Mobile '], '9876543210');
  });
});

describe('an older deployment still serves a payload (PUB-BE-05)', () => {
  test('a missing photo column falls back to a wide read, still allowlisted', async () => {
    // The `photo` column arrives by ADD-COLUMN migration 27. A deployment that has not
    // applied it would fail the narrow projection outright, and taking the whole portal
    // down is worse than the leak being fixed — so the wide read is the fallback.
    const { photo, ...withoutPhoto } = USER_ROW;
    const data = await portal(makeEnv({ users: [withoutPhoto] }));

    const users = queries.filter((q) => q.sql.includes('FROM users'));
    assert.equal(users.length, 2, 'the narrow read is attempted first, then the fallback');
    assert.match(users[1].sql, /^SELECT \* FROM users/);

    // The fallback changes what is READ, never what is SENT.
    assert.equal(data.users[0].Photo, undefined, 'the column does not exist here');
    assert.equal(data.users[0]['Created By'], undefined, 'and the leak is still closed');
    assert.ok(!JSON.stringify(data.users).includes('AADHAAR'));
    assert.ok(!JSON.stringify(data.users).includes('superadmin'));
    assert.equal(data.users[0].Name, 'Amit Kumar');
  });
});

describe('internal row ids are published only where they are load-bearing (PUB-BE-05)', () => {
  test('a collections row keeps __rowIndex — the QR record id is built from it', async () => {
    const data = await portal(makeEnv());
    assert.equal(data.collections[0].__rowIndex, 42);
    // `receipt-2026-42` is what the Verify screen matches a paper document against.
    assert.equal(data.generatedFiles[0].record_id, 'receipt-2026-42');
  });

  for (const section of ['users', 'committee', 'expenses', 'loans', 'guarantors', 'generatedFiles', 'loanConsents']) {
    test(`a ${section} row no longer carries an internal row id`, async () => {
      const data = await portal(makeEnv());
      assert.ok(Array.isArray(data[section]) && data[section].length > 0, 'the section still has rows');
      assert.equal(data[section][0].__rowIndex, undefined,
        'nothing in any frontend reads this, so publishing it bought nothing');
    });
  }

  test('the sections still carry the fields the frontend does read', async () => {
    const data = await portal(makeEnv());
    assert.equal(data.committee[0].Name, 'USER0007');
    assert.equal(data.expenses[0].Discription, 'Tent');
    assert.equal(data.loans[0]['Loan ID'], 'LN1');
    assert.equal(data.guarantors[0].Guarantor, 'USER0008');
    assert.equal(data.loanConsents[0].consent_id, 'C1');
    assert.equal(data.collections[0].Amount, 501);
    // And the previously-agreed exclusions are still excluded.
    assert.equal(data.guarantors[0].guarantor_signature, undefined);
    assert.equal(data.loanConsents[0].otp, undefined);
    assert.equal(data.collections[0].UTR, undefined);
  });
});
