import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAiSidecar, type AiSidecarHandle } from "../main/aiSidecar";
import { DEFAULT_OLLAMA_MODEL, validateGeneratedRecapOutput, validateImprovedNoteOutput } from "../shared/ai";

// Explicit opt-in: never require a model download or running Ollama for normal tests.
describe.skipIf(process.env.REAM_AI_LIVE !== "1")("live local AI sidecar", () => {
  let sidecar: AiSidecarHandle;
  const model = process.env.REAM_AI_TEST_MODEL || DEFAULT_OLLAMA_MODEL;
  beforeAll(async () => { sidecar = await startAiSidecar(0); });
  afterAll(async () => { await sidecar?.close(); });

  it("finds the configured installed model", async () => {
    const response = await fetch(`${sidecar.url}/ai/health?model=${encodeURIComponent(model)}`);
    expect(await response.json()).toMatchObject({ ollama: { ok: true }, modelAvailable: true });
  });

  it("improves a synthetic note through Ollama with validated output", async () => {
    const response = await fetch(`${sidecar.url}/ai/improve-note`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, taskTitle: "Backup QA", noteText: "checked backup export. next: review the draft tomorrow.", projectName: "Synthetic test", tags: [] })
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(validateImprovedNoteOutput(body).clean_note.length).toBeGreaterThan(0);
    expect(response.headers.get("x-ream-ai-model")).toBeTruthy();
  }, 180_000);

  it("generates a journal recap through Ollama with validated output", async () => {
    const response = await fetch(`${sidecar.url}/ai/recap`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, sourceLabel: "Synthetic QA day", sourceStartDateKey: "2026-09-15", sourceEndDateKey: "2026-09-15", entries: [], journalPages: [{ dateKey: "2026-09-15", markdown: "Finished checking the backup export. Next: review the draft tomorrow." }] })
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(validateGeneratedRecapOutput(body).summary.length).toBeGreaterThan(0);
  }, 180_000);
});
