# X-to-Bluesky

`X-to-Bluesky` is a migration tool for moving tweet history from X (Twitter) to Bluesky.

This repository now has two usable directions:

- A legacy web/server workflow for desktop-style local use
- A newer Android single-APK path that embeds more of the runtime directly inside the app

At this stage, the Android path is the main long-term direction.

## What it can do

- Import tweet history from:
  - X API
  - X official archive export (`.zip`, `.json`, `tweets.js`)
- Manage tweet migration progress from a visual interface
- Configure sync policies:
  - skip retweets
  - skip replies
  - dry run
  - delay between posts
  - optional source tag
- Post migrated content to Bluesky
- Track status, logs, retry state, and sync progress

## Repository layout

```text
x-to-bsky/
+-- client/          # React UI
+-- server/          # Legacy Express/server path
+-- mobile/          # Capacitor Android app
+-- packages/core/   # Shared migration and sync logic
\-- docs/            # Android and architecture documentation
```

## Current recommended path

If your goal is the Android app, start with:

- [mobile/README.md](./mobile/README.md)

That README describes:

- the standalone Android app workspace
- current single-APK architecture
- build commands
- APK / AAB output paths

## Android app status

The Android app is no longer just a thin shell.

It already includes:

- local app state stored on-device
- secure credential storage bridge
- archive import from phone files
- embedded sync orchestration
- native HTTP access to X and Bluesky

That means the Android path is moving toward a true standalone APK, instead of requiring a separately deployed backend for normal app usage.

## Web / local server workflow

The older desktop-style local workflow still exists for compatibility and development.

Run from the repository root:

```bash
npm install
npm run dev
```

Default local addresses:

- frontend: `http://localhost:5173`
- backend: `http://localhost:3847`

Production-style build:

```bash
npm run build
npm start
```

## Android workflow

Useful root commands:

- `npm.cmd run mobile:sync`
- `npm.cmd run mobile:android`
- `npm.cmd run mobile:build:debug`
- `npm.cmd run mobile:build:release`
- `npm.cmd run mobile:bundle:release`

For release signing and store packaging, see:

- [docs/android-release-guide.md](./docs/android-release-guide.md)

For Android workspace notes, see:

- [docs/android-shell-setup.md](./docs/android-shell-setup.md)

## Credentials you may need

### Bluesky

Create an App Password in Bluesky settings:

- [Bluesky App Passwords](https://bsky.app/settings/app-passwords)

### X API

If you want to fetch recent tweets from X API, prepare:

- X Bearer Token
- X User ID

You can get these through:

- [X Developer Portal](https://developer.x.com/)

If you want more complete history, the official X archive export is recommended instead.

## Current limitations

- Media upload is still limited compared with a fully native migration pipeline
- Thread reconstruction is not fully rebuilt as Bluesky conversation structure
- Some Android background behavior is still being hardened
- The repo still contains both legacy and new architecture paths during the transition period

## Security notes

- Use a Bluesky App Password instead of your main password
- Do not commit keystores or private credentials
- The Android path stores sensitive values through the native secure storage bridge
