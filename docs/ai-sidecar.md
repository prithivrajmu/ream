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
- The UI shows request duration and the final outcome in the Dev section.

## Endpoints

- `GET /ai/health`
- `POST /ai/improve-note`

## Default Models

- Default: `llama3.2:1b`
- Fallback: `llama3.2:3b`

The fallback is used when the primary model fails for the default configuration path.

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
