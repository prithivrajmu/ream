# Ream

A local-first task time tracker for tracking tasks, notes, time entries, and projects.

## Goal

Build a clean personal tracker that lets you:

- Start and stop timers for tasks.
- Add notes against each task or time entry.
- Review daily and weekly totals.
- Edit entries when time is logged manually or corrected later.
- Save all data locally by default.
- Optionally back up or sync the project data through a private GitHub repo.
- Use a small always-on-top overlay window while in Zoom, browser, code editor,
  or any other app.

## Distribution

Ream produces desktop artifacts with Electron Builder.

```bash
npm run dist:linux
npm run dist:mac:unsigned
```

Linux outputs AppImage, Debian, and tarball artifacts in `release/`. macOS
distribution should be built, signed, and notarized on a macOS machine; see
[macOS packaging](docs/macos-packaging.md) and [Linux packaging](docs/linux-packaging.md).

## Product Scope

### Core Workflows

1. Create a task with a name, optional project/client, tags, and notes.
2. Start a timer on a task.
3. Stop the timer and save the resulting time entry.
4. Add notes during or after the work session.
5. Manually add or edit a time entry.
6. Browse entries by day, week, task, project, or tag.
7. Export data as JSON and CSV.
8. Open a compact overlay to start/stop tasks and capture notes without
   switching back to the full app.

### Initial Screens

- Today: active timer, quick task picker, today's entries, notes.
- Tasks: searchable task list with project/tag filters.
- Reports: daily and weekly totals with CSV export.
- Settings: local backup/export and optional GitHub sync setup notes.
- Overlay: compact always-on-top timer, task switcher, note input, and quick
  open button for the full app.

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
- [AI sidecar guide](docs/ai-sidecar.md)
- [Private backup guide](BACKUP.md)

## Open Decisions

- App name shown in UI: `Ream`.
- GitHub sync: manual export first, token-based sync later if needed.
- Packaging: local dev first; desktop installers can come later.
- Time model: one running timer at a time for simplicity.
- Overlay: always-on-top by default with a user-controlled pin/unpin toggle.
