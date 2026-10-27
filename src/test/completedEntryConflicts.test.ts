import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReamDatabase } from "../shared/db";
import { createTask } from "../shared/taskRepository";
import { createTimeEntry, deleteTimeEntry, updateTimeEntry } from "../shared/timerRepository";
import { EntryConflictError } from "../shared/entryConflict";
import { NoteConflictError } from "../shared/noteConflict";
import { acceptNoteAiSuggestion, createNoteAiSuggestion, updateNoteAiSuggestionStatus } from "../shared/aiSuggestionRepository";
import { formatImprovedNoteMarkdown } from "../shared/ai";
import { importReamData, readAllExportData } from "../shared/exportRepository";

const databases: ReamDatabase[] = [];
const connections: ReamDatabase[] = [];
const now = new Date("2026-09-17T10:00:00.000Z");
const output = { clean_note: "Finished the review.", summary: "Review completed.", next_steps: [], blockers: [], tags: [] };

async function setup() {
  const db = new ReamDatabase(`ream-entry-conflicts-${crypto.randomUUID()}`);
  databases.push(db);
  const other = new ReamDatabase(db.name);
  connections.push(other);
  const task = await createTask(db, { title: "Review" });
  const entry = await createTimeEntry(db, {
    taskId: task.id, projectIds: ["project-a"], startedAt: "2026-09-17T09:00:12.345Z",
    endedAt: "2026-09-17T09:30:12.345Z", note: "Reviewed the draft"
  }, now);
  // Simulate an entry with paused time: wall-clock interval is not its duration.
  entry.durationSeconds = 81;
  await db.timeEntries.put(entry);
  const guard = { expectedEntry: entry, expectedWorkspaceRevision: 0 };
  const suggestionInput = { noteId: entry.id, model: "synthetic", inputText: entry.note, outputJson: output, durationMs: 1 };
  const suggestion = await createNoteAiSuggestion(db, suggestionInput, now, 0);
  return { db, other, entry, guard, suggestion, suggestionInput };
}

