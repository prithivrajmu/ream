# Ream Release Audit

Audit date: 2026-06-26

## Configuration reviewed

- Product name is `Ream` and the release application identifier is
  `com.prithiv.ream`.
- macOS targets are DMG and ZIP; hardened runtime and entitlement files are
  configured.
- Linux targets are AppImage, DEB, and tar.gz.
- A generated Ream PNG icon is configured for application packaging, Linux
  desktop entries, and the runtime tray icon.
- The packaged tray icon is copied as an Electron extra resource.
- The renderer, main process, and preload are packaged from `out/` with ASAR
  enabled.
- Linux artifacts were built successfully: AppImage, DEB, and tar.gz. The DEB
  metadata reports the expected `ream` package name, maintainer, homepage, and
  runtime icon resource.
- An unsigned macOS x64 ZIP was built and its archive contains both the macOS
  `icon.icns` and the runtime tray PNG.
- `npm audit --audit-level=high` completed with no reported vulnerabilities.

## Required release-environment checks

- Build and notarize macOS artifacts on macOS with a Developer ID certificate
  and Apple notarization credentials.
- Run `codesign`, `spctl`, and `stapler` validation before publishing macOS
  artifacts.
- Build Linux artifacts on x64 Linux and test the AppImage and DEB on clean
  supported distributions.
- Publish SHA-256 checksums for every Linux artifact.

## Release risks

- The app identifier changed from `com.prithiv.timesheettracker` to
  `com.prithiv.ream`. Ream now copies the legacy `timesheet-tracker` user data
  folder and migrates the legacy IndexedDB database into the `ream` database on
  first launch.
- User work remains in local IndexedDB. In-app JSON export is the supported
  backup and restore path; releases should not modify or delete local app data.
- Linux packages have no code-signing configuration. Checksums are required for
  integrity verification.
- The project checkout has no Git remote. The configured release homepage was
  inferred from the local Git author identity; confirm it is the final public
  repository URL before publishing.
- A DMG cannot be produced on this Linux host because Electron Builder invokes
  Apple’s `sips` tool. The configured `dist:mac` command must run on macOS to
  emit DMGs and to sign/notarize the x64 and arm64 artifacts.
