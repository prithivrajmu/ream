# Ream macOS Packaging

The app is packaged with `electron-builder`. Local development can produce unsigned builds; public distribution should use Apple Developer ID signing and notarization.

## Homebrew install

Community testing releases are distributed through a Homebrew tap:

```bash
brew tap prithivrajmu/ream
brew install ream
```

The generated formula lives at `packaging/homebrew/Formula/ream.rb` in this app
repo and is published to the dedicated tap repository
`prithivrajmu/homebrew-ream`. Release automation refreshes its version,
artifact URLs, and SHA-256 checksums from the signed macOS ZIP files uploaded to
GitHub Releases.

Plain `brew install ream` without `brew tap prithivrajmu/ream` is a future
upstream distribution path. That requires submitting Ream to the public
Homebrew package index after the project has stable public releases.

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

- App ID: `com.prithiv.ream`
- Product name: `Ream`
- Targets: DMG and ZIP
- Category: Productivity
- Hardened runtime: enabled
- App icon: generated Ream icon in `build/icon.png`

## Release checks

Build macOS artifacts on a macOS runner. Validate the signed application before publishing:

```bash
codesign --verify --deep --strict --verbose=2 release/mac*/Ream.app
spctl --assess --type execute --verbose release/mac*/Ream.app
```

For a notarized release, also confirm the notarization ticket is stapled:

```bash
xcrun stapler validate release/mac*/Ream.app
```

Generate the formula and confirm it installs locally:

```bash
npm run release:homebrew
brew install ./packaging/homebrew/Formula/ream.rb
```

## Release checklist

- Build on macOS from a version tag such as `v0.1.0`.
- Sign and notarize the app with Developer ID credentials.
- Upload DMG and ZIP artifacts to GitHub Releases.
- Publish SHA-256 checksums with the release.
- Regenerate and publish the Homebrew formula.
- Configure `HOMEBREW_TAP_TOKEN` with push access to `prithivrajmu/homebrew-ream`.

## Notes

Ream stores work locally in IndexedDB. Exports can contain private task names, notes, timestamps, and project labels. Keep exported backups private.
