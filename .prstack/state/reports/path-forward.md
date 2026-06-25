# Path Forward

## Review Result

- prstack QA: pass.
- Aggregate review: pass.
- No automated build/test findings.

## Main Risks From Reviews

1. `src/renderer/App.tsx` is too large and will slow down future changes.
2. JSON import currently trusts the backup structure too much and replaces local data wholesale.
3. There is no lint/format gate.
4. The overlay has no automated Electron UI smoke coverage.
5. macOS packaging/signing is not configured.

## Recommended Sequence

1. Stabilization slice: split renderer, harden import, add lint.
2. Product workflow slice: manual time entries and edit/delete completed entries.
3. Desktop confidence slice: Electron UI smoke coverage and event-based cross-window refresh.
4. Distribution slice: macOS packaging, signing/notarization notes, private GitHub remote setup.

## Immediate Next Slice

Start with the stabilization slice. It reduces code risk before adding manual entry editing, which will otherwise make the current renderer file harder to manage.
