export const DEFAULT_OLLAMA_MODEL = "llama3.2:3b";
export const FALLBACK_OLLAMA_MODEL = "llama3.2:1b";
export const OLLAMA_MODEL_STORAGE_KEY = "ream.ollamaModel.v2";

export interface OllamaHealthStatus {
  ok: boolean;
  ollama: {
    ok: boolean;
  };
  model: string;
  fallbackModel: string;
  checkedModel: string;
  modelAvailable: boolean;
  fallbackAvailable: boolean;
}

export interface OllamaPullResult {
  model: string;
  output: string;
}

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

export interface RecapEntryInput {
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  taskTitle: string;
  projectNames: string[];
  note: string;
}

export interface RecapJournalPageInput {
  dateKey: string;
  markdown: string;
}

export interface GenerateRecapRequest {
  sourceStartDateKey: string;
  sourceEndDateKey: string;
  sourceLabel: string;
  entries: RecapEntryInput[];
  journalPages: RecapJournalPageInput[];
  model?: string;
}

export interface GeneratedRecapOutput {
  summary: string;
  todos: string[];
}

export interface GenerateRecapResult {
  model: string;
  output: GeneratedRecapOutput;
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

export function formatImprovedNoteMarkdown(output: ImprovedNoteOutput): string {
  const todos = output.next_steps.length
    ? output.next_steps.map((step) => `- [ ] ${step}`).join("\n")
    : "_No follow-up actions identified._";
  const blockers = output.blockers.length
    ? output.blockers.map((blocker) => `- ${blocker}`).join("\n")
    : "_No blockers identified._";
  const tags = output.tags.length
    ? output.tags.map((tag) => `#${tag.replace(/^#+/, "").replace(/\s+/g, "-").toLocaleLowerCase()}`).join(" ")
    : "_No tags suggested._";

  return [
    "## Note",
    output.clean_note,
    "## Summary",
    output.summary,
    "## To-do",
    todos,
    "## Blockers",
    blockers,
    "## Tags",
    tags
  ].join("\n\n");
}

export function validateGeneratedRecapOutput(value: unknown): GeneratedRecapOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AI returned an invalid recap.");
  }
  const candidate = value as Record<string, unknown>;
  return {
    summary: readString(candidate.summary, "summary"),
    todos: readStringArray(candidate.todos, "todos")
  };
}

export function formatGeneratedRecapMarkdown(output: GeneratedRecapOutput, sourceLabel: string): string {
  const todos = output.todos.length
    ? output.todos.map((todo) => `- [ ] ${todo}`).join("\n")
    : "_No explicit todos found._";
  return `## Recap · ${sourceLabel}\n\n### Summary\n\n${output.summary}\n\n### Todos\n\n${todos}`;
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
