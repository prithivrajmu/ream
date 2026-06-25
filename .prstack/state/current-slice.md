# Current Slice: macOS Distribution And Glass UI

## Objective

Prepare the app for macOS packaging and make the desktop UI feel light, clean, and native-adjacent.

## Scope

1. Add electron-builder packaging scripts and macOS config.
2. Document unsigned local builds and signed/notarized distribution.
3. Refresh the renderer styling toward a light macOS glass aesthetic without changing workflows.

## Acceptance

- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` pass.
- `npm run pack` can produce an unpacked local Electron app.
- macOS packaging docs explain unsigned and signed/notarized paths.

## Deferred

- Actual Apple Developer ID signing credentials.
- Notarization execution in CI.
- App icon design.
