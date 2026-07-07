# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Ream is a local-first Electron desktop app for tracking tasks, time entries, notes, and projects. It ships a full main window plus a compact always-on-top overlay window, and an optional local Ollama-backed sidecar for AI note cleanup. All data is stored locally in IndexedDB (via Dexie) — there is no required backend service.

## Commands

```bash
npm run dev              # electron-vite dev (hot reload, main+preload+renderer)
npm run dev:linux        # dev with --no-sandbox (for Linux dev containers)
npm run build            # typecheck + electron-vite build
npm run typecheck        # tsc --noEmit
npm test                 # vitest run
npm run test:watch       # vitest watch mode
npm run lint             # eslint .
npm run pack             # build + electron-builder --dir (unpacked app)
npm run dist:mac         # build + electron-builder --mac --x64 --arm64 (signed)
npm run dist:mac:unsigned
npm run dist:linux       # AppImage, deb, tar.gz
npm run release:checksums
npm run release:homebrew
npm run release:apt
```

Run a single test file: `npx vitest run src/test/timerRepository.test.ts`
Run a single test by name: `npx vitest run -t "test name substring"`

The full local gate (mirrors CI expectations) is: `npm run lint && npm run typecheck && npm test && npm run build`.

## Architecture

### Process model

- `src/main/index.ts` — Electron main process. Owns both `BrowserWindow`s (main + overlay), tray, app menu, global shortcuts, the user-data-location logic (with legacy-folder migration), overlay position persistence, and all `ipcMain` handlers. This file is intentionally the only place with Node/OS access.
- `src/preload/index.ts` — the only bridge between renderer and main. Exposes a single narrow `desktopApi` object via `contextBridge` under both `window.reamDesktop` and `window.timesheetDesktop` (the latter is a legacy alias kept for compatibility). `contextIsolation` is on and `nodeIntegration` is off — do not weaken this.
- `src/renderer/` — the React app, loaded as a single Vite entry with two routes distinguished purely by URL hash (`#/overlay` vs everything else — see `getRoute()` in `App.tsx`). There is no router library.
- `src/shared/` — plain TypeScript with no Electron or DOM dependency, imported by both main and renderer. This is where all domain logic, repositories, and validation live so it can be unit tested with `fake-indexeddb` outside of Electron.

### Data layer

- `src/shared/domain.ts` defines the current entity shapes (Dexie tables mirror these 1:1):

  ```ts
  Task { id, title, projectIds[], tags[], defaultNote, archived, createdAt, updatedAt }
  Project { id, title, archived, createdAt, updatedAt }
  TimeEntry { id, taskId, startedAt, endedAt, durationSeconds, note, createdAt, updatedAt }
  ActiveTimer { id, taskId, startedAt, note, pausedAt, totalPausedSeconds, createdAt, updatedAt }
  NoteAiSuggestion { id, noteId, model, inputText, outputJson, status, durationMs, createdAt, statusUpdatedAt, acceptedAt }
  ```

  There is no separate `Note` entity — notes live directly on `TimeEntry.note` (completed sessions) and `ActiveTimer.note` (in-progress sessions); `Task.defaultNote` is a per-task starting-note template, not a note record.
- `src/shared/db.ts` defines the single Dexie database (`ReamDatabase`) and every schema migration as a numbered `.version(n).stores(...)`. When changing the schema, add a new version with an `.upgrade()` step rather than editing an existing version — existing user data must migrate forward.
- There is also a one-time migration path from a legacy database name (`timesheet-tracker`) and a legacy `userData` folder name, both handled defensively (skipped if the target already has data). Ream was renamed from "timesheet-tracker" at some point; that name still shows up in code and CI/tooling in a few places.
- Repositories (`taskRepository.ts`, `projectRepository.ts`, `timerRepository.ts`, `exportRepository.ts`, `aiSuggestionRepository.ts`) take a `ReamDatabase` instance as their first argument rather than importing the singleton `db` directly — this is what makes them testable against a fresh in-memory database per test (see `createTestDatabase()` pattern in `src/test/*.test.ts`).
- Only one active timer exists at a time (`activeTimers` table), by design.
- JSON export/import (`exportRepository.ts`) is the durable backup format; CSV (`reporting.ts`) is for reporting only, not round-tripping. Import replaces data wholesale — there is no merge semantics yet.

