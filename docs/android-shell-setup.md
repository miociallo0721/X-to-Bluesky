# Android Shell Setup

This repository now includes a `mobile` workspace powered by Capacitor.

## What it does

- Reuses the built web app from `client/dist`
- Wraps it in an Android shell
- Supports an optional runtime server URL through `MOBILE_API_BASE_URL`

## Commands

- `npm.cmd run mobile:sync`
  - Builds the web app and syncs it into the Android project
- `npm.cmd run mobile:android`
  - Opens the generated Android project in Android Studio
- `npm.cmd run mobile:build:debug`
  - Builds a debug APK
- `npm.cmd run mobile:build:release`
  - Builds a release APK
- `npm.cmd run mobile:bundle:release`
  - Builds a release Android App Bundle (`.aab`)

## API configuration

The web client now supports `VITE_API_BASE_URL`.

- Web development can continue using the Vite proxy
- Mobile builds can point at a hosted backend or LAN server
- Capacitor can also load a remote app URL through `MOBILE_API_BASE_URL`

## Local backend example

If you want the Android shell to talk to a server running on your computer:

1. Start the backend on your computer.
2. Make sure your phone or emulator can reach that machine over the network.
3. Set `VITE_API_BASE_URL` to something like `http://192.168.1.10:3847`.
4. Run `npm.cmd run mobile:sync`.

If you want Capacitor to load a remote web app directly instead of bundled assets, set `MOBILE_API_BASE_URL` before syncing.

## Notes

- If `MOBILE_API_BASE_URL` is omitted, Capacitor loads local built assets from `client/dist`
- If `MOBILE_API_BASE_URL` starts with `http://`, cleartext traffic is enabled for Android
- For a real Android deployment, the next step is replacing the default stores and task runner with native adapters
- See `docs/android-release-guide.md` for signing, versioning, and store build steps
