import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReamDatabase } from "../shared/db";
import { createTask } from "../shared/taskRepository";
import { getActiveTimer, pauseTimer, startTimer, stopTimer, updateActiveTimerNote } from "../shared/timerRepository";
import { acceptActiveTimerAiSuggestion, createActiveTimerAiSuggestion, createNoteAiSuggestion, timerAiNoteId } from "../shared/aiSuggestionRepository";
import { formatImprovedNoteMarkdown } from "../shared/ai";
import { NoteConflictError } from "../shared/noteConflict";
import { importReamData, readAllExportData } from "../shared/exportRepository";

const databases: ReamDatabase[] = [];
const connections: ReamDatabase[] = [];
const now = new Date("2026-09-17T11:00:12.345Z");
const output = { clean_note: "Review completed.", summary: "Finished the review.", next_steps: [], blockers: [], tags: [] };
async function setup() {
  const db = new ReamDatabase(`ream-live-ai-${crypto.randomUUID()}`);
  databases.push(db);
  const other = new ReamDatabase(db.name);
  connections.push(other);
  const task = await createTask(db, { title: "Review" });
  const timer = await startTimer(db, { taskId: task.id, note: "  Reviewed the draft\n\n" }, now);
  const session = { startedAt: timer.startedAt, workspaceRevision: 0 };
  const input = { model: "synthetic", inputText: timer.note, outputJson: output, durationMs: 5 };
  const suggestion = await createActiveTimerAiSuggestion(db, input, session, now);
  return { db, other, timer, task, session, input, suggestion };
}
afterEach(async () => {
  vi.restoreAllMocks();
  connections.splice(0).forEach((db) => db.close());
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

describe("session-scoped live AI", () => {
  it("preserves exact source whitespace and commits the rewrite with its acceptance record", async () => {
    const { db, timer, session, suggestion } = await setup();
    expect(suggestion.noteId).toBe(timerAiNoteId(session));
    expect(suggestion.inputText).toBe(timer.note);
    const paused = await pauseTimer(db, new Date("2026-09-17T11:01:33.345Z"));
    const accepted = await acceptActiveTimerAiSuggestion(db, suggestion.id, session, now);
    expect(accepted.timer).toEqual({ ...paused, note: formatImprovedNoteMarkdown(output), updatedAt: now.toISOString() });
    expect(accepted.suggestion).toMatchObject({ status: "accepted", acceptedAt: now.toISOString() });
    expect(await db.noteAiSuggestions.get(suggestion.id)).toEqual(accepted.suggestion);
    expect((await stopTimer(db, new Date("2026-09-17T11:30:12.345Z"))).durationSeconds).toBe(81);
  });

  it.each(["Changed in the workspace", ""])("rejects a newer source note (%j) without accepting", async (note) => {
    const { db, other, session, suggestion } = await setup();
    await updateActiveTimerNote(other, note);
    await expect(acceptActiveTimerAiSuggestion(db, suggestion.id, session)).rejects.toBeInstanceOf(NoteConflictError);
    expect((await getActiveTimer(db))?.note).toBe(note);
    expect(await db.noteAiSuggestions.get(suggestion.id)).toEqual(suggestion);
  });

  it("keeps a changed-during-generation preview but cannot apply it", async () => {
    const { db, other, session, input } = await setup();
    await updateActiveTimerNote(other, "Newer source");
    const delayed = await createActiveTimerAiSuggestion(db, input, session);
    expect(delayed.inputText).toBe(input.inputText);
    await expect(acceptActiveTimerAiSuggestion(db, delayed.id, session)).rejects.toBeInstanceOf(NoteConflictError);
  });

  it("rejects late results and acceptance after stop or restart, even with identical source text", async () => {
    const { db, other, task, session, input, suggestion } = await setup();
    await stopTimer(other);
    await expect(createActiveTimerAiSuggestion(db, input, session)).rejects.toThrow("timer ended or changed");
    await expect(acceptActiveTimerAiSuggestion(db, suggestion.id, session)).rejects.toThrow("timer ended or changed");
    const next = await startTimer(other, { taskId: task.id, note: input.inputText }, new Date("2026-09-17T12:00:00Z"));
    const nextSession = { ...session, startedAt: next.startedAt };
    await expect(acceptActiveTimerAiSuggestion(db, suggestion.id, session)).rejects.toThrow("timer ended or changed");
    await expect(acceptActiveTimerAiSuggestion(db, suggestion.id, nextSession)).rejects.toThrow("another or an older");
    expect(await getActiveTimer(db)).toEqual(next);
  });

  it("does not adopt legacy suggestions stored against the shared active ID", async () => {
    const { db, session, input } = await setup();
    const legacy = await createNoteAiSuggestion(db, { ...input, noteId: "active" });
    await expect(acceptActiveTimerAiSuggestion(db, legacy.id, session)).rejects.toThrow("unscoped timer session");
    expect((await db.noteAiSuggestions.get(legacy.id))?.status).toBe("pending");
  });

  it("rejects pre-restore work even if the new timer has an identical timestamp and source", async () => {
    const { db, other, task, session, input, suggestion } = await setup();
    await stopTimer(other);
    await importReamData(other, await readAllExportData(db));
    const next = await startTimer(other, { taskId: task.id, note: input.inputText }, now);
    await expect(createActiveTimerAiSuggestion(db, input, session)).rejects.toThrow("restored");
    await expect(acceptActiveTimerAiSuggestion(db, suggestion.id, session)).rejects.toThrow("restored");
    expect(await getActiveTimer(db)).toEqual(next);
    expect(await db.noteAiSuggestions.count()).toBe(0);
  });

  it.each(["activeTimers", "noteAiSuggestions"] as const)("rolls back both records when %s fails", async (table) => {
    const { db, timer, session, suggestion } = await setup();
    vi.spyOn(db[table], "put").mockRejectedValueOnce(new Error("Disk full"));
    await expect(acceptActiveTimerAiSuggestion(db, suggestion.id, session)).rejects.toThrow("Disk full");
    expect(await getActiveTimer(db)).toEqual(timer);
    expect(await db.noteAiSuggestions.get(suggestion.id)).toEqual(suggestion);
  });

  it("serializes acceptance against another connection's autosave", async () => {
    const { db, other, timer, session, suggestion } = await setup();
    const results = await Promise.allSettled([
      acceptActiveTimerAiSuggestion(db, suggestion.id, session),
      updateActiveTimerNote(other, "Manual edit", now, timer.startedAt, timer.note)
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const accepted = (await db.noteAiSuggestions.get(suggestion.id))?.status === "accepted";
    expect((await getActiveTimer(db))?.note).toBe(accepted ? formatImprovedNoteMarkdown(output) : "Manual edit");
  });

  it("never resurrects a timer when acceptance races a stop", async () => {
    const { db, other, timer, session, suggestion } = await setup();
    const results = await Promise.allSettled([acceptActiveTimerAiSuggestion(db, suggestion.id, session), stopTimer(other)]);
    expect(results[1].status).toBe("fulfilled");
    expect(await getActiveTimer(db)).toBeNull();
    const entries = await db.timeEntries.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0].note).toBe(results[0].status === "fulfilled" ? formatImprovedNoteMarkdown(output) : timer.note);
  });

  it("allows matching already-applied output but refuses later edits", async () => {
    const { db, session, suggestion } = await setup();
    await acceptActiveTimerAiSuggestion(db, suggestion.id, session);
    await expect(acceptActiveTimerAiSuggestion(db, suggestion.id, session)).resolves.toMatchObject({ suggestion: { status: "accepted" } });
    await updateActiveTimerNote(db, "Later edit");
    await expect(acceptActiveTimerAiSuggestion(db, suggestion.id, session)).rejects.toBeInstanceOf(NoteConflictError);
  });
});
