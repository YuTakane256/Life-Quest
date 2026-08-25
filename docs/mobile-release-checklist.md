# Mobile release checklist

This checklist prepares Life Quest for Expo Application Services (EAS) builds.
It deliberately does not create an EAS project, register signing credentials, or submit an app to either store.

## Build profiles and app identities

`apps/mobile/eas.json` defines three profiles:

| Profile | Distribution | Native identity | Intended use |
| --- | --- | --- | --- |
| `development` | Internal development client | `com.yutakane.lifequest.parity` / `lifequest-parity://` | Local development, Maestro and device debugging |
| `preview` | Internal | `com.yutakane.lifequest.preview` / `lifequest-preview://` | Tester distribution, isolated from the release app |
| `production` | Store-ready | `com.yutakane.lifequest` / `lifequest://` | A future signed store build |

Each profile uses a distinct native app identity and OAuth scheme, so SecureStore, AsyncStorage, and OAuth callbacks cannot be shared with the installed release application. `developmentClient: true` intentionally requires `expo-dev-client` and is only for the internal parity build. Do not sign a real production account into parity/automation builds; use local or staging Supabase credentials for those builds.

Run the configuration check before every release-related change:

```bash
npm run mobile:validate-release
```

It validates all profiles, public Expo manifests, the release/parity/preview identifiers, OAuth scheme, and the absence of secret-like values in the public manifest. This check is also part of pull-request CI.

## One-time EAS setup

1. Install the EAS CLI and authenticate with the team-owned Expo account.
2. From `apps/mobile`, run `eas init` only after confirming the Expo owner and project name. This creates the real project ID; do not invent one in source control.
3. Confirm the iOS bundle identifier and Android package `com.yutakane.lifequest` with the appropriate developer accounts.
4. Register the parity and preview identifiers separately only when those internal builds need native signing.
5. Store signing credentials in EAS or the platform consoles, never in this repository.

## Environment variables

`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are public client configuration. Define them separately in EAS `development`, `preview`, and `production` environments. They must contain only the Supabase URL and publishable/anon key.

Never add a Supabase `service_role` key, Google client secret, Apple private key, signing credential, or server-only URL to `EXPO_PUBLIC_*`, `VITE_*`, `app.config.ts`, `app.json`, or `eas.json`.

Apple Sign In uses the native iOS capability and Supabase's Apple provider. Configure Apple private keys and client secrets only in Apple Developer and Supabase. Account-deletion token revocation is tracked by #646 and must be complete before App Store submission.

Before testing Apple authentication, the release owner must:

1. Enable **Sign in with Apple** for the release, preview, and parity App IDs in Apple Developer.
2. Create a web Services ID linked to the primary App ID, and register Supabase's `/auth/v1/callback` as its Return URL.
3. Configure Supabase's Apple provider with the Apple key only in the Supabase dashboard. List the web Services ID first, followed by the enabled native bundle IDs.
4. Add the Web callback `https://<web-origin>/settings?auth=apple-oauth` to Supabase Auth redirect URLs.
5. On real iOS hardware, verify first sign-in, repeat sign-in, private-email sign-in, cancellation, logout, and Web-to-iOS / iOS-to-Web synchronization use the same Supabase user ID. Do not merge game data when the IDs differ.

- `development`: local or staging Supabase only; never production credentials.
- `preview`: staging only. Do not use production Supabase URL, anon key, or production cloud data in preview builds.
- `production`: the production Supabase URL and anon key.

## Versioning and device verification

EAS remote app versions and `autoIncrement` own preview and production build numbers. Update `expo.version` for a user-visible release version, then let EAS allocate the platform build number. Do not edit native build numbers manually in source control.

After the one-time EAS setup, create builds manually. Do not run EAS build from CI until the project owner and credentials policy are agreed.

```bash
cd apps/mobile
eas build --profile development --platform ios
eas build --profile preview --platform android
eas build --profile production --platform all
```

On each target device, verify:

- Google OAuth returns to the scheme for the installed variant: `lifequest://auth/callback` (production), `lifequest-preview://auth/callback` (preview), or `lifequest-parity://auth/callback` (development/parity). Register all three exact callback URLs in Supabase Auth and Google OAuth configuration when those builds are enabled. Email verification and password recovery return to their documented deep links.
- Web and Mobile account data synchronize in both directions; task completion, battle rewards and inventory remain idempotent.
- Offline operations queue, reconnect, retry and conflict handling all recover without losing data.
- The parity and preview apps remain isolated from the installed release app before any automated state-reset run.
- Notification permission, denied-permission handling, scheduled notifications, and foreground notification presentation work on a real iOS and Android device.
- Tasks, habits, statistics, character/inventory, map/battle, and settings render correctly with Safe Area and font scaling on current iOS and Android devices.

## Human approval before store submission

Before `eas submit` or a store upload, a release owner must confirm Apple and Google developer-account ownership, store metadata and privacy disclosures, production Supabase redirect URLs and Google OAuth settings, backup/monitoring/rollback plans, and final device smoke-test evidence.

Actual store submission and credential management remain deliberate, human-owned steps.
