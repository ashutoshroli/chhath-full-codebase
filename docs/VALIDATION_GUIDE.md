# Request validation (audit Q-1) — `src/validate.js`

## What & why

Q-1 asked for `zod` schemas at the router boundary to replace the ~90 handlers each
doing ad-hoc `if (!x) throw` checks. We did **not** add zod, deliberately:

- The mgmt Worker has **zero runtime dependencies** by design (see
  `mgmt/backend/package.json` — only `wrangler` as a devDep). The source is plain ESM
  that Node imports directly so the test suite runs the *real* code, and a free-tier
  Worker bundle stays small. Adding zod (plus a `package-lock` + `npm ci` the backend
  avoids) is a large surface-area change three weeks before launch.
- `#80` already made every throw **correctly typed** (`ValidationError` = 400 not
  logged, `InternalError` = 500 logged), so the worst of Q-1 (untyped throws → logged
  500s) is already gone.

`src/validate.js` is a **dependency-free, zod-shaped** helper that delivers the same
win — one declarative schema per handler — with every failure a correctly-typed
`ValidationError`.

## Why this is shipped as a foundation, not a 90-handler rewrite

Rewriting all ~90 handlers at once is precisely the kind of broad, pre-launch change
that "breaks something subtle" — many handlers have **load-bearing, user-facing error
messages** and specific check ordering that the frontend and operators rely on.
Changing them en masse is risky and unreviewable. So this PR ships the primitive +
tests + this guide, and handlers adopt it **incrementally**, one reviewable diff at a
time, preserving their existing messages where those matter.

## Usage

```js
import { v, validateFields } from './validate.js';

export async function addYear(env, payload, user) {
  requireSuperadmin(user);
  const clean = validateFields(payload, {
    year: v.integer({ required: true, min: 2000, max: 2100 }),
  }, 'year');
  // clean.year is a validated Number; only declared keys survive.
  ...
}
```

Validators (all optional unless `required: true`):

| Validator | Checks | Coerces to |
|---|---|---|
| `v.string({ required, min, max, pattern })` | length + optional regex | trimmed string |
| `v.integer({ required, min, max })` | `^-?\d+$` + range | Number |
| `v.number({ required, min, max })` | finite + range | Number |
| `v.digits({ required, length })` | digits, optional exact length | string |
| `v.oneOf(list, { required })` | enum membership | string |
| `v.boolean({ required })` | `1/true/yes` vs `0/false/no` | boolean |

Behaviour that prevents the bugs the audit flagged:
- An **absent optional** field is **omitted**, never silently coerced to `0`/`''`.
- The result contains **only declared keys**, so an un-vetted extra key can't pass
  through into a downstream write.
- Every failure is `ValidationError('<Label> <reason>')` — a 400, not a logged 500.

## What it does NOT do

It validates request **shape / type / format** only. Domain rules that need the DB —
year-locked checks, role permissions, id allocation, uniqueness — stay in the
handlers (and in `crud.js`'s existing `validatePayload` / `saveRecord`). `validate.js`
replaces the duplicated, easy-to-get-subtly-wrong shape checks, not those.

## Adoption checklist (per handler, incremental)

1. Identify the handler's shape/type/format checks (the `if (!x) throw` block).
2. Express them as a `validateFields(...)` schema at the top of the handler.
3. **Preserve any user-facing message the frontend keys on** — if a message must be
   exact, keep that specific `throw` and use `validate.js` only for the rest.
4. Keep all DB/permission/domain checks where they are.
5. Add/extend the handler's test to cover the new schema.
