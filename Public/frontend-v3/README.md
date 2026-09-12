# Chhath Public Frontend — Tailwind redesign

Plain static site (no framework), now styled entirely with Tailwind CSS
utility classes — no hand-written CSS file anywhere in the project.

## What changed vs the old version

- **Styling**: `style.css` is no longer hand-written. It is *generated* by the
  Tailwind CLI from `src/input.css` (which only contains the 3 `@tailwind`
  directives). Every class in `index.html`, `privacy.html`, `terms.html` and
  `script.js`'s render functions is a Tailwind utility class.
- **Responsive**: mobile-first; `md:`/`lg:` breakpoints used for the
  desktop nav, wider paddings, etc. — same as before (bottom nav on mobile,
  top nav from `md:` up).
- **State/markup toggling preserved**: `script.js` still does
  `classList.add('active')` / `classList.add('active-view')` exactly as
  before. Those two marker classes are styled via Tailwind's arbitrary
  variant syntax directly on the elements, e.g.
  `class="hidden [&.active-view]:block"` — so the JS didn't need to change
  at all, and there's still no custom CSS file.
- **No functionality changed**: every `app.*` function, its logic, and every
  `onclick`/`onchange` handler is identical to before. Only the HTML strings
  those functions build (and the static markup in the `.html` files) were
  restyled.
- **Performance**: no extra JS libraries added. Tailwind's compiled CSS is
  minified and purged to only the classes actually used
  (`tailwindcss --minify`, `content: [...]` in `tailwind.config.js`). Fonts,
  `defer`, GTM-on-load, etc. are unchanged from the original.

## Environment variables (new)

This is a plain static site, so there's no `import.meta.env` /
`process.env` available in the browser. Instead:

1. `generate-env.js` runs at **build time** and reads real env vars
   (`PUBLIC_API_URL`, `PUBLIC_CHATBOT_API_URL`, `PUBLIC_LOGIN_URL` — see
   `.env.example`).
2. It writes them into a generated `env.js`:
   `window.__ENV__ = { PUBLIC_API_URL: "...", ... }`.
3. `index.html` loads `env.js` right before `script.js` (both `defer`, so
   they still run in that order).
4. `script.js` reads `window.__ENV__.PUBLIC_API_URL` etc., falling back to
   the old production URLs if `env.js` is missing.
5. `index.html`'s mgmt-login link (`#mgmt-login-link`) gets its `href` set
   from `window.__ENV__.PUBLIC_LOGIN_URL` in `app.init()`.

Set the real values in **Vercel → Project Settings → Environment
Variables** (or a local `.env`, copied from `.env.example`).

## Build & deploy

```bash
npm install
npm run build     # writes env.js + compiles style.css
```

`vercel.json` now has `"buildCommand": "npm run build"`, so Vercel runs this
automatically on every deploy — nothing manual needed there.

`npm run inject-seo` (the old `build.mjs`) is still optional/manual, exactly
as before — unrelated to this redesign.

### Local preview

Since `env.js` and `style.css` are build outputs (gitignored), run
`npm run build` once before opening `index.html`, or use
`npm run watch:css` while you work on markup.

## One thing to double check before going live

`vercel.json`'s CSP header (`connect-src`) still lists the **production**
API/chatbot hostnames explicitly, since CSP headers can't reference env
vars. If you point `PUBLIC_API_URL` / `PUBLIC_CHATBOT_API_URL` at a
different host (e.g. a staging Worker), add that host to `connect-src` too.