### AI sidecar

- `src/main/aiSidecar.ts` starts a local HTTP server that the renderer never talks to directly — the renderer calls `ai:improve-note` / `ai:ollama-status` over IPC, and the main process proxies to the sidecar, which in turn calls a local Ollama instance (`http://localhost:11434`). See `docs/ai-sidecar.md` for the full contract, endpoint list, and env var overrides.
- The sidecar enforces a strict JSON output shape (`validateImprovedNoteOutput` in `src/shared/ai.ts`); raw notes are never overwritten automatically — the user must explicitly accept a suggestion. Suggestions and their timing/status are persisted in `noteAiSuggestions` for the AI Stats UI.
- Ream must work with Ollama absent or unreachable — always fail into a non-crashing UI state, never throw uncaught.

### Overlay window behavior

The overlay is a frameless, transparent, always-on-top `BrowserWindow` with its own mode state machine (`default` / `expanded`, see `overlayMode` and `OverlayMode` in `src/shared/overlayBounds.ts`). Key behaviors implemented in `src/main/index.ts` worth knowing before touching window logic:

- Minimizing or blurring the main window auto-shows the overlay (`minimizeMainWindowToDrawer`); showing the main window destroys the overlay. These are coupled transitions, not independent toggles.
- Overlay position is persisted to disk (`ream-overlay-state.json` in `userData`) and restored on next show; expanding/collapsing recalculates bounds off a saved anchor rather than re-centering.
- Suppression flags (`suppressMainBlurOverlay`, `suppressMainMinimizeOverlay`) exist to prevent feedback loops when main-window state is changed programmatically (e.g. leaving fullscreen before minimizing) — if you add a new main-window transition, check whether it needs the same suppression treatment.
- Main/overlay windows currently sync via polling rather than an event bus; this is a known rough edge (see Architecture Risks below), so don't assume writes in one window are instantly reflected in the other without a refresh path.

### Theming

Multiple themes are supported (see `src/renderer/themeOptions.ts`) via CSS custom properties (`--theme-bg`, `--theme-panel`, `--theme-ink`, `--theme-accent`, etc. — full token list and mapping rules in `docs/theme-implementation-guide.md`). Any new UI surface must use these tokens instead of hard-coded colors, and should be checked against `dark-studio`, `old-money`, `retro-console`, and `color-blind` themes before shipping.

### Renderer structure

`src/renderer/views/MainView.tsx` (~1700 lines) and `OverlayView.tsx` (~1000 lines) are large, mostly-flat components — there is no component/hooks split yet. This is a known, accepted risk (see below), not an oversight; don't assume a decomposition is expected unless the task calls for it.

## Known architecture risks (from project tracking, not derivable from code alone)

- `MainView.tsx` has grown large and should eventually be split into components/hooks — be cautious about adding more inline logic to it.
- IndexedDB import replaces local data wholesale; restore semantics are intentionally minimal for now.
- Overlay/main window sync is polling-based, not event-based.
- There is no automated Electron/UI smoke test that drives real window behavior (e.g. overlay show/hide) — `src/test/smokeWorkflow.test.ts` only exercises the shared repository/reporting logic in-memory.

## Security posture

- This is a local-first app; JSON/CSV exports contain private notes, client names, and timestamps — treat exports as sensitive (see `BACKUP.md`).
- Keep `contextIsolation: true` and `nodeIntegration: false` on every `BrowserWindow`; the preload API must stay narrow and desktop-only.
- Any future GitHub token-based sync must use least-privilege, explicit token storage — do not wire broad renderer access to it. For now, GitHub backup is manual (export JSON → commit to a private repo).

## Testing conventions

- Tests live in `src/test/` and use Vitest with `fake-indexeddb/auto` imported at the top of any test touching Dexie.
- Repository tests create a fresh, uniquely-named `ReamDatabase` per test (`new ReamDatabase(`ream-test-${crypto.randomUUID()}`)`) and delete it in `afterEach`, rather than sharing state across tests.
- Prefer testing through the shared repository/use-case layer over UI-level testing, consistent with the current codebase.
