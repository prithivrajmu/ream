# Build Tasks

Each stage should leave the app in a runnable or verifiable state. After every stage, run the current test suite plus the new check added by that stage before moving on.

## Stage 1: Desktop App Foundation

Goal: create the Electron + Vite + React TypeScript skeleton with two routes ready for the main app and overlay.

Tasks:

- Add project package scripts for dev, build, typecheck, and test.
- Add Electron main process, preload bridge, and renderer entry.
- Create main window route and overlay route.
- Add basic app shell styling and design tokens.
- Add a smoke-level test for pure shared logic and make build/typecheck pass.

Done when:

- `npm run typecheck` passes.
- `npm test` passes.
- `npm run build` passes.

## Stage 2: Local Data And Task Basics

Goal: add the local-first data layer and basic task CRUD.

Tasks:

- Define Task, TimeEntry, and ActiveTimer types.
- Add IndexedDB/Dexie repository functions.
- Build task creation and task list UI.
- Add basic validation for task title and archived state.
- Add repository tests around task create/list/update.

Done when:

- Existing Stage 1 checks still pass.
- Task repository tests pass.
- App can create and display tasks locally.

## Stage 3: Timer And Entry Flow

Goal: support one active timer and completed time entries.

Tasks:

- Add start/stop timer use cases.
- Persist active timer state.
- Create completed TimeEntry records when stopping.
- Show active timer and today entries in the main window.
- Add tests for elapsed-time and start/stop behavior.

Done when:

- Previous tests still pass.
- Timer tests pass.
- Manual smoke run can start and stop a task.

## Stage 4: Overlay Window

Goal: make the always-on-top overlay useful during meetings, browsing, and coding.

Tasks:

- Create frameless always-on-top overlay window.
- Add compact overlay UI: task, elapsed time, start/stop, note input.
- Add expanded overlay state for longer notes.
- Add pin/unpin and open-main-window controls.
- Keep overlay and main window state synchronized.
- Add tests for shared timer/note logic and a build check for the overlay route.

Done when:

- Previous tests still pass.
- Overlay route builds.
- Manual smoke run shows the overlay above other windows.

## Stage 5: Notes, Review, And Export

Goal: make captured work useful for review and backup.

Tasks:

- Add notes to active and completed work sessions.
- Build daily and weekly summaries.
- Add JSON export/import.
- Add CSV export.
- Add tests for export formatting and summary totals.

Done when:

- Previous tests still pass.
- Export tests pass.
- Exported JSON can be imported back into a clean local database.

## Stage 6: Private GitHub Backup Path And Polish

Goal: make private backup practical and clean up the desktop experience.

Tasks:

- Add Settings guidance for backing up exports to a private GitHub repo.
- Add optional backups directory convention.
- Add global shortcut for show/hide overlay.
- Add tray/menu actions.
- Add final smoke test covering task, timer, note, and export.

Done when:

- All tests pass.
- Build passes.
- Manual smoke flow passes on the development machine.

## Stage 7: Local AI Sidecar

Goal: add a local Ollama-backed sidecar for note improvement and keep AI work isolated from the core app.

Tasks:

- Add a local HTTP sidecar for AI requests.
- Validate structured JSON responses before the renderer sees them.
- Improve task notes with a preview, accept/reject, and copy workflow.
- Record request duration and terminal status for AI Stats telemetry.
- Keep raw notes unchanged unless the user explicitly accepts the suggestion.
- Document the sidecar endpoints, model settings, and fallback behavior.

Done when:

- All tests pass.
- Build passes.
- Manual smoke flow can improve a note against a local Ollama instance.
