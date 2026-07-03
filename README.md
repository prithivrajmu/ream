# Ream

Ream is a local-first desktop workspace for tracking tasks, notes, time entries, projects, and review history. It ships with a full main window, a compact overlay, and optional local AI note cleanup.

## Install

### macOS with Homebrew

Ream is distributed through a Homebrew tap:

```bash
brew tap prithivrajmu/ream
brew install ream
```

This installs the macOS app bundle and exposes a `ream` launcher command.

### Linux with APT

Add the Ream APT source once, then install the Debian package:

```bash
curl -fsSL https://prithivrajmu.github.io/ream/apt/setup.sh | sudo bash
sudo apt install ream
```

### Run from source with Node.js

Use this path if you want to review the code, test unreleased changes, or contribute:

```bash
git clone https://github.com/prithivrajmu/ream.git
cd ream
npm install
npm run dev
```

## What Ships Today

- Track work against named tasks with projects and tags.
- Start, stop, and correct timers from the main workspace.
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

## Architecture

### Recommended Stack

- Desktop shell: Electron + Vite
- Frontend: React + TypeScript
- Styling: CSS modules or plain CSS with a small design token file
- Local data: IndexedDB via Dexie
- State: React hooks plus a small app store if needed
- Tests: Vitest for core logic, Playwright for one smoke flow once UI exists

Electron is recommended because the overlay needs native window controls such
as always-on-top, frameless/compact mode, global visibility, and tray/menu
integration. The React app can still be built with web primitives, but it should
run inside a desktop shell instead of relying only on a browser tab.

### Window Model

Use two app windows:

- Main window: full Ream workspace for tasks, reports, settings, export/import,
  and editing historical entries.
- Overlay window: small always-on-top utility window for current task, elapsed
  time, start/stop, pause/resume if added later, task switching, and quick notes.

Overlay behavior:

- Always on top by default, with a visible pin/unpin control.
- Resizable between compact and expanded note-taking states.
- Minimal chrome so it does not distract during calls or coding.
- Quick task search or recent-task dropdown.
- One-line note capture with expand-to-textarea.
- Keyboard shortcut support later for show/hide and start/stop.
- Stores notes immediately, even if the timer is still running.

Suggested Electron implementation:

- `main` process owns app windows and tray/menu controls.
- `preload` exposes a narrow typed API for window controls and storage events.
- `renderer` contains React views for both main and overlay routes.
- Use IPC only for desktop-specific operations; keep business logic in shared
  TypeScript modules.

### Data Model

```text
Task
- id
- title
- project
- tags
- defaultNote
- archived
- createdAt
- updatedAt

TimeEntry
- id
- taskId
- startedAt
- endedAt
- durationSeconds
- note
- createdAt
- updatedAt

Note
- id
- taskId
- timeEntryId
- body
- createdAt
- updatedAt
```

Notes can live directly on time entries for the first version. A separate `Note`
table is only needed if notes become richer or independent from entries.

### Local Save Strategy

Use IndexedDB as the primary database. Add JSON export/import early so the data
is portable even before GitHub sync exists.

For Electron, IndexedDB is acceptable for the first version because it keeps the
data model simple and local. If the app later needs stronger backup guarantees,
move storage to SQLite in the Electron main process while preserving the same
repository interface.

Ream can also point Electron's user data directory at a user-selected folder
from Settings. When changed, Ream copies the current local data to the selected
folder and relaunches against that location.

Recommended backup files:

- `ream-export.json`
- `ream-export.csv`

### GitHub Backup Strategy

For the first version, keep GitHub sync manual:

1. Export JSON from the app.
2. Save the export into a private repo folder such as `backups/`.
3. Commit and push.

Later, add a GitHub integration using a personal access token or OAuth device
flow. That should be optional because local-only use must remain private and
fully functional.

## Documentation

- [Task roadmap](TASKS.md)
- [Private backup guide](BACKUP.md)
- [AI sidecar guide](docs/ai-sidecar.md)
- [Theme implementation guide](docs/theme-implementation-guide.md)
- [Linux packaging](docs/linux-packaging.md)
- [macOS packaging](docs/macos-packaging.md)

## Open Decisions

- App name shown in UI: `Ream`.
- GitHub sync: manual export first, token-based sync later if needed.
- Packaging: local dev first; desktop installers can come later.
- Time model: one running timer at a time for simplicity.
- Overlay: always-on-top by default with a user-controlled pin/unpin toggle.
