# Neon (Postgres) — Public Chatbot database

The public portal AI chatbot stores its **conversation logs** in a Neon Postgres
database, **not** in Cloudflare D1.

## Why Neon (and not D1)

Chat is **high-write and spiky** — a Chhath festival traffic spike could produce
thousands of messages in a day. Cloudflare **D1's free tier has a hard cap of
100,000 rows written/day**, and the **mgmt Worker already shares that budget**
(cron queue, error log, sessions, receipt/collection saves). If chat logs went on
D1, a chat spike could exhaust that budget and take the **whole portal**
(receipts, WhatsApp, saves) offline.

**Neon has no daily row-write cap** (it's compute/storage based), so chat writes
here **never touch the D1 budget**. The mgmt portal stays safe no matter how much
the chatbot is used. This is the whole reason chat logs live here.

**What lives here:** only chatbot conversation logs (`chat_sessions`,
`chat_messages`). **No portal data** — collections/expenses/loans/committee stay in
D1 (the source of truth); the chatbot reads a cached summary of that data at answer
time, it is never copied here. **No secrets.**

## Setup steps

### 1. Create a Neon account + project
1. Go to <https://neon.tech> and sign up (free tier is enough to start).
2. **New Project** → name it `chhath-chatbot`.
3. Region: pick the one closest to where the Render service runs (e.g. AWS
   `ap-south-1` Mumbai) for low latency.

### 2. Apply the schema
Open the Neon dashboard → **SQL Editor**, paste the contents of
[`schema.sql`](./schema.sql), and **Run**.

Or from a terminal with `psql`:
```bash
psql "postgresql://<user>:<password>@<host>.neon.tech/<db>?sslmode=require" -f mgmt/db/neon/schema.sql
```

### 3. Get the connection string (use the POOLED one)
Neon dashboard → **Connection Details**:
- Toggle **Pooled connection** ON (Render handles many short-lived requests; the
  pooler avoids exhausting Postgres connections).
- Copy the string. It looks like:
  ```
  postgresql://<user>:<password>@<host>-pooler.<region>.aws.neon.tech/<db>?sslmode=require
  ```
  `?sslmode=require` is mandatory — keep it.

### 4. Give the connection string to the Render service
Render dashboard → **chhath-server-render** → **Environment** → add:
```
DATABASE_URL = <the pooled connection string from step 3>
```
Save. With `autoDeploy` on, Render redeploys automatically.

> The chatbot Render code treats `DATABASE_URL` as **optional**: if it is not set,
> the chatbot still answers, it just **skips logging** (no crash). So you can wire
> the model first and add Neon logging later.

### 5. Verify
Send a test message from the public portal chatbot, then in the Neon **SQL Editor**:
```sql
SELECT session_id, role, left(content, 60) AS preview, created_at
FROM chat_messages ORDER BY created_at DESC LIMIT 5;
```
You should see your question + the assistant's answer.

## Security notes
- `DATABASE_URL` lives **only** in the Render dashboard env — **never** commit it to
  git (GitGuardian will flag it). `?sslmode=require` keeps the connection encrypted.
- We store an **IP hash**, never the raw IP; and **no other PII**.
- This DB is **write-mostly** (append conversation logs). It holds nothing that
  could be used to impersonate a user or access the portal.

## Retention (optional)
To keep the free tier small, periodically delete old logs (see the commented
`DELETE` statements at the bottom of `schema.sql`), e.g. anything older than 90 days.
