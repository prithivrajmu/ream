# Timesheet Tracker

A simple local-first timesheet app for tracking tasks, time entries, and notes.

## Goal

Build a clean personal tracker that lets you:

- Start and stop timers for tasks.
- Add notes against each task or time entry.
- Review daily and weekly totals.
- Edit entries when time is logged manually or corrected later.
- Save all data locally by default.
- Optionally back up or sync the project data through a private GitHub repo.

## Product Scope

### Core Workflows

1. Create a task with a name, optional project/client, tags, and notes.
2. Start a timer on a task.
3. Stop the timer and save the resulting time entry.
4. Add notes during or after the work session.
5. Manually add or edit a time entry.
6. Browse entries by day, week, task, project, or tag.
7. Export data as JSON and CSV.

### Initial Screens

- Today: active timer, quick task picker, today's entries, notes.
- Tasks: searchable task list with project/tag filters.
- Reports: daily and weekly totals with CSV export.
- Settings: local backup/export and optional GitHub sync setup notes.

## Architecture

### Recommended Stack

- Frontend: React + Vite + TypeScript
- Styling: CSS modules or plain CSS with a small design token file
- Local data: IndexedDB via Dexie
- State: React hooks plus a small app store if needed
- Tests: Vitest for core logic, Playwright for one smoke flow once UI exists

This keeps the app fast, offline-friendly, and easy to deploy as static files later.

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

Recommended backup files:

- `timesheet-export.json`
- `timesheet-export.csv`

### GitHub Backup Strategy

For the first version, keep GitHub sync manual:

1. Export JSON from the app.
2. Save the export into a private repo folder such as `backups/`.
3. Commit and push.

Later, add a GitHub integration using a personal access token or OAuth device
flow. That should be optional because local-only use must remain private and
fully functional.

## Build Plan

### Phase 1: Project Foundation

- Create Vite React TypeScript app.
- Add lint/build/test scripts.
- Establish basic layout, typography, and color tokens.
- Set up IndexedDB schema and typed repository functions.

### Phase 2: Timer And Entries

- Implement task creation.
- Implement one active timer at a time.
- Persist active timer state.
- Save completed time entries.
- Add manual entry create/edit/delete.

### Phase 3: Notes And Review

- Add notes to tasks and entries.
- Build Today view.
- Build weekly summary and task totals.
- Add CSV and JSON export.

### Phase 4: Private Backup Path

- Add JSON import.
- Add backup instructions inside Settings.
- Optionally add a local `backups/` directory convention for git-tracked exports.

### Phase 5: Polish

- Keyboard-friendly controls.
- Empty states.
- Validation and conflict handling.
- Playwright smoke test for create task, start timer, stop timer, export.

## Open Decisions

- App name shown in UI: `Timesheet Tracker` for now.
- GitHub sync: manual export first, token-based sync later if needed.
- Hosting: local dev first; static deployment is possible later.
- Time model: one running timer at a time for simplicity.