afterEach(async () => {
  vi.restoreAllMocks();
  connections.splice(0).forEach((db) => db.close());
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

describe("completed entry conflict guards", () => {
  it("allows only one of two concurrent edits with identical write timestamps", async () => {
    const { db, other, entry, guard } = await setup();
    const results = await Promise.allSettled([
      updateTimeEntry(db, entry.id, { ...entry, note: "First edit" }, now, guard),
      updateTimeEntry(other, entry.id, { ...entry, note: "Second edit" }, now, guard)
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((result) => result.status === "rejected");
    expect(loser?.status === "rejected" && loser.reason).toBeInstanceOf(EntryConflictError);
    expect((await db.timeEntries.get(entry.id))?.durationSeconds).toBe(81);
  });

  it.each(["taskId", "projectIds", "startedAt", "endedAt", "durationSeconds"] as const)("detects another window changing %s, not just notes", async (field) => {
    const { db, other, entry, guard } = await setup();
    const values = { taskId: "other-task", projectIds: ["project-b"], startedAt: "2026-09-17T08:00:00Z", endedAt: "2026-09-17T11:00:00Z", durationSeconds: 42 };
    const changed = { ...entry, [field]: values[field] };
    await other.timeEntries.put(changed);
    await expect(updateTimeEntry(db, entry.id, { ...entry, note: "My draft" }, now, guard)).rejects.toMatchObject({ savedEntry: changed });
    expect(await db.timeEntries.get(entry.id)).toEqual(changed);
  });

  it("rechecks a reviewed version before saving mine and supports an intentional empty note", async () => {
    const { db, other, entry, guard } = await setup();
    const reviewed = await updateTimeEntry(other, entry.id, { ...entry, note: "Other version" }, now, guard);
    const newest = await updateTimeEntry(other, entry.id, { ...reviewed, note: "Changed during review" }, now, { ...guard, expectedEntry: reviewed });
    await expect(updateTimeEntry(db, entry.id, { ...entry, note: "" }, now, { ...guard, expectedEntry: reviewed })).rejects.toMatchObject({ savedEntry: newest });
    const resolved = await updateTimeEntry(db, entry.id, { ...entry, note: "" }, now, { ...guard, expectedEntry: newest });
    expect(resolved.note).toBe("");
    expect(resolved.durationSeconds).toBe(81);
    expect(resolved.startedAt).toBe(entry.startedAt);
  });

  it("does not recreate deleted entries or overwrite an identical entry restored from backup", async () => {
    const { db, other, entry, guard } = await setup();
    const backup = await readAllExportData(db);
    await deleteTimeEntry(other, entry.id);
    await expect(updateTimeEntry(db, entry.id, { ...entry, note: "Late edit" }, now, guard)).rejects.toThrow("deleted");
    expect(await db.timeEntries.count()).toBe(0);
    await importReamData(other, backup);
    await expect(updateTimeEntry(db, entry.id, { ...entry, note: "Old workspace edit" }, now, guard)).rejects.toThrow("restored");
    await expect(createTimeEntry(db, { ...entry, note: "Old workspace form" }, now, 0)).rejects.toThrow("restored");
    expect(await db.timeEntries.count()).toBe(1);
    expect(await db.timeEntries.get(entry.id)).toEqual(entry);
  });
});

describe("atomic AI suggestion acceptance", () => {
  it("changes only the note and acceptance record, retaining current metadata and tracked duration", async () => {
    const { db, other, entry, suggestion } = await setup();
    const changed = { ...entry, taskId: "new-task", projectIds: ["new-project"], startedAt: "2026-09-17T08:30:12.345Z", endedAt: "2026-09-17T09:45:12.345Z", durationSeconds: 52 };
    await other.timeEntries.put(changed);
    const accepted = await acceptNoteAiSuggestion(db, suggestion.id, 0, now);
    expect(accepted).toMatchObject({ status: "accepted", acceptedAt: now.toISOString(), statusUpdatedAt: now.toISOString() });
    expect(await db.timeEntries.get(entry.id)).toEqual({ ...changed, note: formatImprovedNoteMarkdown(output), updatedAt: now.toISOString() });
  });

  it.each(["New note while generating", ""])("retains a changed source note (%j) and leaves the suggestion pending", async (note) => {
    const { db, other, entry, suggestion } = await setup();
    await other.timeEntries.update(entry.id, { note });
    await expect(acceptNoteAiSuggestion(db, suggestion.id, 0, now)).rejects.toBeInstanceOf(NoteConflictError);
    expect((await db.timeEntries.get(entry.id))?.note).toBe(note);
    expect(await db.noteAiSuggestions.get(suggestion.id)).toEqual(suggestion);
  });

  it("preserves exact whitespace as the source baseline", async () => {
    const { db, entry, suggestionInput } = await setup();
    const note = "  indented note\n\n";
    await db.timeEntries.update(entry.id, { note });
    const suggestion = await createNoteAiSuggestion(db, { ...suggestionInput, inputText: note }, now, 0);
    await expect(acceptNoteAiSuggestion(db, suggestion.id, 0, now)).resolves.toMatchObject({ status: "accepted" });
  });

  it("allows repeated acceptance only while the saved note still matches the output", async () => {
    const { db, entry, suggestion } = await setup();
    await Promise.all([acceptNoteAiSuggestion(db, suggestion.id, 0, now), acceptNoteAiSuggestion(db, suggestion.id, 0, now)]);
    await db.timeEntries.update(entry.id, { note: "Edited after acceptance" });
    await expect(acceptNoteAiSuggestion(db, suggestion.id, 0, now)).rejects.toBeInstanceOf(NoteConflictError);
    expect((await db.timeEntries.get(entry.id))?.note).toBe("Edited after acceptance");
  });

  it("rolls back the note if recording acceptance fails", async () => {
    const { db, entry, suggestion } = await setup();
    vi.spyOn(db.noteAiSuggestions, "put").mockRejectedValueOnce(new Error("Disk full"));
    await expect(acceptNoteAiSuggestion(db, suggestion.id, 0, now)).rejects.toThrow("Disk full");
    expect(await db.timeEntries.get(entry.id)).toEqual(entry);
    expect(await db.noteAiSuggestions.get(suggestion.id)).toEqual(suggestion);
  });

  it("rejects deleted sources, missing suggestions, and non-atomic acceptance", async () => {
    const { db, entry, suggestion } = await setup();
    await expect(updateNoteAiSuggestionStatus(db, suggestion.id, "accepted")).rejects.toThrow("atomic");
    await db.timeEntries.delete(entry.id);
    await expect(acceptNoteAiSuggestion(db, suggestion.id, 0)).rejects.toThrow("Time entry not found");
    await db.noteAiSuggestions.delete(suggestion.id);
    await expect(acceptNoteAiSuggestion(db, suggestion.id, 0)).rejects.toThrow("AI suggestion not found");
    expect(await db.timeEntries.count()).toBe(0);
  });

  it("rejects AI results and pending acceptance from before a restore", async () => {
    const { db, other, entry, suggestion, suggestionInput } = await setup();
    await importReamData(other, await readAllExportData(db));
    await expect(createNoteAiSuggestion(db, suggestionInput, now, 0)).rejects.toThrow("restored");
    await expect(acceptNoteAiSuggestion(db, suggestion.id, 0, now)).rejects.toThrow("restored");
    expect(await db.noteAiSuggestions.count()).toBe(0);
    expect(await db.timeEntries.get(entry.id)).toEqual(entry);
  });

  it("serializes a manual edit racing with AI acceptance without losing either silently", async () => {
    const { db, other, entry, suggestion, guard } = await setup();
    const results = await Promise.allSettled([
      acceptNoteAiSuggestion(db, suggestion.id, 0, now),
      updateTimeEntry(other, entry.id, { ...entry, note: "Manual edit" }, now, guard)
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const accepted = (await db.noteAiSuggestions.get(suggestion.id))?.status === "accepted";
    expect((await db.timeEntries.get(entry.id))?.note).toBe(accepted ? formatImprovedNoteMarkdown(output) : "Manual edit");
  });
});
