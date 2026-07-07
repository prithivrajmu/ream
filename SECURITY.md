# Security Policy

## Reporting a vulnerability

If you find a security issue in Ream, please open a private report via [GitHub Security Advisories](https://github.com/prithivrajmu/ream/security/advisories/new) rather than a public issue. Include reproduction steps and the affected version.

## Data handling

Ream is local-first: task, project, time entry, and note data is stored in an IndexedDB database on your machine. No core feature requires a remote service.

- **Exports are sensitive.** JSON and CSV exports can contain task names, notes, client/project labels, and timestamps. Treat them like any other private document — see [BACKUP.md](BACKUP.md) for a private-backup pattern.
- **Import replaces local data wholesale.** There is no merge semantics yet, so only import files you trust.
- **The optional AI sidecar is local-only.** Note text sent for AI improvement goes to a local HTTP sidecar process, which in turn calls a local Ollama instance (`http://localhost:11434`) — nothing is sent to a third-party or cloud service. See [docs/ai-sidecar.md](docs/ai-sidecar.md).

## Electron hardening

- `contextIsolation` is enabled and `nodeIntegration` is disabled on every `BrowserWindow`.
- The preload script (`src/preload/index.ts`) exposes a single narrow, desktop-only API — it is not a general-purpose Node bridge.
- Any future networked feature (e.g. GitHub token-based sync) must use least-privilege, explicit token storage and must not expose credentials to broad renderer code.

## Supported versions

Ream is pre-1.0 and does not yet have a formal release/support cadence. Security fixes land on `main`; there is no long-term-support branch at this stage.
