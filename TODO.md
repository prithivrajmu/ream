# Usability and reliability fixes

Work through each pass, reproduce the problem, implement the fix, and verify it before checking it off.

## 1. Saving reliability — implemented; regression checks passing

- [x] Preserve timer notes while background refreshes run.
- [x] Keep journal edits attached to the correct date during rapid navigation.
- [x] Serialize autosaves; keep newer edits and recovery drafts when an older save completes.
- [x] Save pending notes when switching between the workspace and overlay (flush plus immediate recovery drafts).
- [x] Prevent concurrent timer operations from duplicating entries or reviving stopped timers.
- [x] Preserve paused durations and timestamp precision when editing an entry's note.
- [x] Add regression coverage for these data-loss and concurrency cases.
- [x] Replace three-second polling with database change subscriptions in both windows.

## 2. Navigation and working controls

- [x] Keep the sidebar visible until explicitly hidden.
- [x] Make the active timer accessible across workspace sections, including pause/resume.
- [x] Support previous/next navigation for day, week, and month insights.
- [x] Replace the empty timesheet actions control with a working CSV export (selected week; desktop save dialog verified).
- [x] Fix project rename with an in-app editor.
- [x] Search entries by task, project, tags, and note; make tasks easier to find and start.
- [x] Create tasks directly from quick capture, with no intermediate dialog.
- [x] Wire the overlay task-search keyboard shortcut (Cmd/Ctrl+K; verified from default and Mini modes).
- [x] Make Skip setup actually open the workspace; remove the misleading multi-step progress display.
- [x] Preserve the current workspace section on reload and support back/forward navigation.
- [x] Replace the unsupported link prompt in the Markdown editor.
- [x] Honor the Mini/Tiny preference (fixed conflicting window-mode events; Mini verified natively).
- [x] Show automatic overlays without activating them or minimizing the workspace (main-process behavior updated; explicit Show overlay still activates).

## 3. UI and verification

- [x] Show validation failures inside the editor that needs attention.
- [x] Prevent accidental dismissal and duplicate submissions of editing forms.
- [x] Check the main workflows in a running app using isolated test data.
- [x] Check responsive layout and dark-studio, old-money, retro-console, and color-blind themes.
- [x] Run lint, typecheck, tests, and production build; record the results here.

## 4. Backup restore and local AI reliability

- [x] Verify backup import/restore while notes have pending edits, including cancellation, failed-save recovery, and transactional rollback.
- [x] Prevent queued journal saves and old recovery drafts from overwriting imported data (workspace restore revision; schema version 8).
- [x] Reject restore while a timer is running or paused; clarify backup contents and destructive replacement.
- [x] Validate missing project arrays and duplicate records before replacing any data; read exports as an atomic snapshot.
- [x] Exercise the local sidecar and installed Ollama model for note improvement and journal recaps; add opt-in repeatable live tests.
- [x] Flush pending journal edits before reading recap source data, guard duplicate requests, and reject recap results from before a restore.
- [x] Make journal-page creation and recap saving one transaction; test concurrent creation and failed-write rollback.
- [x] Verify native JSON import, restored journal persistence after reload, and recap generation/saving using isolated synthetic data.

## 5. Simultaneous note edits

- [x] Check the last observed note inside the write transaction; divergent edits cannot silently overwrite each other.
- [x] Keep main and overlay recovery drafts separate, with the original saved text retained as their comparison baseline.
- [x] Show both versions with explicit keep-both/use-saved/save-mine controls in timer, journal, and overlay editors.
- [x] Recheck the saved note during conflict resolution; pause automatic retries until the user chooses a resolution.
- [x] Test separate database connections, identical edits, empty notes, reload recovery, legacy drafts, and typing during a save.
- [x] Inspect the conflict component in all four required themes and at a 360-pixel width; add a reusable synthetic UI fixture.

## 6. Recovery after a timer ends

- [x] Surface retained drafts in Settings → Recover unsaved notes, including stopped timers, older workspaces, and legacy recovery records.
- [x] Show a dismissible reminder for retained timer drafts; exclude the currently active session from that reminder.
- [x] Search by note text or date, inspect the original saved version, copy draft text, and download Markdown without modifying saved entries or deleting recovery copies.
- [x] Refresh draft discovery on same-window writes, cross-window storage events, and focus without polling.
- [x] Test late edits after a stop in another connection, malformed records, empty edits, subscription cleanup, and unavailable storage.
- [x] Verify copy, search, exact downloaded Markdown contents, all required themes, and a narrow layout with synthetic data.

## 7. Completed-entry and AI apply conflicts

- [x] Compare the full entry snapshot inside the write transaction; retain edits and show both versions when another window changes the entry.
- [x] Recheck explicit conflict resolutions and reject saves from before a workspace restore or after entry deletion.
- [x] Apply AI suggestions only to unchanged source notes (or identical already-applied output), preserving current task, projects, times, and paused duration.
- [x] Commit the completed note and AI acceptance record together; reject delayed completed-entry AI results from before a restore.
- [x] Add concurrency, rollback, and UI regression coverage; verify the required themes and run the full gate.

## Next iteration — remaining checks and limitations

