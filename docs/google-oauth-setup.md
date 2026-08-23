# Google OAuth setup

Life Quest uses Supabase Auth as the OAuth broker. Google credentials are never
bundled into Web or Expo builds. In particular, do not add a Google client secret
to a tracked `.env` file, `VITE_*`, `EXPO_PUBLIC_*`, `app.config.ts`, or `eas.json`.

## 1. Configure Google Cloud

Create an OAuth 2.0 Web application in Google Cloud Console. Its **Authorized
redirect URI** must be the Supabase callback, not a Life Quest URL:

```
https://<your-project-ref>.supabase.co/auth/v1/callback
```

For local Supabase development, use the Auth callback URL shown by `supabase
status` followed by `/auth/v1/callback`. Add JavaScript origins separately if
your Google Cloud setup requires them.

## 2. Configure Supabase

In **Authentication > Providers > Google**, enable Google and enter the client
ID and client secret from Google Cloud. Keep the secret in Supabase only.

For a local Supabase CLI instance, the provider may instead read its credentials
from an **untracked, server-only** local environment (for example
`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and
`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET`). These variables are supplied to
the Supabase CLI/container, not to Vite or Expo. They must never be renamed to
`VITE_*` or `EXPO_PUBLIC_*`, and must not be committed. Enable the local Google
provider only after those server-side values are available.

Add these redirect URLs in **Authentication > URL Configuration**:

- `https://<web-host>/settings?auth=oauth`
- `http://localhost:5173/settings?auth=oauth`
- `http://127.0.0.1:5173/settings?auth=oauth`
- `lifequest://auth/callback`

The existing email-confirmation and password-recovery URLs remain separate:
`/settings?auth=verify`, `/settings?auth=recovery`, and `lifequest://settings`.

## 3. Verify manually

Use a development build rather than Expo Go, then test Web and Mobile with the
same Google account. Confirm that:

1. Both clients receive the same authenticated user.
2. A successful callback starts cloud sync once.
3. Canceling the browser returns safely to the Mobile settings screen.
4. Password-recovery links still open `lifequest://settings`.

Do not test or log provider access tokens. Life Quest accepts only Supabase PKCE
authorization codes at `lifequest://auth/callback`.
