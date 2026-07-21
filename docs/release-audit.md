# Ream Release Audit

Audit date: 2026-07-15

## Configuration reviewed

- Product name is `Ream` and the release application identifier is
  `com.prithiv.ream`.
- macOS targets are DMG and ZIP; hardened runtime and entitlement files are
  configured.
- Linux targets are AppImage, DEB, and tar.gz.
- The production release workflow runs for semantic version tags (`v*.*.*`),
  sets the packaged version from the tag, and builds matching Linux and macOS
  artifacts before publishing them.
- GitHub release notes are generated from the commits and merged pull requests
  included since the prior release. The platform-specific prerelease workflows
  include those generated notes alongside their tester guidance.
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

## Release process

1. Merge the approved pull request into `main`.
2. Create and push a semantic version tag such as `v0.2.0`; the `Release`
   workflow uses that tag for the package version and artifact names.
3. Confirm GitHub's generated release notes accurately capture the included
   commits and pull requests, then verify the published checksums and platform
   artifacts.

## Release risks

- The app identifier changed from `com.prithiv.timesheettracker` to
  `com.prithiv.ream`. Ream now copies the legacy `timesheet-tracker` user data
  folder and migrates the legacy IndexedDB database into the `ream` database on
  first launch.
- User work remains in local IndexedDB. In-app JSON export is the supported
  backup and restore path; releases should not modify or delete local app data.
- Linux packages have no code-signing configuration. Checksums are required for
  integrity verification.
- The checkout is connected to `origin` at `git@github.com:prithivrajmu/ream.git`, and the configured release homepage already matches the public repository URL.
- A DMG cannot be produced on this Linux host because Electron Builder invokes
  Apple’s `sips` tool. The configured `dist:mac` command must run on macOS to
  emit DMGs and to sign/notarize the x64 and arm64 artifacts.
