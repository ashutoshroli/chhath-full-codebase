# Sign in with Google — setup guide (mgmt portal)

The management portal now supports **Sign in with Google** on the login screen,
alongside the existing username/mobile/email + password login.

## How it works (important)

- Google is only an **authentication method**, not a way to self-register.
- A Google account can sign in **only if a committee login already exists whose
  `email` matches** the Google account's verified email. There is no account
  creation from Google.
- On success the user gets the **exact same session** as a password login (same
  token, same role, same 8-hour / 30-day "remember me" behaviour, same
  Active-Devices / remote-logout support).

Flow: the browser gets a Google **ID token** → the Worker verifies it with Google
(`oauth2.googleapis.com/tokeninfo`), checks the token was minted for **this** app
(`aud`), the issuer is Google, it hasn't expired, and the email is verified → it
looks up `login_users` by that email (case-insensitive) → issues a session.

---

## One-time setup

### 1. Create (or reuse) a Google OAuth Web client id

You can reuse the **same Google Cloud project** that already powers the Drive
integration (`DRIVE_OAUTH_CLIENT_ID`), or make a dedicated one.

1. Go to **Google Cloud Console → APIs & Services → Credentials**.
2. **Create Credentials → OAuth client ID → Application type: Web application**.
3. Under **Authorized JavaScript origins**, add the mgmt portal origin(s):
   - `https://mgmt-chhath.shaharpura.com`
   - (and any preview/vercel origin you use, e.g. `https://<project>.vercel.app`)
4. Copy the **Client ID** (looks like `1234567890-abc.apps.googleusercontent.com`).

> No client **secret** is needed for sign-in — ID-token verification uses only the
> client id.

### 2. Configure the backend (Worker)

Set the client id in `mgmt/backend/wrangler.toml` under `[vars]`:

```toml
GOOGLE_SIGNIN_CLIENT_ID = "1234567890-abc.apps.googleusercontent.com"
```

- If you leave it blank, the code **falls back to `DRIVE_OAUTH_CLIENT_ID`**, so
  sign-in can still work if that client's origins include the portal — but setting
  it explicitly is clearer and safer.
- It's a **public** value, so it belongs in `[vars]`, not a secret.

Deploy the Worker:

```bash
cd mgmt/backend && npx wrangler deploy
```

### 3. Configure the frontend (build-time)

The frontend needs the **same** client id at build time as `VITE_GOOGLE_CLIENT_ID`.

- **Vercel:** Settings → Environment Variables → add
  `VITE_GOOGLE_CLIENT_ID = 1234567890-abc.apps.googleusercontent.com`, then redeploy.
- **Local build:**
  ```bash
  cd mgmt/frontend
  VITE_GOOGLE_CLIENT_ID="1234567890-abc.apps.googleusercontent.com" npm run build
  ```

> If `VITE_GOOGLE_CLIENT_ID` is **not** set, the Google button simply does not
> appear and password login works exactly as before. Nothing breaks.

### 4. Link committee logins to their Google emails

For each person who should use Google sign-in, make sure their **login's email**
is set to the Gmail/Google Workspace address they'll sign in with:

- **Login Management** screen → edit the login → set **Email** to their Google
  address. (New logins created via *Add Login* already require an email.)

The match is **case-insensitive**. If a login has no email, that person can still
use their password — they just can't use Google until an email is added.

---

## Troubleshooting

| Message the user sees | Cause | Fix |
|---|---|---|
| *No committee login is linked to this Google account…* | No `login_users` row has that email | Add the email to their login under Login Management |
| *This Google sign-in could not be verified* | Token `aud` ≠ your client id / wrong issuer / expired | Make sure `GOOGLE_SIGNIN_CLIENT_ID` (Worker) and `VITE_GOOGLE_CLIENT_ID` (frontend) are the **same** client id, and the portal origin is in the client's **Authorized JavaScript origins** |
| *Your Google account has no verified email…* | The Google account's email isn't verified | Use a verified Google account |
| *Google sign-in is not set up on the server yet* | Neither `GOOGLE_SIGNIN_CLIENT_ID` nor `DRIVE_OAUTH_CLIENT_ID` is set on the Worker | Set `GOOGLE_SIGNIN_CLIENT_ID` and redeploy |
| The Google button doesn't appear | `VITE_GOOGLE_CLIENT_ID` wasn't set at build time | Set it and rebuild/redeploy the frontend |
| After picking an account it **hangs on `accounts.google.com/gsi/transform`** and never returns | `Cross-Origin-Opener-Policy: same-origin` severs the Google popup's message back to the page | Fixed in `mgmt/frontend/vercel.json` — COOP is now `same-origin-allow-popups`. If you host elsewhere, ensure that header value and that the CSP allows `https://accounts.google.com` in `script-src`, `connect-src` and `frame-src`. |
| It hangs and the client is a **Desktop** type | Browser Sign-In requires a **Web application** OAuth client | Use the "Web application" client (not the Desktop/Drive one) and set that client's id in both env vars |

---

## Security notes

- **No self-registration:** an unknown Google email is rejected — a login must
  already exist with that email.
- **Token audience is enforced:** a Google token minted for any other app is
  rejected (`aud` check), so a token from an unrelated site can't be replayed here.
- **Rate limited:** `verifyGoogleLogin` is in `RATE_LIMITED_ACTIONS` (per-IP), the
  same protection `login` has.
- **Roles are still live:** the session stores the role, but every request
  re-reads the current role from `login_users` (unchanged behaviour), so demoting
  or deleting a login takes effect immediately regardless of how they signed in.
