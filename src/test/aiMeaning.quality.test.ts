import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAiSidecar, type AiSidecarHandle } from "../main/aiSidecar";
import { DEFAULT_OLLAMA_MODEL } from "../shared/ai";
import { AI_MEANING_CASES, AI_MEANING_CORPUS_VERSION, recapRequest } from "./fixtures/aiMeaningCorpus";
import { evaluateAiMeaning, type MeaningPath } from "./fixtures/evaluateAiMeaning";

// Separately opt-in: these probes make local model requests, never touch workspace data.
describe.skipIf(process.env.REAM_AI_QUALITY !== "1")("local AI meaning quality", () => {
  let sidecar: AiSidecarHandle;
  let transportFailure: string | undefined;
  let deadline: number;
  const model = process.env.REAM_AI_TEST_MODEL || DEFAULT_OLLAMA_MODEL;
  beforeAll(async () => {
    sidecar = await startAiSidecar(0);
    const response = await fetch(`${sidecar.url}/ai/health?model=${encodeURIComponent(model)}`, { signal: AbortSignal.timeout(5_000) });
    const health = await response.json();
    console.info(JSON.stringify({ corpus: AI_MEANING_CORPUS_VERSION, preflight: health }));
    expect(health.ollama?.ok, "Ollama is unavailable; no models will be downloaded").toBe(true);
    expect(health.modelAvailable || (model === DEFAULT_OLLAMA_MODEL && health.fallbackAvailable), "Neither the requested model nor its eligible fallback is installed").toBe(true);
    deadline = Date.now() + 480_000;
  }, 10_000);
  afterAll(async () => { await sidecar?.close(); });

  for (const fixture of AI_MEANING_CASES) {
    const paths: MeaningPath[] = fixture.recapOnly ? ["recap"] : ["note", "recap"];
    for (const path of paths) {
      it(`${AI_MEANING_CORPUS_VERSION}/${fixture.id}/${path}`, async () => {
        const started = Date.now();
        let output: unknown;
        let servedModel: string | null = null;
        let fallbackFrom: string | null = null;
        let failures: string[];
        try {
          if (transportFailure) throw new Error(`Remaining requests stopped after ${transportFailure}`);
          if (Date.now() >= deadline) throw new Error("Eight-minute suite budget exhausted");
          const response = await fetch(`${sidecar.url}/ai/${path === "note" ? "improve-note" : "recap"}`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify(path === "note" ? { model, taskTitle: fixture.taskTitle, noteText: fixture.source, projectName: "Synthetic quality probe", tags: [] } : recapRequest(fixture, model)),
            // Bound the probe, even though production permits longer model inference.
            signal: AbortSignal.timeout(Math.min(120_000, deadline - Date.now()))
          });
          servedModel = response.headers.get("x-ream-ai-model");
          fallbackFrom = response.headers.get("x-ream-ai-fallback-from");
          output = await response.json();
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(output)}`);
          if (!servedModel) throw new Error("Response omitted actual model identity");
          failures = evaluateAiMeaning(fixture, path, output);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          transportFailure ??= message;
          failures = [`transport: ${message}`];
        }
        const report = {
          corpus: AI_MEANING_CORPUS_VERSION, case: fixture.id, path, requestedModel: model,
          servedModel, fallbackFrom,
          durationMs: Date.now() - started, failures, output
        };
        console.info(JSON.stringify(report));
        expect(failures, JSON.stringify(report, null, 2)).toEqual([]);
      }, 130_000);
    }
  }
});
