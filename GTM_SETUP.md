# Google Tag Manager + GA4 + Microsoft Clarity — setup

## What's in the code (this is the only code change needed, ever)

- `mgmt/frontend/index.html` and `Public/frontend/index.html` — GTM container
  snippet added (head script + body noscript iframe). **Replace `GTM-XXXXXXX`
  with your real container ID in both files** before deploying. Same GTM
  container ID can be used in both, or two separate containers — your call.
- `mgmt/frontend/src/main.jsx` — pushes a `pageview` dataLayer event on every
  React Router route change (`/consent/:token`, `/announce/:token`).
- `mgmt/frontend/src/App.jsx` — pushes the same `pageview` event on every
  internal tab change (Home, Users, Loans, ...). This is the one that actually
  matters most — the authenticated portal switches screens via React state,
  not URL routes, so without this GA4/Clarity would only ever see a single
  pageview per session no matter how much someone navigates.
- `Public/frontend/script.js` — same idea, inside `app.nav()`, since that site
  also swaps sections via JS instead of real page loads.

Every pushed event has the shape `{ event: 'pageview', page: '<path>' }`.

## What to configure in GTM (dashboard only, no code)

1. **Trigger** — Custom Event trigger, event name `pageview`. Fires on every
   route/tab/section change from all three places above.
2. **GA4 Configuration tag** — built into GTM, paste your Measurement ID,
   fire on the trigger above (plus GTM's default "All Pages" trigger for the
   very first load, which fires automatically on container init).
3. **Microsoft Clarity** — GTM has a Clarity template in the Community
   Template Gallery (search "Clarity" when adding a new tag), or a Custom
   HTML tag with Clarity's snippet — either way, fire on Initialization /
   All Pages (Clarity tracks its own session, doesn't need the `pageview`
   event specifically, but doesn't hurt to fire it there too).

Once GTM is published with these tags, adding/removing/changing GA4 or Clarity
in future never touches this codebase again — it's all GTM dashboard from
here.
