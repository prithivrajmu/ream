# Ream

Ream is a local-first desktop workspace for tracking tasks, notes, time entries, projects, and review history. It ships with a full main window, a compact overlay, and optional local AI note cleanup.

## Install

### Run from source with Node.js

This is the only install path that works today — no packaged release has been published yet.

```bash
git clone https://github.com/prithivrajmu/ream.git
cd ream
npm install
npm run dev
```

### macOS with Homebrew (not yet available)

Ream's Homebrew tap infrastructure (`packaging/homebrew/`, `npm run release:homebrew`) is in place, but the `prithivrajmu/homebrew-ream` tap repository is currently private and has no published formula, so `brew tap`/`brew install` will not work for external users yet. Once a signed release is published:

```bash
brew tap prithivrajmu/ream
brew install ream
```

### Linux with APT (not yet available)

Ream's APT repository generation (`npm run release:apt`) is in place and GitHub Pages is configured for this repo, but no release has been published to it yet — the URL below currently 404s. Once a release is published:

```bash
curl -fsSL https://prithivrajmu.github.io/ream/apt/setup.sh | sudo bash
sudo apt install ream
```

## What Ships Today

- Track work against named tasks with projects and tags.
- Start, stop, and correct timers from the main workspace, one running timer at a time by design.
- Capture notes while the timer is running or after the session ends.
- Review activity through insights, a weekly timesheet, recent entries, and task history.
- Keep data local by default, with JSON and CSV export for backups or reporting.
- Move the data folder to a custom location from Settings.
- Improve notes through a local Ollama sidecar when you want AI assistance.
- Use a compact always-on-top overlay while staying in Zoom, a browser, or your editor.

## Distribution

Ream produces desktop artifacts with Electron Builder and release metadata for Homebrew and APT.

```bash
npm run dist:linux
npm run dist:mac:unsigned
npm run release:checksums
npm run release:homebrew
npm run release:apt
```

Linux outputs AppImage, Debian, and tarball artifacts in `release/`. macOS distribution should be built, signed, and notarized on a macOS machine; see [macOS packaging](docs/macos-packaging.md) and [Linux packaging](docs/linux-packaging.md).
Plain `brew install ream` and plain `sudo apt install ream` without adding a Ream package source first require acceptance into upstream package indexes.

## Product Surface

### Main Window

- Today view with quick capture, active timer, and task cards.
- Insights with charts, highlights, and session history.
- Weekly timesheet for per-task and per-day review.
- Recent entries and note history with inline editing.
- Tasks and projects management, plus archive and restore flows.
- Backup and restore tools for JSON and CSV exports.
- Profile and theme controls for the main UI and overlay.

### Overlay

- Compact always-on-top timer.
- Quick note entry and task switching.
- Direct access back to the main workspace.
- A small overlay launch button in the main app for quick access.

## Documentation

- [User guide](USER_GUIDE.md)
- [Future improvements](FUTURE_IMPROVEMENTS.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Private backup guide](BACKUP.md)
- [AI sidecar guide](docs/ai-sidecar.md)
- [Theme implementation guide](docs/theme-implementation-guide.md)
- [Linux packaging](docs/linux-packaging.md)
- [macOS packaging](docs/macos-packaging.md)
