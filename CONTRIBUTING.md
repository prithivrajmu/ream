# Contributing to Ream

Thanks for your interest in Ream. This is a small, local-first Electron app, and the project favors simple, well-tested changes over large refactors.

## Getting set up

```bash
git clone https://github.com/prithivrajmu/ream.git
cd ream
npm install
npm run dev
```

See [CLAUDE.md](CLAUDE.md) for a fuller architecture overview (process model, data layer, overlay window behavior, theming) before making non-trivial changes.

## Before opening a PR

Run the full local gate:

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

- Run a single test file with `npx vitest run src/test/<file>.test.ts`, or a single test by name with `npx vitest run -t "<name substring>"`.
- Repository-layer changes (`src/shared/*Repository.ts`) should have Vitest coverage using `fake-indexeddb`, following the existing pattern in `src/test/`.
- UI changes must respect the existing CSS custom-property theme tokens (see [docs/theme-implementation-guide.md](docs/theme-implementation-guide.md)) — check `dark-studio`, `old-money`, `retro-console`, and `color-blind` before submitting.
- Do not weaken `contextIsolation`/`nodeIntegration` settings or widen the preload API without a clear security rationale.

## Scope guidance

- Prefer fixing the specific bug or adding the specific feature requested over incidental refactors. `MainView.tsx` and `OverlayView.tsx` are known to be large — see [FUTURE_IMPROVEMENTS.md](FUTURE_IMPROVEMENTS.md) for the planned decomposition; please raise an issue before starting that work so it isn't done twice.
- If your change affects local data (schema, export/import format), add a new Dexie schema version with an `.upgrade()` step rather than editing an existing version — existing user data must keep migrating forward.

## Reporting bugs / proposing features

Open a [GitHub issue](https://github.com/prithivrajmu/ream/issues). For security-sensitive reports, use [SECURITY.md](SECURITY.md) instead of a public issue.
