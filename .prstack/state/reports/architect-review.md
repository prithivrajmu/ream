# Architect Review

## Date

2026-06-25

## Status

- Project: timesheet-tracker
- Open backlog items: 6
- Electron main process owns windows, tray, menu, and shortcuts
- React renderer owns task, timer, review, overlay UI
- Shared TypeScript modules own domain logic, Dexie repositories, reporting, and export/import

## Decisions

- IndexedDB via Dexie is the first local store
- One active timer at a time keeps the workflow simple
- Main window and overlay share repositories rather than duplicating timer state
- Manual JSON/CSV export comes before GitHub API sync

## Risks

- Renderer file has grown into a large component and should be split before adding more UI
- IndexedDB import replaces local data wholesale and needs clearer restore semantics
- Overlay/main synchronization uses polling and may need event-based updates later

## Next Architecture Work

- Split renderer into focused components and hooks
- Add stronger import validation and migration handling
- Introduce event-based cross-window refresh after repository writes
