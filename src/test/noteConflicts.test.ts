import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReamDatabase } from "../shared/db";
import { createTask } from "../shared/taskRepository";
import { getActiveTimer, startTimer, stopTimer, updateActiveTimerNote } from "../shared/timerRepository";
import { getJournalPage, saveJournalPage } from "../shared/journalRepository";
import { NoteConflictError } from "../shared/noteConflict";
import { createNoteAutosave } from "../renderer/notes/noteAutosave";
import { isRetainedTimerDraft, listNoteRecoveryDrafts, readNoteRecoveryDraft, writeNoteRecoveryDraft } from "../renderer/notes/noteDrafts";

const databases: ReamDatabase[] = [];
const connections: ReamDatabase[] = [];
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; }, clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null, key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); }
  };
}
async function setup() {
  const database = new ReamDatabase(`ream-conflicts-${crypto.randomUUID()}`);
  databases.push(database);
  const otherWindow = new ReamDatabase(database.name);
  connections.push(otherWindow);
  const task = await createTask(database, { title: "Concurrent notes" });
  const timer = await startTimer(database, { taskId: task.id, note: "Original" });
  const storage = memoryStorage();
  const context = `timer:${timer.startedAt}`;
  const save = (connection: ReamDatabase) => (value: string, expected: string) => updateActiveTimerNote(connection, value, new Date(), timer.startedAt, expected);
  const main = createNoteAutosave(context, storage, save(database), "main");
  const overlay = createNoteAutosave(context, storage, save(otherWindow), "overlay");
  main.sync(timer.note);
  overlay.sync(timer.note);
  return { database, otherWindow, storage, context, main, overlay, save };
}
afterEach(async () => {
  vi.useRealTimers();
  connections.splice(0).forEach((database) => database.close());
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("simultaneous note edits", () => {
  it("keeps a late edit discoverable after the other window stops its timer", async () => {
    const { database, otherWindow, overlay, storage, context } = await setup();
    overlay.change("Late overlay thought to recover");
    const entry = await stopTimer(database);
    await expect(overlay.flush()).rejects.toThrow("No timer is running");
    expect(await getActiveTimer(otherWindow)).toBeNull();
    const drafts = listNoteRecoveryDrafts(storage);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ contextId: `${context}:window:overlay`, markdown: "Late overlay thought to recover", baseValue: "Original" });
    expect(isRetainedTimerDraft(drafts[0], undefined)).toBe(true);
    expect((await database.timeEntries.get(entry.id))?.note).toBe("Original");
    // Browsing or exporting the recovery text does not delete it or rewrite the entry.
    expect(listNoteRecoveryDrafts(storage)).toEqual(drafts);
  });

  it("does not retry unresolved conflicts when typing, blurring, or refreshing", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const save = vi.fn().mockRejectedValue(new NoteConflictError("Other version"));
    const note = createNoteAutosave("journal:review", storage, save);
    note.sync("Original");
    note.change("My edit");
    await expect(note.flush()).rejects.toBeInstanceOf(NoteConflictError);
    note.change("My revised edit");
    note.sync("Newest saved version");
    await vi.advanceTimersByTimeAsync(1000);
    await expect(note.flush()).rejects.toBeInstanceOf(NoteConflictError);
    expect(save).toHaveBeenCalledTimes(1);
    await note.resolveConflict("saved");
    expect(note.getSnapshot()).toMatchObject({ value: "Newest saved version", status: "saved", dirty: false });
  });

  it("commits only one of two concurrent edits and preserves the losing window's draft", async () => {
    const { database, storage, context, main, overlay } = await setup();
    main.change("Main edit");
    overlay.change("Overlay edit");
    const results = await Promise.allSettled([main.flush(), overlay.flush()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failedIndex = results.findIndex((result) => result.status === "rejected");
    const loser = failedIndex === 0 ? main : overlay;
    const owner = failedIndex === 0 ? "main" : "overlay";
    const saved = (await getActiveTimer(database))!.note;
    expect(loser.getSnapshot()).toMatchObject({ status: "conflict", dirty: true, conflictValue: saved });
    expect(readNoteRecoveryDraft(storage, `${context}:window:${owner}`)?.markdown).toBe(loser.getSnapshot().value);
    await loser.resolveConflict("both");
    expect((await getActiveTimer(database))?.note).toContain("Main edit");
    expect((await getActiveTimer(database))?.note).toContain("Overlay edit");
    expect(loser.getSnapshot().status).toBe("saved");
  });

  it("preserves independent drafts before either window saves", async () => {
    const { main, overlay, storage, context, save, database, otherWindow } = await setup();
    main.change("Main unsaved");
    overlay.change("Overlay unsaved");
    const mainReload = createNoteAutosave(context, storage, save(database), "main");
    const overlayReload = createNoteAutosave(context, storage, save(otherWindow), "overlay");
    expect(mainReload.getSnapshot().value).toBe("Main unsaved");
    expect(overlayReload.getSnapshot().value).toBe("Overlay unsaved");
    await main.flush();
    await expect(overlay.flush()).rejects.toBeInstanceOf(NoteConflictError);
  });

  it.each(["mine", "saved"] as const)("resolves with the explicit %s choice", async (choice) => {
    const { database, main, overlay, storage, context } = await setup();
    main.change("Main edit");
    overlay.change("Overlay edit");
    await main.flush();
    await expect(overlay.flush()).rejects.toBeInstanceOf(NoteConflictError);
    await overlay.resolveConflict(choice);
    expect((await getActiveTimer(database))?.note).toBe(choice === "mine" ? "Overlay edit" : "Main edit");
    expect(overlay.getSnapshot().dirty).toBe(false);
    expect(readNoteRecoveryDraft(storage, `${context}:window:overlay`)).toBeNull();
  });

  it("does not overwrite another change made while reviewing a conflict", async () => {
    const { database, main, overlay } = await setup();
    main.change("First main edit");
    overlay.change("Overlay edit");
    await main.flush();
    await expect(overlay.flush()).rejects.toBeInstanceOf(NoteConflictError);
    main.change("Second main edit");
    await main.flush();
    await expect(overlay.resolveConflict("mine")).rejects.toBeInstanceOf(NoteConflictError);
    expect((await getActiveTimer(database))?.note).toBe("Second main edit");
    expect(overlay.getSnapshot()).toMatchObject({ value: "Overlay edit", conflictValue: "Second main edit" });
  });

  it("allows matching changes and intentional empty-note resolution", async () => {
    const { database, main, overlay } = await setup();
    main.change("Same edit");
    overlay.change("Same edit");
    await Promise.all([main.flush(), overlay.flush()]);
    main.change("More text");
    overlay.change("");
    await main.flush();
    await expect(overlay.flush()).rejects.toBeInstanceOf(NoteConflictError);
    await overlay.resolveConflict("mine");
    expect((await getActiveTimer(database))?.note).toBe("");
  });

  it("protects a journal date that another connection created after editing began", async () => {
    const { database, otherWindow } = await setup();
    await saveJournalPage(database, "2026-09-16", "First writer", new Date(), 0, "");
    await expect(saveJournalPage(otherWindow, "2026-09-16", "Second writer", new Date(), 0, "")).rejects.toBeInstanceOf(NoteConflictError);
    expect((await getJournalPage(database, "2026-09-16"))?.markdown).toBe("First writer");
  });

  it("requires review for legacy drafts with an unknown baseline", async () => {
    const storage = memoryStorage();
    writeNoteRecoveryDraft(storage, "journal:legacy", "Legacy draft");
    const save = vi.fn().mockResolvedValue(undefined);
    const note = createNoteAutosave("journal:legacy", storage, save, "main");
    note.sync("Currently saved text");
    await expect(note.flush()).rejects.toBeInstanceOf(NoteConflictError);
    expect(save).not.toHaveBeenCalled();
    expect(note.getSnapshot()).toMatchObject({ value: "Legacy draft", conflictValue: "Currently saved text" });
    await note.resolveConflict("both");
    expect(save).toHaveBeenCalledWith("Currently saved text\n\n---\n\nLegacy draft", "Currently saved text");
  });

  it("recovers against the last committed version when typing continues during a save", async () => {
    const storage = memoryStorage();
    let complete!: () => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve; })).mockRejectedValueOnce(new Error("Disk full"));
    const note = createNoteAutosave("journal:queue", storage, save, "main");
    note.sync("Original");
    note.change("First edit");
    const saving = note.flush();
    note.change("Second edit");
    complete();
    await expect(saving).rejects.toThrow("Disk full");
    expect(readNoteRecoveryDraft(storage, "journal:queue:window:main")).toMatchObject({ markdown: "Second edit", baseValue: "First edit" });
    expect(save.mock.calls).toEqual([["First edit", "Original"], ["Second edit", "First edit"]]);
  });
});
