# Current Slice: Stabilize Desktop Tracker

## Objective

Turn the working Electron prototype into a maintainable app foundation before adding more user-facing workflow.

## Scope

1. Split `src/renderer/App.tsx` into focused components/hooks while preserving behavior.
2. Harden JSON import validation and make restore semantics explicit.
3. Add lint/format tooling and wire it into the prstack QA command.

## Acceptance

- Existing task, timer, overlay, review, export, and import behavior remains intact.
- `npm run typecheck`, `npm test`, `npm run build`, and the new lint gate pass.
- prstack QA and aggregate review pass.

## Deferred

- Manual entry editing.
- Electron UI automation.
- macOS packaging.
