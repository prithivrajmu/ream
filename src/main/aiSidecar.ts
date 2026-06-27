import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  DEFAULT_OLLAMA_MODEL,
  FALLBACK_OLLAMA_MODEL,
  type ImprovedNoteOutput,
  type ImproveNoteRequest,
  validateImprovedNoteOutput
} from "../shared/ai";

const DEFAULT_PORT = Number(process.env.REAM_AI_SIDECAR_PORT ?? 39271);
const OLLAMA_CHAT_URL = process.env.REAM_OLLAMA_CHAT_URL ?? "http://localhost:11434/api/chat";
const OLLAMA_HEALTH_URL = process.env.REAM_OLLAMA_HEALTH_URL ?? "http://localhost:11434/api/tags";
const REQUEST_TIMEOUT_MS = 300_000;
const HEALTH_TIMEOUT_MS = 1_500;
const MAX_REQUEST_BYTES = 128 * 1024;
const USED_MODEL_HEADER = "x-ream-ai-model";
const FALLBACK_FROM_HEADER = "x-ream-ai-fallback-from";

export interface AiSidecarHandle {
  url: string;
  close: () => Promise<void>;
}

interface OllamaChatResponse {
  message?: {
    content?: unknown;
  };
}

export async function startAiSidecar(): Promise<AiSidecarHandle> {
  const server = createServer((request, response) => {
    void routeRequest(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(DEFAULT_PORT, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    url: `http://127.0.0.1:${DEFAULT_PORT}`,
    close: () => closeServer(server)
  };
}

async function routeRequest(request: IncomingMessage, response: ServerResponse) {
  try {
    if (request.method === "GET" && request.url === "/ai/health") {
      await handleHealth(response);
      return;
    }

    if (request.method === "POST" && request.url === "/ai/improve-note") {
      await handleImproveNote(request, response);
      return;
    }

    sendJson(response, 404, { error: "AI sidecar endpoint not found." });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "AI sidecar request failed." });
  }
}

async function handleHealth(response: ServerResponse) {
  const model = readModelName();
  const fallbackModel = readFallbackModelName();
  try {
    await fetchWithTimeout(OLLAMA_HEALTH_URL, { method: "GET" }, HEALTH_TIMEOUT_MS);
    sendJson(response, 200, { ok: true, ollama: { ok: true }, model, fallbackModel });
  } catch {
    sendJson(response, 200, { ok: true, ollama: { ok: false }, model, fallbackModel });
  }
}

async function handleImproveNote(request: IncomingMessage, response: ServerResponse) {
  const input = validateImproveNoteRequest(await readJsonBody(request));
  const primaryModel = input.model?.trim() || readModelName();
  const fallbackModel = readFallbackModelName();

  try {
    const output = await improveNoteWithModel(input, primaryModel);
    response.setHeader(USED_MODEL_HEADER, primaryModel);
    sendJson(response, 200, output);
  } catch (error) {
    if (shouldTryFallback(input.model, primaryModel, fallbackModel)) {
      try {
        const output = await improveNoteWithModel(input, fallbackModel);
        response.setHeader(USED_MODEL_HEADER, fallbackModel);
        response.setHeader(FALLBACK_FROM_HEADER, primaryModel);
        sendJson(response, 200, output);
        return;
      } catch (fallbackError) {
        sendAiError(response, fallbackError, fallbackModel, `Ollama failed with ${primaryModel} and fallback ${fallbackModel}.`);
        return;
      }
    }

    sendAiError(response, error, primaryModel);
  }
}

async function improveNoteWithModel(input: ImproveNoteRequest, model: string): Promise<ImprovedNoteOutput> {
  const ollamaResponse = await fetchWithTimeout(
    OLLAMA_CHAT_URL,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        messages: [
          {
            role: "system",
            content: buildSystemPrompt()
          },
          {
            role: "user",
            content: buildUserPrompt(input)
          }
        ],
        options: {
          num_predict: 512,
          temperature: 0.2
        }
      })
    },
    REQUEST_TIMEOUT_MS
  );

  if (!ollamaResponse.ok) {
    throw new Error(`Ollama returned ${ollamaResponse.status}.`);
  }

  const chatResponse = (await ollamaResponse.json()) as OllamaChatResponse;
  const content = chatResponse.message?.content;
  if (typeof content !== "string") {
    throw new Error("Ollama response did not include text content.");
  }

  return validateImprovedNoteOutput(JSON.parse(content));
}

function sendAiError(response: ServerResponse, error: unknown, model: string, prefix?: string) {
  const message = error instanceof Error ? error.message : "Unable to improve note.";
  const fullMessage = prefix ? `${prefix} ${message}` : message;

  if (isTimeoutError(error)) {
    sendJson(response, 504, {
      error: `${prefix ? `${prefix} ` : ""}Ollama timed out while running ${model}. Try again after the model is loaded, or choose a smaller local model.`
    });
    return;
  }

  if (isNetworkError(error)) {
    sendJson(response, 503, {
      error: `${prefix ? `${prefix} ` : ""}Ollama is not available at ${OLLAMA_CHAT_URL}. Start Ollama and pull ${model}, then try again.`
    });
    return;
  }

  sendJson(response, 502, { error: fullMessage });
}

function shouldTryFallback(explicitModel: string | undefined, primaryModel: string, fallbackModel: string): boolean {
  if (primaryModel === fallbackModel) {
    return false;
  }

  if (!explicitModel) {
    return true;
  }

  return explicitModel === DEFAULT_OLLAMA_MODEL;
}

function buildSystemPrompt(): string {
  return `You are a precise work-notes assistant. Improve the user's rough task note without inventing facts.
Return only valid JSON matching this schema:
{
  "clean_note": "string",
  "summary": "string",
  "next_steps": ["string"],
  "blockers": ["string"],
  "tags": ["string"]
}

Rules:
- Keep the meaning faithful to the original note.
- Do not add facts not present in the note or task context.
- If there are no next steps, return [].
- If there are no blockers, return [].
- Tags should be short lowercase keywords.
- clean_note should be professional but natural.
- summary should be one short sentence.`;
}

function buildUserPrompt(input: ImproveNoteRequest): string {
  return `Task title: ${input.taskTitle}
Project: ${input.projectName}
Existing tags: ${input.tags.join(", ")}
Raw note:
${input.noteText}`;
}

function validateImproveNoteRequest(value: unknown): ImproveNoteRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Improve note request must be a JSON object.");
  }

  const candidate = value as Record<string, unknown>;
  const noteText = readRequiredString(candidate.noteText, "noteText");
  const taskTitle = readRequiredString(candidate.taskTitle, "taskTitle");
  const projectName = typeof candidate.projectName === "string" ? candidate.projectName.trim() : "";
  const tags = Array.isArray(candidate.tags)
    ? candidate.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean)
    : [];
  const model = typeof candidate.model === "string" ? candidate.model.trim() : undefined;

  return { noteText, taskTitle, projectName, tags, model };
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function readModelName(): string {
  return process.env.REAM_OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
}

function readFallbackModelName(): string {
  return process.env.REAM_OLLAMA_FALLBACK_MODEL?.trim() || FALLBACK_OLLAMA_MODEL;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) {
      throw new Error("AI request is too large.");
    }
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "AbortError";
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes("fetch failed") || error.message.includes("ECONNREFUSED");
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