- [ ] Extend AI source-note checks and atomic acceptance to the live overlay; it still uses the separate autosave/status path and stores suggestions against the shared `active` ID.
- [ ] Add AI quality evaluations for completed versus planned work: one live suggestion incorrectly turned a completed export check into a future task. Native Reject preserved the original note; keep explicit review before applying suggestions.
- [ ] Expand native focus testing across app switching, minimizing, and multiple displays; the passive-overlay change is implemented, but the full matrix is not verified.
- [ ] Automate the native smoke checks currently performed manually, including verifying exported CSV contents on disk (the desktop save dialog and existing CSV tests were checked).

## Findings

- Main timer notes were overwritten by a three-second refresh, even during typing.
- Journal loading and autosaving ran as separate effects; a date change could schedule old text against the new date.
- Overlay autosave cleared dirty state and recovery drafts without checking for newer typing.
- All active sessions share the ID `active`, so that ID alone cannot identify a note's session.
- Timer read/modify/write operations were not fully transactional.
- Project rename uses `window.prompt`, which is unsupported in Electron renderers.
- Day/month insight navigation is disabled; the timesheet actions button has no handler.

## Verification log

- Initial baseline: existing test suite and TypeScript check run before changes.
- Saving regression pass: 23 tests passed across autosave, timer, and journal repositories.
- Full suite after the first two implementation passes: 87 tests passed; TypeScript passed; lint reported no errors.
- Live preview (separate localhost data): setup skip, task creation with starting note, timer-note navigation, pause, project creation/rename, and immediate journal date switching passed.
- Visual inspection found a Stop-button contrast issue and unthemed journal surfaces; both corrected and the four required themes inspected.
- Native Electron verification: optional setup, direct quick capture, timer start/pause, note handoff in both directions, day/month navigation, weekly-export save dialog, inline form validation, and cancelling a discard prompt passed.
- Paused-entry note edit retained the exact tracked duration (1:21) in the running preview.
- Old-money, dark-studio, retro-console, and color-blind journal/timer surfaces visually inspected; contrast corrections applied.
- Narrow-layout checks found a fixed-width overflow and collapsed journal history; corrected and rechecked at both responsive breakpoints with browser zoom. Navigation becomes a compact horizontal strip at the narrowest breakpoint.
- Native overlay shortcut, Mini mode, sidebar hide/reveal, and workspace reload passed. Browser back/forward restored the matching workspace sections.
- Selected journal text was linked through the in-app URL editor and persisted successfully.
- Final code gate: 88 tests in 21 files passed; TypeScript and production build passed; lint has no errors (four existing warnings remain).
- Native smoke tests used `npm run preview:isolated`, which creates temporary app data rather than opening the user's real workspace.
- Restore/AI pass: 101 normal tests passed (22 files); three opt-in live AI tests passed separately against local `llama3.2:3b`. TypeScript and production build passed; lint has no errors and the same four existing warnings.
- Restore regressions cover cancellation, pending-save failure/retry, failed transaction rollback, stale writes from a second database connection, active/paused timer protection, malformed imports, and upgrading schema version 7 to 8.
- Native synthetic restore showed the replacement confirmation and success message; imported journal text survived reload. A `/recap @09-16-2026` command generated and saved a local recap while preserving the handwritten journal.
- Native note-improvement preview displayed raw and suggested text separately; rejecting a meaning-changing suggestion and reloading retained the original note and tracked duration. Live automated tests verify transport and output contracts, not semantic accuracy.
- Conflict pass: 113 normal tests passed in 24 files; three live-model checks are intentionally skipped in the normal suite. TypeScript, production build, and whitespace checks passed; lint reports zero errors and the same four existing warnings.
- Separate database connections verified concurrent-note rejection, all three resolution choices, another write during review, identical writes, intentional empty notes, independent recovery drafts, and baseline recovery after an interrupted save. The conflict notice was visually checked in dark-studio, old-money, retro-console, color-blind, and a 360-pixel frame using `scripts/ui/note-conflicts.html` (synthetic data only, no workspace access).
- Recovery pass: 120 normal tests passed in 25 files (three opt-in live-model tests skipped). TypeScript, production build, and whitespace checks passed; lint has zero errors and the same four existing warnings.
- `scripts/ui/note-recovery.html` verified copy feedback, date search including an intentionally empty draft, all four themes, and a 360-pixel layout. A downloaded Markdown file was checked on disk and exactly matched the synthetic draft. Recovery never rewrote the saved entry or removed the retained text in the stopped-timer regression.
- A freshly launched isolated Electron workspace confirmed that the recovery panel is reachable in Settings, with a readable empty state and keyboard focus styling. The retained-draft reminder opens Settings and focuses the recovery search rather than leaving the user at the top of the page.
- Completed-entry pass: 140 normal tests passed across 27 files (three opt-in live-model checks skipped). TypeScript, production build, and whitespace checks passed; lint reports no errors and the same four existing warnings.
- Separate database connections cover concurrent manual edits, task/project/time/duration changes with identical write timestamps, repeated conflict review, empty notes, deletion, restore, manual saves racing AI acceptance, and rollback if recording acceptance fails. AI application preserves the latest entry metadata and exact tracked duration.
- `scripts/ui/entry-conflicts.html` visually verified both new notices in dark-studio, old-money, retro-console, color-blind, and a 360-pixel frame; the real dialog component and both explicit choice callbacks were exercised using synthetic props. Database race behavior is covered by repository tests, not a native multi-window UI automation test.
