# Android Long-Term Plan

This repository now has a dedicated reusable core workspace in `packages/core`.

## What moved

- Shared domain types now live in `packages/core/src/types.ts`
- The sync workflow now lives in `packages/core/src/sync.ts`
- `server` keeps the platform adapters:
  - HTTP routes
  - SQLite persistence
  - X API access
  - Bluesky API access

## Why this helps Android

Android support becomes a shell problem instead of a business-logic rewrite.

Future app targets can reuse the same core sync controller and swap only the adapters:

- Storage adapter: SQLite, Room, IndexedDB, or secure mobile storage
- Import adapter: file picker, share sheet, or cloud import
- Publisher adapter: Bluesky client for native or JS runtime
- Job runner: foreground service, WorkManager, or in-app task runner

## Current reusable layers

- `packages/core/src/sync.ts`: sync workflow controller
- `packages/core/src/archive.ts`: archive parsing rules
- `packages/core/src/config.ts`: config masking and update rules
- `packages/core/src/store.ts`: app storage contract
- `packages/core/src/credentials.ts`: secret storage contract
- `packages/core/src/session.ts`: session storage contract
- `packages/core/src/tasks.ts`: task execution contract

## Recommended next steps

1. Implement an Android `CredentialStore` backed by secure storage.
2. Implement an Android `AppStore` backed by SQLite or Room.
3. Replace the inline `TaskRunner` with a foreground-service or WorkManager adapter.
4. Move file import entrypoints behind a mobile-friendly picker/share adapter.
5. Add integration tests around the core controller so future adapters can be validated consistently.
