# WhatsApp queue (`manager.js`) — what actually changes

**Correction from earlier guidance:** I initially assumed your polling script used
GET requests and would need code changes. After seeing your real `manager.js`,
that was wrong — it already does everything the new Worker expects. **No code
changes needed in `manager.js` at all.**

## Why it already works

`fetchPendingMessagesForProject()` already does:
```js
fetch(project.appsScriptUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'getPendingMessages', apiKey: project.queueApiKey }),
});
```
— exact same shape `chhath-mgmt-api`'s `getPendingMessages` action expects.
`finalizeMessage()`'s `updateMessageStatus` call is the same story. And the field
names your queue engine reads off each pending item (`message_id`, `mobileno`,
`groupid`, `message`, `status`, `remarks`, `from`, `message_type`, `file_link`)
match the `whatsapp_index` D1 schema column-for-column
(`mgmt/db/schema/whatsapp_index.sql`).

## What actually needs to change — two config values, not code

Your `manager.js` already stores these per-project in `config.json`, editable
through your own `POST /api/projects/:id` endpoint:

1. **`appsScriptUrl`** → your deployed `chhath-mgmt-api` Worker URL, e.g.
   `https://chhath-mgmt-api.YOUR-SUBDOMAIN.workers.dev/`
2. **`queueApiKey`** → whatever value you set with:
   ```
   cd mgmt/backend
   wrangler secret put WHATSAPP_QUEUE_API_KEY
   ```
   (must match exactly — this is what `withApiKey()` in the Worker checks against)

Update via your own admin UI/API for that project, or edit `config.json` directly
and restart `manager.js`. `restartProjectPolling()` already re-reads the updated
URL/key on the next poll cycle after a config save via the API route — a direct
`config.json` edit needs a restart of `manager.js` itself to pick it up.

## One thing worth double-checking after cutover

`resendMessage` (Superadmin-triggered from the mgmt portal's WhatsApp Templates
screen) sets `status = 'resending'` in D1 — your `pollProject()` already handles
that status correctly (`handleResendMessage`), same as before. Nothing to change,
just worth a real test once switched over, since resend was one of the more
stateful code paths on both sides.
