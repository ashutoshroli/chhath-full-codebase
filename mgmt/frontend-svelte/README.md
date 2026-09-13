# Chhath Puja Management Portal — SvelteKit

A **SvelteKit + TypeScript** rewrite of the management portal, migrated 1:1 from
the original React SPA at [`../frontend`](../frontend). It is a drop-in
replacement: **same design/layout, same behaviour, same backend**.

- **Design unchanged** — the exact `styles.css` from the React app is reused
  (copied to `src/lib/styles.css`); markup is a faithful 1:1 port.
- **Backend unchanged** — consumes the same management API (all ~150 actions).
  No API/DB/Worker changes were made for this migration.
- **The old React app is untouched** — it stays in `../frontend` as a safe
  rollback until this app is cut over.

## Stack

- SvelteKit 2 + Svelte 5 (runes) + TypeScript
- `@sveltejs/adapter-static` — builds a fully static SPA with a `200.html`
  fallback (same deploy shape as the React app: a static bundle behind auth).
- Vitest for unit tests, `svelte-check` for type/a11y checks.

## Develop

```sh
# Node 22
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22

npm install
VITE_API_URL="https://your-worker.example.com" npm run dev     # dev server
VITE_API_URL="https://your-worker.example.com" npm run build   # static build -> build/
npm run check   # svelte-check (type + a11y)
npm test        # vitest
```

`VITE_API_URL` must point at the management Worker (same value the React app
uses). The static build is emitted to `build/` with a `200.html` SPA fallback.

## Structure

```
src/
  routes/
    +layout.svelte            App-wide error handlers + polyfills + global CSS
    +page.svelte              App shell: session gate, header (year selector,
                              nav, ProfileMenu), role-based tab groups, and the
                              per-tab view switch. Mirrors React App.jsx.
    consent/[token]/          Public consent page   (React /consent/:token)
    announce/[token]/         Public announcement    (React /announce/:token)
  lib/
    api.ts                    The API client (auth/session/CSRF/device/offline
                              buffer/error logging + every action). Ports api.js.
    cache.ts device.ts flags.ts permissions.ts        Framework-agnostic core.
    viewData.ts               createViewData()  = React useViewData (cache-first)
    polling.ts visibilityPoller.ts   startPolling() = React usePolling
    dropdownList.ts           createDropdownList() = React useDropdownList
    transliterate.ts docxFill.ts qrCode.ts receiptTemplate.ts
    driveUrl.ts imagePrep.ts chunkGuard.ts polyfills.ts
    stores/session.ts         The logged-in user store.
    views/                    One file per management tab (Home, Loans, Users,
                              Committee, Expenses, DocxTemplates, PdfExport,
                              BulkGeneratePdfs, DownloadCenter, Email, WhatsApp,
                              PopupManagement, AnnouncementPortal, ConsentReview,
                              ConsentTemplates, QueueMonitor, LockYears, Backup,
                              StorageManagement, ListManagement, LoginManagement,
                              SeoSettings, AuditLogs, AiManagement, UploadCsvs,
                              ErrorLog …).
    components/               Shared components. React sub-components that were
                              declared inline inside a view were split into
                              per-file components under email/, whatsapp/,
                              audit/, consent/, announce/.
```

### React → Svelte mapping notes

- React hooks became Svelte-store factories: `useViewData → createViewData`,
  `usePolling → startPolling`, `useDropdownList → createDropdownList`.
- `useEffect(fn, [deps])` is emulated with a `$effect` + a "last key" guard so
  the effect re-runs only when the tracked value actually changes. (This is the
  source of the benign `svelte-check` "only captures the initial value" hints.)
- `main.jsx` global window error handlers → `+layout.svelte`
  (`onMount`), including the `reloadOnceForChunkError` self-heal.
- React `<ErrorBoundary>` has no Svelte control-flow equivalent; SvelteKit's
  `+error.svelte` covers route-level errors and the layout handlers report the
  rest, matching the React app's reporting behaviour.
- `heavy` libraries (`marked`, `dompurify`, `jspdf`, `html2canvas`,
  `docxtemplater`, `pizzip`, `qrcode`) are imported the same way React imported
  them; `docxFill`/`qrCode` stay lazy-loaded via `safeImport` where React used a
  dynamic `import()`.

### Not wired (dead code parity)

`ReceiptTemplates`, `CertificateTemplates`, `SamaanTemplates` and `ReceiptModal`
were ported for completeness but are **intentionally not mounted** — they are
dead code in the React app too (never imported by `App.jsx`; only their API
methods exist). Document templates are managed via **DocxTemplates**.

## Parity

Migrated phase-by-phase (6 PRs). The final phase was a strict, view-by-view
React-vs-Svelte audit (props, API-call arguments, permission gates, defaults,
validations, `confirm()`/`alert()` text, poll intervals, edge cases). All ~30
views and their components match behaviourally. The login screen is
pixel-identical.
