# Future Improvements

This tracks known gaps and planned work that isn't reflected in the shipped app yet. It should be kept current as items ship or priorities change.

## Architecture

- **Split `MainView.tsx` (~1700 lines) and `OverlayView.tsx` (~1000 lines)** into focused components and hooks. Both are currently large, mostly-flat components; this is an accepted near-term risk, not an oversight, but it should not grow further without a decomposition pass.
- **Replace overlay/main window sync polling with an event-based refresh.** The two windows currently sync by polling rather than reacting to repository writes, so a write in one window isn't always instantly reflected in the other.
- **Evaluate a SQLite-backed main-process store** if IndexedDB backup/restore proves unreliable at scale. Not needed today — the repository interface was designed so this could happen without changing call sites.

## Testing

- **Add Electron/UI smoke coverage that drives real window behavior**: overlay show/hide via the global shortcut and tray, main↔overlay handoff, and the stop-timer confirmation flow. Today's smoke test (`src/test/smokeWorkflow.test.ts`) only exercises shared repository/reporting logic in memory — no test actually opens a `BrowserWindow`.

## Data & backup

- **Harden import validation** against malformed or partially-corrupted backup files before they reach `importReamData` — today a bad file can wholesale-replace local data with only basic shape checks.
- **Consider a non-destructive import path** (merge or "import as new" rather than always replacing all local data), now that manual time-entry create/edit/delete exists and users have more reason to combine data from two machines.

## Sync

- **Optional GitHub token-based sync**, as a successor to today's manual "export JSON → commit to a private repo" flow. Must stay opt-in, use least-privilege token storage, and never expose the token to broad renderer code — local-only use must keep working exactly as it does today.

## UI polish (found during this audit, not yet tracked elsewhere)

- The overlay's task-search box shows a decorative `⌘K` badge with no keyboard handler behind it — either wire the shortcut or remove the badge.
- The Timesheet view's "…" (Timesheet actions) button has no click handler — either implement it or remove it.
- The overlay can be un-pinned via IPC (`window:set-overlay-pinned`), but there's no UI control that calls it — decide whether pin/unpin should be user-facing and add a toggle, or remove the dead code path.
- `listTimeEntriesForTask` exists in `timerRepository.ts` and is covered by tests, but nothing in the UI calls it yet — likely intended to back a per-task history view.

## Theming

- Add a reduced-motion and high-contrast pass across all six themes if theming graduates from its original spike scope into an actively-maintained feature.
- Decide whether the overlay should adopt the main workspace's theme tokens, or remain intentionally neutral (still an open decision from the original theme spike).

## Packaging & release

- Automate signed/notarized macOS builds and Linux artifact builds in CI, rather than the current manual release-audit process (`docs/release-audit.md`).
- Pursue upstream distribution (plain `brew install ream` without a custom tap; Debian/Ubuntu package indexes without a custom APT source) once the project has a track record of stable public releases.
