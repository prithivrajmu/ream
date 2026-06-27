export const DEFAULT_OLLAMA_MODEL = "llama3.2:1b";
export const FALLBACK_OLLAMA_MODEL = "llama3.2:3b";
export const OLLAMA_MODEL_STORAGE_KEY = "ream.ollamaModel.v2";

export interface ImproveNoteRequest {
  noteText: string;
  taskTitle: string;
  projectName: string;
  tags: string[];
  model?: string;
}

export interface ImprovedNoteOutput {
  clean_note: string;
  summary: string;
  next_steps: string[];
  blockers: string[];
  tags: string[];
}

export interface ImproveNoteResult {
  model: string;
  output: ImprovedNoteOutput;
}

export function validateImprovedNoteOutput(value: unknown): ImprovedNoteOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AI returned an invalid note suggestion.");
  }

  const candidate = value as Record<string, unknown>;
  return {
    clean_note: readString(candidate.clean_note, "clean_note"),
    summary: readString(candidate.summary, "summary"),
    next_steps: readStringArray(candidate.next_steps, "next_steps"),
    blockers: readStringArray(candidate.blockers, "blockers"),
    tags: readStringArray(candidate.tags, "tags").map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean)
  };
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`AI response field "${field}" must be a string.`);
  }
  return value.trim();
}

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`AI response field "${field}" must be a string array.`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}
