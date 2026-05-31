# X2Bluesky Android App

This folder contains the standalone Android app workspace for `X-to-Bluesky`.

It is no longer just a thin WebView shell.
The current Android path already embeds local app state, archive import, sync orchestration, and native mobile bridges inside the APK.

## What this Android app does

- Runs the migration UI inside an Android app
- Stores app configuration and imported tweet state locally on the device
- Stores sensitive credentials through the native secure storage bridge
- Imports X archive files directly from the phone
- Uses native HTTP support to talk to X and Bluesky
- Runs the sync workflow inside the app instead of requiring your own separate backend service

## Current architecture

The Android app now follows a single-APK direction:

- `client`
  - UI and embedded runtime
- `packages/core`
  - shared sync, config, archive, and store logic
- `mobile`
  - Capacitor Android app container and native bridges

For web or desktop-style development, the legacy `server` path still exists in the repo.
For Android, the preferred direction is the embedded in-app runtime.

## Main commands

Run these from the repository root:

- `npm.cmd run mobile:sync`
  - Build the web assets and sync them into the Android project
- `npm.cmd run mobile:android`
  - Open the Android project in Android Studio
- `npm.cmd run mobile:build:debug`
  - Build a debug APK
- `npm.cmd run mobile:build:release`
  - Build a release APK
- `npm.cmd run mobile:bundle:release`
  - Build a release `.aab`

## Output files

- Debug APK
  - `mobile/android/app/build/outputs/apk/debug/app-debug.apk`
- Release APK
  - `mobile/android/app/build/outputs/apk/release/app-release.apk`
- Release App Bundle
  - `mobile/android/app/build/outputs/bundle/release/app-release.aab`

## Environment requirements

- JDK 21
- Android SDK
- Android build tools compatible with this repo

If you need full release-signing steps, see:

- `docs/android-release-guide.md`

## What is already mobile-native

- First-run mobile configuration flow
- Secure credential storage bridge
- Native archive file picker
- Android notification/status bridge
- Embedded sync runtime for single-APK operation

## Current limitations

- The Android app still talks to X and Bluesky over the network, so it is not offline-only
- Background execution is still being hardened and can be improved further
- Some large dependencies are still being optimized for startup and package size
- The repo still contains the older `server` route for compatibility and staged migration

## Recommended next direction

If this Android app becomes the primary product path, continue with:

1. Better background sync resilience
2. More aggressive code-splitting and startup optimization
3. Release signing and store metadata
4. Final cleanup of legacy backend assumptions
