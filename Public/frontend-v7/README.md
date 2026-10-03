# Chhath Public Frontend v7

A new standalone SvelteKit + TypeScript frontend with a minimal, mobile-first design. This directory does not replace or modify frontend-v6.

## Goals
- Clear readable financial figures and contributor records
- Responsive year selector and search
- Direct links to Our Journey and Downloads
- Small dependency set and no UI framework
- Read-only connection to the existing public Cloudflare Worker API

## Local development
```sh
npm install
npm run check
npm run build
npm run dev
```

API base defaults to `https://chhath-public-worker.shaharpura.com`; no backend or database changes are included.

## Routes
- `/` public ledger overview, contributor search and expense summary
- `/decade/` Our Journey year selector
- `/downloads/` public document entry point

This is an initial implementation and must pass CI plus manual mobile/browser checks before deployment.