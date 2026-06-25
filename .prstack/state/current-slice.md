# Current Slice: Manual Entry Editing

## Objective

Make the tracker useful when time needs to be corrected or entered after the fact.

## Scope

1. Add manual time entry creation from the main window.
2. Add edit/delete controls for completed entries.
3. Preserve one-active-timer behavior and existing export/import behavior.

## Acceptance

- Manual entries appear in Today, daily totals, task totals, JSON export, and CSV export.
- Completed entries can be edited and deleted.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and prstack QA pass.

## Deferred

- Electron UI automation.
- Event-based cross-window refresh.
- macOS packaging.
