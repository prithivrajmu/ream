# macOS Packaging

The app is packaged with `electron-builder`. Local development can produce unsigned builds; public distribution should use Apple Developer ID signing and notarization.

## Local unsigned build

```bash
npm run dist:mac:unsigned
```

Artifacts are written to `release/`. Unsigned builds are useful for private testing, but macOS may show security prompts when opening them.

## Signed and notarized build

Prerequisites:

- Apple Developer Program membership.
- Developer ID Application certificate installed in Keychain.
- App Store Connect API key or Apple ID notarization credentials configured for `electron-builder`.

Build command:

```bash
npm run dist:mac
```

Recommended environment variables for notarization:

```bash
APPLE_API_KEY=/path/to/AuthKey_XXXXXXXXXX.p8
APPLE_API_KEY_ID=XXXXXXXXXX
APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

## Current package settings

- App ID: `com.prithiv.timesheettracker`
- Product name: `Timesheet Tracker`
- Targets: DMG and ZIP
- Category: Productivity
- Hardened runtime: enabled

## Notes

The app stores timesheet data locally in IndexedDB. Exports can contain private task names, notes, timestamps, and project labels. Keep exported backups private.
