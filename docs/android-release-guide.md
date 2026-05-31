# Android Release Guide

This project can now produce both debug and release Android builds from the `mobile` workspace.

## Prerequisites

- JDK 21
- Android SDK with:
  - `platform-tools`
  - `platforms;android-36`
  - `build-tools;35.0.0` or newer
- A release keystore when building signed production packages
- `mobile/android/local.properties` pointing to your local Android SDK if `ANDROID_HOME` is not set

## Build commands

- `npm.cmd run mobile:build:debug`
  - Produces a debug APK
- `npm.cmd run mobile:build:release`
  - Produces a release APK
- `npm.cmd run mobile:bundle:release`
  - Produces a release AAB for store upload

Output paths:

- Debug APK:
  - `mobile/android/app/build/outputs/apk/debug/app-debug.apk`
- Release APK:
  - `mobile/android/app/build/outputs/apk/release/app-release.apk`
- Release AAB:
  - `mobile/android/app/build/outputs/bundle/release/app-release.aab`

## Release signing setup

1. Copy `mobile/android/keystore.properties.example` to `mobile/android/keystore.properties`.
2. Create or place your keystore file in `mobile/android/`.
3. Fill in:
   - `storeFile`
   - `storePassword`
   - `keyAlias`
   - `keyPassword`

The real `keystore.properties` file is ignored by git.

## Create a release keystore

Example command:

```powershell
keytool -genkeypair -v `
  -keystore release-keystore.jks `
  -alias xtobsky `
  -keyalg RSA `
  -keysize 2048 `
  -validity 10000
```

Run it inside `mobile/android` so the default `storeFile=release-keystore.jks` works directly.

If your keystore is stored one directory above the app module, set:

```properties
storeFile=../release-keystore.jks
```

## Versioning

`mobile/android/app/build.gradle` now reads these optional Gradle properties:

- `APP_VERSION_CODE`
- `APP_VERSION_NAME`

Examples:

```powershell
cd mobile/android
gradlew.bat assembleRelease -PAPP_VERSION_CODE=2 -PAPP_VERSION_NAME=1.1.0
gradlew.bat bundleRelease -PAPP_VERSION_CODE=2 -PAPP_VERSION_NAME=1.1.0
```

## Current app polish included

- Release build scripts added to the workspace
- Android signing hook added for a local keystore
- App launcher branding updated from the Capacitor default
- Mobile bridge plugin updated to compile cleanly on Capacitor 8 / Java 21
