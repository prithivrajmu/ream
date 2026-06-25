# Security Review

## Date

2026-06-25

## Overall Assessment

- Project: timesheet-tracker
- Local-first Electron desktop app storing private work data in IndexedDB
- No remote service is required for core use
- JSON exports can contain sensitive notes, client names, and timestamps

## Findings

- Backup exports must be treated as private data
- Renderer uses IndexedDB directly; future token-based GitHub sync must not expose tokens to broad renderer code
- Electron preload API should stay narrow and desktop-only

## Guidance

- Keep local-only mode fully functional
- Do not add GitHub token sync until there is explicit token storage and least-privilege API design
- Keep contextIsolation enabled and nodeIntegration disabled

## Next Security Work

- Harden import validation before accepting untrusted backup files
- Add packaging guidance for macOS signing/notarization before distribution
- Document private backup handling in app and repo docs
