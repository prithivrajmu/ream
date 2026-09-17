import type { NoteAiSuggestion, NoteAiSuggestionStatus } from "./domain";
import { formatImprovedNoteMarkdown, validateImprovedNoteOutput, type ImprovedNoteOutput } from "./ai";
import type { ReamDatabase } from "./db";
import { createId } from "./id";
import { assertNoteUnchanged } from "./noteConflict";
import { assertWorkspaceRevision } from "./workspaceRepository";

export interface CreateNoteAiSuggestionInput {
  noteId: string;
  model: string;
  inputText: string;
  outputJson: ImprovedNoteOutput;
  durationMs: number;
}

export async function createNoteAiSuggestion(
  database: ReamDatabase,
  input: CreateNoteAiSuggestionInput,
  now = new Date(),
  expectedWorkspaceRevision?: number
): Promise<NoteAiSuggestion> {
  const timestamp = now.toISOString();
  const suggestion: NoteAiSuggestion = {
    id: createId("note-ai"),
    noteId: input.noteId,
    model: input.model.trim(),
    inputText: input.inputText,
    outputJson: input.outputJson,
    status: "pending",
    durationMs: Math.max(0, Math.round(input.durationMs)),
    createdAt: timestamp,
    statusUpdatedAt: null,
    acceptedAt: null
  };

  await database.transaction("rw", database.noteAiSuggestions, database.workspaceState, async () => {
    await assertWorkspaceRevision(database, expectedWorkspaceRevision);
    await database.noteAiSuggestions.add(suggestion);
  });
  return suggestion;
}

export async function updateNoteAiSuggestionStatus(
  database: ReamDatabase,
  suggestionId: string,
  status: NoteAiSuggestionStatus,
  now = new Date()
): Promise<NoteAiSuggestion> {
  return database.transaction("rw", database.noteAiSuggestions, async () => {
    const suggestion = await database.noteAiSuggestions.get(suggestionId);
    if (!suggestion) {
      throw new Error("AI suggestion not found.");
    }
    // The live overlay still uses its autosave path. Completed entries must use
    // acceptNoteAiSuggestion so the note and status cannot commit separately.
    if (status === "accepted" && suggestion.noteId !== "active") {
      throw new Error("Accept completed-entry suggestions through the atomic note update.");
    }

    const updated: NoteAiSuggestion = {
      ...suggestion,
      status,
      statusUpdatedAt: now.toISOString(),
      acceptedAt: status === "accepted" ? now.toISOString() : suggestion.acceptedAt
    };

    await database.noteAiSuggestions.put(updated);
    return updated;
  });
}

/** Read the source and commit the note + acceptance together. Never replay preview metadata. */
export async function acceptNoteAiSuggestion(
  database: ReamDatabase,
  suggestionId: string,
  expectedWorkspaceRevision: number,
  now = new Date()
): Promise<NoteAiSuggestion> {
  return database.transaction("rw", database.timeEntries, database.noteAiSuggestions, database.workspaceState, async () => {
    await assertWorkspaceRevision(database, expectedWorkspaceRevision);
    const suggestion = await database.noteAiSuggestions.get(suggestionId);
    if (!suggestion) throw new Error("AI suggestion not found. It may have been removed by a workspace restore.");
    const entry = await database.timeEntries.get(suggestion.noteId);
    if (!entry) throw new Error("Time entry not found. The suggestion has not been applied.");
    const note = formatImprovedNoteMarkdown(validateImprovedNoteOutput(suggestion.outputJson));
    assertNoteUnchanged(entry.note, suggestion.inputText, note);
    const timestamp = now.toISOString();
    const accepted = { ...suggestion, status: "accepted" as const, statusUpdatedAt: timestamp, acceptedAt: timestamp };
    await database.timeEntries.put({ ...entry, note, updatedAt: timestamp });
    await database.noteAiSuggestions.put(accepted);
    return accepted;
  });
}

export async function listNoteAiSuggestions(database: ReamDatabase): Promise<NoteAiSuggestion[]> {
  return database.noteAiSuggestions.orderBy("createdAt").reverse().toArray();
}
