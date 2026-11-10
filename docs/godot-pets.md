# Godot Pets

Ream's desktop pet sidecar lives in `godot/pet-sidecar` and targets Godot 4.7.

## Local Setup

Install Godot:

```sh
brew install --cask godot
godot --version
```

Validate the project:

```sh
npm run godot:pet:check
```

Run the animated pet directly:

```sh
npm run godot:pet:run
```

## Runtime Contract

Electron exposes a Godot sidecar launcher through preload:

- `window.reamDesktop.startGodotPetSidecar(contract)`
- `window.reamDesktop.updateGodotPetContract(contract)`
- `window.reamDesktop.stopGodotPetSidecar()`
- `window.reamDesktop.getGodotPetStatus()`

The sidecar receives a JSON contract file path as:

```sh
godot --path godot/pet-sidecar -- --ream-pet-contract=/path/to/ream-pet-contract.json
```

Contract shape:

```json
{
  "state": "idle",
  "movementPaused": false,
  "message": "",
  "updatedAt": "2026-07-04T00:00:00.000Z"
}
```

## States

The first pet is a shar-pei puppy and supports every state from the reference sheet:

- `timer-running`: trot/bouncy alert motion
- `timer-paused`: puzzled idle sway
- `no-timer-today`: sleepy breathing
- `deep-focus`: low, steady sentinel motion
- `task-completed`: celebratory bounce
- `idle`: sniffing/curious sway
- `break-time`: relaxed stretch
- `daily-goal-met`: cozy breathing

The current React overlay pet remains as a fallback/prototype surface. The next slice should route the profile toggle to start the Godot sidecar and hide the React pet window when Godot reports `running: true`.
