# AI Sidecar

Ream uses a local HTTP sidecar for AI note improvement. The renderer never talks to Ollama directly.

## What It Does

- Sends task note text, task title, project context, and tags to the sidecar.
- The sidecar calls Ollama at `http://localhost:11434/api/chat`.
- The sidecar validates that the model returns JSON with this shape:

```json
{
  "clean_note": "string",
  "summary": "string",
  "next_steps": ["string"],
  "blockers": ["string"],
  "tags": ["string"]
}
```

- The raw note is preserved. The AI suggestion is stored separately.
- A user must explicitly accept the suggestion before any note replacement happens.
- For completed entries, acceptance compares the currently saved note with the original source and commits the note and acceptance record atomically. If the note changed, copy the suggestion for a manual merge or regenerate it from the current note. Task, projects, time range, and tracked duration are preserved. Results from before a workspace restore cannot be applied.
- Live-overlay suggestions are scoped to the timer's start timestamp and workspace restore revision. Acceptance flushes pending local edits, checks both local and saved source text, then atomically updates the timer note and acceptance record. Stopping/restarting a timer or restoring a workspace invalidates older results. Paused time is preserved; failed acceptance never retries the rewrite as an ordinary autosave. New typing during acceptance remains a recoverable local edit.
- Stale live previews remain visible for copying or regeneration, with Accept disabled. Legacy suggestions stored against the shared `active` ID remain in history, but are not offered for new timer sessions.
- The UI shows request duration and the final outcome in the AI Stats section.

## Endpoints

- `GET /ai/health`
- `POST /ai/improve-note`
- `POST /ai/recap`

## Default Models

- Default: `llama3.2:3b`
- Fallback: `llama3.2:1b`

The fallback is used when the primary model fails for the default configuration path.

## Live verification

With Ollama running and the default model already installed, run `npm run test:ai:live`. It starts a separate sidecar on a free local port and verifies model discovery, note improvement, and journal recap output using synthetic data. It does not download models or access your workspace. Set `REAM_AI_TEST_MODEL` to test a different installed model. These three checks are skipped by the normal test suite, which must work without Ollama.

## Suggested Environment Variables

- `REAM_AI_SIDECAR_PORT`: override the local sidecar port.
- `REAM_OLLAMA_MODEL`: override the primary Ollama model.
- `REAM_OLLAMA_FALLBACK_MODEL`: override the fallback model.
- `REAM_OLLAMA_CHAT_URL`: override the Ollama chat URL.
- `REAM_OLLAMA_HEALTH_URL`: override the Ollama health URL.

## Data Stored

AI suggestions are persisted in `note_ai_suggestions` with:

- `noteId`
- `model`
- `inputText`
- `outputJson`
- `status`
- `durationMs`
- `createdAt`
- `statusUpdatedAt`
- `acceptedAt`

## Operational Notes

- Ream works without Ollama running.
- If Ollama is unavailable, the user sees a non-crashing error.
- The sidecar returns JSON only.
- The same sidecar pattern can be reused later for transcription or other local AI jobs.
