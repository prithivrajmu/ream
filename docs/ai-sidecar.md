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

## Meaning-quality probes

Run `npm run test:ai:quality` with Ollama and an installed model. This separate, opt-in command sends nine synthetic fixtures through 17 note/recap cases. It never loads workspace data or downloads models. `REAM_AI_TEST_MODEL` selects an installed model; every case logs its output, requested/served model, fallback identity, duration, and failures. A failed case exits nonzero. Preflight fails when Ollama or an eligible model is absent; a transport failure stops further requests. Requests have a two-minute probe limit and the suite has an eight-minute request budget (production inference may continue until its own timeout).

The `meaning-v1` corpus covers completed/planned/mixed work, explicit follow-ups, current/resolved blockers, cancellation/negation, uncertainty, and recorded time without task completion. Normal `npm test` runs 58 offline evaluator checks, not model inference. These verify faithful paraphrases and unchanged sources against known bad mutations, including contradictions and invented tasks/blockers.

These are bounded, fixture-specific regex probes, not a general semantic validator or an accuracy percentage. A missing-match failure can be a faithful paraphrase outside the matcher vocabulary; a passing output can still invent an untested fact. Summaries are deliberately checked for each fixture's key statuses and timing, so omission can also fail without being a status inversion. Inspect the actual output. Never use this evaluator to filter production text or automatically accept a suggestion.

### Baseline — 2026-09-18

With the original prompts, installed `llama3.2:3b` completed all 17 requests in approximately 33 seconds: **1 passed, 16 failed** (only resolved-blocker recap passed). No fallback appeared in the failed-case diagnostics. Both default and fallback models were available. Expectations were frozen before this run.

Confirmed problems included completed export checks and bundle signing becoming todos; inventing "Obtain missing credentials" despite no decided action; turning a tentative investigation into a task; and losing the completed export check in the mixed-status regression. The recorded-time case returned "No summary available" despite a substantive note. Schema-valid JSON did not prevent these errors.

Matcher limitations were also visible: "Backup export check completed" preserves completion but falls outside the completed-export pattern; "considering investigating the cache" is tentative but outside that pattern. The former note additionally invented that the export was functioning correctly, which the status checks do not detect. These limitations remain explicit rather than changing expectations to improve a model's score.

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
