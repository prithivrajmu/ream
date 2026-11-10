import type { ActiveTimer, NoteAiSuggestion, NoteAiSuggestionStatus } from "./domain";
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
    if (status === "accepted") {
      throw new Error("Accept suggestions through the atomic note update.");
    }

    const updated: NoteAiSuggestion = {
      ...suggestion,
      status,
      statusUpdatedAt: now.toISOString()
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

export interface TimerAiSession {
  startedAt: string;
  workspaceRevision: number;
}

/** No schema change: noteId is already a string; legacy "active" records stay in history. */
export function timerAiNoteId(session: TimerAiSession): string {
  return `timer:${session.workspaceRevision}:${session.startedAt}`;
}

async function readAiTimer(database: ReamDatabase, session: TimerAiSession): Promise<ActiveTimer> {
  await assertWorkspaceRevision(database, session.workspaceRevision);
  const timer = await database.activeTimers.get("active");
  if (!timer || timer.startedAt !== session.startedAt) {
    throw new Error("The timer ended or changed. This suggestion cannot be applied to a different session.");
  }
  return timer;
}

export async function createActiveTimerAiSuggestion(
  database: ReamDatabase,
  input: Omit<CreateNoteAiSuggestionInput, "noteId">,
  session: TimerAiSession,
  now = new Date()
): Promise<NoteAiSuggestion> {
  return database.transaction("rw", database.activeTimers, database.noteAiSuggestions, database.workspaceState, async () => {
    await readAiTimer(database, session);
    // The source may have changed during generation. Keep the preview available
    // for copying, but acceptance below still compares against its exact source.
    return createNoteAiSuggestion(database, { ...input, noteId: timerAiNoteId(session) }, now, session.workspaceRevision);
  });
}

export async function acceptActiveTimerAiSuggestion(
  database: ReamDatabase,
  suggestionId: string,
  session: TimerAiSession,
  now = new Date()
): Promise<{ timer: ActiveTimer; suggestion: NoteAiSuggestion }> {
  return database.transaction("rw", database.activeTimers, database.noteAiSuggestions, database.workspaceState, async () => {
    const timer = await readAiTimer(database, session);
    const suggestion = await database.noteAiSuggestions.get(suggestionId);
    if (!suggestion) throw new Error("AI suggestion not found. Generate a new suggestion from the current note.");
    if (suggestion.noteId !== timerAiNoteId(session)) {
      throw new Error("This suggestion belongs to another or an older unscoped timer session. Generate a new suggestion.");
    }
    const note = formatImprovedNoteMarkdown(validateImprovedNoteOutput(suggestion.outputJson));
    assertNoteUnchanged(timer.note, suggestion.inputText, note);
    const timestamp = now.toISOString();
    const updatedTimer = { ...timer, note, updatedAt: timestamp };
    const accepted: NoteAiSuggestion = { ...suggestion, status: "accepted", statusUpdatedAt: timestamp, acceptedAt: timestamp };
    await database.activeTimers.put(updatedTimer);
    await database.noteAiSuggestions.put(accepted);
    return { timer: updatedTimer, suggestion: accepted };
  });
}
