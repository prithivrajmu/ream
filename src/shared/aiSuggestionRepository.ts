import type { NoteAiSuggestion, NoteAiSuggestionStatus } from "./domain";
import type { ImprovedNoteOutput } from "./ai";
import type { TimesheetDatabase } from "./db";
import { createId } from "./id";

export interface CreateNoteAiSuggestionInput {
  noteId: string;
  model: string;
  inputText: string;
  outputJson: ImprovedNoteOutput;
}

export async function createNoteAiSuggestion(
  database: TimesheetDatabase,
  input: CreateNoteAiSuggestionInput,
  now = new Date()
): Promise<NoteAiSuggestion> {
  const timestamp = now.toISOString();
  const suggestion: NoteAiSuggestion = {
    id: createId("note-ai"),
    noteId: input.noteId,
    model: input.model.trim(),
    inputText: input.inputText,
    outputJson: input.outputJson,
    status: "pending",
    createdAt: timestamp,
    acceptedAt: null
  };

  await database.noteAiSuggestions.add(suggestion);
  return suggestion;
}

export async function updateNoteAiSuggestionStatus(
  database: TimesheetDatabase,
  suggestionId: string,
  status: NoteAiSuggestionStatus,
  now = new Date()
): Promise<NoteAiSuggestion> {
  const suggestion = await database.noteAiSuggestions.get(suggestionId);
  if (!suggestion) {
    throw new Error("AI suggestion not found.");
  }

  const updated: NoteAiSuggestion = {
    ...suggestion,
    status,
    acceptedAt: status === "accepted" ? now.toISOString() : suggestion.acceptedAt
  };

  await database.noteAiSuggestions.put(updated);
  return updated;
}
