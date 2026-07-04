# Ream Pet Sidecar

Godot 4.7 project for the desktop pet sidecar. It uses the shar-pei state sheet as the first production asset and animates each app state with lightweight procedural motion.

Run locally:

```sh
godot --path godot/pet-sidecar
```

Run with a contract file:

```sh
godot --path godot/pet-sidecar -- --ream-pet-contract=/tmp/ream-pet-contract.json
```

Contract shape:

```json
{
  "state": "idle",
  "movementPaused": false,
  "message": ""
}
```

Supported states:

- `timer-running`
- `timer-paused`
- `no-timer-today`
- `deep-focus`
- `task-completed`
- `idle`
- `break-time`
- `daily-goal-met`
